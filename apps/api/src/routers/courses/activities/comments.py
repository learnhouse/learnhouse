"""Editor comments on an activity: ``/api/v1/activities/{activity_uuid}/comments``.

Permissions live in the service (anyone who may edit the activity); see
``src/services/courses/activities/comments.py``.
"""

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.activity_comments import (
    CommentAuthor,
    CommentCreate,
    CommentUpdate,
    ThreadCreate,
    ThreadList,
    ThreadRead,
    ThreadStatusUpdate,
)
from src.security.auth import get_current_user
from src.services.courses.activities.comments import (
    create_thread,
    delete_comment,
    edit_comment,
    list_mentionable,
    list_threads,
    reply,
    set_thread_status,
)

router = APIRouter()


@router.get("/{activity_uuid}/comments", response_model=ThreadList)
async def api_list_threads(
    request: Request,
    activity_uuid: str,
    locale: Optional[str] = Query(default=None, max_length=20),
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Every thread on the activity, open and resolved, with its comments."""
    return await list_threads(request, activity_uuid, current_user, db_session, locale=locale)


@router.get("/{activity_uuid}/comments/mentionable", response_model=list[CommentAuthor])
async def api_list_mentionable(
    request: Request,
    activity_uuid: str,
    q: str = Query(default="", max_length=100),
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """People who can be @mentioned: those who may edit the course."""
    return await list_mentionable(request, activity_uuid, q, current_user, db_session)


@router.post("/{activity_uuid}/comments", response_model=ThreadRead)
async def api_create_thread(
    request: Request,
    activity_uuid: str,
    payload: ThreadCreate,
    background: BackgroundTasks,
    locale: Optional[str] = Query(default=None, max_length=20),
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await create_thread(request, activity_uuid, payload, current_user, db_session, background, locale=locale)


@router.post("/{activity_uuid}/comments/{thread_uuid}/replies", response_model=ThreadRead)
async def api_reply(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    payload: CommentCreate,
    background: BackgroundTasks,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await reply(request, activity_uuid, thread_uuid, payload, current_user, db_session, background)


@router.patch("/{activity_uuid}/comments/{thread_uuid}", response_model=ThreadRead)
async def api_set_thread_status(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    payload: ThreadStatusUpdate,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Resolve or reopen a thread."""
    return await set_thread_status(request, activity_uuid, thread_uuid, payload, current_user, db_session)


@router.patch("/{activity_uuid}/comments/{thread_uuid}/{comment_uuid}", response_model=ThreadRead)
async def api_edit_comment(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    comment_uuid: str,
    payload: CommentUpdate,
    background: BackgroundTasks,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await edit_comment(
        request, activity_uuid, thread_uuid, comment_uuid, payload, current_user, db_session, background
    )


@router.delete("/{activity_uuid}/comments/{thread_uuid}/{comment_uuid}", response_model=ThreadRead)
async def api_delete_comment(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    comment_uuid: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await delete_comment(request, activity_uuid, thread_uuid, comment_uuid, current_user, db_session)
