"""Translated texts of an assignment activity.

An assignment's texts live outside the activity page (the assignment row and
its tasks), so a translation keeps them in ``activity_translation.extra``:

    {"assignment": {"title": ..., "description": ...},
     "tasks": {"<task uuid>": {"title": ..., "description": ..., "hint": ...,
                               "contents": {"<dotted path>": "<text>"}}}}

``contents`` only replaces strings that exist at the same path in the
task's own contents, so question/option ids, answer keys and grading stay
the source's.
"""

from __future__ import annotations

import copy
from typing import Any, Iterator, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

# Keys inside task contents that hold text a learner reads.
CONTENT_TEXT_KEYS = frozenset({
    "questionText", "question", "text", "label", "title", "description", "placeholder",
    "optionText", "answer", "feedback", "explanation", "hint", "instructions", "prompt",
})
# Never translated even when named like text (ids, code, answers to match).
SKIP_KEYS = frozenset({"correct_answer", "expected_output", "solution", "starter_code", "code", "regex"})
MAX_DEPTH = 12


def _walk(value: Any, path: tuple, depth: int = 0) -> Iterator[tuple[str, str]]:
    if depth > MAX_DEPTH:
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if k in SKIP_KEYS:
                continue
            if isinstance(v, str):
                if k in CONTENT_TEXT_KEYS and v.strip():
                    yield ".".join(str(p) for p in (*path, k)), v
            else:
                yield from _walk(v, (*path, k), depth + 1)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            yield from _walk(item, (*path, i), depth + 1)


def content_strings(contents: Any) -> dict[str, str]:
    """Translatable strings of a task's contents by dotted path."""
    return dict(_walk(contents or {}, ()))


def apply_content_strings(contents: Any, strings: dict[str, str]) -> Any:
    """A copy of ``contents`` with the strings at existing paths replaced."""
    out = copy.deepcopy(contents) if isinstance(contents, (dict, list)) else contents
    if not isinstance(strings, dict):
        return out
    known = content_strings(contents)
    for path, text in strings.items():
        if path not in known or not isinstance(text, str) or not text.strip():
            continue
        # The path exists in the source (content_strings found it there).
        target: Any = out
        parts = path.split(".")
        for p in parts[:-1]:
            target = target[int(p)] if isinstance(target, list) else target[p]
        target[parts[-1]] = text
    return out


def assignment_source_texts(assignment: Any, tasks: list[Any]) -> dict[str, Any]:
    """The source texts in the ``extra`` shape (what a translator fills)."""
    return {
        "assignment": {"title": assignment.title or "", "description": assignment.description or ""},
        "tasks": {
            t.assignment_task_uuid: {
                "title": t.title or "",
                "description": t.description or "",
                "hint": t.hint or "",
                "contents": content_strings(t.contents),
            }
            for t in tasks
        },
    }


def apply_to_assignment(read: Any, extra: Optional[dict]) -> Any:
    data = (extra or {}).get("assignment") or {}
    for key in ("title", "description"):
        if isinstance(data.get(key), str) and data[key].strip():
            setattr(read, key, data[key])
    return read


def apply_to_task(read: Any, extra: Optional[dict]) -> Any:
    data = ((extra or {}).get("tasks") or {}).get(getattr(read, "assignment_task_uuid", ""), {}) or {}
    for key in ("title", "description", "hint"):
        if isinstance(data.get(key), str) and data[key].strip():
            setattr(read, key, data[key])
    if data.get("contents"):
        read.contents = apply_content_strings(read.contents, data["contents"])
    return read


async def published_assignment_extra(
    db: AsyncSession, *, activity_id: Optional[int], course: Any, lang: Optional[str]
) -> Optional[dict]:
    """``extra`` of the published translation served for this learner."""
    if not lang or not activity_id:
        return None
    from src.services.courses.translations.learner import serve_activity

    translation, _ = await serve_activity(
        db, activity_id=activity_id, course_id=course.id, default_locale=course.default_locale, lang=lang
    )
    return translation.extra if translation is not None else None


async def assignment_for_activity(db: AsyncSession, activity_id: int) -> tuple[Any, list[Any]] | None:
    from src.db.courses.assignments import Assignment, AssignmentTask

    assignment = (await db.execute(select(Assignment).where(Assignment.activity_id == activity_id))).scalars().first()
    if assignment is None:
        return None
    tasks = (await db.execute(
        select(AssignmentTask).where(AssignmentTask.assignment_id == assignment.id)
        .order_by(AssignmentTask.order.asc().nulls_last(), AssignmentTask.id.asc())  # type: ignore[union-attr]
    )).scalars().all()
    return assignment, list(tasks)
