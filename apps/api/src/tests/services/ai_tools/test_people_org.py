"""People and organization tools, through the full run_tool pipeline.

Covers members, invitations and invite links, user groups, roles and org
settings: org-scoped ids (another org's rows are not found), wrong-prefix
ids, learner and maintainer denials, the admin scope, approval gates on MCP,
honest per-item results and the shapes the agent reads back.
"""

from __future__ import annotations

import fnmatch
import json
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, PublicUser, User
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import org as org_tools
from src.services.ai.tools import roles as role_tools
from src.services.ai.tools import usergroups as group_tools
from src.services.ai.tools import users as user_tools
from src.tests.conftest import ADMIN_RIGHTS, USER_RIGHTS

BASE = "https://test-org.example"


# ─── fakes and fixtures ──────────────────────────────────────────────────────


class FakeRedis:
    """Just enough of redis-py for the invite services."""

    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttl: dict[str, int | None] = {}

    @staticmethod
    def _s(key):
        return key.decode() if isinstance(key, bytes) else key

    def __bool__(self):
        return True

    def get(self, key):
        value = self.store.get(self._s(key))
        return value.encode() if isinstance(value, str) else value

    def set(self, key, value, ex=None):
        key = self._s(key)
        self.store[key] = value.decode() if isinstance(value, bytes) else value
        self.ttl[key] = ex

    def delete(self, *keys):
        removed = 0
        for key in keys:
            if self.store.pop(self._s(key), None) is not None:
                removed += 1
        return removed

    def scan_iter(self, match="*", count=None):
        return [k.encode() for k in list(self.store) if fnmatch.fnmatchcase(k, match)]

    def eval(self, _script, _numkeys, pattern, new_key, value, ttl, max_codes):
        if len([k for k in self.store if fnmatch.fnmatchcase(k, pattern)]) >= int(max_codes):
            return 0
        self.set(new_key, value, ex=int(ttl))
        return 1


@pytest.fixture
def fake_redis():
    return FakeRedis()


@pytest.fixture(autouse=True)
def environment(fake_redis):
    """Redis, email, webhooks and links replaced by in-process fakes."""
    cfg = SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string="redis://fake"))
    send = AsyncMock(return_value=True)
    with patch("src.services.orgs.users.get_learnhouse_config", return_value=cfg), patch(
        "src.services.orgs.invites.get_learnhouse_config", return_value=cfg
    ), patch("src.services.orgs.users.redis.Redis.from_url", return_value=fake_redis), patch(
        "src.services.orgs.invites._get_redis", return_value=fake_redis
    ), patch("src.services.orgs.users.send_invite_email", send), patch(
        "src.services.orgs.users.enforce_invite_rate_limit", Mock()
    ), patch("src.services.orgs.users.dispatch_webhooks", AsyncMock()), patch(
        "src.services.users.usergroups.dispatch_webhooks", AsyncMock()
    ), patch("src.services.orgs.orgs.dispatch_webhooks", AsyncMock()), patch(
        "src.routers.users._invalidate_session_cache", Mock()
    ), patch("src.services.orgs.cache.get_redis_client", return_value=None), patch(
        "src.services.users.usergroups.increase_feature_usage", AsyncMock()
    ), patch("src.services.users.usergroups.decrease_feature_usage", AsyncMock()), patch(
        "src.services.ai.tools.refs.web_base", AsyncMock(return_value=BASE)
    ):
        yield SimpleNamespace(send=send)


def _config(org_id: int) -> OrganizationConfig:
    return OrganizationConfig(
        org_id=org_id,
        config={
            "config_version": "2.0",
            "plan": "enterprise",
            "admin_toggles": {"members": {"signup_mode": "open"}},
            "customization": {
                "general": {"color": "#111111", "watermark": True},
                "menu": {"items": [{"type": "courses", "enabled": True, "order": 0}]},
                "landing": {"enabled": False, "sections": [{"type": "hero", "title": "Hi"}]},
            },
        },
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )


@pytest.fixture
async def setup(db, org, other_org, admin_user, regular_user, user_role, course):
    db.add(_config(org.id))
    db.add(_config(other_org.id))
    now = str(datetime.now())
    maintainer_role = Role(
        id=2,
        name="Maintainer",
        org_id=None,
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_maintainer",
        rights=ADMIN_RIGHTS.model_dump(),
        creation_date=now,
        update_date=now,
    )
    other_role = Role(
        id=7,
        name="Other Custom",
        org_id=other_org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_other_custom",
        rights=USER_RIGHTS.model_dump(),
        creation_date=now,
        update_date=now,
    )
    custom_role = Role(
        id=8,
        name="Reviewer",
        org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_reviewer",
        rights=USER_RIGHTS.model_dump(),
        creation_date=now,
        update_date=now,
    )
    db.add_all([maintainer_role, other_role, custom_role])
    maint = User(
        id=3, username="maint", first_name="Mai", last_name="Ntainer", email="maint@test.com",
        password="x", user_uuid="user_maint", creation_date=now, update_date=now,
    )
    outsider = User(
        id=4, username="outsider", first_name="Out", last_name="Sider", email="out@other.com",
        password="x", user_uuid="user_outsider", creation_date=now, update_date=now,
    )
    db.add_all([maint, outsider])
    await db.commit()
    db.add_all(
        [
            UserOrganization(user_id=3, org_id=org.id, role_id=2, creation_date=now, update_date=now),
            UserOrganization(user_id=4, org_id=other_org.id, role_id=7, creation_date=now, update_date=now),
        ]
    )
    group = UserGroup(
        id=1, name="Cohort A", description="First cohort", org_id=org.id,
        usergroup_uuid="usergroup_a", creation_date=now, update_date=now,
    )
    other_group = UserGroup(
        id=2, name="Elsewhere", description="", org_id=other_org.id,
        usergroup_uuid="usergroup_other", creation_date=now, update_date=now,
    )
    other_course = Course(
        id=2, name="Other Course", description="", public=True, published=True,
        open_to_contributors=False, org_id=other_org.id, course_uuid="course_other",
        creation_date=now, update_date=now,
    )
    db.add_all([group, other_group, other_course])
    await db.commit()
    db.add(UserGroupUser(usergroup_id=1, user_id=regular_user.id, org_id=org.id, creation_date=now, update_date=now))
    await db.commit()
    maintainer = PublicUser(
        id=3, username="maint", first_name="Mai", last_name="Ntainer",
        email="maint@test.com", user_uuid="user_maint",
    )
    return SimpleNamespace(maintainer=maintainer, group=group)


@pytest.fixture
def registry():
    features = {group_tools: "usergroups", role_tools: "roles"}
    r = ToolRegistry()
    for module in (user_tools, group_tools, role_tools, org_tools):
        for spec in module.SPECS:
            # The plan feature build_registry adds for these modules.
            feature = features.get(module)
            r.register(replace(spec, feature=feature) if feature and not spec.feature else spec)
    return r


def _ctx(db, org, user, *, approved=False, can_admin=True, read_only=False):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode="execute",
        scope_key="mcp:test",
        surface="mcp",
        can_admin=can_admin,
        read_only=read_only,
        approved=approved,
    )


def _token(org_id, rights=None):
    return APITokenUser(
        id=0,
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org_id,
        rights=rights or ADMIN_RIGHTS.model_dump(),
        token_name="t",
        created_by_user_id=1,
    )


async def call(registry, name, args, ctx):
    return await run_tool(registry, name, args, ctx)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


def denied(out, code=None):
    assert out.status == "denied", out.result
    if code:
        assert out.denied_code == code, (out.denied_code, out.reason)
    return out.reason


# ─── catalog ─────────────────────────────────────────────────────────────────


def test_catalog_metadata(registry):
    names = {s.name for s in registry.specs()}
    for old in (
        "list_org_users", "get_user", "invite_users", "list_invited_users",
        "update_user_role", "remove_user_from_org", "manage_usergroup_members",
        "link_usergroup_resources", "get_org_info", "update_org_feature_config",
    ):
        assert old not in names
    for spec in registry.specs():
        assert len(spec.description) <= 450, spec.name
        assert "\u2014" not in spec.description and "\u2013" not in spec.description
        if spec.name != "get_member":
            assert spec.required_access == "admin", spec.name
        if spec.tier.value != "read":
            assert spec.may_need_approval, spec.name
            assert spec.summarize is not None, spec.name
    assert registry.get("invite_members").api_tokens is False
    assert registry.get("remove_member").api_tokens is False


# ─── members ─────────────────────────────────────────────────────────────────


async def test_list_members_pages_with_refs(registry, db, org, admin_user, setup):
    first = ok(await call(registry, "list_members", {"limit": 2}, _ctx(db, org, admin_user)))
    assert first["total"] == 3 and first["has_more"] and first["next_cursor"]
    member = first["items"][0]
    assert set(member) >= {"user_uuid", "name", "username", "email", "role", "usergroups", "joined_at"}
    assert member["role"]["kind"] == "role" and member["role"]["uuid"].startswith("role_")
    assert "id" not in member
    second = ok(
        await call(registry, "list_members", {"limit": 2, "cursor": first["next_cursor"]}, _ctx(db, org, admin_user))
    )
    assert len(second["items"]) == 1 and not second["has_more"]
    seen = {m["user_uuid"] for m in first["items"] + second["items"]}
    assert "user_outsider" not in seen


async def test_list_members_filters_and_scoping(registry, db, org, admin_user, regular_user, setup):
    by_group = ok(await call(registry, "list_members", {"usergroup_uuid": "usergroup_a"}, _ctx(db, org, admin_user)))
    assert [m["user_uuid"] for m in by_group["items"]] == ["user_regular"]
    assert by_group["items"][0]["usergroups"][0]["uuid"] == "usergroup_a"
    by_role = ok(await call(registry, "list_members", {"role_uuid": "role_global_maintainer"}, _ctx(db, org, admin_user)))
    assert [m["user_uuid"] for m in by_role["items"]] == ["user_maint"]
    denied(await call(registry, "list_members", {"role_uuid": "role_other_custom"}, _ctx(db, org, admin_user)), "http_404")
    denied(await call(registry, "list_members", {"usergroup_uuid": "usergroup_other"}, _ctx(db, org, admin_user)), "http_404")
    denied(await call(registry, "list_members", {"usergroup_uuid": "course_test"}, _ctx(db, org, admin_user)), "http_400")


async def test_list_members_denials(registry, db, org, admin_user, regular_user, setup):
    denied(await call(registry, "list_members", {}, _ctx(db, org, regular_user)), "http_403")
    denied(await call(registry, "list_members", {}, _ctx(db, org, admin_user, can_admin=False)), "insufficient_scope")
    denied(await call(registry, "list_members", {}, _ctx(db, org, admin_user, read_only=True)), "insufficient_scope")
    denied(await call(registry, "list_members", {"limit": 500}, _ctx(db, org, admin_user)), "invalid_args")


async def test_list_invited_only_pending(registry, db, org, admin_user, setup, fake_redis):
    created = datetime(2026, 10, 1, 9, 0, 0).isoformat()
    for email, pending in (("new@x.com", True), ("done@x.com", False)):
        fake_redis.set(
            f"invited_user:{email}:org:{org.org_uuid}",
            json.dumps({"email": email, "pending": pending, "email_sent": True, "expires": 86400, "created_at": created}),
        )
    out = ok(await call(registry, "list_members", {"status": "invited"}, _ctx(db, org, admin_user)))
    assert [i["email"] for i in out["items"]] == ["new@x.com"]
    assert out["items"][0]["expires_at"] == "2026-10-02T09:00:00"
    denied(await call(registry, "list_members", {"status": "invited"}, _ctx(db, org, setup.maintainer, can_admin=False)), "insufficient_scope")


async def test_get_member_views(registry, db, org, admin_user, regular_user, setup):
    full = ok(await call(registry, "get_member", {"member": "regular@test.com"}, _ctx(db, org, admin_user)))
    assert full["uuid"] == "user_regular" and full["email"] == "regular@test.com"
    assert full["role"]["uuid"] == "role_user"
    assert full["usergroups"][0]["uuid"] == "usergroup_a"
    assert "note" in full  # bio and names are member-written
    public = ok(await call(registry, "get_member", {"member": "admin"}, _ctx(db, org, regular_user)))
    assert "email" not in public and "role" not in public
    # Admin connection without admin scope gets the public view too.
    limited = ok(await call(registry, "get_member", {"member": "regular"}, _ctx(db, org, admin_user, can_admin=False)))
    assert "email" not in limited
    denied(await call(registry, "get_member", {"member": "admin@test.com"}, _ctx(db, org, regular_user)), "http_403")
    # Someone who belongs only to another organization is not found.
    denied(await call(registry, "get_member", {"member": "user_outsider"}, _ctx(db, org, admin_user)), "http_404")
    denied(await call(registry, "get_member", {"member": "out@other.com"}, _ctx(db, org, admin_user)), "http_404")


# ─── invitations ─────────────────────────────────────────────────────────────


async def test_invite_members_needs_approval_and_reports_per_email(registry, db, org, admin_user, setup, environment):
    args = {"emails": ["a@x.com", "regular@test.com", "A@x.com"]}
    denied(await call(registry, "invite_members", args, _ctx(db, org, admin_user)), "approval_required")
    environment.send.assert_not_called()

    out = ok(await call(registry, "invite_members", args, _ctx(db, org, admin_user, approved=True)))
    results = {r["email"]: r["result"] for r in out["results"]}
    assert results == {"regular@test.com": "already_member", "a@x.com": "invited"}
    assert out["ok"] is True and out["counts"]["invited"] == 1
    assert environment.send.await_count == 1

    again = ok(await call(registry, "invite_members", {"emails": ["a@x.com"]}, _ctx(db, org, admin_user, approved=True)))
    assert again["results"] == [{"email": "a@x.com", "result": "already_invited"}]


async def test_invite_members_failed_email_is_not_reported_as_success(registry, db, org, admin_user, setup, environment):
    environment.send.return_value = False
    out = ok(await call(registry, "invite_members", {"emails": ["b@x.com"]}, _ctx(db, org, admin_user, approved=True)))
    assert out["ok"] is False
    assert out["results"] == [{"email": "b@x.com", "result": "email_failed"}]
    assert "could not be sent" in out["summary"]


async def test_invite_members_limits(registry, db, org, admin_user, regular_user, setup):
    too_many = {"emails": [f"u{i}@x.com" for i in range(26)]}
    denied(await call(registry, "invite_members", too_many, _ctx(db, org, admin_user, approved=True)), "invalid_args")
    denied(await call(registry, "invite_members", {"emails": ["not-an-email"]}, _ctx(db, org, admin_user, approved=True)), "invalid_args")
    denied(await call(registry, "invite_members", {"emails": ["c@x.com"]}, _ctx(db, org, _token(org.id), approved=True)), "not_for_api_tokens")
    denied(await call(registry, "invite_members", {"emails": ["c@x.com"]}, _ctx(db, org, regular_user, approved=True)), "http_403")
    reason = denied(
        await call(registry, "invite_members", {"emails": ["c@x.com"], "usergroup_uuid": "usergroup_a"}, _ctx(db, org, admin_user, approved=True)),
        "http_400",
    )
    assert "create_invite_code" in reason
    from fastapi import HTTPException

    limit = HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "message": "Invite limit reached."})
    with patch("src.services.orgs.users.enforce_invite_rate_limit", Mock(side_effect=limit)):
        reason = denied(await call(registry, "invite_members", {"emails": ["d@x.com"]}, _ctx(db, org, admin_user, approved=True)), "http_429")
    assert reason == "Invite limit reached."


async def test_cancel_invitation(registry, db, org, admin_user, setup, fake_redis):
    ok(await call(registry, "invite_members", {"emails": ["e@x.com"]}, _ctx(db, org, admin_user, approved=True)))
    denied(await call(registry, "cancel_invitation", {"email": "e@x.com"}, _ctx(db, org, admin_user)), "approval_required")
    ok(await call(registry, "cancel_invitation", {"email": "E@x.com"}, _ctx(db, org, admin_user, approved=True)))
    assert not fake_redis.scan_iter(match="invited_user:e@x.com:*")


async def test_invite_links(registry, db, org, admin_user, regular_user, setup, fake_redis):
    denied(await call(registry, "create_invite_code", {}, _ctx(db, org, admin_user)), "approval_required")
    out = ok(
        await call(
            registry, "create_invite_code",
            {"usergroup_uuid": "usergroup_a", "expires_in_days": 7},
            _ctx(db, org, admin_user, approved=True),
        )
    )
    assert out["join_link"].startswith(f"{BASE}/signup?inviteCode=")
    assert out["usergroup"]["uuid"] == "usergroup_a"
    key = next(k for k in fake_redis.store if k.startswith(out["code_uuid"]))
    assert fake_redis.ttl[key] == 7 * 86400

    listing = ok(await call(registry, "list_invite_codes", {}, _ctx(db, org, admin_user)))
    assert listing["total"] == 1 and listing["remaining"] == 5
    item = listing["items"][0]
    assert item["code_uuid"] == out["code_uuid"] and item["usergroup"]["uuid"] == "usergroup_a"
    secret = out["join_link"].rsplit("=", 1)[1]
    assert secret not in json.dumps(listing)

    denied(await call(registry, "create_invite_code", {"usergroup_uuid": "usergroup_other"}, _ctx(db, org, admin_user, approved=True)), "http_404")
    denied(await call(registry, "list_invite_codes", {}, _ctx(db, org, regular_user)), "http_403")
    denied(await call(registry, "delete_invite_code", {"code_uuid": "org_invite_code_*"}, _ctx(db, org, admin_user, approved=True)), "http_400")
    ok(await call(registry, "delete_invite_code", {"code_uuid": out["code_uuid"]}, _ctx(db, org, admin_user, approved=True)))
    assert not fake_redis.store


async def test_invite_link_cap_is_explained(registry, db, org, admin_user, setup):
    for _ in range(user_tools.MAX_INVITE_CODES):
        ok(await call(registry, "create_invite_code", {}, _ctx(db, org, admin_user, approved=True)))
    reason = denied(await call(registry, "create_invite_code", {}, _ctx(db, org, admin_user, approved=True)), "http_400")
    assert "delete_invite_code" in reason


# ─── member roles and removal ────────────────────────────────────────────────


async def _role_of(db, org, user_id):
    row = (
        await db.execute(
            select(UserOrganization).where(UserOrganization.user_id == user_id, UserOrganization.org_id == org.id)
        )
    ).scalars().first()
    await db.refresh(row)
    return row.role_id


async def test_set_member_role(registry, db, org, admin_user, regular_user, setup):
    args = {"member": "regular", "role_uuid": "role_reviewer"}
    denied(await call(registry, "set_member_role", args, _ctx(db, org, admin_user)), "approval_required")
    out = ok(await call(registry, "set_member_role", args, _ctx(db, org, admin_user, approved=True)))
    assert out["role"]["uuid"] == "role_reviewer" and out["previous_role"]["uuid"] == "role_user"
    assert out["member"]["uuid"] == "user_regular"
    assert await _role_of(db, org, regular_user.id) == 8
    same = ok(await call(registry, "set_member_role", args, _ctx(db, org, admin_user, approved=True)))
    assert "nothing changed" in same["summary"]

    denied(await call(registry, "set_member_role", {"member": "regular", "role_uuid": "role_other_custom"}, _ctx(db, org, admin_user, approved=True)), "http_404")
    denied(await call(registry, "set_member_role", {"member": "regular", "role_uuid": "usergroup_a"}, _ctx(db, org, admin_user, approved=True)), "http_400")
    denied(await call(registry, "set_member_role", {"member": "outsider", "role_uuid": "role_reviewer"}, _ctx(db, org, admin_user, approved=True)), "http_404")
    # No changing your own role; learners cannot change roles at all.
    denied(await call(registry, "set_member_role", {"member": "admin", "role_uuid": "role_user"}, _ctx(db, org, admin_user, approved=True)), "http_403")
    denied(await call(registry, "set_member_role", {"member": "maint", "role_uuid": "role_user"}, _ctx(db, org, regular_user, approved=True)), "http_403")


async def test_maintainer_cannot_grant_admin(registry, db, org, admin_user, regular_user, setup):
    out = await call(
        registry, "set_member_role", {"member": "regular", "role_uuid": "role_admin"},
        _ctx(db, org, setup.maintainer, approved=True),
    )
    assert "Admin or Maintainer" in denied(out, "http_403")
    assert await _role_of(db, org, regular_user.id) == 4


async def test_remove_member(registry, db, org, other_org, admin_user, regular_user, setup):
    from src.db.mcp_oauth import MCPOAuthClient, MCPOAuthGrant

    db.add(MCPOAuthClient(client_id="client_x", redirect_uris=[], created_at=1))
    await db.commit()
    for gid, org_id in ((1, org.id), (2, other_org.id)):
        db.add(MCPOAuthGrant(grant_uuid=f"grant_{gid}", client_id="client_x", user_id=regular_user.id, org_id=org_id, created_at=1))
    await db.commit()

    denied(await call(registry, "remove_member", {"member": "regular"}, _ctx(db, org, admin_user)), "approval_required")
    out = ok(await call(registry, "remove_member", {"member": "user_regular"}, _ctx(db, org, admin_user, approved=True)))
    assert out["member"]["uuid"] == "user_regular" and out["ai_connections_revoked"] == 1
    grants = {
        g.org_id: g.revoked_at
        for g in (await db.execute(select(MCPOAuthGrant))).scalars().all()
    }
    assert grants[org.id] is not None and grants[other_org.id] is None
    assert (
        await db.execute(select(UserOrganization).where(UserOrganization.user_id == regular_user.id))
    ).scalars().first() is None
    # Their group membership in this org went with them.
    assert (await db.execute(select(UserGroupUser).where(UserGroupUser.user_id == regular_user.id))).first() is None


async def test_remove_member_refusals(registry, db, org, admin_user, regular_user, setup):
    denied(await call(registry, "remove_member", {"member": "admin"}, _ctx(db, org, admin_user, approved=True)), "http_400")
    denied(await call(registry, "remove_member", {"member": "outsider"}, _ctx(db, org, admin_user, approved=True)), "http_404")
    denied(await call(registry, "remove_member", {"member": "regular"}, _ctx(db, org, _token(org.id), approved=True)), "not_for_api_tokens")
    denied(await call(registry, "remove_member", {"member": "maint"}, _ctx(db, org, regular_user, approved=True)), "http_403")


# ─── user groups ─────────────────────────────────────────────────────────────


async def test_list_and_get_usergroup(registry, db, org, admin_user, regular_user, setup, course):
    db.add(UserGroupResource(usergroup_id=1, resource_uuid=course.course_uuid, org_id=org.id, creation_date="", update_date=""))
    await db.commit()
    listing = ok(await call(registry, "list_usergroups", {}, _ctx(db, org, admin_user)))
    assert listing["total"] == 1
    group = listing["items"][0]
    assert group["uuid"] == "usergroup_a" and group["members"] == 1 and group["linked_resources"] == 1

    detail = ok(await call(registry, "get_usergroup", {"usergroup_uuid": "usergroup_a"}, _ctx(db, org, admin_user)))
    assert detail["members"]["items"][0]["uuid"] == "user_regular"
    assert detail["resources"]["items"][0] == {
        "kind": "course", "uuid": "course_test", "name": "Test Course", "url": f"{BASE}/course/test",
    }
    denied(await call(registry, "get_usergroup", {"usergroup_uuid": "usergroup_other"}, _ctx(db, org, admin_user)), "http_404")
    denied(await call(registry, "get_usergroup", {"usergroup_uuid": "usergroup_a"}, _ctx(db, org, regular_user)), "http_403")


async def test_create_usergroup_reports_each_item(registry, db, org, admin_user, regular_user, setup):
    plain = ok(await call(registry, "create_usergroup", {"name": "Empty"}, _ctx(db, org, admin_user)))
    assert plain["usergroup"]["uuid"].startswith("usergroup_")

    args = {
        "name": "Cohort B",
        "members": ["regular", "user_ghost", "outsider", "maint@test.com"],
        "resource_uuids": ["course_test", "course_other", "chapter_x", "course_missing"],
    }
    denied(await call(registry, "create_usergroup", args, _ctx(db, org, admin_user)), "approval_required")
    out = ok(await call(registry, "create_usergroup", args, _ctx(db, org, admin_user, approved=True)))
    members = {r["member"]: r["result"] for r in out["member_results"]}
    assert members == {
        "regular": "added", "user_ghost": "not_a_member", "outsider": "not_a_member", "maint@test.com": "added",
    }
    resources = {r["resource_uuid"]: r["result"] for r in out["resource_results"]}
    assert resources == {
        "course_test": "linked", "course_other": "not_found", "chapter_x": "not_linkable", "course_missing": "not_found",
    }
    group = (await db.execute(select(UserGroup).where(UserGroup.name == "Cohort B"))).scalars().first()
    linked = (await db.execute(select(UserGroupResource.resource_uuid).where(UserGroupResource.usergroup_id == group.id))).scalars().all()
    assert linked == ["course_test"]


async def test_update_usergroup(registry, db, org, admin_user, regular_user, setup):
    rename = ok(await call(registry, "update_usergroup", {"usergroup_uuid": "usergroup_a", "name": "Cohort A2"}, _ctx(db, org, admin_user)))
    assert rename["usergroup"]["name"] == "Cohort A2"

    args = {
        "usergroup_uuid": "usergroup_a",
        "add_members": ["maint", "regular"],
        "remove_members": ["regular"],
        "link_resources": ["course_test"],
    }
    denied(await call(registry, "update_usergroup", args, _ctx(db, org, admin_user)), "approval_required")
    out = ok(await call(registry, "update_usergroup", args, _ctx(db, org, admin_user, approved=True)))
    assert {(r["member"], r["result"]) for r in out["member_results"]} == {
        ("maint", "added"), ("regular", "already_in_group"), ("regular", "removed"),
    }
    assert out["resource_results"] == [{"resource_uuid": "course_test", "result": "linked"}]
    unlink = ok(
        await call(
            registry, "update_usergroup",
            {"usergroup_uuid": "usergroup_a", "unlink_resources": ["course_test", "course_other"]},
            _ctx(db, org, admin_user, approved=True),
        )
    )
    assert {r["resource_uuid"]: r["result"] for r in unlink["resource_results"]} == {
        "course_test": "unlinked", "course_other": "was_not_linked",
    }

    denied(await call(registry, "update_usergroup", {"usergroup_uuid": "usergroup_other", "name": "x"}, _ctx(db, org, admin_user)), "http_404")
    denied(await call(registry, "update_usergroup", {"usergroup_uuid": "usergroup_a"}, _ctx(db, org, admin_user)), "http_400")
    # A learner gets refused before any per-item result is computed.
    denied(await call(registry, "update_usergroup", {"usergroup_uuid": "usergroup_a", "add_members": ["maint"]}, _ctx(db, org, regular_user, approved=True)), "http_403")
    denied(
        await call(registry, "update_usergroup", {"usergroup_uuid": "usergroup_a", "add_members": [f"u{i}" for i in range(101)]}, _ctx(db, org, admin_user)),
        "invalid_args",
    )


async def test_delete_usergroup(registry, db, org, admin_user, setup):
    denied(await call(registry, "delete_usergroup", {"usergroup_uuid": "usergroup_a"}, _ctx(db, org, admin_user)), "approval_required")
    denied(await call(registry, "delete_usergroup", {"usergroup_uuid": "usergroup_other"}, _ctx(db, org, admin_user, approved=True)), "http_404")
    out = ok(await call(registry, "delete_usergroup", {"usergroup_uuid": "usergroup_a"}, _ctx(db, org, admin_user, approved=True)))
    assert out["usergroup"]["uuid"] == "usergroup_a"
    assert (await db.execute(select(UserGroup).where(UserGroup.id == 1))).first() is None


# ─── roles ───────────────────────────────────────────────────────────────────


async def test_list_and_get_roles(registry, db, org, admin_user, regular_user, setup):
    listing = ok(await call(registry, "list_roles", {}, _ctx(db, org, admin_user)))
    by_uuid = {r["uuid"]: r for r in listing["items"]}
    assert "role_other_custom" not in by_uuid
    assert by_uuid["role_global_maintainer"]["scope"] == "global" and not by_uuid["role_global_maintainer"]["editable"]
    assert by_uuid["role_user"]["members"] == 1
    assert by_uuid["role_user"]["rights"]["courses"].startswith("read")

    role = ok(await call(registry, "get_role", {"role_uuid": "role_reviewer"}, _ctx(db, org, admin_user)))
    assert role["rights"]["courses"]["action_read"] is True
    assert role["rights"]["courses"]["action_update"] is False
    assert set(role["rights"]) == set(role_tools._BUCKETS)
    denied(await call(registry, "get_role", {"role_uuid": "role_other_custom"}, _ctx(db, org, admin_user)), "http_404")
    # Learners hold roles read in this fixture, but not the admin scope's tools.
    denied(await call(registry, "list_roles", {}, _ctx(db, org, regular_user, can_admin=False)), "insufficient_scope")


async def test_create_role_from_base_with_patch(registry, db, org, admin_user, setup):
    args = {
        "name": "Editor",
        "base_role_uuid": "role_user",
        "rights": {"courses": {"action_update": True}, "dashboard": {"action_access": True}},
    }
    denied(await call(registry, "create_role", args, _ctx(db, org, admin_user)), "approval_required")
    out = ok(await call(registry, "create_role", args, _ctx(db, org, admin_user, approved=True)))
    assert out["role"]["uuid"].startswith("role_")
    row = (await db.execute(select(Role).where(Role.role_uuid == out["role"]["uuid"]))).scalars().first()
    assert row.org_id == org.id and row.role_type == RoleTypeEnum.TYPE_ORGANIZATION
    assert row.rights["courses"]["action_update"] is True
    assert row.rights["courses"]["action_read"] is True  # from the base role
    assert row.rights["users"]["action_delete"] is False
    assert set(row.rights) == set(role_tools._BUCKETS)

    empty = ok(await call(registry, "create_role", {"name": "Nothing"}, _ctx(db, org, admin_user, approved=True)))
    blank = (await db.execute(select(Role).where(Role.role_uuid == empty["role"]["uuid"]))).scalars().first()
    assert not any(v for perms in blank.rights.values() for v in perms.values())

    denied(await call(registry, "create_role", {"name": "X", "rights": {"bogus": {"action_read": True}}}, _ctx(db, org, admin_user, approved=True)), "invalid_args")
    denied(await call(registry, "create_role", {"name": "X", "rights": {"courses": {"action_fly": True}}}, _ctx(db, org, admin_user, approved=True)), "invalid_args")
    denied(await call(registry, "create_role", {"name": "X", "base_role_uuid": "role_other_custom"}, _ctx(db, org, admin_user, approved=True)), "http_404")


async def test_create_role_cannot_exceed_own_rights(registry, db, org, admin_user, regular_user, setup):
    # Give the learner the right to create roles, but nothing else extra.
    rights = USER_RIGHTS.model_dump()
    rights["roles"]["action_create"] = True
    role = (await db.execute(select(Role).where(Role.id == 4))).scalars().first()
    role.rights = rights
    db.add(role)
    await db.commit()
    out = await call(
        registry, "create_role", {"name": "Sneaky", "rights": {"users": {"action_delete": True}}},
        _ctx(db, org, regular_user, approved=True),
    )
    assert "don't have this permission" in denied(out, "http_403")


async def test_update_and_delete_roles(registry, db, org, admin_user, setup):
    args = {"role_uuid": "role_reviewer", "rights": {"courses": {"action_create": True}}, "name": "Reviewer+"}
    denied(await call(registry, "update_role", args, _ctx(db, org, admin_user)), "approval_required")
    out = ok(await call(registry, "update_role", args, _ctx(db, org, admin_user, approved=True)))
    assert "create" in out["rights"]["courses"] and "create" not in out["rights_before"]["courses"]
    row = (await db.execute(select(Role).where(Role.id == 8))).scalars().first()
    await db.refresh(row)
    assert row.name == "Reviewer+" and row.rights["courses"]["action_create"] is True
    assert row.rights["courses"]["action_read"] is True

    assert "built-in" in denied(await call(registry, "update_role", {"role_uuid": "role_global_maintainer", "name": "x"}, _ctx(db, org, admin_user, approved=True)), "http_403")
    denied(await call(registry, "update_role", {"role_uuid": "role_other_custom", "name": "x"}, _ctx(db, org, admin_user, approved=True)), "http_404")
    denied(await call(registry, "update_role", {"role_uuid": "role_reviewer"}, _ctx(db, org, admin_user, approved=True)), "http_400")

    # A role someone holds cannot be deleted out from under them.
    assert "set_member_role" in denied(await call(registry, "delete_role", {"role_uuid": "role_user"}, _ctx(db, org, admin_user, approved=True)), "http_409")
    denied(await call(registry, "delete_role", {"role_uuid": "role_reviewer"}, _ctx(db, org, admin_user)), "approval_required")
    ok(await call(registry, "delete_role", {"role_uuid": "role_reviewer"}, _ctx(db, org, admin_user, approved=True)))
    assert (await db.execute(select(Role).where(Role.id == 8))).first() is None


# ─── organization ────────────────────────────────────────────────────────────


async def _org_config(db, org) -> dict:
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
    await db.refresh(row)
    return row.config


async def test_get_org_settings(registry, db, org, admin_user, regular_user, setup):
    out = ok(await call(registry, "get_org_settings", {}, _ctx(db, org, admin_user)))
    assert out["profile"]["name"] == "Test Org" and out["profile"]["email"] == "test@org.com"
    assert out["signup"]["mode"] == "open" and out["plan"] == "enterprise"
    assert out["branding"]["color"] == "#111111"
    assert out["landing"] == {"home_published": False, "home_sections": 0, "extra_pages": [], "edit_with": "get_landing_page and the other landing page tools"}
    assert "scripts" not in json.dumps(out["profile"])
    assert set(out["features"]) == set(org_tools._TOGGLES)
    denied(await call(registry, "get_org_settings", {}, _ctx(db, org, regular_user, can_admin=False)), "insufficient_scope")


async def test_update_org_profile(registry, db, org, admin_user, regular_user, setup):
    args = {
        "name": "Renamed Org",
        "socials": {"twitter": "https://x.com/acme"},
        "links": [{"label": "Blog", "url": "https://blog.example"}],
    }
    denied(await call(registry, "update_org", args, _ctx(db, org, admin_user)), "approval_required")
    out = ok(await call(registry, "update_org", args, _ctx(db, org, admin_user, approved=True)))
    assert set(out["fields"]) == {"name", "socials", "links"}
    await db.refresh(org)
    assert org.name == "Renamed Org" and org.links == {"Blog": "https://blog.example"}
    assert org.socials["twitter"] == "https://x.com/acme"

    denied(await call(registry, "update_org", {"socials": {"twitter": "javascript:alert(1)"}}, _ctx(db, org, admin_user, approved=True)), "invalid_args")
    denied(await call(registry, "update_org", {"label": "not-a-label"}, _ctx(db, org, admin_user, approved=True)), "invalid_args")
    denied(await call(registry, "update_org", {"name": "x" * 61}, _ctx(db, org, admin_user, approved=True)), "invalid_args")
    # The address cannot be moved from here.
    denied(await call(registry, "update_org", {"slug": "moved"}, _ctx(db, org, admin_user, approved=True)), "http_400")
    await db.refresh(org)
    assert org.slug == "test-org"
    denied(await call(registry, "update_org", {"name": "Nope"}, _ctx(db, org, regular_user, approved=True)), "http_403")


async def test_update_org_settings_validation(registry, db, org, admin_user, setup):
    ctx = _ctx(db, org, admin_user, approved=True)
    for bad in (
        {"section": "branding", "color": "not-a-color"},
        {"section": "branding", "color": "red;}</style><script>alert(1)</script>"},
        {"section": "branding", "font": "Comic Sans"},
        {"section": "ai", "unknown": True},
        {"section": "features", "payments": False},
        {"section": "mcp", "enabled": False},
        {"section": "security", "require_2fa": False},
        {"section": "menu", "items": [{"type": "custom", "url": "javascript:alert(1)"}]},
        # Landing pages moved to the landing page tools.
        {"section": "landing", "enabled": True},
    ):
        denied(await call(registry, "update_org_settings", {"settings": bad}, ctx), "invalid_args")
    config = await _org_config(db, org)
    assert config["customization"]["general"]["color"] == "#111111"


async def test_update_org_settings_is_admin_only(registry, db, org, admin_user, setup):
    args = {"settings": {"section": "features", "communities": False}}
    assert "admins" in denied(await call(registry, "update_org_settings", args, _ctx(db, org, setup.maintainer, approved=True)), "preflight_denied")
    # An API token made by a maintainer is refused the same way.
    token = _token(org.id)
    token.created_by_user_id = setup.maintainer.id
    denied(await call(registry, "update_org_settings", args, _ctx(db, org, token, approved=True)), "preflight_denied")
    denied(await call(registry, "update_org_settings", args, _ctx(db, org, admin_user)), "approval_required")
    ok(await call(registry, "update_org_settings", args, _ctx(db, org, admin_user, approved=True)))
    assert (await _org_config(db, org))["admin_toggles"]["communities"]["org_disabled"] is True


async def test_update_org_settings_sections(registry, db, org, admin_user, setup):
    ctx = _ctx(db, org, admin_user, approved=True)

    async def apply(section):
        return ok(await call(registry, "update_org_settings", {"settings": section}, ctx))

    await apply({"section": "signup", "mode": "invite_only"})
    config = await _org_config(db, org)
    assert config["admin_toggles"]["members"]["signup_mode"] == "inviteOnly"

    out = await apply({"section": "branding", "color": "#2563eb", "font": "Inter"})
    assert set(out["fields"]) == {"color", "font"}
    general = (await _org_config(db, org))["customization"]["general"]
    assert general["color"] == "#2563eb" and general["font"] == "Inter"

    await apply({"section": "ai", "copilot_enabled": False})
    assert (await _org_config(db, org))["admin_toggles"]["ai"]["copilot_enabled"] is False

    await apply({"section": "menu", "items": [{"type": "custom", "label": "Docs", "url": "https://docs.example"}]})
    items = (await _org_config(db, org))["customization"]["menu"]["items"]
    assert [i["type"] for i in items] == ["courses", "custom"]
    await apply({"section": "menu", "items": [{"type": "courses", "enabled": False}]})
    items = (await _org_config(db, org))["customization"]["menu"]["items"]
    assert items[0]["enabled"] is False and len(items) == 2
    await apply({"section": "menu", "mode": "replace", "items": [{"type": "library"}]})
    assert [i["type"] for i in (await _org_config(db, org))["customization"]["menu"]["items"]] == ["library"]

    await apply({"section": "course_end", "message": "Well done", "button_link": "/courses"})
    assert (await _org_config(db, org))["customization"]["course_end"]["message"] == "Well done"

    await apply({"section": "seo", "twitter_handle": "@acme"})
    assert (await _org_config(db, org))["customization"]["seo"]["twitter_handle"] == "@acme"

    await apply({"section": "auth_branding", "welcome_message": "Welcome back", "text_color": "dark"})
    auth = (await _org_config(db, org))["customization"]["auth_branding"]
    assert auth["welcome_message"] == "Welcome back" and auth["background_type"] == "gradient"

    await apply({"section": "library_sort", "sort_mode": "newest"})
    assert (await _org_config(db, org))["general"]["folders"]["sort_mode"] == "newest"

    await apply({"section": "features", "boards": False, "podcasts": True})
    toggles = (await _org_config(db, org))["admin_toggles"]
    assert toggles["boards"]["org_disabled"] is True and toggles["podcasts"]["org_disabled"] is False

    # A refused field leaves the rest of the section untouched.
    denied(
        await call(registry, "update_org_settings", {"settings": {"section": "branding", "default_language": "xx", "color": "#000000"}}, ctx),
        "http_400",
    )
    assert (await _org_config(db, org))["customization"]["general"]["color"] == "#2563eb"

    denied(await call(registry, "update_org_settings", {"settings": {"section": "ai"}}, ctx), "http_400")
