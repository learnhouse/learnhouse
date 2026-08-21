import asyncio
import copy
import logging
import math
import re
from datetime import datetime, timedelta
from typing import Sequence
from uuid import uuid4

try:
    # The `regex` module supports a wall-clock `timeout=` that actually aborts a
    # catastrophic-backtracking match (unlike stdlib `re`), which we use to make
    # teacher-authored regex answer-matching ReDoS-safe.
    import regex as _regex
except Exception:  # pragma: no cover - fallback if the optional dep is absent
    _regex = None
from fastapi import HTTPException, Request, UploadFile
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.exc import IntegrityError

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
    authorization_verify_api_token_permissions,
    check_resource_access,
    AccessAction,
)
from src.services.courses.activities.uploads.sub_file import upload_submission_file
from src.services.courses.activities.uploads.tasks_ref_files import (
    upload_reference_file,
)
from src.services.courses.activities.quiz_modes import (
    resolve_grading_mode,
    resolve_response_type,
    score_question,
)
from src.services.trail.trail import check_trail_presence
from src.services.courses.certifications import (
    check_course_completion_and_create_certificate,
    is_course_fully_completed,
    revoke_user_certificate,
    sync_trailrun_status,
    are_course_assignments_passed,
)
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events
from src.services.audit.audit import record_audit_event
from src.db.user_audit_events import UserAuditEventType
from src.services.webhooks.dispatch import dispatch_webhooks

# Hard caps for regex answer-matching (defense-in-depth alongside the timeout).
_REGEX_MAX_LEN = 1000
_REGEX_TIMEOUT_SECONDS = 0.5

# Thousands-grouped numbers, used to disambiguate comma-as-thousands from
# comma-as-decimal when parsing NUMBER_ANSWER submissions.
# The optional sign matters: anchoring at ^\d meant a negative grouped number
# ("-1,000") never matched here and fell through to the European-decimal branch,
# where the comma became a decimal point and -1,000 parsed as -1.0 — marking a
# correct answer wrong. Negative correct values are authorable and the student
# input is free text, so this was reachable.
_THOUSANDS_INT = re.compile(r"^[+-]?\d{1,3}(,\d{3})+$")          # 1,000 / -1,000,000
_THOUSANDS_DEC = re.compile(r"^[+-]?\d{1,3}(,\d{3})+\.\d+$")     # 1,000.50 / -1,000.50

logger = logging.getLogger(__name__)


def _block_api_tokens(current_user: PublicUser | AnonymousUser | APITokenUser) -> None:
    """
    Block API tokens from accessing assignments.

    SECURITY: Assignments contain sensitive user submission data and grades.
    API tokens are not allowed to access this data - only user authentication is permitted.

    Still used on the learner-centric, session-only endpoints (the ``/me`` reads,
    student submission upsert, file uploads, retry, "done"). The instructor-style
    endpoints (authoring, reading submissions, grading) instead go through
    ``authorize_assignment_access`` so API tokens with the ``assignments`` rights
    bucket can drive assignments headlessly.
    """
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot access assignments. Only user authentication is allowed.",
        )


_ACCESS_ACTION_TO_TOKEN_ACTION = {
    AccessAction.CREATE: "create",
    AccessAction.READ: "read",
    AccessAction.UPDATE: "update",
    AccessAction.DELETE: "delete",
}


async def authorize_assignment_access(
    request: Request,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    course_uuid: str,
    access_action: AccessAction,
    token_action: str | None = None,
) -> None:
    """Authorize an assignment operation for either a user session or an API token.

    Sessions keep the existing course-scoped RBAC (``check_resource_access``).
    API tokens are authorized against the single ``assignments`` rights bucket,
    with the organization boundary enforced via the parent course UUID.

    ``token_action`` overrides the rights action checked for tokens when it should
    differ from the session ``access_action`` (e.g. listing per-task submissions
    requires instructor UPDATE for a session but is a ``read`` for a token; an
    authoring token attaches reference files as part of ``create``).
    """
    if isinstance(current_user, APITokenUser):
        action = token_action or _ACCESS_ACTION_TO_TOKEN_ACTION[access_action]
        await authorization_verify_api_token_permissions(
            request,
            current_user,
            action,
            course_uuid,
            db_session,
            resource_type_override="assignments",
        )
        return
    await check_resource_access(request, db_session, current_user, course_uuid, access_action)


async def _is_assignment_instructor(
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    course_uuid: str,
    db_session: AsyncSession,
) -> bool:
    """Whether the principal has instructor-level (grading) authority on the course.

    An API token that has already passed ``authorize_assignment_access`` for the
    ``assignments`` bucket acts with instructor visibility (only org admins can
    mint such tokens). Sessions fall back to the role check.
    """
    if isinstance(current_user, APITokenUser):
        return True
    return await authorization_verify_based_on_roles(
        request, current_user.id, "update", course_uuid, db_session
    )


def _is_assignment_past_due(assignment: Assignment) -> bool:
    """Return True if the assignment has a due_date set and it is in the past.

    due_date is stored as a free-form string. We parse it defensively: if it
    is empty or unparseable, we treat the deadline as NOT set (return False)
    so a malformed value never locks students out. Comparison is done with a
    naive ``datetime.now()`` to match the rest of this module (all timestamps
    here are naive local-time strings produced by ``datetime.now()``).
    """
    raw = getattr(assignment, "due_date", None)
    if not raw or not str(raw).strip():
        return False
    raw_str = str(raw).strip()
    try:
        parsed = datetime.fromisoformat(raw_str)
    except (ValueError, TypeError):
        return False
    if parsed.tzinfo is not None:
        parsed = parsed.replace(tzinfo=None)
    # A date-only deadline (e.g. "2026-06-12", produced by an HTML
    # <input type="date">) parses to midnight. The whole due day should still
    # count as on time, so treat a value with no time component as end-of-day
    # by shifting the cutoff to the following midnight.
    if "T" not in raw_str and ":" not in raw_str:
        parsed = parsed + timedelta(days=1)
    return parsed < datetime.now()


def _strip_answer_key(contents, keep_answer_keys: bool = False):
    """Remove answer-key fields from a task's ``contents`` so students can't read
    the correct answers out of the task GET payload before submitting.

    Grading is server-side, so the client never needs the key. Returns a deep
    copy with the sensitive fields removed per task type:
      - QUIZ:   questions[].options[].assigned_right_answer
      - FORM:   questions[].blanks[].correctAnswer
      - SHORT_ANSWER: correct_answers
      - NUMBER_ANSWER: correct_value (tolerance is harmless without it)
      - CODE:   solution_code, and hidden test cases' stdin/expectedStdout

    ``keep_answer_keys`` is the reveal mode used for a graded student who is
    allowed to see which answers were right (``show_correct_answers``): the
    per-answer keys above are kept, but the CODE reference ``solution_code`` and
    hidden test-case I/O are STILL removed. Those are never appropriate to
    expose to a student — revealing them would hand over the full solution and
    every hidden test, defeating the point of hidden tests entirely.
    """
    if not isinstance(contents, dict):
        return contents
    c = copy.deepcopy(contents)

    # Stamp the resolved quiz response mode onto this COPY before anything is
    # removed. A question authored before `response_type` existed carries no
    # mode, and the client can only infer one from the answer key — which is
    # about to be stripped. Without this the learner would get radio semantics
    # on every legacy select-all-that-apply question. Stored data is untouched;
    # only the outgoing payload gains the field.
    for q in c.get("questions") or []:
        if not isinstance(q, dict) or "response_type" in q:
            continue
        options = q.get("options")
        if isinstance(options, list) and options:
            q["response_type"] = resolve_response_type(q)

    # Always removed — even in reveal mode — because these expose the full
    # solution / hidden grader inputs rather than just "which answer was right".
    c.pop("solution_code", None)
    test_cases = c.get("test_cases")
    if isinstance(test_cases, list):
        for tc in test_cases:
            if isinstance(tc, dict) and tc.get("hidden"):
                tc.pop("stdin", None)
                tc.pop("expectedStdout", None)
                tc.pop("expected_stdout", None)

    if keep_answer_keys:
        return c

    # Full strip (pre-grade, opt-out, or anonymous): also remove the per-answer
    # keys so the correct answers can't be read before submitting.
    c.pop("correct_answers", None)
    c.pop("correct_value", None)
    # `explanation` is reveal-gated content too: the authoring placeholder is
    # "explain why the answer is correct", and both the SHORT_ANSWER and
    # NUMBER_ANSWER student views render it only inside the reveal panel.
    # Leaving it in leaked the answer in prose — readable straight from the
    # tasks GET before submitting, and still visible while retries remain even
    # though correct_value/correct_answers were withheld.
    c.pop("explanation", None)

    questions = c.get("questions")
    if isinstance(questions, list):
        for q in questions:
            if not isinstance(q, dict):
                continue
            # NOTE: `response_type` (single vs multiple response) is deliberately
            # NOT stripped. It is not an answer key — it says how many options
            # may be picked, not which ones — and the learner's UI needs it to
            # render radio vs checkbox semantics. Same for the task-level
            # `grading_mode`. Removing either would silently drop every quiz
            # back to the inferred mode, and the inference reads the answer key
            # that was just stripped.
            for opt in q.get("options") or []:
                if isinstance(opt, dict):
                    opt.pop("assigned_right_answer", None)
            for blank in q.get("blanks") or []:
                if isinstance(blank, dict):
                    blank.pop("correctAnswer", None)

    return c


async def _student_may_see_answer_key(
    current_user, assignment, db_session: AsyncSession
) -> bool:
    """A student may see the answer key only after their own submission is GRADED
    AND the teacher opted into ``show_correct_answers`` — the same gate the
    student UI uses to reveal answers. Everyone else (pre-grade, opt-out,
    anonymous) gets the key stripped."""
    if not getattr(assignment, "show_correct_answers", False):
        return False
    if not isinstance(current_user, PublicUser):
        return False
    sub = (await db_session.execute(
        select(AssignmentUserSubmission).where(
            AssignmentUserSubmission.user_id == current_user.id,
            AssignmentUserSubmission.assignment_id == assignment.id,
        )
    )).scalars().first()
    if not (sub and sub.submission_status == AssignmentUserSubmissionStatus.GRADED):
        return False

    # While the student can still retry, revealing the key is a trivial 100%
    # bypass: read the correct answers now, then hit "Try again" and resubmit
    # them for full marks. Only reveal once no retry attempt remains — i.e.
    # retries are disabled, or the attempt cap has been reached. This mirrors the
    # retry endpoint's own eligibility check (max_retries=0 means unlimited).
    if getattr(assignment, "allow_retries", False):
        max_retries = int(getattr(assignment, "max_retries", 0) or 0)
        attempt = int(getattr(sub, "attempt_number", 1) or 1)
        retries_remain = (max_retries == 0) or (attempt < max_retries)
        if retries_remain:
            return False
    return True


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
            # ReDoS-safe: bound the input/pattern length and enforce a wall-clock
            # timeout so a catastrophic pattern (e.g. "(a+)+$") against a crafted
            # answer can't pin a CPU / block the event loop. Any error or timeout
            # is treated as "no match" and never raised.
            if len(expected) > _REGEX_MAX_LEN or len(trimmed) > _REGEX_MAX_LEN:
                continue
            try:
                if _regex is not None:
                    if _regex.fullmatch(
                        expected, trimmed,
                        flags=_regex.IGNORECASE,
                        timeout=_REGEX_TIMEOUT_SECONDS,
                    ):
                        return True
                elif re.fullmatch(expected, trimmed, re.IGNORECASE):
                    return True
            except Exception:
                # Invalid regex from the teacher, or a match timeout.
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
    cleaned = str(answer_raw).strip()
    if not cleaned:
        return False
    # Disambiguate the comma: thousands separator ("1,000", "1,000,000",
    # "1,000.50") vs a European decimal separator ("3,14"). A blanket
    # ","->"." turned "1,000" into 1.0 and failed "1,000,000" entirely.
    if _THOUSANDS_INT.match(cleaned) or _THOUSANDS_DEC.match(cleaned):
        cleaned = cleaned.replace(",", "")           # comma = thousands grouping
    elif cleaned.count(",") == 1 and "." not in cleaned:
        cleaned = cleaned.replace(",", ".")          # comma = decimal (European)
    elif "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(",", "")           # mixed -> comma = thousands
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
    Grade a quiz task PER QUESTION (not per option).

    Under the default all-or-nothing grading mode a question is correct only
    when the student's selected option set exactly matches the answer key:
    every option the student marked must equal that option's
    ``assigned_right_answer`` (all correct options selected, no incorrect
    option selected).

    Under ``contents["grading_mode"] == "partial_credit"`` a select-all-that-
    apply question instead scores a fraction — see
    ``quiz_modes.score_question``. Single-response questions score 1 or 0 under
    either mode. The task score is
    ``round(sum(question_scores) / total_questions * task_max)``, which reduces
    to the old ``correct_questions / total_questions`` whenever every question
    scores 0 or 1 (i.e. always, in all-or-nothing mode).

    Per-question is the only defensible model: the previous per-option scoring
    gave phantom credit for non-answers (a blank 4-option question still "matched"
    its 3 unselected wrong options -> 75%), so a learner could leave most of an
    exam blank and still clear a high pass bar. Missing submissions are treated
    as "not selected".

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

    grading_mode = resolve_grading_mode(contents)

    total_questions = 0
    earned_score = 0.0
    for question in questions:
        if not isinstance(question, dict):
            continue
        options = [o for o in (question.get("options") or []) if isinstance(o, dict)]
        if not options:
            continue  # a question with no options can't be answered
        # A question whose answer key marks NO option correct can't be auto-scored:
        # under exact-set matching a blank submission would "match" the all-false
        # key and score full credit for doing nothing (a real risk with
        # AI-generated or misconfigured quizzes). Skip it entirely — it neither
        # awards free credit nor unfairly penalizes the student.
        if not any(bool(o.get("assigned_right_answer")) for o in options):
            logger.warning(
                "Quiz question %s has no correct option; skipping from auto-grade",
                question.get("questionUUID", "?"),
            )
            continue
        total_questions += 1
        q_uuid = question.get("questionUUID")
        answers = [
            (
                bool(option.get("assigned_right_answer")),
                answer_by_key.get((q_uuid, option.get("optionUUID")), False),
            )
            for option in options
        ]
        earned_score += score_question(
            answers,
            resolve_response_type(question),
            grading_mode,
        )

    if total_questions == 0 or task_max <= 0:
        return 0
    return round(earned_score / total_questions * task_max)


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
            b_uuid = blank.get("blankUUID")
            correct_value = blank.get("correctAnswer", "")
            # A blank with no configured answer can't be auto-scored: a blank
            # student answer would "match" the empty key and award free credit.
            # Skip it (neither counted nor credited), mirroring the quiz grader.
            if correct_value is None or not str(correct_value).strip():
                continue
            total_blanks += 1
            student_value = answer_by_key.get((q_uuid, b_uuid), "")
            if student_value is None:
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

    Returns an int grade in [0, max_grade_value]. Returns ``None`` when the
    grade can't be trusted — Judge0 isn't configured, or *any* test case
    couldn't actually be executed (transport error, timeout, Judge0 internal
    error, or a submission still queued/processing). In that case the caller
    leaves the submission pending rather than finalizing a bogus 0, so a
    Judge0 outage never zeroes a student out on correct work.
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

    # Judge0 status ids that mean "this test never actually produced a verdict"
    # (infrastructure failure or not-yet-finished), as opposed to a genuine
    # wrong-answer/compile/runtime failure that is the student's fault:
    #   1 = In Queue, 2 = Processing, 13 = Internal Error, 14 = Exec Format Error
    JUDGE0_UNEXECUTED_STATUS_IDS = {1, 2, 13, 14}

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
            # Could-not-execute — signalled as None (distinct from a real fail)
            return (tc, None)
        status = r.get("status") or {}
        status_id = status.get("id")
        if status_id in JUDGE0_UNEXECUTED_STATUS_IDS:
            logger.warning(
                "Judge0 returned non-terminal/internal status %s during CODE "
                "grading for task %s; treating as unexecuted",
                status_id,
                getattr(task, "assignment_task_uuid", "?"),
            )
            return (tc, None)
        actual = _normalize_code_output(r.get("stdout"))
        passed = status_id == 3 and actual == _normalize_code_output(expected)
        return (tc, passed)

    results = await asyncio.gather(*(run_one(tc) for tc in test_cases))

    # If ANY test couldn't be executed, we can't produce a trustworthy grade.
    # Bail with None so the caller leaves the submission pending instead of
    # finalizing a partial/zero score built on tests that never ran.
    if any(passed is None for _, passed in results):
        logger.warning(
            "CODE grading incomplete for task %s (one or more tests unexecuted); "
            "leaving submission pending",
            getattr(task, "assignment_task_uuid", "?"),
        )
        return None

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


def _build_tasks_breakdown(
    assignment_tasks,
    task_submissions_by_task_id: dict,
    passing_threshold: float,
) -> list:
    """
    Build the per-task breakdown array included in grade responses.

    Shared by the grading path (``_apply_grade_and_finalize``) and the read
    path (``get_grade_assignment_submission``) so both sides always agree on
    the numbers. Each row includes the raw grade, the task's max, the
    percentage, and a ``passed`` flag computed against the assignment's
    grading-type-aware passing threshold — that way the student's activity
    view and the teacher's evaluate modal can render consistent pass/fail
    chips without each one re-deriving its own threshold.
    """
    rows = []
    for index, task in enumerate(
        sorted(assignment_tasks, key=lambda t: t.id or 0)
    ):
        ts = task_submissions_by_task_id.get(task.id)
        task_max = int(task.max_grade_value or 0)
        task_raw = int(ts.grade or 0) if ts else 0
        task_percentage = (
            round((task_raw / task_max) * 100.0, 2) if task_max > 0 else 0.0
        )
        task_percentage = max(min(task_percentage, 100.0), 0.0)
        rows.append(
            {
                "index": index + 1,
                "assignment_task_uuid": task.assignment_task_uuid,
                "title": task.title,
                "description": task.description,
                "assignment_type": task.assignment_type,
                "submitted": ts is not None,
                "grade": task_raw,
                "max_grade": task_max,
                "percentage": task_percentage,
                "percentage_display": f"{task_percentage:.0f}%",
                "points_summary": f"{task_raw}/{task_max}",
                "passed": task_percentage >= passing_threshold,
                "feedback": ts.task_submission_grade_feedback if ts else None,
                "manually_graded": bool(ts.manually_graded) if ts else False,
            }
        )
    return rows


def compute_assignment_grade(
    raw_grade: int,
    max_grade: int,
    grading_type: GradingTypeEnum | str | None,
    overall_feedback: str | None = None,
    pass_threshold_percentage: float | None = None,
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

    # Mode-aware passing threshold — keeps `passed` aligned with the display.
    # A per-assignment override (0-100) wins when configured; None falls back to
    # the grading-type default so existing assignments are unchanged.
    if gt_value in ("ALPHABET", "GPA_SCALE"):
        passing_threshold = LETTER_PASSING_THRESHOLD_PERCENTAGE
    else:
        passing_threshold = DEFAULT_PASSING_THRESHOLD_PERCENTAGE
    if pass_threshold_percentage is not None:
        passing_threshold = max(0.0, min(float(pass_threshold_percentage), 100.0))
    passed = percentage >= passing_threshold

    # Secondary formats — always available regardless of grading_type so the
    # UI can render e.g. "B (85/100 · 85%)" without recomputing anything.
    letter_grade = _percentage_to_letter_grade(percentage)
    points_summary = f"{clamped_grade}/{clamped_max} pts"
    percentage_display = f"{percentage:.2f}%"

    # For letter/GPA grades, keep the displayed symbol consistent with `passed`
    # so a custom pass threshold can't show a passing-looking letter to a failing
    # student (or an F to a passing one): the failing symbol appears IFF not
    # passed. With the default threshold this is a no-op (F == below 60%).
    if gt_value == "ALPHABET":
        if not passed:
            display_grade = "F"
        elif letter_grade == "F":
            display_grade = "D"
        else:
            display_grade = letter_grade
    elif gt_value == "PERCENTAGE":
        display_grade = percentage_display
    elif gt_value == "PASS_FAIL":
        display_grade = "Pass" if passed else "Fail"
    elif gt_value == "GPA_SCALE":
        gpa = _percentage_to_gpa(percentage)
        if not passed:
            display_grade = "0.0"
        elif gpa == "0.0":
            display_grade = "1.0"
        else:
            display_grade = gpa
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
    db_session: AsyncSession,
):
    # Check if org exists
    statement = select(Course).where(Course.id == assignment_object.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Usage check
    await check_limits_with_usage("assignments", course.org_id, db_session)

    # Validate the parent activity actually belongs to the authorized course —
    # RBAC only checked the course, so a client-supplied activity_id pointing at
    # another course/org would otherwise create a dangling/cross-course
    # assignment. chapter_id is derived from the activity's own row (not trusted
    # from the body) so it always matches.
    parent_activity = (await db_session.execute(
        select(Activity).where(Activity.id == assignment_object.activity_id)
    )).scalars().first()
    if (
        parent_activity is None
        or parent_activity.course_id != course.id
        or parent_activity.org_id != course.org_id
    ):
        raise HTTPException(
            status_code=400,
            detail="Activity does not belong to the target course",
        )

    # Create Assignment
    assignment = Assignment(**assignment_object.model_dump())

    assignment.assignment_uuid = str(f"assignment_{uuid4()}")
    assignment.creation_date = str(datetime.now())
    assignment.update_date = str(datetime.now())
    assignment.org_id = course.org_id
    assignment.course_id = course.id
    assignment.activity_id = parent_activity.id

    # Insert Assignment in DB
    db_session.add(assignment)
    await db_session.commit()
    await db_session.refresh(assignment)

    # Feature usage
    await increase_feature_usage("assignments", course.org_id, db_session)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def read_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    statement = (
        select(Assignment, Course.course_uuid, Activity.activity_uuid)
        .join(Course, Course.id == Assignment.course_id)  # type: ignore
        .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore
        .where(Assignment.assignment_uuid == assignment_uuid)
    )
    row = (await db_session.execute(statement)).first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    assignment, course_uuid, activity_uuid = row

    await authorize_assignment_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    result = AssignmentRead.model_validate(assignment)
    result.course_uuid = course_uuid
    result.activity_uuid = activity_uuid
    return result


async def read_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    statement = (
        select(Assignment, Course.course_uuid, Activity.activity_uuid)
        .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore
        .join(Course, Course.id == Assignment.course_id)  # type: ignore
        .where(Activity.activity_uuid == activity_uuid)
    )
    row = (await db_session.execute(statement)).first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    assignment, course_uuid, activity_uuid_val = row

    await authorize_assignment_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    result = AssignmentRead.model_validate(assignment)
    result.course_uuid = course_uuid
    result.activity_uuid = activity_uuid_val
    return result


async def update_assignment(
    request: Request,
    assignment_uuid: str,
    assignment_object: AssignmentUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in. Non-None values are applied;
    # additionally allow explicitly clearing pass_threshold_percentage back to
    # NULL (the grading-type default) when the caller sent it as null — otherwise
    # a set threshold could never be removed and would keep over-gating certs.
    #
    # The structural foreign keys are never reassigned here: RBAC above only
    # authorizes the assignment's *current* course, so honoring a client-supplied
    # parent would let an instructor reparent the assignment into another
    # org/course. AssignmentUpdate no longer exposes them; this guard keeps the
    # invariant even if the model regains those fields later.
    IMMUTABLE_FIELDS = frozenset({"org_id", "course_id", "chapter_id", "activity_id"})
    provided = getattr(assignment_object, "model_fields_set", set())
    for var, value in vars(assignment_object).items():
        if var in IMMUTABLE_FIELDS:
            continue
        if value is not None:
            setattr(assignment, var, value)
        elif var == "pass_threshold_percentage" and var in provided:
            setattr(assignment, var, None)
    assignment.update_date = str(datetime.now())

    # Insert Assignment in DB
    db_session.add(assignment)
    await db_session.commit()
    await db_session.refresh(assignment)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def delete_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Feature usage
    await decrease_feature_usage("assignments", course.org_id, db_session)

    # Delete Assignment
    await db_session.delete(assignment)
    await db_session.commit()

    return {"message": "Assignment deleted"}


async def delete_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if activity exists
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)

    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == activity.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.activity_id == activity.id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

     # Feature usage
    await decrease_feature_usage("assignments", course.org_id, db_session)

    # Delete Assignment
    await db_session.delete(assignment)

    await db_session.commit()

    return {"message": "Assignment deleted"}


## > Assignments Tasks CRUD


async def create_assignment_task(
    request: Request,
    assignment_uuid: str,
    assignment_task_object: AssignmentTaskCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

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
    await db_session.commit()
    await db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def read_assignment_tasks(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Find assignments tasks for an assignment, most recently created first
    statement = (
        select(AssignmentTask)
        .where(AssignmentTask.assignment_id == assignment.id)
        .order_by(AssignmentTask.creation_date.desc(), AssignmentTask.id.desc())
    )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Students must not receive the answer key in the task payload. Instructors
    # see everything; a reveal-eligible student (own submission GRADED +
    # show_correct_answers, no retries left) sees the per-answer keys but never
    # the CODE solution or hidden tests; everyone else gets a full strip.
    is_instructor = await _is_assignment_instructor(request, current_user, course.course_uuid, db_session)
    reveal_to_student = (
        not is_instructor
        and await _student_may_see_answer_key(current_user, assignment, db_session)
    )

    result = []
    for assignment_task in (await db_session.execute(statement)).scalars().all():
        read = AssignmentTaskRead.model_validate(assignment_task)
        if not is_instructor:
            read.contents = _strip_answer_key(
                read.contents, keep_answer_keys=reveal_to_student
            )
        result.append(read)
    return result


async def read_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Find assignment
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignmenttask = (await db_session.execute(statement)).scalars().first()

    if not assignmenttask:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignmenttask.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Strip the answer key unless instructor. A reveal-eligible student sees the
    # per-answer keys but never the CODE solution or hidden tests (keep_answer_keys).
    read = AssignmentTaskRead.model_validate(assignmenttask)
    is_instructor = await _is_assignment_instructor(request, current_user, course.course_uuid, db_session)
    if not is_instructor:
        reveal_to_student = await _student_may_see_answer_key(
            current_user, assignment, db_session
        )
        read.contents = _strip_answer_key(
            read.contents, keep_answer_keys=reveal_to_student
        )
    return read


async def put_assignment_task_reference_file(
    request: Request,
    db_session: AsyncSession,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    reference_file: UploadFile | None = None,
):
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check for activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = (await db_session.execute(statement)).scalars().first()

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = (await db_session.execute(org_statement)).scalars().first()

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE, token_action="create")

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
    await db_session.commit()
    await db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def put_assignment_task_submission_file(
    request: Request,
    db_session: AsyncSession,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    sub_file: UploadFile | None = None,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check for activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = (await db_session.execute(statement)).scalars().first()

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = (await db_session.execute(org_statement)).scalars().first()

    # RBAC check - only need read permission to submit files
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Check if user is enrolled in the course
    if not await authorization_verify_based_on_roles(request, current_user.id, "read", course.course_uuid, db_session):
        raise HTTPException(
            status_code=403,
            detail="You must be enrolled in this course to submit files"
        )

    # Enforce the submission deadline for student sessions, matching the
    # task-submission and submit-for-grading write paths (file uploads bypassed
    # it, letting a student attach files after the deadline). Instructors exempt.
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )
    if not is_instructor and _is_assignment_past_due(assignment):
        raise HTTPException(
            status_code=403,
            detail="Assignment deadline has passed",
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
    db_session: AsyncSession,
):
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # A change to how a task is scored (its type, its answer key/definition, or
    # its max points) invalidates the grades already stored for it. The delete
    # path re-grades for exactly this reason; an in-place edit is the same
    # hazard, so detect a scoring-relevant change and re-grade the same way.
    _SCORING_FIELDS = ("assignment_type", "contents", "max_grade_value")
    scoring_changed = any(
        getattr(assignment_task_object, f, None) is not None
        and getattr(assignment_task_object, f) != getattr(assignment_task, f)
        for f in _SCORING_FIELDS
    )

    # Update only the fields that were passed in
    for var, value in vars(assignment_task_object).items():
        if value is not None:
            setattr(assignment_task, var, value)
    assignment_task.update_date = str(datetime.now())

    # Insert Assignment Task in DB
    db_session.add(assignment_task)
    await db_session.commit()
    await db_session.refresh(assignment_task)

    if scoring_changed:
        await _regrade_graded_submissions(
            assignment=assignment,
            course=course,
            db_session=db_session,
            request=request,
        )

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def delete_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment Task
    await db_session.delete(assignment_task)
    await db_session.commit()

    # Already-graded learners keep a frozen `grade` that still includes the
    # points from the task we just removed, while the denominator is recomputed
    # live from the surviving tasks. That desync is real corruption: with
    # 60 + 100 = 160 stored, deleting the 100-point task leaves the read path
    # clamping to "100/100 · A" for someone who actually scored 60/60. Re-run
    # the aggregate for every graded submission so both halves of the fraction
    # come from the same task set. Certificate eligibility reads the same
    # numbers, so leaving them stale could also mis-award a certificate.
    await _regrade_graded_submissions(
        assignment=assignment,
        course=course,
        db_session=db_session,
        request=request,
    )

    return {"message": "Assignment Task deleted"}


async def _reconcile_certificate_after_grade_change(
    request: Request | None,
    user_id: int,
    course: Course,
    db_session: AsyncSession,
) -> None:
    """Bring a learner's certificate back in line with their current grades.

    Recomputing a grade can flip a learner across the passing threshold. If they
    no longer pass every gating assignment, a held certificate is revoked and the
    enrollment status demoted; if they now pass and the course is otherwise
    complete, a certificate is (re)issued. Best-effort: never abort the caller.
    """
    if not course.id:
        return
    try:
        passed = await are_course_assignments_passed(user_id, course.id, db_session)
        if not passed:
            await revoke_user_certificate(
                user_id, course.id, db_session, reason="regraded_below_threshold"
            )
            await sync_trailrun_status(user_id, course.id, db_session)
        elif request is not None:
            # Now passing — re-issue if the course is otherwise complete. Safe to
            # call when a cert already exists (it no-ops on a duplicate).
            await check_course_completion_and_create_certificate(
                request, user_id, course.id, db_session
            )
    except Exception:
        logger.exception(
            "Failed to reconcile certificate for user %s on course %s after a grade change",
            user_id,
            course.id,
        )


async def _regrade_graded_submissions(
    assignment: Assignment,
    course: Course,
    db_session: AsyncSession,
    request: Request | None = None,
) -> None:
    """Recompute stored grades for every GRADED submission of ``assignment``.

    Call after the task set changes, so the persisted numerator stops
    disagreeing with the live denominator. Best-effort per learner: one
    learner's failure must not abort the teacher's edit.

    Recomputing can move a learner across the passing threshold, so each
    regraded learner's certificate is reconciled — revoked if they now fail,
    reissued if they now pass. Pass ``request`` to enable reissue.
    """
    graded = (await db_session.execute(
        select(AssignmentUserSubmission).where(
            AssignmentUserSubmission.assignment_id == assignment.id,
            AssignmentUserSubmission.submission_status
            == AssignmentUserSubmissionStatus.GRADED,
        )
    )).scalars().all()

    for submission in graded:
        if submission.user_id is None:
            continue
        try:
            await _apply_grade_and_finalize(
                assignment=assignment,
                course=course,
                user_id=submission.user_id,
                assignment_user_submission=submission,
                db_session=db_session,
                overall_feedback=None,
                auto_graded=True,
                dispatch_webhook=False,
            )
        except Exception:
            logger.exception(
                "Failed to recompute grade for user %s on assignment %s after a task change",
                submission.user_id,
                assignment.assignment_uuid,
            )
            continue
        await _reconcile_certificate_after_grade_change(
            request, submission.user_id, course, db_session
        )


## > Assignments Tasks Submissions CRUD


async def _resolve_token_submission_user(
    request: Request,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    course,
    on_behalf_of_user_id: int | None,
):
    """Resolve the learner an API token is submitting on behalf of.

    Submit-on-behalf lets a headless/custom frontend write a learner's answer
    via a token. The token must hold ``assignments.create`` and pass an explicit
    ``on_behalf_of_user_id``; the target learner must already be a member of the
    token's organization (learners are referenced by existing LearnHouse id).

    Returns the learner as a ``PublicUser`` to act as, or ``None`` for non-token
    callers (sessions act as themselves).
    """
    if not isinstance(current_user, APITokenUser):
        return None
    if on_behalf_of_user_id is None:
        raise HTTPException(
            status_code=400,
            detail="API tokens must set on_behalf_of_user_id to submit on behalf of a learner",
        )
    # assignments.create gates writing learner submission data + enforces the
    # org boundary via the parent course.
    await authorize_assignment_access(
        request, db_session, current_user, course.course_uuid, AccessAction.CREATE
    )
    from src.security.org_auth import is_org_member

    learner = (
        await db_session.execute(select(User).where(User.id == on_behalf_of_user_id))
    ).scalars().first()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    if not await is_org_member(learner.id, course.org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="Learner is not a member of this organization",
        )
    return PublicUser(**learner.model_dump())


_ASSIGNMENT_TASK_SUBMISSION_MUTABLE_FIELDS = {
    "task_submission",
    "grade",
    "task_submission_grade_feedback",
    "manually_graded",
}


async def handle_assignment_task_submission(
    request: Request,
    assignment_task_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    on_behalf_of_user_id: int | None = None,
):
    assignment_task_submission_uuid = assignment_task_submission_object.assignment_task_submission_uuid
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Resolve who the submission is for. API tokens submit on behalf of a learner
    # (assignments.create + explicit on_behalf_of_user_id); sessions act as self.
    token_submitter = await _resolve_token_submission_user(
        request, db_session, current_user, course, on_behalf_of_user_id
    )
    if token_submitter is not None:
        submitter = token_submitter
        is_instructor = False
        is_token_submit = True
    else:
        _block_api_tokens(current_user)
        submitter = current_user
        # SECURITY: Check if user has instructor/admin permissions for grading
        is_instructor = await authorization_verify_based_on_roles(request, current_user.id, "update", course.course_uuid, db_session)
        is_token_submit = False

    # For non-instructors (session students AND token submit-on-behalf), the call
    # writes a learner ANSWER, never a grade.
    if not is_instructor:
        if not is_token_submit:
            # Session students must be enrolled and within the deadline. A token
            # acting for a learner is an authorized external writer — the custom
            # frontend owns enrollment/deadline, so those gates are skipped.
            if not await authorization_verify_based_on_roles(request, current_user.id, "read", course.course_uuid, db_session):
                raise HTTPException(
                    status_code=403,
                    detail="You must be enrolled in this course to submit assignments"
                )

            if _is_assignment_past_due(assignment):
                raise HTTPException(
                    status_code=403,
                    detail="Assignment deadline has passed",
                )

            # SECURITY: answers are frozen once the attempt has been handed in.
            # Without this, a learner could keep PUTting task answers after
            # SUBMITTED/GRADED. Combined with show_correct_answers (which hands
            # the key over post-grade), they could replay the correct answers and
            # any later re-grade — which re-derives every non-manually-graded task
            # from the CURRENT stored answers — would score the tampered version.
            # Editing an existing attempt in place is exactly what the retry flow
            # exists to prevent; retry deletes the task rows first and re-opens
            # the submission as PENDING.
            existing_user_submission = (await db_session.execute(
                select(AssignmentUserSubmission).where(
                    AssignmentUserSubmission.user_id == current_user.id,
                    AssignmentUserSubmission.assignment_id == assignment.id,
                )
            )).scalars().first()
            if existing_user_submission is not None and (
                existing_user_submission.submission_status
                not in (
                    AssignmentUserSubmissionStatus.PENDING,
                    AssignmentUserSubmissionStatus.NOT_SUBMITTED,
                )
            ):
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "This assignment has already been handed in. "
                        "Use retry to attempt it again."
                    ),
                )

        # SECURITY: answer submissions cannot carry grades - only check if actual values are being set
        if (assignment_task_submission_object.grade is not None and assignment_task_submission_object.grade != 0) or \
           (assignment_task_submission_object.task_submission_grade_feedback is not None and assignment_task_submission_object.task_submission_grade_feedback != ""):
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to update grades"
            )

        assignment_task_submission_object.grade = None
        assignment_task_submission_object.task_submission_grade_feedback = None
        assignment_task_submission_object.assignment_task_id = None
        assignment_task_submission_object.assignment_type = None

        # Neither students nor tokens can flag a submission as manually graded —
        # that's exclusively a teacher action. Also force-clear any prior flag so
        # a new answer invalidates the teacher's earlier manual grade and the
        # task re-enters the server-verified pool on the next grading pass.
        assignment_task_submission_object.manually_graded = False

        if not is_token_submit:
            # Session students need READ on the course; the token was already
            # authorized via assignments.create in _resolve_token_submission_user.
            await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
    else:
        # SECURITY: Instructors/admins need update permission to grade
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    if assignment_task_submission_uuid:
        statement = select(AssignmentTaskSubmission).where(
            AssignmentTaskSubmission.assignment_task_submission_uuid == assignment_task_submission_uuid,
            AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        )
        assignment_task_submission = (await db_session.execute(statement)).scalars().first()
        if not assignment_task_submission:
            raise HTTPException(
                status_code=404,
                detail="Assignment Task Submission not found",
            )
    elif is_instructor and (
        (assignment_task_submission_object.grade is not None
         and assignment_task_submission_object.grade != 0)
        or (assignment_task_submission_object.task_submission_grade_feedback is not None
            and assignment_task_submission_object.task_submission_grade_feedback != "")
    ):
        # An instructor writing a GRADE without naming a target submission has
        # nothing to grade. Falling through to the save-progress lookup below
        # keyed the write on submitter.id — the TEACHER — so grading a task the
        # learner never submitted created a phantom instructor-owned row (scored
        # 0 by the create branch) while the UI reported success and the learner's
        # grade never moved. There is no safe target to guess: fail loudly.
        #
        # An instructor who is also taking their own course saves ANSWERS through
        # this same path with no uuid, and that must keep working. The quiz
        # autosave sends grade=0 and feedback="" on every keystroke, so match the
        # "actual value" test the student branch above uses (grade != 0, feedback
        # != "") — a zeroed placeholder is a save, only a real grade or real
        # feedback is a grading attempt. Every UI grading path always carries a
        # target uuid and is handled by the branch above, so this stays a
        # defense-in-depth guard, never the normal grade route.
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot grade this task: the learner has no submission for it. "
                "A target submission is required to record a grade."
            ),
        )
    else:
        # Save-progress path: without an explicit UUID, update/create the
        # submitter's own submission for this task.
        statement = select(AssignmentTaskSubmission).where(
            AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
            AssignmentTaskSubmission.user_id == submitter.id,
        )
        assignment_task_submission = (await db_session.execute(statement)).scalars().first()

    # If submission exists, update it
    if assignment_task_submission:
        # SECURITY: non-instructors (students / token submit-on-behalf) can only
        # touch the submitter's own submission row.
        if not is_instructor and assignment_task_submission.user_id != submitter.id:
            raise HTTPException(
                status_code=403,
                detail="You can only update your own submissions"
            )

        # Update only the fields that were passed in
        for var, value in vars(assignment_task_submission_object).items():
            if value is not None and var in _ASSIGNMENT_TASK_SUBMISSION_MUTABLE_FIELDS:
                setattr(assignment_task_submission, var, value)
        assignment_task_submission.update_date = str(datetime.now())

        # Insert Assignment Task Submission in DB
        db_session.add(assignment_task_submission)
        await db_session.commit()
        await db_session.refresh(assignment_task_submission)

    else:
        # Create new Task submission
        current_time = str(datetime.now())

        # Assuming model_dump() returns a dictionary
        model_data = assignment_task_submission_object.model_dump()

        assignment_task_submission = AssignmentTaskSubmission(
            assignment_task_submission_uuid=assignment_task_submission_uuid or f"assignmenttasksubmission_{uuid4()}",
            task_submission=model_data["task_submission"],
            # Safe to hardcode: this branch is now reachable only on the learner
            # save-progress path (instructors without a target uuid are rejected
            # above), and learner writes never carry a grade.
            grade=0,  # Always start with 0 for new submissions
            task_submission_grade_feedback="",  # Start with empty feedback
            assignment_task_id=int(assignment_task.id),  # type: ignore
            assignment_type=assignment_task.assignment_type,
            activity_id=assignment.activity_id,
            course_id=assignment.course_id,
            chapter_id=assignment.chapter_id,
            user_id=submitter.id,
            creation_date=current_time,
            update_date=current_time,
        )

        # Insert Assignment Task Submission in DB. On a concurrent save race the
        # unique (user_id, assignment_task_id) constraint rejects the second
        # INSERT — recover by turning it into an update of the existing row.
        db_session.add(assignment_task_submission)
        try:
            await db_session.commit()
            await db_session.refresh(assignment_task_submission)
        except IntegrityError:  # pragma: no cover - concurrent-save race recovery
            # Backed by the unique (user_id, assignment_task_id) constraint
            # (verified in test_submission_uniqueness.py). Only fires under a real
            # DB race, which the aiosqlite harness can't simulate — excluded from
            # coverage; prod asyncpg recovers by turning the INSERT into an update.
            await db_session.rollback()
            existing = (await db_session.execute(
                select(AssignmentTaskSubmission).where(
                    AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
                    AssignmentTaskSubmission.user_id == submitter.id,
                )
            )).scalars().first()
            if existing is None:
                raise
            for var, value in vars(assignment_task_submission_object).items():
                if value is not None and var in _ASSIGNMENT_TASK_SUBMISSION_MUTABLE_FIELDS:
                    setattr(existing, var, value)
            existing.update_date = str(datetime.now())
            db_session.add(existing)
            await db_session.commit()
            await db_session.refresh(existing)
            assignment_task_submission = existing

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_user_assignment_task_submissions(
    request: Request,
    assignment_task_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Ownership check: non-instructors may only read their own submissions
    is_instructor = await _is_assignment_instructor(request, current_user, course.course_uuid, db_session)
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
    assignment_task_submission = (await db_session.execute(statement)).scalars().first()

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
    db_session: AsyncSession,
):
    """Return a map of {assignment_task_uuid: submission | None} for the
    current user across every task in the assignment, in a single round trip.
    Replaces N per-task /submissions/me calls from the activity view."""
    _block_api_tokens(current_user)

    assignment_row = (await db_session.execute(
        select(Assignment, Course.course_uuid)
        .join(Course, Course.id == Assignment.course_id)  # type: ignore
        .where(Assignment.assignment_uuid == assignment_uuid)
    )).first()

    if not assignment_row:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    assignment, course_uuid = assignment_row

    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    rows = (await db_session.execute(
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
    )).all()

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
    db_session: AsyncSession,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

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
    assignment_task_submission = (await db_session.execute(statement)).scalars().first()

    if not assignment_task_submission:
        # Return None instead of raising an error for cases where no submission exists yet
        return None

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

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
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    limit: int = 50,
    offset: int = 0,
):
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid,
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Only instructors may list all submissions for a task
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE, token_action="read")

    # Deterministic total order before limit/offset so pages don't skip or
    # duplicate rows (an unordered LIMIT/OFFSET has no stable row order).
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id
    ).order_by(AssignmentTaskSubmission.id.desc()).limit(limit).offset(offset)
    submissions = (await db_session.execute(statement)).scalars().all()
    return [AssignmentTaskSubmissionRead.model_validate(s) for s in submissions]


async def update_assignment_task_submission(
    request: Request,
    assignment_task_submission_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid
    )
    assignment_task_submission = (await db_session.execute(statement)).scalars().first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )

    if is_instructor:
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    else:
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
        if assignment_task_submission.user_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="You can only update your own submissions",
            )
        assignment_task_submission_object.grade = None
        assignment_task_submission_object.task_submission_grade_feedback = None
        assignment_task_submission_object.assignment_task_id = None
        assignment_task_submission_object.assignment_type = None

    # Update only the fields that were passed in
    for var, value in vars(assignment_task_submission_object).items():
        if value is not None:
            setattr(assignment_task_submission, var, value)
    assignment_task_submission.update_date = str(datetime.now())

    # Insert Assignment Task Submission in DB
    db_session.add(assignment_task_submission)
    await db_session.commit()
    await db_session.refresh(assignment_task_submission)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def delete_assignment_task_submission(
    request: Request,
    assignment_task_submission_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid
    )
    assignment_task_submission = (await db_session.execute(statement)).scalars().first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = (await db_session.execute(statement)).scalars().first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment Task Submission
    deleted_user_id = assignment_task_submission.user_id
    await db_session.delete(assignment_task_submission)
    await db_session.commit()

    # Removing one per-task answer changes the learner's aggregate for this
    # assignment. If their overall submission was already GRADED, its stored
    # grade (and any certificate that depended on it) is now stale — recompute
    # and reconcile, the same as when a whole task is deleted.
    if deleted_user_id is not None:
        graded_submission = (await db_session.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment.id,
                AssignmentUserSubmission.user_id == deleted_user_id,
                AssignmentUserSubmission.submission_status
                == AssignmentUserSubmissionStatus.GRADED,
            )
        )).scalars().first()
        if graded_submission is not None:
            try:
                await _apply_grade_and_finalize(
                    assignment=assignment,
                    course=course,
                    user_id=deleted_user_id,
                    assignment_user_submission=graded_submission,
                    db_session=db_session,
                    overall_feedback=None,
                    auto_graded=True,
                    dispatch_webhook=False,
                )
                await _reconcile_certificate_after_grade_change(
                    request, deleted_user_id, course, db_session
                )
            except Exception:
                logger.exception(
                    "Failed to recompute aggregate for user %s after deleting a task submission",
                    deleted_user_id,
                )

    return {"message": "Assignment Task Submission deleted"}


## > Assignments Submissions CRUD


async def create_assignment_submission(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    on_behalf_of_user_id: int | None = None,
):
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Resolve who is submitting. API tokens submit on behalf of a learner
    # (assignments.create + explicit on_behalf_of_user_id); sessions act as self.
    token_submitter = await _resolve_token_submission_user(
        request, db_session, current_user, course, on_behalf_of_user_id
    )
    if token_submitter is not None:
        submitter = token_submitter
        is_instructor = False
        is_token_submit = True
    else:
        _block_api_tokens(current_user)
        submitter = current_user
        # RBAC check
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
        is_instructor = await authorization_verify_based_on_roles(
            request, current_user.id, "update", course.course_uuid, db_session
        )
        is_token_submit = False

    # Session students are bound by the deadline; a token writing on behalf of a
    # learner is an authorized external writer (the custom frontend owns it).
    if not is_instructor and not is_token_submit and _is_assignment_past_due(assignment):
        raise HTTPException(
            status_code=403,
            detail="Assignment deadline has passed",
        )

    # Check if the submission has already been made. A row in PENDING /
    # NOT_SUBMITTED state means the learner previously hit "Try again":
    # retry_assignment_submission left the row in place so the attempt
    # counter survives, but cleared everything else. Treat that as a
    # fresh-submission slot — flip status to SUBMITTED and reuse the row
    # — instead of erroring out on the existing row.
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id,
        AssignmentUserSubmission.user_id == submitter.id,
    )

    assignment_user_submission = (await db_session.execute(statement)).scalars().first()

    if assignment_user_submission:
        reusable_states = (
            AssignmentUserSubmissionStatus.PENDING,
            AssignmentUserSubmissionStatus.NOT_SUBMITTED,
        )
        if assignment_user_submission.submission_status not in reusable_states:
            raise HTTPException(
                status_code=400,
                detail="Assignment User Submission already exists",
            )

    # Either reuse the existing PENDING row (retry path) or create a fresh
    # submission. On the retry path we keep the original
    # assignmentusersubmission_uuid so external systems that already store a
    # reference don't break. The creation_date IS refreshed to the time of
    # this new attempt — the teacher's submissions list sorts by submitted-at
    # and a stale original date would put a brand-new retry at the bottom
    # next to old submissions.
    if assignment_user_submission:
        assignment_user_submission.submission_status = (
            AssignmentUserSubmissionStatus.SUBMITTED
        )
        assignment_user_submission.grade = 0
        assignment_user_submission.creation_date = str(datetime.now())
        assignment_user_submission.update_date = str(datetime.now())
    else:
        assignment_user_submission = AssignmentUserSubmission(
            user_id=submitter.id,
            assignment_id=assignment.id,  # type: ignore
            grade=0,
            assignmentusersubmission_uuid=str(f"assignmentusersubmission_{uuid4()}"),
            submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
            attempt_number=1,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

    # Insert Assignment User Submission in DB. If a concurrent submit won the
    # race and already created the row (unique (user_id, assignment_id)), recover
    # by adopting the existing row instead of erroring/duplicating.
    db_session.add(assignment_user_submission)
    won_insert = True
    try:
        await db_session.commit()
    except IntegrityError:  # pragma: no cover - concurrent-submit race recovery
        # The unique (user_id, assignment_id) constraint (verified in
        # test_submission_uniqueness.py) is the real guard; this graceful-recovery
        # branch only fires under a genuine DB-level race, which the aiosqlite test
        # harness can't faithfully simulate (raises MissingGreenlet where prod
        # asyncpg recovers), so it is excluded from coverage.
        # This request LOST the race: another concurrent submit already created
        # the row and emitted the ASSIGNMENT_SUBMITTED analytics/webhook events,
        # so this one must adopt the winner's row WITHOUT re-firing them.
        won_insert = False
        await db_session.rollback()
        assignment_user_submission = (await db_session.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment.id,
                AssignmentUserSubmission.user_id == submitter.id,
            )
        )).scalars().first()
        if assignment_user_submission is None:
            raise
        # Ensure the surviving row reflects a submitted state (the concurrent
        # winner may still have been mid-transition).
        if assignment_user_submission.submission_status in (
            AssignmentUserSubmissionStatus.PENDING,
            AssignmentUserSubmissionStatus.NOT_SUBMITTED,
        ):
            assignment_user_submission.submission_status = (
                AssignmentUserSubmissionStatus.SUBMITTED
            )
            assignment_user_submission.update_date = str(datetime.now())
            db_session.add(assignment_user_submission)
            await db_session.commit()

    # Track assignment submission. attempt_number lets downstream consumers
    # (analytics, webhooks) tell a retry resubmit from the original — without
    # it, retries would silently double-count. Skipped when this request lost
    # the concurrent-submit race, so a duplicate submit fires the event once.
    submitted_attempt_number = int(assignment_user_submission.attempt_number or 1)
    if won_insert:
        await track(
            event_name=analytics_events.ASSIGNMENT_SUBMITTED,
            org_id=course.org_id,
            user_id=submitter.id,
            properties={
                "assignment_uuid": assignment_uuid,
                "course_uuid": course.course_uuid,
                "attempt_number": submitted_attempt_number,
            },
        )
        # Durable audit row — retries reset the live submission in place, so each
        # attempt only survives permanently here.
        await record_audit_event(
            event_type=UserAuditEventType.ASSIGNMENT_SUBMITTED,
            user_id=submitter.id,
            org_id=course.org_id,
            target_uuid=assignment_uuid,
            metadata={
                "course_uuid": course.course_uuid,
                "course_name": course.name,
                "attempt_number": submitted_attempt_number,
            },
        )
        await dispatch_webhooks(
            event_name=analytics_events.ASSIGNMENT_SUBMITTED,
            org_id=course.org_id,
            data={
                "user": {"user_uuid": submitter.user_uuid, "email": submitter.email, "username": submitter.username},
                "assignment": {"assignment_uuid": assignment_uuid},
                "course": {"course_uuid": course.course_uuid, "name": course.name},
                "attempt_number": submitted_attempt_number,
            },
        )

    # User (the learner the submission belongs to)
    statement = select(User).where(User.id == submitter.id)
    user = (await db_session.execute(statement)).scalars().first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = (await db_session.execute(statement)).scalars().first()

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
    trailrun = (await db_session.execute(statement)).scalars().first()

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
        await db_session.commit()
        await db_session.refresh(trailrun)

    statement = select(TrailStep).where(
        TrailStep.trailrun_id == trailrun.id,
        TrailStep.activity_id == activity.id,
        TrailStep.user_id == user.id,
    )
    trailstep = (await db_session.execute(statement)).scalars().first()

    # Whether this submission is what completes the activity (a brand-new step,
    # or a step that was incomplete — e.g. after a retry). Used below to fire
    # COURSE_COMPLETED only on a genuine transition, never on a plain resubmit of
    # an already-complete activity.
    is_new_activity_completion = (trailstep is None) or (not trailstep.complete)

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
        await db_session.commit()
        await db_session.refresh(trailstep)
    else:
        # Existing trail step — either from prior progress saves, or because
        # the student just hit "Try again" (the retry endpoint flipped it to
        # incomplete). Re-flip it to complete now that the assignment is
        # back in SUBMITTED state. The first-submission branch above sets
        # complete=True; this keeps the reuse path consistent.
        trailstep.complete = True
        trailstep.update_date = str(datetime.now())
        db_session.add(trailstep)
        await db_session.commit()
        await db_session.refresh(trailstep)

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
        assignment_tasks = (await db_session.execute(tasks_statement)).scalars().all()

        all_auto_gradable = bool(assignment_tasks) and all(
            t.assignment_type in AUTO_GRADABLE_TASK_TYPES for t in assignment_tasks
        )

        if all_auto_gradable:
            await _apply_grade_and_finalize(
                assignment=assignment,
                course=course,
                user_id=int(submitter.id),
                assignment_user_submission=assignment_user_submission,
                db_session=db_session,
                overall_feedback=None,
                auto_graded=True,
                # Reuse the list fetched just above for the auto-gradable check.
                assignment_tasks=assignment_tasks,
            )
            # Ensure trailstep reflects completion (create_assignment_submission
            # above already created it with complete=True, but if one already
            # existed from a previous state we make sure it's marked done).
            trailstep.complete = True
            trailstep.update_date = str(datetime.now())
            db_session.add(trailstep)
            await db_session.commit()

    # Check if all activities in the course are completed and create certificate
    # if so. Wrapped defensively: the submission is already committed above, so a
    # certificate hiccup (race on a duplicate cert, transient DB error) must not
    # 500 the request and make the student think their submission failed — they
    # can always re-trigger the cert check on the next read/grade.
    if course and course.id and user and user.id:
        # One completion check for the whole request. It answers both questions
        # asked below — should a certificate be issued, and did THIS submission
        # finish the course — and is threaded into the certificate helper so it
        # doesn't re-run the same aggregates (nor let sync_trailrun_status run
        # them a third time).
        course_complete = await is_course_fully_completed(user.id, course.id, db_session)
        try:
            await check_course_completion_and_create_certificate(
                request, user.id, course.id, db_session, is_complete=course_complete
            )
        except Exception:  # pragma: no cover - defensive: cert errors never fail submit
            logger.exception(
                "Certificate check failed after assignment submission "
                "(assignment %s, user %s); submission is saved.",
                assignment.assignment_uuid,
                user.id,
            )

        # Fire COURSE_COMPLETED when THIS submission finished the course. Assignment
        # activities don't go through the trail's mark-activity-done flow, so
        # without this the event/analytics never fire when the final activity is an
        # assignment. Gated on a genuine activity-completion transition so a plain
        # resubmit of an already-complete activity doesn't re-fire it.
        if is_new_activity_completion:
            try:
                if course_complete:
                    await track(
                        event_name=analytics_events.COURSE_COMPLETED,
                        org_id=course.org_id,
                        user_id=user.id,
                        properties={"course_uuid": course.course_uuid},
                    )
                    await dispatch_webhooks(
                        event_name=analytics_events.COURSE_COMPLETED,
                        org_id=course.org_id,
                        data={
                            "user": {
                                "user_uuid": user.user_uuid,
                                "email": user.email,
                                "username": user.username,
                            },
                            "course": {
                                "course_uuid": course.course_uuid,
                                "name": course.name,
                            },
                        },
                    )
            except Exception:  # pragma: no cover - defensive: dispatch errors never fail submit
                logger.exception(
                    "COURSE_COMPLETED dispatch failed after assignment submission "
                    "(assignment %s, user %s); submission is saved.",
                    assignment.assignment_uuid,
                    user.id,
                )

    # return assignment user submission read
    return AssignmentUserSubmissionRead.model_validate(assignment_user_submission)


async def read_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    limit: int = 50,
    offset: int = 0,
):
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Check if user has instructor/admin privileges on this course
    is_instructor = await _is_assignment_instructor(request, current_user, course.course_uuid, db_session)

    # Non-instructors can only see their own submissions
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id
    )
    if not is_instructor:
        statement = statement.where(
            AssignmentUserSubmission.user_id == current_user.id
        )

    # Stable total order so paginated results don't skip/duplicate rows.
    statement = statement.order_by(AssignmentUserSubmission.id.desc()).limit(limit).offset(offset)

    # Compute the assignment-level max_grade once so every row can render a
    # formatted display_grade (e.g. "A", "85/100") rather than just the raw
    # integer sum from AssignmentUserSubmission.grade. Without this the
    # submissions list shows "80" while the evaluate modal and the student's
    # own view show "B" / "80/100" — three places, three formats.
    tasks_statement = select(AssignmentTask).where(
        AssignmentTask.assignment_id == assignment.id
    )
    assignment_tasks = (await db_session.execute(tasks_statement)).scalars().all()
    max_grade = sum(int(t.max_grade_value or 0) for t in assignment_tasks)

    submissions = (await db_session.execute(statement)).scalars().all()

    # Per-task breakdown for the whole page in ONE query, keyed by (user, task).
    # The analytics "task difficulty" chart reads grade_display.tasks, but this
    # endpoint never populated it — only the single-submission endpoints did —
    # so that chart rendered its empty state for every assignment ever shipped.
    # Batched deliberately: a per-row query here would be N+1 over the page.
    task_ids = [t.id for t in assignment_tasks if t.id is not None]
    user_ids = [s.user_id for s in submissions if s.user_id is not None]
    submissions_by_user_task: dict = {}
    if task_ids and user_ids:
        task_sub_rows = (await db_session.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
                AssignmentTaskSubmission.user_id.in_(user_ids),  # type: ignore[attr-defined]
            )
        )).scalars().all()
        for ts in task_sub_rows:
            submissions_by_user_task.setdefault(ts.user_id, {})[ts.assignment_task_id] = ts

    results = []
    for sub in submissions:
        row = AssignmentUserSubmissionRead.model_validate(sub).model_dump()
        if sub.submission_status == AssignmentUserSubmissionStatus.GRADED:
            grade_display = compute_assignment_grade(
                int(sub.grade or 0),
                max_grade,
                assignment.grading_type,
                pass_threshold_percentage=assignment.pass_threshold_percentage,
            )
            # Reuse the threshold compute_assignment_grade already resolved so
            # the per-task `passed` flags agree with the overall verdict.
            grade_display["tasks"] = _build_tasks_breakdown(
                assignment_tasks,
                submissions_by_user_task.get(sub.user_id, {}),
                grade_display["passing_threshold"],
            )
            row["grade_display"] = grade_display
        else:
            row["grade_display"] = None
        results.append(row)
    return results


async def read_user_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Ownership check: non-instructors may only read their own submissions
    is_instructor = await _is_assignment_instructor(request, current_user, course.course_uuid, db_session)
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
        for assignment_user_submission in (await db_session.execute(statement)).scalars().all()
    ]


async def read_user_assignment_submissions_me(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
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
    user_id: int,
    assignment_uuid: str,
    assignment_user_submission_object: AssignmentUserSubmissionCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if assignment user submission exists (scoped to this specific assignment)
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = (await db_session.execute(statement)).scalars().first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if user is an instructor/admin (has UPDATE permission)
    is_instructor = await _is_assignment_instructor(request, current_user, course.course_uuid, db_session)

    if is_instructor:
        # Instructors/admins can update any submission (e.g., for grading)
        await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    else:
        # Regular users need READ access and can only update their own submissions
        await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
        if str(assignment_user_submission.user_id) != str(current_user.id):
            raise HTTPException(
                status_code=403,
                detail="You can only update your own submissions",
            )
        # Students may not touch the grade or status either.
        for protected_field in ("grade", "submission_status"):
            if hasattr(assignment_user_submission_object, protected_field):
                setattr(assignment_user_submission_object, protected_field, None)

    # The row's identity (which user, which assignment) is fixed by the lookup
    # keys above — never let the request body reassign them. Left writable, an
    # instructor (or student) could reparent the submission onto another
    # assignment/org (assignment ids are global integers) or onto another user.
    for identity_field in ("user_id", "assignment_id"):
        if hasattr(assignment_user_submission_object, identity_field):
            setattr(assignment_user_submission_object, identity_field, None)

    # Update only the fields that were passed in
    for var, value in vars(assignment_user_submission_object).items():
        if value is not None:
            setattr(assignment_user_submission, var, value)
    assignment_user_submission.update_date = str(datetime.now())

    # Insert Assignment User Submission in DB
    db_session.add(assignment_user_submission)
    await db_session.commit()
    await db_session.refresh(assignment_user_submission)

    # return assignment user submission read
    return AssignmentUserSubmissionRead.model_validate(assignment_user_submission)


async def delete_assignment_submission(
    request: Request,
    user_id: int,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

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
    assignment_user_submission = (await db_session.execute(statement)).scalars().first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Rejecting a submission means the student is no longer "done" with this
    # activity — reset the TrailStep so the activity is no longer complete,
    # clear the teacher-verification flag, and drop any stored grade string.
    # Leave the per-task AssignmentTaskSubmission rows intact so the student
    # keeps the work they did and can edit + resubmit rather than starting
    # from scratch.
    trailstep_statement = select(TrailStep).where(
        TrailStep.activity_id == assignment.activity_id,
        TrailStep.user_id == user_id,
    )
    trailstep = (await db_session.execute(trailstep_statement)).scalars().first()
    if trailstep:
        trailstep.complete = False
        trailstep.teacher_verified = False
        trailstep.grade = ""
        trailstep.update_date = str(datetime.now())
        db_session.add(trailstep)

    # Delete Assignment User Submission (so the student can create a new one)
    await db_session.delete(assignment_user_submission)
    await db_session.commit()

    # If a course certificate was already issued to this user (the activity was
    # previously counted as complete and this was the final one), revoke it — the
    # student can't hold a certificate while a gating assignment is rejected. A
    # new certificate is re-issued automatically once the rework is accepted.
    # revoke_user_certificate emits a certificate_revoked event so consumers
    # learn it's no longer valid.
    if course.id:
        await revoke_user_certificate(
            user_id, course.id, db_session, reason="assignment_rejected"
        )
        # The activity is no longer complete — demote the enrollment status so
        # analytics/enrollment stop reporting this learner as "completed".
        await sync_trailrun_status(user_id, course.id, db_session)

    return {"message": "Assignment User Submission deleted"}


async def retry_assignment_submission(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    """
    Reset the current user's submission for ``assignment_uuid`` so they can
    attempt it again. The teacher must have opted in via ``allow_retries``;
    we additionally bound the number of retries with ``max_retries`` (0
    means unlimited).

    On retry we keep the AssignmentUserSubmission row in place so the
    attempt counter survives. Everything else is wiped: per-task
    submissions are deleted, the row is flipped to PENDING with grade=0,
    the matching TrailStep is reset to incomplete, and any issued course
    certificate is revoked. The student then re-fills the tasks and
    submits again, at which point ``create_assignment_submission``
    transitions the existing PENDING row to SUBMITTED.
    """
    _block_api_tokens(current_user)

    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()
    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    if not assignment.allow_retries:
        raise HTTPException(
            status_code=403,
            detail="Retries are not enabled for this assignment",
        )

    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()
    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Only READ permission is required: the student is rescheduling their
    # own work, not editing the assignment configuration.
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Row-level lock on the user's submission so two concurrent retries can't
    # both read attempt_number=N, pass the cap check, and increment to N+1 —
    # which would let students sneak past max_retries on a double-click. The
    # lock is released on commit/rollback at the end of the function.
    # SQLite (used in tests) ignores FOR UPDATE and falls back to its own
    # locking, which is single-writer anyway.
    statement = (
        select(AssignmentUserSubmission)
        .where(
            AssignmentUserSubmission.user_id == current_user.id,
            AssignmentUserSubmission.assignment_id == assignment.id,
        )
        .with_for_update()
    )
    assignment_user_submission = (await db_session.execute(statement)).scalars().first()
    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Only graded submissions are eligible to be retried. Retrying a row
    # that is still SUBMITTED would silently throw away the student's
    # pending work before the teacher even sees it.
    if assignment_user_submission.submission_status != AssignmentUserSubmissionStatus.GRADED:
        raise HTTPException(
            status_code=400,
            detail="Only graded submissions can be retried",
        )

    # Retry is destructive and irreversible: it deletes every task submission,
    # zeroes the grade, reopens the trail step, revokes the certificate and
    # demotes the enrollment. Past the deadline the student cannot resubmit —
    # every write path 403s — so allowing it here destroyed graded work with no
    # way back. Every other learner write is deadline-gated (file upload, task
    # submission, submit-for-grading); this one was the sole gap.
    if _is_assignment_past_due(assignment) and not await _is_assignment_instructor(
        request, current_user, course.course_uuid, db_session
    ):
        raise HTTPException(
            status_code=403,
            detail="Assignment deadline has passed",
        )

    # Enforce the attempt cap. max_retries=0 means unlimited; otherwise the
    # current attempt_number must be strictly less than max_retries so the
    # increment below stays within bounds.
    current_attempt = int(assignment_user_submission.attempt_number or 1)
    max_attempts = int(assignment.max_retries or 0)
    if max_attempts and current_attempt >= max_attempts:
        raise HTTPException(
            status_code=403,
            detail="No retry attempts remaining",
        )

    # Wipe per-task submissions so the student starts the next attempt with
    # an empty slate. Without this the prior answers stay on screen and the
    # auto-grader would just re-grade the existing work.
    task_ids_statement = select(AssignmentTask.id).where(
        AssignmentTask.assignment_id == assignment.id
    )
    task_ids = [tid for tid in (await db_session.execute(task_ids_statement)).scalars().all() if tid is not None]
    if task_ids:
        existing_submissions = (await db_session.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == current_user.id,
                AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
            )
        )).scalars().all()
        for ts in existing_submissions:
            await db_session.delete(ts)

    # Mark the activity incomplete again so the student's progress bar
    # reflects the in-flight retry rather than the (now stale) previous
    # completion.
    trailstep_statement = select(TrailStep).where(
        TrailStep.activity_id == assignment.activity_id,
        TrailStep.user_id == int(current_user.id),
    )
    trailstep = (await db_session.execute(trailstep_statement)).scalars().first()
    if trailstep:
        trailstep.complete = False
        trailstep.teacher_verified = False
        trailstep.grade = ""
        trailstep.update_date = str(datetime.now())
        db_session.add(trailstep)

    # Reset the submission row in place. Keeping the same uuid means
    # downstream consumers (analytics, webhooks) don't see a "new"
    # submission appear; the attempt_number is the canonical signal that
    # this is the next attempt.
    assignment_user_submission.submission_status = AssignmentUserSubmissionStatus.PENDING
    assignment_user_submission.grade = 0
    assignment_user_submission.overall_feedback = None
    assignment_user_submission.attempt_number = current_attempt + 1
    assignment_user_submission.update_date = str(datetime.now())
    db_session.add(assignment_user_submission)

    await db_session.commit()
    await db_session.refresh(assignment_user_submission)

    # Revoke any course certificate previously issued. If this assignment was the
    # final activity, a new certificate is re-issued once the retry attempt is
    # graded and the course is again fully complete. Emits certificate_revoked.
    if course.id:
        await revoke_user_certificate(
            int(current_user.id), course.id, db_session, reason="assignment_retried"
        )

    # The activity is reset to incomplete for this attempt — demote the
    # enrollment status so a retrying learner isn't still counted as completed.
    if course.id:
        await sync_trailrun_status(int(current_user.id), course.id, db_session)

    return {
        "message": "Assignment User Submission reset for retry",
        "attempt_number": assignment_user_submission.attempt_number,
        "max_retries": max_attempts,
        "submission": AssignmentUserSubmissionRead.model_validate(
            assignment_user_submission
        ).model_dump(),
    }


## > Assignments Submissions Grading


async def _apply_grade_and_finalize(
    assignment: Assignment,
    course: Course,
    user_id: int,
    assignment_user_submission: AssignmentUserSubmission,
    db_session: AsyncSession,
    overall_feedback: str | None = None,
    auto_graded: bool = False,
    dispatch_webhook: bool = True,
    assignment_tasks: Sequence[AssignmentTask] | None = None,
) -> dict:
    """
    Core grading logic shared by manual and auto-grade flows. Computes the
    final grade from existing per-task submissions, persists it with status
    GRADED, dispatches the webhook, and returns the enriched grade dict
    (including per-task breakdown).

    ``dispatch_webhook=False`` is for bulk recomputation (e.g. after a teacher
    deletes a task) where the grade is being corrected rather than newly
    awarded — firing ``assignment_graded`` once per enrolled learner on an
    admin edit would be a webhook storm, and integrations would read it as a
    fresh grading event.

    IMPORTANT: This helper does NO permission checks. Callers must enforce
    access control before calling it. It exists so that both the teacher's
    manual grading endpoint (UPDATE permission) and the student's auto-grade
    path (READ permission, self-grading under teacher-configured auto_grading)
    can share one implementation.
    """
    # Compute max_grade from the current task configuration. The auto-grade
    # path has already loaded this exact list to decide whether every task is
    # auto-gradable, so it hands it over rather than paying for the same query
    # twice inside one submit request.
    if assignment_tasks is None:
        tasks_statement = select(AssignmentTask).where(
            AssignmentTask.assignment_id == assignment.id
        )
        assignment_tasks = (await db_session.execute(tasks_statement)).scalars().all()
    max_grade = 0
    for task in assignment_tasks:
        max_grade += int(task.max_grade_value or 0)

    # Load this user's per-task submissions (keyed by task_id so we can build
    # both the sum and the per-task breakdown).
    task_ids = [task.id for task in assignment_tasks if task.id is not None]
    task_submissions_by_task_id: dict = {}
    if task_ids:
        ts_statement = select(AssignmentTaskSubmission).where(
            AssignmentTaskSubmission.user_id == user_id,
            AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
        )
        for ts in (await db_session.execute(ts_statement)).scalars().all():
            task_submissions_by_task_id[ts.assignment_task_id] = ts

    # Server-side re-verification for task types where we don't trust the
    # client's computed grade (SHORT_ANSWER, NUMBER_ANSWER, QUIZ, FORM, CODE).
    # If the verified grade differs from what the client submitted, overwrite
    # it so tampering is caught and future reads see the correct number.
    #
    # Tasks that a teacher has manually graded (``manually_graded``) are skipped
    # so the deliberate override is not clobbered by the auto-grader — e.g. a
    # teacher awarding credit for a short-answer the exact matcher would mark
    # wrong. This is the per-task replacement for the old whole-pass
    # ``auto_graded`` gate: non-manual tasks are still re-verified even when a
    # teacher is grading the submission, while manual overrides always win.
    # When a CODE task can't be server-verified (Judge0 down/unconfigured), the
    # grader returns None. In that case we must NOT finalize an auto-graded
    # submission — doing so would stamp a bogus 0 on a learner whose code may be
    # correct. We track it here and leave the submission SUBMITTED (pending) for
    # a later re-grade instead. Manual grading (auto_graded=False) is unaffected:
    # the teacher is deliberately grading, so we keep existing per-task grades.
    code_unverifiable = False
    for task in assignment_tasks:
        ts = task_submissions_by_task_id.get(task.id)
        if ts is not None and ts.manually_graded:
            continue
        verified = await _server_verified_task_grade(task, ts)
        if (
            verified is None
            and ts is not None
            and task.assignment_type == AssignmentTaskTypeEnum.CODE
        ):
            code_unverifiable = True
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

    # Auto-grade + an unverifiable CODE task → don't finalize. Persist any
    # re-verified sibling grades, keep the submission SUBMITTED, and skip the
    # GRADED transition + graded webhook so completion/cert stay withheld until
    # the CODE task can actually be graded (Judge0 recovers, or a teacher grades
    # it manually). Returns finalized=False so callers know it stayed pending.
    if auto_graded and code_unverifiable:
        db_session.add(assignment_user_submission)
        await db_session.commit()
        await db_session.refresh(assignment_user_submission)
        logger.warning(
            "Auto-grade deferred for assignment %s user %s: a CODE task could "
            "not be server-verified; submission left SUBMITTED (pending grade).",
            assignment.assignment_uuid,
            user_id,
        )
        return {"finalized": False, "reason": "code_unverifiable"}

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
        pass_threshold_percentage=assignment.pass_threshold_percentage,
    )

    computed["tasks"] = _build_tasks_breakdown(
        assignment_tasks,
        task_submissions_by_task_id,
        computed["passing_threshold"],
    )

    # Persist the clamped raw grade + flip status to GRADED in a single commit
    assignment_user_submission.grade = computed["grade"]
    assignment_user_submission.submission_status = AssignmentUserSubmissionStatus.GRADED
    db_session.add(assignment_user_submission)
    await db_session.commit()
    await db_session.refresh(assignment_user_submission)

    # Durable audit row for the grade the STUDENT received. This is the single
    # grading choke point (both manual and auto paths), and retries reset the
    # live submission grade in place — so this permanent row is the only record
    # that survives a resubmit. Always recorded, independent of webhook dispatch.
    await record_audit_event(
        event_type=UserAuditEventType.ASSIGNMENT_GRADED,
        user_id=user_id,
        org_id=course.org_id,
        target_uuid=assignment.assignment_uuid,
        metadata={
            "course_uuid": course.course_uuid,
            "course_name": course.name,
            "grade": computed["grade"],
            "max_grade": computed["max_grade"],
            "percentage": computed["percentage"],
            "display_grade": computed["display_grade"],
            "letter_grade": computed["letter_grade"],
            "passed": computed["passed"],
            "attempt_number": int(assignment_user_submission.attempt_number or 1),
            "auto_graded": auto_graded,
        },
    )

    if dispatch_webhook:
        await dispatch_webhooks(
            event_name="assignment_graded",
            org_id=course.org_id,
            data={
                "user_id": user_id,
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
    user_id: int,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    overall_feedback: str | None = None,
):
    # SECURITY: This function should only be accessible by course owners or instructors
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Require course ownership or instructor role for grading
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = (await db_session.execute(statement)).scalars().first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # A PENDING row is a retry in flight: the previous task submissions have
    # been deleted and the learner has not handed anything in yet. Grading it
    # sums an empty set, writes 0, flips the row to GRADED and fires the graded
    # webhook — after which the learner's resubmit 400s (only PENDING /
    # NOT_SUBMITTED are resubmittable), permanently at the retry cap. The retry
    # path has the mirror guard ("Only graded submissions can be retried"); this
    # side was missing it. The submissions list rendering PENDING as "Submitted"
    # made hitting this easy.
    if assignment_user_submission.submission_status in (
        AssignmentUserSubmissionStatus.PENDING,
        AssignmentUserSubmissionStatus.NOT_SUBMITTED,
    ):
        raise HTTPException(
            status_code=400,
            detail="This learner has not handed in an attempt yet — nothing to grade.",
        )

    computed = await _apply_grade_and_finalize(
        assignment=assignment,
        course=course,
        user_id=user_id,
        assignment_user_submission=assignment_user_submission,
        db_session=db_session,
        overall_feedback=overall_feedback,
        auto_graded=False,
    )

    # Grading this submission may have made the course fully passed (e.g. the
    # teacher just graded the last outstanding assignment). The activities are
    # already complete, so no other trigger would fire — re-run the certificate
    # check here so a now-eligible learner is certified. No-ops when the course
    # has no certification, isn't complete, or an assignment still isn't passed.
    if course.id:
        try:
            await check_course_completion_and_create_certificate(
                request, user_id, course.id, db_session
            )
            # Conversely, a regrade DOWN below the pass threshold must pull a
            # previously issued certificate — the create path only ever adds one,
            # so without this a learner keeps a valid certificate after failing a
            # gating assignment on re-grade. No-op when they still pass or hold none.
            if not await are_course_assignments_passed(user_id, course.id, db_session):
                await revoke_user_certificate(
                    user_id, course.id, db_session, reason="regraded_below_threshold"
                )
        except Exception:
            pass

    return {
        "message": f"Assignment User Submission graded: {computed['display_grade']}",
        **computed,
    }


async def get_grade_assignment_submission(
    request: Request,
    user_id: int,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Ownership check: non-instructors may only read their own grade
    is_instructor = await _is_assignment_instructor(request, current_user, course.course_uuid, db_session)
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
    assignment_user_submission = (await db_session.execute(statement)).scalars().first()

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
    assignment_tasks = (await db_session.execute(tasks_statement)).scalars().all()
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
            AssignmentTaskSubmission.user_id == user_id,
            AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
        )
        for ts in (await db_session.execute(ts_statement)).scalars().all():
            task_submissions_by_task_id[ts.assignment_task_id] = ts

    grade_obj = compute_assignment_grade(
        int(assignment_user_submission.grade or 0),
        max_grade,
        assignment.grading_type,
        overall_feedback=assignment_user_submission.overall_feedback,
        pass_threshold_percentage=assignment.pass_threshold_percentage,
    )
    grade_obj["tasks"] = _build_tasks_breakdown(
        assignment_tasks,
        task_submissions_by_task_id,
        grade_obj["passing_threshold"],
    )
    return grade_obj


async def mark_activity_as_done_for_user(
    request: Request,
    user_id: int,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    _block_api_tokens(current_user)
    # SECURITY: This function should only be accessible by course owners or instructors
    # Get Assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = (await db_session.execute(statement)).scalars().first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if activity exists
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = (await db_session.execute(statement)).scalars().first()

    statement = select(Course).where(Course.id == assignment.course_id)
    course = (await db_session.execute(statement)).scalars().first()

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
    user = (await db_session.execute(statement)).scalars().first()

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
    trailstep = (await db_session.execute(trailsteps)).scalars().first()

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
    await db_session.commit()
    await db_session.refresh(trailstep)

    # Check if all activities in the course are completed and create certificate if so
    if course and course.id:
        await check_course_completion_and_create_certificate(
            request, user_id, course.id, db_session
        )

    # return OK
    return {"message": "Activity marked as done for user"}


async def get_assignments_from_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
):
    # Find course
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await authorize_assignment_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Get Assignments. Unpublished (draft) assignments are instructor-only:
    # `Assignment.published` was never consulted anywhere, so this endpoint
    # enumerated every draft to anyone with course READ, and the tasks endpoint
    # then handed over next week's exam questions. Answer keys are stripped
    # separately, so this is unreleased-content exposure rather than key
    # exposure — but the parent Activity's `published` flag is what hides drafts
    # in navigation, and these direct endpoints bypassed it.
    statement = select(Assignment).where(Assignment.course_id == course.id)
    if not await _is_assignment_instructor(request, current_user, course.course_uuid, db_session):
        statement = statement.where(Assignment.published == True)  # noqa: E712
    assignments = (await db_session.execute(statement)).scalars().all()

    # return assignments read
    return [AssignmentRead.model_validate(assignment) for assignment in assignments]
