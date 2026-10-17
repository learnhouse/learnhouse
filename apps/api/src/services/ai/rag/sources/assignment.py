"""Assignments: instructions and task prompts as learners see them.

Built from an allowlist of fields rather than by stripping a payload, so a new
answer-key field can never leak into search: solutions, correct answers and
values, explanations, test cases and learner submissions are never read.
Unpublished assignments are not indexed.
"""

from __future__ import annotations


from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.assignments import Assignment, AssignmentTask
from src.services.ai.rag.formats import is_safe_file_name, join, read_pdf_pages
from src.services.ai.rag.sources import SourceContext, source
from src.services.ai.rag.types import Segment, SourceType


def _str(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _questions(contents) -> list[str]:
    """Quiz and form question text, with quiz options but never their keys."""
    lines: list[str] = []
    questions = contents.get("questions") if isinstance(contents, dict) else None
    for question in questions if isinstance(questions, list) else []:
        if not isinstance(question, dict) or not _str(question.get("questionText")):
            continue
        lines.append(f"Question: {_str(question.get('questionText'))}")
        lines += [f"- {_str(o.get('text'))}" for o in question.get("options") or []
                  if isinstance(o, dict) and _str(o.get("text"))]
    return lines


@source(ActivityTypeEnum.TYPE_ASSIGNMENT)
async def extract(activity: Activity, ctx: SourceContext) -> list[Segment]:
    assignment = (await ctx.db.execute(
        select(Assignment).where(Assignment.activity_id == activity.id)
    )).scalars().first()
    if assignment is None or not assignment.published:
        return []

    segments = [Segment(
        text=join([f"Assignment: {_str(assignment.title)}", _str(assignment.description)]),
        source_type=SourceType.ASSIGNMENT,
    )]

    tasks = (await ctx.db.execute(
        select(AssignmentTask)
        .where(AssignmentTask.assignment_id == assignment.id)
        .order_by(AssignmentTask.order, AssignmentTask.id)
    )).scalars().all()
    for task in tasks:
        segments.append(Segment(
            text=join([
                f"Task: {_str(task.title)}",
                _str(task.description),
                _str(task.hint) and f"Hint: {_str(task.hint)}",
                *_questions(task.contents),
            ]),
            source_type=SourceType.ASSIGNMENT,
            block_uuid=task.assignment_task_uuid,
        ))
        segments += await _reference_pdf(task, assignment, ctx)
    return segments


async def _reference_pdf(task: AssignmentTask, assignment: Assignment, ctx: SourceContext) -> list[Segment]:
    name = task.reference_file
    if not (is_safe_file_name(name) and name.lower().endswith(".pdf")
            and is_safe_file_name(assignment.assignment_uuid) and is_safe_file_name(task.assignment_task_uuid)):
        return []
    key = (f"{ctx.activity_dir()}/assignments/{assignment.assignment_uuid}"
           f"/tasks/{task.assignment_task_uuid}/{name}")
    return [
        Segment(text=text, source_type=SourceType.ASSIGNMENT, block_uuid=task.assignment_task_uuid,
                locator={"page": page})
        for page, text in await read_pdf_pages(key)
    ]
