"""AI grading of assignment submissions: credits, drafts, accept/edit/discard,
bulk, AUTO mode, and the grader-only access rules
(src/services/courses/activities/assignment_ai_grading.py)."""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignment_ai_grades import (
    AssignmentAIGrade,
    AssignmentAIGradeAccept,
    AssignmentAIGradeTaskOverride,
)
from src.db.courses.assignments import (
    AIGradingModeEnum,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.users import AnonymousUser, APITokenUser
from src.services.ai.grading.grader import AIGradeOutput, AITaskGrade
from src.services.ai.llm import AINotConfiguredError
from src.services.courses.activities import assignment_ai_grading as svc

pytestmark = pytest.mark.asyncio

_ASSIGN = "src.services.courses.activities.assignments"


def _output(score=80, task_id="assignmenttask_test", extra=()):
    return AIGradeOutput(
        tasks=[AITaskGrade(task_id=task_id, score=score, feedback="Good reasoning"), *extra],
        overall_feedback=" Nice work overall ",
        confidence="high",
        notes="",
    )


@pytest.fixture
def ai(monkeypatch):
    """The model, credits, rate limit and course RBAC, all faked."""
    m = MagicMock()
    m.reserve = AsyncMock(return_value=1)
    m.refund = MagicMock(return_value=0)
    m.grade = AsyncMock(return_value=_output())
    m.rate = MagicMock()
    m.auth = AsyncMock()
    m.transcribe = AsyncMock()
    monkeypatch.setattr("src.security.features_utils.usage.reserve_ai_credit", m.reserve)
    monkeypatch.setattr("src.security.features_utils.usage.refund_ai_credit", m.refund)
    monkeypatch.setattr(svc, "grade_with_model", m.grade)
    monkeypatch.setattr(svc, "enforce_ai_rate_limit", m.rate)
    monkeypatch.setattr(svc, "resolve_model_for_org", AsyncMock(return_value="gemini-test"))
    monkeypatch.setattr(svc, "get_ai_credits_summary", AsyncMock(return_value={"remaining_credits": 50}))
    monkeypatch.setattr(svc.mat, "transcribe_media", m.transcribe)
    monkeypatch.setattr(f"{_ASSIGN}.authorize_assignment_access", m.auth)
    monkeypatch.setattr(f"{_ASSIGN}.dispatch_webhooks", AsyncMock())
    return m


async def _set_mode(db, assignment, mode, ungraded=False):
    assignment.ai_grading_mode = mode
    assignment.ungraded = ungraded
    db.add(assignment)
    await db.commit()


async def _row(db, assignment, user_id):
    return (await db.execute(select(AssignmentAIGrade).where(
        AssignmentAIGrade.assignment_id == assignment.id, AssignmentAIGrade.user_id == user_id
    ))).scalars().first()


async def _run(db, mock_request, admin_user, user_id):
    return await svc.run_ai_grading(mock_request, "assignment_test", user_id, admin_user, db)


# ── single run ───────────────────────────────────────────────────────────────


async def test_suggest_mode_stores_a_draft_and_charges_credits(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    read = await _run(db, mock_request, admin_user, regular_user.id)
    assert read.status == "DRAFT" and read.mode == "SUGGEST" and read.credits_charged == 2
    assert read.tasks[0]["score"] == 80 and read.tasks[0]["scored_by"] == "ai"
    assert read.overall_feedback == "Nice work overall" and read.notes is None and read.triggered_by == admin_user.id
    ai.reserve.assert_awaited_once()
    assert ai.reserve.await_args.kwargs["amount"] == 2
    ai.refund.assert_not_called()
    ai.rate.assert_called_once_with(admin_user.id, assignment.org_id)
    # The submission itself is untouched until a teacher accepts.
    await db.refresh(user_submission)
    assert user_submission.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
    again = await svc.get_ai_grade(mock_request, "assignment_test", regular_user.id, admin_user, db)
    assert again.assignment_ai_grade_uuid == read.assignment_ai_grade_uuid


async def test_auto_mode_applies_the_grade(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    await _set_mode(db, assignment, AIGradingModeEnum.AUTO)
    read = await _run(db, mock_request, admin_user, regular_user.id)
    assert read.status == "APPLIED" and read.applied_by is None
    await db.refresh(user_submission)
    await db.refresh(task_submission)
    assert user_submission.submission_status == AssignmentUserSubmissionStatus.GRADED
    assert task_submission.grade == 80 and task_submission.manually_graded
    assert task_submission.task_submission_grade_feedback == "Good reasoning"
    assert user_submission.overall_feedback == "Nice work overall"
    applied = await svc.applied_ai_grade(db, assignment.id, regular_user.id, user_submission)
    assert applied is not None

    # The learner-facing grade read says it came from AI.
    from src.services.courses.activities.assignments import get_grade_assignment_submission

    with patch(f"{_ASSIGN}._is_assignment_instructor", new=AsyncMock(return_value=False)):
        grade = await get_grade_assignment_submission(mock_request, regular_user.id, "assignment_test", regular_user, db)
    assert grade["ai_graded"] is True and grade["ai_scored_task_uuids"] == ["assignmenttask_test"]


async def test_auto_mode_on_graded_submission_only_drafts(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, graded_submission, task_submission, ai
):
    await _set_mode(db, assignment, AIGradingModeEnum.AUTO)
    read = await _run(db, mock_request, admin_user, regular_user.id)
    assert read.status == "DRAFT"
    assert await svc.applied_ai_grade(db, assignment.id, regular_user.id, graded_submission) is None


async def test_media_is_transcribed_with_the_resolved_model(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    await _run(db, mock_request, admin_user, regular_user.id)
    assert ai.transcribe.await_args.args[1] == "gemini-test"


@pytest.mark.parametrize("mode,ungraded,detail", [
    (AIGradingModeEnum.OFF, False, "turned off"),
    (AIGradingModeEnum.SUGGEST, True, "ungraded"),
])
async def test_refused_when_off_or_formative(
    db, mock_request, admin_user, regular_user, assignment, user_submission, ai, mode, ungraded, detail
):
    await _set_mode(db, assignment, mode, ungraded)
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.status_code == 400 and detail in exc.value.detail
    ai.reserve.assert_not_called()


async def test_nothing_handed_in(db, mock_request, admin_user, regular_user, assignment, user_submission, ai):
    user_submission.submission_status = AssignmentUserSubmissionStatus.PENDING
    db.add(user_submission)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.status_code == 400


async def test_missing_assignment_submission_or_parents(db, mock_request, admin_user, regular_user, assignment, ai):
    with pytest.raises(HTTPException) as exc:
        await svc.run_ai_grading(mock_request, "assignment_nope", 1, admin_user, db)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.detail == "Assignment User Submission not found"
    assignment.activity_id = 99999
    db.add(assignment)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.detail == "Course not found"


async def test_api_tokens_and_anonymous_are_refused(db, mock_request, assignment, ai):
    token = APITokenUser(id=1, user_uuid="t", username="tok", org_id=1, rights={}, token_name="t", created_by_user_id=1)
    with pytest.raises(HTTPException) as exc:
        await svc.run_ai_grading(mock_request, "assignment_test", 1, token, db)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await svc.run_ai_grading(mock_request, "assignment_test", 1, AnonymousUser(), db)
    assert exc.value.status_code == 401


async def test_non_graders_are_refused(db, mock_request, regular_user, assignment, user_submission, ai):
    ai.auth.side_effect = HTTPException(status_code=403, detail="no")
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, regular_user, regular_user.id)
    assert exc.value.status_code == 403
    ai.grade.assert_not_called()


# ── credits and failures ─────────────────────────────────────────────────────


async def test_out_of_credits_is_refused_before_the_model(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    ai.reserve.side_effect = HTTPException(status_code=403, detail="AI credit limit reached.")
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.status_code == 403
    ai.grade.assert_not_called()
    row = await _row(db, assignment, regular_user.id)
    assert row.status == "FAILED" and row.error == "AI credit limit reached." and row.credits_charged == 0


async def test_model_failure_refunds(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    ai.grade.side_effect = RuntimeError("provider down")
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.status_code == 502
    ai.refund.assert_called_once_with(assignment.org_id, 2)
    row = await _row(db, assignment, regular_user.id)
    assert row.status == "FAILED" and row.model == "gemini-test"


async def test_skipped_task_counts_as_failure(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    ai.grade.return_value = _output(task_id="someone_else")
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.status_code == 502
    ai.refund.assert_called_once()


async def test_ai_not_configured_refunds_and_403(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    ai.grade.side_effect = AINotConfiguredError("no key")
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.status_code == 403 and exc.value.detail == "no key"
    ai.refund.assert_called_once()
    assert (await _row(db, assignment, regular_user.id)).error == "no key"


async def test_failed_retry_keeps_the_existing_draft(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    await _run(db, mock_request, admin_user, regular_user.id)
    ai.grade.side_effect = RuntimeError("down")
    with pytest.raises(HTTPException):
        await _run(db, mock_request, admin_user, regular_user.id)
    assert (await _row(db, assignment, regular_user.id)).status == "DRAFT"


async def test_saving_the_result_fails_refunds(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai, monkeypatch
):
    org_id = assignment.org_id  # the rollback below expires loaded rows
    monkeypatch.setattr(svc, "_save_row", AsyncMock(side_effect=RuntimeError("db")))
    with pytest.raises(HTTPException) as exc:
        await _run(db, mock_request, admin_user, regular_user.id)
    assert exc.value.status_code == 502
    ai.refund.assert_called_once_with(org_id, 2)


async def test_small_helpers(db, regular_user, assignment, user_submission):
    assert await svc._task_submissions(db, [], regular_user.id) == {}
    assert await svc.applied_ai_grade(db, assignment.id, regular_user.id, user_submission) is None  # not graded


async def test_native_pdf_follows_provider():
    cfg = MagicMock()
    with patch("config.config.get_learnhouse_config", return_value=cfg):
        cfg.ai_config.provider = "openai"
        assert svc._native_pdf() is False
        cfg.ai_config.provider = None
        assert svc._native_pdf() is True


# ── accept / edit / discard ──────────────────────────────────────────────────


async def _quiz_task(db, assignment, org, course, chapter, activity):
    task = AssignmentTask(
        id=21, title="Quiz", description="Pick", hint="", assignment_type=AssignmentTaskTypeEnum.QUIZ,
        contents={"questions": [{"questionUUID": "q", "options": [
            {"optionUUID": "a", "assigned_right_answer": True}, {"optionUUID": "b", "assigned_right_answer": False}]}]},
        max_grade_value=100, assignment_id=assignment.id, org_id=org.id, course_id=course.id, chapter_id=chapter.id,
        activity_id=activity.id, assignment_task_uuid="assignmenttask_quiz", order=1,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    return task


async def test_accept_with_edits(
    db, mock_request, admin_user, regular_user, org, course, chapter, activity, assignment, assignment_task,
    user_submission, task_submission, ai
):
    quiz = await _quiz_task(db, assignment, org, course, chapter, activity)
    db.add(AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_quiz", task_submission={"submissions": [{"questionUUID": "q", "optionUUID": "a", "answer": True}]},
        grade=100, task_submission_grade_feedback="", assignment_type=AssignmentTaskTypeEnum.QUIZ, user_id=regular_user.id,
        activity_id=activity.id, course_id=course.id, chapter_id=chapter.id, assignment_task_id=quiz.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    ai.grade.return_value = _output(extra=[AITaskGrade(task_id="assignmenttask_quiz", score=0, feedback="Right pick")])
    await _run(db, mock_request, admin_user, regular_user.id)

    body = AssignmentAIGradeAccept(
        overall_feedback="Edited overall",
        tasks=[
            AssignmentAIGradeTaskOverride(assignment_task_uuid="assignmenttask_test", score=250, feedback="Edited"),
            AssignmentAIGradeTaskOverride(assignment_task_uuid="assignmenttask_quiz", score=10),  # checker: score ignored
            AssignmentAIGradeTaskOverride(assignment_task_uuid="assignmenttask_gone", score=1),
        ],
    )
    result = await svc.accept_ai_grade(mock_request, "assignment_test", regular_user.id, body, admin_user, db)
    assert result["ai_grade"]["status"] == "APPLIED" and result["ai_grade"]["applied_by"] == admin_user.id
    assert result["grade"] == 200 and result["max_grade"] == 200
    await db.refresh(task_submission)
    assert task_submission.grade == 100 and task_submission.task_submission_grade_feedback == "Edited"
    await db.refresh(user_submission)
    assert user_submission.overall_feedback == "Edited overall"
    with pytest.raises(HTTPException) as exc:  # nothing left to accept
        await svc.accept_ai_grade(mock_request, "assignment_test", regular_user.id, None, admin_user, db)
    assert exc.value.status_code == 404


async def test_accept_as_is_and_missing_task_rows(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    await _run(db, mock_request, admin_user, regular_user.id)
    row = await _row(db, assignment, regular_user.id)
    row.tasks = [*row.tasks, {"assignment_task_uuid": "assignmenttask_deleted", "score": 5, "scored_by": "ai", "feedback": ""}]
    db.add(row)
    await db.commit()
    result = await svc.accept_ai_grade(mock_request, "assignment_test", regular_user.id, None, admin_user, db)
    assert result["grade"] == 80


async def test_accept_refusals(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    await _run(db, mock_request, admin_user, regular_user.id)
    user_submission.submission_status = AssignmentUserSubmissionStatus.PENDING
    db.add(user_submission)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await svc.accept_ai_grade(mock_request, "assignment_test", regular_user.id, None, admin_user, db)
    assert exc.value.status_code == 400
    await _set_mode(db, assignment, AIGradingModeEnum.SUGGEST, ungraded=True)
    with pytest.raises(HTTPException) as exc:
        await svc.accept_ai_grade(mock_request, "assignment_test", regular_user.id, None, admin_user, db)
    assert exc.value.status_code == 400 and "ungraded" in exc.value.detail


async def test_accept_survives_a_certificate_error(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    await _run(db, mock_request, admin_user, regular_user.id)
    with patch("src.services.courses.certifications.check_course_completion_and_create_certificate", new=AsyncMock(side_effect=RuntimeError)):
        result = await svc.accept_ai_grade(mock_request, "assignment_test", regular_user.id, None, admin_user, db)
    assert result["ai_grade"]["status"] == "APPLIED"


async def test_accept_below_threshold_revokes_certificate(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    await _run(db, mock_request, admin_user, regular_user.id)
    revoke = AsyncMock()
    with patch("src.services.courses.certifications.are_course_assignments_passed", new=AsyncMock(return_value=False)), \
         patch("src.services.courses.certifications.revoke_user_certificate", new=revoke):
        await svc.accept_ai_grade(mock_request, "assignment_test", regular_user.id, None, admin_user, db)
    revoke.assert_awaited_once()


async def test_discard(db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai):
    with pytest.raises(HTTPException):
        await svc.discard_ai_grade(mock_request, "assignment_test", regular_user.id, admin_user, db)
    await _run(db, mock_request, admin_user, regular_user.id)
    assert await svc.discard_ai_grade(mock_request, "assignment_test", regular_user.id, admin_user, db) == {"detail": "discarded"}
    assert (await _row(db, assignment, regular_user.id)).status == "DISCARDED"
    with pytest.raises(HTTPException):  # nothing left to discard
        await svc.discard_ai_grade(mock_request, "assignment_test", regular_user.id, admin_user, db)


async def test_get_hides_rows_from_older_attempts(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    assert await svc.get_ai_grade(mock_request, "assignment_test", regular_user.id, admin_user, db) is None
    await _run(db, mock_request, admin_user, regular_user.id)
    user_submission.attempt_number = 2
    db.add(user_submission)
    await db.commit()
    assert await svc.get_ai_grade(mock_request, "assignment_test", regular_user.id, admin_user, db) is None


# ── estimate + bulk ──────────────────────────────────────────────────────────


async def test_estimate(db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai):
    one = await svc.estimate_ai_grading(mock_request, "assignment_test", admin_user, db, user_id=regular_user.id)
    assert one["submissions"] == 1 and one["credits"] == 2 and one["remaining_credits"] == 50 and one["mode"] == "SUGGEST"
    bulk = await svc.estimate_ai_grading(mock_request, "assignment_test", admin_user, db)
    assert bulk["submissions"] == 1 and not bulk["estimated"]
    ai.grade.assert_not_called()
    ai.reserve.assert_not_called()


async def test_estimate_extrapolates_and_tolerates_odd_summary(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai, monkeypatch
):
    other = AssignmentUserSubmission(
        user_id=admin_user.id, assignment_id=assignment.id, grade=0, submission_status=AssignmentUserSubmissionStatus.LATE,
        attempt_number=1, assignmentusersubmission_uuid="aus_other", creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(other)
    await db.commit()
    monkeypatch.setattr(svc, "MAX_ESTIMATE_SUBMISSIONS", 1)
    monkeypatch.setattr(svc, "get_ai_credits_summary", AsyncMock(return_value="nope"))
    out = await svc.estimate_ai_grading(mock_request, "assignment_test", admin_user, db)
    assert out["submissions"] == 2 and out["estimated"] and out["credits"] == 4 and out["remaining_credits"] is None


async def test_bulk_suggest_then_nothing_left(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    out = await svc.bulk_ai_grade(mock_request, "assignment_test", admin_user, db)
    assert out["drafted"] == 1 and out["credits_used"] == 2 and out["remaining"] == 0 and out["stopped"] is None
    again = await svc.bulk_ai_grade(mock_request, "assignment_test", admin_user, db, limit=99)
    assert again["results"] == [] and again["remaining"] == 0


async def test_bulk_auto_applies(db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai):
    await _set_mode(db, assignment, AIGradingModeEnum.AUTO)
    out = await svc.bulk_ai_grade(mock_request, "assignment_test", admin_user, db)
    assert out["graded"] == 1


async def test_bulk_stops_when_credits_run_out(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    ai.reserve.side_effect = HTTPException(status_code=403, detail="AI credit limit reached.")
    out = await svc.bulk_ai_grade(mock_request, "assignment_test", admin_user, db)
    assert out["stopped"] == "no_credits" and out["stop_detail"] == "AI credit limit reached." and out["remaining"] == 1


async def test_bulk_pauses_on_rate_limit(db, mock_request, admin_user, regular_user, assignment, user_submission, ai):
    ai.rate.side_effect = HTTPException(status_code=429, detail={"code": "RATE_LIMITED"})
    out = await svc.bulk_ai_grade(mock_request, "assignment_test", admin_user, db)
    assert out["stopped"] == "rate_limited" and out["results"] == []


async def test_bulk_records_failures_and_continues(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    ai.grade.side_effect = RuntimeError("down")
    out = await svc.bulk_ai_grade(mock_request, "assignment_test", admin_user, db)
    assert out["failed"] == 1 and out["results"][0]["error"] and out["stopped"] is None


async def test_bulk_requires_ai_grading_on(db, mock_request, admin_user, assignment, ai):
    await _set_mode(db, assignment, AIGradingModeEnum.OFF)
    with pytest.raises(HTTPException):
        await svc.bulk_ai_grade(mock_request, "assignment_test", admin_user, db)


# ── AUTO mode on hand-in ─────────────────────────────────────────────────────


async def test_auto_job_grades_and_skips(
    db, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    assert await svc.run_auto_ai_grading(assignment.id, regular_user.id, db) is None  # SUGGEST mode
    await _set_mode(db, assignment, AIGradingModeEnum.AUTO)
    row = await svc.run_auto_ai_grading(assignment.id, regular_user.id, db)
    assert row.status == "APPLIED" and row.triggered_by is None
    assert await svc.run_auto_ai_grading(assignment.id, regular_user.id, db) is None  # now GRADED


async def test_auto_job_never_raises(db, regular_user, assignment, assignment_task, user_submission, task_submission, ai, monkeypatch):
    await _set_mode(db, assignment, AIGradingModeEnum.AUTO)
    assert await svc.run_auto_ai_grading(assignment.id, 424242, db) is None  # no submission (404)
    monkeypatch.setattr(svc, "_grade_one", AsyncMock(side_effect=IntegrityError("x", {}, Exception())))
    assert await svc.run_auto_ai_grading(assignment.id, regular_user.id, db) is None
    monkeypatch.setattr(svc, "_grade_one", AsyncMock(side_effect=RuntimeError("boom")))
    assert await svc.run_auto_ai_grading(assignment.id, regular_user.id, db) is None


async def test_auto_job_opens_its_own_session(engine, db, regular_user, assignment, user_submission, ai):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    with patch("src.core.events.database._async_session_factory", factory):
        assert await svc.run_auto_ai_grading(assignment.id, regular_user.id) is None  # SUGGEST: nothing to do


async def test_schedule_runs_in_background(monkeypatch):
    job = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "run_auto_ai_grading", job)
    svc.schedule_auto_ai_grading(1, 2)
    assert len(svc._background_tasks) == 1
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    job.assert_awaited_once_with(1, 2)
    assert not svc._background_tasks


async def test_submit_schedules_auto_grading(
    db, mock_request, regular_user, assignment, assignment_task, task_submission, ai, monkeypatch
):
    from src.services.courses.activities import assignments as assignments_svc

    await _set_mode(db, assignment, AIGradingModeEnum.AUTO)
    scheduled = MagicMock()
    monkeypatch.setattr(svc, "schedule_auto_ai_grading", scheduled)
    monkeypatch.setattr(assignments_svc, "authorization_verify_based_on_roles", AsyncMock(return_value=False))
    monkeypatch.setattr(assignments_svc, "check_trail_presence", AsyncMock(return_value=MagicMock(id=1)))
    await assignments_svc.create_assignment_submission(mock_request, "assignment_test", regular_user, db)
    scheduled.assert_called_once_with(assignment.id, regular_user.id)


# ── wiring in the assignment service ─────────────────────────────────────────


async def test_rubric_hidden_from_learners(db, mock_request, regular_user, admin_user, assignment, ai, monkeypatch):
    from src.services.courses.activities import assignments as assignments_svc

    assignment.ai_grading_instructions = "secret rubric"
    assignment.ai_grading_task_instructions = {"assignmenttask_test": "secret"}
    db.add(assignment)
    await db.commit()
    monkeypatch.setattr(assignments_svc, "verify_activity_reader_access", AsyncMock())
    with patch(f"{_ASSIGN}._is_assignment_instructor", new=AsyncMock(return_value=False)):
        learner = await assignments_svc.read_assignment(mock_request, "assignment_test", regular_user, db)
        learner_by_activity = await assignments_svc.read_assignment_from_activity_uuid(mock_request, "activity_test", regular_user, db)
    assert learner.ai_grading_instructions is None and learner.ai_grading_task_instructions is None
    assert learner_by_activity.ai_grading_instructions is None
    with patch(f"{_ASSIGN}._is_assignment_instructor", new=AsyncMock(return_value=True)):
        teacher = await assignments_svc.read_assignment(mock_request, "assignment_test", admin_user, db)
    assert teacher.ai_grading_instructions == "secret rubric"


async def test_submissions_list_shows_ai_status_to_graders(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai
):
    from src.services.courses.activities.assignments import read_assignment_submissions

    await _run(db, mock_request, admin_user, regular_user.id)
    with patch(f"{_ASSIGN}._is_assignment_instructor", new=AsyncMock(return_value=True)):
        rows = await read_assignment_submissions(mock_request, "assignment_test", admin_user, db)
    assert rows[0]["ai_grade_status"] == "DRAFT"
    user_submission.attempt_number = 3
    db.add(user_submission)
    await db.commit()
    with patch(f"{_ASSIGN}._is_assignment_instructor", new=AsyncMock(return_value=True)):
        rows = await read_assignment_submissions(mock_request, "assignment_test", admin_user, db)
    assert rows[0]["ai_grade_status"] is None
    with patch(f"{_ASSIGN}._is_assignment_instructor", new=AsyncMock(return_value=False)):
        rows = await read_assignment_submissions(mock_request, "assignment_test", regular_user, db)
    assert "ai_grade_status" not in rows[0]


async def test_reject_drops_the_ai_row(
    db, mock_request, admin_user, regular_user, assignment, assignment_task, user_submission, task_submission, ai, monkeypatch
):
    from src.services.courses.activities import assignments as assignments_svc

    await _run(db, mock_request, admin_user, regular_user.id)
    monkeypatch.setattr(assignments_svc, "check_resource_access", AsyncMock())
    await assignments_svc.delete_assignment_submission(mock_request, regular_user.id, "assignment_test", admin_user, db)
    assert await _row(db, assignment, regular_user.id) is None


@pytest.fixture(autouse=True)
def _ai_credit_store(ai_credit_spy):
    """Fake credit store + usage ledger for metered AI charges (conftest)."""
    yield ai_credit_spy
