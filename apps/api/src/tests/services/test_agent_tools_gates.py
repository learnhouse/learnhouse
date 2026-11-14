"""Plan-feature, read-only and surface gates in the tool pipeline, plus the
registry's descriptive fields and the orientation tools."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import BaseModel

from src.db.organization_config import OrganizationConfig
from src.security.rbac import AccessAction
from src.services.ai.tools import (
    TOOLSETS,
    ActionTier,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    build_registry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import registry as reg


class _P(BaseModel):
    pass


async def _ok(ctx, params):
    return {"ok": True}


def _spec(name, tier=ActionTier.READ, **kw):
    return ToolSpec(name=name, description=name, params_model=_P, tier=tier, rights_bucket=None, access_action=AccessAction.READ, execute=_ok, **kw)


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all([_spec("read"), _spec("write", ActionTier.EDIT), _spec("boards", feature="boards")])
    return r


def ctx(db, org, user, **kw):
    return ToolContext(request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug, mode="execute", **kw)


async def _config(db, org, config):
    db.add(OrganizationConfig(org_id=org.id, config=config, creation_date="", update_date=""))
    await db.commit()


async def test_read_only_blocks_writes(db, org, admin_user, registry):
    out = await run_tool(registry, "write", {}, ctx(db, org, admin_user, read_only=True, surface="mcp"))
    assert out.denied_code == "insufficient_scope"
    assert (await run_tool(registry, "read", {}, ctx(db, org, admin_user, read_only=True, surface="mcp"))).status == "executed"


async def test_allowed_tiers_refuse_other_tiers(db, org, admin_user, registry):
    c = ctx(db, org, admin_user, surface="mcp", allowed_tiers=frozenset({"read"}))
    out = await run_tool(registry, "write", {}, c)
    assert out.denied_code == "tier_not_allowed" and "edit" in out.reason
    assert (await run_tool(registry, "read", {}, c)).status == "executed"


async def test_mcp_surface_ignores_the_ai_switch(db, org, admin_user, registry):
    await _config(db, org, {"config_version": "2.0", "admin_toggles": {"ai": {"disabled": True}}})
    with patch.object(reg, "resolve_feature", return_value={"enabled": False}):
        assert (await run_tool(registry, "read", {}, ctx(db, org, admin_user, surface="mcp"))).status == "executed"
        assert (await run_tool(registry, "read", {}, ctx(db, org, admin_user))).denied_code == "ai_disabled"


async def test_feature_gate_messages(db, org, admin_user, registry):
    await _config(db, org, {"config_version": "2.0", "plan": "free"})
    c = ctx(db, org, admin_user, surface="mcp")
    with patch.object(reg, "resolve_feature", return_value={"enabled": False, "available": False, "required_plan": "personal"}), \
         patch("src.security.features_utils.plans.plan_meets_requirement", return_value=False):
        out = await run_tool(registry, "boards", {}, c)
    assert out.denied_code == "feature_unavailable" and "available from the personal plan" in out.reason
    with patch.object(reg, "resolve_feature", return_value={"enabled": False, "available": True}):
        out = await run_tool(registry, "boards", {}, c)
    assert "turned off" in out.reason
    with patch.object(reg, "resolve_feature", return_value={"enabled": True}):
        assert (await run_tool(registry, "boards", {}, c)).status == "executed"


def test_feature_denial_wording():
    state = {"available": False, "required_plan": "personal"}
    with patch("src.security.features_utils.plans.plan_meets_requirement", return_value=True):
        assert "organization's standard plan" in reg._feature_denial("boards", state, {"config_version": "2.0", "plan": "standard"})
    with patch("src.security.features_utils.plans.plan_meets_requirement", return_value=False):
        assert "in the free plan" in reg._feature_denial("boards", state, {"cloud": {"plan": "free"}})
    assert "turned off" in reg._feature_denial("boards", None, {})


async def test_feature_gate_fails_closed_without_config(db, org, admin_user, registry):
    with patch.object(reg, "_org_config", new_callable=AsyncMock, return_value=None):
        out = await run_tool(registry, "boards", {}, ctx(db, org, admin_user, surface="mcp"))
    assert out.denied_code == "feature_unavailable"


async def test_org_config_read_failure(db, org, admin_user):
    broken = SimpleNamespace(execute=AsyncMock(side_effect=RuntimeError("db down")))
    assert await reg._org_config(SimpleNamespace(db_session=broken, org=org)) is None
    assert await reg._ai_enabled_for_org(SimpleNamespace(db_session=broken, org=org)) is False


def test_tool_available():
    spec = _spec("boards", feature="boards")
    with patch.object(reg, "resolve_feature", return_value={"enabled": True}):
        assert reg.tool_available(spec, {}, 1, read_only=False)
    assert not reg.tool_available(_spec("w", ActionTier.EDIT), {}, 1, read_only=True)
    assert not reg.tool_available(_spec("a", ActionTier.EDIT, access="admin"), {}, 1, read_only=False, can_admin=False)
    assert reg.tool_available(_spec("a", ActionTier.EDIT, access="admin"), {}, 1, read_only=False)
    assert reg.feature_state(_spec("plain"), {}, 1) is None


def test_built_registry_fields():
    registry = build_registry()
    specs = {s.name: s for s in registry.specs()}
    assert specs["create_community"].feature == "communities"
    assert specs["get_learner_progress"].feature is None
    assert specs["list_courses"].toolset == "courses"
    assert specs["get_context"].toolset == "core" and specs["get_course"].toolset == "core"
    assert specs["add_media_block"].open_world is True
    assert specs["list_courses"].title == "List courses"
    assert {s.toolset for s in specs.values()} <= set(TOOLSETS)
