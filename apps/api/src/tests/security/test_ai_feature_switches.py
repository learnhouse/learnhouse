"""Per-feature AI switches (Settings > AI): resolution, the metering gate that
enforces them on every model call, the settings service/routes, the RAG and
video entry points, and the org settings tool."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

import src.db.ai_usage  # noqa: F401  (registers the ledger table)
from src.core.events.database import get_db_session
from src.db.ai_usage import AIUsageEvent
from src.db.organization_config import AIAdminToggle, OrganizationConfig, OrganizationConfigV2Base
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_authenticated_user, get_current_user
from src.security.features_utils import ai_features as af
from src.security.features_utils.dependencies import require_org_admin
from src.services.ai import metering, pricing

pytestmark = pytest.mark.asyncio


def _v2(ai: dict | None = None, plan: str = "pro") -> dict:
    cfg = {"config_version": "2.0", "plan": plan, "admin_toggles": {}, "customization": {}}
    if ai is not None:
        cfg["admin_toggles"]["ai"] = ai
    return cfg


async def _config(db, org, config: dict) -> OrganizationConfig:
    row = OrganizationConfig(
        org_id=org.id, config=config, creation_date=str(datetime.now()), update_date=str(datetime.now())
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


# ── catalog and resolution ────────────────────────────────────────────────


async def test_every_charged_feature_has_a_switch():
    # rag_indexing is absorbed background work governed by the Ask AI index gate.
    unmapped = {k for k in pricing.FEATURES if af.ai_feature_for_pricing(k) is None}
    assert unmapped == {"rag_indexing"}
    assert set(af.AI_FEATURE_KEYS) == set(AIAdminToggle().features.model_dump())
    assert {f.group for f in af.AI_FEATURES} == set(af.AI_GROUPS)


async def test_defaults_keep_everything_on():
    for cfg in (None, {}, _v2(), _v2({"disabled": False}), {"config_version": "1.0", "features": {}}):
        assert all(af.ai_feature_switches(cfg).values())
    settings = af.resolve_ai_settings(_v2(), 1)
    assert settings["enabled"] and all(settings["features"].values())
    assert settings["ask_ai_staff_only"] is False and settings["monthly_credit_cap"] == 0


async def test_switches_v2_v1_and_copilot():
    cfg = _v2({"features": {"atlas": False, "voice": True}, "copilot_enabled": False})
    sw = af.ai_feature_switches(cfg)
    assert sw["atlas"] is False and sw["voice"] is True and sw["ask_ai"] is False
    v1 = {"config_version": "1.0", "features": {"ai": {"features": {"seo": False}}}}
    assert af.ai_feature_switches(v1)["seo"] is False
    # Master off: features all off, the admin's choices kept.
    off = af.resolve_ai_settings(_v2({"org_disabled": True, "features": {"seo": False}}), 1)
    assert off["enabled"] is False and off["disabled_by"] == "org"
    assert not any(off["features"].values()) and off["switches"]["atlas"] is True


async def test_monthly_cap_parsing():
    assert af.monthly_credit_cap(_v2({"monthly_credit_cap": 250})) == 250
    assert af.monthly_credit_cap(_v2({"monthly_credit_cap": "junk"})) == 0
    assert af.monthly_credit_cap(_v2({"monthly_credit_cap": -5})) == 0


async def test_block_and_error_shape():
    assert af.ai_feature_block(_v2(), 1, "atlas") is None
    off = af.ai_feature_block(_v2({"org_disabled": True}), 1, "atlas")
    assert off.detail["code"] == af.AI_DISABLED and off.status_code == 403
    assert af.ai_feature_block(_v2({"org_disabled": True}), 1, "atlas", include_master=False) is None
    feat = af.ai_feature_block(_v2({"features": {"atlas": False}}), 1, "atlas")
    assert feat.detail == {"code": "AI_FEATURE_DISABLED", "feature": "atlas",
                           "message": "Atlas is turned off by your organization's admin."}
    # The detail prints as its message (job errors store str(detail)).
    assert str(feat.detail) == "Atlas is turned off by your organization's admin."
    assert "staff" in af.AIFeatureOff(af.AI_STAFF_ONLY, "ask_ai").detail["message"]
    assert "cap" in af.AIFeatureOff(af.AI_MONTHLY_CAP_REACHED).detail["message"]
    assert af.AIFeatureOff(af.AI_FEATURE_DISABLED, None).detail["message"].startswith("This AI feature")
    assert af.AIFeatureOff("X", "atlas", message="custom").detail["message"] == "custom"


async def test_v2_schema_validates_new_fields():
    OrganizationConfigV2Base.model_validate(_v2({"features": {"atlas": False}, "monthly_credit_cap": 10}))
    with pytest.raises(Exception):
        OrganizationConfigV2Base.model_validate(_v2({"features": {"atlas": "nope"}}))
    with pytest.raises(Exception):
        OrganizationConfigV2Base.model_validate(_v2({"monthly_credit_cap": -1}))


# ── require_ai_feature / staff / cap ──────────────────────────────────────


async def test_require_feature(db, org, admin_user, regular_user):
    # No config row: left to the caller.
    await af.require_ai_feature("atlas", org.id, db)
    await _config(db, org, _v2({"features": {"atlas": False}, "ask_ai_staff_only": True}))
    with pytest.raises(af.AIFeatureOff) as e:
        await af.require_ai_feature("atlas", org.id, db)
    assert e.value.code == af.AI_FEATURE_DISABLED and e.value.feature == "atlas"
    await af.require_ai_feature("voice", org.id, db)
    # Staff-only Ask AI: admins pass, learners are refused, no user is not checked.
    await af.require_ai_feature("ask_ai", org.id, db, user_id=admin_user.id)
    await af.require_ai_feature("ask_ai", org.id, db)
    with pytest.raises(af.AIFeatureOff) as e:
        await af.require_ai_feature("ask_ai", org.id, db, user_id=regular_user.id)
    assert e.value.code == af.AI_STAFF_ONLY


async def test_is_org_staff(db, org, admin_user, regular_user):
    assert await af.is_org_staff(None, org.id, db) is False
    assert await af.is_org_staff(admin_user.id, org.id, db) is True
    assert await af.is_org_staff(regular_user.id, org.id, db) is False
    assert await af.is_org_staff(999, org.id, db) is False


async def test_credits_used_this_month(db, org):
    now = datetime.now(timezone.utc)
    for credits, when in ((5, now), (7, now), (100, now.replace(day=1) - timedelta(days=2))):
        db.add(AIUsageEvent(org_id=org.id, feature="ask_ai", credits=credits, charge_key=f"k{credits}", created_at=when))
    await db.commit()
    assert await af.credits_used_this_month(org.id, db) == 12


async def test_gate_metered_call(db, org, regular_user):
    # Unreadable config / no row / unmapped feature: nothing to enforce here.
    broken = MagicMock()
    broken.execute = AsyncMock(side_effect=RuntimeError("down"))
    broken.sync_session = None
    await af.gate_metered_call("atlas_chat", org.id, broken)
    await af.gate_metered_call("atlas_chat", org.id, db)
    await _config(db, org, _v2({"features": {"atlas": False}, "monthly_credit_cap": 10, "org_disabled": False}))
    await af.gate_metered_call("rag_indexing", org.id, db)
    with pytest.raises(af.AIFeatureOff):
        await af.gate_metered_call("atlas_chat", org.id, db)
    # Under the cap passes, over it is refused; a zero amount is never capped.
    await af.gate_metered_call("magic_block", org.id, db, amount=3)
    db.add(AIUsageEvent(org_id=org.id, feature="magic_block", credits=9, charge_key="cap"))
    await db.commit()
    with pytest.raises(af.AIFeatureOff) as e:
        await af.gate_metered_call("magic_block", org.id, db, amount=3)
    assert e.value.code == af.AI_MONTHLY_CAP_REACHED
    await af.gate_metered_call("magic_block", org.id, db, amount=0)


async def test_master_switch_is_left_to_the_reservation(db, org):
    # The gate checks the feature switch only; reserve_ai_credit answers for AI off.
    await _config(db, org, _v2({"org_disabled": True}))
    await af.gate_metered_call("atlas_chat", org.id, db)


async def test_metering_start_refuses_a_disabled_feature(db, org, ai_credit_spy):
    await _config(db, org, _v2({"features": {"magic_blocks": False}}))
    with pytest.raises(HTTPException) as e:
        async with metering.charge("magic_block", org_id=org.id, db=db):
            pass  # pragma: no cover - refused before the body runs
    assert e.value.status_code == 403 and e.value.detail["feature"] == "magic_blocks"
    assert ai_credit_spy.reserved == []
    async with metering.charge("quiz_generation", org_id=org.id, db=db) as meter:
        assert meter.feature == "quiz_generation"
    assert ai_credit_spy.reserved


# ── settings service ──────────────────────────────────────────────────────


@pytest.fixture
def quiet():
    with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock), \
         patch("src.services.orgs.orgs.dispatch_webhooks", new_callable=AsyncMock) as hooks, \
         patch("src.services.orgs.cache.invalidate_org_cache"):
        yield hooks


async def _stored(db, org) -> dict:
    row = (await db.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org.id).execution_options(populate_existing=True)
    )).scalars().first()
    return row.config


async def test_update_settings_v2(db, org, admin_user, mock_request, quiet):
    from src.services.orgs.orgs import update_org_ai_settings

    await _config(db, org, _v2({"disabled": True, "features": {"seo": False}}))
    out = await update_org_ai_settings(
        mock_request, org.id, admin_user, db,
        ai_enabled=True, features={"atlas": False, "ask_ai": False}, ask_ai_staff_only=True, monthly_credit_cap=500,
    )
    ai = (await _stored(db, org))["admin_toggles"]["ai"]
    assert ai["features"] == {"seo": False, "atlas": False, "ask_ai": False}
    assert ai["copilot_enabled"] is False and ai["disabled"] is False and ai["org_disabled"] is False
    assert ai["ask_ai_staff_only"] is True and ai["monthly_credit_cap"] == 500
    assert out["switches"]["atlas"] is False and out["features"]["voice"] is True
    quiet.assert_awaited()

    out = await update_org_ai_settings(mock_request, org.id, admin_user, db, ai_enabled=False)
    ai = (await _stored(db, org))["admin_toggles"]["ai"]
    assert ai["org_disabled"] is True and out["enabled"] is False
    # Nothing passed: nothing changes (still a valid call).
    await update_org_ai_settings(mock_request, org.id, admin_user, db)


async def test_update_settings_v1(db, org, admin_user, mock_request, quiet):
    from src.services.orgs.orgs import update_org_ai_settings

    await _config(db, org, {"config_version": "1.0", "features": {}})
    await update_org_ai_settings(mock_request, org.id, admin_user, db, ai_enabled=False, features={"voice": False})
    ai = (await _stored(db, org))["features"]["ai"]
    assert ai["enabled"] is False and ai["features"] == {"voice": False}


async def test_update_settings_validation(db, org, admin_user, mock_request, quiet):
    from src.services.orgs.orgs import update_org_ai_settings

    for kwargs, msg in (
        ({"features": {"nope": True}}, "Unknown AI feature"),
        ({"features": {"atlas": "yes"}}, "true or false"),
        ({"monthly_credit_cap": -1}, "monthly credit cap"),
        ({"monthly_credit_cap": af.MAX_MONTHLY_CREDIT_CAP + 1}, "monthly credit cap"),
    ):
        with pytest.raises(HTTPException) as e:
            await update_org_ai_settings(mock_request, org.id, admin_user, db, **kwargs)
        assert e.value.status_code == 400 and msg in e.value.detail
    with pytest.raises(HTTPException) as e:
        await update_org_ai_settings(mock_request, 999, admin_user, db)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        await update_org_ai_settings(mock_request, org.id, admin_user, db)
    assert e.value.detail == "Organization config not found"


async def test_legacy_endpoint_writes_the_orgs_own_switch(db, org, admin_user, mock_request, quiet):
    from src.services.orgs.orgs import update_org_ai_config

    await _config(db, org, _v2({"features": {"ask_ai": True}}))
    await update_org_ai_config(mock_request, False, org.id, admin_user, db, copilot_enabled=False)
    ai = (await _stored(db, org))["admin_toggles"]["ai"]
    assert ai["org_disabled"] is True and ai.get("disabled") is not True
    assert ai["copilot_enabled"] is False and ai["features"]["ask_ai"] is False
    # Honoured on a paid plan too (the platform switch would not be).
    assert af.resolve_ai_settings(await _stored(db, org), org.id)["enabled"] is False


async def test_org_read_carries_only_public_ai_state(db, org):
    from src.services.orgs.orgs import _build_org_read_with_resolved

    row = await _config(db, org, _v2({"features": {"atlas": False}, "monthly_credit_cap": 900, "ask_ai_staff_only": True}))
    cfg = _build_org_read_with_resolved(org, row).config.config
    assert cfg["resolved_ai"] == {
        "enabled": True,
        "features": {**{k: True for k in af.AI_FEATURE_KEYS}, "atlas": False},
        "ask_ai_staff_only": True,
    }
    # The public org payload never carries the cap; the stored row keeps it.
    assert "monthly_credit_cap" not in cfg["admin_toggles"]["ai"]
    assert row.config["admin_toggles"]["ai"]["monthly_credit_cap"] == 900
    plain = await _build_without_cap(db, org)
    assert "resolved_ai" in plain


async def _build_without_cap(db, org):
    from src.services.orgs.orgs import _build_org_read_with_resolved

    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
    row.config = _v2({"features": {}})
    return _build_org_read_with_resolved(org, row).config.config


# ── routes ────────────────────────────────────────────────────────────────


@pytest.fixture
async def client(db, admin_user):
    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    app.dependency_overrides[require_org_admin] = lambda: True
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_settings_routes(client, db, org, quiet):
    assert (await client.get("/api/v1/orgs/1/config/ai/settings")).status_code == 404
    await _config(db, org, _v2())
    r = await client.get("/api/v1/orgs/1/config/ai/settings")
    body = r.json()
    assert r.status_code == 200 and body["enabled"] is True
    assert {c["key"] for c in body["catalog"]} == set(af.AI_FEATURE_KEYS)
    r = await client.put("/api/v1/orgs/1/config/ai/settings", json={"features": {"voice": False}, "monthly_credit_cap": 42})
    assert r.status_code == 200 and r.json()["switches"]["voice"] is False and r.json()["monthly_credit_cap"] == 42
    assert (await client.put("/api/v1/orgs/1/config/ai/settings", json={"bogus": 1})).status_code == 422
    assert (await client.put("/api/v1/orgs/1/config/ai/settings", json={"monthly_credit_cap": -1})).status_code == 422


def _app(db, user):
    from src.db.users import AnonymousUser

    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user or AnonymousUser()
    return app


async def _settings_status(db, user, method="GET"):
    with patch("src.security.backoffice.is_user_backoffice_staff", new=AsyncMock(return_value=False)):
        async with AsyncClient(transport=ASGITransport(app=_app(db, user)), base_url="http://test") as c:
            if method == "GET":
                return await c.get("/api/v1/orgs/1/config/ai/settings")
            return await c.put("/api/v1/orgs/1/config/ai/settings", json={"features": {"atlas": False}})


async def test_settings_routes_auth(db, org, other_org, admin_user, regular_user, quiet):
    from src.db.user_organizations import UserOrganization
    from src.db.users import User

    await _config(db, org, _v2({"monthly_credit_cap": 300}))
    outsider = User(id=9, username="out", first_name="O", last_name="X", email="out@x.com",
                    user_uuid="user_out", creation_date=str(datetime.now()), update_date=str(datetime.now()))
    db.add(outsider)
    db.add(UserOrganization(user_id=9, org_id=other_org.id, role_id=1,
                            creation_date=str(datetime.now()), update_date=str(datetime.now())))
    await db.commit()

    # Anonymous: 401. Another org's admin and a plain member: 403.
    assert (await _settings_status(db, None)).status_code == 401
    assert (await _settings_status(db, outsider)).status_code == 403
    assert (await _settings_status(db, regular_user)).status_code == 403
    assert (await _settings_status(db, regular_user, "PUT")).status_code == 403
    # The org's admin gets the full settings, cap included.
    full = await _settings_status(db, admin_user)
    assert full.status_code == 200 and full.json()["monthly_credit_cap"] == 300 and "switches" in full.json()
    # Members read only the booleans, through the org payload.
    from src.services.orgs.orgs import _build_org_read_with_resolved

    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
    public = _build_org_read_with_resolved(org, row).config.config["resolved_ai"]
    assert set(public) == {"enabled", "features", "ask_ai_staff_only"}


# ── entry points ──────────────────────────────────────────────────────────


async def test_rag_gate_follows_the_ask_ai_switch():
    from src.services.ai.rag.gating import ai_block_reason

    assert ai_block_reason(_v2({"features": {"ask_ai": False}}), 1) == "Copilot is disabled for this organization"
    assert ai_block_reason(_v2(), 1) is None


async def test_video_ai_switch_blocks_caption_and_chapter_jobs(monkeypatch, db, org, course):
    from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
    from src.services.courses.activities import video as video_mod
    import src.security.features_utils.usage as usage

    db.add(Activity(
        name="V", activity_type=ActivityTypeEnum.TYPE_VIDEO, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": "v.mp4"}, published=True, org_id=org.id, course_id=course.id, activity_uuid="vidai",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    await _config(db, org, _v2({"features": {"video_ai": False}}))
    monkeypatch.setattr(video_mod, "check_resource_access", AsyncMock(return_value=True))
    monkeypatch.setattr(usage, "check_feature_enabled", AsyncMock(return_value=True))
    import src.services.utils.chapter_jobs as chapter_jobs
    monkeypatch.setattr(chapter_jobs, "pick_caption_language", lambda captions: "en")
    cfg = video_mod.CaptionsConfigIn(enabled=True, languages=[video_mod.CaptionLanguageIn(code="fr")])
    with pytest.raises(af.AIFeatureOff):
        await video_mod.configure_captions(None, "vidai", None, db, cfg)
    with pytest.raises(af.AIFeatureOff):
        await video_mod.request_chapters_generation(None, "vidai", None, db)


async def test_org_tool_reads_and_writes_ai_settings(db, org, admin_user, mock_request, quiet):
    from src.services.ai.tools import org as org_tools

    await _config(db, org, _v2({"features": {"voice": False}, "monthly_credit_cap": 7}))
    state = org_tools._ai_state(await _stored(db, org), org.id)
    assert state["features"]["content"]["voice"] is False and state["monthly_credit_cap"] == 7
    assert state["copilot_enabled"] is True

    ctx = SimpleNamespace(org=SimpleNamespace(id=org.id), user=admin_user, db_session=db, request=mock_request)
    params = org_tools.AiSettings(section="ai", copilot_enabled=False, features={"atlas": False}, monthly_credit_cap=0)
    assert await org_tools._apply_settings(ctx, params) == ["copilot_enabled", "features", "monthly_credit_cap"]
    ai = (await _stored(db, org))["admin_toggles"]["ai"]
    assert ai["features"]["atlas"] is False and ai["copilot_enabled"] is False and ai["monthly_credit_cap"] == 0
    with pytest.raises(Exception):
        org_tools.AiSettings(section="ai", features={"nope": True})
