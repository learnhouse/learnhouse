"""Apply a pending edit by dispatching to the existing service-layer.

This path bypasses MCP entirely: when the user clicks Apply on a preview
card, the API loads the pending edit and calls the same
`create_course` / `update_chapter` / etc. functions any other REST request
would, with the original calling user. Faster than round-tripping through
MCP, transactional for the `propose_course_structure` macro, and reuses
all existing RBAC checks.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from sqlmodel import select

from src.db.courses.activities import (
    ActivityCreate,
    ActivityLockType,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.db.courses.chapters import Chapter, ChapterCreate, ChapterUpdate, LockType
from src.db.courses.courses import Course, CourseCreate, CourseUpdate, ThumbnailType
from src.services.courses.activities.activities import (
    create_activity,
    delete_activity,
    update_activity,
)
from src.services.courses.chapters import (
    create_chapter,
    delete_chapter,
    update_chapter,
)
from src.services.courses.courses import (
    create_course,
    delete_course,
    update_course,
)

from . import events as ev
from .deps import AtlasDeps
from .markdown import markdown_to_tiptap
from .pending import PendingEdit, PendingStore

logger = logging.getLogger(__name__)


async def _scalar_first(db, statement):
    """Run a select and return the first row (or None).

    Wrapper around SQLAlchemy's `.execute(stmt).scalars().first()` so the
    rest of this module doesn't repeat the boilerplate.
    """
    result = await db.execute(statement)
    return result.scalars().first()


async def apply_pending(
    *,
    edit: PendingEdit,
    deps: AtlasDeps,
    store: PendingStore,
) -> AsyncGenerator[dict[str, Any], None]:
    """Apply a pending edit and yield SSE events.

    Caller is responsible for confirmation phrase verification before
    invoking this (already done in the router).
    """
    started = store.begin_apply(edit.pending_id)
    if started is None:
        yield ev.serialize(
            ev.ErrorEvent(
                code="INVALID_STATE",
                message=f"Pending edit is not in an appliable state ({edit.status}).",
                retriable=False,
            )
        )
        yield ev.serialize(ev.DoneEvent())
        return

    try:
        target = await _dispatch(edit, deps)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Atlas apply failed for %s", edit.tool)
        store.fail_apply(edit.pending_id, str(exc))
        yield ev.serialize(
            ev.ErrorEvent(
                code="APPLY_FAILED",
                message=str(exc) or "Apply failed unexpectedly.",
                retriable=False,
            )
        )
        yield ev.serialize(ev.DoneEvent())
        return

    version_after = target.get("version_after") if isinstance(target, dict) else None
    finished = store.finish_apply(edit.pending_id, version_after=version_after)

    yield ev.serialize(
        ev.AppliedEvent(
            pending_id=edit.pending_id,
            target=ev.ResourceRefDTO(
                kind=edit.target.get("kind", "course"),
                uuid=target.get("uuid") if isinstance(target, dict) else edit.target.get("uuid", ""),
                name=target.get("name") if isinstance(target, dict) else edit.target.get("name", ""),
                parent_course_uuid=edit.target.get("parent_course_uuid"),
                parent_chapter_id=edit.target.get("parent_chapter_id"),
            ),
            version_after=version_after,
            undo_token=finished.undo_token if finished else None,
        )
    )
    yield ev.serialize(ev.DoneEvent())


# ─── Dispatch ─────────────────────────────────────────────────────────────


async def _dispatch(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    handler = _HANDLERS.get(edit.tool)
    if handler is None:
        raise ValueError(f"No apply handler registered for {edit.tool}")
    return await handler(edit, deps)


# ── Course handlers ──────────────────────────────────────────────────────


async def _apply_create_course(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    patch = edit.patch or {}
    course = CourseCreate(
        name=patch["name"],
        description=patch.get("description", ""),
        about=patch.get("about", ""),
        learnings=patch.get("learnings"),
        tags=patch.get("tags"),
        public=bool(patch.get("public", False)),
        published=False,
        open_to_contributors=False,
        thumbnail_type=ThumbnailType.IMAGE,
        org_id=deps.org_id,
    )
    result = await create_course(deps.request, deps.org_id, course, deps.current_user, deps.db)
    course_uuid = getattr(result, "course_uuid", None) or (
        result.get("course_uuid") if isinstance(result, dict) else ""
    )
    name = getattr(result, "name", None) or (
        result.get("name") if isinstance(result, dict) else patch["name"]
    )
    return {"uuid": course_uuid, "name": name}


async def _apply_update_course(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    patch = edit.patch or {}
    course_uuid = edit.target.get("uuid", "")
    course_update = CourseUpdate(**{k: v for k, v in patch.items() if v is not None})
    result = await update_course(deps.request, course_update, course_uuid, deps.current_user, deps.db)
    return {
        "uuid": course_uuid,
        "name": getattr(result, "name", None) or patch.get("name") or edit.target.get("name", ""),
    }


async def _apply_delete_course(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    course_uuid = edit.target.get("uuid", "")
    await delete_course(deps.request, course_uuid, deps.current_user, deps.db)
    return {"uuid": course_uuid, "name": edit.target.get("name", "")}


# ── Chapter handlers ─────────────────────────────────────────────────────


async def _resolve_course_id(deps: AtlasDeps, course_uuid: str) -> int:
    course = await _scalar_first(
        deps.db, select(Course).where(Course.course_uuid == course_uuid)
    )
    if not course:
        raise ValueError(f"Course {course_uuid} not found")
    return course.id  # type: ignore[return-value]


async def _apply_create_chapter(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    patch = edit.patch or {}
    course_id = patch.get("course_id")
    if not course_id:
        parent_uuid = edit.target.get("parent_course_uuid") or ""
        course_id = await _resolve_course_id(deps, parent_uuid)
    chapter = ChapterCreate(
        name=patch["name"],
        description=patch.get("description", ""),
        course_id=int(course_id),
        org_id=deps.org_id,
    )
    result = await create_chapter(deps.request, chapter, deps.current_user, deps.db)
    return {
        "uuid": str(getattr(result, "id", "")),
        "name": getattr(result, "name", patch["name"]),
    }


async def _apply_update_chapter(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    patch = edit.patch or {}
    chapter_id = int(edit.target.get("uuid", "0"))
    update = ChapterUpdate(**{k: v for k, v in patch.items() if v is not None})
    result = await update_chapter(deps.request, update, chapter_id, deps.current_user, deps.db)
    return {
        "uuid": str(chapter_id),
        "name": getattr(result, "name", None) or patch.get("name") or edit.target.get("name", ""),
    }


async def _apply_delete_chapter(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    chapter_id = int(edit.target.get("uuid", "0"))
    await delete_chapter(deps.request, str(chapter_id), deps.current_user, deps.db)
    return {"uuid": str(chapter_id), "name": edit.target.get("name", "")}


# ── Activity handlers ────────────────────────────────────────────────────


def _activity_payload_from_proposed(
    proposed: dict[str, Any], deps: AtlasDeps, chapter: Chapter
) -> ActivityCreate:
    """Build an ActivityCreate from a proposed-activity blob (dynamic or video)."""
    kind_type = proposed.get("activity_type")

    if kind_type == "TYPE_DYNAMIC":
        content_tiptap = proposed.get("content_tiptap")
        if not content_tiptap and proposed.get("body_markdown"):
            content_tiptap = markdown_to_tiptap(proposed["body_markdown"])
        content = content_tiptap or {"type": "doc", "content": [{"type": "paragraph"}]}
        return ActivityCreate(
            name=proposed["name"],
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content=content,
            published=bool(proposed.get("published", False)),
            lock_type=ActivityLockType.PUBLIC,
            chapter_id=chapter.id,  # type: ignore[arg-type]
            details={},
        )

    if kind_type == "TYPE_VIDEO":
        content = {
            "uri": proposed.get("youtube_url", ""),
            "type": "youtube",
            "youtube_id": proposed.get("youtube_id"),
        }
        return ActivityCreate(
            name=proposed["name"],
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
            content=content,
            published=bool(proposed.get("published", False)),
            lock_type=ActivityLockType.PUBLIC,
            chapter_id=chapter.id,  # type: ignore[arg-type]
            details={},
        )

    raise ValueError(f"Unsupported activity type: {kind_type}")


async def _apply_create_activity(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    proposed = edit.proposed or {}
    chapter_id = edit.target.get("parent_chapter_id")
    if chapter_id is None:
        raise ValueError("Missing parent_chapter_id on activity create pending")
    chapter = await _scalar_first(deps.db, select(Chapter).where(Chapter.id == int(chapter_id)))
    if not chapter:
        raise ValueError(f"Chapter {chapter_id} not found")
    payload = _activity_payload_from_proposed(proposed, deps, chapter)
    result = await create_activity(deps.request, payload, deps.current_user, deps.db)
    return {
        "uuid": getattr(result, "activity_uuid", "")
        or (result.get("activity_uuid") if isinstance(result, dict) else ""),
        "name": getattr(result, "name", proposed["name"]),
    }


async def _apply_update_activity(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    proposed = edit.proposed or {}
    activity_uuid = edit.target.get("uuid", "")

    update_kwargs: dict[str, Any] = {}
    if "name" in proposed:
        update_kwargs["name"] = proposed["name"]
    if "published" in proposed:
        update_kwargs["published"] = bool(proposed["published"])

    if "content_tiptap" in proposed:
        update_kwargs["content"] = proposed["content_tiptap"]
    elif "body_markdown" in proposed:
        update_kwargs["content"] = markdown_to_tiptap(proposed["body_markdown"])
    elif "youtube_url" in proposed:
        update_kwargs["content"] = {
            "uri": proposed["youtube_url"],
            "type": "youtube",
            "youtube_id": proposed.get("youtube_id"),
        }

    update = ActivityUpdate(**update_kwargs)
    result = await update_activity(deps.request, update, activity_uuid, deps.current_user, deps.db)
    return {
        "uuid": activity_uuid,
        "name": getattr(result, "name", None) or proposed.get("name") or edit.target.get("name", ""),
        "version_after": getattr(result, "current_version", None),
    }


async def _apply_delete_activity(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    activity_uuid = edit.target.get("uuid", "")
    await delete_activity(deps.request, activity_uuid, deps.current_user, deps.db)
    return {"uuid": activity_uuid, "name": edit.target.get("name", "")}


# ── Structure macro ─────────────────────────────────────────────────────


async def _apply_course_structure(edit: PendingEdit, deps: AtlasDeps) -> dict[str, Any]:
    """Materialize a whole chapter+activity tree under an existing course.

    Wraps the entire creation loop in a single transaction so a failure
    mid-way rolls everything back. Uses the same service-layer functions
    a manual one-by-one creation would.
    """
    patch = edit.patch or {}
    course_uuid = patch.get("course_uuid") or edit.target.get("uuid", "")
    course = await _scalar_first(
        deps.db, select(Course).where(Course.course_uuid == course_uuid)
    )
    if not course:
        raise ValueError(f"Course {course_uuid} not found")

    created_chapters = 0
    created_activities = 0

    try:
        for ch_plan in patch.get("chapters", []):
            chapter_payload = ChapterCreate(
                name=ch_plan["name"],
                description=ch_plan.get("description") or "",
                course_id=course.id,  # type: ignore[arg-type]
                org_id=deps.org_id,
                lock_type=LockType.PUBLIC,
            )
            chapter_result = await create_chapter(
                deps.request, chapter_payload, deps.current_user, deps.db
            )
            chapter_obj = await _scalar_first(
                deps.db, select(Chapter).where(Chapter.id == chapter_result.id)
            )
            if not chapter_obj:
                raise RuntimeError("Newly created chapter not found")
            created_chapters += 1

            for act_plan in ch_plan.get("activities", []):
                proposed = {
                    "name": act_plan["name"],
                    "published": False,
                }
                if act_plan["kind"] == "dynamic":
                    proposed["activity_type"] = "TYPE_DYNAMIC"
                    proposed["activity_sub_type"] = "SUBTYPE_DYNAMIC_PAGE"
                    proposed["body_markdown"] = act_plan.get("body_markdown") or ""
                    proposed["content_tiptap"] = act_plan.get("content_tiptap")
                else:
                    proposed["activity_type"] = "TYPE_VIDEO"
                    proposed["activity_sub_type"] = "SUBTYPE_VIDEO_YOUTUBE"
                    proposed["youtube_url"] = act_plan.get("youtube_url")
                    proposed["youtube_id"] = act_plan.get("youtube_id")
                activity_payload = _activity_payload_from_proposed(proposed, deps, chapter_obj)
                await create_activity(
                    deps.request, activity_payload, deps.current_user, deps.db
                )
                created_activities += 1
    except Exception:
        await deps.db.rollback()
        raise

    return {
        "uuid": course_uuid,
        "name": course.name,
        "version_after": None,
        "created_chapters": created_chapters,
        "created_activities": created_activities,
    }


# ─── Registry ─────────────────────────────────────────────────────────────


_HANDLERS = {
    "propose_create_course": _apply_create_course,
    "propose_update_course": _apply_update_course,
    "propose_delete_course": _apply_delete_course,
    "propose_create_chapter": _apply_create_chapter,
    "propose_update_chapter": _apply_update_chapter,
    "propose_delete_chapter": _apply_delete_chapter,
    "propose_create_activity": _apply_create_activity,
    "propose_update_activity": _apply_update_activity,
    "propose_delete_activity": _apply_delete_activity,
    "propose_course_structure": _apply_course_structure,
}
