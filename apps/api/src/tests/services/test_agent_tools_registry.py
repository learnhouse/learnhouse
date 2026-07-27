"""Enforcement-pipeline tests for the agent tool registry.

Covers `src/services/ai/tools/registry.py::run_tool`: argument validation,
the org AI kill switch, principal gates (membership / token org scope),
API-token bucket rights, resource RBAC pre-flight, and the permission-mode
matrix (tier × mode) including the admin-only autonomous downgrade.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from src.db.organization_config import OrganizationConfig
from src.db.users import APITokenUser, PublicUser
from src.security.rbac import AccessAction
from src.services.ai.tools import (
    ActionTier,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    make_synthetic_request,
    run_tool,
)


class _EchoParams(BaseModel):
    value: str = "x"
    confirm: bool | None = None


class _TargetParams(BaseModel):
    course_uuid: str
    name: str | None = None


async def _echo(ctx, params):
    return {"ok": True, "value": getattr(params, "value", None)}


async def _boom(ctx, params):
    raise HTTPException(status_code=403, detail="service said no")


def _spec(name, tier, *, bucket="courses", action=AccessAction.READ, execute=_echo, **kw):
    return ToolSpec(
        name=name,
        description=f"{name} test tool",
        params_model=kw.pop("params_model", _EchoParams),
        tier=tier,
        rights_bucket=bucket,
        access_action=action,
        execute=execute,
        **kw,
    )


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(
        [
            _spec("t_read", ActionTier.READ),
            _spec("t_create", ActionTier.CREATE, action=AccessAction.CREATE),
            _spec("t_edit", ActionTier.EDIT, action=AccessAction.UPDATE),
            _spec(
                "t_destroy",
                ActionTier.DESTRUCTIVE,
                action=AccessAction.DELETE,
            ),
            _spec("t_boom", ActionTier.READ, execute=_boom),
            _spec(
                "t_edit_course",
                ActionTier.EDIT,
                action=AccessAction.UPDATE,
                params_model=_TargetParams,
                target_param="course_uuid",
                target_kind="course",
            ),
        ]
    )
    return r


def _ctx(db, org, user, mode="confirm"):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode=mode,
        scope_key="chat_test",
    )


def _token(org_id, rights):
    return APITokenUser(
        id=0,
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org_id,
        rights=rights,
        created_by_user_id=1,
    )


_FULL_COURSES_RIGHT = {
    "courses": {
        "action_create": True,
        "action_read": True,
        "action_update": True,
        "action_delete": True,
    }
}


# ─── basic validation ──────────────────────────────────────────────────────


async def test_unknown_tool_denied(registry, db, org, admin_user):
    out = await run_tool(registry, "nope", {}, _ctx(db, org, admin_user))
    assert out.status == "denied"
    assert out.denied_code == "unknown_tool"


async def test_invalid_args_denied(registry, db, org, admin_user):
    out = await run_tool(
        registry, "t_read", {"value": {"not": "a-string"}}, _ctx(db, org, admin_user)
    )
    assert out.status == "denied"
    assert out.denied_code == "invalid_args"
    assert "value" in (out.reason or "")


# ─── org AI kill switch ────────────────────────────────────────────────────


async def test_ai_admin_toggle_disables_all_tools(registry, db, org, admin_user):
    db.add(
        OrganizationConfig(
            org_id=org.id,
            config={
                "config_version": "2.0",
                "admin_toggles": {"ai": {"disabled": True}},
            },
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    out = await run_tool(registry, "t_read", {}, _ctx(db, org, admin_user))
    assert out.status == "denied"
    assert out.denied_code == "ai_disabled"


async def test_no_org_config_defaults_to_enabled(registry, db, org, admin_user):
    out = await run_tool(registry, "t_read", {}, _ctx(db, org, admin_user))
    assert out.status == "executed"
    assert out.result == {"ok": True, "value": "x"}


# ─── principal gates ───────────────────────────────────────────────────────


async def test_anonymous_denied(registry, db, org, anonymous_user):
    out = await run_tool(registry, "t_read", {}, _ctx(db, org, anonymous_user))
    assert out.status == "denied"
    assert out.denied_code == "unauthenticated"


async def test_non_member_denied(registry, db, org, admin_user):
    stranger = PublicUser(
        id=99,
        username="stranger",
        first_name="S",
        last_name="T",
        email="s@t.com",
        user_uuid="user_stranger",
    )
    out = await run_tool(registry, "t_read", {}, _ctx(db, org, stranger))
    assert out.status == "denied"
    assert out.denied_code == "not_a_member"


async def test_token_wrong_org_denied(registry, db, org):
    token = _token(org_id=org.id + 1, rights=_FULL_COURSES_RIGHT)
    out = await run_tool(registry, "t_read", {}, _ctx(db, org, token, mode="execute"))
    assert out.status == "denied"
    assert out.denied_code == "org_mismatch"


# ─── API-token bucket rights ───────────────────────────────────────────────


async def test_token_missing_bucket_right_denied(registry, db, org):
    token = _token(org_id=org.id, rights={"courses": {"action_read": True}})
    out = await run_tool(
        registry, "t_create", {}, _ctx(db, org, token, mode="execute")
    )
    assert out.status == "denied"
    assert out.denied_code == "missing_right"


async def test_token_no_rights_denied(registry, db, org):
    token = _token(org_id=org.id, rights=None)
    out = await run_tool(registry, "t_read", {}, _ctx(db, org, token, mode="execute"))
    assert out.status == "denied"
    assert out.denied_code == "missing_right"


async def test_token_with_right_executes(registry, db, org):
    token = _token(org_id=org.id, rights=_FULL_COURSES_RIGHT)
    out = await run_tool(
        registry, "t_create", {}, _ctx(db, org, token, mode="execute")
    )
    assert out.status == "executed"


# ─── resource RBAC pre-flight ──────────────────────────────────────────────


async def test_rbac_preflight_denies_readonly_member_update(
    registry, db, org, regular_user, course
):
    out = await run_tool(
        registry,
        "t_edit_course",
        {"course_uuid": course.course_uuid},
        _ctx(db, org, regular_user, mode="autonomous"),
    )
    assert out.status in ("denied", "proposed")
    # Read-only role: must never reach execution. Non-admins are downgraded
    # to confirm mode, but the RBAC pre-flight runs first and denies.
    assert out.status == "denied"
    assert out.denied_code == "rbac_denied"


async def test_rbac_preflight_allows_admin_update(
    registry, db, org, admin_user, course
):
    out = await run_tool(
        registry,
        "t_edit_course",
        {"course_uuid": course.course_uuid},
        _ctx(db, org, admin_user, mode="autonomous"),
    )
    assert out.status == "executed"


# ─── permission-mode matrix ────────────────────────────────────────────────


async def test_read_executes_in_confirm_mode(registry, db, org, regular_user):
    out = await run_tool(registry, "t_read", {}, _ctx(db, org, regular_user))
    assert out.status == "executed"


async def test_create_proposes_in_confirm_mode(registry, db, org, admin_user):
    out = await run_tool(registry, "t_create", {}, _ctx(db, org, admin_user))
    assert out.status == "proposed"
    assert out.proposal is not None
    assert out.proposal.tool == "t_create"
    assert out.proposal.requires_confirmation is False
    assert out.proposal.scope_key == "chat_test"
    assert out.proposal.org_id == org.id


async def test_destructive_proposes_with_challenge_in_confirm_mode(
    registry, db, org, admin_user
):
    out = await run_tool(registry, "t_destroy", {}, _ctx(db, org, admin_user))
    assert out.status == "proposed"
    assert out.proposal.requires_confirmation is True


async def test_autonomous_admin_executes_create(registry, db, org, admin_user):
    out = await run_tool(
        registry, "t_create", {}, _ctx(db, org, admin_user, mode="autonomous")
    )
    assert out.status == "executed"


async def test_autonomous_admin_executes_destructive(registry, db, org, admin_user):
    out = await run_tool(
        registry, "t_destroy", {}, _ctx(db, org, admin_user, mode="autonomous")
    )
    assert out.status == "executed"


async def test_autonomous_downgraded_for_non_admin(registry, db, org, regular_user):
    out = await run_tool(
        registry, "t_create", {}, _ctx(db, org, regular_user, mode="autonomous")
    )
    assert out.status == "proposed"


async def test_execute_mode_destructive_requires_confirm_arg(registry, db, org):
    token = _token(org_id=org.id, rights=_FULL_COURSES_RIGHT)
    out = await run_tool(
        registry, "t_destroy", {}, _ctx(db, org, token, mode="execute")
    )
    assert out.status == "denied"
    assert out.denied_code == "confirmation_required"

    out = await run_tool(
        registry,
        "t_destroy",
        {"confirm": True},
        _ctx(db, org, token, mode="execute"),
    )
    assert out.status == "executed"


# ─── error translation ─────────────────────────────────────────────────────


async def test_service_http_exception_translated(registry, db, org, admin_user):
    out = await run_tool(registry, "t_boom", {}, _ctx(db, org, admin_user))
    assert out.status == "denied"
    assert out.denied_code == "http_403"
    assert "service said no" in (out.reason or "")
