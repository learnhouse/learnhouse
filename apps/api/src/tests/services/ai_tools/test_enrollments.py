"""Enrollment tools through the full run_tool pipeline: who can enroll, org
scope for courses and people, group enrollment, the approval gate for bulk
and unenroll calls, per-person results and the undo each result carries."""

# Fixtures imported from the people tool tests are used as test arguments.
# ruff: noqa: F811

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.trail_runs import TrailRun
from src.db.usergroup_user import UserGroupUser
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.ai.tools import ToolRegistry, run_tool
from src.services.ai.tools import enrollments
from src.tests.services.ai_tools.test_people_org import (  # noqa: F401
    _ctx,
    _token,
    environment,
    fake_redis,
    setup,
)


@pytest.fixture(autouse=True)
def quiet():
    with patch("src.services.orgs.member_enrollments.track", new=AsyncMock()), patch(
        "src.services.orgs.member_enrollments.notify_ee_learner_progress"
    ):
        yield


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(enrollments.SPECS)
    return r


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def runs(db, course_id):
    return sorted(r.user_id for r in (await db.execute(select(TrailRun).where(TrailRun.course_id == course_id))).scalars())


async def test_enroll_by_name_id_and_skip_strangers(db, org, admin_user, regular_user, course, setup, registry):
    ctx = _ctx(db, org, admin_user)
    out = ok(await run_tool(registry, "enroll_users_in_course", {
        "course_uuid": course.course_uuid,
        "members": [regular_user.username, "3", "nobody", "user_outsider", "999"],
    }, ctx))
    assert {e["uuid"] for e in out["enrolled"]} == {regular_user.user_uuid, "user_maint"}
    assert [m["member"] for m in out["not_found"]] == ["nobody", "user_outsider", "999"]
    assert out["undo"] == {
        "tool": "unenroll_users_from_course",
        "args": {"course_uuid": course.course_uuid, "members": [e["uuid"] for e in out["enrolled"]]},
    }
    assert "Enrolled 2 people" in out["summary"] and "3 not found" in out["summary"]
    assert await runs(db, course.id) == sorted([regular_user.id, 3])

    # Again: nobody new, both reported as already enrolled.
    again = ok(await run_tool(registry, "enroll_users_in_course", {
        "course_uuid": course.course_uuid, "members": [regular_user.user_uuid],
    }, ctx))
    assert again["enrolled"] == [] and again["skipped"][0]["result"] == "already_enrolled"
    assert "undo" not in again and "1 skipped" in again["summary"]


async def test_group_and_bulk_need_approval(db, org, admin_user, regular_user, course, setup, registry):
    # A non-member in the group is never enrolled through it.
    now = str(datetime.now())
    db.add(UserGroupUser(usergroup_id=1, user_id=4, org_id=org.id, creation_date=now, update_date=now))
    await db.commit()
    args = {"course_uuid": course.course_uuid, "usergroup_uuid": "usergroup_a"}
    held = await run_tool(registry, "enroll_users_in_course", args, _ctx(db, org, admin_user))
    assert held.denied_code == "approval_required"
    out = ok(await run_tool(registry, "enroll_users_in_course", args, _ctx(db, org, admin_user, approved=True)))
    assert [e["uuid"] for e in out["enrolled"]] == [regular_user.user_uuid]
    assert out["enrolled"][0]["name"]

    many = {"course_uuid": course.course_uuid, "members": [f"user_{i}" for i in range(11)]}
    assert (await run_tool(registry, "enroll_users_in_course", many, _ctx(db, org, admin_user))).denied_code == "approval_required"
    spec = registry.get("enroll_users_in_course")
    params = spec.params_model(**{**args, "members": ["a"]})
    assert spec.summarize(params) == f"Enroll 1 person and a user group in course {course.course_uuid}"
    assert registry.get("unenroll_users_from_course").summarize(spec.params_model(members=["a", "b"], course_uuid="c")) == (
        "Unenroll 2 people from course c"
    )


async def test_unenroll_always_needs_approval_and_undoes_by_enrolling(db, org, admin_user, regular_user, course, setup, registry):
    await run_tool(registry, "enroll_users_in_course", {
        "course_uuid": course.course_uuid, "members": [regular_user.user_uuid],
    }, _ctx(db, org, admin_user))
    args = {"course_uuid": course.course_uuid, "members": [regular_user.user_uuid, "user_maint"]}
    assert (await run_tool(registry, "unenroll_users_from_course", args, _ctx(db, org, admin_user))).denied_code == "approval_required"
    out = ok(await run_tool(registry, "unenroll_users_from_course", args, _ctx(db, org, admin_user, approved=True)))
    assert [e["uuid"] for e in out["unenrolled"]] == [regular_user.user_uuid]
    assert out["skipped"][0]["result"] == "not_enrolled"
    assert "progress in the course was removed" in out["summary"]
    assert out["undo"]["tool"] == "enroll_users_in_course"
    assert await runs(db, course.id) == []

    none = ok(await run_tool(registry, "unenroll_users_from_course", {
        "course_uuid": course.course_uuid, "members": ["user_maint"],
    }, _ctx(db, org, admin_user, approved=True)))
    assert none["unenrolled"] == [] and "removed" not in none["summary"]


async def test_who_may_enroll(db, org, admin_user, regular_user, course, setup, registry):
    args = {"course_uuid": course.course_uuid, "members": [admin_user.user_uuid]}
    learner = await run_tool(registry, "enroll_users_in_course", args, _ctx(db, org, regular_user))
    assert learner.status == "denied"
    maint = ok(await run_tool(registry, "enroll_users_in_course", args, _ctx(db, org, setup.maintainer)))
    assert maint["enrolled"][0]["uuid"] == admin_user.user_uuid
    token = await run_tool(registry, "enroll_users_in_course", args, _ctx(db, org, _token(org.id)))
    assert token.denied_code == "not_for_api_tokens"
    other = await run_tool(registry, "enroll_users_in_course", {**args, "course_uuid": "course_other"}, _ctx(db, org, admin_user))
    assert other.status == "denied" and other.denied_code.startswith("http_404")
    empty = await run_tool(registry, "enroll_users_in_course", {"course_uuid": course.course_uuid}, _ctx(db, org, admin_user))
    assert empty.denied_code == "invalid_args"
    assert await runs(db, course.id) == [admin_user.id]


async def test_failures_are_reported_per_person(db, org, admin_user, regular_user, course, setup, registry):
    ctx = _ctx(db, org, admin_user)
    args = {"course_uuid": course.course_uuid, "members": [regular_user.user_uuid]}
    with patch.object(enrollments, "enroll_org_member", AsyncMock(side_effect=HTTPException(status_code=404, detail="gone"))):
        out = ok(await run_tool(registry, "enroll_users_in_course", args, ctx))
    assert out["skipped"] == [{**out["skipped"][0], "result": "failed", "detail": "gone"}]
    with patch.object(enrollments, "enroll_org_member", AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))):
        denied = await run_tool(registry, "enroll_users_in_course", args, ctx)
    assert denied.denied_code == "http_403"
    with patch.object(enrollments.refs, "load_member", AsyncMock(side_effect=HTTPException(status_code=403, detail="staff only"))):
        email = await run_tool(registry, "enroll_users_in_course", {**args, "members": ["a@b.c"]}, ctx)
    assert email.denied_code == "email_lookup_denied"


async def test_numeric_id_must_be_a_member(db, org, admin_user, course, setup, registry):
    now = str(datetime.now())
    db.add(User(id=50, username="ghost", first_name="G", last_name="H", email="g@h.i", password="x",
                user_uuid="user_ghost", creation_date=now, update_date=now))
    await db.commit()
    out = ok(await run_tool(registry, "enroll_users_in_course", {
        "course_uuid": course.course_uuid, "members": ["50"],
    }, _ctx(db, org, admin_user)))
    assert out["not_found"] == [{"member": "50", "result": "not_a_member"}]
    assert UserOrganization  # imported for the reader: membership is the org link
