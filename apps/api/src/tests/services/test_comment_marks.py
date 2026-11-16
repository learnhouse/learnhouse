"""Editor comment marks never leave the editor.

The ``comment`` mark anchors editor comment threads on activity text. Every
path that serves a document to someone other than its editors (the learner
activity read, the chapter tree, the "view as" preview, AI indexes, the agent's
reads, exports, copies, imports and templates) must drop it, while editors keep
it so their threads stay anchored.
"""

import copy
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.editor_templates import EditorTemplateCreate, EditorTemplateUpdate
from src.services.courses.activities.comment_marks import (
    COMMENT_MARK,
    comment_thread_ids,
    has_comment_marks,
    strip_comment_marks,
)


def _comment(thread_id: str) -> dict:
    return {"type": COMMENT_MARK, "attrs": {"threadId": thread_id}}


def commented_doc() -> dict:
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Plain "},
                    {"type": "text", "text": "both", "marks": [{"type": "bold"}, _comment("thread_a"), _comment("thread_b")]},
                    {"type": "text", "text": " only", "marks": [_comment("thread_a")]},
                ],
            },
            {"type": "callout", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "nested", "marks": [_comment("thread_c")]},
            ]}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "untouched"}]},
        ],
    }


def _assert_clean(doc) -> None:
    assert not has_comment_marks(doc)
    assert "comment" not in repr(doc)


class TestHelpers:
    def test_detects_and_lists_threads(self):
        doc = commented_doc()
        assert has_comment_marks(doc)
        assert comment_thread_ids(doc) == {"thread_a", "thread_b", "thread_c"}

    def test_strip_keeps_text_and_other_marks_without_mutating(self):
        doc = commented_doc()
        before = copy.deepcopy(doc)
        out = strip_comment_marks(doc)
        assert doc == before
        _assert_clean(out)
        para = out["content"][0]["content"]
        assert para[1] == {"type": "text", "text": "both", "marks": [{"type": "bold"}]}
        assert para[2] == {"type": "text", "text": " only"}  # empty marks list dropped
        assert out["content"][1]["content"][0]["content"][0]["text"] == "nested"
        # Untouched branches are shared, not copied.
        assert out["content"][2] is doc["content"][2]

    def test_uncommented_doc_is_returned_as_is(self):
        doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]}
        assert strip_comment_marks(doc) is doc
        assert comment_thread_ids(doc) == set()

    def test_tolerates_junk(self):
        for junk in (None, "text", 3, [], {"content": "nope"}, {"marks": "nope"}):
            assert has_comment_marks(junk) is False
            assert strip_comment_marks(junk) is junk
        weird = {"type": "doc", "content": [
            "loose string",
            {"type": "text", "text": "x", "marks": [_comment(""), {"type": COMMENT_MARK}, "bad", _comment("t1")]},
        ]}
        assert comment_thread_ids(weird) == {"t1"}
        out = strip_comment_marks(weird)
        assert out["content"][0] == "loose string"
        assert out["content"][1]["marks"] == ["bad"]

    def test_hostile_depth_is_bounded(self):
        deep: dict = {"type": "text", "text": "x", "marks": [_comment("t")]}
        for _ in range(300):
            deep = {"type": "blockquote", "content": [deep]}
        # Too deep to be a real document: the walk stops instead of recursing on.
        assert has_comment_marks(deep) is False
        assert comment_thread_ids(deep) == set()
        assert strip_comment_marks(deep) is deep


@pytest.fixture
async def commented_activity(db, activity):
    activity.content = commented_doc()
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


class TestLearnerPaths:
    async def test_learner_activity_read_drops_marks(self, db, commented_activity, regular_user, mock_request):
        from src.services.courses.activities.activities import get_activity

        read = await get_activity(mock_request, "activity_test", regular_user, db)
        _assert_clean(read.content)
        assert read.content["content"][0]["content"][1]["text"] == "both"

    async def test_anonymous_read_drops_marks(self, db, commented_activity, anonymous_user, mock_request):
        from src.services.courses.activities.activities import get_activity

        read = await get_activity(mock_request, "activity_test", anonymous_user, db)
        _assert_clean(read.content)

    async def test_editor_read_keeps_marks(self, db, commented_activity, admin_user, mock_request):
        from src.services.courses.activities.activities import get_activity

        read = await get_activity(mock_request, "activity_test", admin_user, db)
        assert comment_thread_ids(read.content) == {"thread_a", "thread_b", "thread_c"}

    async def test_marks_and_dynamic_content_together(self, db, course, regular_user, mock_request):
        from src.services.courses.activities.dynamic_context import render_for_reader

        doc = commented_doc()
        doc["content"].append({"type": "conditionalBlock", "attrs": {"rules": {"op": "all", "conditions": []}},
                               "content": [{"type": "paragraph", "content": [
                                   {"type": "text", "text": "gated", "marks": [_comment("thread_d")]}]}]})
        out = await render_for_reader(mock_request, doc, course=course, current_user=regular_user, db_session=db)
        _assert_clean(out)

    async def test_no_request_counts_as_reader(self, db, course, admin_user):
        from src.services.courses.activities.dynamic_context import render_for_reader

        out = await render_for_reader(None, commented_doc(), course=course, current_user=admin_user, db_session=db)
        _assert_clean(out)

    async def test_non_dict_content_passes_through(self, db, course, regular_user):
        from src.services.courses.activities.dynamic_context import render_for_reader

        assert await render_for_reader(None, "raw", course=course, current_user=regular_user, db_session=db) == "raw"

    async def test_chapter_tree_drops_marks_for_readers(self, db, course, commented_activity, regular_user, mock_request):
        from src.services.courses.chapters import get_course_chapters

        chapters = await get_course_chapters(mock_request, course.id, db, regular_user, False)
        content = chapters[0].activities[0].content
        _assert_clean(content)

    async def test_chapter_tree_keeps_marks_for_editors(self, db, course, commented_activity, admin_user, mock_request):
        from src.services.courses.chapters import get_course_chapters

        chapters = await get_course_chapters(mock_request, course.id, db, admin_user, True)
        assert has_comment_marks(chapters[0].activities[0].content)

    async def test_view_as_preview_drops_marks(self, db, commented_activity, admin_user, mock_request):
        from src.services.courses.activities.activities import get_dynamic_preview
        from src.services.courses.activities.dynamic_context import DynamicPreviewRequest

        resp = await get_dynamic_preview(mock_request, "activity_test", DynamicPreviewRequest(), admin_user, db)
        _assert_clean(resp.content)


class TestCopiesAndExports:
    async def test_export_drops_marks(self, db, course, commented_activity):
        from src.services.courses.transfer.export_service import _load_course_export_data

        _course_data, chapters = await _load_course_export_data(course, db)
        _chapter, activities = chapters[0]
        exported = activities[0][0]["content"]
        _assert_clean(exported)
        # The stored activity is untouched.
        assert has_comment_marks((await db.get(Activity, commented_activity.id)).content)

    async def test_clone_drops_marks(self, db, org, course, chapter, commented_activity):
        from src.services.courses.courses import clone_activity

        with patch("src.services.courses.transfer.storage_utils.list_directory", return_value=[]):
            new = await clone_activity(
                db, commented_activity, [], org_uuid=org.org_uuid, org_id=org.id,
                source_course_path="x", new_course_uuid=course.course_uuid, new_course_path="y",
                new_course_id=course.id, new_chapter_id=chapter.id, order=2,
            )
        _assert_clean(new.content)

    async def test_template_create_and_update_drop_marks(self, db, org, admin_user, mock_request):
        from src.db.editor_templates import EditorTemplate
        from src.services.editor_templates import create_editor_template, update_editor_template

        created = await create_editor_template(
            mock_request,
            EditorTemplateCreate(org_id=org.id, name="T", description="", kind="page", content=commented_doc()),
            admin_user, db,
        )
        _assert_clean(created.content)
        updated = await update_editor_template(
            mock_request, created.template_uuid, EditorTemplateUpdate(content=commented_doc()), admin_user, db
        )
        _assert_clean(updated.content)
        stored = (await db.execute(select(EditorTemplate))).scalars().one()
        _assert_clean(stored.content)


class TestIndexesAndAgent:
    async def test_rag_text_has_no_marks_effect(self, db, commented_activity):
        from src.services.ai.rag.sources.dynamic import extract

        class Ctx:
            pass

        ctx = Ctx()
        ctx.db = db
        segments = await extract(commented_activity, ctx)
        assert "Plain both only" in segments[0].text

    def test_agent_loadable_check_accepts_kept_marks(self):
        from src.services.ai.tools import doc_ops as d

        d.check_loadable(commented_doc())  # an existing commented page stays editable

    def test_agent_cannot_author_comment_marks(self):
        from src.services.ai.tools import doc_ops as d

        node = {"type": "paragraph", "content": [{"type": "text", "text": "x", "marks": [_comment("t")]}]}
        assert any("comment" in p for p in d.strict_problems(node))


def test_now_is_iso():
    from src.services.courses.activities.comments import _now

    assert datetime.fromisoformat(_now()).tzinfo is not None
