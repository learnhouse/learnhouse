from typing import List, Optional
from fastapi import APIRouter, Depends, File, Request, UploadFile
from src.core.events.database import get_db_session
from src.db.folders.folders import FolderContentItem, FolderCreate, FolderRead, FolderUpdate
from src.security.auth import get_current_user
from src.services.users.users import PublicUser
from src.services.folders.folders import (
    create_folder,
    get_folder,
    get_folders,
    update_folder,
    delete_folder,
    add_folder_content,
    remove_folder_content,
    move_folder_content,
    get_org_root_items,
    add_org_root_content,
    remove_org_root_content,
    upload_folder_thumbnail,
    search_library,
)


router = APIRouter()


@router.post(
    "/",
    response_model=FolderRead,
    summary="Create folder",
    description="Create a new folder (optionally nested under a parent folder) within an organization.",
)
async def api_create_folder(
    request: Request,
    folder_object: FolderCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> FolderRead:
    return await create_folder(request, folder_object, current_user, db_session)


@router.get(
    "/{folder_uuid}",
    response_model=FolderRead,
    summary="Get folder",
    description="Get a single folder by its UUID, including its sub-folders, items and breadcrumbs.",
)
async def api_get_folder(
    request: Request,
    folder_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> FolderRead:
    return await get_folder(request, folder_uuid, current_user, db_session)


@router.get(
    "/org/{org_id}/page/{page}/limit/{limit}",
    response_model=List[FolderRead],
    summary="List folders for org",
    description="List folders for an organization. By default lists root folders; pass `parent_folder_uuid` to list a folder's direct sub-folders.",
)
async def api_get_folders_by(
    request: Request,
    page: int,
    limit: int,
    org_id: str,
    parent_folder_uuid: Optional[str] = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[FolderRead]:
    return await get_folders(
        request, org_id, current_user, db_session, parent_folder_uuid, page, limit
    )


@router.get(
    "/org/{org_id}/search",
    summary="Search the library tree",
    description="Search folders and content across the whole library tree; each result includes its folder-path context.",
)
async def api_search_library(
    request: Request,
    org_id: str,
    q: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await search_library(request, org_id, q, current_user, db_session)


@router.get(
    "/org/{org_id}/root",
    response_model=List[FolderContentItem],
    summary="List org library root items",
    description="List the items placed directly at the organization library root (not inside any folder).",
)
async def api_get_org_root_items(
    request: Request,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[FolderContentItem]:
    return await get_org_root_items(request, org_id, current_user, db_session)


@router.post(
    "/org/{org_id}/content",
    summary="Add content to library root",
    description="Place a resource directly at the organization library root (Drive-like).",
)
async def api_add_org_root_content(
    request: Request,
    org_id: int,
    resource_uuid: str,
    position: int = 0,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await add_org_root_content(
        request, org_id, resource_uuid, current_user, db_session, position
    )


@router.delete(
    "/org/{org_id}/content",
    summary="Remove content from library root",
    description="Remove a resource placement from the organization library root.",
)
async def api_remove_org_root_content(
    request: Request,
    org_id: int,
    resource_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await remove_org_root_content(
        request, org_id, resource_uuid, current_user, db_session
    )


@router.put(
    "/{folder_uuid}/thumbnail",
    response_model=FolderRead,
    summary="Upload folder cover image",
    description="Upload a cover image (thumbnail) for a folder.",
)
async def api_upload_folder_thumbnail(
    request: Request,
    folder_uuid: str,
    thumbnail: UploadFile = File(...),
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> FolderRead:
    return await upload_folder_thumbnail(request, folder_uuid, thumbnail, current_user, db_session)


@router.put(
    "/{folder_uuid}",
    response_model=FolderRead,
    summary="Update folder",
    description="Update a folder by its UUID. Pass `parent_folder_uuid` to move it (use empty/'root' to move to root).",
)
async def api_update_folder(
    request: Request,
    folder_object: FolderUpdate,
    folder_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> FolderRead:
    return await update_folder(request, folder_object, folder_uuid, current_user, db_session)


@router.delete(
    "/{folder_uuid}",
    summary="Delete folder",
    description="Delete a folder by its UUID. Sub-folders and item placements are removed with it.",
)
async def api_delete_folder(
    request: Request,
    folder_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await delete_folder(request, folder_uuid, current_user, db_session)


@router.post(
    "/{folder_uuid}/content",
    response_model=FolderRead,
    summary="Add content to folder",
    description="Place a resource (course/podcast/community/board/playground/media) into a folder.",
)
async def api_add_folder_content(
    request: Request,
    folder_uuid: str,
    resource_uuid: str,
    position: int = 0,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> FolderRead:
    return await add_folder_content(
        request, folder_uuid, resource_uuid, current_user, db_session, position
    )


@router.delete(
    "/{folder_uuid}/content",
    response_model=FolderRead,
    summary="Remove content from folder",
    description="Remove a resource placement from a folder (the resource itself is not deleted).",
)
async def api_remove_folder_content(
    request: Request,
    folder_uuid: str,
    resource_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> FolderRead:
    return await remove_folder_content(
        request, folder_uuid, resource_uuid, current_user, db_session
    )


@router.post(
    "/{folder_uuid}/content/move",
    response_model=FolderRead,
    summary="Move content between folders",
    description="Move a resource placement from this folder to a target folder.",
)
async def api_move_folder_content(
    request: Request,
    folder_uuid: str,
    target_folder_uuid: str,
    resource_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> FolderRead:
    return await move_folder_content(
        request, folder_uuid, target_folder_uuid, resource_uuid, current_user, db_session
    )
