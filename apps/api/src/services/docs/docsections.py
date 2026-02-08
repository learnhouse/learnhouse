from typing import List
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request
from src.db.docs.docspaces import DocSpace
from src.db.docs.docsections import DocSection, DocSectionCreate, DocSectionUpdate, DocSectionRead, SectionChildOrderItem
from src.db.docs.docgroups import DocGroup
from src.db.docs.docpages import DocPage
from src.db.users import PublicUser, AnonymousUser
from src.security.rbac import AccessAction, check_resource_access
import re


def _generate_slug(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')


async def create_docsection(
    request: Request,
    docspace_uuid: str,
    section_object: DocSectionCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    ).first()
    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    # Get next order value
    max_order = db_session.exec(
        select(DocSection.order)
        .where(DocSection.docspace_id == docspace.id)
        .order_by(DocSection.order.desc())
    ).first()
    next_order = (max_order or 0) + 1

    section = DocSection(
        name=section_object.name,
        description=section_object.description,
        published=section_object.published,
        order=next_order,
        org_id=docspace.org_id,
        docspace_id=docspace.id,
        docsection_uuid=f"docsection_{uuid4()}",
        slug=_generate_slug(section_object.name),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(section)
    db_session.commit()
    db_session.refresh(section)

    return DocSectionRead(**section.model_dump())


async def get_docsections(
    request: Request,
    docspace_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[DocSectionRead]:
    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    ).first()
    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    sections = db_session.exec(
        select(DocSection)
        .where(DocSection.docspace_id == docspace.id)
        .order_by(DocSection.order)
    ).all()

    return [DocSectionRead(**s.model_dump()) for s in sections]


async def update_docsection(
    request: Request,
    docsection_uuid: str,
    section_object: DocSectionUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    section = db_session.exec(
        select(DocSection).where(DocSection.docsection_uuid == docsection_uuid)
    ).first()
    if not section:
        raise HTTPException(status_code=404, detail="DocSection not found")

    # Check access via parent docspace
    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == section.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for var, value in vars(section_object).items():
        if value is not None:
            setattr(section, var, value)

    section.update_date = str(datetime.now())

    db_session.add(section)
    db_session.commit()
    db_session.refresh(section)

    return DocSectionRead(**section.model_dump())


async def delete_docsection(
    request: Request,
    docsection_uuid: str,
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
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.DELETE)

    db_session.delete(section)
    db_session.commit()

    return {"detail": "DocSection deleted"}


async def reorder_docsections(
    request: Request,
    docspace_uuid: str,
    section_ids: List[int],
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    ).first()
    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for order, section_id in enumerate(section_ids):
        section = db_session.exec(
            select(DocSection).where(DocSection.id == section_id, DocSection.docspace_id == docspace.id)
        ).first()
        if section:
            section.order = order
            section.update_date = str(datetime.now())
            db_session.add(section)

    db_session.commit()

    return {"detail": "Sections reordered"}


async def reorder_section_children(
    request: Request,
    docsection_uuid: str,
    children: List[SectionChildOrderItem],
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    """Reorder ungrouped pages and groups within a section using a unified order."""
    section = db_session.exec(
        select(DocSection).where(DocSection.docsection_uuid == docsection_uuid)
    ).first()
    if not section:
        raise HTTPException(status_code=404, detail="DocSection not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == section.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for order, item in enumerate(children):
        if item.type == "page":
            page = db_session.exec(
                select(DocPage).where(
                    DocPage.id == item.id,
                    DocPage.docsection_id == section.id,
                    DocPage.docgroup_id.is_(None),
                )
            ).first()
            if page:
                page.order = order
                page.update_date = str(datetime.now())
                db_session.add(page)
        elif item.type == "group":
            group = db_session.exec(
                select(DocGroup).where(
                    DocGroup.id == item.id,
                    DocGroup.docsection_id == section.id,
                )
            ).first()
            if group:
                group.order = order
                group.update_date = str(datetime.now())
                db_session.add(group)

    db_session.commit()

    return {"detail": "Section children reordered"}
