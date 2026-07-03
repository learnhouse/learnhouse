"""AI assignment generation service.

Generates a full assignment + graded tasks grounded on a course's content.
Structured output (``AIAssignmentPlan``) keeps the model on-rails; the service
then converts each task into the exact ``contents`` shape the server graders in
``src/services/courses/activities/assignments.py`` expect, stamping the ids
(questionUUID / optionUUID / blankUUID). Nothing is persisted here — the plan is
returned for the teacher to preview, edit, and save via the existing endpoints.
"""

from __future__ import annotations

import json
import logging
from uuid import uuid4

from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.ai.base import get_chat_session_history, save_message_to_history
from src.services.ai.llm import generate, model_for_tier
from src.services.ai.rag.content_extraction import extract_all_course_content
from src.services.ai.schemas.assignment import (
    AIAssignmentPlan,
    AITask,
    GeneratedAssignmentPlan,
    GeneratedTask,
)

logger = logging.getLogger(__name__)

MAX_TASKS = 10
MAX_CONTEXT_CHARS = 8000

_SYSTEM_PROMPT = """You are an expert instructional designer generating a graded assignment for a course.

You know these task types and MUST use their exact structure:
- QUIZ: multiple-choice; each question has options, each option marked correct or not. At least one correct option per question.
- FORM: fill-in-the-blank; each question has one or more blanks, each with the correct answer (and optional hint).
- SHORT_ANSWER: an open text prompt with a list of accepted answers and a match_mode (default case_insensitive).
- NUMBER_ANSWER: a prompt expecting a numeric answer, with correct_value and a tolerance (use 0 for exact).
- FILE_SUBMISSION: the student uploads a file; no auto-grading, so give clear instructions in the description.

Rules:
- Generate exactly the requested number of tasks, only of the allowed types.
- Populate ONLY the sub-object matching each task's assignment_type; leave the others null.
- Base tasks strictly on the provided course content; do not contradict it.
- Write in the same language as the course content / user's request.
- Every task needs a clear title, a student-facing description, and a helpful hint.
- Return ONLY the structured plan."""


async def _course_context(course_id: int, org_id: int, db_session: AsyncSession) -> str:
    try:
        chunks = await extract_all_course_content(course_id, org_id, db_session)
    except Exception:
        logger.warning("Failed to extract course content for assignment grounding", exc_info=True)
        return ""
    parts: list[str] = []
    total = 0
    for c in chunks:
        text = (c.get("text") or "").strip()
        if not text:
            continue
        header = f"# {c.get('chapter_name', '')} / {c.get('activity_name', '')}".strip()
        piece = f"{header}\n{text}"
        parts.append(piece)
        total += len(piece)
        if total >= MAX_CONTEXT_CHARS:
            break
    return "\n\n".join(parts)[:MAX_CONTEXT_CHARS]


def _quiz_contents(task: AITask) -> dict:
    questions = []
    for q in (task.quiz.questions if task.quiz else []):
        options = [
            {
                "optionUUID": f"option_{uuid4()}",
                "text": opt.text,
                "fileID": "",
                "type": "text",
                "assigned_right_answer": bool(opt.is_correct),
            }
            for opt in q.options
        ]
        questions.append(
            {
                "questionUUID": f"question_{uuid4()}",
                "questionText": q.question_text,
                "options": options,
            }
        )
    return {"questions": questions}


def _form_contents(task: AITask) -> dict:
    questions = []
    for q in (task.form.questions if task.form else []):
        blanks = []
        for b in q.blanks:
            blank = {
                "blankUUID": f"blank_{uuid4()}",
                "placeholder": b.placeholder,
                "correctAnswer": b.correct_answer,
            }
            if b.hint:
                blank["hint"] = b.hint
            blanks.append(blank)
        questions.append(
            {
                "questionUUID": f"question_{uuid4()}",
                "questionText": q.question_text,
                "blanks": blanks,
            }
        )
    return {"questions": questions}


def _short_answer_contents(task: AITask) -> dict:
    sa = task.short_answer
    if not sa:
        return {"prompt": "", "correct_answers": [], "match_mode": "case_insensitive"}
    contents = {
        "prompt": sa.prompt,
        "correct_answers": sa.correct_answers,
        "match_mode": sa.match_mode,
    }
    if sa.explanation:
        contents["explanation"] = sa.explanation
    return contents


def _number_answer_contents(task: AITask) -> dict:
    na = task.number_answer
    if not na:
        return {"prompt": "", "correct_value": 0, "tolerance": 0}
    contents = {
        "prompt": na.prompt,
        "correct_value": na.correct_value,
        "tolerance": na.tolerance,
    }
    if na.unit:
        contents["unit"] = na.unit
    if na.explanation:
        contents["explanation"] = na.explanation
    return contents


_CONTENTS_BUILDERS = {
    "QUIZ": _quiz_contents,
    "FORM": _form_contents,
    "SHORT_ANSWER": _short_answer_contents,
    "NUMBER_ANSWER": _number_answer_contents,
    "FILE_SUBMISSION": lambda _task: {},
}


def _to_generated_task(task: AITask) -> GeneratedTask:
    builder = _CONTENTS_BUILDERS.get(task.assignment_type, lambda _t: {})
    return GeneratedTask(
        title=task.title,
        description=task.description,
        hint=task.hint or "",
        assignment_type=task.assignment_type,
        contents=builder(task),
        max_grade_value=100,
    )


async def generate_assignment_plan(
    *,
    org_id: int,
    course_id: int,
    prompt: str,
    model_name: str,
    db_session: AsyncSession,
    num_tasks: int = 3,
    allowed_task_types: list[str] | None = None,
    session_uuid: str | None = None,
) -> tuple[GeneratedAssignmentPlan, str]:
    """Generate an assignment plan grounded on course content. Does not persist."""
    num_tasks = max(1, min(num_tasks, MAX_TASKS))
    allowed = allowed_task_types or ["QUIZ", "FORM", "SHORT_ANSWER", "NUMBER_ANSWER", "FILE_SUBMISSION"]

    context = await _course_context(course_id, org_id, db_session)

    session = get_chat_session_history(session_uuid)
    resolved_session_uuid = session["aichat_uuid"]
    history = session["message_history"]

    user_prompt = (
        f"Create an assignment with exactly {num_tasks} task(s).\n"
        f"Allowed task types: {', '.join(allowed)}.\n"
        f"Instructions: {prompt.strip()}\n\n"
        f"Course content:\n{context}"
    )

    plan: AIAssignmentPlan = await generate(
        model_name=model_name or model_for_tier("standard"),
        user_prompt=user_prompt,
        system_prompt=_SYSTEM_PROMPT,
        history=history,
        output_type=AIAssignmentPlan,
    )

    # Keep only allowed types and convert to grader-valid contents.
    allowed_set = set(allowed)
    generated_tasks = [
        _to_generated_task(t) for t in plan.tasks if t.assignment_type in allowed_set
    ]

    generated = GeneratedAssignmentPlan(
        title=plan.title,
        description=plan.description,
        grading_type=plan.grading_type,
        tasks=generated_tasks,
    )

    # Persist the actual generated plan (not just a count) so a refine turn can
    # amend it instead of regenerating from scratch.
    assistant_turn = json.dumps(generated.model_dump())
    try:
        save_message_to_history(resolved_session_uuid, prompt.strip(), assistant_turn, org_id=org_id)
    except Exception:
        logger.debug("Failed to persist assignment refine history", exc_info=True)

    return generated, resolved_session_uuid
