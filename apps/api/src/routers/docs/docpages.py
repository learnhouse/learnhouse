from typing import List
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.docs.docpages import DocPageCreate, DocPageRead, DocPageUpdate, DocPageMove
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_docs_feature
from src.services.docs.docpages import (
    create_docpage_in_section,
    create_docpage_in_group,
    get_docpage,
    update_docpage,
    move_docpage,
    delete_docpage,
    reorder_docpages,
    create_subpage,
    get_subpages,
    reorder_subpages,
)

router = APIRouter(dependencies=[Depends(require_docs_feature)])


@router.post("/sections/{docsection_uuid}/pages")
async def api_create_docpage_in_section(
    request: Request,
    docsection_uuid: str,
    page_object: DocPageCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocPageRead:
    return await create_docpage_in_section(request, docsection_uuid, page_object, current_user, db_session)


@router.post("/groups/{docgroup_uuid}/pages")
async def api_create_docpage_in_group(
    request: Request,
    docgroup_uuid: str,
    page_object: DocPageCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocPageRead:
    return await create_docpage_in_group(request, docgroup_uuid, page_object, current_user, db_session)


@router.get("/pages/{docpage_uuid}")
async def api_get_docpage(
    request: Request,
    docpage_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocPageRead:
    return await get_docpage(request, docpage_uuid, current_user, db_session)


@router.put("/pages/{docpage_uuid}")
async def api_update_docpage(
    request: Request,
    docpage_uuid: str,
    page_object: DocPageUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocPageRead:
    return await update_docpage(request, docpage_uuid, page_object, current_user, db_session)


@router.put("/pages/{docpage_uuid}/move")
async def api_move_docpage(
    request: Request,
    docpage_uuid: str,
    move_object: DocPageMove,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocPageRead:
    return await move_docpage(request, docpage_uuid, move_object, current_user, db_session)


@router.delete("/pages/{docpage_uuid}")
async def api_delete_docpage(
    request: Request,
    docpage_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await delete_docpage(request, docpage_uuid, current_user, db_session)


@router.put("/sections/{docsection_uuid}/pages/order")
async def api_reorder_docpages(
    request: Request,
    docsection_uuid: str,
    page_ids: List[int],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await reorder_docpages(request, docsection_uuid, page_ids, current_user, db_session)


# ─── Subpage endpoints ───


@router.post("/pages/{docpage_uuid}/subpages")
async def api_create_subpage(
    request: Request,
    docpage_uuid: str,
    page_object: DocPageCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocPageRead:
    return await create_subpage(request, docpage_uuid, page_object, current_user, db_session)


@router.get("/pages/{docpage_uuid}/subpages")
async def api_get_subpages(
    request: Request,
    docpage_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[DocPageRead]:
    return await get_subpages(request, docpage_uuid, current_user, db_session)


@router.put("/pages/{docpage_uuid}/subpages/order")
async def api_reorder_subpages(
    request: Request,
    docpage_uuid: str,
    page_ids: List[int],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await reorder_subpages(request, docpage_uuid, page_ids, current_user, db_session)

