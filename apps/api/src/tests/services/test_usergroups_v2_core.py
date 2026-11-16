"""User groups v2, the engine: smart rules, sync, nesting, schedules,
expiry, join codes, bulk tools and access windows.

Runs the real services against the in-memory database (no mocks of the
group code), so idempotency and the org boundary are tested for real.
"""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.org_member_profile import OrgMemberProfile
from src.db.paths import Path, PathCertificate, PathCourse, PathEnrollment
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.user_activity import UserActivityDay
from src.db.user_organizations import UserOrganization
from src.db.usergroup_extras import UserGroupJoinCode, UserGroupSchedule
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import User
from src.services.usergroups import access, bulk, codes, membership, rules, sync
from src.services.usergroups.common import utcnow

NOW = str(datetime.now())


@pytest.fixture(autouse=True)
def quiet():
    with patch("src.services.webhooks.dispatch.dispatch_webhooks", new_callable=AsyncMock), \
         patch("src.services.usergroups.groups.dispatch_webhooks", new_callable=AsyncMock, create=True):
        yield


async def mkuser(db, uid: int, email: str, org_id: int = 1, role_id: int = 4, joined: str | None = None, meta=None):
    db.add(User(id=uid, username=f"u{uid}", first_name=f"F{uid}", last_name="L", email=email, password="x",
                user_uuid=f"user_{uid}", creation_date=NOW, update_date=NOW, extra_metadata=meta or {}))
    db.add(UserOrganization(user_id=uid, org_id=org_id, role_id=role_id, creation_date=joined or NOW, update_date=NOW))
    await db.commit()
    return await db.get(User, uid)


async def mkgroup(db, gid: int, name: str, org_id: int = 1, **kw):
    g = UserGroup(id=gid, name=name, description="", org_id=org_id, usergroup_uuid=f"usergroup_{gid}",
                  creation_date=NOW, update_date=NOW, **kw)
    db.add(g)
    await db.commit()
    return g


async def members(db, gid: int) -> dict[int, list[str]]:
    rows = (await db.execute(select(UserGroupUser).where(UserGroupUser.usergroup_id == gid))).scalars().all()
    return {r.user_id: membership.sources_of(r) for r in rows}


@pytest.fixture
async def people(db, org, other_org, admin_user, regular_user, user_role):
    """Admin (1), regular (2), and 3..6 in org 1; 7 in the other org only."""
    await mkuser(db, 3, "ana@school.edu", joined=str(datetime(2025, 1, 10)), meta={"campus": "North"})
    await mkuser(db, 4, "ben@school.edu", joined=str(datetime(2026, 6, 1)), meta={"campus": "South"})
    await mkuser(db, 5, "cleo@corp.com", joined=str(datetime(2026, 9, 1)))
    await mkuser(db, 6, "dan@corp.com", joined="not a date")
    await mkuser(db, 7, "eve@school.edu", org_id=2)
    return {"admin": admin_user, "regular": regular_user}


# ── rules: validation ───────────────────────────────────────────────────


@pytest.mark.parametrize("bad", [
    "x", {"match": "some"}, {"conditions": "x"}, {"conditions": [{"type": "nope"}]},
    {"conditions": [{"type": "email_domain", "values": []}]},
    {"conditions": [{"type": "role", "role_ids": ["a"]}]},
    {"conditions": [{"type": "role", "role_ids": []}]},
    {"conditions": [{"type": "progress_below", "course_uuid": "c", "pct": "x"}]},
    {"conditions": [{"type": "progress_below", "course_uuid": "c", "pct": 120}]},
    {"conditions": [{"type": "inactive_days", "days": 0}]},
    {"conditions": [{"type": "joined_after"}]},
    {"conditions": [{"type": "joined_after", "date": "garbage"}]},
    {"conditions": [{"type": "people_field", "field": "salary", "value": "x"}]},
    {"conditions": [{"type": "enrolled", "course_uuid": ""}]},
    {"conditions": [{"type": "tag", "value": "x"}] * 21},
])
def test_validate_rules_refuses_malformed(bad):
    with pytest.raises(HTTPException) as e:
        rules.validate_rules(bad)
    assert e.value.status_code == 422


def test_validate_rules_normalizes():
    assert rules.validate_rules(None) == {"match": "all", "conditions": []}
    out = rules.validate_rules({"match": "any", "conditions": [
        {"type": "email_domain", "values": "@School.EDU"},
        {"type": "role", "role_ids": 4, "negate": True},
        {"type": "joined_after", "date": "2026-01-01"},
        {"type": "signup_field", "key": "campus", "value": None},
    ]})
    assert out["conditions"][0]["values"] == ["school.edu"]
    assert out["conditions"][1] == {"type": "role", "role_ids": [4], "negate": True}
    assert out["conditions"][2]["date"] == "2026-01-01"
    assert out["conditions"][3]["value"] == ""


# ── rules: every condition ──────────────────────────────────────────────


async def test_conditions_on_people_fields(db, people):
    ev = lambda c: rules.evaluate(db, 1, {"conditions": [c]})  # noqa: E731
    assert await ev({"type": "email_domain", "values": ["school.edu"]}) == {3, 4}
    assert await ev({"type": "role", "role_ids": [1]}) == {1}
    assert await ev({"type": "signup_field", "key": "campus", "value": "north"}) == {3}
    assert await ev({"type": "signup_field", "key": "campus", "value": ""}) == {3, 4}
    db.add(OrgMemberProfile(org_id=1, user_id=3, department="Sales", attributes={"tags": ["vip", "beta"]}))
    db.add(OrgMemberProfile(org_id=1, user_id=4, department="Ops", attributes={"tags": "beta, alpha"}))
    db.add(OrgMemberProfile(org_id=1, user_id=5, attributes=None))
    await db.commit()
    assert await ev({"type": "people_field", "field": "department", "value": "sales"}) == {3}
    assert await ev({"type": "people_field", "field": "department", "value": ""}) == {3, 4}
    assert await ev({"type": "tag", "value": "beta"}) == {3, 4}
    assert await ev({"type": "tag", "value": "alpha"}) == {4}
    # Dates: 6's join date can't be read, so it matches no date rule.
    assert await ev({"type": "joined_after", "date": "2026-05-01"}) == {4, 5} | ({1, 2} if True else set())
    assert 3 in await ev({"type": "joined_before", "date": "2026-01-01"})
    assert 5 in await ev({"type": "joined_within_days", "days": 3650})


async def test_signup_fields_nested_and_list_answers(db, org, admin_user):
    await mkuser(db, 8, "x@x.com", meta={"signup_fields": {"langs": ["fr", "de"]}})
    assert await rules.evaluate(db, 1, {"conditions": [{"type": "signup_field", "key": "langs", "value": "de"}]}) == {8}
    assert await rules.evaluate(db, 1, {"conditions": [{"type": "signup_field", "key": "langs", "value": "fr, de"}]}) == {8}
    assert await rules.evaluate(db, 1, {"conditions": [{"type": "signup_field", "key": "x", "value": "y"}]}) == set()


async def test_conditions_on_learning(db, people, course, activity):
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=1, user_id=3, status=StatusEnum.STATUS_COMPLETED,
                    creation_date=NOW, update_date=NOW))
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=1, user_id=4, creation_date=NOW, update_date=NOW))
    path = Path(id=1, name="P", org_id=1, path_uuid="path_1", creation_date=NOW, update_date=NOW)
    db.add(path)
    db.add(PathEnrollment(path_id=1, user_id=4, org_id=1, creation_date=NOW))
    db.add(PathCertificate(path_id=1, user_id=4, org_id=1, certificate_uuid="pc_1", creation_date=NOW))
    db.add(UserActivityDay(org_id=1, user_id=5, activity_date=date.today()))
    await db.commit()
    ev = lambda c: rules.evaluate(db, 1, {"conditions": [c]})  # noqa: E731
    assert await ev({"type": "enrolled", "course_uuid": "course_test"}) == {3, 4}
    assert await ev({"type": "completed", "course_uuid": "course_test"}) == {3}
    assert await ev({"type": "progress_at_least", "course_uuid": "course_test", "pct": 50}) == {3}
    assert await ev({"type": "progress_below", "course_uuid": "course_test", "pct": 50}) == {4}
    assert await ev({"type": "enrolled", "course_uuid": "course_missing"}) == set()
    assert await ev({"type": "path_enrolled", "path_uuid": "path_1"}) == {4}
    assert await ev({"type": "path_completed", "path_uuid": "path_1"}) == {4}
    assert await ev({"type": "path_enrolled", "path_uuid": "path_x"}) == set()
    assert await ev({"type": "active_within_days", "days": 7}) == {5}
    assert 5 not in await ev({"type": "inactive_days", "days": 7})
    # all / any / negate
    assert await rules.evaluate(db, 1, {"match": "any", "conditions": [
        {"type": "completed", "course_uuid": "course_test"}, {"type": "active_within_days", "days": 7}]}) == {3, 5}
    assert await rules.evaluate(db, 1, {"match": "all", "conditions": [
        {"type": "email_domain", "values": ["school.edu"]}, {"type": "completed", "course_uuid": "course_test", "negate": True}]}) == {4}
    # A course of another org is not found from this org.
    assert await rules.evaluate(db, 2, {"conditions": [{"type": "enrolled", "course_uuid": "course_test"}]}) == set()


async def test_conditions_on_groups_and_ee_sources(db, people):
    await mkgroup(db, 10, "A")
    await mkgroup(db, 11, "Other org", org_id=2)
    db.add(UserGroupUser(usergroup_id=10, user_id=3, org_id=1))
    db.add(UserGroupUser(usergroup_id=11, user_id=7, org_id=2))
    await db.commit()
    ev = lambda c, **k: rules.evaluate(db, 1, {"conditions": [c]}, **k)  # noqa: E731
    assert await ev({"type": "in_group", "usergroup_uuid": "usergroup_10"}) == {3}
    assert await ev({"type": "in_group", "usergroup_uuid": "usergroup_10"}, self_group_id=10) == set()
    # Cross-org group uuid: skipped, never resolved.
    assert await ev({"type": "in_group", "usergroup_uuid": "usergroup_11"}) == set()
    # Without EE the company and SCIM sources match nobody.
    with patch("src.core.ee_hooks.get_ee_module", return_value=None):
        assert await ev({"type": "company", "company_uuid": "company_x"}) == set()
        assert await ev({"type": "scim_group", "scim_id": "s1"}) == set()


async def test_scim_and_company_sources_with_fake_ee(db, people):
    from types import SimpleNamespace

    from sqlalchemy import Column, Integer, String
    from sqlalchemy.orm import DeclarativeBase

    class Base(DeclarativeBase):
        pass

    class FakeScim(Base):
        __tablename__ = "fake_scim"
        id = Column(Integer, primary_key=True)
        org_id = Column(Integer)
        resource_type = Column(String)
        scim_id = Column(String)
        local_id = Column(Integer)

    class FakeSeat(Base):
        __tablename__ = "fake_seat"
        id = Column(Integer, primary_key=True)
        user_id = Column(Integer)
        company_id = Column(Integer)
        org_id = Column(Integer)
        status = Column(String)

    class FakeAcct(Base):
        __tablename__ = "fake_acct"
        id = Column(Integer, primary_key=True)
        company_uuid = Column(String)

    async with db.bind.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db.add_all([FakeScim(org_id=1, resource_type="Group", scim_id="s1", local_id=10),
                FakeScim(org_id=1, resource_type="Group", scim_id="self", local_id=12),
                FakeAcct(id=1, company_uuid="company_x"),
                FakeSeat(user_id=5, company_id=1, org_id=1, status="active"),
                FakeSeat(user_id=None, company_id=1, org_id=1, status="active")])
    await db.commit()
    await mkgroup(db, 10, "Synced")
    db.add(UserGroupUser(usergroup_id=10, user_id=4, org_id=1))
    await db.commit()
    mods = {"ee.db.scim": SimpleNamespace(ScimResource=FakeScim),
            "ee.db.payments.payments_company_seats": SimpleNamespace(CompanySeat=FakeSeat, CompanyAccount=FakeAcct)}
    with patch("src.core.ee_hooks.get_ee_module", side_effect=lambda n: mods[n]):
        assert await rules.evaluate(db, 1, {"conditions": [{"type": "scim_group", "scim_id": "s1"}]}) == {4}
        assert await rules.evaluate(db, 1, {"conditions": [{"type": "scim_group", "scim_id": "self"}]}, self_group_id=12) == set()
        assert await rules.evaluate(db, 1, {"conditions": [{"type": "scim_group", "scim_id": "nope"}]}) == set()
        assert await rules.evaluate(db, 1, {"conditions": [{"type": "company", "company_uuid": "company_x"}]}) == {5}


async def test_empty_rules_match_nobody_and_preview(db, people):
    assert await rules.evaluate(db, 1, {"match": "all", "conditions": []}) == set()
    out = await rules.preview(db, 1, {"conditions": [{"type": "email_domain", "values": ["corp.com"]}]})
    assert out["count"] == 2 and {p["id"] for p in out["sample"]} == {5, 6}
    assert (await rules.preview(db, 1, {}))["count"] == 0


# ── membership primitives ───────────────────────────────────────────────


async def test_sources_are_reasons_and_rows_go_when_none_left(db, people):
    g = await mkgroup(db, 10, "G")
    assert await membership.add_source(db, g, 3, "manual") == "added"
    await db.commit()
    assert await membership.add_source(db, g, 3, "manual") == "unchanged"
    assert await membership.add_source(db, g, 3, "rule") == "source_added"
    ends = utcnow() + timedelta(days=3)
    assert await membership.add_source(db, g, 3, "manual", expires_at=ends) == "source_added"
    await db.commit()
    assert await membership.remove_sources(db, g, 3, ["manual"]) == "kept"
    await db.commit()
    row = (await db.execute(select(UserGroupUser).where(UserGroupUser.user_id == 3))).scalars().first()
    assert membership.sources_of(row) == ["rule"] and row.expires_at is None
    assert await membership.remove_sources(db, g, 3, ["rule"]) == "removed"
    assert await membership.remove_sources(db, g, 99, ["rule"]) == "absent"
    # Legacy rows (sources NULL) read as manual and get it written on touch.
    db.add(UserGroupUser(usergroup_id=10, user_id=4, org_id=1))
    await db.commit()
    assert await membership.add_source(db, g, 4, "manual") == "unchanged"
    await db.commit()
    assert (await members(db, 10))[4] == ["manual"]
    row = (await db.execute(select(UserGroupUser).where(UserGroupUser.user_id == 4))).scalars().first()
    row.sources = ["weird", 5]
    assert membership.sources_of(row) == ["weird"]
    row.sources = [5]
    assert membership.sources_of(row) == ["manual"]


async def test_notifications_respect_settings(db, people):
    g = await mkgroup(db, 10, "G", settings={"notify_on_join": False, "notify_on_leave": False})
    assert await membership.notify_members(db, g, [3], "joined") == 0
    assert await membership.notify_members(db, g, [3], "left") == 0
    assert await membership.notify_members(db, g, [], "joined") == 0
    g.settings = {}
    assert await membership.notify_members(db, g, [3, 4], "joined") == 2


# ── sync ────────────────────────────────────────────────────────────────


async def test_smart_group_follows_its_rules_idempotently(db, people):
    g = await mkgroup(db, 10, "School", kind="smart",
                      rules={"match": "all", "conditions": [{"type": "email_domain", "values": ["school.edu"]}]})
    s1 = await sync.sync_org(db, 1)
    assert s1.added == 2 and await members(db, 10) == {3: ["rule"], 4: ["rule"]}
    s2 = await sync.sync_org(db, 1)
    assert s2.added == 0 and s2.removed == 0
    # Ben changes address: the rule drops him, nobody else moves.
    ben = await db.get(User, 4)
    ben.email = "ben@corp.com"
    await db.commit()
    s3 = await sync.sync_org(db, 1)
    assert s3.removed == 1 and set(await members(db, 10)) == {3}
    # The other org's eve@school.edu never appears.
    assert 7 not in await members(db, 10)
    assert g.last_synced_at is not None


async def test_hybrid_keeps_manual_members_and_manual_drops_rule_members(db, people):
    g = await mkgroup(db, 10, "Mix", kind="hybrid",
                      rules={"conditions": [{"type": "email_domain", "values": ["corp.com"]}]})
    await membership.add_source(db, g, 3, "manual")
    await db.commit()
    await sync.sync_org(db, 1)
    assert await members(db, 10) == {3: ["manual"], 5: ["rule"], 6: ["rule"]}
    g.kind = "manual"
    await db.commit()
    await sync.sync_org(db, 1)
    assert await members(db, 10) == {3: ["manual"]}


async def test_rules_freeze_below_the_plan_and_bad_rules_are_left_alone(db, people):
    g = await mkgroup(db, 10, "S", kind="smart", rules={"conditions": [{"type": "email_domain", "values": ["corp.com"]}]})
    await sync.sync_org(db, 1)
    assert set(await members(db, 10)) == {5, 6}
    g.rules = {"conditions": [{"type": "email_domain", "values": ["school.edu"]}]}
    await db.commit()
    with patch("src.services.usergroups.sync.advanced_enabled", AsyncMock(return_value=False)):
        await sync.sync_org(db, 1)
    assert set(await members(db, 10)) == {5, 6}
    g.rules = {"conditions": [{"type": "bogus"}]}
    await db.commit()
    await sync.sync_org(db, 1)
    assert set(await members(db, 10)) == {5, 6}


async def test_auto_join_domains(db, people):
    await mkgroup(db, 10, "Corp", settings={"auto_join_domains": ["corp.com"]})
    await sync.sync_org(db, 1)
    assert await members(db, 10) == {5: ["domain"], 6: ["domain"]}


async def test_nesting_inherits_downward_transitively(db, people, course):
    top = await mkgroup(db, 10, "School")
    mid = await mkgroup(db, 11, "Grade 9", parent_id=10)
    await mkgroup(db, 12, "Class 9A", parent_id=11)
    db.add(UserGroupUser(usergroup_id=12, user_id=3, org_id=1, sources=["manual"]))
    db.add(UserGroupUser(usergroup_id=11, user_id=4, org_id=1, sources=["manual"]))
    db.add(UserGroupUser(usergroup_id=10, user_id=5, org_id=1, sources=["manual"]))
    await db.commit()
    await sync.sync_org(db, 1)
    assert await members(db, 10) == {3: ["inherited"], 4: ["inherited"], 5: ["manual"]}
    assert await members(db, 11) == {3: ["inherited"], 4: ["manual"]}
    # Access inherits downward only: the child's own links don't reach the parent.
    assert 5 not in await members(db, 11)
    # Leaving the class takes 3 out of both parents.
    await membership.remove_sources(db, await db.get(UserGroup, 12), 3, membership.DIRECT_SOURCES)
    await db.commit()
    await membership.refresh_ancestors(db, await db.get(UserGroup, 12))
    assert 3 not in await members(db, 11) and 3 not in await members(db, 10)
    # Below the plan, inherited reasons are cleared.
    with patch("src.services.usergroups.sync.advanced_enabled", AsyncMock(return_value=False)):
        await sync.sync_org(db, 1)
    assert await members(db, 10) == {5: ["manual"]}
    assert mid.parent_id == 10 and top.parent_id is None


async def test_set_parent_refuses_loops_other_orgs_and_depth(db, people):
    a = await mkgroup(db, 10, "A")
    b = await mkgroup(db, 11, "B", parent_id=10)
    c = await mkgroup(db, 12, "C", parent_id=11)
    x = await mkgroup(db, 20, "X", org_id=2)
    for parent, code in ((a, 409), (c, 409), (x, 404)):
        with pytest.raises(HTTPException) as e:
            await sync.set_parent(db, a, parent)
        assert e.value.status_code == code
    d = await mkgroup(db, 13, "D", parent_id=12)
    e5 = await mkgroup(db, 14, "E")
    await sync.set_parent(db, e5, d)  # the 5th level is allowed
    await db.commit()
    f6 = await mkgroup(db, 15, "F")
    with pytest.raises(HTTPException) as e:
        await sync.set_parent(db, f6, e5)
    assert "levels" in e.value.detail
    await sync.set_parent(db, b, None)
    assert b.parent_id is None
    # A corrupt loop in stored data doesn't hang the depth walk.
    a.parent_id = 12
    await db.commit()
    assert sync.depth_map([a, b, c, d, e5])


async def test_schedules_start_and_finish(db, people):
    g = await mkgroup(db, 10, "Cohort")
    now = utcnow()
    db.add(UserGroupSchedule(usergroup_id=10, org_id=1, user_id=3, starts_at=now - timedelta(minutes=1),
                             ends_at=now + timedelta(days=30)))
    db.add(UserGroupSchedule(usergroup_id=10, org_id=1, user_id=4, starts_at=now - timedelta(minutes=1)))
    db.add(UserGroupSchedule(usergroup_id=10, org_id=1, user_id=5, starts_at=now - timedelta(days=2),
                             ends_at=now - timedelta(days=1)))
    db.add(UserGroupSchedule(usergroup_id=10, org_id=1, user_id=7, starts_at=now - timedelta(minutes=1)))
    db.add(UserGroupSchedule(usergroup_id=99, org_id=1, user_id=3, starts_at=now - timedelta(minutes=1)))
    db.add(UserGroupSchedule(usergroup_id=10, org_id=1, user_id=6, starts_at=now + timedelta(days=1)))
    await db.commit()
    stats = await sync.sync_org(db, 1)
    assert stats.scheduled_started == 2 and set(await members(db, 10)) == {3, 4}
    statuses = {s.user_id: s.status for s in (await db.execute(select(UserGroupSchedule).where(UserGroupSchedule.usergroup_id == 10))).scalars()}
    assert statuses == {3: "active", 4: "done", 5: "done", 7: "cancelled", 6: "pending"}
    # Later the active one ends: expiry removes the member, the row closes.
    later = now + timedelta(days=31)
    stats = await sync.sync_org(db, 1, later)
    assert stats.expired == 1 and stats.scheduled_ended == 1 and set(await members(db, 10)) == {4, 6}
    assert g.id == 10


async def test_expiry_keeps_rule_members(db, people):
    await mkgroup(db, 10, "G", kind="hybrid", rules={"conditions": [{"type": "email_domain", "values": ["school.edu"]}]})
    past = utcnow() - timedelta(minutes=5)
    db.add(UserGroupUser(usergroup_id=10, user_id=3, org_id=1, sources=["manual", "rule"], expires_at=past))
    db.add(UserGroupUser(usergroup_id=10, user_id=5, org_id=1, sources=["code"], expires_at=past))
    db.add(UserGroupUser(usergroup_id=99, user_id=5, org_id=1, sources=["code"], expires_at=past))
    await db.commit()
    stats = await sync.sync_org(db, 1)
    assert stats.expired == 1
    m = await members(db, 10)
    assert m[3] == ["rule"] and 5 not in m


async def test_sync_all_and_org_without_groups(db, people):
    assert (await sync.sync_org(db, 2)).groups == 0
    await mkgroup(db, 10, "S", kind="smart", rules={"conditions": [{"type": "email_domain", "values": ["corp.com"]}]})
    db.add(UserGroupSchedule(usergroup_id=10, org_id=1, user_id=3, starts_at=utcnow() + timedelta(days=1)))
    await db.commit()
    total = await sync.sync_all(db)
    assert total.added == 2
    with patch("src.services.usergroups.sync.sync_org", AsyncMock(side_effect=RuntimeError("boom"))):
        assert (await sync.sync_all(db)).added == 0


def test_event_hooks_are_quiet_under_tests():
    sync.queue_org_sync(1)
    sync.queue_org_sync(None)
    sync.on_member_event(1, 2)
    sync.on_course_progress(1)
    sync.on_course_progress(None)
    assert not sync._pending


async def test_course_progress_lookup_queues_orgs_with_smart_groups(engine, db, people, course):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    with patch("src.core.events.database._async_session_factory", factory), \
         patch("src.services.usergroups.sync.queue_org_sync") as q:
        await sync._org_of_course_then_sync(course.id)
        q.assert_not_called()
        await mkgroup(db, 10, "S", kind="smart")
        await sync._org_of_course_then_sync(course.id)
        q.assert_called_once_with(1)
        await sync._org_of_course_then_sync(9999)


# ── join codes ──────────────────────────────────────────────────────────


async def test_codes_lifecycle_and_limits(db, people):
    admin, regular = people["admin"], people["regular"]
    await mkgroup(db, 10, "Class")
    c = await codes.create_code(None, db, admin, 10, codes.CodeBody(label="Spring", max_uses=1, membership_days=30))
    assert c["status"] == "active" and len(c["code"]) == 9
    # Regular members can't create codes for a group.
    with pytest.raises(HTTPException):
        await codes.create_code(None, db, regular, 10, codes.CodeBody())
    out = await codes.redeem(None, db, regular, c["code"].lower().replace("-", ""))
    assert out["status"] == "joined" and out["expires_at"]
    assert (await codes.redeem(None, db, regular, c["code"]))["status"] == "already_member"
    ana = await db.get(User, 3)
    with pytest.raises(HTTPException) as e:
        await codes.redeem(None, db, ana, c["code"])
    assert e.value.status_code == 409
    listed = (await codes.list_codes(None, db, admin, 10))["items"]
    assert listed[0]["status"] == "full" and listed[0]["uses"] == 1
    upd = await codes.update_code(None, db, admin, 10, c["id"], codes.CodePatchBody(label="x", max_uses=5, expires_at="2099-01-01", active=False))
    assert upd["status"] == "revoked"
    with pytest.raises(HTTPException) as e:
        await codes.redeem(None, db, ana, c["code"])
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        await codes.update_code(None, db, admin, 10, 999, codes.CodePatchBody())


async def test_redeem_refusals(db, people):
    admin = people["admin"]
    from src.db.users import AnonymousUser, APITokenUser

    await mkgroup(db, 10, "Class")
    g2 = await mkgroup(db, 20, "Other", org_id=2)
    c = await codes.create_code(None, db, admin, 10, codes.CodeBody())
    with pytest.raises(HTTPException) as e:
        await codes.redeem(None, db, AnonymousUser(), c["code"])
    assert e.value.status_code == 401
    with pytest.raises(HTTPException) as e:
        await codes.redeem(None, db, APITokenUser(id=5, org_id=1, created_by_user_id=1), c["code"])
    assert e.value.status_code == 403
    # Someone outside the org can't use the code to get in.
    eve = await db.get(User, 7)
    with pytest.raises(HTTPException) as e:
        await codes.redeem(None, db, eve, c["code"])
    assert e.value.status_code == 403
    # Expired, unknown, or pointing at a group of another org.
    row = await db.get(UserGroupJoinCode, c["id"])
    row.expires_at = utcnow() - timedelta(days=1)
    db.add(UserGroupJoinCode(usergroup_id=g2.id, org_id=1, code="AAAA-BBBB"))
    await db.commit()
    for code in (c["code"], "ZZZZ-ZZZZ", "AAAA-BBBB"):
        with pytest.raises(HTTPException) as e:
            await codes.redeem(None, db, await db.get(User, 3), code)
        assert e.value.status_code == 404


async def test_code_creation_rules(db, people):
    admin = people["admin"]
    await mkgroup(db, 10, "Smart", kind="smart")
    await mkgroup(db, 11, "Class")
    with pytest.raises(HTTPException) as e:
        await codes.create_code(None, db, admin, 10, codes.CodeBody())
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        await codes.create_code(None, db, admin, 11, codes.CodeBody(expires_at="2001-01-01"))
    assert e.value.status_code == 422
    for i in range(codes.MAX_ACTIVE_CODES):
        db.add(UserGroupJoinCode(usergroup_id=11, org_id=1, code=f"C{i:03d}-XXXX"))
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await codes.create_code(None, db, admin, 11, codes.CodeBody())
    assert e.value.status_code == 409
    assert codes.normalize("abc") == "ABC"
    expired = UserGroupJoinCode(id=1, usergroup_id=1, org_id=1, code="X", expires_at=datetime(2000, 1, 1, tzinfo=timezone.utc), created_at=utcnow())
    assert codes.code_dict(expired)["status"] == "expired"


# ── bulk tools ──────────────────────────────────────────────────────────


CSV = """email,group,starts_at,expires_at
ana@school.edu,Class,,
ana@school.edu,Class,,
ben@school.edu,usergroup_11,2099-01-01,2099-06-01
nobody@x.com,Class,,
eve@school.edu,Class,,
bad,Class,,
cleo@corp.com,Nope,,
cleo@corp.com,Twin,,
dan@corp.com,Smart,,
dan@corp.com,Class,yesterday,
dan@corp.com,Class,2026-01-01,2025-01-01
cleo@corp.com,,,
"""


async def test_csv_import_dry_run_and_apply(db, people):
    admin = people["admin"]
    await mkgroup(db, 10, "Class")
    await mkgroup(db, 11, "Later")
    await mkgroup(db, 12, "Twin")
    await mkgroup(db, 13, "twin")
    await mkgroup(db, 14, "Smart", kind="smart")
    preview = await bulk.import_preview(None, db, admin, 1, bulk.ImportBody(csv=CSV))
    errors = {r["line"]: r.get("error") for r in preview["rows"] if r["status"] == "error"}
    assert preview["ok"] == 2
    assert errors == {3: "duplicate", 5: "unknown_email", 6: "not_in_org", 7: "invalid_email", 8: "unknown_group",
                      9: "ambiguous_group", 10: "smart_group", 11: "bad_date", 12: "bad_date", 13: "no_group"}
    # Nothing was written by the dry run.
    assert await members(db, 10) == {}
    applied = await bulk.import_apply(None, db, admin, 1, bulk.ImportBody(csv=CSV))
    assert applied["applied"] and await members(db, 10) == {3: ["import"]}
    sched = (await db.execute(select(UserGroupSchedule))).scalars().all()
    assert [(s.user_id, s.usergroup_id) for s in sched] == [(4, 11)]
    # Importing into one group: the group column is optional.
    one = await bulk.import_preview(None, db, admin, 1, bulk.ImportBody(csv="email\ncleo@corp.com\n", usergroup_uuid="usergroup_10"))
    assert one["ok"] == 1


async def test_csv_import_refusals(db, people):
    admin, regular = people["admin"], people["regular"]
    with pytest.raises(HTTPException):
        await bulk.import_preview(None, db, regular, 1, bulk.ImportBody(csv="email\n"))
    with pytest.raises(HTTPException) as e:
        await bulk.import_preview(None, db, admin, 1, bulk.ImportBody(csv="name\nx\n"))
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        await bulk.import_preview(None, db, admin, 1, bulk.ImportBody(csv="email\n", usergroup_uuid="usergroup_x"))
    assert e.value.status_code == 404
    with patch.object(bulk, "MAX_ROWS", 1), pytest.raises(HTTPException) as e:
        await bulk.import_preview(None, db, admin, 1, bulk.ImportBody(csv="email\na@a.com\nb@b.com\n"))
    assert "at most" in e.value.detail


async def test_bulk_add_remove_move(db, people):
    admin = people["admin"]
    await mkgroup(db, 10, "A")
    await mkgroup(db, 11, "B")
    await mkgroup(db, 12, "S", kind="smart")
    out = await bulk.bulk(None, db, admin, 1, bulk.BulkBody(action="add", user_ids=[3, 4, 7], usergroup_uuids=["usergroup_10"]))
    assert out["skipped_not_in_org"] == [7] and out["groups"]["usergroup_10"]["count"] == 2
    out = await bulk.bulk(None, db, admin, 1, bulk.BulkBody(action="move", user_ids=[3], usergroup_uuids=["usergroup_11"],
                                                             from_usergroup_uuid="usergroup_10"))
    assert set(await members(db, 10)) == {4} and set(await members(db, 11)) == {3}
    await bulk.bulk(None, db, admin, 1, bulk.BulkBody(action="remove", user_ids=[4], usergroup_uuids=["usergroup_10"]))
    assert await members(db, 10) == {}
    bad = [
        bulk.BulkBody(action="add", user_ids=[3], usergroup_uuids=["usergroup_nope"]),
        bulk.BulkBody(action="add", user_ids=[3], usergroup_uuids=[]),
        bulk.BulkBody(action="move", user_ids=[3], usergroup_uuids=["usergroup_11"]),
        bulk.BulkBody(action="move", user_ids=[3], usergroup_uuids=["usergroup_11"], from_usergroup_uuid="usergroup_11"),
        bulk.BulkBody(action="add", user_ids=[3], usergroup_uuids=["usergroup_12"]),
    ]
    for body in bad:
        with pytest.raises(HTTPException):
            await bulk.bulk(None, db, admin, 1, body)


# ── access windows ──────────────────────────────────────────────────────


async def test_access_windows_paths_and_cross_org(db, people, course):
    admin = people["admin"]
    await mkgroup(db, 10, "G")
    db.add(Course(id=2, name="Other org course", public=False, published=True, open_to_contributors=False, org_id=2, course_uuid="course_other",
                  creation_date=NOW, update_date=NOW))
    db.add(Course(id=3, name="In path", public=False, published=True, open_to_contributors=False, org_id=1, course_uuid="course_p",
                  creation_date=NOW, update_date=NOW))
    db.add(Path(id=1, name="P", org_id=1, path_uuid="path_1", creation_date=NOW, update_date=NOW))
    db.add(PathCourse(path_id=1, course_id=3))
    await db.commit()
    out = await access.add_access(None, db, admin, 10, access.AccessBody(
        resource_uuids=["course_test", "path_1", "course_other", "user_x"], starts_at="2099-01-01"))
    results = {r["resource_uuid"]: r["result"] for r in out["results"]}
    assert results == {"course_test": "linked", "course_p": "linked", "course_other": "not_found", "user_x": "not_linkable"}
    listed = (await access.list_access(None, db, admin, 10))["items"]
    assert {i["resource_uuid"]: i["status"] for i in listed} == {"course_test": "scheduled", "course_p": "scheduled"}
    again = await access.add_access(None, db, admin, 10, access.AccessBody(resource_uuids=["course_test"]))
    assert again["results"][0]["result"] == "window_updated"
    same = await access.add_access(None, db, admin, 10, access.AccessBody(resource_uuids=["course_test"]))
    assert same["results"][0]["result"] == "already_linked"
    with pytest.raises(HTTPException):
        await access.add_access(None, db, admin, 10, access.AccessBody(resource_uuids=["course_test"], starts_at="2099-02-01", expires_at="2099-01-01"))
    opts = (await access.access_options(None, db, admin, 10, q="test", kind="course"))["items"]
    assert [o["resource_uuid"] for o in opts] == ["course_test"]
    assert len((await access.access_options(None, db, admin, 10))["items"]) >= 3
    assert (await access.remove_access(None, db, admin, 10, ["course_p", "course_nope"]))["removed"] == ["course_p"]
    assert await access.granting_uuids(db, [10]) == ["course_test"]
    assert await access.granting_uuids(db, []) == []
    assert access.status_of(None, utcnow() - timedelta(days=1), utcnow()) == "expired"
    assert access.kind_of("livesession_x") == "live_session"
    with patch("src.core.ee_hooks.get_ee_module", return_value=None):
        assert access._model("live_session") is None
        assert await access.describe_resources(db, 1, ["livesession_x"]) == {}


async def test_windows_gate_access_checks(db, people, course):
    """A link outside its window keeps the course restricted but grants
    nothing; an expired membership grants nothing either."""
    from src.security.rbac.rbac import check_usergroup_access
    from src.security.rbac.resource_access import _window_open

    course.public = False
    await mkgroup(db, 10, "G")
    db.add(UserGroupResource(usergroup_id=10, resource_uuid="course_test", org_id=1,
                             starts_at=utcnow() + timedelta(days=1)))
    db.add(UserGroupUser(usergroup_id=10, user_id=3, org_id=1))
    await db.commit()
    assert await check_usergroup_access("course_test", 3, db) is False
    link = (await db.execute(select(UserGroupResource))).scalars().first()
    link.starts_at = None
    await db.commit()
    assert await check_usergroup_access("course_test", 3, db) is True
    row = (await db.execute(select(UserGroupUser))).scalars().first()
    row.expires_at = utcnow() - timedelta(seconds=1)
    await db.commit()
    assert await check_usergroup_access("course_test", 3, db) is False
    now = utcnow()
    assert _window_open(None, None, now)
    assert not _window_open(datetime(2999, 1, 1), None, now)
    assert not _window_open(None, datetime(2000, 1, 1), now)
