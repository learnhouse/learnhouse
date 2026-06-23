from typing import List, Optional
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from src.core.events.database import get_db_session
from src.db.media.media import MediaCreate, MediaRead, MediaTypeEnum, MediaUpdate
from src.security.auth import get_current_user
from src.services.users.users import PublicUser
from src.services.media.media import (
    create_media,
    get_media,
    get_media_list,
    update_media,
    delete_media,
)


router = APIRouter()


@router.post(
    "/",
    response_model=MediaRead,
    summary="Create media",
    description="Create a media asset. For UPLOAD, send a multipart file. For EMBED, send a url.",
)
async def api_create_media(
    request: Request,
    org_id: int = Form(...),
    name: str = Form(...),
    media_type: MediaTypeEnum = Form(MediaTypeEnum.UPLOAD),
    description: Optional[str] = Form(""),
    url: Optional[str] = Form(""),
    public: bool = Form(True),
    folder_uuid: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> MediaRead:
    media_object = MediaCreate(
        org_id=org_id,
        name=name,
        media_type=media_type,
        description=description or "",
        url=url or "",
        public=public,
        folder_uuid=folder_uuid,
    )
    return await create_media(request, media_object, current_user, db_session, file)


@router.get(
    "/{media_uuid}",
    response_model=MediaRead,
    summary="Get media",
    description="Get a single media asset by its UUID.",
)
async def api_get_media(
    request: Request,
    media_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> MediaRead:
    return await get_media(request, media_uuid, current_user, db_session)


@router.get(
    "/org/{org_id}/page/{page}/limit/{limit}",
    response_model=List[MediaRead],
    summary="List media for org",
    description="List media assets for an organization, paginated.",
)
async def api_get_media_list(
    request: Request,
    page: int,
    limit: int,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[MediaRead]:
    return await get_media_list(request, org_id, current_user, db_session, page, limit)


@router.put(
    "/{media_uuid}",
    response_model=MediaRead,
    summary="Update media",
    description="Update a media asset's metadata.",
)
async def api_update_media(
    request: Request,
    media_object: MediaUpdate,
    media_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> MediaRead:
    return await update_media(request, media_object, media_uuid, current_user, db_session)


@router.delete(
    "/{media_uuid}",
    summary="Delete media",
    description="Delete a media asset and remove it from any folders.",
)
async def api_delete_media(
    request: Request,
    media_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await delete_media(request, media_uuid, current_user, db_session)
