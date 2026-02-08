from typing import List
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request
from src.db.docs.docspaces import DocSpace
from src.db.docs.docsections import DocSection
from src.db.docs.docgroups import DocGroup
from src.db.docs.docpages import DocPage, DocPageCreate, DocPageUpdate, DocPageMove, DocPageRead
from src.db.users import PublicUser, AnonymousUser
from src.security.rbac import AccessAction, check_resource_access
import re


def _get_next_section_child_order(db_session: Session, section_id: int) -> int:
    """Get the next order value shared between ungrouped pages and groups in a section."""
    max_page_order = db_session.exec(
        select(DocPage.order)
        .where(DocPage.docsection_id == section_id, DocPage.docgroup_id.is_(None))
        .order_by(DocPage.order.desc())
    ).first()
    max_group_order = db_session.exec(
        select(DocGroup.order)
        .where(DocGroup.docsection_id == section_id)
        .order_by(DocGroup.order.desc())
    ).first()
    return max((max_page_order or 0), (max_group_order or 0)) + 1


def _generate_slug(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')


async def create_docpage_in_section(
    request: Request,
    docsection_uuid: str,
    page_object: DocPageCreate,
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

    next_order = _get_next_section_child_order(db_session, section.id)

    page = DocPage(
        name=page_object.name,
        page_type=page_object.page_type,
        icon=page_object.icon,
        content=page_object.content,
        published=page_object.published,
        order=next_order,
        org_id=section.org_id,
        docspace_id=section.docspace_id,
        docsection_id=section.id,
        docgroup_id=None,
        docpage_uuid=f"docpage_{uuid4()}",
        slug=_generate_slug(page_object.name),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    return DocPageRead(**page.model_dump())


async def create_docpage_in_group(
    request: Request,
    docgroup_uuid: str,
    page_object: DocPageCreate,
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

    max_order = db_session.exec(
        select(DocPage.order)
        .where(DocPage.docgroup_id == group.id)
        .order_by(DocPage.order.desc())
    ).first()
    next_order = (max_order or 0) + 1

    page = DocPage(
        name=page_object.name,
        page_type=page_object.page_type,
        icon=page_object.icon,
        content=page_object.content,
        published=page_object.published,
        order=next_order,
        org_id=group.org_id,
        docspace_id=group.docspace_id,
        docsection_id=group.docsection_id,
        docgroup_id=group.id,
        docpage_uuid=f"docpage_{uuid4()}",
        slug=_generate_slug(page_object.name),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    return DocPageRead(**page.model_dump())


async def get_docpage(
    request: Request,
    docpage_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    page = db_session.exec(
        select(DocPage).where(DocPage.docpage_uuid == docpage_uuid)
    ).first()
    if not page:
        raise HTTPException(status_code=404, detail="DocPage not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == page.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    page_read = DocPageRead(**page.model_dump())

    # Attach subpages if this is a top-level page
    if page.parent_page_id is None:
        subpages = db_session.exec(
            select(DocPage)
            .where(DocPage.parent_page_id == page.id)
            .order_by(DocPage.order)
        ).all()
        if subpages:
            page_read.subpages = [DocPageRead(**sp.model_dump()) for sp in subpages]

    return page_read


async def update_docpage(
    request: Request,
    docpage_uuid: str,
    page_object: DocPageUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    page = db_session.exec(
        select(DocPage).where(DocPage.docpage_uuid == docpage_uuid)
    ).first()
    if not page:
        raise HTTPException(status_code=404, detail="DocPage not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == page.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for var, value in vars(page_object).items():
        if value is not None:
            setattr(page, var, value)

    page.update_date = str(datetime.now())

    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    return DocPageRead(**page.model_dump())


async def move_docpage(
    request: Request,
    docpage_uuid: str,
    move_object: DocPageMove,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    page = db_session.exec(
        select(DocPage).where(DocPage.docpage_uuid == docpage_uuid)
    ).first()
    if not page:
        raise HTTPException(status_code=404, detail="DocPage not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == page.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    if move_object.docgroup_uuid is not None:
        # Move into a group
        group = db_session.exec(
            select(DocGroup).where(DocGroup.docgroup_uuid == move_object.docgroup_uuid)
        ).first()
        if not group:
            raise HTTPException(status_code=404, detail="DocGroup not found")
        page.docgroup_id = group.id

        # Set order to end of group if not specified
        if move_object.order is not None:
            page.order = move_object.order
        else:
            max_order = db_session.exec(
                select(DocPage.order)
                .where(DocPage.docgroup_id == group.id)
                .order_by(DocPage.order.desc())
            ).first()
            page.order = (max_order or 0) + 1
    else:
        # Ungroup — move to section level
        page.docgroup_id = None

        if move_object.order is not None:
            page.order = move_object.order
        else:
            max_order = db_session.exec(
                select(DocPage.order)
                .where(DocPage.docsection_id == page.docsection_id, DocPage.docgroup_id.is_(None))
                .order_by(DocPage.order.desc())
            ).first()
            page.order = (max_order or 0) + 1

    page.update_date = str(datetime.now())
    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    return DocPageRead(**page.model_dump())


async def delete_docpage(
    request: Request,
    docpage_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    page = db_session.exec(
        select(DocPage).where(DocPage.docpage_uuid == docpage_uuid)
    ).first()
    if not page:
        raise HTTPException(status_code=404, detail="DocPage not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == page.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.DELETE)

    db_session.delete(page)
    db_session.commit()

    return {"detail": "DocPage deleted"}


async def reorder_docpages(
    request: Request,
    docsection_uuid: str,
    page_ids: List[int],
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

    for order, page_id in enumerate(page_ids):
        page = db_session.exec(
            select(DocPage).where(DocPage.id == page_id, DocPage.docsection_id == section.id)
        ).first()
        if page:
            page.order = order
            page.update_date = str(datetime.now())
            db_session.add(page)

    db_session.commit()

    return {"detail": "Pages reordered"}


async def create_subpage(
    request: Request,
    parent_docpage_uuid: str,
    page_object: DocPageCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    parent = db_session.exec(
        select(DocPage).where(DocPage.docpage_uuid == parent_docpage_uuid)
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent page not found")

    # Only 1 level of nesting
    if parent.parent_page_id is not None:
        raise HTTPException(status_code=400, detail="Cannot create subpages under a subpage (max 1 level)")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == parent.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    max_order = db_session.exec(
        select(DocPage.order)
        .where(DocPage.parent_page_id == parent.id)
        .order_by(DocPage.order.desc())
    ).first()
    next_order = (max_order or 0) + 1

    subpage = DocPage(
        name=page_object.name,
        page_type=page_object.page_type,
        icon=page_object.icon,
        content=page_object.content,
        published=page_object.published,
        order=next_order,
        org_id=parent.org_id,
        docspace_id=parent.docspace_id,
        docsection_id=parent.docsection_id,
        docgroup_id=parent.docgroup_id,
        parent_page_id=parent.id,
        docpage_uuid=f"docpage_{uuid4()}",
        slug=_generate_slug(page_object.name),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(subpage)
    db_session.commit()
    db_session.refresh(subpage)

    return DocPageRead(**subpage.model_dump())


async def get_subpages(
    request: Request,
    parent_docpage_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[DocPageRead]:
    parent = db_session.exec(
        select(DocPage).where(DocPage.docpage_uuid == parent_docpage_uuid)
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent page not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == parent.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    subpages = db_session.exec(
        select(DocPage)
        .where(DocPage.parent_page_id == parent.id)
        .order_by(DocPage.order)
    ).all()

    return [DocPageRead(**sp.model_dump()) for sp in subpages]


async def reorder_subpages(
    request: Request,
    parent_docpage_uuid: str,
    page_ids: List[int],
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    parent = db_session.exec(
        select(DocPage).where(DocPage.docpage_uuid == parent_docpage_uuid)
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent page not found")

    docspace = db_session.exec(
        select(DocSpace).where(DocSpace.id == parent.docspace_id)
    ).first()
    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for order, page_id in enumerate(page_ids):
        subpage = db_session.exec(
            select(DocPage).where(DocPage.id == page_id, DocPage.parent_page_id == parent.id)
        ).first()
        if subpage:
            subpage.order = order
            subpage.update_date = str(datetime.now())
            db_session.add(subpage)

    db_session.commit()

    return {"detail": "Subpages reordered"}


