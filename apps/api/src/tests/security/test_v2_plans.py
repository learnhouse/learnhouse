"""V2 plans: unlimited members, the Business tier, and the grace period that
keeps pre-V2 Pro orgs on the features that moved to Business."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.security.features_utils.plans import (
    ATLAS_REQUIRED_PLAN,
    FEATURE_PLAN_REQUIREMENTS,
    LEGACY_PRO_FEATURES,
    PLAN_LIMITS,
)
from src.security.features_utils.resolve import _legacy_pro_grant, resolve_feature


def _future(days=30):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _past(days=1):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _saas(plan, **extra):
    return {"config_version": "2.0", "plan": plan, **extra}


class TestCatalog:
    def test_paid_plans_include_unlimited_members(self):
        for plan in ("standard", "pro", "business", "enterprise"):
            assert PLAN_LIMITS[plan]["members"] == 0, plan

    def test_admin_seats(self):
        assert [PLAN_LIMITS[p]["admin_seats"] for p in ("standard", "pro", "business")] == [3, 10, 25]

    def test_business_features(self):
        for feature in ("live_sessions", "required_training", "company_seats", "sso", "scim", "lti", "scorm", "audit_logs"):
            assert FEATURE_PLAN_REQUIREMENTS[feature] == "business", feature

    def test_atlas_is_on_every_plan(self):
        assert ATLAS_REQUIRED_PLAN == "free"


class TestLegacyProGrant:
    def test_pro_org_inside_its_grace_period(self):
        for feature in LEGACY_PRO_FEATURES:
            assert _legacy_pro_grant({"legacy_pro_until": _future()}, "pro", feature)

    def test_naive_dates_count_as_utc(self):
        naive = (datetime.now(timezone.utc) + timedelta(days=2)).replace(tzinfo=None).isoformat()
        assert _legacy_pro_grant({"legacy_pro_until": naive}, "pro", "live_sessions")

    def test_date_only_values(self):
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
        assert _legacy_pro_grant({"legacy_pro_until": tomorrow}, "pro", "live_sessions")

    @pytest.mark.parametrize(
        "config, plan, feature",
        [
            ({"legacy_pro_until": _past()}, "pro", "live_sessions"),  # expired
            ({}, "pro", "live_sessions"),  # never stamped
            ({"legacy_pro_until": "not a date"}, "pro", "live_sessions"),
            ({"legacy_pro_until": _future()}, "standard", "live_sessions"),  # not Pro
            ({"legacy_pro_until": _future()}, "pro", "sso"),  # never was Pro
        ],
    )
    def test_no_grant(self, config, plan, feature):
        assert _legacy_pro_grant(config, plan, feature) is False

    def test_resolve_keeps_the_feature_for_a_grandfathered_pro_org(self):
        with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.resolve._get_purchased_extra", return_value=0
        ):
            kept = resolve_feature("live_sessions", _saas("pro", legacy_pro_until=_future()), 0)
            lost = resolve_feature("live_sessions", _saas("pro", legacy_pro_until=_past()), 0)
            new_pro = resolve_feature("live_sessions", _saas("pro"), 0)
            business = resolve_feature("live_sessions", _saas("business"), 0)
        assert kept["available"] and kept["enabled"]
        assert not lost["available"] and lost["upgrade_plan"] == "business"
        assert not new_pro["available"]
        assert business["available"]


class TestPlanCheckGrace:
    async def test_grandfathered_pro_org_passes_a_business_check(self):
        from src.security.features_utils import plan_check

        config = SimpleNamespace(config=_saas("pro", legacy_pro_until=_future()))
        with patch.object(plan_check, "_check_mode_bypass", return_value=None), patch.object(
            plan_check, "get_org_plan", AsyncMock(return_value="pro")
        ), patch("src.services.orgs.org_config_lookup.get_session_org_config", AsyncMock(return_value=config)):
            assert await plan_check.check_org_plan(1, "business", "company_seats", object()) is True

    async def test_other_features_and_plans_still_need_business(self):
        from src.security.features_utils import plan_check

        config = SimpleNamespace(config=_saas("pro", legacy_pro_until=_future()))
        with patch.object(plan_check, "_check_mode_bypass", return_value=None), patch(
            "src.services.orgs.org_config_lookup.get_session_org_config", AsyncMock(return_value=config)
        ):
            with patch.object(plan_check, "get_org_plan", AsyncMock(return_value="pro")):
                with pytest.raises(HTTPException) as exc:
                    await plan_check.check_org_plan(1, "business", "SSO", object())
                assert exc.value.status_code == 403
            with patch.object(plan_check, "get_org_plan", AsyncMock(return_value="standard")):
                with pytest.raises(HTTPException):
                    await plan_check.check_org_plan(1, "business", "company_seats", object())

    async def test_expired_or_missing_config(self):
        from src.security.features_utils import plan_check

        with patch.object(plan_check, "_check_mode_bypass", return_value=None), patch.object(
            plan_check, "get_org_plan", AsyncMock(return_value="pro")
        ):
            with patch("src.services.orgs.org_config_lookup.get_session_org_config", AsyncMock(return_value=None)):
                with pytest.raises(HTTPException):
                    await plan_check.check_org_plan(1, "business", "live_sessions", object())
            expired = SimpleNamespace(config=_saas("pro", legacy_pro_until=_past()))
            with patch("src.services.orgs.org_config_lookup.get_session_org_config", AsyncMock(return_value=expired)):
                with pytest.raises(HTTPException):
                    await plan_check.check_org_plan(1, "business", "live_sessions", object())

    async def test_router_dependency_uses_the_grace_period(self):
        from starlette.requests import Request

        from src.security.features_utils import plan_check

        dep = plan_check.require_plan("business", "required_training")
        request = Request({"type": "http", "path_params": {"org_id": "7"}, "query_string": b"", "headers": []})
        config = SimpleNamespace(config=_saas("pro", legacy_pro_until=_future()))
        with patch.object(plan_check, "_check_mode_bypass", return_value=None), patch.object(
            plan_check, "get_org_plan", AsyncMock(return_value="pro")
        ), patch("src.services.orgs.org_config_lookup.get_session_org_config", AsyncMock(return_value=config)):
            assert await dep(request, object()) is True
        with patch.object(plan_check, "_check_mode_bypass", return_value=None), patch.object(
            plan_check, "get_org_plan", AsyncMock(return_value="pro")
        ), patch("src.services.orgs.org_config_lookup.get_session_org_config", AsyncMock(return_value=None)):
            with pytest.raises(HTTPException):
                await dep(request, object())


def test_upgrade_message_never_names_a_personal_plan_to_an_org():
    from src.security.features_utils.plan_check import _plan_to_buy

    # A free org gated on a Personal-tier feature is pointed at Standard.
    assert _plan_to_buy("personal", "free") == "standard"
    assert _plan_to_buy("personal-family", "free") == "standard"
    # Creators already on the personal line keep their own ladder.
    assert _plan_to_buy("personal-family", "personal") == "personal-family"
    # Business-line requirements are shown as-is.
    assert _plan_to_buy("pro", "free") == "pro"
    # At or above Standard (or an unknown plan name) the requirement is kept / Standard named.
    assert _plan_to_buy("personal", "enterprise") == "personal"
    assert _plan_to_buy("personal", "mystery") == "standard"
