"""replace_in_course through the full pipeline: preview, approval for live
courses, saving one version per page, names, chapter scope and rights."""

from datetime import datetime

import pytest
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.services.ai.tools import ToolRegistry, course_replace
from src.services.ai.tools import doc_ops as d
from src.tests.services.ai_tools.test_content import (  # noqa: F401  (fixture)
    _no_webhooks,
    _p,
    call,
    ctx_for,
    denied,
    ok,
    rich_doc,
)


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(course_replace.SPECS)
    return r


def _add_activity(db, org, course, chapter, id, name, **kw):
    a = Activity(
        id=id, name=name, activity_type=kw.pop("activity_type", ActivityTypeEnum.TYPE_DYNAMIC),
        activity_sub_type=kw.pop("activity_sub_type", ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
        published=kw.pop("published", True), org_id=org.id, course_id=course.id,
        activity_uuid=f"activity_{id}", creation_date=str(datetime.now()), update_date=str(datetime.now()), **kw,
    )
    db.add(a)
    db.add(ChapterActivity(
        order=id, chapter_id=chapter.id, activity_id=id, course_id=course.id, org_id=org.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    return a


@pytest.fixture
async def pages(db, org, course, chapter, activity):
    """Two chapters: the fixture page plus a draft page in chapter one, a
    video and another page in chapter two."""
    activity.content = rich_doc()
    db.add(activity)
    _add_activity(db, org, course, chapter, 11, "Hello draft", published=False,
                  content={"type": "doc", "content": [_p("Hello again, Hello")]})
    second = Chapter(
        id=2, name="Hello chapter", description="", org_id=org.id, course_id=course.id,
        chapter_uuid="chapter_two", creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(second)
    db.add(CourseChapter(
        chapter_id=2, course_id=course.id, org_id=org.id, order=2,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    _add_activity(db, org, course, second, 12, "Video", activity_type=ActivityTypeEnum.TYPE_VIDEO,
                  activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE, content={})
    _add_activity(db, org, course, second, 13, "Wrap up",
                  content={"type": "doc", "content": [_p("Nothing to see")]})
    await db.commit()


async def _content(db, uuid):
    row = (await db.execute(
        select(Activity).where(Activity.activity_uuid == uuid).execution_options(populate_existing=True)
    )).scalars().first()
    return row


async def test_preview_counts_and_saves_nothing(registry, db, org, admin_user, pages):
    out = await ok(registry, ctx_for(db, org, admin_user), "replace_in_course",
                   course_uuid="course_test", replacements=[{"find": "Hello", "replace": "Hi"}], preview=True)
    assert out["preview"] is True and out["replaced"] == 3
    by_page = {e["page"]["uuid"]: e for e in out["pages"]}
    assert by_page["activity_test"]["matches"] == 1 and by_page["activity_11"]["matches"] == 2
    assert any("Hello" in s for s in by_page["activity_11"]["snippets"])
    assert out["skipped_activities"] == 1
    assert "Hello again" in d.block_text((await _content(db, "activity_11")).content)


async def test_live_course_needs_approval_then_saves_each_page(registry, db, org, admin_user, pages):
    args = dict(course_uuid="course_test", replacements=[
        {"find": "world", "replace": "planet"}, {"find": "S3", "replace": "Amazon S3"}])
    need = await denied(registry, ctx_for(db, org, admin_user), "replace_in_course", **args)
    assert need.denied_code == "approval_required" and "1 live page" in need.reason

    page = await _content(db, "activity_test")
    before = page.current_version or 1
    out = await ok(registry, ctx_for(db, org, admin_user, approved=True), "replace_in_course", **args)
    assert out["replaced"] == 2
    assert [f["matches"] for f in out["per_find"]] == [1, 1]
    assert out["undo"] == [{"tool": "restore_activity_version",
                            "args": {"activity_uuid": "activity_test", "version": before}}]

    doc = (await _content(db, "activity_test")).content
    bold = doc["content"][1]["content"][1]
    assert bold == {"type": "text", "text": "planet", "marks": [{"type": "bold"}]}
    assert "Is Amazon S3 object storage?" in d.block_text(doc)


async def test_draft_pages_change_without_approval(registry, db, org, admin_user, pages):
    out = await ok(registry, ctx_for(db, org, admin_user), "replace_in_course",
                   course_uuid="course_test", replacements=[{"find": "again", "replace": "once more"}])
    assert out["replaced"] == 1 and out["pages"][0]["page"]["uuid"] == "activity_11"
    assert "Hello once more" in d.block_text((await _content(db, "activity_11")).content)


async def test_titles_rename_pages_and_chapters(registry, db, org, admin_user, pages):
    out = await ok(registry, ctx_for(db, org, admin_user, approved=True), "replace_in_course",
                   course_uuid="course_test", replacements=[{"find": "Hello", "replace": "Hi"}], titles=True)
    renamed = {(r["kind"], r["from"], r["to"]) for r in out["renamed"]}
    assert renamed == {("chapter", "Hello chapter", "Hi chapter"), ("page", "Hello draft", "Hi draft")}
    chapter = (await db.execute(
        select(Chapter).where(Chapter.id == 2).execution_options(populate_existing=True)
    )).scalars().first()
    assert chapter.name == "Hi chapter"
    assert (await _content(db, "activity_11")).name == "Hi draft"


async def test_chapter_scope_and_unknown_chapter(registry, db, org, admin_user, pages):
    out = await ok(registry, ctx_for(db, org, admin_user), "replace_in_course", course_uuid="course_test",
                   replacements=[{"find": "Hello", "replace": "Hi"}], chapter_uuids=["chapter_two"], preview=True)
    assert out["replaced"] == 0 and out["not_found"] == [{"find": "Hello"}]

    out = await call(registry, ctx_for(db, org, admin_user), "replace_in_course", course_uuid="course_test",
                     replacements=[{"find": "Hello", "replace": "Hi"}], chapter_uuids=["chapter_nope"])
    assert out.status != "executed"


async def test_capitalization_hint(registry, db, org, admin_user, pages):
    out = await ok(registry, ctx_for(db, org, admin_user), "replace_in_course",
                   course_uuid="course_test", replacements=[{"find": "hello", "replace": "hi"}])
    assert out["replaced"] == 0
    assert "capitalization" in out["not_found"][0]["hint"]


async def test_learner_cannot_replace(registry, db, org, regular_user, pages):
    await denied(registry, ctx_for(db, org, regular_user, approved=True), "replace_in_course",
                 course_uuid="course_test", replacements=[{"find": "Hello", "replace": "Hi"}])
    assert "Hello again" in d.block_text((await _content(db, "activity_11")).content)


def test_spec_shape():
    spec = course_replace.SPECS[0]
    assert spec.name == "replace_in_course" and spec.approval_in_call and spec.target_param == "course_uuid"
