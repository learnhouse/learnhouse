"""Settings → Plan & usage: GET /orgs/{id}/plan-overview.

Permissions (admins and maintainers of that org only), the feature matrix for
every plan (computed from plans.py, never a UI list), proof-of-concept and
trial states from the EE platform hook, and the self-hosted paths.
"""

from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.users import PublicUser
from src.routers.orgs.plan_overview import router as plan_overview_router
from src.security.auth import get_current_user
from src.security.features_utils.plans import (
    PLAN_FEATURE_CONFIGS,
    PLAN_HIERARCHY,
    get_upgrade_candidates,
    get_upgrade_plan,
)
from src.security.features_utils.resolve import ALL_FEATURES, ALWAYS_ON_FEATURES
from src.services.orgs import plan_overview as po

URL = "/api/v1/orgs/{}/plan-overview"


@contextmanager
def mode(value: str):
    """Deployment mode for both the service and the resolver (which binds it at import)."""
    with patch("src.core.deployment_mode.get_deployment_mode", return_value=value), patch(
        "src.security.features_utils.resolve.get_deployment_mode", return_value=value
    ):
        yield


@contextmanager
def ee_hook(result=None, exc: Exception | None = None):
    hook = AsyncMock(return_value=result or {}, side_effect=exc)
    with patch("src.services.orgs.plan_overview.get_ee_hooks", return_value=SimpleNamespace(plan_overview_extras=hook)):
        yield hook


async def set_config(db, org_id: int, config: dict):
    db.add(OrganizationConfig(org_id=org_id, config=config, creation_date=str(datetime.now()), update_date=str(datetime.now())))
    await db.commit()


def by_key(payload: dict) -> dict:
    return {f["key"]: f for f in payload["features"]}


@pytest.fixture
def make_app(db):
    def build(user):
        app = FastAPI()
        app.include_router(plan_overview_router, prefix="/api/v1/orgs")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user
        return app

    return build


async def get(app, org_id: int):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(URL.format(org_id))


# ── permissions ──────────────────────────────────────────────────────────


class TestPermissions:
    async def test_admin_reads_own_org(self, make_app, admin_user, org, db):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        res = await get(make_app(admin_user), org.id)
        assert res.status_code == 200
        assert res.json()["org_id"] == org.id

    async def test_learner_is_denied(self, make_app, regular_user, org):
        res = await get(make_app(regular_user), org.id)
        assert res.status_code == 403

    async def test_admin_of_one_org_cannot_read_another(self, make_app, admin_user, org, other_org, db):
        await set_config(db, other_org.id, {"config_version": "2.0", "plan": "pro"})
        res = await get(make_app(admin_user), other_org.id)
        assert res.status_code == 403

    async def test_stranger_is_denied(self, make_app, org):
        stranger = PublicUser(id=99, username="x", first_name="x", last_name="x", email="x@x.x", user_uuid="user_x")
        res = await get(make_app(stranger), org.id)
        assert res.status_code == 403

    async def test_missing_org_is_404(self, make_app, admin_user):
        with patch("src.routers.orgs.plan_overview.require_org_admin", new=AsyncMock()):
            res = await get(make_app(admin_user), 4242)
        assert res.status_code == 404


# ── plan × feature matrix (SaaS) ─────────────────────────────────────────


def expected_has(plan: str, key: str) -> bool:
    cfg = PLAN_FEATURE_CONFIGS[plan]
    if key == "custom_domain":
        return cfg["cloud"]["custom_domain"]
    if key == "remove_watermark":
        return not cfg["general"]["watermark"]
    return key in ALWAYS_ON_FEATURES or cfg["features"].get(key, {}).get("enabled", False)


class TestFeatureMatrix:
    def test_areas_cover_every_feature(self):
        on_page = {k for keys in po.FEATURE_AREAS.values() for k in keys}
        assert on_page - set(po.PLAN_PERKS) == (set(ALL_FEATURES) - {"members"}) | {"webhooks"}
        flat = [k for keys in po.FEATURE_AREAS.values() for k in keys]
        assert len(flat) == len(set(flat))

    @pytest.mark.parametrize("plan", PLAN_HIERARCHY)
    async def test_every_plan_matches_plans_py(self, db, org, plan):
        await set_config(db, org.id, {"config_version": "2.0", "plan": plan})
        with mode("saas"):
            data = await po.get_plan_overview(org.id, db)
        assert data["plan"] == plan and data["mode"] == "saas"
        for f in data["features"]:
            if expected_has(plan, f["key"]):
                assert f["state"] == "included", (plan, f["key"])
                assert f["upgrade_plan"] is None
            else:
                assert f["state"] == "locked", (plan, f["key"])
                upgrade = f["upgrade_plan"]
                if f["key"] in po.PLAN_PERKS:
                    assert upgrade is None or expected_has(upgrade, f["key"])
                else:
                    assert upgrade == get_upgrade_plan(plan, f["key"])
                assert f["limit"] == 0
        candidates = get_upgrade_candidates(plan)
        assert data["next_plan"] == (candidates[0] if candidates else None)

    async def test_free_plan_spot_checks(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "free"})
        with mode("saas"):
            data = await po.get_plan_overview(org.id, db)
        f = by_key(data)
        assert data["status"] == "free" and data["billing"] == "none" and data["next_plan"] == "standard"
        assert f["courses"]["state"] == "included" and f["courses"]["limit"] == 1
        assert f["payments"]["upgrade_plan"] == "standard"
        assert f["boards"]["upgrade_plan"] == "pro"
        assert f["sso"]["upgrade_plan"] == "enterprise"
        assert f["remove_watermark"]["upgrade_plan"] == "standard"
        assert f["custom_domain"]["upgrade_plan"] == "pro"
        assert f["podcasts"]["toggle_tab"] == "features" and f["ai"]["toggle_tab"] == "ai" and f["sso"]["toggle_tab"] is None
        assert data["areas"] == list(po.FEATURE_AREAS)

    async def test_paid_and_contract_billing(self, db, org, other_org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "pro"})
        await set_config(db, other_org.id, {"config_version": "1.0", "cloud": {"plan": "enterprise"}})
        with mode("saas"):
            pro = await po.get_plan_overview(org.id, db)
            ent = await po.get_plan_overview(other_org.id, db)
        assert (pro["status"], pro["billing"], pro["next_plan"]) == ("active", "stripe", "enterprise")
        assert by_key(pro)["newsletter"]["limit"] == 50000
        assert (ent["plan"], ent["billing"], ent["next_plan"]) == ("enterprise", "contract", None)
        assert all(f["state"] == "included" for f in ent["features"])

    async def test_addon_and_toggles(self, db, org):
        await set_config(db, org.id, {
            "config_version": "2.0", "plan": "standard",
            "overrides": {"sso": {"force_enabled": True}},
            "admin_toggles": {"podcasts": {"org_disabled": True}},
        })
        with mode("saas"):
            f = by_key(await po.get_plan_overview(org.id, db))
        assert f["sso"]["state"] == "addon" and f["sso"]["enabled"] is True
        assert f["podcasts"]["state"] == "included"
        assert (f["podcasts"]["enabled"], f["podcasts"]["disabled_by"]) == (False, "org")

    async def test_platform_kill_switch_on_free(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "free", "admin_toggles": {"messaging": {"disabled": True}}})
        with mode("saas"):
            f = by_key(await po.get_plan_overview(org.id, db))
        assert (f["messaging"]["enabled"], f["messaging"]["disabled_by"]) == (False, "platform")

    async def test_unknown_plan_and_missing_config(self, db, org, other_org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "legacy"})
        with mode("saas"):
            legacy = await po.get_plan_overview(org.id, db)
            bare = await po.get_plan_overview(other_org.id, db)
        assert legacy["plan"] == "legacy" and legacy["next_plan"] is None
        assert bare["plan"] == "free" and bare["status"] == "free"

    async def test_missing_org(self, db):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            await po.get_plan_overview(777, db)
        assert e.value.status_code == 404


# ── proof of concept, trial, suspended (EE platform hook) ────────────────


POC = {
    "state": "active", "plan": "pro", "returns_to": "free", "started_at": "2026-11-01T00:00:00+00:00",
    "ends_at": "2026-12-01T00:00:00+00:00", "days_left": 18, "total_days": 30, "extended": False,
    "outcome": None, "ended_at": None, "contact": {"name": "Sam"},
}


class TestPlatformStates:
    async def test_active_poc_marks_what_it_unlocks(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "pro"})
        extras = {"lifecycle": "poc", "poc": POC, "usage": {"newsletter_emails": 120}}
        with mode("saas"), ee_hook(extras) as hook:
            data = await po.get_plan_overview(org.id, db)
        hook.assert_awaited_once()
        assert hook.await_args.kwargs == {"mode": "saas", "newsletter": True}
        f = by_key(data)
        assert data["status"] == "poc" and data["billing"] == "none"
        assert f["boards"]["state"] == "poc"            # pro has it, free doesn't
        assert f["courses"]["state"] == "included"      # always on
        assert f["messaging"]["state"] == "included"    # free has it too
        assert f["sso"]["state"] == "locked"            # not even in pro
        assert data["poc"]["unlocks"] == [k for k, v in f.items() if v["state"] == "poc"]
        assert "remove_watermark" in data["poc"]["unlocks"] and "custom_domain" in data["poc"]["unlocks"]
        assert data["usage"] == {"newsletter_emails": {"usage": 120, "limit": 50000}}

    async def test_ended_poc_unlocks_nothing(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "free"})
        ended = {**POC, "state": "ended", "outcome": "expired", "days_left": None, "ended_at": "2026-11-10T00:00:00+00:00"}
        with mode("saas"), ee_hook({"lifecycle": None, "poc": ended}):
            data = await po.get_plan_overview(org.id, db)
        assert data["status"] == "free"
        assert data["poc"]["unlocks"] == [] and data["poc"]["state"] == "ended"
        assert not any(f["state"] == "poc" for f in data["features"])
        assert data["usage"] == {}

    @pytest.mark.parametrize("lifecycle,plan,status,billing", [
        ("trial", "standard", "trial", "none"),
        ("suspended", "pro", "suspended", "stripe"),
        ("closed", "pro", "active", "stripe"),
    ])
    async def test_lifecycles(self, db, org, lifecycle, plan, status, billing):
        await set_config(db, org.id, {"config_version": "2.0", "plan": plan})
        with mode("saas"), ee_hook({"lifecycle": lifecycle}):
            data = await po.get_plan_overview(org.id, db)
        assert (data["status"], data["billing"]) == (status, billing)

    async def test_hook_failure_keeps_the_page(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "pro"})
        with mode("saas"), ee_hook(exc=RuntimeError("boom")):
            data = await po.get_plan_overview(org.id, db)
        assert data["poc"] is None and data["status"] == "active" and data["usage"] == {}

    async def test_hooks_without_the_function(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "pro"})
        with mode("saas"), patch("src.services.orgs.plan_overview.get_ee_hooks", return_value=SimpleNamespace()):
            data = await po.get_plan_overview(org.id, db)
        assert data["poc"] is None and data["license"] is None


# ── self-hosted ──────────────────────────────────────────────────────────


class TestSelfHosted:
    async def test_community_edition(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "free"})
        with mode("oss"):
            data = await po.get_plan_overview(org.id, db)
        f = by_key(data)
        assert (data["plan"], data["status"], data["billing"], data["next_plan"]) == ("oss", "community", "none", None)
        assert data["poc"] is None and data["license"] is None
        assert f["sso"]["state"] == "edition" and f["sso"]["upgrade_plan"] is None
        assert f["boards"]["state"] == "edition"
        assert f["podcasts"]["state"] == "included" and f["podcasts"]["limit"] == 0
        assert f["custom_domain"]["state"] == "included" and f["remove_watermark"]["state"] == "included"
        assert f["courses"]["limit"] == 0

    async def test_enterprise_edition_with_license(self, db, org):
        await set_config(db, org.id, {"config_version": "2.0", "plan": "free"})
        lic = {"active": True, "tier": "enterprise", "expires_at": 1893456000, "reason": None}
        with mode("ee"), ee_hook({"license": lic, "usage": {"newsletter_emails": 3}}) as hook:
            data = await po.get_plan_overview(org.id, db)
        assert hook.await_args.kwargs["mode"] == "ee"
        assert (data["plan"], data["status"], data["billing"]) == ("enterprise", "licensed", "none")
        assert data["license"] == lic
        assert all(f["state"] == "included" for f in data["features"])
        assert data["usage"]["newsletter_emails"] == {"usage": 3, "limit": "unlimited"}
