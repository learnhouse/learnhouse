"""Drip schedule tools through the run_tool pipeline: reading, partial
updates that keep what they leave out, approval on live courses, the plan
gate, org scope, rights and undo."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.services.ai.tools import ToolContext, ToolRegistry, build_registry, make_synthetic_request, run_tool
from src.services.ai.tools import drip as drip_tools
from src.services.ai.tools import refs

NOW = str(datetime.now())
PLAN = "src.security.features_utils.plan_check"


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(drip_tools.SPECS)
    return r


@pytest.fixture(autouse=True)
def saas_pro():
    """Run the plan gate as on the cloud, with the org on Pro."""
    plan = AsyncMock(return_value="pro")
    with patch(f"{PLAN}._check_mode_bypass", return_value=None), \
            patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), \
            patch(f"{PLAN}.get_org_plan", new=plan), \
            patch("src.services.courses.drip.check_org_plan", new=AsyncMock()), \
            patch.object(refs, "web_base", new=AsyncMock(return_value="https://acme.test")):
        yield plan


@pytest.fixture
async def two_chapters(db, org, course, chapter):
    db.add(Chapter(id=2, name="Week two", description="", org_id=org.id, course_id=course.id,
                   chapter_uuid="chapter_two", creation_date=NOW, update_date=NOW))
    db.add(CourseChapter(chapter_id=2, course_id=course.id, org_id=org.id, order=2,
                         creation_date=NOW, update_date=NOW))
    await db.commit()


def ctx_for(db, org, user, *, approved=False):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode="execute",
        scope_key="test",
        surface="mcp",
        approved=approved,
    )


async def call(registry, ctx, name, args):
    return await run_tool(registry, name, args, ctx)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def test_read_default_schedule(registry, db, org, admin_user, course, two_chapters):
    out = ok(await call(registry, ctx_for(db, org, admin_user), "get_drip_schedule", {"course_uuid": "course_test"}))
    assert out["course"]["uuid"] == "course_test"
    assert out["enabled"] is False and out["anchor"] == "enrollment" and out["start_date"] is None
    assert [c["chapter_uuid"] for c in out["chapters"]] == ["chapter_test", "chapter_two"]
    assert out["chapters"][0]["mode"] == "immediate"


async def test_set_schedule_needs_approval_on_live_course_then_undo(registry, db, org, admin_user, course, two_chapters):
    args = {
        "course_uuid": "course_test",
        "enabled": True,
        "notify_email": True,
        "chapters": [{"chapter_uuid": "chapter_two", "mode": "delay", "delay_days": 7, "require_previous": True}],
    }
    # The fixture course is published: learners would see the change at once.
    held = await call(registry, ctx_for(db, org, admin_user), "set_drip_schedule", args)
    assert held.denied_code == "approval_required"

    done = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "set_drip_schedule", args))
    assert "is on; 1 chapter rule updated" in done["summary"]
    sched = done["schedule"]
    assert sched["enabled"] is True and sched["notify_email"] is True
    two = next(c for c in sched["chapters"] if c["chapter_uuid"] == "chapter_two")
    assert two["mode"] == "delay" and two["delay_days"] == 7 and two["require_previous"] is True
    # The chapter left out keeps its rule.
    first = next(c for c in sched["chapters"] if c["chapter_uuid"] == "chapter_test")
    assert first["mode"] == "immediate"

    undo = done["undo"]
    assert undo["tool"] == "set_drip_schedule" and undo["args"]["enabled"] is False
    back = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "set_drip_schedule", undo["args"]))
    assert back["schedule"]["enabled"] is False
    assert all(c["mode"] == "immediate" for c in back["schedule"]["chapters"])
    assert "is off; 2 chapter rules updated" in back["summary"]


async def test_draft_course_runs_without_approval_and_keeps_window(registry, db, org, admin_user, course, two_chapters):
    course.published = False
    db.add(course)
    await db.commit()
    ctx = ctx_for(db, org, admin_user)
    ok(await call(registry, ctx, "set_drip_schedule", {
        "course_uuid": "course_test", "enabled": True,
        "chapters": [{"chapter_uuid": "chapter_two", "mode": "delay", "delay_days": 3, "available_days": 10}],
    }))
    # Switching the chapter to a date keeps its limited window and drops the delay.
    out = ok(await call(registry, ctx, "set_drip_schedule", {
        "course_uuid": "course_test", "enabled": True, "anchor": "fixed_date", "start_date": "2027-01-04T09:00:00Z",
        "chapters": [{"chapter_uuid": "chapter_two", "mode": "date", "release_at": "2027-01-11T09:00:00Z"}],
    }))
    two = next(c for c in out["schedule"]["chapters"] if c["chapter_uuid"] == "chapter_two")
    assert two["mode"] == "date" and two["available_days"] == 10 and "delay_days" not in two
    assert two["release_at"].startswith("2027-01-11")
    assert out["schedule"]["anchor"] == "fixed_date" and out["schedule"]["start_date"].startswith("2027-01-04")


async def test_invalid_calls(registry, db, org, admin_user, course, two_chapters):
    ctx = ctx_for(db, org, admin_user, approved=True)
    no_days = await call(registry, ctx, "set_drip_schedule", {
        "course_uuid": "course_test", "enabled": True, "chapters": [{"chapter_uuid": "chapter_two", "mode": "delay"}]})
    assert no_days.denied_code == "invalid_args"
    no_date = await call(registry, ctx, "set_drip_schedule", {
        "course_uuid": "course_test", "enabled": True, "chapters": [{"chapter_uuid": "chapter_two", "mode": "date"}]})
    assert no_date.denied_code == "invalid_args"
    cohort = await call(registry, ctx, "set_drip_schedule", {
        "course_uuid": "course_test", "enabled": True, "anchor": "fixed_date"})
    assert cohort.status == "denied" and "start_date" in cohort.reason
    stray = await call(registry, ctx, "set_drip_schedule", {
        "course_uuid": "course_test", "enabled": True, "chapters": [{"chapter_uuid": "chapter_nope", "mode": "immediate"}]})
    assert stray.status == "denied" and "chapter_nope" in stray.reason


async def test_rights_scope_and_plan(registry, db, org, other_org, admin_user, regular_user, course, two_chapters):
    learner = await call(registry, ctx_for(db, org, regular_user, approved=True), "get_drip_schedule",
                         {"course_uuid": "course_test"})
    assert learner.status == "denied"
    foreign = await call(registry, ctx_for(db, other_org, admin_user, approved=True), "get_drip_schedule",
                         {"course_uuid": "course_test"})
    assert foreign.status == "denied"
    # Drip is a plan requirement checked by the service when turning it on
    # (not a resolvable feature): a plan below it refuses, turning off never does.
    refused = AsyncMock(side_effect=HTTPException(status_code=403, detail="Drip content needs the Standard plan"))
    with patch("src.services.courses.drip.check_org_plan", new=refused):
        gated = await call(registry, ctx_for(db, org, admin_user, approved=True), "set_drip_schedule",
                           {"course_uuid": "course_test", "enabled": True})
        assert gated.status == "denied" and "Standard plan" in gated.reason
        off = await call(registry, ctx_for(db, org, admin_user, approved=True), "set_drip_schedule",
                         {"course_uuid": "course_test", "enabled": False})
        assert off.status == "executed"
    assert {s.feature for s in build_registry().specs() if s.name.endswith("drip_schedule")} == {None}


def test_summaries():
    on = drip_tools.SetDripScheduleParams(course_uuid="course_x", enabled=True, chapters=[
        {"chapter_uuid": "chapter_a", "mode": "immediate"}])
    assert drip_tools._summary(on) == "Turn on the drip schedule of course_x with 1 chapter rule"
    assert drip_tools._summary(drip_tools.SetDripScheduleParams(course_uuid="course_x", enabled=True)) == (
        "Turn on the drip schedule of course_x")
    assert drip_tools._summary(drip_tools.SetDripScheduleParams(course_uuid="course_x", enabled=False)) == (
        "Turn off the drip schedule of course_x")
