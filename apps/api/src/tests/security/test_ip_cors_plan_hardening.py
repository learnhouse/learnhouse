"""Regression tests: client-IP spoofing, catch-all CORS/CSRF origin regex,
CSRF service-key skip, and plan gates (org_id override, body-org creation,
assignments limit, course-planning finalize limit)."""

import re
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException
from sqlmodel import select
from starlette.requests import Request

from src.core.middleware.cors import get_cors_origin_regex
from src.db.courses.certifications import CertificationCreate, Certifications
from src.db.organization_config import OrganizationConfig
from src.db.usergroups import UserGroup, UserGroupCreate
from src.security.features_utils.plan_check import require_plan_for_usergroups
from src.security.features_utils.resolve import resolve_feature
from src.services.security.rate_limiting import get_client_ip

CATCH_ALL = r"\b((?:https?://)[^\s/$.?#].[^\s]*)\b"
SAAS = "src.security.features_utils.plan_check.get_deployment_mode"


class _saas:
    """Pin 'saas' for plan_check and plan_meets_requirement's lazy import."""

    def __enter__(self):
        self._ps = [
            patch(SAAS, return_value="saas"),
            patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"),
        ]
        for p in self._ps:
            p.start()

    def __exit__(self, *exc):
        for p in self._ps:
            p.stop()


# ---------------------------------------------------------------------------
# Client IP
# ---------------------------------------------------------------------------


def _ip_request(client_host, headers):
    return SimpleNamespace(
        client=SimpleNamespace(host=client_host) if client_host else None,
        headers=headers,
    )


class TestClientIp:
    def test_spoofed_leftmost_xff_ignored_behind_private_proxy(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_SECURITY__TRUST_PROXY_HEADERS", raising=False)
        # Client sent "1.2.3.4"; the edge proxy appended the real peer.
        req = _ip_request(
            "10.0.0.5", {"X-Forwarded-For": "1.2.3.4, 8.8.4.4, 10.0.0.9"}
        )
        assert get_client_ip(req) == "8.8.4.4"

    def test_rotating_spoofed_values_share_one_key(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_SECURITY__TRUST_PROXY_HEADERS", raising=False)
        ips = {
            get_client_ip(
                _ip_request("127.0.0.1", {"X-Forwarded-For": f"9.9.9.{i}, 1.1.1.1"})
            )
            for i in range(5)
        }
        assert ips == {"1.1.1.1"}

    def test_trust_switch_off_uses_direct_peer(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_SECURITY__TRUST_PROXY_HEADERS", "false")
        req = _ip_request(
            "10.0.0.5", {"X-Forwarded-For": "8.8.4.4", "X-Real-IP": "8.8.4.5"}
        )
        assert get_client_ip(req) == "10.0.0.5"

    def test_untrusted_peer_ignores_headers(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_SECURITY__TRUST_PROXY_HEADERS", raising=False)
        req = _ip_request("8.8.8.8", {"X-Forwarded-For": "1.2.3.4"})
        assert get_client_ip(req) == "8.8.8.8"


# ---------------------------------------------------------------------------
# CORS / CSRF catch-all regex
# ---------------------------------------------------------------------------


def _hosting(tenancy, allowed_regexp=CATCH_ALL, development_mode=False):
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            tenancy=tenancy,
            allowed_regexp=allowed_regexp,
            allowed_origins=[],
            frontend_domain="app.example.com",
            domain="example.com",
        ),
        general_config=SimpleNamespace(development_mode=development_mode),
    )


class TestCatchAllOriginRegex:
    @pytest.mark.parametrize("tenancy", ["multi", "single"])
    def test_cors_rejects_foreign_origin(self, tenancy):
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_hosting(tenancy),
        ):
            regex = get_cors_origin_regex()
        assert not re.fullmatch(regex, "https://evil.invalid")
        assert re.fullmatch(regex, "https://app.example.com")

    def test_cors_dev_mode_stays_permissive(self):
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_hosting("multi", development_mode=True),
        ):
            assert get_cors_origin_regex() == CATCH_ALL

    @pytest.mark.parametrize("tenancy", ["multi", "single"])
    def test_csrf_rejects_foreign_origin(self, tenancy):
        from src.security.csrf import CSRFProtectionMiddleware

        with patch(
            "src.security.csrf.get_learnhouse_config",
            return_value=_hosting(tenancy),
        ):
            mw = CSRFProtectionMiddleware(MagicMock())
        assert mw.is_allowed_origin("https://evil.invalid") is False
        assert mw.is_allowed_origin("https://app.example.com") is True

    def test_scoped_regex_kept(self):
        scoped = r"^https?://(.*\.)?learnhouse\.io$"
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_hosting("multi", allowed_regexp=scoped),
        ):
            assert get_cors_origin_regex() == scoped


class TestCsrfServiceKeySkip:
    def _mw(self):
        from src.security.csrf import CSRFProtectionMiddleware

        with patch(
            "src.security.csrf.get_learnhouse_config",
            return_value=_hosting("multi", allowed_regexp=""),
        ):
            return CSRFProtectionMiddleware(MagicMock())

    def _req(self, headers):
        req = MagicMock()
        req.headers = headers
        return req

    def test_internal_key_requires_valid_value(self, monkeypatch):
        monkeypatch.setenv("COLLAB_INTERNAL_KEY", "real-collab-key")
        monkeypatch.setenv("CLOUD_INTERNAL_KEY", "real-cloud-key")
        mw = self._mw()
        assert mw._is_csrf_exempt(self._req({"x-internal-key": "anything"})) is False
        assert mw._is_csrf_exempt(self._req({"x-internal-key": "real-collab-key"})) is True
        assert mw._is_csrf_exempt(self._req({"x-internal-key": "real-cloud-key"})) is True

    def test_unset_keys_never_exempt(self, monkeypatch):
        for name in ("COLLAB_INTERNAL_KEY", "CLOUD_INTERNAL_KEY", "LEARNHOUSE_PLATFORM_API_KEY"):
            monkeypatch.delenv(name, raising=False)
        mw = self._mw()
        assert mw._is_csrf_exempt(self._req({"x-internal-key": ""})) is False
        assert mw._is_csrf_exempt(self._req({"x-platform-key": "x"})) is False

    def test_platform_key_requires_valid_value(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_PLATFORM_API_KEY", "real-platform-key")
        mw = self._mw()
        assert mw._is_csrf_exempt(self._req({"x-platform-key": "guess"})) is False
        assert mw._is_csrf_exempt(self._req({"x-platform-key": "real-platform-key"})) is True


# ---------------------------------------------------------------------------
# Plan gates
# ---------------------------------------------------------------------------


async def _set_plan(db, org_id, plan):
    db.add(
        OrganizationConfig(
            org_id=org_id,
            config={"config_version": "2.0", "plan": plan},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


def _plan_request(path_params=None, query_params=None):
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [],
            "query_string": urlencode(query_params or {}).encode(),
            "path_params": path_params or {},
        }
    )


class TestPlanGates:
    @pytest.mark.asyncio
    async def test_paid_org_id_query_does_not_unlock_free_usergroup(self, db, org, other_org):
        await _set_plan(db, org.id, "free")
        await _set_plan(db, other_org.id, "enterprise")
        ug = UserGroup(
            name="UG", description="", org_id=org.id, usergroup_uuid="usergroup_free",
            creation_date="", update_date="",
        )
        db.add(ug)
        await db.commit()
        await db.refresh(ug)

        dep = require_plan_for_usergroups("standard", "User Groups")
        with _saas():
            with pytest.raises(HTTPException) as exc:
                await dep(
                    _plan_request({"usergroup_id": str(ug.id)}, {"org_id": str(other_org.id)}),
                    db,
                )
            assert exc.value.status_code == 403
            assert "does not match" in exc.value.detail

            # Without the query the free org's own plan applies and still blocks.
            with pytest.raises(HTTPException) as exc:
                await dep(_plan_request({"usergroup_id": str(ug.id)}), db)
            assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_create_usergroup_on_free_plan_forbidden(self, db, org, admin_user, mock_request):
        from src.services.users.usergroups import create_usergroup

        await _set_plan(db, org.id, "free")
        with _saas(), patch(
            "src.services.users.usergroups.rbac_check", new_callable=AsyncMock
        ), patch(
            "src.services.users.usergroups.require_org_membership", new_callable=AsyncMock
        ):
            with pytest.raises(HTTPException) as exc:
                await create_usergroup(
                    mock_request, db, admin_user,
                    UserGroupCreate(name="UG", description="d", org_id=org.id),
                )
        assert exc.value.status_code == 403
        assert (await db.execute(select(UserGroup))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_create_certification_on_free_plan_forbidden(
        self, db, org, course, admin_user, mock_request
    ):
        from src.services.courses.certifications import create_certification

        await _set_plan(db, org.id, "free")
        with _saas(), patch(
            "src.services.courses.certifications.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_certification(
                    mock_request, CertificationCreate(course_id=course.id), admin_user, db
                )
        assert exc.value.status_code == 403
        assert (await db.execute(select(Certifications))).scalars().all() == []

    def test_free_plan_assignments_limit_is_five(self):
        with patch(
            "src.security.features_utils.resolve.get_deployment_mode", return_value="saas"
        ):
            resolved = resolve_feature("assignments", {"config_version": "2.0", "plan": "free"})
            assert resolved["limit"] == 5
            assert resolve_feature(
                "assignments", {"config_version": "2.0", "plan": "pro"}
            )["limit"] == 0

    @pytest.mark.asyncio
    async def test_free_org_sixth_assignment_blocked(self, db, org):
        from src.security.features_utils import usage

        await _set_plan(db, org.id, "free")
        # Bypass the Redis org-config cache so another test's config can't leak in
        no_cache = (
            patch("src.services.orgs.cache.get_cached_org_config", return_value=None),
            patch("src.services.orgs.cache.set_cached_org_config"),
        )
        for p in no_cache:
            p.start()
        with patch(
            "src.security.features_utils.resolve.get_deployment_mode", return_value="saas"
        ), patch.object(usage, "_get_actual_usage", AsyncMock(return_value=4)):
            assert await usage.check_limits_with_usage("assignments", org.id, db) is True
        with patch(
            "src.security.features_utils.resolve.get_deployment_mode", return_value="saas"
        ), patch.object(usage, "_get_actual_usage", AsyncMock(return_value=5)):
            with pytest.raises(HTTPException) as exc:
                await usage.check_limits_with_usage("assignments", org.id, db)
        for p in no_cache:
            p.stop()
        assert exc.value.status_code == 403


class TestFinalizeCourseLimit:
    @pytest.mark.asyncio
    async def test_finalize_respects_course_limit(self, db, org, admin_user, mock_request):
        from src.db.courses.courses import Course
        from src.routers.ai import courseplanning as cp
        from src.services.ai.schemas.courseplanning import (
            CoursePlan,
            CoursePlanningSessionData,
            FinalizeCoursePlanRequest,
        )

        session = MagicMock(spec=CoursePlanningSessionData)
        session.course_id = None
        session.org_id = org.id
        session.session_uuid = "s1"
        plan = CoursePlan(
            name="P", description="d", learnings="l", tags="t", chapters=[]
        )
        limits = AsyncMock(side_effect=HTTPException(status_code=403, detail="limit"))
        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "verify_user_org_membership", AsyncMock(return_value=True)), \
             patch.object(cp, "check_resource_access", AsyncMock()), \
             patch.object(cp, "check_limits_with_usage", limits):
            with pytest.raises(HTTPException) as exc:
                await cp.finalize_course_plan(
                    mock_request,
                    FinalizeCoursePlanRequest(session_uuid="s1", plan=plan),
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 403
        limits.assert_awaited_once_with("courses", org.id, db)
        assert (await db.execute(select(Course))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_finalize_increments_course_usage(self, db, org, admin_user, mock_request):
        from src.routers.ai import courseplanning as cp
        from src.services.ai.schemas.courseplanning import (
            CoursePlan,
            CoursePlanningSessionData,
            FinalizeCoursePlanRequest,
        )

        session = MagicMock(spec=CoursePlanningSessionData)
        session.course_id = None
        session.org_id = org.id
        session.session_uuid = "s2"
        plan = CoursePlan(
            name="P", description="d", learnings="l", tags="t", chapters=[]
        )
        increase = AsyncMock()
        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "save_course_planning_session"), \
             patch.object(cp, "verify_user_org_membership", AsyncMock(return_value=True)), \
             patch.object(cp, "check_resource_access", AsyncMock()), \
             patch.object(cp, "check_limits_with_usage", AsyncMock(return_value=True)), \
             patch.object(cp, "increase_feature_usage", increase):
            await cp.finalize_course_plan(
                mock_request,
                FinalizeCoursePlanRequest(session_uuid="s2", plan=plan),
                admin_user,
                db,
            )
        increase.assert_awaited_once_with("courses", org.id, db)
