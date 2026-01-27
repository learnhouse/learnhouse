from typing import List
from uuid import uuid4
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
from src.security.communities_security import communities_rbac_check_with_lookup


router = APIRouter()


class CommunityCreateRequest(BaseModel):
    name: str
    description: str | None = None
    public: bool = True
    course_id: int | None = None


@router.post("/")
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


@router.get("/{community_uuid}")
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


@router.get("/org/{org_id}/page/{page}/limit/{limit}")
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


@router.get("/course/{course_uuid}")
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


@router.put("/{community_uuid}")
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


@router.delete("/{community_uuid}")
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


@router.put("/{community_uuid}/link-course/{course_uuid}")
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


@router.delete("/{community_uuid}/unlink-course")
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


@router.get("/{community_uuid}/rights")
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


@router.put("/{community_uuid}/thumbnail")
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
    # Check permissions and get community
    community = await communities_rbac_check_with_lookup(
        request, community_uuid, current_user, "update", db_session
    )

    # Get org UUID for storage path
    org_statement = select(Organization).where(Organization.id == community.org_id)
    org = db_session.exec(org_statement).first()

    if not org:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Organization not found")

    if thumbnail:
        # Generate unique filename
        file_ext = thumbnail.filename.split(".")[-1] if thumbnail.filename else "jpg"
        filename = f"thumbnail_{uuid4()}.{file_ext}"

        # Upload thumbnail
        await upload_community_thumbnail(
            thumbnail,
            filename,
            org.org_uuid,
            community_uuid,
        )

        # Update community with new thumbnail
        community.thumbnail_image = filename

    db_session.add(community)
    db_session.commit()
    db_session.refresh(community)

    return CommunityRead.model_validate(community.model_dump())
