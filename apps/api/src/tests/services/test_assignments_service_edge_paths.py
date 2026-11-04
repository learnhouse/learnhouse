"""Edge paths of src/services/courses/activities/assignments.py.

test_assignments_service.py covers the happy paths. This module pins down the
remaining branches:

* the "parent row missing" 404s every service raises when a task points at a
  deleted assignment, or an assignment at a deleted course (SQLite in tests
  does not enforce foreign keys, so orphans can be seeded directly);
* the defensive guards (immutable parent ids on update, non-object quiz
  questions, Python ``re`` fallback when the ``regex`` module is missing);
* learner-facing gates on file uploads and task answers (enrollment, deadline,
  ownership) and the instructor/learner split on submission listings;
* best-effort side effects that must never fail the caller (certificate
  reconciliation, aggregate recompute after a deleted answer).
"""

from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskCreate,
    AssignmentTaskOrder,
    AssignmentTaskSubmission,
    AssignmentTaskSubmissionUpdate,
    AssignmentTaskTypeEnum,
    AssignmentTaskUpdate,
    AssignmentUpdate,
    AssignmentUserSubmission,
    AssignmentUserSubmissionCreate,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac import AccessAction
from src.services.courses.activities import assignments as svc

_SVC = "src.services.courses.activities.assignments"

NOW = str(datetime.now())
MISSING_ID = 9999


# ---------------------------------------------------------------------------
# Orphan fixtures
# ---------------------------------------------------------------------------


def _assignment(org, chapter, *, id, uuid, course_id, activity_id, **extra):
    return Assignment(
        id=id, title="A", description="d", due_date="2030-01-01", published=True,
        grading_type=GradingTypeEnum.NUMERIC, org_id=org.id, course_id=course_id,
        chapter_id=chapter.id, activity_id=activity_id, assignment_uuid=uuid,
        creation_date=NOW, update_date=NOW, **extra,
    )


def _task(org, chapter, *, id, uuid, assignment_id, course_id, activity_id, **extra):
    fields = dict(
        title="T", description="d", hint="", reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        contents={"correct_answers": ["4"]}, max_grade_value=100,
    )
    fields.update(extra)
    return AssignmentTask(
        id=id, assignment_id=assignment_id, org_id=org.id, course_id=course_id,
        chapter_id=chapter.id, activity_id=activity_id,
        assignment_task_uuid=uuid, creation_date=NOW, update_date=NOW, **fields,
    )


def _task_sub(*, id, uuid, task_id, user_id, course_id, chapter_id, activity_id):
    return AssignmentTaskSubmission(
        id=id, assignment_task_submission_uuid=uuid,
        task_submission={"answer": "4"}, grade=0,
        task_submission_grade_feedback="",
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        user_id=user_id, activity_id=activity_id, course_id=course_id,
        chapter_id=chapter_id, assignment_task_id=task_id,
        creation_date=NOW, update_date=NOW,
    )


def _user_sub(*, id, uuid, assignment_id, user_id, status=AssignmentUserSubmissionStatus.SUBMITTED):
    return AssignmentUserSubmission(
        id=id, user_id=user_id, assignment_id=assignment_id, grade=0,
        submission_status=status, attempt_number=1,
        assignmentusersubmission_uuid=uuid, creation_date=NOW, update_date=NOW,
    )


@pytest.fixture
async def orphans(db, org, course, chapter, activity, regular_user):
    """Rows whose parent is missing, one per level of the hierarchy.

    * ``assignment_orphan``: assignment whose course does not exist
    * ``task_no_assignment``: task whose assignment does not exist
    * ``task_no_course``: task under ``assignment_orphan``
    * ``ats_no_task`` / ``ats_no_assignment`` / ``ats_no_course``: answers
      under each of the above
    * ``activity_orphan``: activity whose course does not exist
    """
    rows = [
        _assignment(org, chapter, id=110, uuid="assignment_orphan",
                    course_id=MISSING_ID, activity_id=activity.id),
        _task(org, chapter, id=120, uuid="task_no_assignment",
              assignment_id=MISSING_ID, course_id=course.id, activity_id=activity.id),
        _task(org, chapter, id=121, uuid="task_no_course",
              assignment_id=110, course_id=MISSING_ID, activity_id=activity.id),
        _task_sub(id=140, uuid="ats_no_task", task_id=MISSING_ID,
                  user_id=regular_user.id, course_id=course.id,
                  chapter_id=chapter.id, activity_id=activity.id),
        _task_sub(id=141, uuid="ats_no_assignment", task_id=120,
                  user_id=regular_user.id, course_id=course.id,
                  chapter_id=chapter.id, activity_id=activity.id),
        _task_sub(id=142, uuid="ats_no_course", task_id=121,
                  user_id=regular_user.id, course_id=MISSING_ID,
                  chapter_id=chapter.id, activity_id=activity.id),
        _user_sub(id=130, uuid="aus_orphan", assignment_id=110,
                  user_id=regular_user.id),
        Activity(
            id=150, name="Orphan", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={}, published=True, org_id=org.id, course_id=MISSING_ID,
            activity_uuid="activity_orphan", creation_date=NOW, update_date=NOW,
        ),
    ]
    for r in rows:
        db.add(r)
    await db.commit()


@pytest.fixture
async def no_activity_task(db, org, course, chapter):
    """An assignment (and task) in a real course whose activity row is gone."""
    a = _assignment(org, chapter, id=160, uuid="assignment_no_activity",
                    course_id=course.id, activity_id=MISSING_ID)
    db.add(a)
    await db.commit()
    t = _task(org, chapter, id=161, uuid="task_no_activity", assignment_id=160,
              course_id=course.id, activity_id=MISSING_ID)
    db.add(t)
    await db.commit()
    await db.refresh(a)
    await db.refresh(t)
    return a, t


async def _expect_404(coro, detail):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == 404
    assert exc.value.detail == detail


# ---------------------------------------------------------------------------
# Missing-parent 404s
# ---------------------------------------------------------------------------


class TestAssignmentWithoutCourse:
    """Every assignment-keyed service 404s when the parent course is gone."""

    @pytest.mark.parametrize(
        "call",
        [
            lambda r, u, db: svc.update_assignment(r, "assignment_orphan", AssignmentUpdate(title="x"), u, db),
            lambda r, u, db: svc.delete_assignment(r, "assignment_orphan", u, db),
            lambda r, u, db: svc.create_assignment_task(
                r, "assignment_orphan",
                AssignmentTaskCreate(title="t", description="d", hint="",
                                     assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER),
                u, db),
            lambda r, u, db: svc.read_assignment_tasks(r, "assignment_orphan", u, db),
            lambda r, u, db: svc.reorder_assignment_tasks(
                r, "assignment_orphan", AssignmentTaskOrder(task_uuids=[]), u, db),
            lambda r, u, db: svc.create_assignment_submission(r, "assignment_orphan", u, db),
            lambda r, u, db: svc.read_assignment_submissions(r, "assignment_orphan", u, db),
            lambda r, u, db: svc.read_user_assignment_submissions(r, "assignment_orphan", u.id, u, db),
            lambda r, u, db: svc.update_assignment_submission(
                r, u.id, "assignment_orphan",
                AssignmentUserSubmissionCreate(assignment_id=110), u, db),
            lambda r, u, db: svc.delete_assignment_submission(r, u.id, "assignment_orphan", u, db),
            lambda r, u, db: svc.grade_assignment_submission(r, u.id, "assignment_orphan", u, db),
            lambda r, u, db: svc.get_grade_assignment_submission(r, u.id, "assignment_orphan", u, db),
            lambda r, u, db: svc.mark_activity_as_done_for_user(r, u.id, "assignment_orphan", u, db),
            lambda r, u, db: svc.delete_assignment_from_activity_uuid(r, "activity_orphan", u, db),
        ],
        ids=[
            "update_assignment", "delete_assignment", "create_task", "read_tasks",
            "reorder_tasks", "create_submission", "read_submissions",
            "read_user_submissions", "update_submission", "delete_submission",
            "grade_submission", "get_grade", "mark_done", "delete_from_activity",
        ],
    )
    async def test_course_not_found(self, call, mock_request, db, regular_user, orphans):
        await _expect_404(call(mock_request, regular_user, db), "Course not found")


_TASK_CALLS = [
    lambda r, u, db, t: svc.read_assignment_task(r, t, u, db),
    lambda r, u, db, t: svc.put_assignment_task_reference_file(r, db, t, u),
    lambda r, u, db, t: svc.put_assignment_task_submission_file(r, db, t, u),
    lambda r, u, db, t: svc.update_assignment_task(r, t, AssignmentTaskUpdate(), u, db),
    lambda r, u, db, t: svc.delete_assignment_task(r, t, u, db),
    lambda r, u, db, t: svc.handle_assignment_task_submission(
        r, t, AssignmentTaskSubmissionUpdate(), u, db),
    lambda r, u, db, t: svc.read_user_assignment_task_submissions(r, t, u.id, u, db),
    # The learner already has an answer on both orphan tasks, so this read
    # gets past its "no submission yet" early return.
    lambda r, u, db, t: svc.read_user_assignment_task_submissions_me(r, t, u, db),
    lambda r, u, db, t: svc.read_assignment_task_submissions(r, t, u, db),
]
_TASK_IDS = [
    "read_task", "ref_file", "sub_file", "update_task", "delete_task",
    "upsert_answer", "read_user_answers", "read_my_answer", "list_task_answers",
]


class TestTaskWithoutParents:
    @pytest.mark.parametrize("call", _TASK_CALLS, ids=_TASK_IDS)
    async def test_assignment_not_found(self, call, mock_request, db, regular_user, orphans):
        await _expect_404(
            call(mock_request, regular_user, db, "task_no_assignment"),
            "Assignment not found",
        )

    @pytest.mark.parametrize("call", _TASK_CALLS, ids=_TASK_IDS)
    async def test_course_not_found(self, call, mock_request, db, regular_user, orphans):
        await _expect_404(
            call(mock_request, regular_user, db, "task_no_course"),
            "Course not found",
        )


class TestTaskSubmissionWithoutParents:
    @pytest.mark.parametrize(
        "uuid,detail",
        [
            ("ats_no_task", "Assignment Task not found"),
            ("ats_no_assignment", "Assignment not found"),
            ("ats_no_course", "Course not found"),
        ],
    )
    @pytest.mark.parametrize(
        "call",
        [
            lambda r, u, db, s: svc.update_assignment_task_submission(r, s, SimpleNamespace(), u, db),
            lambda r, u, db, s: svc.delete_assignment_task_submission(r, s, u, db),
        ],
        ids=["update", "delete"],
    )
    async def test_missing_parent(self, call, uuid, detail, mock_request, db, regular_user, orphans):
        await _expect_404(call(mock_request, regular_user, db, uuid), detail)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestStripAnswerKeyMalformedQuestions:
    def test_non_object_questions_are_left_alone(self):
        """A stray string in ``questions`` is skipped, real questions still stripped."""
        contents = {
            "questions": [
                "not a question",
                {"options": [{"text": "a", "assigned_right_answer": True}],
                 "blanks": [{"correctAnswer": "x"}]},
            ]
        }
        out = svc._strip_answer_key(contents)
        assert out["questions"][0] == "not a question"
        assert "assigned_right_answer" not in out["questions"][1]["options"][0]
        assert "correctAnswer" not in out["questions"][1]["blanks"][0]
        # The stored contents are not mutated.
        assert contents["questions"][1]["options"][0]["assigned_right_answer"] is True


class TestShortAnswerRegexWithoutRegexModule:
    """When the optional ``regex`` package is absent, stdlib ``re`` grades regex answers."""

    def test_match(self):
        with patch(f"{_SVC}._regex", None):
            assert svc._check_short_answer("Hello World", ["hello\\s+world"], "regex") is True

    def test_fullmatch_only(self):
        with patch(f"{_SVC}._regex", None):
            assert svc._check_short_answer("hello world!", ["hello world"], "regex") is False

    def test_invalid_pattern_is_no_match(self):
        with patch(f"{_SVC}._regex", None):
            assert svc._check_short_answer("abc", ["(unclosed"], "regex") is False


class TestNumberAnswerMixedSeparators:
    def test_comma_and_dot_not_in_thousands_groups(self):
        """'12,34.5' is not valid thousands grouping; commas are dropped -> 1234.5."""
        assert svc._check_number_answer("12,34.5", 1234.5, 0) is True
        assert svc._check_number_answer("12,34.5", 12.345, 0) is False


class TestCodeGradingCustomWeights:
    async def test_zero_total_weight_scores_zero(self):
        """Weights that sum to zero cannot be divided by; the task scores 0."""
        task = SimpleNamespace(
            assignment_task_uuid="t", max_grade_value=10,
            contents={
                "language_id": 71,
                "grading_mode": "custom_weights",
                "test_cases": [
                    {"stdin": "", "expectedStdout": "ok", "weight": -1},
                    {"stdin": "", "expectedStdout": "ok", "weight": 1},
                ],
            },
        )
        submission = SimpleNamespace(task_submission={"source_code": "print('ok')"})
        judge = AsyncMock(return_value={"status": {"id": 3}, "stdout": "ok"})
        with patch("src.routers.code_execution._get_judge0_config", return_value={}), \
             patch("src.routers.code_execution._submit_single", judge):
            assert await svc._grade_code_task_async(task, submission) == 0
        assert judge.await_count == 2


class TestServerVerifiedGradeUnknownType:
    async def test_verified_type_without_grader_returns_none(self):
        """A type listed as server-verified but with no grader falls back to the stored grade."""
        task = SimpleNamespace(
            assignment_type=AssignmentTaskTypeEnum.OTHER, contents={}, max_grade_value=10,
        )
        sub = SimpleNamespace(task_submission={})
        with patch(
            f"{_SVC}.SERVER_VERIFIED_TASK_TYPES",
            frozenset({AssignmentTaskTypeEnum.OTHER}),
        ):
            assert await svc._server_verified_task_grade(task, sub) is None


# ---------------------------------------------------------------------------
# update_assignment
# ---------------------------------------------------------------------------


class TestUpdateAssignmentImmutableParents:
    async def test_parent_ids_in_payload_are_ignored(
        self, mock_request, db, admin_user, course, assignment
    ):
        """Even if a payload carries course_id, the assignment is never reparented."""
        payload = SimpleNamespace(title="Renamed", course_id=MISSING_ID, published=None)
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}.index_activity"), \
             patch(f"{_SVC}.notify_ee_course_content_changed"):
            result = await svc.update_assignment(
                mock_request, assignment.assignment_uuid, payload, admin_user, db
            )
        assert result.title == "Renamed"
        assert result.course_id == course.id
        row = (await db.execute(
            select(Assignment).where(Assignment.id == assignment.id)
        )).scalars().first()
        assert row.course_id == course.id


# ---------------------------------------------------------------------------
# read_assignment_task (learner view)
# ---------------------------------------------------------------------------


class TestReadAssignmentTaskForLearner:
    async def test_answer_key_stripped_before_grading(
        self, mock_request, db, regular_user, assignment_task
    ):
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}._is_assignment_instructor", AsyncMock(return_value=False)):
            read = await svc.read_assignment_task(
                mock_request, assignment_task.assignment_task_uuid, regular_user, db
            )
        assert "correct_answers" not in read.contents
        assert read.contents["prompt"] == "What is 2+2?"

    async def test_answer_key_revealed_after_grading_when_allowed(
        self, mock_request, db, regular_user, assignment, assignment_task, graded_submission
    ):
        assignment.show_correct_answers = True
        db.add(assignment)
        await db.commit()
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}._is_assignment_instructor", AsyncMock(return_value=False)):
            read = await svc.read_assignment_task(
                mock_request, assignment_task.assignment_task_uuid, regular_user, db
            )
        assert read.contents["correct_answers"] == ["4"]


# ---------------------------------------------------------------------------
# File uploads
# ---------------------------------------------------------------------------


def _upload(name="file.pdf"):
    return UploadFile(filename=name, file=BytesIO(b"%PDF-1.4"))


class TestPutReferenceFile:
    async def test_uploads_and_stores_filename(
        self, mock_request, db, admin_user, org, course, activity, assignment, assignment_task
    ):
        upload = AsyncMock(return_value="ref_stored.pdf")
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}.upload_reference_file", upload), \
             patch(f"{_SVC}.index_activity"):
            read = await svc.put_assignment_task_reference_file(
                mock_request, db, assignment_task.assignment_task_uuid, admin_user,
                _upload("ref.pdf"),
            )
        assert read.reference_file == "ref_stored.pdf"
        args = upload.await_args.args
        assert args[1:] == (
            activity.activity_uuid, org.org_uuid, course.course_uuid,
            assignment.assignment_uuid, assignment_task.assignment_task_uuid,
        )


class TestPutSubmissionFile:
    async def test_without_activity_falls_back_to_course_read_check(
        self, mock_request, db, regular_user, course, no_activity_task
    ):
        """With the activity row gone, course READ is checked and nothing is stored."""
        _, task = no_activity_task
        rbac = AsyncMock()
        upload = AsyncMock()
        with patch(f"{_SVC}.check_resource_access", rbac), \
             patch(f"{_SVC}.authorization_verify_based_on_roles",
                   AsyncMock(side_effect=[True, False])), \
             patch(f"{_SVC}.upload_submission_file", upload):
            result = await svc.put_assignment_task_submission_file(
                mock_request, db, task.assignment_task_uuid, regular_user, _upload()
            )
        assert result is None
        upload.assert_not_awaited()
        assert rbac.await_args.args[3] == course.course_uuid
        assert rbac.await_args.args[4] == AccessAction.READ

    async def test_not_enrolled_is_403(self, mock_request, db, regular_user, assignment_task):
        with patch(f"{_SVC}.verify_activity_reader_access", new_callable=AsyncMock), \
             patch(f"{_SVC}.authorization_verify_based_on_roles",
                   AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc:
                await svc.put_assignment_task_submission_file(
                    mock_request, db, assignment_task.assignment_task_uuid,
                    regular_user, _upload(),
                )
        assert exc.value.status_code == 403
        assert "enrolled" in exc.value.detail

    async def test_past_due_is_403_for_learner(
        self, mock_request, db, regular_user, assignment, assignment_task
    ):
        assignment.due_date = "2000-01-01"
        db.add(assignment)
        await db.commit()
        upload = AsyncMock()
        with patch(f"{_SVC}.verify_activity_reader_access", new_callable=AsyncMock), \
             patch(f"{_SVC}.authorization_verify_based_on_roles",
                   AsyncMock(side_effect=[True, False])), \
             patch(f"{_SVC}.upload_submission_file", upload):
            with pytest.raises(HTTPException) as exc:
                await svc.put_assignment_task_submission_file(
                    mock_request, db, assignment_task.assignment_task_uuid,
                    regular_user, _upload(),
                )
        assert exc.value.status_code == 403
        assert exc.value.detail == "Assignment deadline has passed"
        upload.assert_not_awaited()

    async def test_learner_upload_returns_stored_name(
        self, mock_request, db, regular_user, org, course, activity, assignment, assignment_task
    ):
        upload = AsyncMock(return_value="sub_stored.pdf")
        with patch(f"{_SVC}.verify_activity_reader_access", new_callable=AsyncMock), \
             patch(f"{_SVC}.authorization_verify_based_on_roles",
                   AsyncMock(side_effect=[True, False])), \
             patch(f"{_SVC}.upload_submission_file", upload):
            result = await svc.put_assignment_task_submission_file(
                mock_request, db, assignment_task.assignment_task_uuid,
                regular_user, _upload("answer.pdf"),
            )
        assert result == {"file_uuid": "sub_stored.pdf"}
        assert upload.await_args.args[1:] == (
            activity.activity_uuid, org.org_uuid, course.course_uuid,
            assignment.assignment_uuid, assignment_task.assignment_task_uuid,
        )


# ---------------------------------------------------------------------------
# Regrade / certificate reconciliation helpers
# ---------------------------------------------------------------------------


class TestReconcileCertificateWithoutCourseId:
    async def test_noop_for_unsaved_course(self, db):
        passed = AsyncMock()
        with patch(f"{_SVC}.are_course_assignments_passed", passed):
            await svc._reconcile_certificate_after_grade_change(
                None, 1, Course(name="c", org_id=1, course_uuid="c"), db
            )
        passed.assert_not_awaited()


class TestRegradeSkipsUserlessSubmissions:
    async def test_submission_without_user_is_skipped(self):
        """A graded row whose learner was deleted (user_id NULL) is not regraded."""
        result = MagicMock()
        result.scalars.return_value.all.return_value = [SimpleNamespace(user_id=None)]
        session = MagicMock()
        session.execute = AsyncMock(return_value=result)
        finalize = AsyncMock()
        reconcile = AsyncMock()
        with patch(f"{_SVC}._apply_grade_and_finalize", finalize), \
             patch(f"{_SVC}._reconcile_certificate_after_grade_change", reconcile):
            await svc._regrade_graded_submissions(
                assignment=SimpleNamespace(id=1, assignment_uuid="a"),
                course=SimpleNamespace(id=1),
                db_session=session,
            )
        finalize.assert_not_awaited()
        reconcile.assert_not_awaited()


# ---------------------------------------------------------------------------
# handle_assignment_task_submission (learner gates)
# ---------------------------------------------------------------------------


class TestTaskAnswerLearnerGates:
    async def test_not_enrolled_is_403(self, mock_request, db, regular_user, assignment_task):
        # First role check: instructor? no. Second: enrolled? no.
        with patch(f"{_SVC}.authorization_verify_based_on_roles",
                   AsyncMock(side_effect=[False, False])):
            with pytest.raises(HTTPException) as exc:
                await svc.handle_assignment_task_submission(
                    mock_request, assignment_task.assignment_task_uuid,
                    AssignmentTaskSubmissionUpdate(task_submission={"answer": "4"}),
                    regular_user, db,
                )
        assert exc.value.status_code == 403
        assert "enrolled" in exc.value.detail

    async def test_without_activity_checks_course_read(
        self, mock_request, db, regular_user, course, no_activity_task
    ):
        """With the activity row gone, the course READ check gates the answer instead."""
        _, task = no_activity_task
        rbac = AsyncMock()
        with patch(f"{_SVC}.authorization_verify_based_on_roles",
                   AsyncMock(side_effect=[False, True])), \
             patch(f"{_SVC}.check_resource_access", rbac):
            read = await svc.handle_assignment_task_submission(
                mock_request, task.assignment_task_uuid,
                AssignmentTaskSubmissionUpdate(task_submission={"answer": "4"}),
                regular_user, db,
            )
        assert rbac.await_args.args[3] == course.course_uuid
        assert rbac.await_args.args[4] == AccessAction.READ
        assert read.user_id == regular_user.id
        assert read.task_submission == {"answer": "4"}
        assert read.grade == 0

    async def test_cannot_overwrite_another_learners_answer(
        self, mock_request, db, regular_user, admin_user, assignment_task
    ):
        """Naming someone else's submission uuid is refused for a learner."""
        db.add(_task_sub(
            id=170, uuid="ats_admin_owned", task_id=assignment_task.id,
            user_id=admin_user.id, course_id=assignment_task.course_id,
            chapter_id=assignment_task.chapter_id,
            activity_id=assignment_task.activity_id,
        ))
        await db.commit()
        with patch(f"{_SVC}.authorization_verify_based_on_roles",
                   AsyncMock(side_effect=[False, True])), \
             patch(f"{_SVC}.verify_activity_reader_access", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await svc.handle_assignment_task_submission(
                    mock_request, assignment_task.assignment_task_uuid,
                    AssignmentTaskSubmissionUpdate(
                        assignment_task_submission_uuid="ats_admin_owned",
                        task_submission={"answer": "hijack"},
                    ),
                    regular_user, db,
                )
        assert exc.value.status_code == 403
        row = (await db.execute(
            select(AssignmentTaskSubmission).where(AssignmentTaskSubmission.id == 170)
        )).scalars().first()
        assert row.task_submission == {"answer": "4"}


# ---------------------------------------------------------------------------
# delete_assignment_task_submission
# ---------------------------------------------------------------------------


class TestDeleteTaskAnswerRecomputeFailure:
    async def test_recompute_error_does_not_fail_the_delete(
        self, mock_request, db, admin_user, task_submission, graded_submission
    ):
        """If re-aggregating the learner's grade blows up, the delete still succeeds."""
        finalize = AsyncMock(side_effect=RuntimeError("grading crashed"))
        reconcile = AsyncMock()
        with patch(f"{_SVC}.check_resource_access", new_callable=AsyncMock), \
             patch(f"{_SVC}._apply_grade_and_finalize", finalize), \
             patch(f"{_SVC}._reconcile_certificate_after_grade_change", reconcile):
            result = await svc.delete_assignment_task_submission(
                mock_request, task_submission.assignment_task_submission_uuid,
                admin_user, db,
            )
        assert result == {"message": "Assignment Task Submission deleted"}
        finalize.assert_awaited_once()
        reconcile.assert_not_awaited()
        gone = (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.id == task_submission.id
            )
        )).scalars().first()
        assert gone is None


# ---------------------------------------------------------------------------
# create_assignment_submission
# ---------------------------------------------------------------------------


def _submission_side_effects():
    return (
        patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock),
        patch(f"{_SVC}.authorization_verify_based_on_roles", AsyncMock(return_value=False)),
        patch(f"{_SVC}.track", new_callable=AsyncMock),
        patch(f"{_SVC}.record_audit_event", new_callable=AsyncMock),
        patch(f"{_SVC}.dispatch_webhooks", new_callable=AsyncMock),
    )


class TestCreateAssignmentSubmissionEdges:
    async def test_unknown_assignment_is_404(self, mock_request, db, regular_user):
        await _expect_404(
            svc.create_assignment_submission(
                mock_request, "assignment_does_not_exist", regular_user, db
            ),
            "Assignment not found",
        )

    async def test_anonymous_is_401(self, mock_request, db, assignment):
        with pytest.raises(HTTPException) as exc:
            await svc.create_assignment_submission(
                mock_request, assignment.assignment_uuid, AnonymousUser(), db
            )
        assert exc.value.status_code == 401

    async def test_unknown_user_is_404(self, mock_request, db, assignment):
        ghost = PublicUser(
            id=8888, username="ghost", first_name="G", last_name="H",
            email="ghost@test.com", user_uuid="user_ghost",
        )
        p1, p2, p3, p4, p5 = _submission_side_effects()
        with p1, p2, p3, p4, p5:
            await _expect_404(
                svc.create_assignment_submission(
                    mock_request, assignment.assignment_uuid, ghost, db
                ),
                "User not found",
            )

    async def test_missing_activity_is_404(self, mock_request, db, regular_user, no_activity_task):
        a, _ = no_activity_task
        p1, p2, p3, p4, p5 = _submission_side_effects()
        with p1, p2, p3, p4, p5:
            await _expect_404(
                svc.create_assignment_submission(
                    mock_request, a.assignment_uuid, regular_user, db
                ),
                "Activity not found",
            )


# ---------------------------------------------------------------------------
# read_assignment_submissions
# ---------------------------------------------------------------------------


class TestReadAssignmentSubmissions:
    async def test_learner_sees_only_own_submission(
        self, mock_request, db, regular_user, admin_user, assignment, user_submission
    ):
        db.add(_user_sub(id=171, uuid="aus_admin", assignment_id=assignment.id,
                         user_id=admin_user.id))
        await db.commit()
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}._is_assignment_instructor", AsyncMock(return_value=False)):
            rows = await svc.read_assignment_submissions(
                mock_request, assignment.assignment_uuid, regular_user, db
            )
        assert [r["user_id"] for r in rows] == [regular_user.id]
        assert rows[0]["grade_display"] is None  # SUBMITTED, not GRADED

    async def test_instructor_gets_per_task_breakdown_for_graded_rows(
        self, mock_request, db, admin_user, regular_user, assignment,
        assignment_task, task_submission, graded_submission,
    ):
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}._is_assignment_instructor", AsyncMock(return_value=True)):
            rows = await svc.read_assignment_submissions(
                mock_request, assignment.assignment_uuid, admin_user, db
            )
        assert len(rows) == 1
        display = rows[0]["grade_display"]
        assert display is not None
        [task_row] = display["tasks"]
        assert task_row["assignment_task_uuid"] == assignment_task.assignment_task_uuid
        assert task_row["submitted"] is True
        assert task_row["grade"] == 100
        assert task_row["max_grade"] == 100


# ---------------------------------------------------------------------------
# update_assignment_submission / delete_assignment_submission
# ---------------------------------------------------------------------------


class TestUpdateAssignmentSubmissionOwnership:
    async def test_learner_cannot_update_someone_elses_submission(
        self, mock_request, db, regular_user, admin_user, assignment
    ):
        db.add(_user_sub(id=172, uuid="aus_admin_upd", assignment_id=assignment.id,
                         user_id=admin_user.id))
        await db.commit()
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}._is_assignment_instructor", AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc:
                await svc.update_assignment_submission(
                    mock_request, admin_user.id, assignment.assignment_uuid,
                    AssignmentUserSubmissionCreate(assignment_id=assignment.id, grade=100),
                    regular_user, db,
                )
        assert exc.value.status_code == 403
        row = (await db.execute(
            select(AssignmentUserSubmission).where(AssignmentUserSubmission.id == 172)
        )).scalars().first()
        assert row.grade == 0


class TestDeleteAssignmentSubmissionResetsTrail:
    async def test_trail_step_is_reset(
        self, mock_request, db, admin_user, regular_user, org, course, activity,
        assignment, user_submission,
    ):
        """Rejecting a submission un-completes the activity and clears the grade."""
        trail = Trail(org_id=org.id, user_id=regular_user.id, trail_uuid="trail_edge",
                      creation_date=NOW, update_date=NOW)
        db.add(trail)
        await db.commit()
        await db.refresh(trail)
        run = TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id,
                       user_id=regular_user.id, creation_date=NOW, update_date=NOW)
        db.add(run)
        await db.commit()
        await db.refresh(run)
        step = TrailStep(
            complete=True, teacher_verified=True, grade="A", trailrun_id=run.id,
            trail_id=trail.id, activity_id=activity.id, course_id=course.id,
            org_id=org.id, user_id=regular_user.id, creation_date=NOW, update_date=NOW,
        )
        db.add(step)
        await db.commit()
        await db.refresh(step)

        with patch(f"{_SVC}.check_resource_access", new_callable=AsyncMock), \
             patch(f"{_SVC}.revoke_user_certificate", new_callable=AsyncMock) as revoke, \
             patch(f"{_SVC}.sync_trailrun_status", new_callable=AsyncMock), \
             patch(f"{_SVC}.notify_ee_learner_progress"):
            result = await svc.delete_assignment_submission(
                mock_request, regular_user.id, assignment.assignment_uuid, admin_user, db
            )

        assert result == {"message": "Assignment User Submission deleted"}
        await db.refresh(step)
        assert step.complete is False
        assert step.teacher_verified is False
        assert step.grade == ""
        revoke.assert_awaited_once()
        gone = (await db.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.id == user_submission.id
            )
        )).scalars().first()
        assert gone is None


# ---------------------------------------------------------------------------
# grade_assignment_submission
# ---------------------------------------------------------------------------


class TestGradeSubmissionCertificateErrors:
    async def test_certificate_error_does_not_fail_grading(
        self, mock_request, db, admin_user, regular_user, assignment, user_submission
    ):
        computed = {"display_grade": "B", "grade": 80}
        with patch(f"{_SVC}.authorize_assignment_access", new_callable=AsyncMock), \
             patch(f"{_SVC}._apply_grade_and_finalize", AsyncMock(return_value=computed)), \
             patch(f"{_SVC}.check_course_completion_and_create_certificate",
                   AsyncMock(side_effect=RuntimeError("cert service down"))):
            result = await svc.grade_assignment_submission(
                mock_request, regular_user.id, assignment.assignment_uuid, admin_user, db
            )
        assert result["message"] == "Assignment User Submission graded: B"
        assert result["grade"] == 80


# ---------------------------------------------------------------------------
# mark_activity_as_done_for_user
# ---------------------------------------------------------------------------


class TestMarkActivityDoneEdges:
    async def test_missing_activity_is_404(self, mock_request, db, admin_user, regular_user,
                                           no_activity_task):
        a, _ = no_activity_task
        with patch(f"{_SVC}.check_resource_access", new_callable=AsyncMock):
            await _expect_404(
                svc.mark_activity_as_done_for_user(
                    mock_request, regular_user.id, a.assignment_uuid, admin_user, db
                ),
                "Activity not found",
            )

    async def test_missing_user_is_404(self, mock_request, db, admin_user, assignment):
        with patch(f"{_SVC}.check_resource_access", new_callable=AsyncMock):
            await _expect_404(
                svc.mark_activity_as_done_for_user(
                    mock_request, 8888, assignment.assignment_uuid, admin_user, db
                ),
                "User not found",
            )
