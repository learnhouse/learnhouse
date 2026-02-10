from typing import List
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select, or_, and_, text
from fastapi import HTTPException, Request
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.docs.docspaces import (
    DocSpace,
    DocSpaceCreate,
    DocSpaceRead,
    DocSpaceUpdate,
    FullDocSpaceRead,
    DocSectionInMeta,
)
from src.db.docs.docsections import DocSection
from src.db.docs.docgroups import DocGroup, DocGroupRead
from src.db.docs.docpages import DocPage, DocPageRead, DocPageSearchResult
from src.security.rbac import AccessAction, check_resource_access
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.security.superadmin import is_user_superadmin
from src.security.features_utils.usage import (
    check_limits_with_usage,
    decrease_feature_usage,
    increase_feature_usage,
)


def _generate_slug(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')


async def create_docspace(
    request: Request,
    org_id: int,
    docspace_object: DocSpaceCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    await check_resource_access(request, db_session, current_user, "docspace_x", AccessAction.CREATE)

    check_limits_with_usage("docs", org_id, db_session)

    docspace = DocSpace(**docspace_object.model_dump(exclude={"org_id"}), org_id=org_id)
    docspace.docspace_uuid = f"docspace_{uuid4()}"
    docspace.slug = _generate_slug(docspace.name)
    docspace.creation_date = str(datetime.now())
    docspace.update_date = str(datetime.now())

    db_session.add(docspace)
    db_session.commit()
    db_session.refresh(docspace)

    # Make current user the creator
    if isinstance(current_user, APITokenUser):
        author_user_id = current_user.created_by_user_id
    else:
        author_user_id = current_user.id

    resource_author = ResourceAuthor(
        resource_uuid=docspace.docspace_uuid,
        user_id=author_user_id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(resource_author)
    db_session.commit()

    increase_feature_usage("docs", docspace.org_id, db_session)

    return DocSpaceRead(**docspace.model_dump())


async def get_docspace(
    request: Request,
    docspace_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    if not docspace.published:
        can_view = await _user_can_view_unpublished(request, docspace, current_user, db_session)
        if not can_view:
            raise HTTPException(status_code=404, detail="DocSpace not found")

    return DocSpaceRead(**docspace.model_dump())


async def get_docspace_meta(
    request: Request,
    docspace_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> FullDocSpaceRead:
    statement = select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    if not docspace.published:
        can_view = await _user_can_view_unpublished(request, docspace, current_user, db_session)
        if not can_view:
            raise HTTPException(status_code=404, detail="DocSpace not found")

    # Get sections ordered
    sections_stmt = (
        select(DocSection)
        .where(DocSection.docspace_id == docspace.id)
        .order_by(DocSection.order)
    )
    sections = db_session.exec(sections_stmt).all()

    section_metas = []
    for section in sections:
        # Get groups for this section
        groups_stmt = (
            select(DocGroup)
            .where(DocGroup.docsection_id == section.id)
            .order_by(DocGroup.order)
        )
        groups = db_session.exec(groups_stmt).all()

        group_reads = []
        for group in groups:
            # Get top-level pages in this group (no parent)
            pages_stmt = (
                select(DocPage)
                .where(DocPage.docgroup_id == group.id, DocPage.parent_page_id.is_(None))
                .order_by(DocPage.order)
            )
            pages = db_session.exec(pages_stmt).all()
            page_reads = []
            for p in pages:
                pr = DocPageRead(**p.model_dump())
                # Attach subpages
                subs = db_session.exec(
                    select(DocPage)
                    .where(DocPage.parent_page_id == p.id)
                    .order_by(DocPage.order)
                ).all()
                if subs:
                    pr.subpages = [DocPageRead(**sp.model_dump()) for sp in subs]
                page_reads.append(pr)
            group_data = DocGroupRead(**group.model_dump())
            group_dict = group_data.model_dump()
            group_dict["pages"] = [pr.model_dump() for pr in page_reads]
            group_reads.append(group_dict)

        # Get ungrouped top-level pages (no group, no parent)
        ungrouped_stmt = (
            select(DocPage)
            .where(DocPage.docsection_id == section.id, DocPage.docgroup_id.is_(None), DocPage.parent_page_id.is_(None))
            .order_by(DocPage.order)
        )
        ungrouped_pages = db_session.exec(ungrouped_stmt).all()
        ungrouped_reads = []
        for p in ungrouped_pages:
            pr = DocPageRead(**p.model_dump())
            subs = db_session.exec(
                select(DocPage)
                .where(DocPage.parent_page_id == p.id)
                .order_by(DocPage.order)
            ).all()
            if subs:
                pr.subpages = [DocPageRead(**sp.model_dump()) for sp in subs]
            ungrouped_reads.append(pr)

        section_meta = DocSectionInMeta(
            **section.model_dump(),
            groups=group_reads,
            pages=[pr.model_dump() for pr in ungrouped_reads],
        )
        section_metas.append(section_meta)

    return FullDocSpaceRead(
        **docspace.model_dump(),
        sections=section_metas,
    )


async def get_docspaces_by_org(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
    include_unpublished: bool = False,
) -> List[DocSpaceRead]:
    offset = (page - 1) * limit

    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()
    if not org:
        return []

    can_view_unpublished = False
    if include_unpublished and not isinstance(current_user, AnonymousUser):
        # Superadmins can always view unpublished docspaces
        if is_user_superadmin(current_user.id, db_session):
            can_view_unpublished = True
        else:
            role_statement = (
                select(Role)
                .join(UserOrganization)
                .where(UserOrganization.org_id == org.id)
                .where(UserOrganization.user_id == current_user.id)
            )
            user_roles = db_session.exec(role_statement).all()
            for role in user_roles:
                if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS:
                    can_view_unpublished = True
                    break

    query = (
        select(DocSpace)
        .where(DocSpace.org_id == org.id)
    )

    if isinstance(current_user, AnonymousUser):
        # Anonymous: only public + published
        query = query.where(DocSpace.public == True, DocSpace.published == True)
    elif can_view_unpublished:
        # Admin/maintainer: see everything (no additional filter)
        pass
    else:
        # Authenticated non-admin: published AND (public OR usergroup member OR author)
        query = (
            query
            .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == DocSpace.docspace_uuid)
            .outerjoin(UserGroupUser, and_(
                UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                UserGroupUser.user_id == current_user.id
            ))
            .outerjoin(ResourceAuthor, and_(
                ResourceAuthor.resource_uuid == DocSpace.docspace_uuid,
                ResourceAuthor.user_id == current_user.id,
                ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
            ))
            .where(DocSpace.published == True)
            .where(or_(
                DocSpace.public == True,
                UserGroupUser.user_id == current_user.id,
                ResourceAuthor.user_id.isnot(None),
            ))
        )

    query = query.order_by(DocSpace.creation_date.desc()).offset(offset).limit(limit)

    docspaces = db_session.exec(query).all()
    # Deduplicate (joins can produce duplicates)
    seen = set()
    unique = []
    for ds in docspaces:
        if ds.id not in seen:
            seen.add(ds.id)
            unique.append(ds)
    return [DocSpaceRead(**ds.model_dump()) for ds in unique]


async def update_docspace(
    request: Request,
    docspace_object: DocSpaceUpdate,
    docspace_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    for var, value in vars(docspace_object).items():
        if value is not None:
            setattr(docspace, var, value)

    docspace.update_date = str(datetime.now())

    db_session.add(docspace)
    db_session.commit()
    db_session.refresh(docspace)

    return DocSpaceRead(**docspace.model_dump())


async def delete_docspace(
    request: Request,
    docspace_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.DELETE)

    decrease_feature_usage("docs", docspace.org_id, db_session)

    db_session.delete(docspace)
    db_session.commit()

    return {"detail": "DocSpace deleted"}


async def set_default_docspace(
    request: Request,
    docspace_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.UPDATE)

    # Unset all defaults for this org
    all_spaces = db_session.exec(
        select(DocSpace).where(DocSpace.org_id == docspace.org_id, DocSpace.is_default == True)
    ).all()
    for space in all_spaces:
        space.is_default = False
        db_session.add(space)

    docspace.is_default = True
    docspace.update_date = str(datetime.now())
    db_session.add(docspace)
    db_session.commit()
    db_session.refresh(docspace)

    return DocSpaceRead(**docspace.model_dump())


async def get_default_docspace(
    request: Request,
    org_slug: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    statement = select(DocSpace).where(DocSpace.org_id == org.id, DocSpace.is_default == True)
    docspace = db_session.exec(statement).first()

    if not docspace:
        return None

    # Check access - use raise_on_deny=False so we return None instead of 403
    decision = await check_resource_access(
        request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ, raise_on_deny=False
    )
    if not decision.allowed:
        return None

    if not docspace.published:
        can_view = await _user_can_view_unpublished(request, docspace, current_user, db_session)
        if not can_view:
            return None

    return DocSpaceRead(**docspace.model_dump())


async def get_docspace_by_slug(
    request: Request,
    org_slug: str,
    docspace_slug: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    statement = select(DocSpace).where(
        DocSpace.org_id == org.id,
        DocSpace.slug == docspace_slug,
    )
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    if not docspace.published:
        can_view = await _user_can_view_unpublished(request, docspace, current_user, db_session)
        if not can_view:
            raise HTTPException(status_code=404, detail="DocSpace not found")

    return DocSpaceRead(**docspace.model_dump())


async def get_docspace_meta_by_slug(
    request: Request,
    org_slug: str,
    docspace_slug: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> FullDocSpaceRead:
    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    statement = select(DocSpace).where(
        DocSpace.org_id == org.id,
        DocSpace.slug == docspace_slug,
    )
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    if not docspace.published:
        can_view = await _user_can_view_unpublished(request, docspace, current_user, db_session)
        if not can_view:
            raise HTTPException(status_code=404, detail="DocSpace not found")

    # Reuse the same tree-building logic
    return await get_docspace_meta(request, docspace.docspace_uuid, current_user, db_session)


async def search_docpages(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    docspace_uuid: str,
    search_query: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> List[DocPageSearchResult]:
    limit = min(limit, 100)
    offset = (page - 1) * limit

    statement = select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
    docspace = db_session.exec(statement).first()

    if not docspace:
        raise HTTPException(status_code=404, detail="DocSpace not found")

    await check_resource_access(request, db_session, current_user, docspace.docspace_uuid, AccessAction.READ)

    search_pattern = f"%{search_query}%"

    query = (
        select(DocPage, DocSection.slug.label("section_slug"))
        .join(DocSection, DocSection.id == DocPage.docsection_id)
        .where(DocPage.docspace_id == docspace.id)
        .where(
            or_(
                text('LOWER(docpage.name) LIKE LOWER(:pattern)'),
            )
        )
        .params(pattern=search_pattern)
        .order_by(DocPage.name)
        .offset(offset)
        .limit(limit)
    )

    rows = db_session.exec(query).all()
    results = []
    for page, section_slug in rows:
        parent_page_uuid = None
        if page.parent_page_id is not None:
            parent = db_session.exec(
                select(DocPage.docpage_uuid).where(DocPage.id == page.parent_page_id)
            ).first()
            parent_page_uuid = parent
        results.append(
            DocPageSearchResult(
                docpage_uuid=page.docpage_uuid,
                name=page.name,
                slug=page.slug,
                page_type=page.page_type,
                section_slug=section_slug,
                parent_page_uuid=parent_page_uuid,
            )
        )
    return results


async def _user_can_view_unpublished(
    request: Request,
    docspace: DocSpace,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> bool:
    if isinstance(current_user, AnonymousUser):
        return False

    # Superadmins can always view unpublished docspaces
    if is_user_superadmin(current_user.id, db_session):
        return True

    # Check if user is a resource author
    author_statement = select(ResourceAuthor).where(
        ResourceAuthor.resource_uuid == docspace.docspace_uuid,
        ResourceAuthor.user_id == current_user.id,
        ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
    )
    if db_session.exec(author_statement).first():
        return True

    # Check admin/maintainer role
    role_statement = (
        select(Role)
        .join(UserOrganization)
        .where(UserOrganization.org_id == docspace.org_id)
        .where(UserOrganization.user_id == current_user.id)
    )
    user_roles = db_session.exec(role_statement).all()
    for role in user_roles:
        if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS:
            return True

    # Check UserGroup membership
    usergroup_stmt = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == docspace.docspace_uuid
    )
    usergroup_resources = db_session.exec(usergroup_stmt).all()
    if usergroup_resources:
        usergroup_ids = [ugr.usergroup_id for ugr in usergroup_resources]
        membership_stmt = select(UserGroupUser).where(
            UserGroupUser.usergroup_id.in_(usergroup_ids),
            UserGroupUser.user_id == current_user.id
        )
        if db_session.exec(membership_stmt).first():
            return True

    return False
