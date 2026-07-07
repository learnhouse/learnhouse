"""Assignment tools — assignments, their tasks, submissions and grading.

Every tool wraps an existing assignment service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the services' own RBAC
checks stay authoritative. `create_assignment` mirrors the app flow: it
first creates the paired TYPE_ASSIGNMENT activity in the chapter, then the
assignment row pointing at it.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from src.db.courses.activities import (
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    AssignmentCreate,
    AssignmentTaskCreate,
    AssignmentTaskTypeEnum,
    AssignmentTaskUpdate,
    AssignmentUpdate,
    GradingTypeEnum,
)
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.courses.activities.activities import create_activity
from src.services.courses.activities.assignments import (
    create_assignment,
    create_assignment_task,
    delete_assignment,
    delete_assignment_task,
    get_assignments_from_course,
    grade_assignment_submission,
    read_assignment,
    read_assignment_from_activity_uuid,
    read_assignment_submissions,
    read_assignment_task,
    read_assignment_tasks,
    update_assignment,
    update_assignment_task,
)


def _compact_assignment(assignment) -> dict:
    data = jsonable(assignment)
    keep = (
        "assignment_uuid",
        "title",
        "description",
        "due_date",
        "published",
        "grading_type",
        "auto_grading",
        "allow_retries",
        "max_retries",
        "course_uuid",
        "activity_uuid",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    return out


def _compact_task(task) -> dict:
    data = jsonable(task)
    keep = (
        "assignment_task_uuid",
        "title",
        "description",
        "assignment_type",
        "max_grade_value",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    out["has_contents"] = bool(data.get("contents"))
    return out


def _compact_submission(row) -> dict:
    data = jsonable(row)
    keep = (
        "user_id",
        "submission_status",
        "grade",
        "grade_display",
        "attempt_number",
        "overall_feedback",
        "update_date",
    )
    return {k: data.get(k) for k in keep if k in data}


# ─── params ────────────────────────────────────────────────────────────────


class ListCourseAssignmentsParams(BaseModel):
    course_uuid: str


class GetAssignmentParams(BaseModel):
    assignment_uuid: str


class GetAssignmentForActivityParams(BaseModel):
    activity_uuid: str


class CreateAssignmentParams(BaseModel):
    chapter_id: int = Field(
        ...,
        ge=1,
        description=(
            "Numeric id of the chapter to add the assignment to "
            "(from get_course_structure / list_course_chapters)."
        ),
    )
    title: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    due_date: str = Field(
        "",
        description="Due date string (ISO 8601, e.g. 2026-12-31); empty for none.",
    )
    grading_type: GradingTypeEnum = Field(
        GradingTypeEnum.NUMERIC,
        description=(
            "How final grades are displayed: ALPHABET, NUMERIC, PERCENTAGE, "
            "PASS_FAIL, or GPA_SCALE."
        ),
    )
    published: bool = False
    auto_grading: bool = Field(
        False,
        description=(
            "Grade + mark done automatically on submit (only works when "
            "every task is auto-gradable, i.e. no file submissions)."
        ),
    )
    anti_copy_paste: bool = False
    show_correct_answers: bool = Field(
        False, description="Reveal correct answers to students after grading."
    )
    allow_retries: bool = False
    max_retries: int = Field(0, ge=0, description="Max graded attempts; 0 = unlimited.")


class UpdateAssignmentParams(BaseModel):
    assignment_uuid: str
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    due_date: str | None = None
    published: bool | None = None
    grading_type: GradingTypeEnum | None = None
    auto_grading: bool | None = None
    anti_copy_paste: bool | None = None
    show_correct_answers: bool | None = None
    allow_retries: bool | None = None
    max_retries: int | None = Field(None, ge=0)


class DeleteAssignmentParams(BaseModel):
    assignment_uuid: str
    confirm: bool | None = None


class ListAssignmentTasksParams(BaseModel):
    assignment_uuid: str


class GetAssignmentTaskParams(BaseModel):
    assignment_task_uuid: str


class CreateAssignmentTaskParams(BaseModel):
    assignment_uuid: str
    title: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    hint: str = Field("", description="Optional hint shown to students.")
    assignment_type: AssignmentTaskTypeEnum = Field(
        ...,
        description=(
            "Task kind: QUIZ, FORM, CODE, SHORT_ANSWER, NUMBER_ANSWER, "
            "FILE_SUBMISSION, or CUSTOM (caller-owned contents, graded "
            "manually)."
        ),
    )
    contents: dict = Field(
        default_factory=dict,
        description=(
            "Task definition JSON for the chosen type (e.g. quiz questions "
            "and options with correct flags). Read an existing task of the "
            "same type with get_assignment_task to copy its schema."
        ),
    )


class UpdateAssignmentTaskParams(BaseModel):
    assignment_task_uuid: str
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    hint: str | None = None
    assignment_type: AssignmentTaskTypeEnum | None = None
    contents: dict | None = Field(
        None, description="Full replacement task definition JSON."
    )


class DeleteAssignmentTaskParams(BaseModel):
    assignment_task_uuid: str
    confirm: bool | None = None


class ListAssignmentSubmissionsParams(BaseModel):
    assignment_uuid: str
    limit: int = Field(50, ge=1, le=200)
    offset: int = Field(0, ge=0)


class GradeSubmissionParams(BaseModel):
    assignment_uuid: str
    user_id: int = Field(
        ..., ge=1, description="Student's user id from list_assignment_submissions."
    )
    overall_feedback: str | None = Field(
        None, description="Optional overall instructor note on the submission."
    )


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_course_assignments(ctx: ToolContext, p: ListCourseAssignmentsParams):
    assignments = await get_assignments_from_course(
        ctx.request, p.course_uuid, ctx.user, ctx.db_session
    )
    return [_compact_assignment(a) for a in assignments]


async def _get_assignment(ctx: ToolContext, p: GetAssignmentParams):
    assignment = await read_assignment(
        ctx.request, p.assignment_uuid, ctx.user, ctx.db_session
    )
    return jsonable(assignment)


async def _get_assignment_for_activity(
    ctx: ToolContext, p: GetAssignmentForActivityParams
):
    assignment = await read_assignment_from_activity_uuid(
        ctx.request, p.activity_uuid, ctx.user, ctx.db_session
    )
    return jsonable(assignment)


async def _create_assignment(ctx: ToolContext, p: CreateAssignmentParams):
    # The app creates assignments as a pair: a TYPE_ASSIGNMENT activity in
    # the chapter (what learners open) plus the assignment row itself.
    activity = await create_activity(
        ctx.request,
        ActivityCreate(
            name=p.title,
            chapter_id=p.chapter_id,
            activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
            published=p.published,
        ),
        ctx.user,
        ctx.db_session,
    )
    assignment = await create_assignment(
        ctx.request,
        AssignmentCreate(
            title=p.title,
            description=p.description,
            due_date=p.due_date,
            published=p.published,
            grading_type=p.grading_type,
            auto_grading=p.auto_grading,
            anti_copy_paste=p.anti_copy_paste,
            show_correct_answers=p.show_correct_answers,
            allow_retries=p.allow_retries,
            max_retries=p.max_retries,
            org_id=activity.org_id,
            course_id=activity.course_id,
            chapter_id=p.chapter_id,
            activity_id=activity.id,
        ),
        ctx.user,
        ctx.db_session,
    )
    out = _compact_assignment(assignment)
    out["activity_uuid"] = activity.activity_uuid
    return out


async def _update_assignment(ctx: ToolContext, p: UpdateAssignmentParams):
    patch = p.model_dump(exclude={"assignment_uuid"}, exclude_none=True)
    assignment = await update_assignment(
        ctx.request,
        p.assignment_uuid,
        AssignmentUpdate(**patch),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(assignment)


async def _delete_assignment(ctx: ToolContext, p: DeleteAssignmentParams):
    return jsonable(
        await delete_assignment(ctx.request, p.assignment_uuid, ctx.user, ctx.db_session)
    )


async def _list_assignment_tasks(ctx: ToolContext, p: ListAssignmentTasksParams):
    tasks = await read_assignment_tasks(
        ctx.request, p.assignment_uuid, ctx.user, ctx.db_session
    )
    return [_compact_task(t) for t in tasks]


async def _get_assignment_task(ctx: ToolContext, p: GetAssignmentTaskParams):
    task = await read_assignment_task(
        ctx.request, p.assignment_task_uuid, ctx.user, ctx.db_session
    )
    return jsonable(task)


async def _create_assignment_task(ctx: ToolContext, p: CreateAssignmentTaskParams):
    task = await create_assignment_task(
        ctx.request,
        p.assignment_uuid,
        AssignmentTaskCreate(
            title=p.title,
            description=p.description,
            hint=p.hint,
            assignment_type=p.assignment_type,
            contents=p.contents,
        ),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(task)


async def _update_assignment_task(ctx: ToolContext, p: UpdateAssignmentTaskParams):
    patch = p.model_dump(exclude={"assignment_task_uuid"}, exclude_none=True)
    task = await update_assignment_task(
        ctx.request,
        p.assignment_task_uuid,
        AssignmentTaskUpdate(**patch),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(task)


async def _delete_assignment_task(ctx: ToolContext, p: DeleteAssignmentTaskParams):
    return jsonable(
        await delete_assignment_task(
            ctx.request, p.assignment_task_uuid, ctx.user, ctx.db_session
        )
    )


async def _list_assignment_submissions(
    ctx: ToolContext, p: ListAssignmentSubmissionsParams
):
    submissions = await read_assignment_submissions(
        ctx.request,
        p.assignment_uuid,
        ctx.user,
        ctx.db_session,
        limit=p.limit,
        offset=p.offset,
    )
    return [_compact_submission(s) for s in submissions]


async def _grade_submission(ctx: ToolContext, p: GradeSubmissionParams):
    return jsonable(
        await grade_assignment_submission(
            ctx.request,
            p.user_id,
            p.assignment_uuid,
            ctx.user,
            ctx.db_session,
            overall_feedback=p.overall_feedback,
        )
    )


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_course_assignments",
        description=(
            "List a course's assignments (uuid, title, due date, grading "
            "type). Use this to resolve an assignment mentioned by name."
        ),
        params_model=ListCourseAssignmentsParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_list_course_assignments,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="get_assignment",
        description=(
            "Get one assignment's full details (settings, grading type, "
            "linked course/activity uuids) by assignment uuid."
        ),
        params_model=GetAssignmentParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_get_assignment,
        target_param="assignment_uuid",
        target_kind="assignment",
    ),
    ToolSpec(
        name="get_assignment_for_activity",
        description=(
            "Get the assignment behind a TYPE_ASSIGNMENT activity. Use when "
            "you only have an activity uuid from the course structure."
        ),
        params_model=GetAssignmentForActivityParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_get_assignment_for_activity,
        target_param="activity_uuid",
        target_kind="activity",
    ),
    ToolSpec(
        name="create_assignment",
        description=(
            "Create an assignment in a chapter (also creates its paired "
            "TYPE_ASSIGNMENT activity there). Add gradable work with "
            "create_assignment_task afterwards."
        ),
        params_model=CreateAssignmentParams,
        tier=ActionTier.CREATE,
        rights_bucket="assignments",
        access_action=AccessAction.CREATE,
        execute=_create_assignment,
        target_kind="assignment",
        summarize=lambda p: f'Create assignment "{p.title}"',
    ),
    ToolSpec(
        name="update_assignment",
        description=(
            "Update assignment settings (title, description, due date, "
            "published, grading type, auto-grading, retries...). Only send "
            "fields to change."
        ),
        params_model=UpdateAssignmentParams,
        tier=ActionTier.EDIT,
        rights_bucket="assignments",
        access_action=AccessAction.UPDATE,
        execute=_update_assignment,
        target_param="assignment_uuid",
        target_kind="assignment",
        summarize=lambda p: "Update assignment fields: "
        + ", ".join(
            p.model_dump(exclude={"assignment_uuid"}, exclude_none=True) or ["-"]
        ),
    ),
    ToolSpec(
        name="delete_assignment",
        description=(
            "Permanently delete an assignment with its tasks and student "
            "submissions. The paired activity stays in the chapter — remove "
            "it with delete_activity. Irreversible."
        ),
        params_model=DeleteAssignmentParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="assignments",
        access_action=AccessAction.DELETE,
        execute=_delete_assignment,
        target_param="assignment_uuid",
        target_kind="assignment",
    ),
    ToolSpec(
        name="list_assignment_tasks",
        description=(
            "List an assignment's tasks (uuid, title, type). Use this to "
            "get the assignment_task_uuid needed by the task tools."
        ),
        params_model=ListAssignmentTasksParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_list_assignment_tasks,
        target_param="assignment_uuid",
        target_kind="assignment",
    ),
    ToolSpec(
        name="get_assignment_task",
        description=(
            "Get one task's full definition including its contents JSON "
            "(quiz questions, form fields...). Read before editing contents."
        ),
        params_model=GetAssignmentTaskParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_get_assignment_task,
        target_param="assignment_task_uuid",
        target_kind="assignment_task",
    ),
    ToolSpec(
        name="create_assignment_task",
        description=(
            "Add a gradable task (quiz, form, code, short/number answer, "
            "file submission, custom) to an assignment."
        ),
        params_model=CreateAssignmentTaskParams,
        tier=ActionTier.CREATE,
        rights_bucket="assignments",
        access_action=AccessAction.CREATE,
        execute=_create_assignment_task,
        target_param="assignment_uuid",
        target_kind="assignment",
        summarize=lambda p: f'Add {p.assignment_type.value} task "{p.title}"',
    ),
    ToolSpec(
        name="update_assignment_task",
        description=(
            "Update a task's title, description, hint, type, or contents "
            "JSON (contents is a full replacement — read it first with "
            "get_assignment_task). Only send fields to change."
        ),
        params_model=UpdateAssignmentTaskParams,
        tier=ActionTier.EDIT,
        rights_bucket="assignments",
        access_action=AccessAction.UPDATE,
        execute=_update_assignment_task,
        target_param="assignment_task_uuid",
        target_kind="assignment_task",
        summarize=lambda p: "Update assignment task fields: "
        + ", ".join(
            p.model_dump(exclude={"assignment_task_uuid"}, exclude_none=True) or ["-"]
        ),
    ),
    ToolSpec(
        name="delete_assignment_task",
        description=(
            "Permanently delete a task from an assignment (student task "
            "submissions go with it). Irreversible."
        ),
        params_model=DeleteAssignmentTaskParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="assignments",
        access_action=AccessAction.DELETE,
        execute=_delete_assignment_task,
        target_param="assignment_task_uuid",
        target_kind="assignment_task",
    ),
    ToolSpec(
        name="list_assignment_submissions",
        description=(
            "List student submissions for an assignment (user_id, status, "
            "grade). Instructors see everyone; students only their own. Use "
            "this to get the user_id for grade_submission."
        ),
        params_model=ListAssignmentSubmissionsParams,
        tier=ActionTier.READ,
        rights_bucket="assignments",
        access_action=AccessAction.READ,
        execute=_list_assignment_submissions,
        target_param="assignment_uuid",
        target_kind="assignment",
    ),
    ToolSpec(
        name="grade_submission",
        description=(
            "Finalize a student's assignment grade: recomputes the final "
            "grade from their per-task scores, marks the submission GRADED "
            "and completes the activity. Does not take a raw grade value — "
            "it aggregates existing task grades."
        ),
        params_model=GradeSubmissionParams,
        tier=ActionTier.EDIT,
        rights_bucket="assignments",
        access_action=AccessAction.UPDATE,
        execute=_grade_submission,
        target_param="assignment_uuid",
        target_kind="assignment",
        summarize=lambda p: f"Grade user #{p.user_id}'s submission",
    ),
]
