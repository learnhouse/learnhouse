"""Every change an AI app makes is recorded (src/services/mcp/audit.py), and
prompts are offered only to members who can carry them out."""

import asyncio
import sys
from contextlib import asynccontextmanager
from types import ModuleType, SimpleNamespace
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


async def test_record_writes_to_the_org_log_on_enterprise():
    queued = AsyncMock()
    fake = ModuleType("ee.services.audit")
    fake.queue_audit_log = queued
    fake.is_enterprise_plan = AsyncMock(return_value=True)

    @asynccontextmanager
    async def session():
        yield SimpleNamespace()

    with patch.dict(sys.modules, {"ee.services.audit": fake}), \
            patch("src.core.ee_hooks.is_ee_available", return_value=True), \
            patch("src.core.events.database._async_session_factory", session):
        audit.record(_principal(), 1, _spec(), {"course_uuid": "course_1"}, "executed")
        await asyncio.gather(*list(audit._tasks))
    kwargs = queued.await_args.kwargs
    assert kwargs["action"] == "AI app: Delete course" and kwargs["resource_id"] == "course_1"
    assert kwargs["path"] == "/mcp/tools/delete_course" and kwargs["payload"]["app"] == "Claude"
    assert kwargs["user_id"] == 7 and kwargs["org_id"] == 1

    # Not enterprise: nothing is queued. Denied calls never are.
    queued.reset_mock()
    fake.is_enterprise_plan = AsyncMock(return_value=False)
    with patch.dict(sys.modules, {"ee.services.audit": fake}), \
            patch("src.core.ee_hooks.is_ee_available", return_value=True), \
            patch("src.core.events.database._async_session_factory", session):
        audit.record(_principal(), 1, _spec(), {}, "executed")
        audit.record(_principal(), 1, _spec(), {}, "denied")
        await asyncio.gather(*list(audit._tasks))
    queued.assert_not_awaited()


async def test_org_log_failures_never_raise():
    with patch("src.core.ee_hooks.is_ee_available", return_value=False):
        await audit._to_org_log(_principal(), 1, _spec(), {})
    broken = ModuleType("ee.services.audit")
    with patch.dict(sys.modules, {"ee.services.audit": broken}), \
            patch("src.core.ee_hooks.is_ee_available", return_value=True):
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
