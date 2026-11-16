"""Assignment tools: assignments, their tasks, submissions and grading.

Every tool resolves its uuids in the connected organization first (refs),
then calls the assignment services in-process with ``ctx.request`` /
``ctx.user`` / ``ctx.db_session`` so their own checks stay authoritative:
course RBAC, the learner activity gate, answer-key stripping, the
instructor-only submission views and the API-token ``assignments`` bucket.

Tasks are written in a small typed shape (a quiz is questions with options
marked correct, a short answer is accepted answers, ...). The tools turn it
into the exact ``contents`` the web editors and the server graders use and
generate the question, option, blank and test ids, keeping the existing ids
by position when a task is edited so stored answers still line up.

An assignment always comes with a TYPE_ASSIGNMENT activity in its chapter
(what learners open). Creating one creates both; deleting one deletes both,
like the course editor does.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Annotated, Any, Literal, Union
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityCreate, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignment_ai_grades import AssignmentAIGrade
from src.db.courses.assignments import (
    MAX_AI_GRADING_INSTRUCTIONS_CHARS,
    AIGradingModeEnum,
    Assignment,
    AssignmentCreate,
    AssignmentTask,
    AssignmentTaskCreate,
    AssignmentTaskSubmission,
    AssignmentTaskSubmissionUpdate,
    AssignmentTaskTypeEnum,
    AssignmentTaskUpdate,
    AssignmentUpdate,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.users import APITokenUser
from src.security.features_utils.usage import check_limits_with_usage
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.learners import iso, member_refs
from src.services.courses.activities.activities import create_activity, delete_activity
from src.services.courses.activities.assignments import (
    _is_assignment_instructor,
    authorize_assignment_access,
    compute_assignment_grade,
    create_assignment,
    create_assignment_task,
    delete_assignment,
    delete_assignment_task,
    get_assignments_from_course,
    grade_assignment_submission,
    handle_assignment_task_submission,
    read_assignment,
    read_assignment_from_activity_uuid,
    read_assignment_tasks,
    read_user_assignment_submissions,
    update_assignment,
    update_assignment_task,
)
from src.services.courses.activities.quiz_modes import (
    GRADING_MODE_ALL_OR_NOTHING,
    GRADING_MODE_PARTIAL_CREDIT,
    RESPONSE_TYPE_MULTIPLE,
    RESPONSE_TYPE_SINGLE,
    resolve_grading_mode,
    resolve_response_type,
)

MAX_TASKS_PER_CREATE = 30
CUSTOM_DATA_MAX_CHARS = 20_000

# A group containing + or * (or {n,}) that is itself followed by a repeat.
_NESTED_QUANTIFIER = re.compile(r"\((?:[^()\\]|\\.)*(?:[+*]|\{\d*,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d*,\d*\})")

GradingType = Literal["alphabet", "numeric", "percentage", "pass_fail", "gpa_scale"]
AIGradingMode = Literal["off", "suggest", "auto"]
_AI_FIELDS = {"ai_grading_mode": "AI grading mode", "ai_grading_instructions": "AI grading rubric"}
# What list_submissions says about each learner's latest AI grading run.
_AI_GRADE_STATE = {"DRAFT": "draft", "APPLIED": "applied", "FAILED": "failed"}
SubmissionStatus = Literal["needs_grading", "pending", "submitted", "late", "graded", "not_submitted"]

_STATUS_FILTER = {
    "needs_grading": (AssignmentUserSubmissionStatus.SUBMITTED, AssignmentUserSubmissionStatus.LATE),
    "pending": (AssignmentUserSubmissionStatus.PENDING,),
    "submitted": (AssignmentUserSubmissionStatus.SUBMITTED,),
    "late": (AssignmentUserSubmissionStatus.LATE,),
    "graded": (AssignmentUserSubmissionStatus.GRADED,),
    "not_submitted": (AssignmentUserSubmissionStatus.NOT_SUBMITTED,),
}

_TYPE_OF = {
    "quiz": AssignmentTaskTypeEnum.QUIZ,
    "form": AssignmentTaskTypeEnum.FORM,
    "code": AssignmentTaskTypeEnum.CODE,
    "short_answer": AssignmentTaskTypeEnum.SHORT_ANSWER,
    "number_answer": AssignmentTaskTypeEnum.NUMBER_ANSWER,
    "file_submission": AssignmentTaskTypeEnum.FILE_SUBMISSION,
    "custom": AssignmentTaskTypeEnum.CUSTOM,
}


def _low(value: Any) -> str | None:
    if value is None:
        return None
    return (value.value if hasattr(value, "value") else str(value)).lower()


def _check_due_date(value: str | None) -> str | None:
    """ISO date or date-time; "" (on updates) clears the deadline."""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return ""
    try:
        datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(
            "due_date must be an ISO 8601 date like 2026-12-31 or a date-time like 2026-12-31T17:00"
        )
    return text


# ─── task shapes ─────────────────────────────────────────────────────────────


class QuizOption(BaseModel):
    text: str = Field(..., min_length=1, max_length=500, description="Option text.")
    correct: bool = Field(False, description="Whether this option is a right answer.")


class QuizQuestion(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000, description="Question text.")
    options: list[QuizOption] = Field(
        ..., min_length=2, max_length=10, description="2 to 10 options; mark at least one correct."
    )
    response_type: Literal["single", "multiple"] | None = Field(
        None,
        description="single: pick one; multiple: select all that apply. Omit to infer from the answer key.",
    )

    @model_validator(mode="after")
    def _answer_key(self):
        correct = sum(1 for o in self.options if o.correct)
        if correct == 0:
            raise ValueError(f"question '{self.text[:60]}' has no option marked correct")
        if self.response_type == "single" and correct > 1:
            raise ValueError(
                f"question '{self.text[:60]}' is single response but marks {correct} options correct"
            )
        return self


class FormBlank(BaseModel):
    answer: str = Field(..., min_length=1, max_length=200, description="The expected text (case-insensitive).")
    placeholder: str = Field("", max_length=200, description="Placeholder shown in the blank.")
    hint: str | None = Field(None, max_length=500, description="Optional hint for this blank.")


class FormQuestion(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000, description="Question or sentence with blanks.")
    blanks: list[FormBlank] = Field(..., min_length=1, max_length=20, description="Blanks to fill.")


class CodeTest(BaseModel):
    label: str | None = Field(None, max_length=100, description="Short test name.")
    stdin: str = Field("", max_length=10_000, description="Input fed to the program.")
    expected_output: str = Field(..., max_length=10_000, description="Expected stdout (trailing whitespace ignored).")
    hidden: bool = Field(False, description="Hide this test's input and output from learners.")
    weight: int = Field(1, ge=1, le=100, description="Weight when grading_mode is custom_weights.")


class QuizContent(BaseModel):
    type: Literal["quiz"]
    questions: list[QuizQuestion] = Field(..., min_length=1, max_length=50, description="Quiz questions.")
    partial_credit: bool = Field(
        False, description="Give partial credit on select-all-that-apply questions."
    )


class ShortAnswerContent(BaseModel):
    type: Literal["short_answer"]
    prompt: str = Field(..., min_length=1, max_length=2000, description="The question learners answer.")
    accepted_answers: list[str] = Field(
        ..., min_length=1, max_length=20, description="Answers graded as correct."
    )
    match_mode: Literal["case_insensitive", "exact", "contains", "regex"] = Field(
        "case_insensitive", description="How an answer is compared with the accepted ones."
    )
    explanation: str | None = Field(None, max_length=2000, description="Shown after grading when answers are revealed.")

    @field_validator("accepted_answers")
    @classmethod
    def _answers(cls, value: list[str]) -> list[str]:
        cleaned = [a.strip() for a in value if a and a.strip()]
        if not cleaned:
            raise ValueError("give at least one non-empty accepted answer")
        if any(len(a) > 1000 for a in cleaned):
            raise ValueError("accepted answers are at most 1000 characters")
        return cleaned

    @model_validator(mode="after")
    def _regex(self):
        if self.match_mode == "regex":
            for pattern in self.accepted_answers:
                try:
                    re.compile(pattern)
                except re.error as e:
                    raise ValueError(f"accepted answer '{pattern[:60]}' is not a valid regex: {e}")
                # A repeated group that repeats inside, like (a+)+, can take
                # seconds per answer to grade; there is always a simpler way.
                if _NESTED_QUANTIFIER.search(pattern):
                    raise ValueError(
                        f"accepted answer '{pattern[:60]}' repeats a group that already repeats "
                        "(like (a+)+); write it without the outer repeat"
                    )
        return self


class NumberAnswerContent(BaseModel):
    type: Literal["number_answer"]
    prompt: str = Field(..., min_length=1, max_length=2000, description="The question learners answer.")
    correct_value: float = Field(..., allow_inf_nan=False, description="The right number.")
    tolerance: float = Field(0, ge=0, allow_inf_nan=False, description="Accepted plus or minus range.")
    unit: str | None = Field(None, max_length=30, description="Unit shown next to the input, e.g. kg.")
    explanation: str | None = Field(None, max_length=2000, description="Shown after grading when answers are revealed.")


class FormContent(BaseModel):
    type: Literal["form"]
    questions: list[FormQuestion] = Field(..., min_length=1, max_length=50, description="Fill-in-the-blank questions.")


class FileSubmissionContent(BaseModel):
    type: Literal["file_submission"]


class CodeContent(BaseModel):
    type: Literal["code"]
    language_id: int = Field(
        71, ge=1, le=1000, description="Judge0 language id (71 Python 3, 63 JavaScript, 62 Java, 54 C++)."
    )
    starter_code: str = Field("", max_length=20_000, description="Code learners start from.")
    solution_code: str = Field("", max_length=20_000, description="Reference solution, never shown to learners.")
    grading_mode: Literal["equal_weight", "binary", "custom_weights"] = Field(
        "equal_weight", description="equal_weight: share of tests passed; binary: all or nothing."
    )
    tests: list[CodeTest] = Field(..., min_length=1, max_length=30, description="Test cases.")
    allow_student_run: bool = Field(True, description="Let learners run the visible tests before submitting.")


class CustomContent(BaseModel):
    type: Literal["custom"]
    data: dict = Field(
        default_factory=dict,
        description="Free-form task definition for a custom frontend; graded by hand.",
    )

    @field_validator("data")
    @classmethod
    def _size(cls, value: dict) -> dict:
        if len(json.dumps(value, default=str)) > CUSTOM_DATA_MAX_CHARS:
            raise ValueError(f"data is at most {CUSTOM_DATA_MAX_CHARS} characters of JSON")
        return value


class _TaskCommon(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="Task title.")
    description: str = Field("", max_length=4000, description="Instructions shown with the task.")
    hint: str = Field("", max_length=1000, description="Optional hint for learners.")
    points: int = Field(100, ge=0, le=1000, description="Maximum points for this task.")


class QuizTask(_TaskCommon, QuizContent):
    pass


class ShortAnswerTask(_TaskCommon, ShortAnswerContent):
    pass


class NumberAnswerTask(_TaskCommon, NumberAnswerContent):
    pass


class FormTask(_TaskCommon, FormContent):
    pass


class FileSubmissionTask(_TaskCommon, FileSubmissionContent):
    pass


class CodeTask(_TaskCommon, CodeContent):
    pass


class CustomTask(_TaskCommon, CustomContent):
    pass


TaskContent = Annotated[
    Union[
        QuizContent,
        ShortAnswerContent,
        NumberAnswerContent,
        FormContent,
        FileSubmissionContent,
        CodeContent,
        CustomContent,
    ],
    Field(discriminator="type"),
]
TaskSpec = Annotated[
    Union[QuizTask, ShortAnswerTask, NumberAnswerTask, FormTask, FileSubmissionTask, CodeTask, CustomTask],
    Field(discriminator="type"),
]


def _at(items: Any, index: int) -> dict:
    if isinstance(items, list) and index < len(items) and isinstance(items[index], dict):
        return items[index]
    return {}


def _storage_contents(content: BaseModel, previous: dict | None = None) -> dict:
    """The stored ``contents`` for a typed task. Ids of the previous contents
    are kept by position so answers already stored still match."""
    prev = previous if isinstance(previous, dict) else {}
    if isinstance(content, QuizContent):
        questions = []
        for qi, q in enumerate(content.questions):
            old_q = _at(prev.get("questions"), qi)
            options = []
            for oi, o in enumerate(q.options):
                old_o = _at(old_q.get("options"), oi)
                options.append(
                    {
                        "optionUUID": old_o.get("optionUUID") or f"option_{uuid4()}",
                        "text": o.text,
                        "fileID": "",
                        "type": "text",
                        "assigned_right_answer": bool(o.correct),
                    }
                )
            correct = sum(1 for o in q.options if o.correct)
            response = q.response_type or (RESPONSE_TYPE_MULTIPLE if correct > 1 else RESPONSE_TYPE_SINGLE)
            questions.append(
                {
                    "questionUUID": old_q.get("questionUUID") or f"question_{uuid4()}",
                    "questionText": q.text,
                    "response_type": response,
                    "options": options,
                }
            )
        mode = GRADING_MODE_PARTIAL_CREDIT if content.partial_credit else GRADING_MODE_ALL_OR_NOTHING
        return {"questions": questions, "grading_mode": mode}
    if isinstance(content, FormContent):
        questions = []
        for qi, q in enumerate(content.questions):
            old_q = _at(prev.get("questions"), qi)
            blanks = []
            for bi, b in enumerate(q.blanks):
                old_b = _at(old_q.get("blanks"), bi)
                blank = {
                    "blankUUID": old_b.get("blankUUID") or f"blank_{uuid4()}",
                    "placeholder": b.placeholder,
                    "correctAnswer": b.answer,
                }
                if b.hint:
                    blank["hint"] = b.hint
                blanks.append(blank)
            questions.append(
                {
                    "questionUUID": old_q.get("questionUUID") or f"question_{uuid4()}",
                    "questionText": q.text,
                    "blanks": blanks,
                }
            )
        return {"questions": questions}
    if isinstance(content, ShortAnswerContent):
        out = {
            "prompt": content.prompt,
            "correct_answers": content.accepted_answers,
            "match_mode": content.match_mode,
        }
        if content.explanation:
            out["explanation"] = content.explanation
        return out
    if isinstance(content, NumberAnswerContent):
        out = {
            "prompt": content.prompt,
            "correct_value": content.correct_value,
            "tolerance": content.tolerance,
        }
        if content.unit:
            out["unit"] = content.unit
        if content.explanation:
            out["explanation"] = content.explanation
        return out
    if isinstance(content, CodeContent):
        tests = []
        for ti, t in enumerate(content.tests):
            old_t = _at(prev.get("test_cases"), ti)
            tests.append(
                {
                    "id": old_t.get("id") or f"tc_{uuid4()}",
                    "label": t.label or f"Test {ti + 1}",
                    "stdin": t.stdin,
                    "expectedStdout": t.expected_output,
                    "hidden": t.hidden,
                    "weight": t.weight,
                }
            )
        return {
            "language_id": content.language_id,
            "starter_code": content.starter_code,
            "solution_code": content.solution_code,
            "grading_mode": content.grading_mode,
            "test_cases": tests,
            "allow_student_run": content.allow_student_run,
            "show_test_details_on_fail": True,
            "show_hidden_test_count": True,
            "require_passing_to_submit": False,
        }
    if isinstance(content, CustomContent):
        return dict(content.data)
    return {}  # file submission: instructions live in the description


def _simple_contents(task_type: AssignmentTaskTypeEnum, contents: Any, with_keys: bool) -> dict:
    """Stored ``contents`` back in the typed shape; answer keys only when
    ``with_keys`` (people who can edit the assignment)."""
    c = contents if isinstance(contents, dict) else {}
    clip = results.clip
    if task_type == AssignmentTaskTypeEnum.QUIZ:
        questions = []
        for q in c.get("questions") or []:
            if not isinstance(q, dict):
                continue
            options = []
            for o in q.get("options") or []:
                if not isinstance(o, dict):
                    continue
                option = {"text": clip(o.get("text") or "")}
                if with_keys:
                    option["correct"] = bool(o.get("assigned_right_answer"))
                options.append(option)
            questions.append(
                {
                    "text": clip(q.get("questionText") or "", results.DETAIL_TEXT),
                    "response_type": resolve_response_type(q),
                    "options": options,
                }
            )
        return {"questions": questions, "partial_credit": resolve_grading_mode(c) == GRADING_MODE_PARTIAL_CREDIT}
    if task_type == AssignmentTaskTypeEnum.FORM:
        questions = []
        for q in c.get("questions") or []:
            if not isinstance(q, dict):
                continue
            blanks = []
            for b in q.get("blanks") or []:
                if not isinstance(b, dict):
                    continue
                blank = {"placeholder": b.get("placeholder") or ""}
                if b.get("hint"):
                    blank["hint"] = clip(b["hint"])
                if with_keys:
                    blank["answer"] = b.get("correctAnswer")
                blanks.append(blank)
            questions.append({"text": clip(q.get("questionText") or "", results.DETAIL_TEXT), "blanks": blanks})
        return {"questions": questions}
    if task_type == AssignmentTaskTypeEnum.SHORT_ANSWER:
        out = {"prompt": clip(c.get("prompt") or "", results.DETAIL_TEXT), "match_mode": c.get("match_mode") or "case_insensitive"}
        if with_keys:
            out["accepted_answers"] = [clip(a) for a in c.get("correct_answers") or [] if isinstance(a, str)]
            if c.get("explanation"):
                out["explanation"] = clip(c["explanation"], results.DETAIL_TEXT)
        return out
    if task_type == AssignmentTaskTypeEnum.NUMBER_ANSWER:
        out = {"prompt": clip(c.get("prompt") or "", results.DETAIL_TEXT)}
        if c.get("unit"):
            out["unit"] = c["unit"]
        if with_keys:
            out["correct_value"] = c.get("correct_value")
            out["tolerance"] = c.get("tolerance") or 0
            if c.get("explanation"):
                out["explanation"] = clip(c["explanation"], results.DETAIL_TEXT)
        return out
    if task_type == AssignmentTaskTypeEnum.CODE:
        tests = []
        for t in c.get("test_cases") or []:
            if not isinstance(t, dict):
                continue
            test = {"label": t.get("label"), "hidden": bool(t.get("hidden")), "weight": t.get("weight") or 1}
            if with_keys or not t.get("hidden"):
                test["stdin"] = clip(t.get("stdin") or "")
                test["expected_output"] = clip(t.get("expectedStdout") or t.get("expected_stdout") or "")
            tests.append(test)
        out = {
            "language_id": c.get("language_id"),
            "starter_code": clip(c.get("starter_code") or "", results.DETAIL_TEXT),
            "grading_mode": c.get("grading_mode") or "equal_weight",
            "tests": tests,
        }
        if with_keys and c.get("solution_code"):
            out["solution_code"] = clip(c["solution_code"], results.DETAIL_TEXT)
        return out
    if task_type in (AssignmentTaskTypeEnum.CUSTOM, AssignmentTaskTypeEnum.OTHER):
        text = json.dumps(c, default=str)
        if len(text) > results.DETAIL_TEXT:
            return {"data_preview": clip(text, results.DETAIL_TEXT), "truncated": True}
        return {"data": c}
    return {}


# ─── lookups ─────────────────────────────────────────────────────────────────


async def _course_of(ctx: ToolContext, assignment: Assignment) -> Course:
    course = await ctx.db_session.get(Course, assignment.course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="The assignment's course no longer exists.")
    return course


async def _tasks_of(ctx: ToolContext, assignment_id: int) -> list[AssignmentTask]:
    return list(
        (
            await ctx.db_session.execute(
                select(AssignmentTask)
                .where(AssignmentTask.assignment_id == assignment_id)
                .order_by(AssignmentTask.order.asc().nulls_last(), AssignmentTask.id.asc())  # type: ignore[union-attr]
            )
        ).scalars().all()
    )


async def _by_id(ctx: ToolContext, model: Any, ids: set[int]) -> dict[int, Any]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    rows = (await ctx.db_session.execute(select(model).where(model.id.in_(ids)))).scalars().all()
    return {r.id: r for r in rows}


async def _instructor(ctx: ToolContext, course: Course) -> bool:
    return await _is_assignment_instructor(ctx.request, ctx.user, course.course_uuid, ctx.db_session)


async def _assignment_url(ctx: ToolContext, assignment_uuid: str, course: Course | None, activity: Activity | None, instructor: bool) -> str | None:
    """Instructors get the grading page, learners the activity they open."""
    if instructor:
        return await refs.web_url(ctx, "assignment", assignment=assignment_uuid)
    if course is not None and activity is not None:
        return await refs.web_url(ctx, "activity", course=course.course_uuid, activity=activity.activity_uuid)
    return None


async def _pointers(ctx: ToolContext, course: Course | None, chapter: Chapter | None, activity: Activity | None) -> dict:
    out = {}
    if course is not None:
        out["course"] = refs.ref(
            "course", course.course_uuid, course.name, await refs.web_url(ctx, "course", course=course.course_uuid)
        )
    if chapter is not None:
        out["chapter"] = refs.ref("chapter", chapter.chapter_uuid, chapter.name)
    if activity is not None and course is not None:
        out["activity"] = refs.ref(
            "activity",
            activity.activity_uuid,
            activity.name,
            await refs.web_url(ctx, "activity", course=course.course_uuid, activity=activity.activity_uuid),
        )
    return out


async def _submission_counts(ctx: ToolContext, assignment_ids: list[int]) -> dict[int, dict]:
    if not assignment_ids:
        return {}
    rows = (
        await ctx.db_session.execute(
            select(
                AssignmentUserSubmission.assignment_id,
                AssignmentUserSubmission.submission_status,
                func.count(AssignmentUserSubmission.id),
            )
            .where(AssignmentUserSubmission.assignment_id.in_(assignment_ids))  # type: ignore[attr-defined]
            .group_by(AssignmentUserSubmission.assignment_id, AssignmentUserSubmission.submission_status)
        )
    ).all()
    out: dict[int, dict] = {}
    for assignment_id, status, count in rows:
        out.setdefault(assignment_id, {})[_low(status)] = count
    return out


async def _task_counts(ctx: ToolContext, assignment_ids: list[int]) -> dict[int, int]:
    if not assignment_ids:
        return {}
    rows = (
        await ctx.db_session.execute(
            select(AssignmentTask.assignment_id, func.count(AssignmentTask.id))
            .where(AssignmentTask.assignment_id.in_(assignment_ids))  # type: ignore[attr-defined]
            .group_by(AssignmentTask.assignment_id)
        )
    ).all()
    return {row[0]: row[1] for row in rows}


def _task_ref(task: Any) -> dict:
    return refs.ref("assignment_task", task.assignment_task_uuid, task.title)


def _grade_view(computed: dict) -> dict:
    return {
        "display": computed["display_grade"],
        "points": computed["points_summary"],
        "percentage": computed["percentage"],
        "passed": computed["passed"],
    }


# ─── params ──────────────────────────────────────────────────────────────────


class ListAssignmentsParams(results.Paging):
    course_uuid: str | None = Field(
        None, max_length=100, description="Only this course's assignments; omit for every course you can see."
    )


class GetAssignmentParams(BaseModel):
    assignment_uuid: str | None = Field(None, max_length=100, description="The assignment.")
    activity_uuid: str | None = Field(
        None, max_length=100, description="Or the assignment's activity, from a course structure."
    )
    include_task_contents: bool = Field(
        False,
        description="Also return each task's questions and settings (answer keys only for people who can edit).",
    )

    @model_validator(mode="after")
    def _one_target(self):
        if bool(self.assignment_uuid) == bool(self.activity_uuid):
            raise ValueError("pass exactly one of assignment_uuid or activity_uuid")
        return self


class CreateAssignmentParams(BaseModel):
    chapter_uuid: str = Field(..., max_length=100, description="The chapter to add the assignment to.")
    title: str = Field(..., min_length=1, max_length=200, description="Assignment title.")
    description: str = Field("", max_length=4000, description="Instructions shown to learners.")
    due_date: str | None = Field(
        None, max_length=40, description="ISO date (2026-12-31) or date-time; omit for no deadline."
    )
    grading_type: GradingType = Field("percentage", description="How the final grade is shown.")
    auto_grading: bool = Field(
        False, description="Grade on submit when every task can be graded automatically (no files, no custom)."
    )
    allow_retries: bool = Field(False, description="Let learners try again after grading.")
    max_retries: int = Field(0, ge=0, le=100, description="Maximum attempts when retries are allowed; 0 means unlimited.")
    show_correct_answers: bool = Field(False, description="Reveal answer keys to learners once graded.")

    @field_validator("due_date")
    @classmethod
    def _due(cls, value: str | None) -> str | None:
        return _check_due_date(value) or None


class UpdateAssignmentParams(BaseModel):
    assignment_uuid: str = Field(..., max_length=100, description="The assignment to change.")
    title: str | None = Field(None, min_length=1, max_length=200, description="New title.")
    description: str | None = Field(None, max_length=4000, description="New instructions.")
    due_date: str | None = Field(
        None, max_length=40, description="New ISO date or date-time; an empty string removes the deadline."
    )
    grading_type: GradingType | None = Field(None, description="How the final grade is shown.")
    auto_grading: bool | None = Field(
        None,
        description=(
            "Answer-key grading (quiz and choice tasks) on submit when every task has an answer key. "
            "Not AI grading: that is ai_grading_mode."
        ),
    )
    allow_retries: bool | None = Field(None, description="Let learners try again after grading.")
    max_retries: int | None = Field(None, ge=0, le=100, description="Maximum attempts; 0 means unlimited.")
    show_correct_answers: bool | None = Field(None, description="Reveal answer keys to learners once graded.")
    published: bool | None = Field(
        None, description="Publish (true) or unpublish (false) the assignment and its activity for learners."
    )
    ai_grading_mode: AIGradingMode | None = Field(
        None,
        description=(
            "AI grading: off; suggest (a teacher asks for AI drafts and reviews them, nothing runs "
            "on its own); auto (every hand-in is graded by AI and the grade applied, spending AI credits)."
        ),
    )
    ai_grading_instructions: str | None = Field(
        None,
        max_length=MAX_AI_GRADING_INSTRUCTIONS_CHARS,
        description=(
            "The private rubric the AI grader follows: what earns full, partial or no credit. Only "
            "teachers see it; never put a rubric in description, which learners read. An empty "
            "string removes it."
        ),
    )

    @field_validator("due_date")
    @classmethod
    def _due(cls, value: str | None) -> str | None:
        return _check_due_date(value)

    def changes(self) -> dict:
        return self.model_dump(exclude={"assignment_uuid"}, exclude_none=True)


class AssignmentRefParams(BaseModel):
    assignment_uuid: str = Field(..., max_length=100, description="The assignment.")


class CreateAssignmentTasksParams(BaseModel):
    assignment_uuid: str = Field(..., max_length=100, description="The assignment to add the tasks to.")
    tasks: list[TaskSpec] = Field(
        ...,
        min_length=1,
        max_length=MAX_TASKS_PER_CREATE,
        description="Tasks to add at the end, in order; each one's type picks its fields.",
    )


class UpdateAssignmentTaskParams(BaseModel):
    assignment_task_uuid: str = Field(..., max_length=100, description="The task to change.")
    title: str | None = Field(None, min_length=1, max_length=200, description="New title.")
    description: str | None = Field(None, max_length=4000, description="New instructions.")
    hint: str | None = Field(None, max_length=1000, description="New hint.")
    points: int | None = Field(None, ge=0, le=1000, description="New maximum points.")
    content: TaskContent | None = Field(
        None,
        description=(
            "Full replacement of the task's questions or settings, typed like create_assignment_tasks. "
            "Ids are kept by position, so edit in place rather than reorder."
        ),
    )

    def changes(self) -> list[str]:
        return list(self.model_dump(exclude={"assignment_task_uuid"}, exclude_none=True))


class AssignmentTaskRefParams(BaseModel):
    assignment_task_uuid: str = Field(..., max_length=100, description="The task.")


class ListSubmissionsParams(results.Paging):
    assignment_uuid: str = Field(..., max_length=100, description="The assignment.")
    status: SubmissionStatus | None = Field(
        None, description="Only this status; needs_grading is submitted or late and not graded yet."
    )


class GetSubmissionParams(BaseModel):
    assignment_uuid: str = Field(..., max_length=100, description="The assignment.")
    user_uuid: str = Field(..., max_length=100, description="The learner whose work to read.")


class TaskGrade(BaseModel):
    assignment_task_uuid: str = Field(..., max_length=100, description="The task being graded.")
    grade: int = Field(..., ge=0, le=1000, description="Points for this task, up to its maximum.")
    feedback: str | None = Field(None, max_length=2000, description="Feedback on this task.")


class GradeSubmissionParams(BaseModel):
    assignment_uuid: str = Field(..., max_length=100, description="The assignment.")
    user_uuid: str = Field(..., max_length=100, description="The learner being graded.")
    task_grades: list[TaskGrade] = Field(
        default_factory=list, max_length=50, description="Per-task points to set by hand."
    )
    feedback: str | None = Field(
        None, max_length=4000, description="Overall feedback, saved when the grade is finalized."
    )
    finalize: bool = Field(
        True,
        description="Compute the final grade from the task grades and mark the submission graded.",
    )

    @model_validator(mode="after")
    def _something_to_do(self):
        if not self.finalize and not self.task_grades:
            raise ValueError("nothing to do: pass task_grades, or finalize=true")
        if not self.finalize and self.feedback is not None:
            raise ValueError("overall feedback is saved when finalizing; set finalize=true")
        uuids = [t.assignment_task_uuid for t in self.task_grades]
        if len(uuids) != len(set(uuids)):
            raise ValueError("each task can be graded once per call")
        return self


def _grade_summary(p: GradeSubmissionParams) -> str:
    """Names the learner and the points, so the approver sees what is given."""
    points = ", ".join(f"{t.grade} pts on task {t.assignment_task_uuid}" for t in p.task_grades[:10])
    if len(p.task_grades) > 10:
        points += f" and {len(p.task_grades) - 10} more"
    who = f"learner {p.user_uuid} on {p.assignment_uuid}"
    if not p.finalize:
        return f"Set draft task grades for {who}: {points} (not finalized)"
    out = f"Finalize the grade of {who}: " + (points or "computed from the stored task grades")
    if p.feedback:
        out += f'; feedback "{results.clip(p.feedback, 120)}"'
    return out


# ─── executors: assignments ─────────────────────────────────────────────────


async def _list_assignments(ctx: ToolContext, p: ListAssignmentsParams):
    offset = results.offset_of(p.cursor)
    if p.course_uuid:
        courses = [await refs.load(ctx, "course", p.course_uuid)]
    else:
        courses = (
            await ctx.db_session.execute(
                select(Course)
                .where(
                    Course.org_id == ctx.org.id,
                    Course.id.in_(select(Assignment.course_id).where(Assignment.org_id == ctx.org.id)),  # type: ignore[union-attr]
                )
                .order_by(Course.id)
            )
        ).scalars().all()

    # Walk courses until the page is full; every course goes through the
    # service, which applies course RBAC and hides drafts from learners.
    need = offset + p.limit + 1
    found: list[tuple[Course, Any, bool]] = []
    for course in courses:
        try:
            rows = await get_assignments_from_course(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
        except HTTPException as e:
            if p.course_uuid or e.status_code not in (401, 403, 404):
                raise
            continue
        instructor = await _instructor(ctx, course) if rows else False
        found.extend((course, row, instructor) for row in sorted(rows, key=lambda r: r.id))
        if len(found) >= need:
            break

    chunk = found[offset : offset + p.limit]
    ids = [row.id for _, row, _ in chunk]
    chapters = await _by_id(ctx, Chapter, {row.chapter_id for _, row, _ in chunk})
    activities = await _by_id(ctx, Activity, {row.activity_id for _, row, _ in chunk})
    task_counts = await _task_counts(ctx, ids)
    counts = await _submission_counts(ctx, [row.id for _, row, i in chunk if i])

    items = []
    for course, row, instructor in chunk:
        activity = activities.get(row.activity_id)
        item = refs.ref(
            "assignment",
            row.assignment_uuid,
            row.title,
            await _assignment_url(ctx, row.assignment_uuid, course, activity, instructor),
        )
        item.update(await _pointers(ctx, course, chapters.get(row.chapter_id), None))
        item.update(
            {
                "due_date": row.due_date or None,
                "published": bool(row.published),
                "grading_type": "ungraded" if row.ungraded else _low(row.grading_type),
                "tasks_count": task_counts.get(row.id, 0),
            }
        )
        if instructor:
            item["submissions"] = counts.get(row.id, {})
        items.append(item)

    has_more = len(found) > offset + p.limit
    total = len(found) if p.course_uuid else None
    return results.page(items, offset=offset, limit=p.limit, total=total, has_more=has_more)


async def _get_assignment(ctx: ToolContext, p: GetAssignmentParams):
    if p.assignment_uuid:
        await refs.load(ctx, "assignment", p.assignment_uuid)
        read = await read_assignment(ctx.request, p.assignment_uuid, ctx.user, ctx.db_session)
    else:
        await refs.load(ctx, "activity", p.activity_uuid)
        read = await read_assignment_from_activity_uuid(ctx.request, p.activity_uuid, ctx.user, ctx.db_session)

    assignment = await ctx.db_session.get(Assignment, read.id)
    course = await _course_of(ctx, assignment)
    instructor = await _instructor(ctx, course)
    chapter = await ctx.db_session.get(Chapter, assignment.chapter_id)
    activity = await ctx.db_session.get(Activity, assignment.activity_id)
    # The service strips answer keys for learners; with_keys only re-checks.
    tasks = await read_assignment_tasks(ctx.request, read.assignment_uuid, ctx.user, ctx.db_session)

    out = refs.ref(
        "assignment",
        read.assignment_uuid,
        read.title,
        await _assignment_url(ctx, read.assignment_uuid, course, activity, instructor),
    )
    out.update(await _pointers(ctx, course, chapter, activity))
    out.update(
        {
            "description": read.description,
            "due_date": read.due_date or None,
            "published": bool(read.published),
            "graded": not read.ungraded,
            "grading_type": _low(read.grading_type),
            "auto_grading": bool(read.auto_grading),
            "allow_retries": bool(read.allow_retries),
            "max_retries": read.max_retries or 0,
            "show_correct_answers": bool(read.show_correct_answers),
            "pass_threshold_percentage": read.pass_threshold_percentage,
            "has_solution": bool(read.has_solution),
            "total_points": sum(int(t.max_grade_value or 0) for t in tasks),
        }
    )
    if instructor:
        # Teacher-only: the private rubric is never shown to learners.
        out["ai_grading"] = {
            "mode": _low(assignment.ai_grading_mode) or "suggest",
            "rubric": results.clip(assignment.ai_grading_instructions or None, results.DETAIL_TEXT),
        }
    results.clip_field(out, "description")
    task_items = []
    for task in tasks:
        item = {
            "task": _task_ref(task),
            "type": _low(task.assignment_type),
            "points": task.max_grade_value,
        }
        if task.description:
            item["description"] = task.description
            # The full instructions when asked for contents, a preview otherwise.
            results.clip_field(item, "description", 4000 if p.include_task_contents else results.LIST_TEXT)
        if p.include_task_contents:
            item["content"] = _simple_contents(task.assignment_type, task.contents, with_keys=instructor)
        task_items.append(item)
    out["tasks"] = task_items
    if instructor:
        out["submissions"] = (await _submission_counts(ctx, [assignment.id])).get(assignment.id, {})
    return out


async def _create_assignment(ctx: ToolContext, p: CreateAssignmentParams):
    chapter = await refs.load(ctx, "chapter", p.chapter_uuid)
    # Plan limit before anything is written: the service checks it only
    # after the activity exists, which used to leave an orphan activity.
    await check_limits_with_usage("assignments", ctx.org.id, ctx.db_session)

    activity = await create_activity(
        ctx.request,
        ActivityCreate(
            name=p.title,
            chapter_id=chapter.id,
            activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
            published=False,
        ),
        ctx.user,
        ctx.db_session,
    )
    try:
        created = await create_assignment(
            ctx.request,
            AssignmentCreate(
                title=p.title,
                description=p.description,
                due_date=p.due_date,
                published=False,
                grading_type=GradingTypeEnum(p.grading_type.upper()),
                auto_grading=p.auto_grading,
                show_correct_answers=p.show_correct_answers,
                allow_retries=p.allow_retries,
                max_retries=p.max_retries if p.allow_retries else 0,
                org_id=activity.org_id,
                course_id=activity.course_id,
                chapter_id=chapter.id,
                activity_id=activity.id,
            ),
            ctx.user,
            ctx.db_session,
        )
    except Exception:
        # Keep the pair together: no assignment, no activity.
        try:
            await delete_activity(ctx.request, activity.activity_uuid, ctx.user, ctx.db_session)
        except Exception:  # pragma: no cover - best effort cleanup
            pass
        raise

    course = await ctx.db_session.get(Course, activity.course_id)
    url = await refs.web_url(ctx, "assignment", assignment=created.assignment_uuid)
    return results.changed(
        f'Created assignment "{created.title}" (unpublished). Add its tasks with create_assignment_tasks.',
        assignment=refs.ref("assignment", created.assignment_uuid, created.title, url),
        activity=refs.ref(
            "activity",
            activity.activity_uuid,
            activity.name,
            await refs.web_url(ctx, "activity", course=course.course_uuid, activity=activity.activity_uuid)
            if course
            else None,
        ),
        url=url,
    )


def _task_create(spec: Any) -> AssignmentTaskCreate:
    return AssignmentTaskCreate(
        title=spec.title,
        description=spec.description,
        hint=spec.hint,
        assignment_type=_TYPE_OF[spec.type],
        contents=_storage_contents(spec),
        max_grade_value=spec.points,
    )


async def _update_assignment(ctx: ToolContext, p: UpdateAssignmentParams):
    assignment = await refs.load(ctx, "assignment", p.assignment_uuid)
    changes = p.changes()
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    if p.published is not None:
        course = await ctx.db_session.get(Course, assignment.course_id)
        if course is None or course.published:
            # Learners of a live course see it at once; in a draft course nobody does.
            require_approval(ctx, "Changes what learners of a published course see")
    patch = dict(changes)
    if "grading_type" in patch:
        patch["grading_type"] = GradingTypeEnum(patch["grading_type"].upper())
    if patch.get("due_date") == "":
        # An explicit null (set, not omitted) is what clears the deadline.
        patch["due_date"] = None
    if "ai_grading_mode" in patch:
        patch["ai_grading_mode"] = AIGradingModeEnum(patch["ai_grading_mode"].upper())
    update = AssignmentUpdate(**patch)
    updated = await update_assignment(ctx.request, assignment.assignment_uuid, update, ctx.user, ctx.db_session)
    url = await refs.web_url(ctx, "assignment", assignment=updated.assignment_uuid)
    ai_grading = None
    if set(changes) & set(_AI_FIELDS):
        ai_grading = {
            "mode": _low(updated.ai_grading_mode) or "suggest",
            "has_rubric": bool((updated.ai_grading_instructions or "").strip()),
            "note": "The rubric is private: only teachers and the AI grader see it.",
        }
    return results.changed(
        f'Updated assignment "{updated.title}": {", ".join(_AI_FIELDS.get(k, k) for k in changes)}.',
        assignment=refs.ref("assignment", updated.assignment_uuid, updated.title, url),
        published=bool(updated.published),
        ai_grading=ai_grading,
        url=url,
    )


async def _delete_assignment(ctx: ToolContext, p: AssignmentRefParams):
    assignment = await refs.load(ctx, "assignment", p.assignment_uuid)
    title = assignment.title
    activity = await ctx.db_session.get(Activity, assignment.activity_id)
    activity_uuid = activity.activity_uuid if activity else None
    if activity is not None:
        # Both services commit on their own, so check the second one's rights
        # first: a refusal must leave the pair untouched, not half deleted.
        course = await ctx.db_session.get(Course, activity.course_id)
        if course is not None:
            await check_resource_access(
                ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.DELETE
            )
    await delete_assignment(ctx.request, assignment.assignment_uuid, ctx.user, ctx.db_session)
    activity_removed = False
    if activity_uuid:
        # The course editor removes the pair together; so do we.
        await delete_activity(ctx.request, activity_uuid, ctx.user, ctx.db_session)
        activity_removed = True
    return results.changed(
        f'Deleted assignment "{title}" with its tasks, submissions, grades'
        + (" and its activity." if activity_removed else "."),
        assignment=refs.ref("assignment", p.assignment_uuid, title),
        activity=refs.ref("activity", activity_uuid) if activity_removed else None,
    )


# ─── executors: tasks ───────────────────────────────────────────────────────


async def _create_assignment_tasks(ctx: ToolContext, p: CreateAssignmentTasksParams):
    assignment = await refs.load(ctx, "assignment", p.assignment_uuid)
    task_refs = []
    for index, spec in enumerate(p.tasks):
        try:
            task = await create_assignment_task(
                ctx.request, assignment.assignment_uuid, _task_create(spec), ctx.user, ctx.db_session
            )
        except HTTPException as e:
            raise HTTPException(
                status_code=e.status_code,
                detail=(
                    f"Added {index} of {len(p.tasks)} tasks; task {index + 1} failed: {e.detail}. "
                    "Retry with the remaining tasks only."
                ),
            )
        task_refs.append(_task_ref(task))
    url = await refs.web_url(ctx, "assignment", assignment=assignment.assignment_uuid)
    return results.changed(
        f'Added {len(task_refs)} task(s) to "{assignment.title}".',
        tasks=task_refs,
        assignment=refs.ref("assignment", assignment.assignment_uuid, assignment.title, url),
        url=url,
    )


async def _update_assignment_task(ctx: ToolContext, p: UpdateAssignmentTaskParams):
    task = await refs.load(ctx, "assignment_task", p.assignment_task_uuid)
    changes = p.changes()
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    update = AssignmentTaskUpdate(
        title=p.title,
        description=p.description,
        hint=p.hint,
        max_grade_value=p.points,
    )
    if p.content is not None:
        new_type = _TYPE_OF[p.content.type]
        previous = task.contents if task.assignment_type == new_type else None
        update.assignment_type = new_type
        update.contents = _storage_contents(p.content, previous)
    updated = await update_assignment_task(ctx.request, task.assignment_task_uuid, update, ctx.user, ctx.db_session)
    return results.changed(
        f'Updated task "{updated.title}": {", ".join(changes)}.',
        task=_task_ref(updated),
        type=_low(updated.assignment_type),
    )


async def _delete_assignment_task(ctx: ToolContext, p: AssignmentTaskRefParams):
    task = await refs.load(ctx, "assignment_task", p.assignment_task_uuid)
    title = task.title
    await delete_assignment_task(ctx.request, task.assignment_task_uuid, ctx.user, ctx.db_session)
    return results.changed(
        f'Deleted task "{title}" and every answer to it; graded submissions were regraded.',
        task=refs.ref("assignment_task", p.assignment_task_uuid, title),
    )


# ─── executors: submissions and grading ─────────────────────────────────────


async def _list_submissions(ctx: ToolContext, p: ListSubmissionsParams):
    assignment = await refs.load(ctx, "assignment", p.assignment_uuid)
    course = await _course_of(ctx, assignment)
    # Same gate as GET /assignments/{uuid}/submissions: course read, and
    # anyone below instructor sees only their own row.
    await authorize_assignment_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.READ)
    instructor = await _instructor(ctx, course)

    statement = select(AssignmentUserSubmission).where(AssignmentUserSubmission.assignment_id == assignment.id)
    if not instructor:
        statement = statement.where(AssignmentUserSubmission.user_id == ctx.user.id)
    if p.status:
        statement = statement.where(AssignmentUserSubmission.submission_status.in_(_STATUS_FILTER[p.status]))  # type: ignore[attr-defined]
    total = (await ctx.db_session.execute(select(func.count()).select_from(statement.subquery()))).scalar_one()
    offset = results.offset_of(p.cursor)
    rows = (
        await ctx.db_session.execute(
            statement.order_by(AssignmentUserSubmission.id.desc()).offset(offset).limit(p.limit)  # type: ignore[union-attr]
        )
    ).scalars().all()

    tasks = await _tasks_of(ctx, assignment.id)
    max_grade = sum(int(t.max_grade_value or 0) for t in tasks)
    task_ids = [t.id for t in tasks]
    user_ids = {r.user_id for r in rows}
    by_user_task: dict[int, dict[int, AssignmentTaskSubmission]] = {}
    if task_ids and user_ids:
        for ts in (
            await ctx.db_session.execute(
                select(AssignmentTaskSubmission).where(
                    AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
                    AssignmentTaskSubmission.user_id.in_(user_ids),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all():
            by_user_task.setdefault(ts.user_id, {})[ts.assignment_task_id] = ts
    ai_grades: dict[int, str] = {}
    if instructor and user_ids:
        for grade in (
            await ctx.db_session.execute(
                select(AssignmentAIGrade).where(
                    AssignmentAIGrade.assignment_id == assignment.id,
                    AssignmentAIGrade.user_id.in_(user_ids),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all():
            ai_grades[grade.user_id] = _AI_GRADE_STATE.get(str(grade.status).upper(), "none")
    people = await member_refs(ctx, user_ids)

    items = []
    for row in rows:
        subs = by_user_task.get(row.user_id, {})
        item = {
            "member": people.get(row.user_id) or refs.ref("user", None, "Former member"),
            "status": _low(row.submission_status),
            "attempt": row.attempt_number,
            "submitted_at": iso(row.creation_date),
            "updated_at": iso(row.update_date),
            "grade": None,
            "task_scores": [
                f"{int(subs[t.id].grade or 0)}/{int(t.max_grade_value or 0)}" if t.id in subs else None
                for t in tasks
            ],
        }
        if row.submission_status == AssignmentUserSubmissionStatus.GRADED and not assignment.ungraded:
            item["grade"] = _grade_view(
                compute_assignment_grade(
                    int(row.grade or 0),
                    max_grade,
                    assignment.grading_type,
                    pass_threshold_percentage=assignment.pass_threshold_percentage,
                )
            )
        if row.overall_feedback:
            item["feedback"] = results.clip(row.overall_feedback)
        if instructor:
            item["ai_grade"] = ai_grades.get(row.user_id, "none")
        items.append(item)

    return results.untrusted(
        results.page(
            items,
            offset=offset,
            limit=p.limit,
            total=total,
            tasks=[_task_ref(t) for t in tasks],
            grading_url=await refs.web_url(ctx, "assignment", assignment=assignment.assignment_uuid)
            if instructor
            else None,
        )
    )


def _answer(task: AssignmentTask, data: Any) -> Any:
    """A learner's stored answer, readable and clipped."""
    data = data if isinstance(data, dict) else {}
    contents = task.contents if isinstance(task.contents, dict) else {}
    kind = task.assignment_type
    if kind == AssignmentTaskTypeEnum.QUIZ:
        chosen = {
            (s.get("questionUUID"), s.get("optionUUID"))
            for s in data.get("submissions") or []
            if isinstance(s, dict) and s.get("answer")
        }
        out = []
        for q in contents.get("questions") or []:
            if not isinstance(q, dict):
                continue
            picked = [
                results.clip(o.get("text") or "")
                for o in q.get("options") or []
                if isinstance(o, dict) and (q.get("questionUUID"), o.get("optionUUID")) in chosen
            ]
            out.append({"question": results.clip(q.get("questionText") or ""), "selected": picked})
        return out
    if kind == AssignmentTaskTypeEnum.FORM:
        given = {
            (s.get("questionUUID"), s.get("blankUUID")): s.get("answer")
            for s in data.get("submissions") or []
            if isinstance(s, dict)
        }
        out = []
        for q in contents.get("questions") or []:
            if not isinstance(q, dict):
                continue
            out.append(
                {
                    "question": results.clip(q.get("questionText") or ""),
                    "answers": [
                        results.clip(str(given.get((q.get("questionUUID"), b.get("blankUUID"))) or ""))
                        for b in q.get("blanks") or []
                        if isinstance(b, dict)
                    ],
                }
            )
        return out
    if kind in (AssignmentTaskTypeEnum.SHORT_ANSWER, AssignmentTaskTypeEnum.NUMBER_ANSWER):
        value = data.get("answer")
        return results.clip(str(value), results.DETAIL_TEXT) if value is not None else None
    if kind == AssignmentTaskTypeEnum.CODE:
        return {
            "language_id": data.get("language_id"),
            "source_code": results.clip(data.get("source_code") or "", results.DETAIL_TEXT),
        }
    if kind == AssignmentTaskTypeEnum.FILE_SUBMISSION:
        name = data.get("fileUUID")
        return {"file": name} if name else None
    text = json.dumps(data, default=str)
    return results.clip(text, results.DETAIL_TEXT) if data else None


async def _get_submission(ctx: ToolContext, p: GetSubmissionParams):
    assignment = await refs.load(ctx, "assignment", p.assignment_uuid)
    member = await refs.load_member(ctx, p.user_uuid)
    # Course read plus "only your own unless you can grade it".
    rows = await read_user_assignment_submissions(
        ctx.request, assignment.assignment_uuid, member.id, ctx.user, ctx.db_session
    )
    course = await _course_of(ctx, assignment)
    instructor = await _instructor(ctx, course)
    row = rows[0] if rows else None

    tasks = await _tasks_of(ctx, assignment.id)
    subs: dict[int, AssignmentTaskSubmission] = {}
    if tasks:
        for ts in (
            await ctx.db_session.execute(
                select(AssignmentTaskSubmission).where(
                    AssignmentTaskSubmission.user_id == member.id,
                    AssignmentTaskSubmission.assignment_task_id.in_([t.id for t in tasks]),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all():
            subs[ts.assignment_task_id] = ts

    task_items = []
    for task in tasks:
        ts = subs.get(task.id)
        task_items.append(
            {
                "task": _task_ref(task),
                "type": _low(task.assignment_type),
                "max_points": task.max_grade_value,
                "answered": ts is not None,
                "answer": _answer(task, ts.task_submission) if ts else None,
                "grade": int(ts.grade or 0) if ts else None,
                "feedback": results.clip(ts.task_submission_grade_feedback) if ts and ts.task_submission_grade_feedback else None,
                "graded_by_hand": bool(ts.manually_graded) if ts else False,
            }
        )

    grade = None
    if row is not None and row.submission_status == AssignmentUserSubmissionStatus.GRADED and not assignment.ungraded:
        grade = _grade_view(
            compute_assignment_grade(
                int(row.grade or 0),
                sum(int(t.max_grade_value or 0) for t in tasks),
                assignment.grading_type,
                pass_threshold_percentage=assignment.pass_threshold_percentage,
            )
        )
    people = await member_refs(ctx, {member.id})
    out = {
        "assignment": refs.ref("assignment", assignment.assignment_uuid, assignment.title),
        "member": people.get(member.id),
        "status": _low(row.submission_status) if row else "not_started",
        "attempt": row.attempt_number if row else None,
        "submitted_at": iso(row.creation_date) if row else None,
        "updated_at": iso(row.update_date) if row else None,
        "grade": grade,
        "feedback": results.clip(row.overall_feedback, results.DETAIL_TEXT) if row and row.overall_feedback else None,
        "tasks": task_items,
    }
    if instructor:
        out["grading_url"] = await refs.web_url(ctx, "assignment", assignment=assignment.assignment_uuid)
    return results.untrusted(out)


async def _grade_submission(ctx: ToolContext, p: GradeSubmissionParams):
    assignment = await refs.load(ctx, "assignment", p.assignment_uuid)
    member = await refs.load_member(ctx, p.user_uuid)
    course = await _course_of(ctx, assignment)
    # Grading is an instructor action on the course, checked before any write.
    await authorize_assignment_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE)

    tasks = await _tasks_of(ctx, assignment.id)
    by_uuid = {t.assignment_task_uuid: t for t in tasks}
    if p.task_grades:
        if isinstance(ctx.user, APITokenUser):
            raise HTTPException(
                status_code=403,
                detail=(
                    "API tokens cannot set per-task grades (the HTTP API does not allow it either). "
                    "Call again without task_grades to finalize from the stored task grades."
                ),
            )
        if not await _instructor(ctx, course):
            raise HTTPException(status_code=403, detail="Only instructors of this course can grade.")
        subs = {
            ts.assignment_task_id: ts
            for ts in (
                await ctx.db_session.execute(
                    select(AssignmentTaskSubmission).where(
                        AssignmentTaskSubmission.user_id == member.id,
                        AssignmentTaskSubmission.assignment_task_id.in_([t.id for t in tasks] or [-1]),  # type: ignore[attr-defined]
                    )
                )
            ).scalars().all()
        }
        # Validate everything before the first write.
        plan = []
        for tg in p.task_grades:
            task = by_uuid.get(tg.assignment_task_uuid)
            if task is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Task {tg.assignment_task_uuid} is not part of this assignment.",
                )
            if tg.grade > int(task.max_grade_value or 0):
                raise HTTPException(
                    status_code=400,
                    detail=f'Task "{task.title}" is worth at most {task.max_grade_value} points.',
                )
            ts = subs.get(task.id)
            if ts is None:
                raise HTTPException(
                    status_code=400,
                    detail=f'The learner has not answered task "{task.title}"; there is nothing to grade.',
                )
            plan.append((task, ts, tg))
        for task, ts, tg in plan:
            await handle_assignment_task_submission(
                ctx.request,
                task.assignment_task_uuid,
                AssignmentTaskSubmissionUpdate(
                    assignment_task_submission_uuid=ts.assignment_task_submission_uuid,
                    grade=tg.grade,
                    task_submission_grade_feedback=tg.feedback,
                    manually_graded=True,
                ),
                ctx.user,
                ctx.db_session,
            )

    people = await member_refs(ctx, {member.id})
    who = people.get(member.id)
    pointer = refs.ref(
        "assignment",
        assignment.assignment_uuid,
        assignment.title,
        await refs.web_url(ctx, "assignment", assignment=assignment.assignment_uuid),
    )
    if not p.finalize:
        return results.changed(
            f"Set {len(p.task_grades)} task grade(s) for {who['name'] if who else 'the learner'}; not finalized.",
            assignment=pointer,
            member=who,
        )
    computed = await grade_assignment_submission(
        ctx.request, member.id, assignment.assignment_uuid, ctx.user, ctx.db_session, overall_feedback=p.feedback
    )
    return results.changed(
        f"Graded {who['name'] if who else 'the learner'}: {computed['display_grade']}.",
        assignment=pointer,
        member=who,
        grade=_grade_view(computed),
        tasks=[
            {"task": refs.ref("assignment_task", t["assignment_task_uuid"], t["title"]), "score": f"{t['grade']}/{t['max_grade']}"}
            for t in computed.get("tasks") or []
        ],
    )


# ─── specs ───────────────────────────────────────────────────────────────────


def _fields(p: Any) -> str:
    return ", ".join(_AI_FIELDS.get(k, k) for k in p.changes()) or "nothing"


def _update_summary(p: UpdateAssignmentParams) -> str:
    changes = p.changes()
    if p.published is not None and len(changes) == 1:
        return ("Publish" if p.published else "Unpublish") + " assignment"
    if changes and set(changes) <= set(_AI_FIELDS):
        parts = []
        if p.ai_grading_instructions is not None:
            parts.append("Set the AI grading rubric" if p.ai_grading_instructions.strip() else "Remove the AI grading rubric")
        if p.ai_grading_mode is not None:
            parts.append(f"AI grading: {p.ai_grading_mode.capitalize()}")
        return "; ".join(parts)
    return f"Update assignment: {_fields(p)}"


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_assignments",
        description=(
            "List assignments, in one course or every course you can see: title, due date, "
            "published, grading type, task count, chapter and course. Instructors also get "
            "submission counts by status. Learners only see published ones they can open."
        ),
        params_model=ListAssignmentsParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_list_assignments,
        target_param="course_uuid",
        target_kind="course",
        title="List assignments",
    ),
    ToolSpec(
        name="get_assignment",
        description=(
            "Read one assignment by assignment_uuid or by its activity_uuid: settings, due date, "
            "grading, and its tasks (type, points). Set include_task_contents to also get each "
            "task's questions; answer keys are included only for people who can edit it."
        ),
        params_model=GetAssignmentParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_get_assignment,
        target_kind="assignment",
        title="Get assignment",
    ),
    ToolSpec(
        name="create_assignment",
        description=(
            "Create an unpublished assignment in a chapter, with its learner activity. Then add "
            "its tasks in one create_assignment_tasks call. Returns the assignment and activity "
            "references. Publish later with update_assignment."
        ),
        params_model=CreateAssignmentParams,
        tier=ActionTier.CREATE,
        rights_bucket="assignments",
        access_action=AccessAction.CREATE,
        execute=_create_assignment,
        target_param="chapter_uuid",
        target_kind="chapter",
        summarize=lambda p: f'Create assignment "{p.title}"',
        title="Create assignment",
    ),
    ToolSpec(
        name="update_assignment",
        description=(
            "Change an assignment's title, instructions, due date, grading, retries or answer "
            "reveal, publish or unpublish it, or set AI grading: ai_grading_mode (off, suggest, "
            "auto) and ai_grading_instructions, the private rubric learners never see. Put a "
            "rubric only there, never in description. auto_grading is quiz auto-checking, not AI "
            "grading. Send only fields to change; an empty due_date removes the deadline."
        ),
        params_model=UpdateAssignmentParams,
        tier=ActionTier.EDIT,
        rights_bucket="assignments",
        access_action=AccessAction.UPDATE,
        execute=_update_assignment,
        target_kind="assignment",
        approval_in_call=True,
        idempotent=True,
        summarize=_update_summary,
        title="Update assignment",
    ),
    ToolSpec(
        name="delete_assignment",
        description=(
            "Permanently delete an assignment together with its activity in the chapter, all of "
            "its tasks, and every learner submission and grade. Cannot be undone."
        ),
        params_model=AssignmentRefParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="assignments",
        access_action=AccessAction.DELETE,
        execute=_delete_assignment,
        target_kind="assignment",
        summarize=lambda p: "Delete the assignment, its activity, tasks and all submissions",
        title="Delete assignment",
    ),
    ToolSpec(
        name="create_assignment_tasks",
        description=(
            "Add up to 30 tasks to an assignment, at the end, in one call. Each task's type picks "
            "its fields: quiz (questions with options marked correct), short_answer, "
            "number_answer, form (blanks), file_submission, code (tests), custom. Ids are "
            "generated for you."
        ),
        params_model=CreateAssignmentTasksParams,
        tier=ActionTier.CREATE,
        rights_bucket="assignments",
        access_action=AccessAction.CREATE,
        execute=_create_assignment_tasks,
        target_kind="assignment",
        summarize=lambda p: f"Add {len(p.tasks)} task(s) to the assignment",
        title="Create assignment tasks",
    ),
    ToolSpec(
        name="update_assignment_task",
        description=(
            "Change a task's title, instructions, hint or points, or replace its questions and "
            "settings with content (same typed shape as create_assignment_tasks). Read it first "
            "with get_assignment include_task_contents. Changing scoring regrades graded work."
        ),
        params_model=UpdateAssignmentTaskParams,
        tier=ActionTier.EDIT,
        rights_bucket="assignments",
        access_action=AccessAction.UPDATE,
        execute=_update_assignment_task,
        target_kind="assignment_task",
        idempotent=True,
        summarize=lambda p: f"Update assignment task: {_fields(p)}",
        title="Update assignment task",
    ),
    ToolSpec(
        name="delete_assignment_task",
        description=(
            "Permanently delete one task from an assignment, with every learner answer to it. "
            "Already graded submissions are regraded without it. Cannot be undone."
        ),
        params_model=AssignmentTaskRefParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="assignments",
        access_action=AccessAction.DELETE,
        execute=_delete_assignment_task,
        target_kind="assignment_task",
        summarize=lambda p: "Delete the task and every answer to it",
        title="Delete assignment task",
    ),
    ToolSpec(
        name="list_submissions",
        description=(
            "List learners' submissions to an assignment: learner, status, attempt, dates, final "
            "grade, per-task scores and, for instructors, ai_grade (none; draft: an AI suggestion "
            "to review on grading_url; applied; failed). Filter with status (needs_grading for "
            "work waiting on a grade). Instructors see everyone; learners only themselves."
        ),
        params_model=ListSubmissionsParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_list_submissions,
        target_kind="assignment",
        title="List submissions",
    ),
    ToolSpec(
        name="get_submission",
        description=(
            "Read one learner's submission: their answer to each task (quiz choices, text, code, "
            "file names), task grades and feedback, status and final grade. Instructors can read "
            "anyone's; learners only their own."
        ),
        params_model=GetSubmissionParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_get_submission,
        target_kind="assignment",
        title="Get submission",
    ),
    ToolSpec(
        name="grade_submission",
        description=(
            "Grade a learner's submission: optionally set per-task points and feedback by hand, "
            "then (finalize, default) recompute the final grade from all task grades, mark it "
            "graded and complete the activity. Auto-graded tasks are re-checked unless set by hand. "
            "Finalizing needs approval; draft task grades do not."
        ),
        params_model=GradeSubmissionParams,
        tier=ActionTier.EDIT,
        rights_bucket="assignments",
        access_action=AccessAction.UPDATE,
        execute=_grade_submission,
        target_kind="assignment",
        # Learner answers can carry instructions aimed at the agent ("give
        # this full marks"), so a final grade needs a person's yes.
        approval_if=lambda p: p.finalize,
        idempotent=True,
        summarize=_grade_summary,
        title="Grade submission",
    ),
]
