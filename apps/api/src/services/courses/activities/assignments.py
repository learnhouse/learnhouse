import asyncio
import logging
import math
import re
from datetime import datetime
from uuid import uuid4
from fastapi import HTTPException, Request, UploadFile
from sqlmodel import Session, select

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentCreate,
    AssignmentRead,
    AssignmentTask,
    AssignmentTaskCreate,
    AssignmentTaskRead,
    AssignmentTaskSubmission,
    AssignmentTaskSubmissionCreate,
    AssignmentTaskSubmissionRead,
    AssignmentTaskSubmissionUpdate,
    AssignmentTaskTypeEnum,
    AssignmentTaskUpdate,
    AssignmentUpdate,
    AssignmentUserSubmission,
    AssignmentUserSubmissionCreate,
    AssignmentUserSubmissionRead,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.users import AnonymousUser, PublicUser, User, APITokenUser
from src.security.features_utils.usage import (
    check_limits_with_usage,
    decrease_feature_usage,
    increase_feature_usage,
)
from src.security.rbac import (
    authorization_verify_based_on_roles,
    check_resource_access,
    AccessAction,
)
from src.services.courses.activities.uploads.sub_file import upload_submission_file
from src.services.courses.activities.uploads.tasks_ref_files import (
    upload_reference_file,
)
from src.services.trail.trail import check_trail_presence
from src.services.courses.certifications import check_course_completion_and_create_certificate
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events
from src.services.webhooks.dispatch import dispatch_webhooks

logger = logging.getLogger(__name__)


def _block_api_tokens(current_user: PublicUser | AnonymousUser | APITokenUser) -> None:
    """
    Block API tokens from accessing assignments.

    SECURITY: Assignments contain sensitive user submission data and grades.
    API tokens are not allowed to access this data - only user authentication is permitted.
    """
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot access assignments. Only user authentication is allowed.",
        )


## > Grade computation

# Default passing threshold as a percentage (0-100). Used for PASS_FAIL,
# NUMERIC, and PERCENTAGE grading types — any type where the pass/fail line
# isn't implied by the display format itself.
DEFAULT_PASSING_THRESHOLD_PERCENTAGE = 50.0

# For ALPHABET (A/B/C/D/F) and GPA_SCALE (0.0-4.0), we use 60% as the passing
# line so the `passed` field stays consistent with the display: any score that
# renders as "F" or "0.0" will also have passed=False.
LETTER_PASSING_THRESHOLD_PERCENTAGE = 60.0


## > Auto-grading allow-list + server-side verification
##
## IMPORTANT: Not every task type can be graded without a human reviewer.
## This is an EXPLICIT allow-list (not a deny-list) so that when new task
## types are added to AssignmentTaskTypeEnum in the future, they default
## to requiring human review until they're explicitly opted in here.

# Tasks whose grade can be computed without teacher review. FILE_SUBMISSION
# and OTHER are deliberately excluded — files need human eyes, and OTHER is
# a legacy catch-all with no grading logic.
AUTO_GRADABLE_TASK_TYPES = frozenset(
    {
        AssignmentTaskTypeEnum.QUIZ,
        AssignmentTaskTypeEnum.FORM,
        AssignmentTaskTypeEnum.CODE,
        AssignmentTaskTypeEnum.SHORT_ANSWER,
        AssignmentTaskTypeEnum.NUMBER_ANSWER,
    }
)

# Tasks where the backend independently verifies the student's answer
# against the stored task contents during auto-grading, instead of trusting
# whatever grade the client-side component computed and posted.
#
# CODE is included: on auto-grade, the backend spins up a fresh Judge0
# batch against the student's stored source_code using the teacher's
# configured test_cases + grading_mode. The client-stored grade is
# ignored (students save with grade=0 today), so without server-side
# re-grading CODE tasks silently award zero.
SERVER_VERIFIED_TASK_TYPES = frozenset(
    {
        AssignmentTaskTypeEnum.SHORT_ANSWER,
        AssignmentTaskTypeEnum.NUMBER_ANSWER,
        AssignmentTaskTypeEnum.QUIZ,
        AssignmentTaskTypeEnum.FORM,
        AssignmentTaskTypeEnum.CODE,
    }
)


def _check_short_answer(answer, accepted, mode) -> bool:
    """
    Server-side mirror of TaskShortAnswerObject.tsx > checkShortAnswer.

    Returns True if the student's trimmed answer matches any of the accepted
    answers under the configured match mode. Anchors regex patterns with
    fullmatch so a pattern like ``hello`` doesn't silently match
    ``hello world``. Invalid regex patterns are treated as non-matches
    (never raise).
    """
    trimmed = (str(answer) if answer is not None else "").strip()
    if not trimmed:
        return False
    if not isinstance(accepted, list):
        return False
    match_mode = mode or "case_insensitive"
    for raw in accepted:
        if not isinstance(raw, str):
            continue
        expected = raw.strip()
        if not expected:
            continue
        if match_mode == "exact":
            if trimmed == expected:
                return True
        elif match_mode == "case_insensitive":
            if trimmed.lower() == expected.lower():
                return True
        elif match_mode == "contains":
            if expected.lower() in trimmed.lower():
                return True
        elif match_mode == "regex":
            try:
                if re.fullmatch(expected, trimmed, re.IGNORECASE):
                    return True
            except re.error:
                # Invalid regex from the teacher — treat as no match
                pass
    return False


def _check_number_answer(answer_raw, correct_value, tolerance) -> bool:
    """
    Server-side mirror of TaskNumberAnswerObject.tsx > checkNumberAnswer.

    Parses the student's answer as a float (accepting comma decimals),
    returns True when ``abs(parsed - correct) <= abs(tolerance)``. Returns
    False for blank / NaN / non-numeric input so students can't earn
    credit for a non-answer.
    """
    if answer_raw is None:
        return False
    cleaned = str(answer_raw).strip().replace(",", ".")
    if not cleaned:
        return False
    try:
        parsed = float(cleaned)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(parsed):
        return False
    try:
        correct = float(correct_value if correct_value is not None else 0)
        tol = abs(float(tolerance if tolerance is not None else 0))
    except (TypeError, ValueError):
        return False
    return abs(parsed - correct) <= tol


def _grade_quiz_task(contents: dict, submission_data: dict, task_max: int) -> int:
    """
    Server-side mirror of TaskQuizObject.tsx > gradeFC.

    Each option in each question is worth one point. The student earns a
    point for that option when their checkbox state (true / false) matches
    ``option.assigned_right_answer``. Missing submissions are treated as
    ``False`` (the student didn't check the option), which matches what the
    client does in submitFC when it fills in unsubmitted options.

    Returns a grade in [0, task_max], rounded.
    """
    questions = contents.get("questions") or []
    # Snapshot of submissions stored under task_submission.task_submission
    submissions = submission_data.get("submissions") or []

    # Index student answers by (questionUUID, optionUUID) for O(1) lookup
    answer_by_key: dict = {}
    for sub in submissions:
        if not isinstance(sub, dict):
            continue
        q_uuid = sub.get("questionUUID")
        o_uuid = sub.get("optionUUID")
        if q_uuid and o_uuid:
            answer_by_key[(q_uuid, o_uuid)] = bool(sub.get("answer"))

    total_options = 0
    correct_options = 0
    for question in questions:
        if not isinstance(question, dict):
            continue
        q_uuid = question.get("questionUUID")
        options = question.get("options") or []
        for option in options:
            if not isinstance(option, dict):
                continue
            total_options += 1
            o_uuid = option.get("optionUUID")
            expected = bool(option.get("assigned_right_answer"))
            student_answer = answer_by_key.get((q_uuid, o_uuid), False)
            if student_answer == expected:
                correct_options += 1

    if total_options == 0 or task_max <= 0:
        return 0
    return round(correct_options / total_options * task_max)


def _grade_form_task(contents: dict, submission_data: dict, task_max: int) -> int:
    """
    Server-side mirror of TaskFormObject.tsx > gradeFC.

    Each blank in each question is worth one point. The comparison is
    case-insensitive and trim-whitespace, matching the client behavior.

    Returns a grade in [0, task_max], rounded.
    """
    questions = contents.get("questions") or []
    submissions = submission_data.get("submissions") or []

    # Index student answers by (questionUUID, blankUUID)
    answer_by_key: dict = {}
    for sub in submissions:
        if not isinstance(sub, dict):
            continue
        q_uuid = sub.get("questionUUID")
        b_uuid = sub.get("blankUUID")
        if q_uuid and b_uuid:
            answer_by_key[(q_uuid, b_uuid)] = sub.get("answer")

    total_blanks = 0
    correct_blanks = 0
    for question in questions:
        if not isinstance(question, dict):
            continue
        q_uuid = question.get("questionUUID")
        blanks = question.get("blanks") or []
        for blank in blanks:
            if not isinstance(blank, dict):
                continue
            total_blanks += 1
            b_uuid = blank.get("blankUUID")
            correct_value = blank.get("correctAnswer", "")
            student_value = answer_by_key.get((q_uuid, b_uuid), "")
            if student_value is None or correct_value is None:
                continue
            if str(student_value).strip().lower() == str(correct_value).strip().lower():
                correct_blanks += 1

    if total_blanks == 0 or task_max <= 0:
        return 0
    return round(correct_blanks / total_blanks * task_max)


def _normalize_code_output(s):
    """
    Normalization for Judge0 stdout comparison. Same logic as the client
    and as the one-off version in code_execution.py — strips trailing
    whitespace per line and drops trailing blank lines so ``print("x")``
    matches ``x`` and Windows line endings don't cause false failures.
    """
    if not s:
        return ""
    lines = [line.rstrip() for line in s.splitlines()]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


async def _grade_code_task_async(task, task_submission):
    """
    Re-grade a CODE task server-side by running the student's stored
    source code against the teacher's configured test cases via Judge0.

    Grading modes (mirrors TaskCodeObject.tsx > gradeFC):
    - ``binary``: full marks only when every test passes, else 0.
    - ``custom_weights``: ``round(passed_weight / total_weight * max)``.
    - ``equal_weight`` (default): ``round(passed / total * max)``.

    Returns an int grade in [0, max_grade_value]. Returns ``None`` when
    Judge0 isn't configured or reachable — the caller leaves the stored
    grade alone in that case rather than silently zeroing students out.
    """
    # Deferred import to avoid a circular dependency at module load time
    from src.routers.code_execution import _get_judge0_config, _submit_single

    if task_submission is None:
        return 0

    contents = task.contents or {}
    submission_data = task_submission.task_submission or {}
    source_code = submission_data.get("source_code", "") or ""
    if not source_code.strip():
        # Student hasn't written any code yet → zero, consistent with other types
        return 0

    # Prefer the language_id the student actually submitted with — falls back
    # to the task's configured language if missing.
    language_id = submission_data.get("language_id") or contents.get("language_id")
    if language_id is None:
        return 0

    test_cases = contents.get("test_cases") or []
    if not test_cases:
        return 0

    task_max = int(task.max_grade_value or 0)
    if task_max <= 0:
        return 0

    try:
        judge0_cfg = _get_judge0_config()
    except HTTPException:
        # Judge0 not configured — can't verify; leave the stored grade alone
        logger.warning(
            "Judge0 not configured; skipping server-side CODE grading for task %s",
            getattr(task, "assignment_task_uuid", "?"),
        )
        return None

    async def run_one(tc):
        stdin = tc.get("stdin") or ""
        # Teacher-configured tests use camelCase `expectedStdout` in the
        # frontend contents schema. Tolerate both spellings.
        expected = tc.get("expectedStdout") or tc.get("expected_stdout") or ""
        try:
            r = await _submit_single(
                judge0_cfg, int(language_id), source_code, stdin
            )
        except Exception:
            logger.exception(
                "Judge0 call failed during CODE grading for task %s",
                getattr(task, "assignment_task_uuid", "?"),
            )
            return (tc, False)
        status = r.get("status") or {}
        actual = _normalize_code_output(r.get("stdout"))
        passed = status.get("id") == 3 and actual == _normalize_code_output(expected)
        return (tc, passed)

    results = await asyncio.gather(*(run_one(tc) for tc in test_cases))
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)
    grading_mode = contents.get("grading_mode") or "equal_weight"

    if grading_mode == "binary":
        return task_max if total_count > 0 and passed_count == total_count else 0

    if grading_mode == "custom_weights":
        total_weight = sum(int(tc.get("weight") or 1) for tc in test_cases)
        passed_weight = sum(
            int(tc.get("weight") or 1) for tc, passed in results if passed
        )
        if total_weight <= 0:
            return 0
        return round(passed_weight / total_weight * task_max)

    # equal_weight (default)
    if total_count <= 0:
        return 0
    return round(passed_count / total_count * task_max)


async def _server_verified_task_grade(task, task_submission):
    """
    If this task type is in SERVER_VERIFIED_TASK_TYPES, re-compute its
    grade from the stored task contents + submission data and return it.
    Returns ``None`` for task types we don't verify, or when the CODE
    grader can't reach Judge0 — the caller should fall back to
    ``task_submission.grade`` in both cases.
    """
    if task.assignment_type not in SERVER_VERIFIED_TASK_TYPES:
        return None
    if task_submission is None:
        return 0

    contents = task.contents or {}
    submission_data = task_submission.task_submission or {}
    task_max = int(task.max_grade_value or 0)

    if task.assignment_type == AssignmentTaskTypeEnum.SHORT_ANSWER:
        passed = _check_short_answer(
            submission_data.get("answer"),
            contents.get("correct_answers", []),
            contents.get("match_mode"),
        )
        return task_max if passed else 0

    if task.assignment_type == AssignmentTaskTypeEnum.NUMBER_ANSWER:
        passed = _check_number_answer(
            submission_data.get("answer"),
            contents.get("correct_value"),
            contents.get("tolerance"),
        )
        return task_max if passed else 0

    if task.assignment_type == AssignmentTaskTypeEnum.QUIZ:
        return _grade_quiz_task(contents, submission_data, task_max)

    if task.assignment_type == AssignmentTaskTypeEnum.FORM:
        return _grade_form_task(contents, submission_data, task_max)

    if task.assignment_type == AssignmentTaskTypeEnum.CODE:
        return await _grade_code_task_async(task, task_submission)

    return None


def _percentage_to_letter_grade(percentage: float) -> str:
    """Convert a 0-100 percentage into a US-style A/B/C/D/F letter grade."""
    if percentage >= 90:
        return "A"
    if percentage >= 80:
        return "B"
    if percentage >= 70:
        return "C"
    if percentage >= 60:
        return "D"
    return "F"


def _percentage_to_gpa(percentage: float) -> str:
    """Convert a 0-100 percentage into a US 4.0 GPA scale string."""
    if percentage >= 93:
        return "4.0"
    if percentage >= 90:
        return "3.7"
    if percentage >= 87:
        return "3.3"
    if percentage >= 83:
        return "3.0"
    if percentage >= 80:
        return "2.7"
    if percentage >= 77:
        return "2.3"
    if percentage >= 73:
        return "2.0"
    if percentage >= 70:
        return "1.7"
    if percentage >= 67:
        return "1.3"
    if percentage >= 63:
        return "1.0"
    if percentage >= 60:
        return "0.7"
    return "0.0"


def compute_assignment_grade(
    raw_grade: int,
    max_grade: int,
    grading_type: GradingTypeEnum | str | None,
    overall_feedback: str | None = None,
) -> dict:
    """
    Build a normalized grade object from a raw grade sum and the configured
    grading type.

    Responsibilities:
    - Clamp raw_grade to [0, max_grade] so a buggy task sum can't report 120/100.
    - Guard against max_grade <= 0 (yields a 0% grade, not a divide-by-zero).
    - Compute a single percentage that every display format derives from.
    - Produce a human-readable `display_grade` (the canonical string the UI
      renders), plus `letter_grade`, `points_summary`, and `percentage_display`
      as secondary formats the UI can show side-by-side without doing math.
    - Flag `passed` using a mode-aware threshold so it stays consistent with
      the display: ALPHABET/GPA_SCALE pass at 60% (D / 0.7), everything else
      passes at 50%.

    The backend intentionally stores only the raw integer sum in
    AssignmentUserSubmission.grade; all formatting is derived on read.
    """
    clamped_max = max(int(max_grade or 0), 0)
    clamped_grade = max(min(int(raw_grade or 0), clamped_max), 0)

    if clamped_max > 0:
        percentage = (clamped_grade / clamped_max) * 100.0
    else:
        percentage = 0.0

    # Round to 2 decimal places for stable display + comparisons
    percentage = round(percentage, 2)

    # Normalize enum value to string so the rest of the function is type-agnostic
    gt_value = (
        grading_type.value
        if isinstance(grading_type, GradingTypeEnum)
        else (grading_type or "NUMERIC")
    )

    # Mode-aware passing threshold — keeps `passed` aligned with the display
    if gt_value in ("ALPHABET", "GPA_SCALE"):
        passing_threshold = LETTER_PASSING_THRESHOLD_PERCENTAGE
    else:
        passing_threshold = DEFAULT_PASSING_THRESHOLD_PERCENTAGE
    passed = percentage >= passing_threshold

    # Secondary formats — always available regardless of grading_type so the
    # UI can render e.g. "B (85/100 · 85%)" without recomputing anything.
    letter_grade = _percentage_to_letter_grade(percentage)
    points_summary = f"{clamped_grade}/{clamped_max} pts"
    percentage_display = f"{percentage:.2f}%"

    if gt_value == "ALPHABET":
        display_grade = letter_grade
    elif gt_value == "PERCENTAGE":
        display_grade = percentage_display
    elif gt_value == "PASS_FAIL":
        display_grade = "Pass" if passed else "Fail"
    elif gt_value == "GPA_SCALE":
        display_grade = _percentage_to_gpa(percentage)
    else:
        # NUMERIC and any unknown type: show a canonical "X/100" score so
        # students always see a familiar out-of-100 number regardless of how
        # many tasks the assignment has or what their max_grade_values were.
        display_grade = f"{round(percentage)}/100"

    return {
        "grade": clamped_grade,
        "max_grade": clamped_max,
        "percentage": percentage,
        "display_grade": display_grade,
        "letter_grade": letter_grade,
        "points_summary": points_summary,
        "percentage_display": percentage_display,
        "passed": passed,
        "passing_threshold": passing_threshold,
        "grading_type": gt_value,
        "overall_feedback": overall_feedback,
    }


## > Assignments CRUD


async def create_assignment(
    request: Request,
    assignment_object: AssignmentCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if org exists
    statement = select(Course).where(Course.id == assignment_object.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Usage check
    check_limits_with_usage("assignments", course.org_id, db_session)

    # Create Assignment
    assignment = Assignment(**assignment_object.model_dump())

    assignment.assignment_uuid = str(f"assignment_{uuid4()}")
    assignment.creation_date = str(datetime.now())
    assignment.update_date = str(datetime.now())
    assignment.org_id = course.org_id

    # Insert Assignment in DB
    db_session.add(assignment)
    db_session.commit()
    db_session.refresh(assignment)

    # Feature usage
    increase_feature_usage("assignments", course.org_id, db_session)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def read_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    statement = (
        select(Assignment, Course.course_uuid, Activity.activity_uuid)
        .join(Course, Course.id == Assignment.course_id)  # type: ignore
        .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore
        .where(Assignment.assignment_uuid == assignment_uuid)
    )
    row = db_session.exec(statement).first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    assignment, course_uuid, activity_uuid = row

    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    result = AssignmentRead.model_validate(assignment)
    result.course_uuid = course_uuid
    result.activity_uuid = activity_uuid
    return result


async def read_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    statement = (
        select(Assignment, Course.course_uuid, Activity.activity_uuid)
        .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore
        .join(Course, Course.id == Assignment.course_id)  # type: ignore
        .where(Activity.activity_uuid == activity_uuid)
    )
    row = db_session.exec(statement).first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    assignment, course_uuid, activity_uuid_val = row

    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    result = AssignmentRead.model_validate(assignment)
    result.course_uuid = course_uuid
    result.activity_uuid = activity_uuid_val
    return result


async def update_assignment(
    request: Request,
    assignment_uuid: str,
    assignment_object: AssignmentUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in
    for var, value in vars(assignment_object).items():
        if value is not None:
            setattr(assignment, var, value)
    assignment.update_date = str(datetime.now())

    # Insert Assignment in DB
    db_session.add(assignment)
    db_session.commit()
    db_session.refresh(assignment)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def delete_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Feature usage
    decrease_feature_usage("assignments", course.org_id, db_session)

    # Delete Assignment
    db_session.delete(assignment)
    db_session.commit()

    return {"message": "Assignment deleted"}


async def delete_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if activity exists
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)

    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.activity_id == activity.id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

     # Feature usage
    decrease_feature_usage("assignments", course.org_id, db_session)

    # Delete Assignment
    db_session.delete(assignment)

    db_session.commit()

    return {"message": "Assignment deleted"}


## > Assignments Tasks CRUD


async def create_assignment_task(
    request: Request,
    assignment_uuid: str,
    assignment_task_object: AssignmentTaskCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Create Assignment Task
    assignment_task = AssignmentTask(**assignment_task_object.model_dump())

    assignment_task.assignment_task_uuid = str(f"assignmenttask_{uuid4()}")
    assignment_task.creation_date = str(datetime.now())
    assignment_task.update_date = str(datetime.now())
    assignment_task.org_id = course.org_id
    assignment_task.chapter_id = assignment.chapter_id
    assignment_task.activity_id = assignment.activity_id
    assignment_task.assignment_id = assignment.id  # type: ignore
    assignment_task.course_id = assignment.course_id

    # Insert Assignment Task in DB
    db_session.add(assignment_task)
    db_session.commit()
    db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def read_assignment_tasks(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Find assignments tasks for an assignment
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_id == assignment.id
    )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment tasks read
    return [
        AssignmentTaskRead.model_validate(assignment_task)
        for assignment_task in db_session.exec(statement).all()
    ]


async def read_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignmenttask = db_session.exec(statement).first()

    if not assignmenttask:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignmenttask.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignmenttask)


async def put_assignment_task_reference_file(
    request: Request,
    db_session: Session,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    reference_file: UploadFile | None = None,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check for activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Upload reference file
    if reference_file and reference_file.filename and activity and org:
        name_in_disk = await upload_reference_file(
            reference_file,
            activity.activity_uuid,
            org.org_uuid,
            course.course_uuid,
            assignment.assignment_uuid,
            assignment_task_uuid,
        )
        # Update reference file
        assignment_task.reference_file = name_in_disk

    assignment_task.update_date = str(datetime.now())

    # Insert Assignment Task in DB
    db_session.add(assignment_task)
    db_session.commit()
    db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def put_assignment_task_submission_file(
    request: Request,
    db_session: Session,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    sub_file: UploadFile | None = None,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check for activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()

    # RBAC check - only need read permission to submit files
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Check if user is enrolled in the course
    if not await authorization_verify_based_on_roles(request, current_user.id, "read", course.course_uuid, db_session):
        raise HTTPException(
            status_code=403,
            detail="You must be enrolled in this course to submit files"
        )

    # Upload submission file
    if sub_file and sub_file.filename and activity and org:
        name_in_disk = await upload_submission_file(
            sub_file,
            activity.activity_uuid,
            org.org_uuid,
            course.course_uuid,
            assignment.assignment_uuid,
            assignment_task_uuid,
        )

        return {"file_uuid": name_in_disk}


async def update_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    assignment_task_object: AssignmentTaskUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in
    for var, value in vars(assignment_task_object).items():
        if value is not None:
            setattr(assignment_task, var, value)
    assignment_task.update_date = str(datetime.now())

    # Insert Assignment Task in DB
    db_session.add(assignment_task)
    db_session.commit()
    db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def delete_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment Task
    db_session.delete(assignment_task)
    db_session.commit()

    return {"message": "Assignment Task deleted"}


## > Assignments Tasks Submissions CRUD


async def handle_assignment_task_submission(
    request: Request,
    assignment_task_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    assignment_task_submission_uuid = assignment_task_submission_object.assignment_task_submission_uuid
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Check if user has instructor/admin permissions for grading
    is_instructor = await authorization_verify_based_on_roles(request, current_user.id, "update", course.course_uuid, db_session)

    # For regular users, ensure they can only submit their own work
    if not is_instructor:
        # Check if user is enrolled in the course
        if not await authorization_verify_based_on_roles(request, current_user.id, "read", course.course_uuid, db_session):
            raise HTTPException(
                status_code=403,
                detail="You must be enrolled in this course to submit assignments"
            )
        
        # SECURITY: Regular users cannot update grades - only check if actual values are being set
        if (assignment_task_submission_object.grade is not None and assignment_task_submission_object.grade != 0) or \
           (assignment_task_submission_object.task_submission_grade_feedback is not None and assignment_task_submission_object.task_submission_grade_feedback != ""):
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to update grades"
            )

        # Only need read permission for submissions
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
    else:
        # SECURITY: Instructors/admins need update permission to grade
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Try to find existing submission by user_id and assignment_task_id first (for save progress functionality)
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        AssignmentTaskSubmission.user_id == current_user.id,
    )
    assignment_task_submission = db_session.exec(statement).first()
    
    # If no submission found by user+task, try to find by UUID if provided (for specific submission updates)
    if not assignment_task_submission and assignment_task_submission_uuid:
        statement = select(AssignmentTaskSubmission).where(
            AssignmentTaskSubmission.assignment_task_submission_uuid == assignment_task_submission_uuid
        )
        assignment_task_submission = db_session.exec(statement).first()

    # If submission exists, update it
    if assignment_task_submission:
        # SECURITY: For regular users, ensure they can only update their own submissions
        if not is_instructor and assignment_task_submission.user_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="You can only update your own submissions"
            )

        # Update only the fields that were passed in
        for var, value in vars(assignment_task_submission_object).items():
            if value is not None:
                setattr(assignment_task_submission, var, value)
        assignment_task_submission.update_date = str(datetime.now())

        # Insert Assignment Task Submission in DB
        db_session.add(assignment_task_submission)
        db_session.commit()
        db_session.refresh(assignment_task_submission)

    else:
        # Create new Task submission
        current_time = str(datetime.now())

        # Assuming model_dump() returns a dictionary
        model_data = assignment_task_submission_object.model_dump()

        assignment_task_submission = AssignmentTaskSubmission(
            assignment_task_submission_uuid=assignment_task_submission_uuid or f"assignmenttasksubmission_{uuid4()}",
            task_submission=model_data["task_submission"],
            grade=0,  # Always start with 0 for new submissions
            task_submission_grade_feedback="",  # Start with empty feedback
            assignment_task_id=int(assignment_task.id),  # type: ignore
            assignment_type=assignment_task.assignment_type,
            activity_id=assignment.activity_id,
            course_id=assignment.course_id,
            chapter_id=assignment.chapter_id,
            user_id=current_user.id,
            creation_date=current_time,
            update_date=current_time,
        )

        # Insert Assignment Task Submission in DB
        db_session.add(assignment_task_submission)
        db_session.commit()
        db_session.refresh(assignment_task_submission)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_user_assignment_task_submissions(
    request: Request,
    assignment_task_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Ownership check: non-instructors may only read their own submissions
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )
    if not is_instructor and int(user_id) != int(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="You can only view your own submissions",
        )

    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        AssignmentTaskSubmission.user_id == user_id,
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_user_assignment_task_submissions_me_batch(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    """Return a map of {assignment_task_uuid: submission | None} for the
    current user across every task in the assignment, in a single round trip.
    Replaces N per-task /submissions/me calls from the activity view."""
    _block_api_tokens(current_user)

    assignment_row = db_session.exec(
        select(Assignment, Course.course_uuid)
        .join(Course, Course.id == Assignment.course_id)  # type: ignore
        .where(Assignment.assignment_uuid == assignment_uuid)
    ).first()

    if not assignment_row:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    assignment, course_uuid = assignment_row

    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    rows = db_session.exec(
        select(AssignmentTask, AssignmentTaskSubmission)
        .outerjoin(
            AssignmentTaskSubmission,
            (AssignmentTaskSubmission.assignment_task_id == AssignmentTask.id)  # type: ignore
            & (AssignmentTaskSubmission.user_id == current_user.id),  # type: ignore
        )
        .where(AssignmentTask.assignment_id == assignment.id)
        # ASC ordering means that if legacy data has multiple submissions per
        # (task,user) — handle_assignment_task_submission is upsert so this
        # shouldn't happen in normal flow — the dict comprehension below
        # overwrites lower ids with higher ones, leaving the most recent
        # submission as the winning value.
        .order_by(AssignmentTaskSubmission.id.asc())  # type: ignore
    ).all()

    return {
        task.assignment_task_uuid: (
            AssignmentTaskSubmissionRead.model_validate(sub) if sub else None
        )
        for task, sub in rows
    }


async def read_user_assignment_task_submissions_me(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        AssignmentTaskSubmission.user_id == current_user.id,
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        # Return None instead of raising an error for cases where no submission exists yet
        return None

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_assignment_task_submissions(
    request: Request,
    assignment_task_submission_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid,
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Ownership check: non-instructors may only read their own submissions
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )
    if not is_instructor and int(assignment_task_submission.user_id) != int(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="You can only view your own submissions",
        )

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def update_assignment_task_submission(
    request: Request,
    assignment_task_submission_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Update only the fields that were passed in
    for var, value in vars(assignment_task_submission_object).items():
        if value is not None:
            setattr(assignment_task_submission, var, value)
    assignment_task_submission.update_date = str(datetime.now())

    # Insert Assignment Task Submission in DB
    db_session.add(assignment_task_submission)
    db_session.commit()
    db_session.refresh(assignment_task_submission)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def delete_assignment_task_submission(
    request: Request,
    assignment_task_submission_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment Task Submission
    db_session.delete(assignment_task_submission)
    db_session.commit()

    return {"message": "Assignment Task Submission deleted"}


## > Assignments Submissions CRUD


async def create_assignment_submission(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if the submission has already been made
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id,
        AssignmentUserSubmission.user_id == current_user.id,
    )

    assignment_user_submission = db_session.exec(statement).first()

    if assignment_user_submission:
        raise HTTPException(
            status_code=400,
            detail="Assignment User Submission already exists",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if User already submitted the assignment
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id,
        AssignmentUserSubmission.user_id == current_user.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if assignment_user_submission:
        raise HTTPException(
            status_code=400,
            detail="Assignment User Submission already exists",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Create Assignment User Submission
    assignment_user_submission = AssignmentUserSubmission(
        user_id=current_user.id,
        assignment_id=assignment.id,  # type: ignore
        grade=0,
        assignmentusersubmission_uuid=str(f"assignmentusersubmission_{uuid4()}"),
        submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert Assignment User Submission in DB
    db_session.add(assignment_user_submission)
    db_session.commit()

    # Track assignment submission
    await track(
        event_name=analytics_events.ASSIGNMENT_SUBMITTED,
        org_id=course.org_id,
        user_id=current_user.id,
        properties={
            "assignment_uuid": assignment_uuid,
            "course_uuid": course.course_uuid,
        },
    )
    await dispatch_webhooks(
        event_name=analytics_events.ASSIGNMENT_SUBMITTED,
        org_id=course.org_id,
        data={
            "user": {"user_uuid": current_user.user_uuid, "email": current_user.email, "username": current_user.username},
            "assignment": {"assignment_uuid": assignment_uuid},
            "course": {"course_uuid": course.course_uuid, "name": course.name},
        },
    )

    # User
    statement = select(User).where(User.id == current_user.id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Add TrailStep
    trail = await check_trail_presence(
        org_id=course.org_id,
        user_id=user.id,  # type: ignore
        request=request,
        user=user,  # type: ignore
        db_session=db_session,
    )

    statement = select(TrailRun).where(
        TrailRun.trail_id == trail.id,
        TrailRun.course_id == course.id,
        TrailRun.user_id == user.id,
    )
    trailrun = db_session.exec(statement).first()

    if not trailrun:
        trailrun = TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=course.org_id,
            user_id=user.id,  # type: ignore
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailrun)
        db_session.commit()
        db_session.refresh(trailrun)

    statement = select(TrailStep).where(
        TrailStep.trailrun_id == trailrun.id,
        TrailStep.activity_id == activity.id,
        TrailStep.user_id == user.id,
    )
    trailstep = db_session.exec(statement).first()

    if not trailstep:
        trailstep = TrailStep(
            trailrun_id=trailrun.id if trailrun.id is not None else 0,
            activity_id=activity.id if activity.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            trail_id=trail.id if trail.id is not None else 0,
            org_id=course.org_id,
            complete=True,
            teacher_verified=False,
            grade="",
            user_id=user.id, # type: ignore
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailstep)
        db_session.commit()
        db_session.refresh(trailstep)

    # Auto-grading path: if the teacher enabled auto_grading on this assignment
    # AND every task is in AUTO_GRADABLE_TASK_TYPES (explicit allow-list —
    # FILE_SUBMISSION and OTHER are deliberately excluded), compute the grade
    # now and flip the submission to GRADED. The student's per-task submissions
    # already exist at this point because they were persisted as the student
    # worked through the tasks; we just sum them and run them through the
    # shared grading helper. For SHORT_ANSWER and NUMBER_ANSWER, the helper
    # re-verifies the student's answer server-side so client-side tampering
    # is caught.
    if assignment.auto_grading:
        tasks_statement = select(AssignmentTask).where(
            AssignmentTask.assignment_id == assignment.id
        )
        assignment_tasks = db_session.exec(tasks_statement).all()

        all_auto_gradable = bool(assignment_tasks) and all(
            t.assignment_type in AUTO_GRADABLE_TASK_TYPES for t in assignment_tasks
        )

        if all_auto_gradable:
            await _apply_grade_and_finalize(
                assignment=assignment,
                course=course,
                user_id=int(current_user.id),
                assignment_user_submission=assignment_user_submission,
                db_session=db_session,
                overall_feedback=None,
                auto_graded=True,
            )
            # Ensure trailstep reflects completion (create_assignment_submission
            # above already created it with complete=True, but if one already
            # existed from a previous state we make sure it's marked done).
            trailstep.complete = True
            trailstep.update_date = str(datetime.now())
            db_session.add(trailstep)
            db_session.commit()

    # Check if all activities in the course are completed and create certificate if so
    if course and course.id and user and user.id:
        await check_course_completion_and_create_certificate(
            request, user.id, course.id, db_session
        )

    # return assignment user submission read
    return AssignmentUserSubmissionRead.model_validate(assignment_user_submission)


async def read_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Check if user has instructor/admin privileges on this course
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )

    # Non-instructors can only see their own submissions
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id
    )
    if not is_instructor:
        statement = statement.where(
            AssignmentUserSubmission.user_id == current_user.id
        )

    # return assignment tasks read
    return [
        AssignmentUserSubmissionRead.model_validate(assignment_user_submission)
        for assignment_user_submission in db_session.exec(statement).all()
    ]


async def read_user_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Ownership check: non-instructors may only read their own submissions
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )
    if not is_instructor and int(user_id) != int(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="You can only view your own submissions",
        )

    # Find assignments tasks for an assignment
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id,
        AssignmentUserSubmission.user_id == user_id,
    )

    # return assignment tasks read
    return [
        AssignmentUserSubmissionRead.model_validate(assignment_user_submission)
        for assignment_user_submission in db_session.exec(statement).all()
    ]


async def read_user_assignment_submissions_me(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    return await read_user_assignment_submissions(
        request,
        assignment_uuid,
        current_user.id,
        current_user,
        db_session,
    )


async def update_assignment_submission(
    request: Request,
    user_id: str,
    assignment_user_submission_object: AssignmentUserSubmissionCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(
        Assignment.id == assignment_user_submission.assignment_id
    )
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if user is an instructor/admin (has UPDATE permission)
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )

    if is_instructor:
        # Instructors/admins can update any submission (e.g., for grading)
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    else:
        # Regular users need READ access and can only update their own submissions
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
        if str(assignment_user_submission.user_id) != str(current_user.id):
            raise HTTPException(
                status_code=403,
                detail="You can only update your own submissions",
            )

    # Update only the fields that were passed in
    for var, value in vars(assignment_user_submission_object).items():
        if value is not None:
            setattr(assignment_user_submission, var, value)
    assignment_user_submission.update_date = str(datetime.now())

    # Insert Assignment User Submission in DB
    db_session.add(assignment_user_submission)
    db_session.commit()
    db_session.refresh(assignment_user_submission)

    # return assignment user submission read
    return AssignmentUserSubmissionRead.model_validate(assignment_user_submission)


async def delete_assignment_submission(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment User Submission
    db_session.delete(assignment_user_submission)
    db_session.commit()

    return {"message": "Assignment User Submission deleted"}


## > Assignments Submissions Grading


async def _apply_grade_and_finalize(
    assignment: Assignment,
    course: Course,
    user_id: int,
    assignment_user_submission: AssignmentUserSubmission,
    db_session: Session,
    overall_feedback: str | None = None,
    auto_graded: bool = False,
) -> dict:
    """
    Core grading logic shared by manual and auto-grade flows. Computes the
    final grade from existing per-task submissions, persists it with status
    GRADED, dispatches the webhook, and returns the enriched grade dict
    (including per-task breakdown).

    IMPORTANT: This helper does NO permission checks. Callers must enforce
    access control before calling it. It exists so that both the teacher's
    manual grading endpoint (UPDATE permission) and the student's auto-grade
    path (READ permission, self-grading under teacher-configured auto_grading)
    can share one implementation.
    """
    # Compute max_grade from the current task configuration
    tasks_statement = select(AssignmentTask).where(
        AssignmentTask.assignment_id == assignment.id
    )
    assignment_tasks = db_session.exec(tasks_statement).all()
    max_grade = 0
    for task in assignment_tasks:
        max_grade += int(task.max_grade_value or 0)

    # Load this user's per-task submissions (keyed by task_id so we can build
    # both the sum and the per-task breakdown).
    task_ids = [task.id for task in assignment_tasks if task.id is not None]
    task_submissions_by_task_id: dict = {}
    if task_ids:
        ts_statement = select(AssignmentTaskSubmission).where(
            AssignmentTaskSubmission.user_id == int(user_id),
            AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
        )
        for ts in db_session.exec(ts_statement).all():
            task_submissions_by_task_id[ts.assignment_task_id] = ts

    # Server-side re-verification for task types where we don't trust the
    # client's computed grade (SHORT_ANSWER, NUMBER_ANSWER). If the
    # verified grade differs from what the client submitted, overwrite it
    # so tampering is caught and future reads see the correct number.
    for task in assignment_tasks:
        ts = task_submissions_by_task_id.get(task.id)
        verified = await _server_verified_task_grade(task, ts)
        if verified is None or ts is None:
            continue
        if int(ts.grade or 0) != verified:
            ts.grade = verified
            ts.task_submission_grade_feedback = (
                "Server-verified: correct"
                if verified > 0
                else "Server-verified: incorrect"
            )
            db_session.add(ts)

    raw_grade = 0
    for ts in task_submissions_by_task_id.values():
        raw_grade += int(ts.grade or 0)

    # Only overwrite stored feedback when the caller explicitly provided one.
    # Passing None means "leave the existing note alone".
    if overall_feedback is not None:
        assignment_user_submission.overall_feedback = overall_feedback or None

    computed = compute_assignment_grade(
        raw_grade,
        max_grade,
        assignment.grading_type,
        overall_feedback=assignment_user_submission.overall_feedback,
    )

    # Per-task breakdown
    tasks_breakdown = []
    for index, task in enumerate(
        sorted(assignment_tasks, key=lambda t: t.id or 0)
    ):
        ts = task_submissions_by_task_id.get(task.id)
        task_max = int(task.max_grade_value or 0)
        task_raw = int(ts.grade or 0) if ts else 0
        task_percentage = round((task_raw / task_max) * 100.0, 2) if task_max > 0 else 0.0
        task_percentage = max(min(task_percentage, 100.0), 0.0)
        tasks_breakdown.append(
            {
                "index": index + 1,
                "assignment_task_uuid": task.assignment_task_uuid,
                "title": task.title,
                "description": task.description,
                "assignment_type": task.assignment_type,
                "submitted": ts is not None,
                "percentage": task_percentage,
                "percentage_display": f"{task_percentage:.0f}%",
                "feedback": ts.task_submission_grade_feedback if ts else None,
            }
        )
    computed["tasks"] = tasks_breakdown

    # Persist the clamped raw grade + flip status to GRADED in a single commit
    assignment_user_submission.grade = computed["grade"]
    assignment_user_submission.submission_status = AssignmentUserSubmissionStatus.GRADED
    db_session.add(assignment_user_submission)
    db_session.commit()
    db_session.refresh(assignment_user_submission)

    await dispatch_webhooks(
        event_name="assignment_graded",
        org_id=course.org_id,
        data={
            "user_id": int(user_id),
            "assignment_uuid": assignment.assignment_uuid,
            "course_uuid": course.course_uuid,
            "grade": computed["grade"],
            "max_grade": computed["max_grade"],
            "percentage": computed["percentage"],
            "display_grade": computed["display_grade"],
            "letter_grade": computed["letter_grade"],
            "points_summary": computed["points_summary"],
            "passed": computed["passed"],
            "grading_type": computed["grading_type"],
            "overall_feedback": computed["overall_feedback"],
            "auto_graded": auto_graded,
        },
    )

    return computed


async def grade_assignment_submission(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
    overall_feedback: str | None = None,
):
    _block_api_tokens(current_user)
    # SECURITY: This function should only be accessible by course owners or instructors
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Require course ownership or instructor role for grading
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    computed = await _apply_grade_and_finalize(
        assignment=assignment,
        course=course,
        user_id=int(user_id),
        assignment_user_submission=assignment_user_submission,
        db_session=db_session,
        overall_feedback=overall_feedback,
        auto_graded=False,
    )

    return {
        "message": f"Assignment User Submission graded: {computed['display_grade']}",
        **computed,
    }


async def get_grade_assignment_submission(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Ownership check: non-instructors may only read their own grade
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )
    if not is_instructor and str(user_id) != str(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="You can only view your own grade",
        )

    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Recompute max_grade from current task configuration. Doing this on read
    # (rather than storing a stale value) means instructor edits to task
    # max_grade_value are reflected immediately.
    tasks_statement = select(AssignmentTask).where(
        AssignmentTask.assignment_id == assignment.id
    )
    assignment_tasks = db_session.exec(tasks_statement).all()
    max_grade = 0
    for task in assignment_tasks:
        max_grade += int(task.max_grade_value or 0)

    # Load this user's per-task submissions so the response can include a
    # per-task breakdown. The UI uses this to show "Task N · 85%" badges
    # instead of re-fetching one request per task.
    task_ids = [task.id for task in assignment_tasks if task.id is not None]
    task_submissions_by_task_id: dict = {}
    if task_ids:
        ts_statement = select(AssignmentTaskSubmission).where(
            AssignmentTaskSubmission.user_id == int(user_id),
            AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
        )
        for ts in db_session.exec(ts_statement).all():
            task_submissions_by_task_id[ts.assignment_task_id] = ts

    tasks_breakdown = []
    for index, task in enumerate(
        sorted(assignment_tasks, key=lambda t: t.id or 0)
    ):
        ts = task_submissions_by_task_id.get(task.id)
        task_max = int(task.max_grade_value or 0)
        task_raw = int(ts.grade or 0) if ts else 0
        # Use the same clamp + percentage logic as the top-level helper
        task_percentage = round((task_raw / task_max) * 100.0, 2) if task_max > 0 else 0.0
        task_percentage = max(min(task_percentage, 100.0), 0.0)
        tasks_breakdown.append(
            {
                "index": index + 1,
                "assignment_task_uuid": task.assignment_task_uuid,
                "title": task.title,
                "description": task.description,
                "assignment_type": task.assignment_type,
                "submitted": ts is not None,
                "percentage": task_percentage,
                "percentage_display": f"{task_percentage:.0f}%",
                "feedback": ts.task_submission_grade_feedback if ts else None,
            }
        )

    grade_obj = compute_assignment_grade(
        int(assignment_user_submission.grade or 0),
        max_grade,
        assignment.grading_type,
        overall_feedback=assignment_user_submission.overall_feedback,
    )
    grade_obj["tasks"] = tasks_breakdown
    return grade_obj


async def mark_activity_as_done_for_user(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # SECURITY: This function should only be accessible by course owners or instructors
    # Get Assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if activity exists
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Require course ownership or instructor role for marking activities as done
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check if user exists
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Check if user is enrolled in the course
    trailsteps = select(TrailStep).where(
        TrailStep.activity_id == activity.id,
        TrailStep.user_id == user_id,
    )
    trailstep = db_session.exec(trailsteps).first()

    if not trailstep:
        raise HTTPException(
            status_code=404,
            detail="User not enrolled in the course",
        )

    # Mark activity as done
    trailstep.complete = True
    trailstep.update_date = str(datetime.now())

    # Insert TrailStep in DB
    db_session.add(trailstep)
    db_session.commit()
    db_session.refresh(trailstep)

    # Check if all activities in the course are completed and create certificate if so
    if course and course.id:
        await check_course_completion_and_create_certificate(
            request, int(user_id), course.id, db_session
        )

    # return OK
    return {"message": "Activity marked as done for user"}


async def get_assignments_from_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find course
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get Assignments
    statement = select(Assignment).where(Assignment.course_id == course.id)
    assignments = db_session.exec(statement).all()

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignments read
    return [AssignmentRead.model_validate(assignment) for assignment in assignments]
