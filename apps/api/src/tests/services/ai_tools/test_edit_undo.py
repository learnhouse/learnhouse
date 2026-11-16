"""Undo for course edits: update_course, update_chapter, update_activity and
move_course_items return the call that puts things back, and running it does."""

# Fixtures imported from the structure tool tests are used as test arguments.
# ruff: noqa: F811

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.ai.tools import chapters as chapter_tools
from src.services.ai.tools.base import ApprovalNeeded, require_approval
from src.tests.services.ai_tools.test_structure import (  # noqa: F401
    _ctx,
    _links,
    call,
    chapter_two,
    environment,
    fake_redis,
    ok,
    registry,
)


async def _undo(registry, db, org, user, out):
    hint = out["undo"]
    return ok(await call(registry, hint["tool"], hint["args"], _ctx(db, org, user, approved=True)))


async def test_update_course_undo(registry, db, org, admin_user, course):
    ctx = _ctx(db, org, admin_user, approved=True)
    out = ok(await call(registry, "update_course", {"course_uuid": "course_test", "name": "Renamed",
                                                    "description": "New", "published": False}, ctx))
    assert out["undo"] == {"tool": "update_course", "args": {
        "course_uuid": "course_test", "name": "Test Course", "description": "A test course", "published": True}}
    await _undo(registry, db, org, admin_user, out)
    row = (await db.execute(select(Course).where(Course.course_uuid == "course_test"))).scalars().one()
    assert (row.name, row.description, row.published) == ("Test Course", "A test course", True)

    # Lists and thumbnails cannot be put back exactly: no undo offered.
    tags = ok(await call(registry, "update_course", {"course_uuid": "course_test", "tags": ["a"]}, ctx))
    assert "undo" not in tags
    # A field that was empty comes back empty, not missing.
    about = ok(await call(registry, "update_course", {"course_uuid": "course_test", "about": "Long text"}, ctx))
    assert about["undo"]["args"]["about"] == ""


async def test_update_chapter_undo(registry, db, org, admin_user, course, chapter):
    ctx = _ctx(db, org, admin_user, approved=True)
    original = chapter.name
    out = ok(await call(registry, "update_chapter", {"chapter_uuid": chapter.chapter_uuid, "name": "New name",
                                                     "lock": "authenticated"}, ctx))
    assert out["undo"]["args"] == {"chapter_uuid": chapter.chapter_uuid, "name": original, "lock": "public"}
    await _undo(registry, db, org, admin_user, out)
    row = (await db.execute(select(Chapter).where(Chapter.id == chapter.id))).scalars().one()
    assert row.name == original
    assert getattr(row.lock_type, "value", row.lock_type) == "public"
    desc = ok(await call(registry, "update_chapter", {"chapter_uuid": chapter.chapter_uuid, "description": "D"}, ctx))
    assert set(desc["undo"]["args"]) == {"chapter_uuid", "description"}


async def test_update_activity_undo(registry, db, org, admin_user, course, chapter, activity):
    ctx = _ctx(db, org, admin_user, approved=True)
    original = activity.name
    out = ok(await call(registry, "update_activity", {"activity_uuid": activity.activity_uuid, "name": "Renamed",
                                                      "published": False}, ctx))
    assert out["undo"]["args"] == {"activity_uuid": activity.activity_uuid, "name": original, "published": True}
    await _undo(registry, db, org, admin_user, out)
    row = (await db.execute(select(Activity).where(Activity.id == activity.id))).scalars().one()
    assert row.published is True and row.name == original


async def test_move_undo_restores_the_order(registry, db, org, admin_user, course, chapter, activity, chapter_two):
    ctx = _ctx(db, org, admin_user, approved=True)
    before = await _links(db)
    moves = [{"item_uuid": "chapter_two", "position": 0},
             {"item_uuid": activity.activity_uuid, "to_chapter_uuid": "chapter_two", "position": 0}]
    out = ok(await call(registry, "move_course_items", {"course_uuid": "course_test", "moves": moves}, ctx))
    assert await _links(db) != before
    assert out["undo"]["tool"] == "move_course_items"
    await _undo(registry, db, org, admin_user, out)
    assert await _links(db) == before

    # Nothing moved: nothing to undo.
    same = ok(await call(registry, "move_course_items", {"course_uuid": "course_test", "moves": [
        {"item_uuid": chapter.chapter_uuid, "position": 0}]}, ctx))
    assert "undo" not in same
    # Too many items to put back in one call: no undo rather than a partial one.
    with patch.object(chapter_tools, "MAX_MOVES", 1):
        assert chapter_tools._restore_order(course, [(1, [1])], {"chapter_x": 1}, {"activity_x": 1}) is None


def test_require_approval_policy_vs_person():
    def ctx(approved=False, policy=False):
        return SimpleNamespace(approved=approved, policy_approved=policy)

    # A person's yes passes both kinds of check.
    require_approval(ctx(approved=True), "x")
    require_approval(ctx(approved=True), "x", person=True)
    # The caller's policy (Atlas Auto) clears state checks, not person ones.
    require_approval(ctx(policy=True), "x")
    for c in (ctx(policy=True), ctx(approved=True, policy=True), ctx()):
        with pytest.raises(ApprovalNeeded):
            require_approval(c, "x", person=True)
    with pytest.raises(ApprovalNeeded):
        require_approval(ctx(), "x")
