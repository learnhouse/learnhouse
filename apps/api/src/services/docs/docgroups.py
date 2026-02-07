from typing import List
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request
from src.db.docs.docspaces import DocSpace
from src.db.docs.docsections import DocSection
from src.db.docs.docgroups import DocGroup, DocGroupCreate, DocGroupUpdate, DocGroupRead
from src.db.docs.docpages import DocPage
from src.db.users import PublicUser, AnonymousUser
from src.security.rbac import AccessAction, check_resource_access


async def create_docgroup(
    request: Request,
    docsection_uuid: str,
    group_object: DocGroupCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    section = db_session.exec(
        select(DocSection).where(DocSection.docsection_uuid == docsection_uuid)
    ).first()
    if not section:
        raise HTTPException(status_code=404, detail="DocSection not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == section.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    # Unified order: shared between ungrouped pages and groups
    max_page_order = db_session.exec(
        select(DocPage.order)
        .where(DocPage.docsection_id == section.id, DocPage.docgroup_id.is_(None))
        .order_by(DocPage.order.desc())
    ).first()
    max_group_order = db_session.exec(
        select(DocGroup.order)
        .where(DocGroup.docsection_id == section.id)
        .order_by(DocGroup.order.desc())
    ).first()
    next_order = max((max_page_order or 0), (max_group_order or 0)) + 1

    group = DocGroup(
        name=group_object.name,
        description=group_object.description,
        group_type=group_object.group_type,
        api_config=group_object.api_config,
        order=next_order,
        org_id=section.org_id,
        docspace_id=section.docspace_id,
        docsection_id=section.id,
        docgroup_uuid=f"docgroup_{uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    return DocGroupRead(**group.model_dump())


async def get_docgroups(
    request: Request,
    docsection_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[DocGroupRead]:
    section = db_session.exec(
        select(DocSection).where(DocSection.docsection_uuid == docsection_uuid)
    ).first()
    if not section:
        raise HTTPException(status_code=404, detail="DocSection not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == section.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    groups = db_session.exec(
        select(DocGroup)
        .where(DocGroup.docsection_id == section.id)
        .order_by(DocGroup.order)
    ).all()

    return [DocGroupRead(**g.model_dump()) for g in groups]


async def update_docgroup(
    request: Request,
    docgroup_uuid: str,
    group_object: DocGroupUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    group = db_session.exec(
        select(DocGroup).where(DocGroup.docgroup_uuid == docgroup_uuid)
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="DocGroup not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == group.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for var, value in vars(group_object).items():
        if value is not None:
            setattr(group, var, value)

    group.update_date = str(datetime.now())

    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    return DocGroupRead(**group.model_dump())


async def delete_docgroup(
    request: Request,
    docgroup_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    group = db_session.exec(
        select(DocGroup).where(DocGroup.docgroup_uuid == docgroup_uuid)
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="DocGroup not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == group.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.DELETE)

    db_session.delete(group)
    db_session.commit()

    return {"detail": "DocGroup deleted"}


async def reorder_docgroups(
    request: Request,
    docsection_uuid: str,
    group_ids: List[int],
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    section = db_session.exec(
        select(DocSection).where(DocSection.docsection_uuid == docsection_uuid)
    ).first()
    if not section:
        raise HTTPException(status_code=404, detail="DocSection not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == section.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for order, group_id in enumerate(group_ids):
        group = db_session.exec(
            select(DocGroup).where(DocGroup.id == group_id, DocGroup.docsection_id == section.id)
        ).first()
        if group:
            group.order = order
            group.update_date = str(datetime.now())
            db_session.add(group)

    db_session.commit()

    return {"detail": "Groups reordered"}
