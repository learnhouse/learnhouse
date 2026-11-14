"""Private learner notes: ``/api/v1/notes``.

Session users only (API tokens are org-scoped, not personal); every handler
is scoped to the caller. See ``src/services/courses/activities/learner_notes.py``
for the privacy model.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.learner_notes import NoteCreate, NoteList, NoteRead, NoteUpdate
from src.security.auth import get_current_user
from src.services.courses.activities.learner_notes import (
    create_note,
    delete_note,
    list_activity_notes,
    list_my_notes,
    update_note,
)

router = APIRouter()


@router.get("", response_model=NoteList)
async def api_list_my_notes(
    org_id: int = Query(...),
    course_uuid: Optional[str] = Query(default=None, max_length=100),
    q: Optional[str] = Query(default=None, max_length=200),
    limit: int = Query(default=500, ge=1, le=1000),
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Your notes in one organization, newest first, with course and lesson."""
    return await list_my_notes(org_id, current_user, db_session, course_uuid=course_uuid, q=q, limit=limit)


@router.get("/activity/{activity_uuid}", response_model=list[NoteRead])
async def api_list_activity_notes(
    request: Request,
    activity_uuid: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Your notes on one lesson."""
    return await list_activity_notes(request, activity_uuid, current_user, db_session)


@router.post("/activity/{activity_uuid}", response_model=NoteRead)
async def api_create_note(
    request: Request,
    activity_uuid: str,
    payload: NoteCreate,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await create_note(request, activity_uuid, payload, current_user, db_session)


@router.patch("/{note_uuid}", response_model=NoteRead)
async def api_update_note(
    note_uuid: str,
    payload: NoteUpdate,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await update_note(note_uuid, payload, current_user, db_session)


@router.delete("/{note_uuid}")
async def api_delete_note(
    note_uuid: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await delete_note(note_uuid, current_user, db_session)
