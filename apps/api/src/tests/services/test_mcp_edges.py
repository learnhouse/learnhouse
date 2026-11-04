"""Edge branches of the MCP server: OAuth corner cases, the approval store's
retry loop, schema simplification and the call handler's early exits.

The happy paths live in test_mcp_oauth.py, test_mcp_server.py and
test_mcp_approvals.py; this file reuses their helpers.
"""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.sql.dml import Update
from sqlmodel import select

from src.db.mcp_oauth import MCPOAuthGrant
from src.db.users import APITokenUser, User
from src.security.mcp_auth import MCPPrincipal
from src.services.ai.tools import ActionTier, ToolOutcome
from src.services.mcp import approvals, audit, oauth, prompts
from src.services.mcp import handlers as h
from src.services.mcp import server as srv
from src.tests.services.test_mcp_approvals import FakePipeline, FakeRedis
from src.tests.services.test_mcp_oauth import full_tokens, make_request, register
from src.tests.services.test_mcp_server import (
    _registry,
    _spec,
    body,
    call,
    ctx_for,
    member,
)


@pytest.fixture
def mcp_config():
    config = SimpleNamespace(enabled=True, public_url=None)
    with patch("src.services.mcp.oauth.get_learnhouse_config") as get_config:
        get_config.return_value.mcp_config = config
        get_config.return_value.hosting_config.ssl = True
        get_config.return_value.hosting_config.frontend_domain = "app.example.com"
        yield config


@pytest.fixture
def frontend():
    with patch(
        "src.services.email.utils._configured_frontend_base_url",
        return_value="https://app.example.com",
    ):
        yield


@pytest.fixture
def sessions(db):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def factory():
        db.expunge_all()
        for cache in ("_user_org_cache", "_auth_policy_cache"):
            if hasattr(db, cache):
                delattr(db, cache)
        yield db

    with patch.object(h, "_async_session_factory", factory), patch.object(h, "_rate_limited", return_value=False):
        yield


# ─── OAuth ───────────────────────────────────────────────────────────────────


async def test_register_keeps_an_https_logo(db):
    """An https logo is echoed back in the registration response (http ones are dropped)."""
    client = await register(db, logo_uri="https://claude.ai/logo.png")
    assert client["logo_uri"] == "https://claude.ai/logo.png"


async def test_malformed_basic_credentials_are_rejected(db):
    """Undecodable Basic credentials fail client auth instead of crashing, and
    the revoke endpoint simply cannot read a client id out of them."""
    client = await register(db, token_endpoint_auth_method="client_secret_basic")
    row = await oauth.get_client(client["client_id"], db)
    with pytest.raises(oauth.OAuthError) as exc:
        oauth._authenticate_client(row, {}, "Basic abc")  # bad base64 padding
    assert exc.value.error == "invalid_client"
    assert exc.value.status_code == 401
    assert oauth._client_id_from_basic("Basic abc") is None


async def test_refresh_after_the_member_was_deleted_ends_the_grant(db, org, admin_user, mcp_config, frontend):
    """A refresh for an account that no longer exists revokes the whole grant."""
    client, tokens = await full_tokens(db, admin_user, org)
    user = await db.get(User, admin_user.id)
    await db.delete(user)
    await db.commit()

    with pytest.raises(oauth.OAuthError) as exc:
        await oauth.exchange_token(
            {"grant_type": "refresh_token", "client_id": client["client_id"], "refresh_token": tokens["refresh_token"]},
            None, make_request(), db,
        )
    assert exc.value.error == "invalid_grant"
    assert "reconnect" in exc.value.description
    grant = (await db.execute(select(MCPOAuthGrant))).scalars().first()
    await db.refresh(grant)
    assert grant.revoked_at is not None


async def test_refresh_race_loses_cleanly(db, org, admin_user, mcp_config, frontend):
    """When a concurrent refresh claims the token first, the loser gets invalid_grant."""
    client, tokens = await full_tokens(db, admin_user, org)
    real_execute = db.execute

    async def racing_execute(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "mcp_oauth_token":
            return SimpleNamespace(rowcount=0)
        return await real_execute(statement, *args, **kwargs)

    with patch.object(db, "execute", side_effect=racing_execute), patch.object(db, "rollback", new_callable=AsyncMock) as rollback:
        with pytest.raises(oauth.OAuthError) as exc:
            await oauth.exchange_token(
                {"grant_type": "refresh_token", "client_id": client["client_id"], "refresh_token": tokens["refresh_token"]},
                None, make_request(), db,
            )
    assert exc.value.error == "invalid_grant"
    assert exc.value.description == "refresh_token was already used"
    rollback.assert_awaited_once()


async def test_unreadable_password_timestamp_does_not_cut_the_client_off(db):
    """A password_changed_at that cannot be compared is ignored, not fatal."""
    grant = SimpleNamespace(created_at=int(time.time()), user_id=1, org_id=1)
    with patch.object(db, "get", new=AsyncMock(return_value=SimpleNamespace(password_changed_at="garbage"))), \
         patch.object(oauth, "_has_membership", new=AsyncMock(return_value=True)):
        assert await oauth._grant_user_still_valid(grant, db) is True


async def test_verify_access_token_refreshes_last_used(db, org, admin_user, mcp_config, frontend):
    """A stale last-used stamp is bumped when the access token is used."""
    _, tokens = await full_tokens(db, admin_user, org)
    grant = (await db.execute(select(MCPOAuthGrant))).scalars().first()
    grant.last_used_at = 1
    db.add(grant)
    await db.commit()

    principal = await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db)
    assert principal is not None
    await db.refresh(grant)
    assert grant.last_used_at > int(time.time()) - 60


# ─── server.py ───────────────────────────────────────────────────────────────


def test_version_is_empty_when_nothing_can_tell():
    """No installed metadata and no readable pyproject: the version is blank."""
    with patch("importlib.metadata.version", side_effect=Exception("not installed")), \
         patch("tomllib.loads", side_effect=ValueError("bad toml")):
        assert srv._version() == ""


def test_api_tokens_do_not_see_tools_closed_to_them(org):
    """A tool flagged api_tokens=False is hidden from API-token connections."""
    spec = _spec("member_only", bucket=None, api_tokens=False)
    token = MCPPrincipal(
        user=APITokenUser(org_id=org.id, rights={}), org_id=org.id,
        scopes=frozenset({"mcp:read", "mcp:write"}), kind="api_token",
    )
    assert srv.spec_visible(spec, token, {}, org.id, None) is False


def test_compact_schema_splits_multi_type_lists():
    """A nullable union of several types becomes anyOf without the null."""
    assert srv.compact_schema({"type": ["string", "integer", "null"]}) == {
        "anyOf": [{"type": "string"}, {"type": "integer"}],
    }
    # One type plus null collapses to that type.
    assert srv.compact_schema({"type": ["string", "null"]}) == {"type": "string"}


# ─── handlers.py ─────────────────────────────────────────────────────────────


def test_approval_summary_names_the_target_and_related_objects():
    """The summary swaps raw uuids for the names a person recognizes."""
    spec = _spec("delete_course", ActionTier.DESTRUCTIVE, summarize=lambda p: "Delete course_1 next to course_2")
    summary = h._approval_summary(
        spec, {"course_uuid": "course_1"},
        {"name": "Intro", "uuid": "course_1", "related": {"course_2": "Other", "course_9": "Intro"}},
    )
    assert summary == 'Delete "Intro" next to "Other" (course_2)'


def test_approval_summary_falls_back_when_summarize_breaks():
    """A summarizer that raises falls back to the tool title and target name."""
    def broken(_params):
        raise RuntimeError("boom")

    spec = _spec("delete_course", ActionTier.DESTRUCTIVE, summarize=broken, title="Delete course")
    assert h._approval_summary(spec, {}, {"name": "Intro"}) == 'Delete course "Intro"'


async def test_call_tool_refused_when_a_name_cannot_be_resolved(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    with patch.object(h, "resolve_names", new=AsyncMock(return_value=ToolOutcome.denied("http_404", "No course named that"))):
        result = await h.Handlers(_registry()).call_tool(ctx_for(member(admin_user, org)), call("get_course"))
    assert body(result)["error"]["code"] == "http_404"
    assert body(result)["error"]["message"] == "No course named that"


async def test_call_tool_refused_when_approvals_are_unavailable(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    with patch.object(h.Handlers, "_approval", new=AsyncMock(side_effect=approvals.ApprovalUnavailable)):
        result = await h.Handlers(_registry()).call_tool(ctx_for(member(admin_user, org)), call("get_course"))
    assert body(result)["error"]["code"] == "approval_unavailable"


async def test_call_tool_reports_resolved_names(db, org, admin_user, sessions):
    """When names were turned into ids, the result says which object was meant."""
    org = SimpleNamespace(id=org.id)
    resolved = {"course_uuid": {"name": "One", "uuid": "course_1"}}
    with patch.object(h, "resolve_names", new=AsyncMock(return_value=({"course_uuid": "course_1"}, resolved))):
        result = await h.Handlers(_registry()).call_tool(ctx_for(member(admin_user, org)), call("get_course", {"course_uuid": "One"}))
    assert not result.is_error
    assert body(result)["resolved"] == resolved
    assert body(result)["ok"] is True


# ─── approvals.py ────────────────────────────────────────────────────────────


def test_corrupt_approval_record_reads_as_missing():
    fake = FakeRedis()
    fake.set(approvals._KEY.format("apr_bad"), "{not json")
    with patch.object(approvals, "get_redis_client", return_value=fake):
        assert approvals.get("apr_bad") is None


class WatchError(Exception):
    """Same class name as redis.WatchError, which is all consume() checks."""


class _ContestedPipeline(FakePipeline):
    def __init__(self, redis, exc):
        super().__init__(redis)
        self.exc = exc
        self.executions = 0

    def execute(self):
        self.executions += 1
        raise self.exc


def _approved(fake):
    made = approvals.create(grant="g", user_id=1, org_id=1, tool="t", arguments={}, summary="s", client_name="c")
    approvals.decide(made.id, user_id=1, approve=True)
    return made


def test_consume_gives_up_after_repeated_contention():
    """Five lost WATCH races in a row leave the approval pending, not used."""
    fake = FakeRedis()
    with patch.object(approvals, "get_redis_client", return_value=fake):
        made = _approved(fake)
        pipe = _ContestedPipeline(fake, WatchError())
        with patch.object(fake, "pipeline", return_value=pipe):
            status = approvals.consume(made.id, grant="g", user_id=1, org_id=1, tool="t", arguments={})
    assert status == "pending"
    assert pipe.executions == 5


def test_consume_propagates_unexpected_errors():
    fake = FakeRedis()
    with patch.object(approvals, "get_redis_client", return_value=fake):
        made = _approved(fake)
        with patch.object(fake, "pipeline", return_value=_ContestedPipeline(fake, RuntimeError("redis gone"))):
            with pytest.raises(RuntimeError, match="redis gone"):
                approvals.consume(made.id, grant="g", user_id=1, org_id=1, tool="t", arguments={})


# ─── audit.py / prompts.py ───────────────────────────────────────────────────


def test_audit_payload_omits_unserializable_arguments():
    looped: dict = {}
    looped["self"] = looped
    assert audit._payload({"x": looped}) == {"_omitted": "unserializable"}


def test_render_unknown_prompt_returns_none():
    assert prompts.render_prompt("no_such_prompt", {"a": "b"}) is None
