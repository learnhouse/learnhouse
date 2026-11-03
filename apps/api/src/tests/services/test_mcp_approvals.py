"""Human approval of sensitive MCP calls (src/services/mcp/approvals.py) and
how the call handler uses it."""

import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch

import mcp_types as types
import pytest
from pydantic import BaseModel

from src.db.users import APITokenUser, PublicUser
from src.security.mcp_auth import MCPPrincipal
from src.security.rbac import AccessAction
from src.services.ai.tools import ActionTier, ToolRegistry, ToolSpec
from src.services.mcp import approvals
from src.services.mcp import handlers as h

MODERN = "2026-07-28"
LEGACY = "2025-11-25"


class FakeRedis:
    """Just enough of redis-py for the approval store."""

    def __init__(self):
        self.data: dict[str, tuple[str, float | None]] = {}

    def _live(self, key):
        item = self.data.get(key)
        if item is None:
            return None
        value, expires = item
        if expires is not None and expires < time.time():
            self.data.pop(key, None)
            return None
        return value

    def get(self, key):
        return self._live(key)

    def set(self, key, value, ex=None, nx=False):
        if nx and self._live(key) is not None:
            return None
        self.data[key] = (value, time.time() + ex if ex else None)
        return True

    def pipeline(self):
        return FakePipeline(self)


class FakePipeline:
    def __init__(self, redis):
        self.redis = redis
        self.ops = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def watch(self, key):
        pass

    def get(self, key):
        return self.redis.get(key)

    def multi(self):
        self.ops = []

    def set(self, key, value, ex=None):
        self.ops.append((key, value, ex))

    def execute(self):
        for key, value, ex in self.ops:
            self.redis.set(key, value, ex=ex)


@pytest.fixture
def redis():
    fake = FakeRedis()
    with patch.object(approvals, "get_redis_client", return_value=fake):
        yield fake


# ─── the store ───────────────────────────────────────────────────────────────


def test_digest_ignores_control_args_and_order():
    a = approvals.args_digest("delete_course", {"course_uuid": "course_1", "approval_id": "x"})
    b = approvals.args_digest("delete_course", {"course_uuid": "course_1", "confirm": True})
    assert a == b
    assert a != approvals.args_digest("delete_course", {"course_uuid": "course_2"})
    assert a != approvals.args_digest("delete_chapter", {"course_uuid": "course_1"})


def test_link_lifecycle(redis):
    made = approvals.create(
        grant="g1", user_id=7, org_id=3, tool="delete_course",
        arguments={"course_uuid": "course_1"}, summary="Delete course", client_name="Claude",
    )
    assert made.id.startswith("apr_") and approvals.get(made.id).status == "pending"
    assert "/oauth/approve?id=" in approvals.approval_url(made.id)
    # Not decided yet.
    assert approvals.consume(made.id, grant="g1", user_id=7, org_id=3, tool="delete_course", arguments={"course_uuid": "course_1"}) == "pending"
    # Only the member it acts as may answer.
    with pytest.raises(LookupError):
        approvals.decide(made.id, 8, True)
    assert approvals.decide(made.id, 7, True).status == "approved"
    with pytest.raises(ValueError):
        approvals.decide(made.id, 7, False)
    # Bound to the connection, the member, the org, the tool and the exact arguments.
    assert approvals.consume(made.id, grant="g1", user_id=8, org_id=3, tool="delete_course", arguments={"course_uuid": "course_1"}) == "mismatch"
    assert approvals.consume(made.id, grant="g1", user_id=7, org_id=4, tool="delete_course", arguments={"course_uuid": "course_1"}) == "mismatch"
    assert approvals.consume(made.id, grant="g2", user_id=7, org_id=3, tool="delete_course", arguments={"course_uuid": "course_1"}) == "mismatch"
    assert approvals.consume(made.id, grant="g1", user_id=7, org_id=3, tool="delete_chapter", arguments={"course_uuid": "course_1"}) == "mismatch"
    assert approvals.consume(made.id, grant="g1", user_id=7, org_id=3, tool="delete_course", arguments={"course_uuid": "course_2"}) == "mismatch"
    assert approvals.consume(made.id, grant="g1", user_id=7, org_id=3, tool="delete_course", arguments={"course_uuid": "course_1"}) == "approved"
    # Single use.
    assert approvals.consume(made.id, grant="g1", user_id=7, org_id=3, tool="delete_course", arguments={"course_uuid": "course_1"}) == "used"
    assert approvals.consume("apr_missing", grant="g1", user_id=7, org_id=3, tool="x", arguments={}) == "missing"
    assert approvals.get("x" * 100) is None


def test_declined(redis):
    made = approvals.create(grant="g", user_id=1, org_id=1, tool="t", arguments={}, summary="s")
    approvals.decide(made.id, 1, False)
    assert approvals.consume(made.id, grant="g", user_id=1, org_id=1, tool="t", arguments={}) == "declined"


def test_form_state_single_use_and_bound(redis):
    bound = {"grant": "g", "user_id": 7, "org_id": 3, "tool": "update_course"}
    state = approvals.form_state(**bound, arguments={"course_uuid": "c1"})
    assert not approvals.redeem_form_state(state, **{**bound, "grant": "other"}, arguments={"course_uuid": "c1"})
    assert not approvals.redeem_form_state(state, **{**bound, "user_id": 8}, arguments={"course_uuid": "c1"})
    assert not approvals.redeem_form_state(state, **{**bound, "org_id": 4}, arguments={"course_uuid": "c1"})
    assert not approvals.redeem_form_state(state, **bound, arguments={"course_uuid": "c2"})
    assert approvals.redeem_form_state(state, **bound, arguments={"course_uuid": "c1"})
    assert not approvals.redeem_form_state(state, **bound, arguments={"course_uuid": "c1"})
    assert not approvals.redeem_form_state("garbage", **bound, arguments={})
    assert not approvals.redeem_form_state(None, **bound, arguments={})


def test_no_redis_fails_closed():
    with patch.object(approvals, "get_redis_client", return_value=None):
        with pytest.raises(approvals.ApprovalUnavailable):
            approvals.create(grant="g", user_id=1, org_id=1, tool="t", arguments={}, summary="s")


# ─── the handler ─────────────────────────────────────────────────────────────


class _Params(BaseModel):
    course_uuid: str = "course_1"
    publish: bool = False


async def _ok(ctx, params):
    return {"ok": True, "approved": ctx.approved}


def _registry():
    r = ToolRegistry()
    r.register_all([
        ToolSpec(
            name="delete_course", description="d", params_model=_Params, tier=ActionTier.DESTRUCTIVE,
            rights_bucket="courses", access_action=AccessAction.DELETE, execute=_ok,
            summarize=lambda p: f"Delete {p.course_uuid}",
        ),
        ToolSpec(
            name="update_course", description="u", params_model=_Params, tier=ActionTier.EDIT,
            rights_bucket="courses", access_action=AccessAction.UPDATE, execute=_ok,
            approval_if=lambda p: p.publish,
        ),
        ToolSpec(
            name="manage_roles", description="r", params_model=_Params, tier=ActionTier.EDIT,
            rights_bucket=None, access_action=AccessAction.UPDATE, execute=_ok, access="admin",
        ),
        ToolSpec(
            name="grant_admin", description="g", params_model=_Params, tier=ActionTier.EDIT,
            rights_bucket=None, access_action=AccessAction.UPDATE, execute=_ok, access="admin",
            approval=True,
        ),
    ])
    return r


@pytest.fixture
def sessions(db, redis):
    @asynccontextmanager
    async def factory():
        # Each MCP call gets a fresh session in production; drop rows a
        # previous call's rollback expired so this one reloads them.
        db.expunge_all()
        for cache in ("_user_org_cache", "_auth_policy_cache"):
            if hasattr(db, cache):
                delattr(db, cache)
        yield db

    with patch.object(h, "_async_session_factory", factory), patch.object(h, "_rate_limited", return_value=False):
        yield


def member(user, org, scopes=("mcp:read", "mcp:write")):
    # Real connections carry a plain PublicUser, never a live ORM row.
    if not isinstance(user, PublicUser):
        user = PublicUser.model_validate(user, from_attributes=True)
    return MCPPrincipal(user=user, org_id=org.id, scopes=frozenset(scopes), kind="oauth", client_name="Claude", grant_uuid="mcpgrant_x")


def ctx_for(principal, protocol=LEGACY, elicit=False):
    caps = SimpleNamespace(elicitation=object() if elicit else None)
    return SimpleNamespace(
        request=SimpleNamespace(scope={"state": {"mcp_principal": principal}}, query_params={}),
        protocol_version=protocol,
        session=SimpleNamespace(client_capabilities=caps),
    )


def call(name, args=None, responses=None, state=None):
    return types.CallToolRequestParams(name=name, arguments=args or {}, input_responses=responses, request_state=state)


def err(result):
    return result.structured_content.get("error")


async def test_model_cannot_self_approve(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    who = member(admin_user, org)
    ctx = ctx_for(who)
    # confirm=true from the model is ignored for member connections.
    first = await handlers.call_tool(ctx, call("delete_course", {"course_uuid": "course_9", "confirm": True}))
    e = err(first)
    assert e["code"] == "approval_required" and e["approval_url"].endswith(e["approval_id"])
    assert "Delete course_9" in e["summary"]

    # Retrying before the member answers does nothing.
    pending = await handlers.call_tool(ctx, call("delete_course", {"course_uuid": "course_9", "approval_id": e["approval_id"]}))
    assert err(pending)["code"] == "approval_pending"

    approvals.decide(e["approval_id"], who.user.id, True)
    # A different call cannot use it.
    other = await handlers.call_tool(ctx, call("delete_course", {"course_uuid": "course_8", "approval_id": e["approval_id"]}))
    assert err(other)["code"] == "approval_mismatch"
    done = await handlers.call_tool(ctx, call("delete_course", {"course_uuid": "course_9", "approval_id": e["approval_id"]}))
    assert done.structured_content == {"ok": True, "approved": True}
    again = await handlers.call_tool(ctx, call("delete_course", {"course_uuid": "course_9", "approval_id": e["approval_id"]}))
    assert err(again)["code"] == "approval_expired"


async def test_conditional_approval(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    ctx = ctx_for(member(admin_user, org))
    plain = await handlers.call_tool(ctx, call("update_course", {"publish": False}))
    assert plain.structured_content == {"ok": True, "approved": False}
    publishing = await handlers.call_tool(ctx, call("update_course", {"publish": True}))
    assert err(publishing)["code"] == "approval_required"


def _pub(course, **extra):
    return {"course_uuid": course, "publish": True, **extra}


async def test_form_flow_on_modern_clients(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    ctx = ctx_for(member(admin_user, org), protocol=MODERN, elicit=True)
    asked = await handlers.call_tool(ctx, call("update_course", _pub("course_5")))
    assert isinstance(asked, types.InputRequiredResult) and asked.request_state

    yes = types.ElicitResult(action="accept", content={"approve": True})
    # The answer is bound to the call it was asked for.
    moved = await handlers.call_tool(ctx, call("update_course", _pub("course_6"), {"approve": yes}, asked.request_state))
    assert err(moved)["code"] == "approval_expired"
    asked = await handlers.call_tool(ctx, call("update_course", _pub("course_5")))
    ok = await handlers.call_tool(ctx, call("update_course", _pub("course_5"), {"approve": yes}, asked.request_state))
    assert ok.structured_content == {"ok": True, "approved": True}
    replay = await handlers.call_tool(ctx, call("update_course", _pub("course_5"), {"approve": yes}, asked.request_state))
    assert err(replay)["code"] == "approval_expired"

    no = types.ElicitResult(action="decline")
    asked = await handlers.call_tool(ctx, call("update_course", _pub("course_5")))
    declined = await handlers.call_tool(ctx, call("update_course", _pub("course_5"), {"approve": no}, asked.request_state))
    assert err(declined)["code"] == "cancelled"
    unticked = types.ElicitResult(action="accept", content={"approve": False})
    asked = await handlers.call_tool(ctx, call("update_course", _pub("course_5")))
    refused = await handlers.call_tool(ctx, call("update_course", _pub("course_5"), {"approve": unticked}, asked.request_state))
    assert err(refused)["code"] == "cancelled"


async def test_deletions_and_admin_changes_never_take_a_form(db, org, admin_user, sessions):
    """A form answer may come from the app rather than the person, so what
    cannot be undone goes through the link even on clients with forms."""
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    who = member(admin_user, org, ("mcp:read", "mcp:write", "mcp:admin"))
    ctx = ctx_for(who, protocol=MODERN, elicit=True)
    for name in ("delete_course", "grant_admin"):
        asked = await handlers.call_tool(ctx, call(name, {"course_uuid": "course_5"}))
        e = err(asked)
        assert e["code"] == "approval_required" and e["approval_url"].endswith(e["approval_id"])
    # A state minted for a form-approvable call cannot be replayed onto a deletion.
    forged = approvals.form_state(
        grant=who.connection_id, user_id=who.user.id, org_id=org.id,
        tool="delete_course", arguments={"course_uuid": "course_5"},
    )
    yes = types.ElicitResult(action="accept", content={"approve": True})
    out = await handlers.call_tool(ctx, call("delete_course", {"course_uuid": "course_5"}, {"approve": yes}, forged))
    assert err(out)["code"] == "approval_required"


async def test_dismissed_form_falls_back_to_a_link(db, org, admin_user, sessions):
    """Headless clients answer every form with cancel: the member must still
    be able to approve, through the link."""
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    who = member(admin_user, org)
    ctx = ctx_for(who, protocol=MODERN, elicit=True)
    asked = await handlers.call_tool(ctx, call("update_course", _pub("course_5")))
    assert isinstance(asked, types.InputRequiredResult)
    for dismissed in (types.ElicitResult(action="cancel"), None):
        responses = {"approve": dismissed} if dismissed else {}
        again = await handlers.call_tool(ctx, call("update_course", _pub("course_5"), responses, asked.request_state))
        e = err(again)
        assert e["code"] == "approval_required" and e["approval_url"].endswith(e["approval_id"])
        assert e["message"].startswith("Your app could not show the approval prompt")
    # The link works like any other approval.
    approvals.decide(e["approval_id"], who.user.id, True)
    done = await handlers.call_tool(ctx, call("update_course", _pub("course_5", approval_id=e["approval_id"])))
    assert done.structured_content == {"ok": True, "approved": True}


async def test_api_tokens_are_approved_by_their_creator(db, org, admin_user, sessions):
    token = MCPPrincipal(
        user=APITokenUser(
            id=41, org_id=org.id, rights={"courses": {"action_delete": True}}, created_by_user_id=admin_user.id
        ),
        org_id=org.id, scopes=frozenset({"mcp:read", "mcp:write"}), kind="api_token",
    )
    handlers = h.Handlers(_registry())
    # The model setting confirm=true approves nothing.
    first = await handlers.call_tool(ctx_for(token), call("delete_course", {"confirm": True}))
    e = err(first)
    assert e["code"] == "approval_required" and "confirm" not in e["message"]
    assert e["message"].startswith("The member who created this API token approves")
    with pytest.raises(LookupError):
        approvals.decide(e["approval_id"], admin_user.id + 1, True)
    approvals.decide(e["approval_id"], admin_user.id, True)
    done = await handlers.call_tool(ctx_for(token), call("delete_course", {"approval_id": e["approval_id"]}))
    assert done.structured_content == {"ok": True, "approved": True}


async def test_api_token_without_a_creator_cannot_be_approved(db, org, sessions):
    token = MCPPrincipal(
        user=APITokenUser(org_id=org.id, rights={"courses": {"action_delete": True}}),
        org_id=org.id, scopes=frozenset({"mcp:read", "mcp:write"}), kind="api_token",
    )
    out = await h.Handlers(_registry()).call_tool(ctx_for(token), call("delete_course", {"confirm": True}))
    assert err(out)["code"] == "approval_unavailable"


async def test_approval_does_not_follow_a_connection_into_another_org(db, org, other_org, admin_user, sessions):
    handlers = h.Handlers(_registry())
    here = member(admin_user, SimpleNamespace(id=org.id))
    asked = err(await handlers.call_tool(ctx_for(here), call("delete_course")))
    approvals.decide(asked["approval_id"], here.user.id, True)
    there = member(admin_user, SimpleNamespace(id=other_org.id))
    assert approvals.consume(
        asked["approval_id"], grant=there.connection_id, user_id=here.user.id, org_id=other_org.id,
        tool="delete_course", arguments={"course_uuid": "course_1"},
    ) == "mismatch"


async def test_admin_tools_need_admin_scope(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    hidden = await handlers.call_tool(ctx_for(member(admin_user, org)), call("manage_roles"))
    assert err(hidden)["code"] == "unknown_tool"
    listed = await handlers.list_tools(ctx_for(member(admin_user, org)), None)
    assert "manage_roles" not in {t.name for t in listed.tools}
    admin = member(admin_user, org, ("mcp:read", "mcp:write", "mcp:admin"))
    listed = await handlers.list_tools(ctx_for(admin), None)
    tools = {t.name: t for t in listed.tools}
    assert "manage_roles" in tools
    # Approval-capable tools advertise approval_id to members.
    assert "approval_id" in tools["delete_course"].input_schema["properties"]
    assert "confirm" not in tools["delete_course"].input_schema["properties"]


async def test_redis_down_refuses(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    with patch.object(approvals, "get_redis_client", return_value=None):
        out = await h.Handlers(_registry()).call_tool(ctx_for(member(admin_user, org)), call("delete_course"))
    assert err(out)["code"] == "approval_unavailable"
