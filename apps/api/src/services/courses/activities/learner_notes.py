"""Private learner notes: ``/api/v1/notes``.

Privacy model
-------------
* Every query is filtered by the signed-in user's id. There is no way to name
  another person's note: an unknown or foreign ``note_uuid`` is a 404, and no
  endpoint (admin or otherwise) lists notes across users.
* Writing a note needs read access to the course and membership of the
  course's organization; reading your notes back is scoped to one org.
* Notes go away with the author (user delete), the organization, the course or
  the activity (ON DELETE CASCADE), and with the membership: removing someone
  from an org purges their notes there (``purge_member_notes``).
* API tokens are org-scoped, not personal, so they are refused: a note is
  always written and read by the person it belongs to.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import delete, func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.learner_notes import (
    NOTES_PER_ACTIVITY_MAX,
    LearnerNote,
    NoteActivityRef,
    NoteAnchor,
    NoteCourseRef,
    NoteCreate,
    NoteList,
    NoteRead,
    NoteUpdate,
    NoteWithContext,
)
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.activities.learner_notes_content import (
    note_plain_text,
    sanitize_note_content,
)

logger = logging.getLogger(__name__)

# Autosave writes about once a second while someone types; this leaves room
# for that and refuses a script hammering the table.
WRITE_LIMIT = 120
WRITE_WINDOW_SECONDS = 60
LIST_LIMIT_MAX = 1000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_write_rate(user_id: int) -> None:
    """Fail open when Redis is unreachable: notes are not worth an outage."""
    from src.services.security.rate_limiting import check_rate_limit

    try:
        allowed, _count, retry_after = check_rate_limit(
            key=f"learner_notes:{user_id}",
            max_attempts=WRITE_LIMIT,
            window_seconds=WRITE_WINDOW_SECONDS,
        )
    except Exception:
        logger.warning("Notes rate limit unavailable", exc_info=True)
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many changes, try again shortly",
            headers={"Retry-After": str(retry_after)},
        )


def _require_person(current_user) -> PublicUser:
    if isinstance(current_user, AnonymousUser) or not isinstance(current_user, PublicUser):
        raise HTTPException(status_code=401, detail="Sign in to take notes")
    return current_user


async def _require_member(db_session: AsyncSession, user_id: int, org_id: int) -> None:
    member = (await db_session.execute(
        select(UserOrganization.id).where(
            UserOrganization.user_id == user_id, UserOrganization.org_id == org_id
        )
    )).first()
    if not member:
        raise HTTPException(status_code=403, detail="Join this organization to take notes")


async def _load_activity(
    request: Request, activity_uuid: str, current_user, db_session: AsyncSession
) -> tuple[Activity, Course, PublicUser]:
    user = _require_person(current_user)
    row = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .where(Activity.activity_uuid == activity_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    activity, course = row
    await check_resource_access(request, db_session, user, course.course_uuid, AccessAction.READ)
    await _require_member(db_session, user.id, course.org_id)
    return activity, course, user


def _anchor_of(note: LearnerNote) -> Optional[NoteAnchor]:
    if not note.anchor_kind:
        return None
    return NoteAnchor(
        kind=note.anchor_kind,  # type: ignore[arg-type]
        ref=note.anchor_ref,
        label=note.anchor_label,
        seconds=note.anchor_seconds,
    )


def _apply_anchor(note: LearnerNote, anchor: Optional[NoteAnchor]) -> None:
    note.anchor_kind = anchor.kind if anchor else None
    note.anchor_ref = anchor.ref if anchor else None
    note.anchor_label = anchor.label if anchor else None
    note.anchor_seconds = anchor.seconds if anchor and anchor.kind == "video" else None


def _read(note: LearnerNote, activity_uuid: str, course_uuid: str) -> NoteRead:
    return NoteRead(
        note_uuid=note.note_uuid,
        activity_uuid=activity_uuid,
        course_uuid=course_uuid,
        content=note.content or {"type": "doc", "content": []},
        plain_text=note.plain_text or "",
        anchor=_anchor_of(note),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


async def list_activity_notes(
    request: Request, activity_uuid: str, current_user, db_session: AsyncSession
) -> list[NoteRead]:
    activity, course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    notes = (await db_session.execute(
        select(LearnerNote)
        .where(LearnerNote.user_id == user.id, LearnerNote.activity_id == activity.id)
        .order_by(LearnerNote.created_at.desc(), LearnerNote.id.desc())  # type: ignore[union-attr]
    )).scalars().all()
    return [_read(n, activity.activity_uuid, course.course_uuid) for n in notes]


async def create_note(
    request: Request, activity_uuid: str, payload: NoteCreate, current_user, db_session: AsyncSession
) -> NoteRead:
    activity, course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    _check_write_rate(user.id)
    count = (await db_session.execute(
        select(func.count(LearnerNote.id)).where(
            LearnerNote.user_id == user.id, LearnerNote.activity_id == activity.id
        )
    )).scalar_one()
    if count >= NOTES_PER_ACTIVITY_MAX:
        raise HTTPException(status_code=409, detail="This lesson has as many notes as it can hold")
    content = sanitize_note_content(payload.content)
    now = _now()
    note = LearnerNote(
        note_uuid=f"note_{uuid4()}",
        org_id=course.org_id,
        user_id=user.id,
        course_id=course.id,
        activity_id=activity.id,
        content=content,
        plain_text=note_plain_text(content),
        created_at=now,
        updated_at=now,
    )
    _apply_anchor(note, payload.anchor)
    db_session.add(note)
    await db_session.commit()
    await db_session.refresh(note)
    return _read(note, activity.activity_uuid, course.course_uuid)


async def _own_note(
    note_uuid: str, current_user, db_session: AsyncSession
) -> tuple[LearnerNote, Activity, Course, PublicUser]:
    user = _require_person(current_user)
    row = (await db_session.execute(
        select(LearnerNote, Activity, Course)
        .join(Activity, Activity.id == LearnerNote.activity_id)  # type: ignore[arg-type]
        .join(Course, Course.id == LearnerNote.course_id)  # type: ignore[arg-type]
        .where(LearnerNote.note_uuid == note_uuid, LearnerNote.user_id == user.id)
    )).first()
    if not row:
        # Someone else's note and no note at all answer alike.
        raise HTTPException(status_code=404, detail="Note not found")
    note, activity, course = row
    return note, activity, course, user


async def update_note(
    note_uuid: str, payload: NoteUpdate, current_user, db_session: AsyncSession
) -> NoteRead:
    note, activity, course, user = await _own_note(note_uuid, current_user, db_session)
    _check_write_rate(user.id)
    if payload.content is not None:
        content = sanitize_note_content(payload.content)
        note.content = content
        note.plain_text = note_plain_text(content)
    if payload.clear_anchor:
        _apply_anchor(note, None)
    elif payload.anchor is not None:
        _apply_anchor(note, payload.anchor)
    note.updated_at = _now()
    db_session.add(note)
    await db_session.commit()
    await db_session.refresh(note)
    return _read(note, activity.activity_uuid, course.course_uuid)


async def delete_note(note_uuid: str, current_user, db_session: AsyncSession) -> dict:
    note, _activity, _course, user = await _own_note(note_uuid, current_user, db_session)
    _check_write_rate(user.id)
    await db_session.delete(note)
    await db_session.commit()
    return {"detail": "Note deleted"}


async def list_my_notes(
    org_id: int,
    current_user,
    db_session: AsyncSession,
    *,
    course_uuid: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 500,
) -> NoteList:
    """Every note the caller wrote in one organization, newest first."""
    user = _require_person(current_user)
    await _require_member(db_session, user.id, org_id)
    filters = [LearnerNote.user_id == user.id, LearnerNote.org_id == org_id]
    if course_uuid:
        filters.append(Course.course_uuid == course_uuid)
    term = (q or "").strip()
    if term:
        like = f"%{term.lower()}%"
        filters.append(or_(
            func.lower(LearnerNote.plain_text).like(like),
            func.lower(Activity.name).like(like),
            func.lower(Course.name).like(like),
        ))
    base = (
        select(LearnerNote, Activity, Course)
        .join(Activity, Activity.id == LearnerNote.activity_id)  # type: ignore[arg-type]
        .join(Course, Course.id == LearnerNote.course_id)  # type: ignore[arg-type]
        .where(*filters)
    )
    total = (await db_session.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()
    rows = (await db_session.execute(
        base.order_by(LearnerNote.updated_at.desc(), LearnerNote.id.desc())  # type: ignore[union-attr]
        .limit(max(1, min(limit, LIST_LIMIT_MAX)))
    )).all()
    chapters = await _chapter_names(db_session, {activity.id for _n, activity, _c in rows})
    notes = [
        NoteWithContext(
            **_read(note, activity.activity_uuid, course.course_uuid).model_dump(),
            course=NoteCourseRef(
                course_uuid=course.course_uuid,
                name=course.name,
                slug=course.slug,
                thumbnail_image=course.thumbnail_image or None,
            ),
            activity=NoteActivityRef(
                activity_uuid=activity.activity_uuid,
                name=activity.name,
                activity_type=str(getattr(activity.activity_type, "value", activity.activity_type)),
                chapter_name=chapters.get(activity.id),
            ),
        )
        for note, activity, course in rows
    ]
    return NoteList(notes=notes, total=total)


async def _chapter_names(db_session: AsyncSession, activity_ids: Iterable[int]) -> dict[int, str]:
    ids = list(activity_ids)
    if not ids:
        return {}
    rows = (await db_session.execute(
        select(ChapterActivity.activity_id, Chapter.name)
        .join(Chapter, Chapter.id == ChapterActivity.chapter_id)  # type: ignore[arg-type]
        .where(ChapterActivity.activity_id.in_(ids))  # type: ignore[union-attr]
    )).all()
    return {activity_id: name for activity_id, name in rows}


async def purge_member_notes(db_session: AsyncSession, org_id: int, user_ids: list[int]) -> None:
    """A member leaving (or removed from) an org takes their notes there along.

    Staged on the session; the caller commits.
    """
    if not user_ids:
        return
    await db_session.execute(
        delete(LearnerNote).where(
            LearnerNote.org_id == org_id,
            LearnerNote.user_id.in_(user_ids),  # type: ignore[attr-defined]
        )
    )
