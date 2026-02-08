from typing import List
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.docs.docgroups import DocGroupCreate, DocGroupRead, DocGroupUpdate
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_docs_feature
from src.services.docs.docgroups import (
    create_docgroup,
    get_docgroups,
    update_docgroup,
    delete_docgroup,
    reorder_docgroups,
)

router = APIRouter(dependencies=[Depends(require_docs_feature)])


@router.post("/sections/{docsection_uuid}/groups")
async def api_create_docgroup(
    request: Request,
    docsection_uuid: str,
    group_object: DocGroupCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocGroupRead:
    return await create_docgroup(request, docsection_uuid, group_object, current_user, db_session)


@router.get("/sections/{docsection_uuid}/groups")
async def api_get_docgroups(
    request: Request,
    docsection_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[DocGroupRead]:
    return await get_docgroups(request, docsection_uuid, current_user, db_session)


@router.put("/groups/{docgroup_uuid}")
async def api_update_docgroup(
    request: Request,
    docgroup_uuid: str,
    group_object: DocGroupUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocGroupRead:
    return await update_docgroup(request, docgroup_uuid, group_object, current_user, db_session)


@router.delete("/groups/{docgroup_uuid}")
async def api_delete_docgroup(
    request: Request,
    docgroup_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await delete_docgroup(request, docgroup_uuid, current_user, db_session)


@router.put("/sections/{docsection_uuid}/groups/order")
async def api_reorder_docgroups(
    request: Request,
    docsection_uuid: str,
    group_ids: List[int],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await reorder_docgroups(request, docsection_uuid, group_ids, current_user, db_session)
