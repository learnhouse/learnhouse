from typing import List
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.docs.docsections import DocSectionCreate, DocSectionRead, DocSectionUpdate, SectionChildOrderItem
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_docs_feature
from src.services.docs.docsections import (
    create_docsection,
    get_docsections,
    update_docsection,
    delete_docsection,
    reorder_docsections,
    reorder_section_children,
)

router = APIRouter(dependencies=[Depends(require_docs_feature)])


@router.post("/{docspace_uuid}/sections")
async def api_create_docsection(
    request: Request,
    docspace_uuid: str,
    section_object: DocSectionCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocSectionRead:
    return await create_docsection(request, docspace_uuid, section_object, current_user, db_session)


@router.get("/{docspace_uuid}/sections")
async def api_get_docsections(
    request: Request,
    docspace_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[DocSectionRead]:
    return await get_docsections(request, docspace_uuid, current_user, db_session)


@router.put("/sections/{docsection_uuid}")
async def api_update_docsection(
    request: Request,
    docsection_uuid: str,
    section_object: DocSectionUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> DocSectionRead:
    return await update_docsection(request, docsection_uuid, section_object, current_user, db_session)


@router.delete("/sections/{docsection_uuid}")
async def api_delete_docsection(
    request: Request,
    docsection_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await delete_docsection(request, docsection_uuid, current_user, db_session)


@router.put("/{docspace_uuid}/sections/order")
async def api_reorder_docsections(
    request: Request,
    docspace_uuid: str,
    section_ids: List[int],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await reorder_docsections(request, docspace_uuid, section_ids, current_user, db_session)


@router.put("/sections/{docsection_uuid}/children/order")
async def api_reorder_section_children(
    request: Request,
    docsection_uuid: str,
    children: List[SectionChildOrderItem],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await reorder_section_children(request, docsection_uuid, children, current_user, db_session)
