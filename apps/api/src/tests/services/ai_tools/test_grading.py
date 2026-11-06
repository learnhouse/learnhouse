"""Task shapes, grading flows, submission views, learner progress and analytics
edge cases, run through the full tool pipeline like test_teaching.py."""

import copy
import dataclasses
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import Role, RoleTypeEnum
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, PublicUser, User
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import assignments, learners, refs

NOW = str(datetime.now())
SVC = "src.services.courses.activities.assignments"


# ─── fixtures and helpers ───────────────────────────────────────────────────


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all([*assignments.SPECS, *learners.SPECS])
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
    if name == "grade_submission":
        # Finalizing needs a person's approval (test_security_content pins
        # that); these tests are about what grading does once approved.
        ctx = dataclasses.replace(ctx, approved=True)
    return await run_tool(registry, name, args, ctx)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


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


async def _task(db, assignment, id, kind, contents, *, points=100, title=None):
    t = AssignmentTask(
        id=id, title=title or f"Task {id}", description="", hint="", reference_file=None,
        assignment_type=kind, contents=contents, max_grade_value=points,
        assignment_id=assignment.id, org_id=assignment.org_id, course_id=assignment.course_id,
        chapter_id=assignment.chapter_id, activity_id=assignment.activity_id,
        assignment_task_uuid=f"assignmenttask_{id}", creation_date=NOW, update_date=NOW,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _answer(db, task, user_id, data, *, grade=0):
    ts = AssignmentTaskSubmission(
        assignment_task_submission_uuid=f"ats_{task.id}_{user_id}", task_submission=data,
        grade=grade, task_submission_grade_feedback="", assignment_type=task.assignment_type, user_id=user_id,
        activity_id=task.activity_id, course_id=task.course_id, chapter_id=task.chapter_id,
        assignment_task_id=task.id, creation_date=NOW, update_date=NOW,
    )
    db.add(ts)
    await db.commit()
    await db.refresh(ts)
    return ts


async def _hand_in(db, assignment, user_id, *, uuid="aus_x", status=AssignmentUserSubmissionStatus.SUBMITTED, **extra):
    sub = AssignmentUserSubmission(
        user_id=user_id, assignment_id=assignment.id, grade=extra.pop("grade", 0),
        submission_status=status, attempt_number=1, assignmentusersubmission_uuid=uuid,
        creation_date=NOW, update_date=NOW, **extra,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


@pytest.fixture
async def teacher(db, org, user_role, course):
    """A member who may edit course_test (contributor with update_own) and nothing else."""
    rights = copy.deepcopy(user_role.rights)
    rights["courses"].update(action_update_own=True, action_read_own=True)
    role = Role(
        id=7, name="Teacher", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_teacher", rights=rights, creation_date=NOW, update_date=NOW,
    )
    u = User(
        id=3, username="teacher", first_name="Tea", last_name="Cher", email="teacher@test.com",
        password="hashed_password", user_uuid="user_teacher", creation_date=NOW, update_date=NOW,
    )
    db.add_all([role, u])
    await db.commit()
    db.add_all([
        UserOrganization(user_id=u.id, org_id=org.id, role_id=role.id, creation_date=NOW, update_date=NOW),
        ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=u.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=NOW, update_date=NOW,
        ),
    ])
    await db.commit()
    return PublicUser(
        id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name,
        email=u.email, user_uuid=u.user_uuid,
    )


@pytest.fixture
async def course_b(db, org):
    """A second course of the same org with its own assignment, task and graded-able work."""
    c = Course(
        id=2, name="Other Course", description="", public=True, published=True,
        open_to_contributors=False, org_id=org.id, course_uuid="course_b",
        creation_date=NOW, update_date=NOW,
    )
    db.add(c)
    await db.commit()
    ch = Chapter(
        id=2, name="B chapter", description="", org_id=org.id, course_id=c.id,
        chapter_uuid="chapter_b", creation_date=NOW, update_date=NOW,
    )
    db.add(ch)
    await db.commit()
    act = Activity(
        id=2, name="B work", activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY, content={}, published=True,
        org_id=org.id, course_id=c.id, activity_uuid="activity_b", creation_date=NOW, update_date=NOW,
    )
    db.add(act)
    await db.commit()
    db.add_all([
        CourseChapter(chapter_id=ch.id, course_id=c.id, org_id=org.id, order=1, creation_date=NOW, update_date=NOW),
        ChapterActivity(order=1, chapter_id=ch.id, activity_id=act.id, course_id=c.id, org_id=org.id, creation_date=NOW, update_date=NOW),
    ])
    a = Assignment(
        id=12, title="B homework", description="", grading_type=GradingTypeEnum.NUMERIC,
        published=True, org_id=org.id, course_id=c.id, chapter_id=ch.id, activity_id=act.id,
        assignment_uuid="assignment_b", creation_date=NOW, update_date=NOW,
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


def no_answer_keys(value):
    """True when nothing that looks like an answer key is anywhere in value."""
    text = repr(value)
    return all(k not in text for k in ("'correct'", "accepted_answers", "correct_value", "solution_code", "'answer'"))


# ─── task shapes: create ────────────────────────────────────────────────────


async def test_task_shapes_store_optional_fields(registry, db, org, admin_user, chapter):
    tasks = [
        {"type": "form", "title": "F", "questions": [{"text": "The ___ is blue", "blanks": [{"answer": "sky", "placeholder": "?", "hint": "look up"}]}]},
        {"type": "short_answer", "title": "SA", "prompt": "Say hi", "accepted_answers": ["hi"], "match_mode": "exact", "explanation": "Just hi."},
        {"type": "short_answer", "title": "SC", "prompt": "Name", "accepted_answers": ["bob"], "match_mode": "contains"},
        {"type": "short_answer", "title": "SR", "prompt": "Digits", "accepted_answers": [r"\d+"], "match_mode": "regex"},
        {"type": "number_answer", "title": "NA", "prompt": "g?", "correct_value": -9.81, "explanation": "Gravity."},
        {"type": "code", "title": "C", "language_id": 63, "solution_code": "print(2)", "grading_mode": "binary",
         "tests": [{"label": "one", "stdin": "1", "expected_output": "2", "weight": 3}, {"expected_output": "x"}]},
    ]
    await _create(registry, db, org, admin_user, tasks)
    rows = {t.title: t.contents for t in (await db.execute(select(AssignmentTask))).scalars().all()}
    blank = rows["F"]["questions"][0]["blanks"][0]
    assert blank["hint"] == "look up" and blank["placeholder"] == "?"
    assert rows["SA"]["explanation"] == "Just hi." and rows["SA"]["match_mode"] == "exact"
    assert rows["SC"]["match_mode"] == "contains" and "explanation" not in rows["SC"]
    assert rows["SR"] == {"prompt": "Digits", "correct_answers": [r"\d+"], "match_mode": "regex"}
    assert rows["NA"]["explanation"] == "Gravity." and rows["NA"]["tolerance"] == 0 and "unit" not in rows["NA"]
    code = rows["C"]
    assert code["language_id"] == 63 and code["grading_mode"] == "binary"
    assert [t["label"] for t in code["test_cases"]] == ["one", "Test 2"]
    assert code["test_cases"][0]["weight"] == 3 and code["solution_code"] == "print(2)"


@pytest.mark.parametrize(
    "task, needle",
    [
        ({"type": "short_answer", "title": "S", "prompt": "p", "accepted_answers": ["  ", ""]}, "non-empty"),
        ({"type": "short_answer", "title": "S", "prompt": "p", "accepted_answers": ["x" * 1001]}, "1000 characters"),
        ({"type": "short_answer", "title": "S", "prompt": "p", "accepted_answers": ["[a-"], "match_mode": "regex"}, "not a valid regex"),
        ({"type": "short_answer", "title": "S", "prompt": "p", "accepted_answers": ["a"], "match_mode": "fuzzy"}, None),
        ({"type": "short_answer", "title": "S", "prompt": "", "accepted_answers": ["a"]}, None),
        ({"type": "number_answer", "title": "N", "prompt": "p", "correct_value": "nan"}, None),
        ({"type": "number_answer", "title": "N", "prompt": "p", "correct_value": 1, "tolerance": -1}, None),
        ({"type": "number_answer", "title": "N", "prompt": "p"}, None),
        ({"type": "form", "title": "F", "questions": [{"text": "t", "blanks": []}]}, None),
        ({"type": "form", "title": "F", "questions": [{"text": "t", "blanks": [{"answer": ""}]}]}, None),
        ({"type": "code", "title": "C", "tests": []}, None),
        ({"type": "code", "title": "C", "tests": [{"expected_output": "1", "weight": 0}]}, None),
        ({"type": "code", "title": "C", "language_id": 0, "tests": [{"expected_output": "1"}]}, None),
        ({"type": "custom", "title": "X", "data": {"blob": "x" * 20_001}}, "20000 characters"),
        ({"type": "custom", "title": "X", "data": [1, 2]}, None),
        ({"type": "quiz", "title": "Q", "questions": [{"text": "x", "options": [{"text": "only", "correct": True}]}]}, None),
        ({"type": "file_submission", "title": "F", "points": 1001}, None),
        ({"type": "file_submission", "title": ""}, None),
    ],
)
async def test_task_shape_errors_reach_the_agent(registry, db, org, admin_user, chapter, task, needle):
    created = await _create(registry, db, org, admin_user)
    out = await call(registry, ctx_for(db, org, admin_user), "create_assignment_tasks",
                     {"assignment_uuid": created["assignment"]["uuid"], "tasks": [task]})
    assert out.denied_code == "invalid_args"
    if needle:
        assert needle in out.reason
    assert (await db.execute(select(AssignmentTask))).first() is None


async def test_catastrophic_regex_never_hangs_grading(registry, db, org, admin_user, regular_user, chapter):
    """Whatever a teacher stores, grading a hostile answer stays bounded."""
    from src.services.courses.activities.assignments import _check_short_answer

    started = datetime.now()
    assert _check_short_answer("a" * 40 + "!", ["(a+)+$"], "regex") is False
    assert _check_short_answer("x" * 2000, ["x+"], "regex") is False
    assert (datetime.now() - started).total_seconds() < 5


async def test_create_tasks_partial_failure_says_how_far_it_got(registry, db, org, admin_user, chapter):
    created = await _create(registry, db, org, admin_user)
    real = assignments.create_assignment_task
    calls = {"n": 0}

    async def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise HTTPException(status_code=409, detail="conflict")
        return await real(*args, **kwargs)

    tasks = [{"type": "file_submission", "title": f"T{i}"} for i in range(3)]
    with patch.object(assignments, "create_assignment_task", new=flaky):
        out = await call(registry, ctx_for(db, org, admin_user), "create_assignment_tasks",
                         {"assignment_uuid": created["assignment"]["uuid"], "tasks": tasks})
    assert out.status == "denied"
    assert "Added 1 of 3 tasks; task 2 failed" in out.reason and "remaining tasks only" in out.reason
    assert [t.title for t in (await db.execute(select(AssignmentTask))).scalars().all()] == ["T0"]


async def test_create_assignment_failure_removes_the_new_activity(registry, db, org, admin_user, chapter):
    boom = AsyncMock(side_effect=HTTPException(status_code=400, detail="bad assignment"))
    with patch.object(assignments, "create_assignment", new=boom):
        out = await call(registry, ctx_for(db, org, admin_user), "create_assignment",
                         {"chapter_uuid": "chapter_test", "title": "Doomed"})
    assert out.status == "denied"
    rows = (await db.execute(select(Activity).where(Activity.activity_type == ActivityTypeEnum.TYPE_ASSIGNMENT))).first()
    assert rows is None


async def test_create_assignment_each_grading_type(registry, db, org, admin_user, chapter):
    for kind in ("alphabet", "numeric", "percentage", "pass_fail", "gpa_scale"):
        await _create(registry, db, org, admin_user, title=kind, grading_type=kind, allow_retries=True, max_retries=3)
    rows = {a.title: a for a in (await db.execute(select(Assignment))).scalars().all()}
    assert {k: v.grading_type.value for k, v in rows.items()} == {
        "alphabet": "ALPHABET", "numeric": "NUMERIC", "percentage": "PERCENTAGE",
        "pass_fail": "PASS_FAIL", "gpa_scale": "GPA_SCALE",
    }
    assert rows["numeric"].max_retries == 3


# ─── task shapes: update ────────────────────────────────────────────────────


async def test_update_task_changes_type_and_keeps_ids_per_shape(registry, db, org, admin_user, chapter):
    form = {"type": "form", "title": "F", "questions": [{"text": "a ___", "blanks": [{"answer": "x"}]}]}
    code = {"type": "code", "title": "C", "tests": [{"expected_output": "1"}]}
    created = await _create(registry, db, org, admin_user, [form, code])
    form_uuid, code_uuid = (t["uuid"] for t in created["tasks"])
    rows = {t.title: t for t in (await db.execute(select(AssignmentTask))).scalars().all()}
    blank_id = rows["F"].contents["questions"][0]["blanks"][0]["blankUUID"]
    test_id = rows["C"].contents["test_cases"][0]["id"]

    ctx = ctx_for(db, org, admin_user)
    ok(await call(registry, ctx, "update_assignment_task", {
        "assignment_task_uuid": form_uuid,
        "content": {"type": "form", "questions": [{"text": "b ___ ___", "blanks": [{"answer": "y"}, {"answer": "z"}]}]},
    }))
    ok(await call(registry, ctx, "update_assignment_task", {
        "assignment_task_uuid": code_uuid, "hint": "think",
        "content": {"type": "code", "tests": [{"expected_output": "2"}, {"expected_output": "3", "hidden": True}]},
    }))
    for row in rows.values():
        await db.refresh(row)
    blanks = rows["F"].contents["questions"][0]["blanks"]
    assert blanks[0]["blankUUID"] == blank_id and blanks[1]["blankUUID"] != blank_id
    assert blanks[0]["correctAnswer"] == "y"
    tests = rows["C"].contents["test_cases"]
    assert tests[0]["id"] == test_id and tests[1]["hidden"] is True and rows["C"].hint == "think"

    # A new type starts from fresh ids.
    out = ok(await call(registry, ctx, "update_assignment_task", {
        "assignment_task_uuid": form_uuid,
        "content": {"type": "number_answer", "prompt": "n?", "correct_value": 4, "tolerance": 0.5, "unit": "m"},
    }))
    assert out["type"] == "number_answer"
    await db.refresh(rows["F"])
    assert rows["F"].assignment_type == AssignmentTaskTypeEnum.NUMBER_ANSWER
    assert rows["F"].contents == {"prompt": "n?", "correct_value": 4, "tolerance": 0.5, "unit": "m"}

    out = ok(await call(registry, ctx, "update_assignment_task", {
        "assignment_task_uuid": code_uuid, "content": {"type": "custom", "data": {"k": 1}},
    }))
    assert out["type"] == "custom"
    out = ok(await call(registry, ctx, "update_assignment_task", {
        "assignment_task_uuid": code_uuid, "content": {"type": "file_submission"},
    }))
    await db.refresh(rows["C"])
    assert out["type"] == "file_submission" and rows["C"].contents == {}


@pytest.mark.parametrize(
    "content",
    [
        {"type": "essay"},
        {"type": "short_answer", "prompt": "p", "accepted_answers": ["(unclosed"], "match_mode": "regex"},
        {"type": "number_answer", "prompt": "p", "correct_value": "inf"},
        {"type": "custom", "data": {"x": "y" * 20_001}},
        {"type": "quiz", "questions": []},
        {"type": "form", "questions": [{"text": "t", "blanks": [{"answer": "a"}] * 21}]},
    ],
)
async def test_update_task_rejects_bad_content(registry, db, org, admin_user, assignment_task, content):
    out = await call(registry, ctx_for(db, org, admin_user), "update_assignment_task",
                     {"assignment_task_uuid": "assignmenttask_test", "content": content})
    assert out.denied_code == "invalid_args"
    await db.refresh(assignment_task)
    assert assignment_task.contents["correct_answers"] == ["4"]


async def test_update_task_in_course_you_cannot_edit(registry, db, org, teacher, course_b):
    await _task(db, course_b, 60, AssignmentTaskTypeEnum.FILE_SUBMISSION, {})
    out = await call(registry, ctx_for(db, org, teacher), "update_assignment_task",
                     {"assignment_task_uuid": "assignmenttask_60", "title": "Mine now"})
    assert out.status == "denied"
    assert (await db.get(AssignmentTask, 60)).title == "Task 60"


def test_summaries_and_small_helpers():
    by_name = {s.name: s for s in assignments.SPECS}
    p = assignments.UpdateAssignmentTaskParams(assignment_task_uuid="assignmenttask_x")
    assert by_name["update_assignment_task"].summarize(p) == "Update assignment task: nothing"
    p = assignments.UpdateAssignmentParams(assignment_uuid="assignment_x", published=True)
    assert by_name["update_assignment"].summarize(p) == "Publish assignment"
    p = assignments.UpdateAssignmentParams(assignment_uuid="assignment_x", published=False, title="T")
    assert by_name["update_assignment"].summarize(p) == "Update assignment: title, published"
    p = assignments.GradeSubmissionParams(
        assignment_uuid="a", user_uuid="u", finalize=False,
        task_grades=[{"assignment_task_uuid": "t", "grade": 1}],
    )
    assert by_name["grade_submission"].summarize(p) == "Set draft task grades for learner u on a: 1 pts on task t (not finalized)"
    assert assignments.UpdateAssignmentParams(assignment_uuid="a", due_date=None).changes() == {}
    assert assignments.UpdateAssignmentParams(assignment_uuid="a", due_date="  ").due_date == ""
    assert assignments._low(None) is None and assignments._low(GradingTypeEnum.NUMERIC) == "numeric"
    assert assignments._at("nope", 0) == {} and assignments._at([1], 0) == {}


# ─── reading task contents ──────────────────────────────────────────────────


async def test_contents_round_trip_for_editors_and_learners(registry, db, org, admin_user, regular_user, chapter):
    tasks = [
        {"type": "form", "title": "F", "questions": [{"text": "The ___", "blanks": [{"answer": "sky", "placeholder": "p", "hint": "up"}]}]},
        {"type": "short_answer", "title": "SA", "prompt": "hi?", "accepted_answers": ["hi"], "explanation": "why"},
        {"type": "number_answer", "title": "NA", "prompt": "n?", "correct_value": 2, "tolerance": 0.1, "unit": "kg", "explanation": "math"},
        {"type": "code", "title": "C", "starter_code": "# go", "solution_code": "print(1)",
         "tests": [{"label": "seen", "stdin": "a", "expected_output": "b"}, {"label": "secret", "stdin": "c", "expected_output": "d", "hidden": True}]},
        {"type": "custom", "title": "X", "data": {"small": True}},
        {"type": "custom", "title": "Big", "data": {"text": "z" * 5000}},
        {"type": "file_submission", "title": "Up"},
    ]
    created = await _create(registry, db, org, admin_user, tasks)
    uuid = created["assignment"]["uuid"]
    args = {"assignment_uuid": uuid, "include_task_contents": True}

    editor = ok(await call(registry, ctx_for(db, org, admin_user), "get_assignment", args))
    c = {t["task"]["name"]: t["content"] for t in editor["tasks"]}
    assert c["F"] == {"questions": [{"text": "The ___", "blanks": [{"placeholder": "p", "hint": "up", "answer": "sky"}]}]}
    assert c["SA"] == {"prompt": "hi?", "match_mode": "case_insensitive", "accepted_answers": ["hi"], "explanation": "why"}
    assert c["NA"] == {"prompt": "n?", "unit": "kg", "correct_value": 2, "tolerance": 0.1, "explanation": "math"}
    assert c["C"]["solution_code"] == "print(1)" and c["C"]["tests"][1]["expected_output"] == "d"
    assert c["X"] == {"data": {"small": True}}
    assert c["Big"]["truncated"] is True and len(c["Big"]["data_preview"]) <= 1000
    assert c["Up"] == {}
    assert editor["submissions"] == {}

    ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "update_assignment", {"assignment_uuid": uuid, "published": True}))
    learner = ok(await call(registry, ctx_for(db, org, regular_user), "get_assignment", args))
    c = {t["task"]["name"]: t["content"] for t in learner["tasks"]}
    assert "submissions" not in learner and "/activity/" in learner["url"]
    for name in ("F", "SA", "NA", "C"):
        assert no_answer_keys(c[name]), (name, c[name])
    assert c["F"]["questions"][0]["blanks"][0]["hint"] == "up"
    assert c["NA"] == {"prompt": "n?", "unit": "kg"}
    seen, secret = c["C"]["tests"]
    assert seen["expected_output"] == "b" and "stdin" not in secret and "expected_output" not in secret


async def test_contents_tolerate_junk_rows(registry, db, org, admin_user, assignment):
    await _task(db, assignment, 61, AssignmentTaskTypeEnum.QUIZ, {
        "questions": ["junk", {"questionText": "Q", "options": ["junk", {"text": "A", "assigned_right_answer": True}]}],
    })
    await _task(db, assignment, 62, AssignmentTaskTypeEnum.FORM, {"questions": [7, {"questionText": "B", "blanks": ["x", {"correctAnswer": "k"}]}]})
    await _task(db, assignment, 63, AssignmentTaskTypeEnum.CODE, {"test_cases": ["junk", {"expected_stdout": "legacy"}]})
    await _task(db, assignment, 64, AssignmentTaskTypeEnum.OTHER, {})
    out = ok(await call(registry, ctx_for(db, org, admin_user), "get_assignment",
                        {"assignment_uuid": "assignment_test", "include_task_contents": True}))
    quiz, form, code, other = (t["content"] for t in out["tasks"])
    assert quiz["questions"] == [{"text": "Q", "response_type": "single", "options": [{"text": "A", "correct": True}]}]
    assert form["questions"] == [{"text": "B", "blanks": [{"placeholder": "", "answer": "k"}]}]
    assert code["tests"] == [{"label": None, "hidden": False, "weight": 1, "stdin": "", "expected_output": "legacy"}]
    assert code["grading_mode"] == "equal_weight"
    assert other == {"data": {}}


# ─── listing assignments ────────────────────────────────────────────────────


async def test_list_assignments_skips_courses_you_cannot_open(registry, db, org, admin_user, regular_user, chapter, course_b):
    await _create(registry, db, org, admin_user)
    ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "update_assignment",
                  {"assignment_uuid": (await db.execute(select(Assignment.assignment_uuid).where(Assignment.title == "Homework 1"))).scalar_one(), "published": True}))
    real = assignments.get_assignments_from_course

    async def gate(request, course_uuid, user, db_session):
        if course_uuid == "course_b" and not isinstance(user, APITokenUser) and user.id == regular_user.id:
            raise HTTPException(status_code=403, detail="Not in your group")
        return await real(request, course_uuid, user, db_session)

    with patch.object(assignments, "get_assignments_from_course", new=gate):
        names = {i["name"] for i in ok(await call(registry, ctx_for(db, org, admin_user), "list_assignments", {}))["items"]}
        assert names == {"Homework 1", "B homework"}
        page = ok(await call(registry, ctx_for(db, org, regular_user), "list_assignments", {}))
        assert [i["name"] for i in page["items"]] == ["Homework 1"] and page.get("total") is None
        out = await call(registry, ctx_for(db, org, regular_user), "list_assignments", {"course_uuid": "course_b"})
        assert out.denied_code == "http_403"


async def test_list_assignments_counts_submissions_for_instructors(registry, db, org, admin_user, assignment, user_submission):
    await _hand_in(db, assignment, admin_user.id, uuid="aus_admin", status=AssignmentUserSubmissionStatus.GRADED)
    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_assignments", {"course_uuid": "course_test"}))
    item = page["items"][0]
    assert item["submissions"] == {"submitted": 1, "graded": 1} and page["total"] == 1
    assert item["grading_type"] == "numeric" and item["due_date"] == "2030-01-01"


async def test_learner_link_needs_an_activity(db, org, regular_user, course):
    ctx = ctx_for(db, org, regular_user)
    assert await assignments._assignment_url(ctx, "assignment_x", course, None, False) is None
    assert await assignments._assignment_url(ctx, "assignment_x", None, None, True) == "https://acme.test/dash/assignments/x"


async def test_assignment_whose_course_is_gone(registry, db, org, admin_user, assignment):
    assignment.course_id = 999
    db.add(assignment)
    await db.commit()
    out = await call(registry, ctx_for(db, org, admin_user), "list_submissions", {"assignment_uuid": "assignment_test"})
    assert out.denied_code == "http_404"


# ─── update / grading type ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "kind, display, passed",
    [
        ("alphabet", "B", True),
        ("percentage", "85.00%", True),
        ("pass_fail", "Pass", True),
        ("numeric", None, True),
        ("gpa_scale", None, True),
    ],
)
async def test_grading_types_shape_the_final_grade(registry, db, org, admin_user, regular_user, assignment_task, user_submission, task_submission, kind, display, passed):
    ctx = ctx_for(db, org, admin_user)
    out = ok(await call(registry, ctx, "update_assignment", {"assignment_uuid": "assignment_test", "grading_type": kind}))
    assert out["summary"].endswith("grading_type.")
    stored = await db.get(Assignment, 10)
    await db.refresh(stored)
    assert stored.grading_type.value == kind.upper()

    graded = ok(await call(registry, ctx, "grade_submission", {
        "assignment_uuid": "assignment_test", "user_uuid": "user_regular",
        "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 85}],
    }))
    assert graded["grade"]["points"] == "85/100 pts" and graded["grade"]["passed"] is passed
    assert graded["grade"]["percentage"] == 85.0
    if display:
        assert graded["grade"]["display"] == display
    else:
        assert isinstance(graded["grade"]["display"], str) and graded["grade"]["display"]

    # The same grade shows up in the submission views.
    sub = ok(await call(registry, ctx, "get_submission", {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"}))
    assert sub["status"] == "graded" and sub["grade"] == graded["grade"]
    page = ok(await call(registry, ctx, "list_submissions", {"assignment_uuid": "assignment_test", "status": "graded"}))
    assert page["items"][0]["grade"] == graded["grade"]


async def test_failing_grade_in_each_letter_mode(registry, db, org, admin_user, regular_user, assignment_task, user_submission, task_submission):
    ctx = ctx_for(db, org, admin_user)
    for kind, display in (("alphabet", "F"), ("pass_fail", "Fail"), ("gpa_scale", "0.0")):
        ok(await call(registry, ctx, "update_assignment", {"assignment_uuid": "assignment_test", "grading_type": kind}))
        out = ok(await call(registry, ctx, "grade_submission", {
            "assignment_uuid": "assignment_test", "user_uuid": "user_regular",
            "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 10}],
        }))
        assert out["grade"]["display"] == display and out["grade"]["passed"] is False


async def test_update_assignment_rejects_bad_grading_type(registry, db, org, admin_user, assignment):
    for bad in ({"grading_type": "letters"}, {"max_retries": -1}, {"title": ""}):
        out = await call(registry, ctx_for(db, org, admin_user), "update_assignment", {"assignment_uuid": "assignment_test", **bad})
        assert out.denied_code == "invalid_args"


# ─── grading flows ──────────────────────────────────────────────────────────


async def test_grade_without_finalizing(registry, db, org, admin_user, assignment_task, user_submission, task_submission):
    out = ok(await call(registry, ctx_for(db, org, admin_user), "grade_submission", {
        "assignment_uuid": "assignment_test", "user_uuid": "user_regular", "finalize": False,
        "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 0, "feedback": "Redo"}],
    }))
    assert "not finalized" in out["summary"] and out["member"]["uuid"] == "user_regular"
    assert "grade" not in out
    await db.refresh(task_submission)
    await db.refresh(user_submission)
    assert task_submission.grade == 0 and task_submission.manually_graded is True
    assert user_submission.submission_status == AssignmentUserSubmissionStatus.SUBMITTED


async def test_grade_task_the_learner_never_answered(registry, db, org, admin_user, assignment, assignment_task, user_submission, task_submission):
    await _task(db, assignment, 65, AssignmentTaskTypeEnum.FILE_SUBMISSION, {}, points=10, title="Upload")
    out = await call(registry, ctx_for(db, org, admin_user), "grade_submission", {
        "assignment_uuid": "assignment_test", "user_uuid": "user_regular",
        "task_grades": [
            {"assignment_task_uuid": "assignmenttask_test", "grade": 50},
            {"assignment_task_uuid": "assignmenttask_65", "grade": 5},
        ],
    })
    assert out.denied_code == "http_400" and 'not answered task "Upload"' in out.reason
    await db.refresh(task_submission)
    assert task_submission.grade == 100  # validated before the first write


@pytest.mark.parametrize("grade", [-1, 1001])
async def test_grade_bounds_are_validated(registry, db, org, admin_user, assignment_task, user_submission, task_submission, grade):
    out = await call(registry, ctx_for(db, org, admin_user), "grade_submission", {
        "assignment_uuid": "assignment_test", "user_uuid": "user_regular",
        "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": grade}],
    })
    assert out.denied_code == "invalid_args"


async def test_grade_zero_point_task(registry, db, org, admin_user, assignment, user_submission):
    task = await _task(db, assignment, 66, AssignmentTaskTypeEnum.FILE_SUBMISSION, {}, points=0, title="Free")
    await _answer(db, task, 2, {"fileUUID": "f.pdf"})
    args = {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"}
    out = await call(registry, ctx_for(db, org, admin_user), "grade_submission",
                     {**args, "task_grades": [{"assignment_task_uuid": "assignmenttask_66", "grade": 1}]})
    assert out.denied_code == "http_400" and "at most 0 points" in out.reason
    out = ok(await call(registry, ctx_for(db, org, admin_user), "grade_submission",
                        {**args, "task_grades": [{"assignment_task_uuid": "assignmenttask_66", "grade": 0}]}))
    assert out["grade"]["percentage"] == 0.0


async def test_grading_needs_instructor_authority(registry, db, org, admin_user, assignment_task, user_submission, task_submission):
    with patch.object(assignments, "_is_assignment_instructor", new=AsyncMock(return_value=False)):
        out = await call(registry, ctx_for(db, org, admin_user), "grade_submission", {
            "assignment_uuid": "assignment_test", "user_uuid": "user_regular",
            "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 1}],
        })
    assert out.denied_code == "http_403" and "Only instructors" in out.reason
    await db.refresh(task_submission)
    assert task_submission.grade == 100


async def test_teacher_grades_own_course(registry, db, org, teacher, regular_user, assignment_task, user_submission, task_submission):
    out = ok(await call(registry, ctx_for(db, org, teacher), "grade_submission", {
        "assignment_uuid": "assignment_test", "user_uuid": "user_regular",
        "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 90}],
    }))
    assert out["grade"]["points"] == "90/100 pts"
    page = ok(await call(registry, ctx_for(db, org, teacher), "list_submissions", {"assignment_uuid": "assignment_test"}))
    assert page["total"] == 1 and page["grading_url"]


async def test_teacher_cannot_grade_or_read_another_course(registry, db, org, teacher, regular_user, course_b):
    task = await _task(db, course_b, 67, AssignmentTaskTypeEnum.SHORT_ANSWER,
                       {"prompt": "p", "correct_answers": ["x"], "match_mode": "exact"})
    ts = await _answer(db, task, regular_user.id, {"answer": "x"}, grade=100)
    await _hand_in(db, course_b, regular_user.id, uuid="aus_b")
    ctx = ctx_for(db, org, teacher)

    for args in (
        {"task_grades": [{"assignment_task_uuid": "assignmenttask_67", "grade": 0}]},
        {},
    ):
        out = await call(registry, ctx, "grade_submission", {"assignment_uuid": "assignment_b", "user_uuid": "user_regular", **args})
        assert out.denied_code == "http_403", (args, out.reason)
    await db.refresh(ts)
    assert ts.grade == 100 and ts.manually_graded is not True
    sub = (await db.execute(select(AssignmentUserSubmission).where(AssignmentUserSubmission.assignmentusersubmission_uuid == "aus_b"))).scalars().one()
    assert sub.submission_status == AssignmentUserSubmissionStatus.SUBMITTED

    # The teacher is a learner there: their own empty view, never someone else's work.
    page = ok(await call(registry, ctx, "list_submissions", {"assignment_uuid": "assignment_b"}))
    assert page["items"] == [] and page["grading_url"] is None
    out = await call(registry, ctx, "get_submission", {"assignment_uuid": "assignment_b", "user_uuid": "user_regular"})
    assert out.status == "denied"
    out = await call(registry, ctx, "list_course_learners", {"course_uuid": "course_b"})
    assert out.denied_code == "http_403"
    out = await call(registry, ctx, "get_learner_progress", {"user_uuid": "user_regular", "course_uuid": "course_b"})
    assert out.denied_code == "http_403"


async def test_grade_member_of_another_org_is_not_found(registry, db, org, other_org, admin_user, assignment_task):
    db.add(User(
        id=9, username="stranger", first_name="S", last_name="T", email="s@test.com",
        password="x", user_uuid="user_stranger", creation_date=NOW, update_date=NOW,
    ))
    await db.commit()
    db.add(UserOrganization(user_id=9, org_id=other_org.id, role_id=4, creation_date=NOW, update_date=NOW))
    await db.commit()
    out = await call(registry, ctx_for(db, org, admin_user), "grade_submission",
                     {"assignment_uuid": "assignment_test", "user_uuid": "user_stranger"})
    assert out.denied_code == "http_404"


# ─── submissions ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "status, expected",
    [
        (None, {"aus_a", "aus_b", "aus_c", "aus_d"}),
        ("needs_grading", {"aus_a", "aus_b"}),
        ("submitted", {"aus_a"}),
        ("late", {"aus_b"}),
        ("pending", {"aus_c"}),
        ("graded", set()),
        ("not_submitted", {"aus_d"}),
    ],
)
async def test_submission_status_filters(registry, db, org, admin_user, assignment, status, expected):
    users = []
    for n, (uuid, st) in enumerate([
        ("aus_a", AssignmentUserSubmissionStatus.SUBMITTED),
        ("aus_b", AssignmentUserSubmissionStatus.LATE),
        ("aus_c", AssignmentUserSubmissionStatus.PENDING),
        ("aus_d", AssignmentUserSubmissionStatus.NOT_SUBMITTED),
    ]):
        uid = 20 + n
        db.add(User(id=uid, username=f"l{n}", first_name="", last_name="", email=f"l{n}@test.com",
                    password="x", user_uuid=f"user_l{n}", creation_date=NOW, update_date=NOW))
        await db.commit()
        db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=4, creation_date=NOW, update_date=NOW))
        await db.commit()
        await _hand_in(db, assignment, uid, uuid=uuid, status=st)
        users.append(uid)
    args = {"assignment_uuid": "assignment_test"}
    if status:
        args["status"] = status
    page = ok(await call(registry, ctx_for(db, org, admin_user), "list_submissions", args))
    by_name = {f"l{n}": f"aus_{c}" for n, c in enumerate("abcd")}
    got = {by_name[i["member"]["username"]] for i in page["items"]}
    assert got == expected and page["total"] == len(expected)
    for item in page["items"]:
        assert "email" not in item["member"] and item["member"]["name"] == item["member"]["username"]


async def test_learner_status_filter_stays_on_own_rows(registry, db, org, admin_user, regular_user, assignment):
    await _hand_in(db, assignment, admin_user.id, uuid="aus_admin_late", status=AssignmentUserSubmissionStatus.LATE)
    await _hand_in(db, assignment, regular_user.id, uuid="aus_mine", status=AssignmentUserSubmissionStatus.LATE)
    for status in ("late", "needs_grading", None):
        args = {"assignment_uuid": "assignment_test", **({"status": status} if status else {})}
        page = ok(await call(registry, ctx_for(db, org, regular_user), "list_submissions", args))
        assert [i["member"]["uuid"] for i in page["items"]] == ["user_regular"] and page["total"] == 1


async def test_list_submissions_paging_and_former_members(registry, db, org, admin_user, assignment, assignment_task):
    await _hand_in(db, assignment, 404, uuid="aus_gone", overall_feedback="See me")
    await _hand_in(db, assignment, admin_user.id, uuid="aus_admin")
    first = ok(await call(registry, ctx_for(db, org, admin_user), "list_submissions", {"assignment_uuid": "assignment_test", "limit": 1}))
    assert first["total"] == 2 and first["has_more"] is True
    assert first["items"][0]["member"]["uuid"] == "user_admin" and first["items"][0]["task_scores"] == [None]
    second = ok(await call(registry, ctx_for(db, org, admin_user), "list_submissions",
                           {"assignment_uuid": "assignment_test", "limit": 1, "cursor": first["next_cursor"]}))
    row = second["items"][0]
    assert row["member"]["name"] == "Former member" and row["member"].get("uuid") is None
    assert row["feedback"] == "See me"


async def test_get_submission_reads_every_answer_shape(registry, db, org, admin_user, regular_user, assignment):
    quiz = await _task(db, assignment, 70, AssignmentTaskTypeEnum.QUIZ, {"questions": [
        "junk",
        {"questionUUID": "q1", "questionText": "Pick", "options": [
            "junk", {"optionUUID": "o1", "text": "A"}, {"optionUUID": "o2", "text": "B"}]},
    ]})
    form = await _task(db, assignment, 71, AssignmentTaskTypeEnum.FORM, {"questions": [
        3, {"questionUUID": "q2", "questionText": "Fill", "blanks": [{"blankUUID": "b1"}, {"blankUUID": "b2"}, "x"]},
    ]})
    num = await _task(db, assignment, 72, AssignmentTaskTypeEnum.NUMBER_ANSWER, {"prompt": "n"})
    code = await _task(db, assignment, 73, AssignmentTaskTypeEnum.CODE, {})
    upload = await _task(db, assignment, 74, AssignmentTaskTypeEnum.FILE_SUBMISSION, {})
    empty_upload = await _task(db, assignment, 75, AssignmentTaskTypeEnum.FILE_SUBMISSION, {})
    custom = await _task(db, assignment, 76, AssignmentTaskTypeEnum.CUSTOM, {})
    blank_custom = await _task(db, assignment, 77, AssignmentTaskTypeEnum.CUSTOM, {})
    sa = await _task(db, assignment, 78, AssignmentTaskTypeEnum.SHORT_ANSWER, {})
    uid = regular_user.id
    await _answer(db, quiz, uid, {"submissions": [
        {"questionUUID": "q1", "optionUUID": "o2", "answer": True},
        {"questionUUID": "q1", "optionUUID": "o1", "answer": False}, "junk"]})
    await _answer(db, form, uid, {"submissions": [{"questionUUID": "q2", "blankUUID": "b1", "answer": "sky"}, "junk"]})
    await _answer(db, num, uid, {"answer": 3.5})
    await _answer(db, code, uid, {"language_id": 71, "source_code": "print(1)"})
    await _answer(db, upload, uid, {"fileUUID": "essay.pdf"})
    await _answer(db, empty_upload, uid, {})
    await _answer(db, custom, uid, {"choice": "left"})
    await _answer(db, blank_custom, uid, None)
    await _answer(db, sa, uid, {})
    await _hand_in(db, assignment, uid, uuid="aus_shapes")

    out = ok(await call(registry, ctx_for(db, org, admin_user), "get_submission",
                        {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"}))
    answers = {t["task"]["uuid"]: t["answer"] for t in out["tasks"]}
    assert answers["assignmenttask_70"] == [{"question": "Pick", "selected": ["B"]}]
    assert answers["assignmenttask_71"] == [{"question": "Fill", "answers": ["sky", ""]}]
    assert answers["assignmenttask_72"] == "3.5"
    assert answers["assignmenttask_73"] == {"language_id": 71, "source_code": "print(1)"}
    assert answers["assignmenttask_74"] == {"file": "essay.pdf"}
    assert answers["assignmenttask_75"] is None
    assert answers["assignmenttask_76"] == '{"choice": "left"}'
    assert answers["assignmenttask_77"] is None
    assert answers["assignmenttask_78"] is None
    assert out["status"] == "submitted" and out["grade"] is None and out["attempt"] == 1


async def test_get_submission_nothing_handed_in(registry, db, org, admin_user, assignment_task):
    out = ok(await call(registry, ctx_for(db, org, admin_user), "get_submission",
                        {"assignment_uuid": "assignment_test", "user_uuid": "user_admin"}))
    assert out["status"] == "not_started" and out["attempt"] is None and out["feedback"] is None
    assert out["tasks"][0]["answered"] is False and out["tasks"][0]["answer"] is None


async def test_learner_reads_own_graded_submission(registry, db, org, regular_user, assignment_task, graded_submission, task_submission):
    out = ok(await call(registry, ctx_for(db, org, regular_user), "get_submission",
                        {"assignment_uuid": "assignment_test", "user_uuid": "user_regular"}))
    assert out["grade"]["points"] == "85/100 pts" and out["feedback"] == "Good work"
    assert "grading_url" not in out and "email" not in out["member"]
    page = ok(await call(registry, ctx_for(db, org, regular_user), "list_submissions", {"assignment_uuid": "assignment_test"}))
    assert page["items"][0]["feedback"] == "Good work" and page["items"][0]["grade"]["passed"] is True


async def test_token_submission_views(registry, db, org, assignment_task, user_submission, task_submission):
    tok = token(org, assignments=ALL)
    page = ok(await call(registry, ctx_for(db, org, tok), "list_submissions", {"assignment_uuid": "assignment_test"}))
    assert page["total"] == 1 and page["grading_url"]
    out = await call(registry, ctx_for(db, org, token(org, courses=ALL)), "list_submissions", {"assignment_uuid": "assignment_test"})
    assert out.denied_code == "missing_right"


# ─── learners ───────────────────────────────────────────────────────────────


async def _run(db, org, course, user_id, *, last=NOW):
    trail = (await db.execute(select(Trail).where(Trail.user_id == user_id))).scalars().first()
    if trail is None:
        trail = Trail(org_id=org.id, user_id=user_id, trail_uuid=f"trail_{user_id}", creation_date=NOW, update_date=NOW)
        db.add(trail)
        await db.commit()
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=user_id, creation_date=NOW, update_date=last))
    await db.commit()


async def test_learner_sorts(registry, db, org, admin_user, regular_user, teacher, course, activity):
    await _run(db, org, course, regular_user.id, last="2020-01-01 00:00:00")
    await _run(db, org, course, admin_user.id, last="2024-01-01 00:00:00")
    await _run(db, org, course, teacher.id, last="garbage")
    ctx = ctx_for(db, org, admin_user)
    page = ok(await call(registry, ctx, "list_course_learners", {"course_uuid": "course_test", "sort": "last_active_asc"}))
    assert [i["learner"]["uuid"] for i in page["items"]] == ["user_teacher", "user_regular", "user_admin"]
    assert page["items"][0]["last_active_at"] == "garbage"
    page = ok(await call(registry, ctx, "list_course_learners", {"course_uuid": "course_test", "sort": "name"}))
    assert [i["learner"]["name"] for i in page["items"]] == ["Admin User", "Regular User", "Tea Cher"]
    # The teacher of the course may read its roster too.
    page = ok(await call(registry, ctx_for(db, org, teacher), "list_course_learners", {"course_uuid": "course_test"}))
    assert page["total"] == 3
    for bad in ({"sort": "random"}, {"inactive_days": 0}, {"inactive_days": 366}):
        out = await call(registry, ctx, "list_course_learners", {"course_uuid": "course_test", **bad})
        assert out.denied_code == "invalid_args"


async def test_progress_of_a_learner_not_enrolled(registry, db, org, admin_user, regular_user, teacher, course, activity):
    for ctx in (ctx_for(db, org, admin_user), ctx_for(db, org, teacher)):
        out = ok(await call(registry, ctx, "get_learner_progress", {"user_uuid": "user_regular", "course_uuid": "course_test"}))
        assert out["items"] == [] and out["note"] == "Not enrolled in this course yet." and out["total"] == 0
    out = ok(await call(registry, ctx_for(db, org, regular_user), "get_learner_progress", {"course_uuid": "course_test"}))
    assert out["note"] == "Not enrolled in this course yet."
    # Across courses only admins may look at someone else.
    out = await call(registry, ctx_for(db, org, teacher), "get_learner_progress", {"user_uuid": "user_regular"})
    assert out.denied_code == "http_403"
    assert (await db.execute(select(TrailRun))).first() is None


async def test_progress_activity_list_is_capped(registry, db, org, regular_user, course, activity):
    await _run(db, org, course, regular_user.id)
    with patch.object(learners, "MAX_ACTIVITIES", 0):
        out = ok(await call(registry, ctx_for(db, org, regular_user), "get_learner_progress", {"course_uuid": "course_test"}))
    item = out["items"][0]
    assert item["activities"] == [] and item["activities_truncated"] is True
    assert item["progress"]["total_activities"] == 1


async def test_learner_helpers():
    assert learners.iso(None) is None and learners.iso("") is None
    assert learners.iso("not a date") == "not a date"
    assert learners.iso("2026-01-02 03:04:05.678") == "2026-01-02T03:04:05"
    assert learners._parsed(None) is None and learners._parsed("nope") is None
    assert learners._parsed("2026-01-02T03:04:05+02:00").tzinfo is None
    assert learners._latest(None, "") is None


async def test_token_sees_every_roster(db, org, course):
    ctx = ctx_for(db, org, token(org, courses=ALL))
    assert await learners.can_see_course_learners(ctx, course) is True
