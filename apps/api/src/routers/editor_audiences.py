from typing import List

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.editor_audiences import EditorAudienceCreate, EditorAudienceRead, EditorAudienceUpdate
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.editor_audiences import (
    create_editor_audience,
    delete_editor_audience,
    list_editor_audiences,
    update_editor_audience,
)

router = APIRouter()


@router.get(
    "/",
    response_model=List[EditorAudienceRead],
    summary="List saved audiences",
    description="Named rule sets the organization's authors reuse in conditional blocks.",
)
async def api_list_editor_audiences(
    request: Request,
    org_id: int = Query(...),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[EditorAudienceRead]:
    return await list_editor_audiences(request, org_id, current_user, db_session)


@router.post("/", response_model=EditorAudienceRead, summary="Save an audience")
async def api_create_editor_audience(
    request: Request,
    audience_object: EditorAudienceCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> EditorAudienceRead:
    return await create_editor_audience(request, audience_object, current_user, db_session)


@router.put("/{audience_uuid}", response_model=EditorAudienceRead, summary="Update an audience")
async def api_update_editor_audience(
    request: Request,
    audience_uuid: str,
    audience_object: EditorAudienceUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> EditorAudienceRead:
    return await update_editor_audience(request, audience_uuid, audience_object, current_user, db_session)


@router.delete("/{audience_uuid}", summary="Delete an audience")
async def api_delete_editor_audience(
    request: Request,
    audience_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await delete_editor_audience(request, audience_uuid, current_user, db_session)
