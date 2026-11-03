"""Talking to the tools in names, and building drafts without approvals.

Every id parameter also takes the name a person would say. Names resolve
only to what the caller can see; a name that fits several things comes back
as a question, not a guess. Work inside a draft course needs no approval."""

# Fixtures imported from the course tool tests are used as test arguments.
# ruff: noqa: F811

from __future__ import annotations

from datetime import datetime

from sqlmodel import select

from src.db.courses.courses import Course
from src.tests.services.ai_tools.test_courses import (  # noqa: F401
    call,
    ctx_for,
    draft,
    foreign,
    quiet_services,
    registry,
)

NOW = str(datetime.now())


async def _course(db, org, *, id, uuid, name, published=True):
    c = Course(
        id=id, name=name, description="", public=published, published=published,
        open_to_contributors=False, org_id=org.id, course_uuid=uuid, creation_date=NOW, update_date=NOW,
    )
    db.add(c)
    await db.commit()
    return c


async def test_a_course_can_be_named_instead_of_identified(registry, db, org, admin_user, course, chapter, activity):
    out = await call(registry, ctx_for(db, org, admin_user), "get_course", {"course_uuid": "test course"})
    assert out.status == "executed", out.reason
    assert out.result["uuid"] == "course_test"
    assert out.result["resolved"]["course_uuid"]["uuid"] == "course_test"


async def test_a_page_is_looked_for_inside_the_named_course(registry, db, org, admin_user, course, chapter, activity, draft):
    out = await call(
        registry, ctx_for(db, org, admin_user), "update_activity",
        {"activity_uuid": "Draft page", "name": "Ready page"},
    )
    assert out.status == "executed", out.reason
    assert out.result["resolved"]["activity_uuid"]["uuid"] == "activity_draft"
    assert out.result["activity"]["name"] == "Ready page"


async def test_a_name_that_fits_several_things_is_a_question(registry, db, org, admin_user):
    await _course(db, org, id=21, uuid="course_twin_a", name="Twin")
    await _course(db, org, id=22, uuid="course_twin_b", name="Twin")
    out = await call(registry, ctx_for(db, org, admin_user), "get_course", {"course_uuid": "Twin"})
    assert out.denied_code == "http_409"
    assert "course_twin_a" in out.reason and "course_twin_b" in out.reason
    assert "Ask the user which one" in out.reason


async def test_unknown_and_other_org_names_are_not_found(registry, db, org, admin_user, course, foreign):
    for name in ("Underwater Basket Weaving", "Foreign"):
        out = await call(registry, ctx_for(db, org, admin_user), "get_course", {"course_uuid": name})
        assert out.denied_code == "http_404", (name, out.reason)
        assert "search" in out.reason


async def test_learners_cannot_reach_a_draft_by_its_name(registry, db, org, regular_user):
    await _course(db, org, id=23, uuid="course_hidden", name="Hidden Plans", published=False)
    out = await call(registry, ctx_for(db, org, regular_user), "get_course", {"course_uuid": "Hidden Plans"})
    # Same answer as for a name that does not exist: no draft titles leak.
    assert out.denied_code == "http_404"


async def test_ids_pass_through_untouched(registry, db, org, admin_user, course, chapter, activity):
    out = await call(registry, ctx_for(db, org, admin_user), "get_course", {"course_uuid": "course_test"})
    assert out.status == "executed" and "resolved" not in out.result


async def test_publishing_inside_a_draft_course_needs_no_approval(registry, db, org, admin_user, course, chapter, activity, draft):
    row = (await db.execute(select(Course).where(Course.course_uuid == "course_test"))).scalars().one()
    row.published = False
    db.add(row)
    await db.commit()
    out = await call(
        registry, ctx_for(db, org, admin_user), "update_activity", {"activity_uuid": "activity_draft", "published": True},
    )
    assert out.status == "executed", out.reason


async def test_publishing_inside_a_live_course_still_asks(registry, db, org, admin_user, course, chapter, activity, draft):
    out = await call(
        registry, ctx_for(db, org, admin_user), "update_activity", {"activity_uuid": "activity_draft", "published": True},
    )
    assert out.denied_code == "approval_required"
    done = await call(
        registry, ctx_for(db, org, admin_user, approved=True), "update_activity",
        {"activity_uuid": "activity_draft", "published": True},
    )
    assert done.status == "executed"


async def test_new_courses_say_they_are_drafts_and_how_to_publish(registry, db, org, admin_user):
    out = await call(registry, ctx_for(db, org, admin_user), "create_course", {"name": "Fresh"})
    assert out.status == "executed", out.reason
    assert "draft" in out.result["summary"]
    assert "editor_url" in out.result["next_step"] and out.result["editor_url"]


async def test_pages_of_a_draft_course_show_once_the_course_is_published(registry, db, org, admin_user, course, chapter, activity):
    row = (await db.execute(select(Course).where(Course.course_uuid == "course_test"))).scalars().one()
    row.published = False
    db.add(row)
    await db.commit()
    ready = await call(registry, ctx_for(db, org, admin_user), "create_activity", {"chapter_uuid": "chapter_test", "name": "In draft"})
    assert ready.status == "executed" and ready.result["activity"]["published"] is True
    assert "shows once the course is published" in ready.result["summary"]

    row.published = True
    db.add(row)
    await db.commit()
    live = await call(registry, ctx_for(db, org, admin_user), "create_activity", {"chapter_uuid": "chapter_test", "name": "In live"})
    # Added to a live course: a draft page until someone publishes it.
    assert live.result["activity"]["published"] is False
