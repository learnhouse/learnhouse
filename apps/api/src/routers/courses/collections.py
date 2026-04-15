from typing import List
from fastapi import APIRouter, Depends, Request
from src.core.events.database import get_db_session
from src.db.collections import CollectionCreate, CollectionRead, CollectionUpdate
from src.security.auth import get_current_user
from src.services.users.users import PublicUser
from src.services.courses.collections import (
    create_collection,
    get_collection,
    get_collections,
    update_collection,
    delete_collection,
)


router = APIRouter()


@router.post(
    "/",
    response_model=CollectionRead,
    summary="Create collection",
    description="Create a new collection of courses within an organization.",
    responses={
        200: {"description": "Collection created.", "model": CollectionRead},
        403: {"description": "Caller lacks permission to create collections in this org"},
    },
)
async def api_create_collection(
    request: Request,
    collection_object: CollectionCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> CollectionRead:
    """
    Create new Collection
    """
    return await create_collection(request, collection_object, current_user, db_session)


@router.get(
    "/{collection_uuid}",
    response_model=CollectionRead,
    summary="Get collection",
    description="Get a single collection by its UUID.",
    responses={
        200: {"description": "Collection details.", "model": CollectionRead},
        404: {"description": "Collection not found"},
    },
)
async def api_get_collection(
    request: Request,
    collection_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> CollectionRead:
    """
    Get single collection by ID
    """
    return await get_collection(request, collection_uuid, current_user, db_session)


@router.get(
    "/org/{org_id}/page/{page}/limit/{limit}",
    response_model=List[CollectionRead],
    summary="List collections for org",
    description="Get collections for an organization, paginated by `page` and `limit`.",
    responses={
        200: {"description": "Paginated list of collections for the organization."},
    },
)
async def api_get_collections_by(
    request: Request,
    page: int,
    limit: int,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[CollectionRead]:
    """
    Get collections by page and limit
    """
    return await get_collections(request, org_id, current_user, db_session, page, limit)


@router.put(
    "/{collection_uuid}",
    response_model=CollectionRead,
    summary="Update collection",
    description="Update a collection by its UUID.",
    responses={
        200: {"description": "Collection updated.", "model": CollectionRead},
        403: {"description": "Caller lacks permission to update this collection"},
        404: {"description": "Collection not found"},
    },
)
async def api_update_collection(
    request: Request,
    collection_object: CollectionUpdate,
    collection_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> CollectionRead:
    """
    Update collection by ID
    """
    return await update_collection(
        request, collection_object, collection_uuid, current_user, db_session
    )


@router.delete(
    "/{collection_uuid}",
    summary="Delete collection",
    description="Delete a collection by its UUID. The collection is permanently removed.",
    responses={
        200: {"description": "Collection deleted."},
        403: {"description": "Caller lacks permission to delete this collection"},
        404: {"description": "Collection not found"},
    },
)
async def api_delete_collection(
    request: Request,
    collection_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete collection by ID
    """

    return await delete_collection(request, collection_uuid, current_user, db_session)
