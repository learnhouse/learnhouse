from typing import List, Optional
from fastapi import APIRouter, Depends, Request, Query
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.docs.docspaces import (
    DocSpaceCreate,
    DocSpaceRead,
    DocSpaceUpdate,
    FullDocSpaceRead,
)
from src.db.docs.docpages import DocPageSearchResult
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_docs_feature
from src.services.docs.docspaces import (
    create_docspace,
    get_docspace,
    get_docspace_meta,
    get_docspace_by_slug,
    get_docspace_meta_by_slug,
    get_docspaces_by_org,
    update_docspace,
    delete_docspace,
    set_default_docspace,
    get_default_docspace,
    search_docpages,
)

router = APIRouter(dependencies=[Depends(require_docs_feature)])


@router.post("/")
async def api_create_docspace(
    request: Request,
    org_id: int,
    docspace_object: DocSpaceCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocSpaceRead:
    return await create_docspace(request, org_id, docspace_object, current_user, db_session)


@router.get("/{docspace_uuid}")
async def api_get_docspace(
    request: Request,
    docspace_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocSpaceRead:
    return await get_docspace(request, docspace_uuid, current_user, db_session)


@router.get("/{docspace_uuid}/meta")
async def api_get_docspace_meta(
    request: Request,
    docspace_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> FullDocSpaceRead:
    return await get_docspace_meta(request, docspace_uuid, current_user, db_session)


@router.get("/org_slug/{org_slug}/page/{page}/limit/{limit}")
async def api_get_docspaces_by_org(
    request: Request,
    page: int,
    limit: int,
    org_slug: str,
    include_unpublished: bool = False,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[DocSpaceRead]:
    return await get_docspaces_by_org(
        request, current_user, org_slug, db_session, page, limit, include_unpublished
    )


@router.get("/{docspace_uuid}/search")
async def api_search_docpages(
    request: Request,
    docspace_uuid: str,
    query: str = Query(..., min_length=1, max_length=200),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[DocPageSearchResult]:
    return await search_docpages(
        request, current_user, docspace_uuid, query, db_session, page, limit
    )


@router.put("/{docspace_uuid}")
async def api_update_docspace(
    request: Request,
    docspace_uuid: str,
    docspace_object: DocSpaceUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocSpaceRead:
    return await update_docspace(request, docspace_object, docspace_uuid, current_user, db_session)


@router.delete("/{docspace_uuid}")
async def api_delete_docspace(
    request: Request,
    docspace_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await delete_docspace(request, docspace_uuid, current_user, db_session)


@router.put("/{docspace_uuid}/set-default")
async def api_set_default_docspace(
    request: Request,
    docspace_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocSpaceRead:
    return await set_default_docspace(request, docspace_uuid, current_user, db_session)


@router.get("/org_slug/{org_slug}/slug/{docspace_slug}")
async def api_get_docspace_by_slug(
    request: Request,
    org_slug: str,
    docspace_slug: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocSpaceRead:
    return await get_docspace_by_slug(request, org_slug, docspace_slug, current_user, db_session)


@router.get("/org_slug/{org_slug}/slug/{docspace_slug}/meta")
async def api_get_docspace_meta_by_slug(
    request: Request,
    org_slug: str,
    docspace_slug: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> FullDocSpaceRead:
    return await get_docspace_meta_by_slug(request, org_slug, docspace_slug, current_user, db_session)


@router.get("/org_slug/{org_slug}/default")
async def api_get_default_docspace(
    request: Request,
    org_slug: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> Optional[DocSpaceRead]:
    return await get_default_docspace(request, org_slug, current_user, db_session)
