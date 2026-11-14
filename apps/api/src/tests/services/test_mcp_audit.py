"""Every change an AI app makes is recorded (src/services/mcp/audit.py), and
prompts are offered only to members who can carry them out."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import BaseModel

from src.db.users import PublicUser
from src.security.mcp_auth import MCPPrincipal
from src.security.rbac import AccessAction
from src.services.ai.tools import ActionTier, ToolSpec
from src.services.mcp import audit, prompts


class _P(BaseModel):
    course_uuid: str = "course_1"


def _spec():
    return ToolSpec(
        name="delete_course", description="d", params_model=_P, tier=ActionTier.DESTRUCTIVE,
        rights_bucket="courses", access_action=AccessAction.DELETE, execute=AsyncMock(),
        target_param="course_uuid", target_kind="course", title="Delete course",
    )


def _principal():
    user = PublicUser(id=7, username="ada", first_name="", last_name="", email="ada@example.com", user_uuid="user_ada")
    return MCPPrincipal(user=user, org_id=1, scopes=frozenset({"mcp:read", "mcp:write"}), kind="oauth", client_name="Claude", grant_uuid="mcpgrant_1")


def test_payload_keeps_ids_and_drops_bulk():
    assert audit._payload({"course_uuid": "c", "name": "x"}) == {"course_uuid": "c", "name": "x"}
    big = audit._payload({"activity_uuid": "a", "markdown": "x" * 20000, "confirm": True})
    assert big["activity_uuid"] == "a" and big["confirm"] is True and big["_omitted"] == "too_large"


def test_record_outside_a_loop_only_logs(caplog):
    with caplog.at_level("INFO", logger="learnhouse.mcp.audit"):
        audit.record(_principal(), 1, _spec(), {"course_uuid": "c"}, "executed")
        audit.record(_principal(), 1, _spec(), {"course_uuid": "c"}, "denied", "rbac_denied")
    assert "tool=delete_course status=executed" in caplog.text
    assert "code=rbac_denied" in caplog.text


async def test_record_hands_executed_calls_to_the_org_log():
    hook = SimpleNamespace(record_agent_audit=lambda **kw: calls.append(kw))
    calls: list = []
    with patch("src.core.ee_hooks.is_ee_available", return_value=True), \
            patch("src.core.ee_hooks.get_ee_hooks", return_value=hook):
        audit.record(_principal(), 1, _spec(), {"course_uuid": "course_1"}, "executed", approval="form")
        audit.record(_principal(), 1, _spec(), {}, "denied")
        await asyncio.gather(*list(audit._tasks))
    assert len(calls) == 1
    call = calls[0]
    assert call["via"] == "mcp" and call["user_id"] == 7 and call["org_id"] == 1
    assert call["tool"] == "delete_course" and call["target_kind"] == "course"
    assert call["target_id"] == "course_1" and call["title"] == "Delete course"
    assert call["details"] == {"app": "Claude", "approval": "form"}


async def test_org_log_failures_never_raise():
    with patch("src.core.ee_hooks.is_ee_available", return_value=False):
        await audit._to_org_log(_principal(), 1, _spec(), {})

    def boom(**_kw):
        raise RuntimeError("down")

    with patch("src.core.ee_hooks.is_ee_available", return_value=True), \
            patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(record_agent_audit=boom)):
        await audit._to_org_log(_principal(), 1, _spec(), {})
    with patch("src.core.ee_hooks.is_ee_available", return_value=True), \
            patch("src.security.auth.resolve_acting_user_id", side_effect=RuntimeError):
        await audit._to_org_log(_principal(), 1, _spec(), {})


def test_prompts_follow_rights_and_access():
    by_name = prompts.PROMPTS
    learner = {"courses": {"action_read": True}, "activities": {"action_read": True}}
    teacher = {"courses": {"action_read": True, "action_create": True, "action_update": True},
               "activities": {"action_update": True}}
    assert not prompts.prompt_allowed(by_name["draft_course"], True, learner)
    assert not prompts.prompt_allowed(by_name["learner_report"], True, learner)
    assert prompts.prompt_allowed(by_name["draft_course"], True, teacher)
    # Writing prompts need a connection that can write.
    assert not prompts.prompt_allowed(by_name["draft_course"], False, None)
    assert prompts.prompt_allowed(by_name["review_course"], False, None)
    listed = prompts.prompt_listing(lambda p: prompts.prompt_allowed(p, True, learner))
    assert listed == []
    assert {p.name for p in prompts.prompt_listing()} == set(by_name)


async def test_list_prompts_per_member(db, org, admin_user, regular_user):
    from src.services.mcp import handlers as h

    @asynccontextmanager
    async def factory():
        yield db

    def ctx(user):
        principal = MCPPrincipal(
            user=PublicUser.model_validate(user, from_attributes=True), org_id=org.id,
            scopes=frozenset({"mcp:read", "mcp:write"}), kind="oauth",
        )
        return SimpleNamespace(request=SimpleNamespace(scope={"state": {"mcp_principal": principal}}))

    with patch.object(h, "_async_session_factory", factory):
        handlers = h.Handlers(None)
        admin = await handlers.list_prompts(ctx(admin_user), None)
        learner = await handlers.list_prompts(ctx(regular_user), None)
        anonymous = await handlers.list_prompts(SimpleNamespace(request=SimpleNamespace(scope={"state": {}})), None)
    assert len(admin.prompts) == len(prompts.PROMPTS)
    # Learners read communities, so the read-only digest is all they get.
    assert [p.name for p in learner.prompts] == ["community_digest"]
    assert len(anonymous.prompts) == len(prompts.PROMPTS)
