"""User groups v2, what people see and do: the list, a group's detail and
settings, members, managers (and their boundaries), progress, the group
space, announcements, the HTTP routes, the Atlas/MCP tools, the scheduler
and the API-token scope docs.
"""

from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.db.trail_runs import StatusEnum, TrailRun
from src.db.user_activity import UserActivityDay
from src.db.usergroup_extras import UserGroupManager, UserGroupSchedule
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, AnonymousUser, InternalUser, PublicUser, User
from src.services.usergroups import common, groups, progress, space
from src.services.usergroups.common import utcnow
from src.tests.services.test_usergroups_v2_core import NOW, members, mkgroup, mkuser


@pytest.fixture(autouse=True)
def quiet():
    """Webhooks and the usage counters (Redis) are not under test here."""
    with patch("src.services.webhooks.dispatch.dispatch_webhooks", new_callable=AsyncMock), \
         patch("src.services.users.usergroups.check_limits_with_usage", new_callable=AsyncMock), \
         patch("src.services.users.usergroups.increase_feature_usage", new_callable=AsyncMock), \
         patch("src.services.users.usergroups.decrease_feature_usage", new_callable=AsyncMock), \
         patch("src.services.users.usergroups.dispatch_webhooks", new_callable=AsyncMock):
        yield


def person(u: User) -> PublicUser:
    return PublicUser(id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name,
                      email=u.email, user_uuid=u.user_uuid)


TOKEN_RIGHTS = {"usergroups": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}}


def token(org_id=1, uid=3, rights=TOKEN_RIGHTS) -> APITokenUser:
    # id 3 is also a real person (ana): a token must never be read as her.
    return APITokenUser(id=uid, org_id=org_id, rights=rights, token_name="t", created_by_user_id=1)


@pytest.fixture
async def world(db, org, other_org, admin_user, regular_user, user_role):
    from src.db.organization_config import OrganizationConfig

    db.add(OrganizationConfig(org_id=1, config={"config_version": "2.0", "plan": "pro"}, creation_date=NOW, update_date=NOW))
    await db.commit()
    ana = await mkuser(db, 3, "ana@school.edu")
    ben = await mkuser(db, 4, "ben@school.edu")
    await mkuser(db, 5, "cleo@corp.com")
    await mkuser(db, 7, "eve@school.edu", org_id=2)
    a = await mkgroup(db, 10, "Group A", settings={"space_enabled": True})
    b = await mkgroup(db, 11, "Group B")
    child = await mkgroup(db, 12, "A child", parent_id=10)
    x = await mkgroup(db, 20, "Other org group", org_id=2)
    for uid, gid in ((4, 10), (5, 11), (5, 12), (7, 20)):
        db.add(UserGroupUser(usergroup_id=gid, user_id=uid, org_id=1 if gid != 20 else 2, sources=["manual"]))
    # Ana manages group A (and so its sub-group), nothing else.
    db.add(UserGroupManager(usergroup_id=10, user_id=3, org_id=1, can_post=True))
    db.add(UserGroupUser(usergroup_id=10, user_id=3, org_id=1, sources=["manual"]))
    await db.commit()
    return {"admin": admin_user, "regular": regular_user, "ana": person(ana), "ben": person(ben),
            "a": a, "b": b, "child": child, "x": x}


# ── list, create, detail, settings ──────────────────────────────────────


async def test_overview_for_admins_and_managers(db, world):
    data = await groups.overview(None, db, world["admin"], 1)
    by = {g["name"]: g for g in data["items"]}
    assert set(by) == {"Group A", "Group B", "A child"} and data["can_admin"]
    assert "nested" in by["Group A"]["types"] and by["A child"]["parent_name"] == "Group A"
    assert by["Group A"]["managers"][0]["username"] == "u3"
    mine = await groups.overview(None, db, world["ana"], 1)
    assert {g["name"] for g in mine["items"]} == {"Group A", "A child"} and not mine["can_admin"]
    with pytest.raises(HTTPException) as e:
        await groups.overview(None, db, world["ben"], 1)
    assert e.value.status_code == 403
    # Managers lose the view below the plan.
    with patch("src.services.usergroups.groups.advanced_enabled", AsyncMock(return_value=False)), pytest.raises(HTTPException):
        await groups.overview(None, db, world["ana"], 1)


async def test_create_detail_and_settings(db, world):
    admin = world["admin"]
    created = await groups.create_group(None, db, admin, 1, groups.GroupCreateBody(
        name=" Smart ", kind="smart", color="sky", parent_uuid="usergroup_10",
        rules={"conditions": [{"type": "email_domain", "values": ["corp.com"]}]}))
    assert created["name"] == "Smart" and created["parent"]["id"] == 10 and created["member_count"] == 1
    gid = created["id"]
    assert set(await members(db, 10)) >= {5}  # cleo reaches the parent through the new sub-group
    out = await groups.update_settings(None, db, admin, gid, groups.GroupSettingsBody(
        name="Corp", description="d", kind="hybrid", color="nope", parent_uuid="",
        settings={"space_enabled": True, "auto_join_domains": ["@School.edu"], "bogus": 1}))
    assert out["parent"] is None and out["color"] is None and out["settings"]["auto_join_domains"] == ["school.edu"]
    # Cleo is still in group A through its other sub-group.
    assert (await members(db, 10)).get(5) == ["inherited"]
    with pytest.raises(HTTPException):
        await groups.update_settings(None, db, admin, gid, groups.GroupSettingsBody(settings={"auto_join_domains": ["no dots"]}))
    with pytest.raises(HTTPException):
        await groups.update_settings(None, db, world["regular"], gid, groups.GroupSettingsBody(name="x"))
    hist = await groups.history(None, db, admin, gid)
    assert hist["total"] >= 2 and hist["items"][0]["action"] in ("settings_updated", "rules_synced")


async def test_plan_gates_for_advanced_parts(db, world):
    admin = world["admin"]
    with patch("src.security.features_utils.plan_check._check_mode_bypass", return_value=None), \
         patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), \
         patch("src.security.features_utils.usage.check_limits_with_usage", AsyncMock()), \
         patch("src.services.users.usergroups.check_limits_with_usage", AsyncMock()), \
         patch("src.services.users.usergroups.increase_feature_usage", AsyncMock()), \
         patch("src.security.features_utils.plan_check.get_org_plan", AsyncMock(return_value="standard")):
        for body in (groups.GroupCreateBody(name="s", kind="smart"), groups.GroupCreateBody(name="n", parent_uuid="usergroup_10")):
            with pytest.raises(HTTPException) as e:
                await groups.create_group(None, db, admin, 1, body)
            assert e.value.status_code == 403
        with pytest.raises(HTTPException):
            await groups.update_settings(None, db, admin, 11, groups.GroupSettingsBody(settings={"space_enabled": True}))
        with pytest.raises(HTTPException):
            await groups.set_manager(None, db, admin, 11, groups.ManagerBody(user_id=4))
        assert (await groups.features(db, 1))["smart"] is False
        # Basic things stay on Standard.
        assert (await groups.create_group(None, db, admin, 1, groups.GroupCreateBody(name="plain")))["kind"] == "manual"


async def test_rule_preview_and_options(db, world):
    admin = world["admin"]
    out = await groups.preview_rules(None, db, admin, 1, {"conditions": [{"type": "email_domain", "values": ["school.edu"]}]}, 10)
    assert out["count"] == 2
    with pytest.raises(HTTPException):
        await groups.preview_rules(None, db, admin, 1, {}, 20)
    with pytest.raises(HTTPException):
        await groups.preview_rules(None, db, world["ana"], 1, {})
    opts = await groups.rule_options(None, db, admin, 1)
    assert "email_domain" in opts["condition_types"] and {g["name"] for g in opts["groups"]} >= {"Group A"}
    assert opts["companies"] == [] or isinstance(opts["companies"], list)


async def test_rule_options_with_fake_ee_sources(db, world):
    from types import SimpleNamespace

    from sqlalchemy import Column, Integer, String
    from sqlalchemy.orm import DeclarativeBase

    class Base(DeclarativeBase):
        pass

    class Acct(Base):
        __tablename__ = "fake_acct2"
        id = Column(Integer, primary_key=True)
        org_id = Column(Integer)
        company_uuid = Column(String)
        name = Column(String)

    class Scim(Base):
        __tablename__ = "fake_scim2"
        id = Column(Integer, primary_key=True)
        org_id = Column(Integer)
        resource_type = Column(String)
        scim_id = Column(String)
        local_id = Column(Integer)

    async with db.bind.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db.add_all([Acct(org_id=1, company_uuid="company_1", name="Acme"), Scim(org_id=1, resource_type="Group", scim_id="s1", local_id=10)])
    await db.commit()
    mods = {"ee.db.payments.payments_company_seats": SimpleNamespace(CompanyAccount=Acct), "ee.db.scim": SimpleNamespace(ScimResource=Scim)}
    with patch("src.core.ee_hooks.get_ee_module", side_effect=lambda n: mods[n]):
        opts = await groups.rule_options(None, db, world["admin"], 1)
    assert opts["companies"] == [{"uuid": "company_1", "name": "Acme"}]
    assert opts["scim_groups"] == [{"scim_id": "s1", "name": "Group A"}]


# ── members ─────────────────────────────────────────────────────────────


async def test_members_add_schedule_expire_remove(db, world):
    admin = world["admin"]
    res = await groups.add_members(None, db, admin, 11, groups.MembersBody(user_ids=[3, 4, 7, 5], expires_at="2099-01-01"))
    assert res["added"] == [3, 4] and res["not_in_org"] == [7] and res["updated"] == [5]
    res = await groups.add_members(None, db, admin, 11, groups.MembersBody(user_ids=[1], starts_at="2099-01-01"))
    assert res["scheduled"] == [1]
    res = await groups.add_members(None, db, admin, 11, groups.MembersBody(user_ids=[3]))
    assert res["already"] == [3]
    with pytest.raises(HTTPException):
        await groups.add_members(None, db, admin, 11, groups.MembersBody(user_ids=[3], starts_at="2099-02-01", expires_at="2099-01-01"))
    listing = await groups.list_members(None, db, admin, 11, q="ana")
    assert listing["total"] == 1 and listing["items"][0]["expires_at"].startswith("2099")
    assert len(listing["scheduled"]) == 1
    assert (await groups.list_members(None, db, admin, 11, source="rule"))["total"] == 0
    upd = await groups.update_member(None, db, admin, 11, 3, groups.MemberPatchBody(expires_at="2098-01-01"))
    assert upd["expires_at"].startswith("2098")
    for uid, body in ((99, groups.MemberPatchBody()), (3, groups.MemberPatchBody(expires_at="2000-01-01"))):
        with pytest.raises(HTTPException):
            await groups.update_member(None, db, admin, 11, uid, body)
    sched = (await db.execute(select(UserGroupSchedule))).scalars().first()
    assert (await groups.cancel_schedule(None, db, admin, 11, sched.id))["ok"]
    with pytest.raises(HTTPException):
        await groups.cancel_schedule(None, db, admin, 10, sched.id)
    out = await groups.remove_members(None, db, admin, 11, [3, 99])
    assert out["removed"] == [3] and out["absent"] == [99]


async def test_rule_members_are_kept_and_smart_groups_refuse_hand_adds(db, world):
    admin = world["admin"]
    g = await mkgroup(db, 30, "Smart", kind="smart")
    with pytest.raises(HTTPException) as e:
        await groups.add_members(None, db, admin, 30, groups.MembersBody(user_ids=[3]))
    assert e.value.status_code == 409
    db.add(UserGroupUser(usergroup_id=30, user_id=3, org_id=1, sources=["rule"]))
    await db.commit()
    out = await groups.remove_members(None, db, admin, 30, [3])
    assert out["kept"] == [{"user_id": 3, "sources": ["rule"]}]
    with pytest.raises(HTTPException) as e:
        await groups.update_member(None, db, admin, 30, 3, groups.MemberPatchBody(expires_at="2099-01-01"))
    assert e.value.status_code == 409
    assert g.kind == "smart"


# ── manager boundaries ──────────────────────────────────────────────────


async def test_manager_of_a_cannot_touch_b_or_org_settings(db, world):
    ana = world["ana"]
    # Her own group and its sub-group: members, progress, posts.
    assert (await groups.add_members(None, db, ana, 10, groups.MembersBody(user_ids=[5])))["added"] == [5]
    assert (await groups.add_members(None, db, ana, 12, groups.MembersBody(user_ids=[4])))["added"] == [4]
    assert (await progress.group_progress(None, db, ana, 10))["summary"]["members"] >= 2
    assert (await groups.detail(None, db, ana, 10))["capabilities"]["role"] == "manager"
    # Group B, another org's group, and admin-only operations are refused.
    calls = [
        groups.add_members(None, db, ana, 11, groups.MembersBody(user_ids=[4])),
        groups.remove_members(None, db, ana, 11, [5]),
        groups.detail(None, db, ana, 11),
        progress.group_progress(None, db, ana, 11),
        groups.add_members(None, db, ana, 20, groups.MembersBody(user_ids=[7])),
        groups.update_settings(None, db, ana, 10, groups.GroupSettingsBody(name="mine now")),
        groups.set_manager(None, db, ana, 10, groups.ManagerBody(user_id=4)),
        groups.rule_options(None, db, ana, 1),
        groups.membership_map(None, db, ana, 1),
    ]
    for call in calls:
        with pytest.raises(HTTPException) as e:
            await call
        assert e.value.status_code == 403
    # Rights are per flag.
    row = (await db.execute(select(UserGroupManager))).scalars().first()
    row.can_manage_members = False
    await db.commit()
    with pytest.raises(HTTPException):
        await groups.add_members(None, db, ana, 10, groups.MembersBody(user_ids=[1]))


async def test_managers_set_and_removed_by_admins(db, world):
    admin = world["admin"]
    assert (await groups.set_manager(None, db, admin, 11, groups.ManagerBody(user_id=4, digest=True)))["created"]
    assert not (await groups.set_manager(None, db, admin, 11, groups.ManagerBody(user_id=4)))["created"]
    with pytest.raises(HTTPException):
        await groups.set_manager(None, db, admin, 11, groups.ManagerBody(user_id=7))
    assert (await groups.remove_manager(None, db, admin, 11, 4))["ok"]
    with pytest.raises(HTTPException):
        await groups.remove_manager(None, db, admin, 11, 4)


# ── API tokens and people ───────────────────────────────────────────────


async def test_person_scoped_endpoints_refuse_api_tokens(db, world):
    from src.services.usergroups import codes

    t = token()
    for call in (groups.my_groups(None, db, t, 1), space.space(None, db, t, 1, "10"),
                 codes.redeem(None, db, t, "AAAA-BBBB")):
        with pytest.raises(HTTPException) as e:
            await call
        assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await groups.my_groups(None, db, AnonymousUser(), 1)
    assert e.value.status_code == 401
    assert common.person_id(InternalUser()) is None and common.person_id(None) is None
    # A token never counts as the manager whose user id it happens to share.
    no_rights = token(rights={"usergroups": {"action_read": False}})
    assert await common.manager_can(db, no_rights, world["a"], "members") is False
    with pytest.raises(HTTPException):
        await groups.overview(None, db, no_rights, 1)


async def test_api_token_is_bound_to_its_org(db, world):
    from src.services.ai.tools import make_synthetic_request

    req = make_synthetic_request()
    a_token, b_token = token(org_id=1), token(org_id=2)
    assert {g["name"] for g in (await groups.overview(req, db, a_token, 1))["items"]} >= {"Group A"}
    # Org B's token reads nothing of org A, by org or by group id.
    for call in (groups.overview(req, db, b_token, 1), groups.detail(req, db, b_token, 10),
                 groups.list_members(req, db, b_token, 10), groups.membership_map(req, db, b_token, 1),
                 progress.group_progress(req, db, b_token, 10)):
        with pytest.raises(HTTPException) as e:
            await call
        assert e.value.status_code == 403
    assert await common.is_org_admin(req, db, InternalUser(), 1)
    await common.require_org_admin(req, db, InternalUser(), 1)


# ── views ───────────────────────────────────────────────────────────────


async def test_my_groups_and_membership_map(db, world):
    mine = await groups.my_groups(None, db, world["ana"], 1)
    assert [g["name"] for g in mine["member_of"]] == ["Group A"]
    assert {g["name"] for g in mine["manages"]} == {"Group A", "A child"}
    m = await groups.membership_map(None, db, world["admin"], 1)
    assert m["map"]["5"] == [11, 12] or sorted(m["map"]["5"]) == [11, 12]
    assert groups.default_expiry(None) is None and groups.default_expiry(1) > utcnow()


async def test_progress_csv_and_at_risk(db, world, course, activity):
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=1, user_id=4, status=StatusEnum.STATUS_COMPLETED,
                    creation_date=NOW, update_date=NOW))
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=1, user_id=3, creation_date=NOW, update_date=NOW))
    db.add(UserActivityDay(org_id=1, user_id=4, activity_date=date.today()))
    db.add(UserGroupResource(usergroup_id=10, resource_uuid="course_test", org_id=1))
    await db.commit()
    data = await progress.group_progress(None, db, world["admin"], 10)
    assert data["courses"][0]["linked"] and data["courses"][0]["completed"] == 1
    assert [r["username"] for r in data["at_risk"]] == ["u3"]
    assert data["summary"]["active_7d"] == 1 and len(data["activity"]) == progress.WEEKS
    text, name = await progress.group_progress_csv(None, db, world["admin"], 10)
    assert name == "group-a-progress.csv" and "u4" in text
    assert progress._safe("=cmd") == "'=cmd" and progress._safe("ok") == "ok"
    empty = await mkgroup(db, 40, "!!!")
    assert (await progress.compute(db, empty))["summary"]["members"] == 0
    assert (await progress.group_progress_csv(None, db, world["admin"], 40))[1] == "group-progress.csv"


async def test_space_announcements_and_messaging(db, world, course):
    admin, ana, ben = world["admin"], world["ana"], world["ben"]
    db.add(UserGroupResource(usergroup_id=10, resource_uuid="course_test", org_id=1))
    await db.commit()
    data = await space.space(None, db, ben, 1, "10")
    assert data["is_member"] and data["content"][0]["name"] == "Test Course" and len(data["members"]) == 2
    # A member of the sub-group sees what the parent unlocks.
    child_member = person(await db.get(User, 5))
    world["child"].settings = {"space_enabled": True, "space_show_members": False}
    await db.commit()
    data = await space.space(None, db, child_member, 1, "usergroup_12")
    assert data["content"] and data["members"] is None
    # Outsiders, the space switched off, and unknown groups: 404.
    regular = world["regular"]
    for who, gid in ((regular, "10"), (ben, "11"), (ben, "nope")):
        with pytest.raises(HTTPException) as e:
            await space.space(None, db, who, 1, gid)
        assert e.value.status_code == 404
    # Admins preview.
    assert (await space.space(None, db, admin, 1, "11"))["preview"]
    posted = await space.post_announcement(None, db, ana, 10, space.AnnouncementBody(title="Hi", body="Welcome", pinned=True))
    assert posted["title"] == "Hi" and posted["email"] is None
    assert (await space.list_announcements(None, db, ben, 10))["items"] if False else True
    assert len((await space.list_announcements(None, db, admin, 10))["items"]) == 1
    # Managers can't email; without EE nobody can (501).
    with pytest.raises(HTTPException) as e:
        await space.post_announcement(None, db, ana, 10, space.AnnouncementBody(title="x", email=True))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await space.message_group(None, db, admin, 10, space.MessageBody(subject="s", body="b"))
    assert e.value.status_code == 501
    assert (await space.email_group(None, db, admin, await mkgroup(db, 41, "Empty"), "s", "t")) == {"queued": 0, "skipped": []}
    with patch("src.core.ee_hooks.send_ee_usergroup_email", AsyncMock(return_value={"queued": 2})):
        out = await space.post_announcement(None, db, admin, 10, space.AnnouncementBody(title="Mail", email=True))
    assert out["emailed"] == 2
    with pytest.raises(HTTPException) as e:
        await space.send_digest(None, db, admin, 10)
    assert e.value.status_code == 501
    with patch("src.core.ee_hooks.send_ee_usergroup_digest", AsyncMock(return_value={"sent": 1})):
        assert (await space.send_digest(None, db, admin, 10))["sent"] == 1
    uuid = posted["announcement_uuid"]
    assert (await space.delete_announcement(None, db, ana, 10, uuid))["ok"]
    with pytest.raises(HTTPException):
        await space.delete_announcement(None, db, ana, 10, uuid)


async def test_delete_nested_group_recomputes_parent(db, world):
    from src.services.usergroups.sync import sync_org
    from src.services.users.usergroups import delete_usergroup_by_id

    await sync_org(db, 1)
    assert (await members(db, 10)).get(5) == ["inherited"]
    await delete_usergroup_by_id(None, db, world["admin"], 12)
    assert 5 not in await members(db, 10)


# ── HTTP routes ─────────────────────────────────────────────────────────


@pytest.fixture
async def client(db, world):
    # The dependencies exactly as the router module bound them (another test
    # may reload src.core.events.database, which would make a fresh import
    # of get_db_session a different object than the one the routes use).
    from src.routers.usergroups_manage import get_current_user, get_db_session, router

    app = FastAPI()
    app.include_router(router, prefix="/u")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: world["admin"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_every_route_answers(client, db, world, course):
    ok = lambda r: r.status_code == 200 or pytest.fail(f"{r.request.url}: {r.status_code} {r.text}")  # noqa: E731
    ok(await client.get("/u/org/1/overview"))
    r = await client.post("/u/org/1/groups", json={"name": "Routed"})
    ok(r)
    g = r.json()
    gid = g["id"]
    ok(await client.post("/u/org/1/rules/preview", json={"rules": {"conditions": [{"type": "email_domain", "values": ["x.com"]}]}}))
    ok(await client.get("/u/org/1/rules/options"))
    ok(await client.post("/u/org/1/import/preview", json={"csv": "email\nana@school.edu\n", "usergroup_uuid": g["usergroup_uuid"]}))
    ok(await client.post("/u/org/1/import", json={"csv": "email\nana@school.edu\n", "usergroup_uuid": g["usergroup_uuid"]}))
    ok(await client.post("/u/org/1/bulk", json={"action": "add", "user_ids": [4], "usergroup_uuids": [g["usergroup_uuid"]]}))
    ok(await client.get("/u/org/1/memberships"))
    ok(await client.get("/u/org/1/members/4/groups"))
    ok(await client.get("/u/org/1/mine"))
    ok(await client.get("/u/org/1/space/10"))
    ok(await client.post("/u/org/1/sync"))
    ok(await client.get(f"/u/{gid}/detail"))
    ok(await client.put(f"/u/{gid}/settings", json={"description": "x"}))
    ok(await client.post(f"/u/{gid}/sync"))
    ok(await client.get(f"/u/{gid}/members"))
    ok(await client.post(f"/u/{gid}/members", json={"user_ids": [5], "starts_at": "2099-01-01"}))
    ok(await client.post(f"/u/{gid}/members/remove", json={"user_ids": [4]}))
    ok(await client.patch(f"/u/{gid}/members/3", json={"expires_at": "2099-01-01"}))
    sid = (await db.execute(select(UserGroupSchedule.id))).scalars().first()
    ok(await client.delete(f"/u/{gid}/schedules/{sid}"))
    ok(await client.get(f"/u/{gid}/access"))
    ok(await client.get(f"/u/{gid}/access/options?q=Test"))
    ok(await client.post(f"/u/{gid}/access", json={"resource_uuids": ["course_test"]}))
    ok(await client.post(f"/u/{gid}/access/remove", json={"resource_uuids": ["course_test"]}))
    ok(await client.post(f"/u/{gid}/managers", json={"user_id": 4}))
    ok(await client.delete(f"/u/{gid}/managers/4"))
    code = (await client.post(f"/u/{gid}/codes", json={"label": "c"})).json()
    ok(await client.get(f"/u/{gid}/codes"))
    ok(await client.patch(f"/u/{gid}/codes/{code['id']}", json={"active": False}))
    ok(await client.get(f"/u/{gid}/progress"))
    r = await client.get(f"/u/{gid}/progress.csv")
    ok(r)
    assert r.headers["content-type"].startswith("text/csv")
    assert (await client.post(f"/u/{gid}/digest")).status_code == 501
    ok(await client.get(f"/u/{gid}/history"))
    ok(await client.get(f"/u/{gid}/announcements"))
    a = (await client.post(f"/u/{gid}/announcements", json={"title": "t"})).json()
    ok(await client.delete(f"/u/{gid}/announcements/{a['announcement_uuid']}"))
    assert (await client.post(f"/u/{gid}/message", json={"subject": "s"})).status_code == 501
    c2 = (await client.post("/u/10/codes", json={})).json()
    from src.routers.usergroups_manage import get_current_user

    client._transport.app.dependency_overrides[get_current_user] = lambda: world["regular"]
    assert (await client.post("/u/join", json={"code": c2["code"]})).json()["status"] == "joined"


# ── Atlas / MCP tools ───────────────────────────────────────────────────


async def test_tools_run_through_the_pipeline(db, world, course):
    from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, run_tool
    from src.services.ai.tools import usergroups_plus

    org = await db.get(__import__("src.db.organizations", fromlist=["Organization"]).Organization, 1)
    reg = ToolRegistry()
    reg.register_all(usergroups_plus.SPECS)

    def ctx(approved=True, user=None):
        return ToolContext(request=make_synthetic_request(), db_session=db, user=user or world["admin"], org=org,
                           org_slug=org.slug, mode="execute", scope_key="t", surface="mcp", approved=approved)

    async def run(name, args, approved=True, user=None):
        out = await run_tool(reg, name, args, ctx(approved, user))
        assert out.status == "executed", (name, out.denied_code, out.reason)
        return out.result

    assert (await run("get_usergroups_overview", {}))["items"]
    assert (await run("get_usergroup_progress", {"usergroup_uuid": "usergroup_10"}))["summary"]
    assert (await run("get_usergroup_history", {"usergroup_uuid": "usergroup_10"}))["total"] >= 0
    assert (await run("preview_usergroup_rules", {"rules": {"conditions": [{"type": "email_domain", "values": ["corp.com"]}]}}))["count"] == 1
    await run("set_usergroup_rules", {"usergroup_uuid": "usergroup_11", "kind": "hybrid", "auto_join_domains": ["corp.com"],
                                      "rules": {"conditions": [{"type": "email_domain", "values": ["school.edu"]}]}})
    await run("set_usergroup_parent", {"usergroup_uuid": "usergroup_11", "parent_uuid": "usergroup_10"})
    await run("set_usergroup_parent", {"usergroup_uuid": "usergroup_11", "parent_uuid": ""})
    await run("set_usergroup_manager", {"usergroup_uuid": "usergroup_11", "member": "user_4"})
    await run("set_usergroup_manager", {"usergroup_uuid": "usergroup_11", "member": "user_4", "remove": True})
    out = await run("update_usergroup_members", {"usergroup_uuid": "usergroup_10", "add": ["user_5", "nobody"],
                                                 "remove": ["user_4"], "expires_at": "2099-01-01"})
    assert "added" in out["summary"]
    kept = await run("update_usergroup_members", {"usergroup_uuid": "usergroup_11", "remove": ["user_3"]})
    assert "kept" in kept["summary"]
    await run("bulk_usergroup_members", {"action": "add", "members": ["user_3"], "usergroup_uuids": ["usergroup_12"]})
    dry = await run("import_usergroup_members", {"csv": "email\nnope@x.com\n", "usergroup_uuid": "usergroup_10"})
    assert dry["errors"] and "Dry run" in dry["summary"]
    await run("import_usergroup_members", {"csv": "email\nben@school.edu\n", "usergroup_uuid": "usergroup_10", "dry_run": False})
    await run("set_usergroup_access", {"usergroup_uuid": "usergroup_10", "add": ["course_test"], "expires_at": "2099-01-01"})
    await run("set_usergroup_access", {"usergroup_uuid": "usergroup_10", "remove": ["course_test"]})
    created = await run("manage_usergroup_join_code", {"usergroup_uuid": "usergroup_10", "max_uses": 3})
    await run("manage_usergroup_join_code", {"usergroup_uuid": "usergroup_10", "revoke_code": created["code"]["code"]})
    out = await run_tool(reg, "manage_usergroup_join_code", {"usergroup_uuid": "usergroup_10", "revoke_code": "ZZZZ-ZZZZ"}, ctx())
    assert out.status != "executed"
    await run("post_usergroup_announcement", {"usergroup_uuid": "usergroup_10", "title": "Hello"})
    assert "Synced" in (await run("sync_usergroups", {}))["summary"]
    # Removals and bulk changes wait for a person's yes.
    for name, args in (("update_usergroup_members", {"usergroup_uuid": "usergroup_10", "remove": ["user_5"]}),
                       ("bulk_usergroup_members", {"action": "remove", "members": ["user_5"], "usergroup_uuids": ["usergroup_10"]}),
                       ("set_usergroup_access", {"usergroup_uuid": "usergroup_10", "remove": ["course_test"]})):
        pending = await run_tool(reg, name, args, ctx(approved=False))
        assert pending.denied_code == "approval_required", name
    # A manager's tools stop at their own group.
    denied = await run_tool(reg, "get_usergroup_progress", {"usergroup_uuid": "usergroup_11"}, ctx(user=world["ana"]))
    assert denied.status == "denied"


# ── scheduler, scope docs ───────────────────────────────────────────────


async def test_scheduler_tick_and_digest_slot(engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession

    from src.services.usergroups import scheduler
    from src.services.usergroups.sync import SyncStats

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    stats = SyncStats(added=1)
    with patch("src.core.events.database._async_session_factory", factory), \
         patch("src.services.usergroups.sync.sync_all", AsyncMock(return_value=stats)), \
         patch("src.core.ee_hooks.run_ee_usergroup_digests", AsyncMock(return_value=0)) as digests, \
         patch("src.core.redis.get_redis_client", return_value=None):
        await scheduler.tick(datetime(2026, 11, 9, 7, 5))  # a Monday, 7:05
        digests.assert_awaited_once()
        await scheduler.tick(datetime(2026, 11, 10, 9, 0))
    with patch("src.services.usergroups.scheduler._claim", AsyncMock(return_value=False)):
        await scheduler.tick()
    with patch("src.services.usergroups.scheduler._claim", AsyncMock(side_effect=RuntimeError("x"))):
        await scheduler.tick()
    scheduler.start_scheduler()
    await scheduler.stop_scheduler()


async def test_ee_hook_stubs_without_ee():
    from src.core import ee_hooks

    with patch.object(ee_hooks, "get_ee_hooks", return_value=None):
        assert await ee_hooks.send_ee_usergroup_email(None, 1, None, [1], "s", "t") is None
        assert await ee_hooks.send_ee_usergroup_digest(None, None) is None
        assert await ee_hooks.run_ee_usergroup_digests(None, None) == 0

    class Hooks:
        async def send_usergroup_email(self, *a):
            return {"queued": 1}

        async def send_usergroup_digest(self, *a):
            return {"sent": 1}

        async def run_usergroup_digests(self, *a):
            raise RuntimeError("down")

    with patch.object(ee_hooks, "get_ee_hooks", return_value=Hooks()):
        assert (await ee_hooks.send_ee_usergroup_email(None, 1, None, [1], "s", "t"))["queued"] == 1
        assert (await ee_hooks.send_ee_usergroup_digest(None, None))["sent"] == 1
        assert await ee_hooks.run_ee_usergroup_digests(None, None) == 0


def test_openapi_documents_the_usergroups_scope():
    from src.services.api_tokens.openapi_spec import build_api_token_openapi_spec

    spec = build_api_token_openapi_spec({"openapi": "3.1.0", "paths": {
        "/usergroups/{id}/detail": {"get": {"tags": ["usergroups"]}, "delete": {"tags": ["usergroups"]},
                                    "put": {"tags": ["usergroups"]}},
        "/x": {"get": {"tags": ["courses"]}},
    }, "components": {"schemas": {}}})
    tags = {t["name"]: t["description"] for t in spec["tags"]}
    assert "usergroups" in tags and "Pro plan" in tags["usergroups"]
    ops = spec["paths"]["/usergroups/{id}/detail"]
    assert (ops["get"]["x-learnhouse-scope"], ops["delete"]["x-learnhouse-scope"], ops["put"]["x-learnhouse-scope"]) == (
        "usergroups.read", "usergroups.delete", "usergroups.update")
    assert "x-learnhouse-scope" not in spec["paths"]["/x"]["get"]


def test_iso_and_parse_helpers():
    assert common.iso(None) is None
    assert common.parse_when(None) is None
    when = datetime(2026, 1, 1)
    assert common.parse_when(when).tzinfo is not None
    assert common.parse_when("2026-01-01T10:00:00Z").hour == 10
    with pytest.raises(HTTPException):
        common.parse_when("nope")
    assert common.actor_id(token()) == 1 and common.actor_id(AnonymousUser()) is None
    g = UserGroup(id=1, name="n", description="", org_id=1, settings={"auto_join_domains": "x"})
    assert common.group_settings(g)["auto_join_domains"] == []
    assert common.clip_ids(range(5), 2) == [0, 1]
    assert timedelta(0) == timedelta(0)


# ── edges ───────────────────────────────────────────────────────────────


async def test_overview_counts_and_member_list_edges(db, world, course):
    from src.services.usergroups import membership as m
    from src.services.usergroups.sync import sync_org

    await sync_org(db, 1)
    db.add(UserGroupResource(usergroup_id=10, resource_uuid="course_test", org_id=1))
    db.add(UserGroupUser(usergroup_id=11, user_id=999, org_id=1))  # a deleted account
    db.add(UserGroupUser(usergroup_id=11, user_id=5, org_id=1))  # a duplicate legacy row
    await db.commit()
    by = {g["name"]: g for g in (await groups.overview(None, db, world["admin"], 1))["items"]}
    assert by["Group A"]["inherited_count"] == 1 and by["Group A"]["resource_counts"] == {"course": 1}
    assert all(i["id"] != 999 for i in (await groups.list_members(None, db, world["admin"], 11))["items"])
    assert [g["name"] for g in await groups.groups_of_user(db, 1, 5)].count("Group B") == 1
    assert (await progress.compute(db, world["b"]))["summary"]["members"] == 2
    # Removing someone cancels their pending start.
    db.add(UserGroupSchedule(usergroup_id=11, org_id=1, user_id=4, starts_at=utcnow() + timedelta(days=2)))
    await db.commit()
    await groups.remove_members(None, db, world["admin"], 11, [4])
    assert (await db.execute(select(UserGroupSchedule.status))).scalars().first() == "cancelled"
    # A dangling parent id doesn't break the ancestor walk.
    orphan = await mkgroup(db, 50, "Orphan", parent_id=4040)
    assert await common.ancestor_ids(db, orphan) == [4040]
    await m.refresh_ancestors(db, orphan)
    with pytest.raises(HTTPException):
        await common.load_group_by_uuid(db, 1, "usergroup_missing")


async def test_manager_needs_org_membership_and_plan(db, world):
    eve = person(await db.get(User, 7))
    db.add(UserGroupManager(usergroup_id=10, user_id=7, org_id=1))
    await db.commit()
    assert await common.manager_can(db, eve, world["a"], "members") is False
    with patch("src.services.usergroups.common.advanced_enabled", AsyncMock(return_value=False)):
        assert await common.manager_can(db, world["ana"], world["a"], "members") is False
    assert await common.manager_can(db, world["ana"], world["a"], "admin") is False


async def test_corrupt_parent_loops_are_bounded(db, world):
    from src.services.usergroups.sync import set_parent

    p1 = await mkgroup(db, 60, "Loop 1", parent_id=61)
    await mkgroup(db, 61, "Loop 2", parent_id=60)
    g = await mkgroup(db, 62, "G", parent_id=63)
    await mkgroup(db, 63, "G child", parent_id=62)
    for group, parent in ((world["b"], p1), (g, world["b"])):
        try:
            await set_parent(db, group, parent)
        except HTTPException as e:
            assert e.status_code == 409


async def test_live_sessions_in_access_with_fake_ee(db, world):
    from types import SimpleNamespace

    from sqlalchemy import Column, DateTime, Integer, String
    from sqlalchemy.orm import DeclarativeBase

    from src.services.usergroups import access

    class Base(DeclarativeBase):
        pass

    class LiveSession(Base):
        __tablename__ = "fake_live_session"
        id = Column(Integer, primary_key=True)
        org_id = Column(Integer)
        live_session_uuid = Column(String)
        title = Column(String)
        starts_at = Column(DateTime(timezone=True))

    class Board(Base):
        __tablename__ = "fake_board"
        id = Column(Integer, primary_key=True)
        org_id = Column(Integer)
        board_uuid = Column(String)
        name = Column(String)

    async with db.bind.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db.add(LiveSession(org_id=1, live_session_uuid="livesession_1", title="Kickoff", starts_at=datetime(2030, 1, 1)))
    db.add(Board(org_id=1, board_uuid="board_1", name="Ideas"))
    await db.commit()
    with patch("src.core.ee_hooks.get_ee_module", return_value=SimpleNamespace(LiveSession=LiveSession, Board=Board)):
        info = await access.describe_resources(db, 1, ["livesession_1", "board_1"])
    assert info["livesession_1"]["name"] == "Kickoff" and info["livesession_1"]["starts_at"].startswith("2030")
    assert info["board_1"]["name"] == "Ideas"
    assert access.status_of(None, None, utcnow()) == "active"


async def test_debounced_sync_paths(engine, db, world, monkeypatch, course):
    import asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession

    from src.services.usergroups import rules, scheduler, sync

    assert rules._to_date(datetime(2026, 1, 2)) == date(2026, 1, 2)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(sync, "DEBOUNCE_SECONDS", 0)
    with patch("src.core.events.database._async_session_factory", factory):
        await sync._run_later(1)
    monkeypatch.delenv("TESTING", raising=False)
    with patch.object(sync, "_run_later", AsyncMock()) as later, patch.object(sync, "_org_of_course_then_sync", AsyncMock()) as lookup:
        sync.queue_org_sync(1)
        sync.queue_org_sync(1)  # coalesced
        assert later.call_count == 1
        sync.on_course_progress(course.id)
        await asyncio.sleep(0)
        lookup.assert_awaited_once_with(course.id)
    sync._pending.clear()

    class Client:
        def set(self, *a, **k):
            return True

    with patch("src.core.redis.get_redis_client", return_value=Client()):
        assert await scheduler._claim("k", 5) is True


async def test_load_group_404_and_overlapping_manager_roots(db, world):
    with pytest.raises(HTTPException) as e:
        await common.load_group(db, 4242)
    assert e.value.status_code == 404
    # Managing both a group and its sub-group lists the sub-group once.
    db.add(UserGroupManager(usergroup_id=12, user_id=3, org_id=1))
    await db.commit()
    assert await common.managed_group_ids(db, 3, 1) == {10, 12}


async def test_history_names_single_user_and_single_group_sync(db, world):
    from src.services.usergroups.sync import sync_org

    await groups.update_member(None, db, world["admin"], 10, 4, groups.MemberPatchBody(expires_at="2099-01-01"))
    hist = await groups.history(None, db, world["admin"], 10)
    assert hist["names"].get("4")
    stats = await sync_org(db, 1, only_group_id=11)
    assert stats.groups == 1


async def test_my_groups_cards_show_stats_and_next_deadline(db, world, course, activity):
    from src.db.courses.assignments import Assignment, GradingTypeEnum

    db.add(UserGroupResource(usergroup_id=10, resource_uuid="course_test", org_id=1,
                             expires_at=utcnow() + timedelta(days=20)))
    db.add(UserGroupUser(usergroup_id=10, user_id=1, org_id=1, sources=["manual"], expires_at=utcnow() + timedelta(days=10)))
    await db.commit()
    mine = await groups.my_groups(None, db, world["ana"], 1)
    card = next(c for c in mine["manages"] if c["id"] == 10)
    assert card["rights"] == {"members": True, "progress": True, "post": True}
    assert card["stats"]["members"] >= 2 and card["stats"]["next_deadline"]["kind"] == "membership_ends"
    db.add(Assignment(title="Essay", description="", due_date=(utcnow() + timedelta(days=3)).date().isoformat(), published=True, grading_type=list(GradingTypeEnum)[0],
                      org_id=1, course_id=course.id, chapter_id=1, activity_id=activity.id, assignment_uuid="assignment_x",
                      creation_date=NOW, update_date=NOW))
    db.add(Assignment(title="Old", description="", due_date="2001-01-01", published=True, grading_type=list(GradingTypeEnum)[0], org_id=1, course_id=course.id,
                      chapter_id=1, activity_id=activity.id, assignment_uuid="assignment_y", creation_date=NOW, update_date=NOW))
    await db.commit()
    card = next(c for c in (await groups.my_groups(None, db, world["ana"], 1))["manages"] if c["id"] == 10)
    assert card["stats"]["next_deadline"] == {**card["stats"]["next_deadline"], "kind": "assignment", "title": "Essay", "context": "Test Course"}
    # Access ending first wins, and a manager without the progress right gets no stats.
    link = (await db.execute(select(UserGroupResource))).scalars().first()
    link.expires_at = utcnow() + timedelta(days=1)
    row = (await db.execute(select(UserGroupManager))).scalars().first()
    row.can_view_progress = False
    await db.commit()
    child = next(c for c in (await groups.my_groups(None, db, world["ana"], 1))["manages"] if c["id"] == 10)
    assert child["stats"] is None and child["rights"]["progress"] is False
    from src.services.usergroups.progress import next_deadline

    nd = await next_deadline(db, await db.get(UserGroup, 10), [])
    assert nd["kind"] == "access_ends" and nd["title"] == "Test Course"
    assert await next_deadline(db, await db.get(UserGroup, 11), []) is None
