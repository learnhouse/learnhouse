from typing import List
from fastapi import APIRouter, Depends, Request, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.organizations import Organization
from src.db.communities.communities import CommunityRead, CommunityUpdate
from src.security.auth import get_current_user
from src.services.communities.communities import (
    create_community,
    get_community,
    get_communities_by_org,
    get_community_by_course,
    update_community,
    delete_community,
    link_community_to_course,
    unlink_community_from_course,
    get_community_user_rights,
)
from src.services.communities.thumbnails import upload_community_thumbnail
from src.db.communities.communities import Community
from src.security.rbac import check_resource_access, AccessAction


router = APIRouter()


class CommunityCreateRequest(BaseModel):
    name: str
    description: str | None = None
    public: bool = True
    course_id: int | None = None


@router.post(
    "/",
    response_model=CommunityRead,
    summary="Create a community",
    description="Create a new community inside an organization. Optionally link it to a course on creation. Requires admin/maintainer role.",
    responses={
        200: {"description": "Community created successfully.", "model": CommunityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role for the organization"},
        404: {"description": "Organization or course not found"},
    },
)
async def api_create_community(
    request: Request,
    org_id: int,
    community_data: CommunityCreateRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CommunityRead:
    """
    Create a new community in an organization.

    Requires admin/maintainer role.
    """
    from src.db.communities.communities import CommunityCreate

    community_create = CommunityCreate(
        name=community_data.name,
        description=community_data.description,
        public=community_data.public,
        org_id=org_id,
        course_id=community_data.course_id,
    )

    return await create_community(
        request, org_id, community_create, current_user, db_session
    )


@router.get(
    "/{community_uuid}",
    response_model=CommunityRead,
    summary="Get a community",
    description="Retrieve a community by its UUID. The caller must be able to read the community.",
    responses={
        200: {"description": "Community retrieved.", "model": CommunityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have read access to this community"},
        404: {"description": "Community not found"},
    },
)
async def api_get_community(
    request: Request,
    community_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CommunityRead:
    """
    Get a community by UUID.
    """
    return await get_community(request, community_uuid, current_user, db_session)


@router.get(
    "/org/{org_id}/page/{page}/limit/{limit}",
    response_model=List[CommunityRead],
    summary="List communities for an organization",
    description="Retrieve a paginated list of communities belonging to an organization.",
    responses={
        200: {"description": "Paginated list of communities.", "model": List[CommunityRead]},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks access to this organization's communities"},
        404: {"description": "Organization not found"},
    },
)
async def api_get_communities_by_org(
    request: Request,
    org_id: int,
    page: int = 1,
    limit: int = 10,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[CommunityRead]:
    """
    Get paginated list of communities for an organization.
    """
    return await get_communities_by_org(
        request, org_id, current_user, db_session, page, limit
    )


@router.get(
    "/course/{course_uuid}",
    summary="Get community for a course",
    description="Retrieve the community that is linked to a specific course, if one exists.",
    responses={
        200: {"description": "Community linked to the course, or null if no community is linked."},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have access to this course"},
        404: {"description": "Course not found"},
    },
)
async def api_get_community_by_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CommunityRead | None:
    """
    Get the community linked to a specific course.
    """
    return await get_community_by_course(request, course_uuid, current_user, db_session)


@router.put(
    "/{community_uuid}",
    response_model=CommunityRead,
    summary="Update a community",
    description="Update an existing community's attributes. Requires admin/maintainer role.",
    responses={
        200: {"description": "Community updated successfully.", "model": CommunityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role for this community"},
        404: {"description": "Community not found"},
    },
)
async def api_update_community(
    request: Request,
    community_uuid: str,
    community_data: CommunityUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CommunityRead:
    """
    Update a community.

    Requires admin/maintainer role.
    """
    return await update_community(
        request, community_uuid, community_data, current_user, db_session
    )


@router.delete(
    "/{community_uuid}",
    summary="Delete a community",
    description="Permanently delete a community. Requires admin/maintainer role.",
    responses={
        200: {"description": "Community deleted successfully."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role for this community"},
        404: {"description": "Community not found"},
    },
)
async def api_delete_community(
    request: Request,
    community_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Delete a community.

    Requires admin/maintainer role.
    """
    return await delete_community(request, community_uuid, current_user, db_session)


@router.put(
    "/{community_uuid}/link-course/{course_uuid}",
    response_model=CommunityRead,
    summary="Link community to a course",
    description="Associate a community with a course so that course members can participate. Requires admin/maintainer role.",
    responses={
        200: {"description": "Community linked to course.", "model": CommunityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role for this community"},
        404: {"description": "Community or course not found"},
    },
)
async def api_link_community_to_course(
    request: Request,
    community_uuid: str,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CommunityRead:
    """
    Link a community to a course.

    Requires admin/maintainer role.
    """
    return await link_community_to_course(
        request, community_uuid, course_uuid, current_user, db_session
    )


@router.delete(
    "/{community_uuid}/unlink-course",
    response_model=CommunityRead,
    summary="Unlink community from its course",
    description="Remove the association between a community and its currently linked course. Requires admin/maintainer role.",
    responses={
        200: {"description": "Community unlinked from course.", "model": CommunityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role for this community"},
        404: {"description": "Community not found"},
    },
)
async def api_unlink_community_from_course(
    request: Request,
    community_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CommunityRead:
    """
    Unlink a community from its course.

    Requires admin/maintainer role.
    """
    return await unlink_community_from_course(
        request, community_uuid, current_user, db_session
    )


@router.get(
    "/{community_uuid}/rights",
    summary="Get current user rights for a community",
    description="Return a detailed breakdown of the rights the current user has on a community (read, write, moderate, admin).",
    responses={
        200: {"description": "User rights for the community."},
        401: {"description": "Authentication required"},
        404: {"description": "Community not found"},
    },
)
async def api_get_community_rights(
    request: Request,
    community_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Get detailed user rights for a specific community.
    """
    return await get_community_user_rights(
        request, community_uuid, current_user, db_session
    )


@router.put(
    "/{community_uuid}/thumbnail",
    response_model=CommunityRead,
    summary="Upload a community thumbnail",
    description="Upload or replace the thumbnail image for a community. Requires admin/maintainer role.",
    responses={
        200: {"description": "Thumbnail uploaded and community updated.", "model": CommunityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role for this community"},
        404: {"description": "Community or organization not found"},
    },
)
async def api_update_community_thumbnail(
    request: Request,
    community_uuid: str,
    thumbnail: UploadFile | None = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CommunityRead:
    """
    Upload or update a community thumbnail.

    Requires admin/maintainer role.
    """
    # Get community
    community_statement = select(Community).where(Community.community_uuid == community_uuid)
    community = db_session.exec(community_statement).first()

    if not community:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Community not found")

    # Check permissions
    await check_resource_access(request, db_session, current_user, community_uuid, AccessAction.UPDATE)

    # Get org UUID for storage path
    org_statement = select(Organization).where(Organization.id == community.org_id)
    org = db_session.exec(org_statement).first()

    if not org:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Organization not found")

    if thumbnail:
        # Upload thumbnail (returns safe filename)
        filename = await upload_community_thumbnail(
            thumbnail,
            org.org_uuid,
            community_uuid,
        )

        # Update community with new thumbnail
        community.thumbnail_image = filename

    db_session.add(community)
    db_session.commit()
    db_session.refresh(community)

    return CommunityRead.model_validate(community.model_dump())
