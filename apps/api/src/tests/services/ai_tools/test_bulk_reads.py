"""Bulk reads for agents: list_courses fields and filters, cover checks in
the audits, audit_courses over many courses, dead-link checks and
list_members(inactive_days). One call should answer "which courses/members…"."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.services.ai.tools import ToolRegistry, course_audit, courses, users
from src.tests.services.ai_tools.test_content import _p, ctx_for, ok

NOW = str(datetime.now())


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all([*courses.SPECS, *course_audit.SPECS, *users.SPECS])
    return r


@pytest.fixture
def storage():
    """Only files named ok.png exist in storage."""
    with patch(
        "src.services.courses.thumbnails.content_exists",
        new=AsyncMock(side_effect=lambda _d, _t, _u, name: name == "ok.png"),
    ) as m:
        yield m


def _course(db, org, cid, uuid, name, *, image=None, video=None, published=True, created=None):
    c = Course(
        id=cid, name=name, description="", public=True, published=published, open_to_contributors=False,
        org_id=org.id, course_uuid=uuid, thumbnail_image=image, thumbnail_video=video,
        creation_date=created or NOW, update_date=created or NOW,
    )
    db.add(c)
    return c


@pytest.fixture
async def catalog(db, org, course, chapter, activity):
    """course_test (no cover, 1 activity) plus: a working cover, a broken
    cover, a remote cover, a video cover and an empty draft."""
    old = str(datetime.now() - timedelta(days=3))
    _course(db, org, 2, "course_ok", "Alpha ok", image="ok.png", created=old)
    _course(db, org, 3, "course_broken", "Beta broken", image="gone.png", created=old)
    _course(db, org, 4, "course_remote", "Gamma remote", image="https://cdn.example.com/a.png", created=old)
    _course(db, org, 5, "course_video", "Delta video", video="ok.png", created=old)
    _course(db, org, 6, "course_draft", "Epsilon draft", published=False, created=old)
    db.add(TrailRun(course_id=1, org_id=org.id, user_id=2, trail_id=1, status="STATUS_IN_PROGRESS",
                    data={}, creation_date=NOW, update_date=NOW))
    await db.commit()


async def test_list_courses_returns_what_agents_decide_on(registry, db, org, admin_user, catalog, storage):
    out = await ok(registry, ctx_for(db, org, admin_user), "list_courses")
    by = {i["uuid"]: i for i in out["items"]}
    assert len(by) == 6 and out["total"] == 6
    assert by["course_test"]["thumbnail_status"] == "missing"
    assert by["course_ok"]["thumbnail_status"] == "ok"
    assert by["course_broken"]["thumbnail_status"] == "broken"
    assert by["course_remote"]["thumbnail_status"] == "ok"
    assert by["course_video"]["thumbnail_status"] == "ok"
    t = by["course_test"]
    assert t["activities_count"] == 1 and t["chapters_count"] == 1 and t["enrollments"] == 1
    assert t["updated_at"] and by["course_draft"]["activities_count"] == 0


async def test_list_courses_filters(registry, db, org, admin_user, catalog, storage):
    ctx = ctx_for(db, org, admin_user)
    missing = await ok(registry, ctx, "list_courses", missing_thumbnail=True)
    assert {i["uuid"] for i in missing["items"]} == {"course_test", "course_broken", "course_draft"}
    assert missing["total"] == 3
    paged = await ok(registry, ctx, "list_courses", missing_thumbnail=True, limit=2)
    assert len(paged["items"]) == 2 and paged["has_more"]
    working = await ok(registry, ctx, "list_courses", missing_thumbnail=False)
    assert {i["uuid"] for i in working["items"]} == {"course_ok", "course_remote", "course_video"}
    empty = await ok(registry, ctx, "list_courses", empty=True)
    assert {i["uuid"] for i in empty["items"]} == {"course_ok", "course_broken", "course_remote", "course_video", "course_draft"}
    full = await ok(registry, ctx, "list_courses", empty=False)
    assert [i["uuid"] for i in full["items"]] == ["course_test"]
    named = await ok(registry, ctx, "list_courses", sort="name")
    assert [i["name"] for i in named["items"]][:2] == ["Alpha ok", "Beta broken"]
    updated = await ok(registry, ctx, "list_courses", sort="updated")
    assert updated["items"][0]["uuid"] == "course_test"


async def test_audit_reports_broken_cover(registry, db, org, admin_user, catalog, storage):
    ctx = ctx_for(db, org, admin_user)
    broken = await ok(registry, ctx, "audit_course", course_uuid="course_broken")
    codes = {i["code"] for i in broken["issues"]}
    assert "broken_thumbnail" in codes and "no_thumbnail" not in codes
    fine = await ok(registry, ctx, "audit_course", course_uuid="course_ok")
    assert not {"broken_thumbnail", "no_thumbnail"} & {i["code"] for i in fine["issues"]}


async def test_audit_courses_in_one_call(registry, db, org, admin_user, catalog, storage):
    ctx = ctx_for(db, org, admin_user)
    out = await ok(registry, ctx, "audit_courses", codes=["broken_thumbnail", "no_thumbnail"])
    assert out["courses_checked"] == 6
    flagged = {c["course"]["uuid"] for c in out["courses"]}
    assert flagged == {"course_test", "course_broken", "course_draft"}
    assert out["issue_totals"] == {"no_thumbnail": 2, "broken_thumbnail": 1}
    assert "3 broken_thumbnail, no_thumbnail found in 3 course(s)" in out["summary"]

    drafts = await ok(registry, ctx, "audit_courses", published=False)
    assert [c["course"]["uuid"] for c in drafts["courses"]] == ["course_draft"]
    chosen = await ok(registry, ctx, "audit_courses", course_uuids=["course_ok", "course_draft"], published=True)
    assert chosen["courses_checked"] == 1


async def test_audit_courses_caps_issues_and_skips_courses_without_access(
    registry, db, org, admin_user, regular_user, catalog, storage
):
    with patch.object(course_audit, "MAX_ISSUES_PER_COURSE", 1):
        out = await ok(registry, ctx_for(db, org, admin_user), "audit_courses", course_uuids=["course_test"])
    entry = out["courses"][0]
    assert len(entry["issues"]) == 1 and entry["issues_not_shown"] >= 1

    out = await ok(registry, ctx_for(db, org, regular_user), "audit_courses")
    assert out["courses_checked"] == 0 and len(out["skipped"]) == 6
    assert out["skipped"][0]["reason"] == "no edit access"


async def test_check_links_reports_dead_links(registry, db, org, admin_user, course, chapter, activity, storage):
    def link(text, href):
        return {"type": "text", "text": text, "marks": [{"type": "link", "attrs": {"href": href}}]}

    activity.content = {"type": "doc", "content": [
        _p("Read ", link("this", "https://dead.example.com/x"), " and ", link("that", "https://fine.example.com")),
        {"type": "button", "attrs": {"link": "https://dead.example.com/x", "label": "Go"}},
    ]}
    db.add(activity)
    await db.commit()
    verdicts = {
        "https://dead.example.com/x": {"state": "broken", "status": 404, "reason": "HTTP 404"},
        "https://fine.example.com": {"state": "ok", "status": 200},
    }
    ctx = ctx_for(db, org, admin_user)
    with patch("src.services.ai.tools.course_audit.check_links_of", new=AsyncMock(return_value=verdicts)) as check:
        one = await ok(registry, ctx, "audit_course", course_uuid="course_test", check_links=True)
        many = await ok(registry, ctx, "audit_courses", codes=["broken_link"], check_links=True)
    broken = [i for i in one["issues"] if i["code"] == "broken_link"]
    assert len(broken) == 2 and broken[0]["url"] == "https://dead.example.com/x" and "HTTP 404" in broken[0]["message"]
    assert one["figures"]["links_checked"] == 2
    assert many["links_checked"] == 2 and many["issue_totals"] == {"broken_link": 2}
    assert sorted(check.await_args_list[0].args[0]) == sorted(
        ["https://dead.example.com/x", "https://fine.example.com", "https://dead.example.com/x"]
    )

    plain = await ok(registry, ctx, "audit_course", course_uuid="course_test")
    assert "links_checked" not in plain["figures"]


# ─── list_members(inactive_days) ─────────────────────────────────────────────


async def _seen(db, user, when):
    from src.db.users import User

    row = await db.get(User, user.id)
    row.last_login_at = when
    db.add(row)
    await db.commit()


async def test_list_members_inactive(registry, db, org, admin_user, regular_user, course):
    ctx = ctx_for(db, org, admin_user)
    long_ago = str(datetime.now() - timedelta(days=90))
    await _seen(db, admin_user, str(datetime.now()))
    await _seen(db, regular_user, long_ago)

    out = await ok(registry, ctx, "list_members", inactive_days=30)
    assert [i["username"] for i in out["items"]] == [regular_user.username]
    item = out["items"][0]
    assert item["days_inactive"] >= 89 and item["last_active_at"].startswith(long_ago[:10])
    assert "1 member(s)" in out["summary"]

    # Course progress counts as activity too.
    db.add(TrailStep(complete=True, teacher_verified=False, grade="", data={}, trailrun_id=1, trail_id=1,
                     activity_id=1, course_id=course.id, org_id=org.id, user_id=regular_user.id,
                     creation_date=NOW, update_date=NOW))
    await db.commit()
    out = await ok(registry, ctx, "list_members", inactive_days=30)
    assert out["items"] == [] and out["total"] == 0


async def test_list_members_inactive_never_active_and_filters(registry, db, org, admin_user, regular_user, admin_role):
    ctx = ctx_for(db, org, admin_user)
    await _seen(db, regular_user, None)
    await _seen(db, admin_user, "not a date")
    out = await ok(registry, ctx, "list_members", inactive_days=7)
    assert {i["username"] for i in out["items"]} == {regular_user.username, admin_user.username}
    assert all(i["last_active_at"] is None and i["days_inactive"] is None for i in out["items"])

    by_name = await ok(registry, ctx, "list_members", inactive_days=7, query=regular_user.username)
    assert [i["username"] for i in by_name["items"]] == [regular_user.username]
    by_role = await ok(registry, ctx, "list_members", inactive_days=7, role_uuid=admin_role.role_uuid)
    assert [i["username"] for i in by_role["items"]] == [admin_user.username]
    nobody = await ok(registry, ctx, "list_members", inactive_days=7, query="zz-nobody")
    assert nobody["items"] == [] and nobody["total"] == 0


async def test_list_members_inactive_in_group(registry, db, org, admin_user, regular_user):
    from src.db.usergroup_user import UserGroupUser
    from src.db.usergroups import UserGroup

    db.add(UserGroup(id=7, name="Cohort", description="", org_id=org.id, usergroup_uuid="usergroup_cohort",
                     creation_date=NOW, update_date=NOW))
    db.add(UserGroupUser(usergroup_id=7, user_id=regular_user.id, org_id=org.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    out = await ok(registry, ctx_for(db, org, admin_user), "list_members", inactive_days=7, usergroup_uuid="usergroup_cohort")
    assert [i["username"] for i in out["items"]] == [regular_user.username]


def test_when_parses_stored_dates():
    assert users._when(None) is None and users._when("junk") is None
    assert users._when("2026-01-02T03:04:05+02:00") == datetime(2026, 1, 2, 1, 4, 5)
    assert users._when("2026-01-02 03:04:05") == datetime(2026, 1, 2, 3, 4, 5)
