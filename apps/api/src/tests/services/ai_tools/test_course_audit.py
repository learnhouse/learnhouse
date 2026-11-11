"""audit_course through the full pipeline: what it flags, figures, severity
filter, chapter scope and rights."""

from datetime import datetime

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import Assignment, GradingTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.services.ai.tools import ToolRegistry, course_audit
from src.services.ai.tools import doc_ops as d
from src.tests.services.ai_tools.test_content import _p, ctx_for, denied, ok

NOW = str(datetime.now())


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(course_audit.SPECS)
    return r


def _link(text, href):
    return {"type": "text", "text": text, "marks": [{"type": "link", "attrs": {"href": href}}]}


def _link_activity(db, org, course, chapter_id, a, order):
    db.add(a)
    db.add(ChapterActivity(order=order, chapter_id=chapter_id, activity_id=a.id, course_id=course.id,
                           org_id=org.id, creation_date=NOW, update_date=NOW))


@pytest.fixture
async def audited(db, org, course, chapter, activity):
    """Chapter one: a long page with a broken quiz, an empty link and a TODO,
    a draft empty page and an assignment with no tasks or due date. Chapter
    two: empty."""
    long_text = "word " * 700
    activity.content = {"type": "doc", "content": [
        _p(long_text, _link("here", "")),
        _p("TODO: finish this"),
        d.quiz_node([{"text": "Pick one", "options": [{"text": "A", "correct": False}, {"text": "B", "correct": False}]}]),
        {"type": "blockImage", "attrs": {"blockObject": None}},
    ]}
    db.add(activity)
    _link_activity(db, org, course, chapter.id, Activity(
        id=21, name="Empty", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content={"type": "doc", "content": []},
        published=False, org_id=org.id, course_id=course.id, activity_uuid="activity_empty",
        creation_date=NOW, update_date=NOW,
    ), 2)
    _link_activity(db, org, course, chapter.id, Activity(
        id=22, name="Homework", activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY, content={}, published=True,
        org_id=org.id, course_id=course.id, activity_uuid="activity_hw", creation_date=NOW, update_date=NOW,
    ), 3)
    db.add(Assignment(
        id=30, title="Homework", description="", due_date=None, published=True,
        grading_type=GradingTypeEnum.PERCENTAGE, org_id=org.id, course_id=course.id, chapter_id=chapter.id,
        activity_id=22, assignment_uuid="assignment_hw", creation_date=NOW, update_date=NOW,
    ))
    db.add(Chapter(id=2, name="Later", description="", org_id=org.id, course_id=course.id,
                   chapter_uuid="chapter_later", creation_date=NOW, update_date=NOW))
    db.add(CourseChapter(chapter_id=2, course_id=course.id, org_id=org.id, order=2,
                         creation_date=NOW, update_date=NOW))
    await db.commit()


def _codes(out, uuid=None):
    return {i["code"] for i in out["issues"] if uuid is None or i["where"]["uuid"] == uuid}


async def test_audit_flags_problems_and_counts(registry, db, org, admin_user, audited):
    out = await ok(registry, ctx_for(db, org, admin_user), "audit_course", course_uuid="course_test")
    assert {"placeholder_text", "quiz_no_correct", "media_missing", "empty_link", "no_headings"} <= _codes(
        out, "activity_test"
    )
    assert "no_practice" not in _codes(out, "activity_test")  # the quiz counts as practice
    assert {"empty_page", "hidden_from_learners"} <= _codes(out, "activity_empty")
    assert {"assignment_no_tasks", "assignment_no_due_date"} <= _codes(out, "activity_hw")
    assert "empty_chapter" in _codes(out, "chapter_later")
    assert {"no_learnings", "no_thumbnail"} <= _codes(out, "course_test")

    severities = [i["severity"] for i in out["issues"]]
    assert severities == sorted(severities, key=course_audit.SEVERITY.get)
    quiz = next(i for i in out["issues"] if i["code"] == "quiz_no_correct")
    assert quiz["path"] == [2]
    figures = out["figures"]
    assert figures["chapters"] == 2 and figures["activities"] == {"dynamic": 2, "assignment": 1}
    assert figures["words"] > 700 and figures["practice_blocks"] == {"blockQuiz": 1}
    assert out["issue_counts"]["high"] >= 4


async def test_min_severity_and_chapter_scope(registry, db, org, admin_user, audited):
    out = await ok(registry, ctx_for(db, org, admin_user), "audit_course",
                   course_uuid="course_test", min_severity="high")
    assert {i["severity"] for i in out["issues"]} == {"high"}

    out = await ok(registry, ctx_for(db, org, admin_user), "audit_course",
                   course_uuid="course_test", chapter_uuids=["chapter_later"])
    assert _codes(out) == {"empty_chapter"}


async def test_clean_page_has_no_page_issues(registry, db, org, admin_user, activity):
    activity.content = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Intro"}]},
        _p("A short, finished page about storage, with enough words to count as a real page here."),
    ]}
    db.add(activity)
    await db.commit()
    out = await ok(registry, ctx_for(db, org, admin_user), "audit_course", course_uuid="course_test")
    assert not _codes(out, "activity_test")


async def test_learner_cannot_audit(registry, db, org, regular_user, audited):
    await denied(registry, ctx_for(db, org, regular_user), "audit_course", course_uuid="course_test")
