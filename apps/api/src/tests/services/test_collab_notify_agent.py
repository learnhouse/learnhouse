"""Atlas writing a page open in a live room: editors see "Updated by Atlas".

run_tool marks the in-app agent's tool calls (``writing_agent``) and the
collab "Updated by" notice names the agent, with the member it acted for.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import BaseModel

from src.security.rbac import AccessAction
from src.services.ai.tools import ActionTier, ToolContext, ToolRegistry, ToolSpec, make_synthetic_request, run_tool
from src.services.ai.tools import registry as registry_mod
from src.services.courses.activities.collab_notify import _editor, writing_agent


def test_editor_names_the_person_by_default():
    user = SimpleNamespace(id=4, first_name="Maya", last_name="Okafor", username="maya")
    assert _editor(user) == {"id": 4, "name": "Maya Okafor"}


def test_editor_names_the_agent_for_the_person():
    user = SimpleNamespace(id=4, first_name="Maya", last_name="Okafor", username="maya")
    token = writing_agent.set("Atlas")
    try:
        assert _editor(user) == {"id": 4, "name": "Atlas", "agent": True, "for": "Maya Okafor"}
    finally:
        writing_agent.reset(token)
    assert writing_agent.get() is None


class _Params(BaseModel):
    pass


def _registry(seen: list):
    async def execute(ctx, params):
        seen.append(writing_agent.get())
        return {"ok": True}

    reg = ToolRegistry()
    reg.register_all([
        ToolSpec(
            name="probe", description="probe", params_model=_Params, tier=ActionTier.READ,
            rights_bucket=None, access_action=AccessAction.READ, execute=execute,
        )
    ])
    return reg


def _ctx(db, org, user, surface: str) -> ToolContext:
    return ToolContext(
        request=make_synthetic_request(), db_session=db, user=user, org=org,
        org_slug=org.slug, mode="execute", surface=surface,
    )


async def test_run_tool_marks_agent_writes_and_resets(db, org, admin_user):
    seen: list = []
    reg = _registry(seen)
    with patch.object(registry_mod, "_ai_enabled_for_org", AsyncMock(return_value=True)):
        agent = await run_tool(reg, "probe", {}, _ctx(db, org, admin_user, "agent"))
        mcp = await run_tool(reg, "probe", {}, _ctx(db, org, admin_user, "mcp"))
    assert agent.status == "executed", agent.reason
    assert mcp.status == "executed", mcp.reason
    assert seen == ["Atlas", None]
    assert writing_agent.get() is None
