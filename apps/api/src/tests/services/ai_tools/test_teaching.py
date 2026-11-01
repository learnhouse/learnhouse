"""Assignment, grading, learner and analytics tools, run through the full
tool pipeline (validation, scope, rights pre-flight, approval gate, execute)."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.users import APITokenUser
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import analytics, assignments, learners, refs

NOW = str(datetime.now())
SVC = "src.services.courses.activities.assignments"


# ─── fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all([*assignments.SPECS, *learners.SPECS, *analytics.SPECS])
    return r


@pytest.fixture(autouse=True)
def quiet_services():
    """Keep plan counters, webhooks, audit rows, storage and links local."""
    with patch(f"{SVC}.check_limits_with_usage", new=AsyncMock()), \
            patch.object(assignments, "check_limits_with_usage", new=AsyncMock()), \
            patch(f"{SVC}.increase_feature_usage", new=AsyncMock()), \
            patch(f"{SVC}.decrease_feature_usage", new=AsyncMock()), \
            patch(f"{SVC}.dispatch_webhooks", new=AsyncMock()), \
            patch(f"{SVC}.record_audit_event", new=AsyncMock()), \
            patch(f"{SVC}.check_course_completion_and_create_certificate", new=AsyncMock()), \
            patch(f"{SVC}.are_course_assignments_passed", new=AsyncMock(return_value=True)), \
            patch("src.services.courses.transfer.storage_utils.delete_storage_directory"), \
            patch.object(refs, "web_base", new=AsyncMock(return_value="https://acme.test")):
        yield


def ctx_for(db, org, user, *, approved=False):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode="execute",
        surface="mcp",
        approved=approved,
    )


def token(org, **rights):
    return APITokenUser(
        id=1,
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org.id,
        rights=rights,
        token_name="Test Token",
        created_by_user_id=1,
    )


ALL = {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}


async def call(registry, ctx, name, args):
    return await run_tool(registry, name, args, ctx)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


QUIZ = {
    "type": "quiz",
    "title": "Capitals",
    "questions": [
        {
            "text": "Capital of France?",
            "options": [{"text": "Paris", "correct": True}, {"text": "Lyon"}],
        },
        {
            "text": "Pick the even numbers",
            "options": [
                {"text": "2", "correct": True},
                {"text": "3"},
                {"text": "4", "correct": True},
            ],
        },
    ],
}


@pytest.fixture
async def foreign_chapter(db, other_org):
    c = Course(
        id=50,
        name="Elsewhere",
        description="",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=other_org.id,
        course_uuid="course_elsewhere",
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(c)
    await db.commit()
    ch = Chapter(
        id=50,
        name="Far",
        description="",
        org_id=other_org.id,
        course_id=c.id,
        chapter_uuid="chapter_elsewhere",
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(ch)
    await db.commit()
    return ch


async def _create(registry, db, org, admin_user, tasks=None, **extra):
    args = {"chapter_uuid": "chapter_test", "title": "Homework 1", **extra}
    out = ok(await call(registry, ctx_for(db, org, admin_user), "create_assignment", args))
    if tasks:
        added = ok(await call(
            registry, ctx_for(db, org, admin_user), "create_assignment_tasks",
            {"assignment_uuid": out["assignment"]["uuid"], "tasks": tasks},
        ))
        out["tasks"] = added["tasks"]
    return out


# ─── create ──────────────────────────────────────────────────────────────────


async def test_create_assignment_with_every_task_type(registry, db, org, admin_user, chapter):
    tasks = [
        QUIZ,
        {"type": "short_answer", "title": "SA", "prompt": "2+2?", "accepted_answers": [" 4 ", "four"]},
        {"type": "number_answer", "title": "NA", "prompt": "pi?", "correct_value": 3.14, "tolerance": 0.01, "unit": "rad"},
        {"type": "form", "title": "F", "questions": [{"text": "The ___ is blue", "blanks": [{"answer": "sky"}]}]},
        {"type": "file_submission", "title": "Upload", "description": "Send a PDF", "points": 50},
        {"type": "code", "title": "C", "tests": [{"stdin": "1", "expected_output": "2", "hidden": True}]},
        {"type": "custom", "title": "X", "data": {"anything": [1, 2]}},
    ]
    out = await _create(registry, db, org, admin_user, tasks, due_date="2030-01-31", grading_type="pass_fail")
    assert out["ok"] is True
    assert out["assignment"]["kind"] == "assignment"
    assert out["assignment"]["url"].startswith("https://acme.test/dash/assignments/")
    assert len(out["tasks"]) == 7 and out["tasks"][0]["kind"] == "assignment_task"

    a = (await db.execute(select(Assignment))).scalars().one()
    assert a.published is False and a.due_date == "2030-01-31"
    assert a.grading_type.value == "PASS_FAIL"
    activity = await db.get(Activity, a.activity_id)
    assert activity.activity_type == ActivityTypeEnum.TYPE_ASSIGNMENT and activity.published is False

    rows = {t.title: t for t in (await db.execute(select(AssignmentTask))).scalars().all()}
    quiz = rows["Capitals"].contents
    assert quiz["grading_mode"] == "all_or_nothing"
    q0, q1 = quiz["questions"]
    assert q0["questionUUID"].startswith("question_") and q0["questionText"] == "Capital of France?"
    assert q0["response_type"] == "single" and q1["response_type"] == "multiple"
    assert q0["options"][0]["optionUUID"].startswith("option_")
    assert [o["assigned_right_answer"] for o in q1["options"]] == [True, False, True]
    assert rows["SA"].contents == {"prompt": "2+2?", "correct_answers": ["4", "four"], "match_mode": "case_insensitive"}
    assert rows["NA"].contents["correct_value"] == 3.14 and rows["NA"].contents["unit"] == "rad"
    assert rows["F"].contents["questions"][0]["blanks"][0]["correctAnswer"] == "sky"
    assert rows["F"].contents["questions"][0]["blanks"][0]["blankUUID"].startswith("blank_")
    assert rows["Upload"].contents == {} and rows["Upload"].max_grade_value == 50
    code = rows["C"].contents
    assert code["test_cases"][0]["expectedStdout"] == "2" and code["test_cases"][0]["id"].startswith("tc_")
    assert rows["X"].assignment_type == AssignmentTaskTypeEnum.CUSTOM and rows["X"].contents == {"anything": [1, 2]}


@pytest.mark.parametrize(
    "bad",
    [
        {"due_date": "not a date"},
        {"title": "x" * 201},
        {"grading_type": "NUMERIC"},
    ],
)
async def test_create_assignment_rejects_bad_input(registry, db, org, admin_user, chapter, bad):
    args = {"chapter_uuid": "chapter_test", "title": "Homework", **bad}
    out = await call(registry, ctx_for(db, org, admin_user), "create_assignment", args)
    assert out.denied_code == "invalid_args"
    assert (await db.execute(select(Assignment))).first() is None


@pytest.mark.parametrize(
    "tasks",
    [
        [{"type": "quiz", "title": "Q", "questions": "nope"}],
        [{"type": "quiz", "title": "Q", "questions": [{"text": "x", "options": [{"text": "a"}, {"text": "b"}]}]}],
        [{"type": "quiz", "title": "Q", "questions": [{"text": "x", "response_type": "single", "options": [{"text": "a", "correct": True}, {"text": "b", "correct": True}]}]}],
        [{"type": "short_answer", "title": "S", "prompt": "p", "accepted_answers": ["("], "match_mode": "regex"}],
        [{"type": "essay", "title": "E"}],
        [{"type": "file_submission", "title": f"T{i}"} for i in range(31)],
        [],
    ],
)
async def test_create_assignment_tasks_rejects_bad_input(registry, db, org, admin_user, chapter, tasks):
    created = await _create(registry, db, org, admin_user)
    args = {"assignment_uuid": created["assignment"]["uuid"], "tasks": tasks}
    out = await call(registry, ctx_for(db, org, admin_user), "create_assignment_tasks", args)
    assert out.denied_code == "invalid_args"
    assert (await db.execute(select(AssignmentTask))).first() is None


async def test_create_assignment_foreign_and_wrong_ids(registry, db, org, admin_user, chapter, foreign_chapter):
    out = await call(registry, ctx_for(db, org, admin_user), "create_assignment", {"chapter_uuid": "chapter_elsewhere", "title": "X"})
    assert out.status == "denied"
    out = await call(registry, ctx_for(db, org, admin_user), "create_assignment", {"chapter_uuid": "course_test", "title": "X"})
    assert out.status == "denied"
    assert (await db.execute(select(Activity).where(Activity.activity_type == ActivityTypeEnum.TYPE_ASSIGNMENT))).first() is None


async def test_create_assignment_learner_denied(registry, db, org, regular_user, chapter):
    out = await call(registry, ctx_for(db, org, regular_user), "create_assignment", {"chapter_uuid": "chapter_test", "title": "X"})
    assert out.status == "denied"
    assert (await db.execute(select(Assignment))).first() is None


async def test_create_assignment_plan_limit_writes_nothing(registry, db, org, admin_user, chapter):
    limit = AsyncMock(side_effect=HTTPException(status_code=403, detail="Assignments usage limit reached"))
    with patch.object(assignments, "check_limits_with_usage", new=limit):
        out = await call(registry, ctx_for(db, org, admin_user), "create_assignment", {"chapter_uuid": "chapter_test", "title": "X"})
    assert out.denied_code == "plan_limit"
    assert (await db.execute(select(Activity))).first() is None


# ─── read ────────────────────────────────────────────────────────────────────


async def test_list_and_get_assignment(registry, db, org, admin_user, regular_user, chapter):
    created = await _create(registry, db, org, admin_user, [QUIZ])
    uuid = created["assignment"]["uuid"]

    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_assignments", {}))
    assert page["has_more"] is False and len(page["items"]) == 1
    item = page["items"][0]
    assert item["uuid"] == uuid and item["name"] == "Homework 1"
    assert item["course"]["uuid"] == "course_test" and item["chapter"]["uuid"] == "chapter_test"
    assert item["tasks_count"] == 1 and item["submissions"] == {}
    assert item["grading_type"] == "percentage" and item["published"] is False

    # Drafts are invisible to learners.
    page = ok(await call(registry, ctx_for(db, org, regular_user), "list_assignments", {"course_uuid": "course_test"}))
    assert page["items"] == []

    detail = ok(await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"assignment_uuid": uuid, "include_task_contents": True}))
    assert detail["kind"] == "assignment" and detail["total_points"] == 100
    task = detail["tasks"][0]
    assert task["type"] == "quiz" and task["task"]["uuid"].startswith("assignmenttask_")
    assert task["content"]["questions"][0]["options"][0] == {"text": "Paris", "correct": True}

    by_activity = ok(await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"activity_uuid": created["activity"]["uuid"]}))
    assert by_activity["uuid"] == uuid and "content" not in by_activity["tasks"][0]


async def test_task_instructions_are_whole_when_contents_are_asked_for(registry, db, org, admin_user, chapter):
    long = "Label every part of the cell. " * 40
    created = await _create(registry, db, org, admin_user, [{**QUIZ, "description": long}])
    uuid = created["assignment"]["uuid"]
    full = ok(await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"assignment_uuid": uuid, "include_task_contents": True}))
    assert full["tasks"][0]["description"] == long and "truncated" not in full["tasks"][0]
    brief = ok(await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"assignment_uuid": uuid}))
    assert len(brief["tasks"][0]["description"]) <= 280 and brief["tasks"][0]["truncated"] == ["description"]


async def test_learner_reads_published_assignment_without_answer_keys(registry, db, org, admin_user, regular_user, chapter):
    created = await _create(registry, db, org, admin_user, [QUIZ])
    uuid = created["assignment"]["uuid"]
    ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "update_assignment", {"assignment_uuid": uuid, "published": True}))

    page = ok(await call(registry, ctx_for(db, org, regular_user), "list_assignments", {"course_uuid": "course_test"}))
    assert [i["uuid"] for i in page["items"]] == [uuid]
    assert "submissions" not in page["items"][0]
    assert "/activity/" in page["items"][0]["url"]

    detail = ok(await call(registry, ctx_for(db, org, regular_user), "get_assignment", {"assignment_uuid": uuid, "include_task_contents": True}))
    options = detail["tasks"][0]["content"]["questions"][0]["options"]
    assert options == [{"text": "Paris"}, {"text": "Lyon"}]
    assert "submissions" not in detail


async def test_get_assignment_needs_exactly_one_id(registry, db, org, admin_user):
    out = await call(registry, ctx_for(db, org, admin_user), "get_assignment", {})
    assert out.denied_code == "invalid_args"
    out = await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"assignment_uuid": "assignment_x", "activity_uuid": "activity_x"})
    assert out.denied_code == "invalid_args"


async def test_get_assignment_cross_org_and_wrong_prefix(registry, db, org, admin_user, other_org, foreign_chapter):
    db.add(
        Assignment(
            id=99, title="Foreign", description="", grading_type="NUMERIC", org_id=other_org.id,
            course_id=50, chapter_id=50, activity_id=999, assignment_uuid="assignment_foreign",
            creation_date=NOW, update_date=NOW,
        )
    )
    await db.commit()
    out = await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"assignment_uuid": "assignment_foreign"})
    assert out.denied_code == "http_404"
    out = await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"assignment_uuid": "course_test"})
    assert out.denied_code == "http_400"


async def test_list_assignments_api_token(registry, db, org, assignment):
    out = await call(registry, ctx_for(db, org, token(org, assignments=ALL)), "list_assignments", {})
    assert [i["uuid"] for i in ok(out)["items"]] == ["assignment_test"]
    out = await call(registry, ctx_for(db, org, token(org, courses=ALL)), "list_assignments", {})
    assert out.denied_code == "missing_right"


async def test_list_assignments_paging(registry, db, org, admin_user, chapter):
    for n in range(3):
        await _create(registry, db, org, admin_user, title=f"HW {n}")
    first = ok(await call(registry, ctx_for(db, org, admin_user), "list_assignments", {"limit": 2}))
    assert len(first["items"]) == 2 and first["has_more"] is True
    second = ok(await call(registry, ctx_for(db, org, admin_user), "list_assignments", {"limit": 2, "cursor": first["next_cursor"]}))
    assert [i["name"] for i in second["items"]] == ["HW 2"] and second["has_more"] is False


# ─── update / delete ─────────────────────────────────────────────────────────


async def test_update_assignment_publish_needs_approval(registry, db, org, admin_user, chapter):
    created = await _create(registry, db, org, admin_user)
    uuid = created["assignment"]["uuid"]
    out = await call(registry, ctx_for(db, org, admin_user), "update_assignment", {"assignment_uuid": uuid, "published": True})
    assert out.denied_code == "approval_required"

    # Renaming needs no approval.
    out = ok(await call(registry, ctx_for(db, org, admin_user), "update_assignment", {"assignment_uuid": uuid, "title": "Renamed", "due_date": "2031-05-01T17:00"}))
    assert out["assignment"]["name"] == "Renamed"

    out = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "update_assignment", {"assignment_uuid": uuid, "published": True}))
    assert out["published"] is True
    a = (await db.execute(select(Assignment))).scalars().one()
    await db.refresh(a)
    assert (await db.get(Activity, a.activity_id)).published is True
    assert a.due_date == "2031-05-01T17:00"

    ok(await call(registry, ctx_for(db, org, admin_user), "update_assignment", {"assignment_uuid": uuid, "due_date": ""}))
    await db.refresh(a)
    assert a.due_date is None


async def test_update_assignment_validation(registry, db, org, admin_user, regular_user, assignment):
    out = await call(registry, ctx_for(db, org, admin_user), "update_assignment", {"assignment_uuid": "assignment_test", "due_date": "not a date"})
    assert out.denied_code == "invalid_args"
    out = await call(registry, ctx_for(db, org, admin_user), "update_assignment", {"assignment_uuid": "assignment_test"})
    assert out.denied_code == "http_400"
    out = await call(registry, ctx_for(db, org, regular_user), "update_assignment", {"assignment_uuid": "assignment_test", "title": "Mine"})
    assert out.denied_code == "http_403"


async def test_task_crud_keeps_ids_by_position(registry, db, org, admin_user, chapter):
    created = await _create(registry, db, org, admin_user)
    uuid = created["assignment"]["uuid"]
    added = ok(await call(registry, ctx_for(db, org, admin_user), "create_assignment_tasks", {"assignment_uuid": uuid, "tasks": [QUIZ]}))
    task_uuid = added["tasks"][0]["uuid"]
    before = (await db.execute(select(AssignmentTask))).scalars().one().contents

    new_content = {
        "type": "quiz",
        "partial_credit": True,
        "questions": [
            {"text": "Capital of Italy?", "options": [{"text": "Rome", "correct": True}, {"text": "Milan"}]},
            QUIZ["questions"][1],
            {"text": "New one", "options": [{"text": "a", "correct": True}, {"text": "b"}]},
        ],
    }
    out = ok(await call(registry, ctx_for(db, org, admin_user), "update_assignment_task", {"assignment_task_uuid": task_uuid, "points": 40, "content": new_content}))
    assert out["type"] == "quiz"
    row = (await db.execute(select(AssignmentTask))).scalars().one()
    await db.refresh(row)
    after = row.contents
    assert row.max_grade_value == 40 and after["grading_mode"] == "partial_credit"
    assert after["questions"][0]["questionUUID"] == before["questions"][0]["questionUUID"]
    assert after["questions"][0]["options"][0]["optionUUID"] == before["questions"][0]["options"][0]["optionUUID"]
    assert after["questions"][0]["questionText"] == "Capital of Italy?"
    assert after["questions"][2]["questionUUID"] not in {q["questionUUID"] for q in before["questions"]}

    out = await call(registry, ctx_for(db, org, admin_user), "update_assignment_task", {"assignment_task_uuid": task_uuid})
    assert out.denied_code == "http_400"

    out = await call(registry, ctx_for(db, org, admin_user), "delete_assignment_task", {"assignment_task_uuid": task_uuid})
    assert out.denied_code == "approval_required"
    ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "delete_assignment_task", {"assignment_task_uuid": task_uuid}))
    assert (await db.execute(select(AssignmentTask))).first() is None


async def test_delete_assignment_removes_its_activity(registry, db, org, admin_user, regular_user, chapter):
    created = await _create(registry, db, org, admin_user, [QUIZ])
    uuid = created["assignment"]["uuid"]
    out = await call(registry, ctx_for(db, org, regular_user, approved=True), "delete_assignment", {"assignment_uuid": uuid})
    assert out.status == "denied"
    out = await call(registry, ctx_for(db, org, admin_user), "delete_assignment", {"assignment_uuid": uuid})
    assert out.denied_code == "approval_required"
    out = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "delete_assignment", {"assignment_uuid": uuid}))
    assert "activity" in out["summary"]
    assert (await db.execute(select(Assignment))).first() is None
    assert (await db.execute(select(Activity).where(Activity.activity_uuid == created["activity"]["uuid"]))).first() is None


# ─── submissions and grading ─────────────────────────────────────────────────


async def test_list_submissions(registry, db, org, admin_user, regular_user, assignment_task, user_submission, task_submission):
    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_submissions", {"assignment_uuid": "assignment_test"}))
    assert page["total"] == 1 and "note" in page
    row = page["items"][0]
    assert row["member"]["uuid"] == "user_regular" and "email" not in row["member"]
    assert row["status"] == "submitted" and row["task_scores"] == ["100/100"]
    assert page["tasks"][0]["uuid"] == "assignmenttask_test"

    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_submissions", {"assignment_uuid": "assignment_test", "status": "graded"}))
    assert page["items"] == [] and page["total"] == 0
    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_submissions", {"assignment_uuid": "assignment_test", "status": "needs_grading"}))
    assert page["total"] == 1

    # A learner sees only their own row.
    page = ok(await call(registry, ctx_for(db, org, regular_user), "list_submissions", {"assignment_uuid": "assignment_test"}))
    assert [r["member"]["uuid"] for r in page["items"]] == ["user_regular"]
    assert page["grading_url"] is None
    out = await call(registry, ctx_for(db, org, regular_user), "list_submissions", {"assignment_uuid": "assignment_test", "status": "late_ish"})
    assert out.denied_code == "invalid_args"


async def test_learner_cannot_see_others_submissions(registry, db, org, admin_user, regular_user, assignment):
    db.add(
        AssignmentUserSubmission(
            user_id=admin_user.id, assignment_id=assignment.id, grade=0,
            submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
            assignmentusersubmission_uuid="aus_admin", creation_date=NOW, update_date=NOW,
        )
    )
    await db.commit()
    page = ok(await call(registry, ctx_for(db, org, regular_user), "list_submissions", {"assignment_uuid": "assignment_test"}))
    assert page["items"] == []
    out = await call(registry, ctx_for(db, org, regular_user), "get_submission", {"assignment_uuid": "assignment_test", "user_uuid": "user_admin"})
    assert out.denied_code == "http_403"


async def test_get_submission(registry, db, org, admin_user, regular_user, assignment_task, user_submission, task_submission):
    out = ok(await call(registry, ctx_for(db, org, admin_user), "get_submission", {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"}))
    assert "note" in out and out["status"] == "submitted"
    task = out["tasks"][0]
    assert task["answer"] == "4" and task["grade"] == 100 and task["feedback"] == "Correct"
    assert out["grading_url"].endswith("/dash/assignments/test")

    own = ok(await call(registry, ctx_for(db, org, regular_user), "get_submission", {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"}))
    assert own["tasks"][0]["answer"] == "4" and "grading_url" not in own

    out = await call(registry, ctx_for(db, org, admin_user), "get_submission", {"assignment_uuid": "assignment_test", "user_uuid": "user_nobody"})
    assert out.denied_code == "http_404"


async def test_grade_submission(registry, db, org, admin_user, regular_user, assignment_task, user_submission, task_submission):
    args = {
        "assignment_uuid": "assignment_test",
        "user_uuid": "user_regular",
        "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 70, "feedback": "Close"}],
        "feedback": "Nice effort",
    }
    out = await call(registry, ctx_for(db, org, regular_user, approved=True), "grade_submission", args)
    assert out.denied_code == "http_403"

    out = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "grade_submission", args))
    assert out["grade"]["points"] == "70/100 pts" and out["grade"]["passed"] is True
    assert out["tasks"][0]["score"] == "70/100"
    await db.refresh(task_submission)
    await db.refresh(user_submission)
    assert task_submission.grade == 70 and task_submission.manually_graded is True
    assert task_submission.task_submission_grade_feedback == "Close"
    assert user_submission.submission_status == AssignmentUserSubmissionStatus.GRADED
    assert user_submission.overall_feedback == "Nice effort"

    # Grading again with the same input leaves the same state.
    again = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "grade_submission", args))
    assert again["grade"] == out["grade"]


@pytest.mark.parametrize(
    "extra, code",
    [
        ({"task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 101}]}, "http_400"),
        ({"task_grades": [{"assignment_task_uuid": "assignmenttask_other", "grade": 1}]}, "http_400"),
        ({"finalize": False}, "invalid_args"),
        ({"finalize": False, "feedback": "x", "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 1}]}, "invalid_args"),
        ({"task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 1}] * 2}, "invalid_args"),
    ],
)
async def test_grade_submission_rejects(registry, db, org, admin_user, assignment_task, user_submission, task_submission, extra, code):
    args = {"assignment_uuid": "assignment_test", "user_uuid": "user_regular", **extra}
    out = await call(registry, ctx_for(db, org, admin_user, approved=True), "grade_submission", args)
    assert out.denied_code == code
    await db.refresh(task_submission)
    assert task_submission.grade == 100


async def test_grade_submission_token(registry, db, org, assignment_task, user_submission, task_submission):
    tok = token(org, assignments=ALL)
    args = {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"}
    out = await call(registry, ctx_for(db, org, tok, approved=True), "grade_submission", {**args, "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 5}]})
    assert out.denied_code == "http_403"
    out = ok(await call(registry, ctx_for(db, org, tok, approved=True), "grade_submission", args))
    assert out["grade"]["points"] == "100/100 pts"


async def test_grade_nothing_handed_in(registry, db, org, admin_user, regular_user, assignment_task):
    out = await call(registry, ctx_for(db, org, admin_user, approved=True), "grade_submission", {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"})
    assert out.denied_code == "http_404"


# ─── learners ────────────────────────────────────────────────────────────────


async def _enroll(db, org, course, user_id, *, done_activity_ids=(), last=None, run_id=None):
    trail = (await db.execute(select(Trail).where(Trail.user_id == user_id))).scalars().first()
    if trail is None:
        trail = Trail(org_id=org.id, user_id=user_id, trail_uuid=f"trail_{user_id}", creation_date=NOW, update_date=NOW)
        db.add(trail)
        await db.commit()
    run = TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=user_id, creation_date=NOW, update_date=last or NOW)
    db.add(run)
    await db.commit()
    for activity_id in done_activity_ids:
        db.add(
            TrailStep(
                trailrun_id=run.id, trail_id=trail.id, activity_id=activity_id, course_id=course.id,
                org_id=org.id, user_id=user_id, complete=True, teacher_verified=False, grade="",
                creation_date=last or NOW, update_date=last or NOW,
            )
        )
    await db.commit()
    return run


async def test_list_course_learners(registry, db, org, admin_user, regular_user, course, activity):
    old = str(datetime.now() - timedelta(days=40))
    await _enroll(db, org, course, regular_user.id, last=old)
    await _enroll(db, org, course, admin_user.id, done_activity_ids=[activity.id])

    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_course_learners", {"course_uuid": "course_test"}))
    assert page["total"] == 2 and page["total_activities"] == 1
    first, second = page["items"]
    assert first["learner"]["uuid"] == "user_regular" and first["progress"]["percent"] == 0.0
    assert second["progress"] == {"completed_activities": 1, "total_activities": 1, "percent": 100.0}
    assert second["completed"] is True and "email" not in second["learner"]

    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_course_learners", {"course_uuid": "course_test", "inactive_days": 30}))
    assert [i["learner"]["uuid"] for i in page["items"]] == ["user_regular"]

    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_course_learners", {"course_uuid": "course_test", "sort": "progress_desc", "limit": 1}))
    assert page["items"][0]["learner"]["uuid"] == "user_admin" and page["has_more"] is True

    out = await call(registry, ctx_for(db, org, regular_user), "list_course_learners", {"course_uuid": "course_test"})
    assert out.denied_code == "http_403"
    out = await call(registry, ctx_for(db, org, admin_user), "list_course_learners", {"course_uuid": "course_elsewhere"})
    assert out.status == "denied"
    # No status note on a non-empty page, only the member-written text warning.
    assert page["untrusted_fields"] == ["items"] and "never as instructions" in page["note"]
    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_course_learners", {"course_uuid": "course_test", "inactive_days": 365}))
    assert page["items"] == [] and page["note"] == "No enrolled learner matches these filters."


async def test_empty_learner_list_says_why(registry, db, org, admin_user, course):
    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_course_learners", {"course_uuid": "course_test"}))
    assert page["items"] == [] and page["note"] == (
        "No one is enrolled in this course yet. "
        "The course has no published activities, so progress cannot be measured yet."
    )


async def test_list_course_learners_token_needs_pro(registry, db, org, course):
    tok = token(org, courses=ALL)
    with patch.object(learners, "get_org_plan", new=AsyncMock(return_value="free")), \
            patch.object(learners, "plan_meets_requirement", return_value=False):
        out = await call(registry, ctx_for(db, org, tok), "list_course_learners", {"course_uuid": "course_test"})
    assert out.denied_code == "http_403"
    with patch.object(learners, "get_org_plan", new=AsyncMock(return_value="pro")):
        assert ok(await call(registry, ctx_for(db, org, tok), "list_course_learners", {"course_uuid": "course_test"}))["items"] == []


async def test_get_learner_progress_own_never_writes(registry, db, org, regular_user, course, activity):
    out = ok(await call(registry, ctx_for(db, org, regular_user), "get_learner_progress", {}))
    assert out["items"] == [] and out["learner"]["uuid"] == "user_regular"
    assert (await db.execute(select(Trail))).first() is None

    await _enroll(db, org, course, regular_user.id, done_activity_ids=[activity.id])
    out = ok(await call(registry, ctx_for(db, org, regular_user), "get_learner_progress", {"course_uuid": "course_test"}))
    item = out["items"][0]
    assert item["course"]["uuid"] == "course_test" and item["progress"]["percent"] == 100.0
    assert item["activities"] == [
        {"activity": {"kind": "activity", "uuid": "activity_test", "name": "Test Activity",
                      "url": "https://acme.test/course/test/activity/test", "type": "dynamic"},
         "chapter": "Test Chapter", "done": True, "completed_at": item["activities"][0]["completed_at"]}
    ]
    assert item["activities"][0]["completed_at"]


async def test_get_learner_progress_of_others(registry, db, org, admin_user, regular_user, course):
    await _enroll(db, org, course, admin_user.id)
    out = await call(registry, ctx_for(db, org, regular_user), "get_learner_progress", {"user_uuid": "user_admin"})
    assert out.denied_code == "http_403"
    out = await call(registry, ctx_for(db, org, regular_user), "get_learner_progress", {"user_uuid": "user_admin", "course_uuid": "course_test"})
    assert out.denied_code == "http_403"
    out = ok(await call(registry, ctx_for(db, org, admin_user), "get_learner_progress", {"user_uuid": "user_regular"}))
    assert out["items"] == [] and out["learner"]["uuid"] == "user_regular"
    out = await call(registry, ctx_for(db, org, admin_user), "get_learner_progress", {"user_uuid": "user_ghost"})
    assert out.denied_code == "http_404"


async def test_get_learner_progress_token(registry, db, org, regular_user):
    tok = token(org, courses=ALL)
    out = await call(registry, ctx_for(db, org, tok), "get_learner_progress", {})
    assert out.denied_code == "http_400"
    with patch.object(learners, "get_org_plan", new=AsyncMock(return_value="pro")):
        out = ok(await call(registry, ctx_for(db, org, tok), "get_learner_progress", {"user_uuid": "user_regular"}))
    assert out["learner"]["uuid"] == "user_regular"


# ─── analytics ───────────────────────────────────────────────────────────────


async def test_run_analytics_maps_users_and_drops_ids(registry, db, org, admin_user, regular_user):
    rows = {"data": [{"org_id": 1, "user_id": regular_user.id, "views": 3}, {"org_id": 1, "user_id": 999, "views": 1}]}
    runner = AsyncMock(return_value=rows)
    with patch.object(analytics, "execute_org_query", new=runner):
        out = ok(await call(registry, ctx_for(db, org, admin_user), "run_analytics", {"query": "cohort_retention", "days": 7}))
    assert runner.await_args.args[:3] == ("cohort_retention", org.id, 7)
    assert out["scope"] == "organization" and out["row_count"] == 2
    assert out["rows"][0] == {"member": {"kind": "user", "uuid": "user_regular", "name": "Regular User",
                                         "url": "https://acme.test/user/regular", "username": "regular"}, "views": 3}
    assert out["rows"][1]["member"] is None


async def test_run_analytics_course_query(registry, db, org, admin_user, course):
    runner = AsyncMock(return_value={"data": []})
    with patch.object(analytics, "execute_course_query", new=runner):
        out = ok(await call(registry, ctx_for(db, org, admin_user), "run_analytics", {"query": "course_overview_stats", "course_uuid": "course_test"}))
    assert out["course"]["uuid"] == "course_test" and "note" in out
    assert runner.await_args.args[1] == "course_test"


@pytest.mark.parametrize(
    "args",
    [
        {"query": "course_overview_stats"},
        {"query": "daily_active_users", "course_uuid": "course_test"},
        {"query": "detail_signups", "course_uuid": "course_test"},
        {"query": "course_top_learners"},
        {"query": "drop table"},
        {"query": "daily_active_users", "days": 366},
    ],
)
async def test_run_analytics_rejects(registry, db, org, admin_user, args):
    out = await call(registry, ctx_for(db, org, admin_user), "run_analytics", args)
    assert out.denied_code == "invalid_args"


async def test_run_analytics_not_configured_is_final(registry, db, org, admin_user):
    boom = AsyncMock(side_effect=HTTPException(status_code=503, detail="Analytics not configured"))
    with patch.object(analytics, "execute_org_query", new=boom):
        out = await call(registry, ctx_for(db, org, admin_user), "run_analytics", {"query": "top_courses"})
    assert out.denied_code == "http_400" and "Retrying will not help" in out.reason


async def test_run_analytics_gates(registry, db, org, admin_user, regular_user):
    out = await call(registry, ctx_for(db, org, token(org, dashboard=ALL)), "run_analytics", {"query": "top_courses"})
    assert out.denied_code == "not_for_api_tokens"
    # The real runner refuses non-admins before any query runs.
    out = await call(registry, ctx_for(db, org, regular_user), "run_analytics", {"query": "top_courses"})
    assert out.denied_code == "http_403"


# ─── catalog hygiene ─────────────────────────────────────────────────────────


def test_specs_follow_conventions():
    specs = [*assignments.SPECS, *learners.SPECS, *analytics.SPECS]
    names = {s.name for s in specs}
    assert names == {
        "list_assignments", "get_assignment", "create_assignment", "update_assignment",
        "delete_assignment", "create_assignment_tasks", "update_assignment_task",
        "delete_assignment_task", "list_submissions", "get_submission", "grade_submission",
        "list_course_learners", "get_learner_progress", "run_analytics",
    }
    for spec in specs:
        assert len(spec.description) <= 450, spec.name
        assert chr(0x2014) not in spec.description and chr(0x2013) not in spec.description
        if spec.tier.value != "read":
            assert spec.summarize is not None, spec.name
        for name, field in spec.params_model.model_fields.items():
            assert field.description, f"{spec.name}.{name}"
    by_name = {s.name: s for s in specs}
    assert by_name["delete_assignment"].approval_for(None) is True
    assert by_name["update_assignment"].may_need_approval is True
    assert by_name["run_analytics"].api_tokens is False
