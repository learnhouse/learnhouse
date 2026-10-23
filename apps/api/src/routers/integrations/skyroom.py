"""
REST endpoints for the Skyroom live-class integration.

Mounted in src/router.py under the prefix ``/integrations/skyroom`` so the full
paths are ``/api/v1/integrations/skyroom/{org_id}/live-classes/...``.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.skyroom import (
    SkyroomJoinLinkRequest,
    SkyroomJoinLinkResponse,
    SkyroomLiveClassCreate,
    SkyroomLiveClassRead,
    SkyroomLiveClassUpdate,
    SkyroomRemoteRoom,
    SkyroomRoomImportRequest,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.skyroom.client import is_skyroom_enabled
from src.services.skyroom.skyroom import (
    create_join_link,
    create_live_class,
    delete_live_class,
    get_live_class,
    import_remote_room,
    list_live_classes,
    list_remote_rooms,
    update_live_class,
)

router = APIRouter()


@router.get(
    "/status",
    summary="Whether the Skyroom integration is configured",
    description="Returns whether this LearnHouse instance has a Skyroom API key configured. Does not reveal the key.",
)
async def api_skyroom_status() -> dict:
    """Report whether the Skyroom integration is enabled on this instance."""
    return {"enabled": is_skyroom_enabled()}


@router.post(
    "/{org_id}/live-classes",
    response_model=SkyroomLiveClassRead,
    summary="Create a Skyroom live class",
    description="Creates a reusable Skyroom virtual room and stores the mapping for the organization.",
    responses={
        200: {"description": "Live class created", "model": SkyroomLiveClassRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to manage live classes for this organization"},
        404: {"description": "Organization not found"},
        502: {"description": "Could not reach Skyroom"},
        503: {"description": "Skyroom integration not configured"},
    },
)
async def api_create_live_class(
    request: Request,
    org_id: int,
    liveclass_object: SkyroomLiveClassCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> SkyroomLiveClassRead:
    return await create_live_class(
        request, db_session, org_id, liveclass_object, current_user
    )


@router.get(
    "/{org_id}/live-classes",
    response_model=List[SkyroomLiveClassRead],
    summary="List Skyroom live classes",
    description="Returns all Skyroom live classes for the organization, optionally filtered by course.",
    responses={
        200: {"description": "List of live classes", "model": List[SkyroomLiveClassRead]},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view live classes"},
    },
)
async def api_list_live_classes(
    request: Request,
    org_id: int,
    course_id: Optional[int] = Query(None),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[SkyroomLiveClassRead]:
    return await list_live_classes(
        request, db_session, org_id, current_user, course_id=course_id
    )


@router.get(
    "/{org_id}/live-classes/{liveclass_uuid}",
    response_model=SkyroomLiveClassRead,
    summary="Get a Skyroom live class",
    responses={
        200: {"description": "Live class details", "model": SkyroomLiveClassRead},
        404: {"description": "Live class not found"},
    },
)
async def api_get_live_class(
    request: Request,
    org_id: int,
    liveclass_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> SkyroomLiveClassRead:
    return await get_live_class(
        request, db_session, org_id, liveclass_uuid, current_user
    )


@router.put(
    "/{org_id}/live-classes/{liveclass_uuid}",
    response_model=SkyroomLiveClassRead,
    summary="Update a Skyroom live class",
    description="Updates the title, access flags or active state of a live class and syncs them to Skyroom.",
    responses={
        200: {"description": "Live class updated", "model": SkyroomLiveClassRead},
        404: {"description": "Live class not found"},
        502: {"description": "Could not reach Skyroom"},
    },
)
async def api_update_live_class(
    request: Request,
    org_id: int,
    liveclass_uuid: str,
    liveclass_object: SkyroomLiveClassUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> SkyroomLiveClassRead:
    return await update_live_class(
        request, db_session, org_id, liveclass_uuid, liveclass_object, current_user
    )


@router.delete(
    "/{org_id}/live-classes/{liveclass_uuid}",
    summary="Delete a Skyroom live class",
    description="Deletes the Skyroom room and removes the local mapping.",
    responses={
        200: {"description": "Live class deleted"},
        404: {"description": "Live class not found"},
        502: {"description": "Could not reach Skyroom"},
    },
)
async def api_delete_live_class(
    request: Request,
    org_id: int,
    liveclass_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await delete_live_class(
        request, db_session, org_id, liveclass_uuid, current_user
    )


@router.get(
    "/{org_id}/remote-rooms",
    response_model=List[SkyroomRemoteRoom],
    summary="List pre-existing rooms on the Skyroom account",
    description="Lists the rooms that already exist on the configured Skyroom account, each flagged with whether this organization has already imported it.",
    responses={
        200: {"description": "List of remote Skyroom rooms", "model": List[SkyroomRemoteRoom]},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission"},
        404: {"description": "Organization not found"},
        502: {"description": "Could not reach Skyroom"},
        503: {"description": "Skyroom integration not configured"},
    },
)
async def api_list_remote_rooms(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[SkyroomRemoteRoom]:
    return await list_remote_rooms(request, db_session, org_id, current_user)


@router.post(
    "/{org_id}/remote-rooms/{skyroom_room_id}/import",
    response_model=SkyroomLiveClassRead,
    summary="Import a pre-existing Skyroom room as a live class",
    description="Adopts a room that already exists on Skyroom (created outside LearnHouse) into this organization without creating a new remote room. Idempotent per organization.",
    responses={
        200: {"description": "Room imported", "model": SkyroomLiveClassRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission"},
        404: {"description": "Organization or room not found"},
        502: {"description": "Could not reach Skyroom"},
        503: {"description": "Skyroom integration not configured"},
    },
)
async def api_import_remote_room(
    request: Request,
    org_id: int,
    skyroom_room_id: int,
    import_object: SkyroomRoomImportRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> SkyroomLiveClassRead:
    return await import_remote_room(
        request, db_session, org_id, skyroom_room_id, import_object, current_user
    )


@router.post(
    "/{org_id}/live-classes/{liveclass_uuid}/join-link",
    response_model=SkyroomJoinLinkResponse,
    summary="Create a direct join link for a live class",
    description="Generates a time-limited, login-free Skyroom join URL for a participant with the requested access level.",
    responses={
        200: {"description": "Join link created", "model": SkyroomJoinLinkResponse},
        400: {"description": "Invalid access level"},
        404: {"description": "Live class not found"},
        502: {"description": "Could not reach Skyroom"},
    },
)
async def api_create_join_link(
    request: Request,
    org_id: int,
    liveclass_uuid: str,
    join_object: SkyroomJoinLinkRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> SkyroomJoinLinkResponse:
    return await create_join_link(
        request, db_session, org_id, liveclass_uuid, join_object, current_user
    )
