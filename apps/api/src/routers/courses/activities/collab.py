"""Collaborative editing endpoints for activity pages.

``/collab/access`` answers the collab server (and the editor) for a signed-in
user; ``/collab/state`` is the collab server's own read/write of the room,
protected by the shared internal key.
"""

import hmac
import os

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.services.courses.activities.collab_settings import (
    ActivityLiveEditingRead,
    ActivityLiveEditingWrite,
    OrgLiveEditingRead,
    OrgLiveEditingWrite,
    get_activity_live_editing,
    get_org_live_editing,
    set_activity_live_editing,
    set_org_live_editing,
)
from src.services.courses.activities.collab import (
    CollabAccessRead,
    CollabStateRead,
    CollabStateWrite,
    CollabStateWriteResult,
    AutosaveResult,
    AutosaveWrite,
    NamedVersionRead,
    NamedVersionWrite,
    autosave_content,
    autosave_translation,
    get_collab_access,
    get_translation_collab_state,
    put_translation_collab_state,
    name_current_version,
    get_collab_state,
    put_collab_state,
)


async def verify_collab_internal_key(x_internal_key: str = Header(...)):
    """The shared key the collab server calls the API with."""
    expected_key = os.getenv("COLLAB_INTERNAL_KEY", "")
    # Bytes: compare_digest raises TypeError on non-ASCII str header values.
    if not expected_key or not hmac.compare_digest(x_internal_key.encode(), expected_key.encode()):
        raise HTTPException(status_code=403, detail="Invalid internal key")


router = APIRouter()
internal_router = APIRouter(dependencies=[Depends(verify_collab_internal_key)])


@router.get(
    "/{activity_uuid}/collab/access",
    response_model=CollabAccessRead,
    summary="Check collaborative editing access to an activity",
    description=(
        "Role of the signed-in user in the activity's collaborative editing room "
        "(editor: may edit the activity; viewer: an active course author without edit "
        "rights) and the identity shown to other editors. Used by the collab server on "
        "connect and on its periodic re-check, and by the editor before connecting."
    ),
    responses={
        200: {"description": "The user's role and presence identity.", "model": CollabAccessRead},
        401: {"description": "Authentication required"},
        403: {"description": "Not allowed to edit this activity"},
        404: {"description": "Activity not found, or not a page activity"},
        503: {"description": "Collaborative editing is not configured"},
    },
)
async def api_get_collab_access(
    request: Request,
    activity_uuid: str,
    locale: Optional[str] = Query(None, max_length=20, description="A language version's room (activity:{uuid}:{locale})."),
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> CollabAccessRead:
    return await get_collab_access(request, activity_uuid, current_user, db_session, locale=locale)


@router.post(
    "/{activity_uuid}/versions/named",
    response_model=NamedVersionRead,
    summary="Name the current version of an activity",
    description=(
        "Gives the activity's current content a name in its version history (creating the "
        "history entry when the current version has none). Requires edit rights on the activity."
    ),
    responses={
        200: {"description": "The named version.", "model": NamedVersionRead},
        401: {"description": "Authentication required"},
        403: {"description": "Not allowed to edit this activity, or versioning unavailable on the plan"},
        404: {"description": "Activity not found"},
        422: {"description": "Invalid label"},
    },
)
async def api_name_current_version(
    request: Request,
    activity_uuid: str,
    body: NamedVersionWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> NamedVersionRead:
    return await name_current_version(request, activity_uuid, body, current_user, db_session)


@router.put(
    "/{activity_uuid}/content/autosave",
    response_model=AutosaveResult,
    summary="Autosave an activity page's content",
    description=(
        "Saves the content of a page activity from the autosaving editor (live editing off or "
        "unavailable). Refused with 409 when the page changed since base_version. The version "
        "history keeps one entry per person every few minutes."
    ),
    responses={
        200: {"description": "Saved.", "model": AutosaveResult},
        401: {"description": "Authentication required"},
        403: {"description": "Not allowed to edit this activity"},
        404: {"description": "Activity not found, or not a page activity"},
        409: {"description": "The page changed since base_version"},
        422: {"description": "Invalid content"},
    },
)
async def api_autosave_content(
    request: Request,
    activity_uuid: str,
    body: AutosaveWrite,
    locale: Optional[str] = Query(None, max_length=20, description="A language version's room (activity:{uuid}:{locale})."),
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> AutosaveResult:
    if locale is not None:
        return await autosave_translation(request, activity_uuid, locale, body, current_user, db_session)
    return await autosave_content(request, activity_uuid, body, current_user, db_session)


@router.get(
    "/{activity_uuid}/live-editing",
    response_model=ActivityLiveEditingRead,
    summary="Get an activity's live editing setting",
    description="The activity's override (default, on, off), the organization default and the result.",
    responses={200: {"model": ActivityLiveEditingRead}, 403: {"description": "Not allowed to edit this activity"}, 404: {"description": "Activity not found"}},
)
async def api_get_activity_live_editing(
    request: Request,
    activity_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> ActivityLiveEditingRead:
    return await get_activity_live_editing(request, activity_uuid, current_user, db_session)


@router.put(
    "/{activity_uuid}/live-editing",
    response_model=ActivityLiveEditingRead,
    summary="Set an activity's live editing override",
    description=(
        "Overrides the organization's live editing default for one activity (requires edit rights "
        "on its course). Turning it off saves and closes the activity's live editing room."
    ),
    responses={200: {"model": ActivityLiveEditingRead}, 403: {"description": "Not allowed to edit this activity"}, 404: {"description": "Activity not found"}, 422: {"description": "Invalid mode"}},
)
async def api_set_activity_live_editing(
    request: Request,
    activity_uuid: str,
    body: ActivityLiveEditingWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> ActivityLiveEditingRead:
    return await set_activity_live_editing(request, activity_uuid, body, current_user, db_session)


@internal_router.get(
    "/{activity_uuid}/collab/state",
    response_model=CollabStateRead,
    summary="Fetch an activity's collaborative editing state",
    description=(
        "Content, current version and stored Yjs document of a page activity. Internal "
        "endpoint for the collab server; requires the shared internal key header."
    ),
    responses={
        200: {"description": "The activity's state.", "model": CollabStateRead},
        403: {"description": "Invalid internal key"},
        404: {"description": "Activity not found, or not a page activity"},
    },
)
async def api_get_collab_state(
    activity_uuid: str,
    locale: Optional[str] = Query(None, max_length=20, description="A language version's room (activity:{uuid}:{locale})."),
    db_session: AsyncSession = Depends(get_db_session),
) -> CollabStateRead:
    if locale is not None:
        return await get_translation_collab_state(activity_uuid, locale, db_session)
    return await get_collab_state(activity_uuid, db_session)


@internal_router.put(
    "/{activity_uuid}/collab/state",
    response_model=CollabStateWriteResult,
    summary="Save an activity's collaborative editing state",
    description=(
        "Saves the collab server's Yjs document and, when given, the content (bumping the "
        "version and updating the version history, coalesced). Refused with 409 when the "
        "activity changed since base_version. Internal endpoint for the collab server; "
        "requires the shared internal key header."
    ),
    responses={
        200: {"description": "Saved.", "model": CollabStateWriteResult},
        403: {"description": "Invalid internal key"},
        404: {"description": "Activity not found, or not a page activity"},
        409: {"description": "The activity changed since base_version"},
        413: {"description": "Document is too large"},
        422: {"description": "Invalid body"},
    },
)
async def api_put_collab_state(
    activity_uuid: str,
    body: CollabStateWrite,
    locale: Optional[str] = Query(None, max_length=20, description="A language version's room (activity:{uuid}:{locale})."),
    db_session: AsyncSession = Depends(get_db_session),
) -> CollabStateWriteResult:
    if locale is not None:
        return await put_translation_collab_state(activity_uuid, locale, body, db_session)
    return await put_collab_state(activity_uuid, body, db_session)


# Organization default, mounted under /orgs
org_router = APIRouter()


@org_router.get(
    "/{org_id}/live-editing",
    response_model=OrgLiveEditingRead,
    summary="Get the organization's live editing default",
    description="Whether activities are edited live (real-time collaboration and autosave) unless overridden.",
    responses={200: {"model": OrgLiveEditingRead}},
)
async def api_get_org_live_editing(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> OrgLiveEditingRead:
    return await get_org_live_editing(org_id, db_session)


@org_router.put(
    "/{org_id}/live-editing",
    response_model=OrgLiveEditingRead,
    summary="Set the organization's live editing default",
    description=(
        "Turns live collaboration and autosave on or off for the organization's activities (org "
        "settings rights). Turning it off saves and closes the open live editing rooms."
    ),
    responses={200: {"model": OrgLiveEditingRead}, 403: {"description": "Not allowed to change organization settings"}, 404: {"description": "Organization not found"}},
)
async def api_set_org_live_editing(
    request: Request,
    org_id: int,
    body: OrgLiveEditingWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> OrgLiveEditingRead:
    return await set_org_live_editing(request, org_id, body, current_user, db_session)
