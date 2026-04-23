from typing import List
from uuid import uuid4
from sqlmodel import Session, select, or_, and_, func
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.security.features_utils.usage import (
    check_limits_with_usage,
    check_feature_access,
    decrease_feature_usage,
    increase_feature_usage,
)
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.users import PublicUser, AnonymousUser, User, UserRead, APITokenUser
from src.security.auth import resolve_acting_user_id
from src.db.podcasts.podcasts import (
    Podcast,
    PodcastCreate,
    PodcastRead,
    PodcastUpdate,
    PodcastReadWithEpisodeCount,
    AuthorWithRole,
)
from src.db.podcasts.episodes import PodcastEpisode
from src.security.rbac.rbac import (
    authorization_verify_based_on_org_admin_status,
)
from src.security.rbac import (
    check_resource_access,
    AccessAction,
)
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.security.superadmin import is_user_superadmin
from src.services.podcasts.thumbnails import upload_podcast_thumbnail
from fastapi import HTTPException, Request, UploadFile, status
from datetime import datetime
from src.db.organization_config import OrganizationConfig


def _is_podcasts_feature_enabled(org_id: int, db_session: Session) -> bool:
    """Check if podcasts feature is enabled for the organization."""
    from src.security.features_utils.resolve import resolve_feature

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        return False

    resolved = resolve_feature("podcasts", org_config.config or {}, org_id)
    return resolved["enabled"]


async def _user_can_view_unpublished_podcast(
    request: Request,
    podcast: Podcast,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> bool:
    """
    Check if the user has permission to view an unpublished podcast.

    Users can view unpublished podcasts if they are:
    1. A resource author (creator, maintainer, or contributor) of the podcast
    2. An admin or maintainer in the organization
    3. A member of a UserGroup that has access to the podcast
    """
    # Anonymous users cannot view unpublished podcasts
    if isinstance(current_user, AnonymousUser):
        return False

    acting_user_id = resolve_acting_user_id(current_user)

    # Superadmins can always view unpublished podcasts
    if is_user_superadmin(acting_user_id, db_session):
        return True

    # Check if user is a resource author of this podcast
    author_statement = select(ResourceAuthor).where(
        ResourceAuthor.resource_uuid == podcast.podcast_uuid,
        ResourceAuthor.user_id == acting_user_id,
        ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
    )
    is_author = db_session.exec(author_statement).first()
    if is_author:
        return True

    # Check if user has admin/maintainer role in the organization
    role_statement = (
        select(Role)
        .join(UserOrganization)
        .where(UserOrganization.org_id == podcast.org_id)
        .where(UserOrganization.user_id == acting_user_id)
    )
    user_roles = db_session.exec(role_statement).all()
    for role in user_roles:
        if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS:  # Admin or Maintainer role IDs
            return True

    # Check if user is a member of a UserGroup that has access to this podcast
    usergroup_stmt = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == podcast.podcast_uuid
    )
    usergroup_resources = db_session.exec(usergroup_stmt).all()

    if usergroup_resources:
        usergroup_ids = [ugr.usergroup_id for ugr in usergroup_resources]
        membership_stmt = select(UserGroupUser).where(
            UserGroupUser.usergroup_id.in_(usergroup_ids),
            UserGroupUser.user_id == acting_user_id
        )
        membership = db_session.exec(membership_stmt).first()
        if membership:
            return True

    return False


async def get_podcast(
    request: Request,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # Check if podcasts feature is enabled for this organization
    if not _is_podcasts_feature_enabled(podcast.org_id, db_session):
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.READ)

    # Check if podcast is published - unpublished podcasts require special permission
    if not podcast.published:
        can_view_unpublished = await _user_can_view_unpublished_podcast(
            request, podcast, current_user, db_session
        )
        if not can_view_unpublished:
            raise HTTPException(
                status_code=404,
                detail="Podcast not found",
            )

    # Get podcast authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == podcast.podcast_uuid)
        .order_by(ResourceAuthor.id.asc())
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    podcast = PodcastRead(**podcast.model_dump(), authors=authors)

    return podcast


async def get_podcast_meta(
    request: Request,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> dict:
    """Get podcast with episodes list."""
    from src.services.podcasts.episodes import get_episodes_by_podcast

    # Get podcast with authors in a single query using joins
    podcast_statement = (
        select(Podcast, ResourceAuthor, User)
        .outerjoin(ResourceAuthor, ResourceAuthor.resource_uuid == Podcast.podcast_uuid)
        .outerjoin(User, ResourceAuthor.user_id == User.id)
        .where(Podcast.podcast_uuid == podcast_uuid)
        .order_by(ResourceAuthor.id.asc())
    )
    results = db_session.exec(podcast_statement).all()

    if not results:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # Extract podcast and authors from results
    podcast = results[0][0]  # First result's Podcast
    author_results = [(ra, u) for _, ra, u in results if ra is not None and u is not None]

    # Check if podcasts feature is enabled for this organization
    if not _is_podcasts_feature_enabled(podcast.org_id, db_session):
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.READ)

    # Check if user can view unpublished content
    can_view_unpublished = await _user_can_view_unpublished_podcast(
        request, podcast, current_user, db_session
    )

    # Check if podcast is published - unpublished podcasts require special permission
    if not podcast.published and not can_view_unpublished:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # Get podcast episodes (include unpublished for authorized users)
    episodes = await get_episodes_by_podcast(
        request, podcast.id, db_session, current_user, include_unpublished=can_view_unpublished
    )

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    # Create response
    podcast_read = PodcastRead(
        **podcast.model_dump(),
        authors=authors,
    )

    return {
        "podcast": podcast_read,
        "episodes": episodes
    }


async def get_podcasts_orgslug(
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    org_slug: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
    include_unpublished: bool = False,
) -> List[PodcastReadWithEpisodeCount]:
    offset = (page - 1) * limit

    # Get organization
    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()
    if not org:
        return []

    # Check if podcasts feature is enabled for this organization
    if not _is_podcasts_feature_enabled(org.id, db_session):
        return []

    acting_user_id = resolve_acting_user_id(current_user)

    # Check if user can view unpublished podcasts (must be admin/editor in org)
    can_view_unpublished = False
    if include_unpublished and not isinstance(current_user, AnonymousUser):
        # Superadmins can always view unpublished podcasts
        if is_user_superadmin(acting_user_id, db_session):
            can_view_unpublished = True
        else:
            role_statement = (
                select(Role)
                .join(UserOrganization)
                .where(UserOrganization.org_id == org.id)
                .where(UserOrganization.user_id == acting_user_id)
            )
            user_roles = db_session.exec(role_statement).all()
            for role in user_roles:
                if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS:  # Admin role IDs
                    can_view_unpublished = True
                    break

    # Base query
    query = (
        select(Podcast)
        .join(Organization)
        .where(Organization.slug == org_slug)
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only show public AND published podcasts
        query = query.where(Podcast.public == True, Podcast.published == True)
    else:
        # For authenticated users with admin access viewing dashboard, show all podcasts
        if can_view_unpublished:
            pass
        else:
            # For regular users, show:
            # 1. Published AND public podcasts
            # 2. Published podcasts not in any UserGroup
            # 3. Podcasts (including unpublished) in UserGroups where the user is a member
            # 4. Podcasts (including unpublished) where the user is a resource author
            query = (
                query
                .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == Podcast.podcast_uuid)
                .outerjoin(UserGroupUser, and_(
                    UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                    UserGroupUser.user_id == acting_user_id
                ))
                .outerjoin(ResourceAuthor, ResourceAuthor.resource_uuid == Podcast.podcast_uuid)
                .where(or_(
                    and_(Podcast.published == True, Podcast.public == True),  # Published public podcasts
                    and_(Podcast.published == True, UserGroupResource.resource_uuid.is_(None)),  # Published podcasts not in any UserGroup
                    UserGroupUser.user_id == acting_user_id,  # Podcasts in UserGroups where user is a member (including unpublished)
                    ResourceAuthor.user_id == acting_user_id  # Podcasts where user is a resource author (including unpublished)
                ))
            )

    # Apply ordering and pagination
    query = query.order_by(Podcast.creation_date.desc()).offset(offset).limit(limit).distinct()

    podcasts = db_session.exec(query).all()

    if not podcasts:
        return []

    # Get all podcast UUIDs
    podcast_uuids = [podcast.podcast_uuid for podcast in podcasts]
    podcast_ids = [podcast.id for podcast in podcasts]

    # Fetch all authors for all podcasts in a single query
    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid.in_(podcast_uuids))
        .order_by(ResourceAuthor.id.asc())
    )

    author_results = db_session.exec(authors_query).all()

    # Create a dictionary mapping podcast_uuid to list of authors
    podcast_authors = {}
    for resource_author, user in author_results:
        if resource_author.resource_uuid not in podcast_authors:
            podcast_authors[resource_author.resource_uuid] = []
        podcast_authors[resource_author.resource_uuid].append(
            AuthorWithRole(
                user=UserRead.model_validate(user),
                authorship=resource_author.authorship,
                authorship_status=resource_author.authorship_status,
                creation_date=resource_author.creation_date,
                update_date=resource_author.update_date
            )
        )

    # Get episode counts for all podcasts
    episode_count_query = (
        select(PodcastEpisode.podcast_id, func.count(PodcastEpisode.id))
        .where(PodcastEpisode.podcast_id.in_(podcast_ids))
        .group_by(PodcastEpisode.podcast_id)
    )
    episode_counts = {podcast_id: count for podcast_id, count in db_session.exec(episode_count_query).all()}

    # Create PodcastReadWithEpisodeCount objects with authors
    podcast_reads = []
    for podcast in podcasts:
        podcast_read = PodcastReadWithEpisodeCount.model_validate({
            "id": podcast.id or 0,
            "org_id": podcast.org_id,
            "name": podcast.name,
            "description": podcast.description or "",
            "about": podcast.about or "",
            "tags": podcast.tags or "",
            "thumbnail_image": podcast.thumbnail_image or "",
            "public": podcast.public,
            "published": podcast.published,
            "podcast_uuid": podcast.podcast_uuid,
            "creation_date": podcast.creation_date,
            "update_date": podcast.update_date,
            "authors": podcast_authors.get(podcast.podcast_uuid, []),
            "episode_count": episode_counts.get(podcast.id, 0)
        })
        podcast_reads.append(podcast_read)

    return podcast_reads


async def get_podcasts_count_orgslug(
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    org_slug: str,
    db_session: Session,
) -> int:
    """Get total count of podcasts for an organization (respecting visibility rules)"""
    count_acting_user_id = resolve_acting_user_id(current_user)

    query = (
        select(func.count(Podcast.id.distinct()))
        .join(Organization)
        .where(Organization.slug == org_slug)
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only count public AND published podcasts
        query = query.where(Podcast.public == True, Podcast.published == True)
    elif not isinstance(current_user, AnonymousUser) and is_user_superadmin(count_acting_user_id, db_session):
        # Superadmins see all podcasts (no additional filter)
        pass
    else:
        # For authenticated users, count:
        # 1. Published AND public podcasts
        # 2. Published podcasts not in any UserGroup
        # 3. Podcasts (including unpublished) in UserGroups where the user is a member
        # 4. Podcasts (including unpublished) where the user is a resource author
        query = (
            query
            .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == Podcast.podcast_uuid)
            .outerjoin(UserGroupUser, and_(
                UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                UserGroupUser.user_id == count_acting_user_id
            ))
            .outerjoin(ResourceAuthor, ResourceAuthor.resource_uuid == Podcast.podcast_uuid)
            .where(or_(
                and_(Podcast.published == True, Podcast.public == True),  # Published public podcasts
                and_(Podcast.published == True, UserGroupResource.resource_uuid.is_(None)),  # Published podcasts not in any UserGroup
                UserGroupUser.user_id == count_acting_user_id,  # Podcasts in UserGroups where user is a member (including unpublished)
                ResourceAuthor.user_id == count_acting_user_id  # Podcasts where user is a resource author (including unpublished)
            ))
        )

    count = db_session.exec(query).one()
    return count


async def create_podcast(
    request: Request,
    org_id: int,
    podcast_object: PodcastCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
):
    """Create a new podcast"""
    podcast = Podcast.model_validate(podcast_object)

    # SECURITY: Check if user has permission to create podcasts
    await check_resource_access(request, db_session, current_user, "podcast_x", AccessAction.CREATE)

    # Check plan access (podcasts require standard+ plan)
    check_feature_access("podcasts", org_id, db_session)

    # Usage check (also checks if feature is enabled)
    check_limits_with_usage("podcasts", org_id, db_session)

    # Complete podcast object
    podcast.org_id = org_id

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(org_statement).first()

    podcast.podcast_uuid = str(f"podcast_{uuid4()}")
    podcast.creation_date = str(datetime.now())
    podcast.update_date = str(datetime.now())

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = await upload_podcast_thumbnail(
            thumbnail_file, org.org_uuid, podcast.podcast_uuid
        )
        podcast.thumbnail_image = name_in_disk
    else:
        podcast.thumbnail_image = ""

    # Insert podcast
    db_session.add(podcast)
    db_session.commit()
    db_session.refresh(podcast)

    # SECURITY: Make the user the creator of the podcast
    if isinstance(current_user, APITokenUser):
        author_user_id = current_user.created_by_user_id
    else:
        author_user_id = current_user.id

    resource_author = ResourceAuthor(
        resource_uuid=podcast.podcast_uuid,
        user_id=author_user_id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert podcast author
    db_session.add(resource_author)
    db_session.commit()
    db_session.refresh(resource_author)

    # Get podcast authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == podcast.podcast_uuid)
        .order_by(ResourceAuthor.id.asc())
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    # Feature usage
    increase_feature_usage("podcasts", podcast.org_id, db_session)

    podcast_data = {key: getattr(podcast, key) for key in podcast.model_fields}
    return PodcastRead.model_validate({**podcast_data, "authors": authors})


async def update_podcast_thumbnail(
    request: Request,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
):
    statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(statement).first()

    name_in_disk = None

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.UPDATE)

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == podcast.org_id)
    org = db_session.exec(org_statement).first()

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = await upload_podcast_thumbnail(
            thumbnail_file, org.org_uuid, podcast.podcast_uuid
        )

    # Update podcast
    if name_in_disk:
        podcast.thumbnail_image = name_in_disk
    else:
        raise HTTPException(
            status_code=500,
            detail="Issue with thumbnail upload",
        )

    # Complete the podcast object
    podcast.update_date = str(datetime.now())

    db_session.add(podcast)
    db_session.commit()
    db_session.refresh(podcast)

    # Get podcast authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == podcast.podcast_uuid)
        .order_by(ResourceAuthor.id.asc())
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    podcast = PodcastRead(**podcast.model_dump(), authors=authors)

    return podcast


async def update_podcast(
    request: Request,
    podcast_object: PodcastUpdate,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    """Update a podcast"""
    statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # SECURITY: Require podcast ownership or admin role for updating podcasts
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.UPDATE)

    # SECURITY: Additional checks for sensitive access control fields
    sensitive_fields_updated = []

    if podcast_object.public is not None:
        sensitive_fields_updated.append("public")

    if sensitive_fields_updated:
        # Resolve to the token's creator for API-token callers so ownership /
        # admin checks run against a real user_id (tokens have id=0).
        acting_user_id = resolve_acting_user_id(current_user)

        statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == podcast_uuid,
            ResourceAuthor.user_id == acting_user_id
        )
        resource_author = db_session.exec(statement).first()

        is_podcast_owner = False
        if resource_author:
            if ((resource_author.authorship == ResourceAuthorshipEnum.CREATOR) or
                (resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER)) and \
                resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE:
                is_podcast_owner = True

        is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
            request, acting_user_id, "update", podcast_uuid, db_session
        )

        if not (is_podcast_owner or is_admin_or_maintainer):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You must be the podcast owner (CREATOR or MAINTAINER) or have admin role to change access settings: {', '.join(sensitive_fields_updated)}",
            )

    # Update only the fields that were passed in
    for var, value in vars(podcast_object).items():
        if value is not None:
            setattr(podcast, var, value)

    # Complete the podcast object
    podcast.update_date = str(datetime.now())

    db_session.add(podcast)
    db_session.commit()
    db_session.refresh(podcast)

    # Get podcast authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == podcast.podcast_uuid)
        .order_by(ResourceAuthor.id.asc())
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    podcast = PodcastRead(**podcast.model_dump(), authors=authors)

    return podcast


async def delete_podcast(
    request: Request,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.DELETE)

    # Feature usage
    decrease_feature_usage("podcasts", podcast.org_id, db_session)

    # Clean up content files from storage
    from src.db.organizations import Organization
    org_statement = select(Organization).where(Organization.id == podcast.org_id)
    org = db_session.exec(org_statement).first()
    if org:
        from src.services.courses.transfer.storage_utils import delete_storage_directory
        content_path = f"content/orgs/{org.org_uuid}/podcasts/{podcast_uuid}"
        delete_storage_directory(content_path)

    db_session.delete(podcast)
    db_session.commit()

    return {"detail": "Podcast deleted"}


async def get_podcast_user_rights(
    request: Request,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> dict:
    """Get detailed user rights for a specific podcast."""
    statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # API tokens report rights under their creator's identity.
    acting_user_id = resolve_acting_user_id(current_user)

    rights = {
        "podcast_uuid": podcast_uuid,
        "user_id": acting_user_id,
        "is_anonymous": acting_user_id == 0,
        "permissions": {
            "read": False,
            "create": False,
            "update": False,
            "delete": False,
            "create_episodes": False,
            "update_episodes": False,
            "delete_episodes": False,
            "manage_access": False,
        },
        "ownership": {
            "is_owner": False,
            "is_creator": False,
            "is_maintainer": False,
            "is_contributor": False,
            "authorship_status": None,
        },
        "roles": {
            "is_admin": False,
            "is_maintainer_role": False,
            "is_instructor": False,
            "is_user": False,
        }
    }

    # Handle anonymous users
    if acting_user_id == 0:
        if podcast.public:
            rights["permissions"]["read"] = True
        return rights

    # Check podcast ownership
    statement = select(ResourceAuthor).where(
        ResourceAuthor.resource_uuid == podcast_uuid,
        ResourceAuthor.user_id == acting_user_id
    )
    resource_author = db_session.exec(statement).first()

    if resource_author:
        rights["ownership"]["authorship_status"] = resource_author.authorship_status

        if resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE:
            if resource_author.authorship == ResourceAuthorshipEnum.CREATOR:
                rights["ownership"]["is_creator"] = True
                rights["ownership"]["is_owner"] = True
            elif resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER:
                rights["ownership"]["is_maintainer"] = True
                rights["ownership"]["is_owner"] = True
            elif resource_author.authorship == ResourceAuthorshipEnum.CONTRIBUTOR:
                rights["ownership"]["is_contributor"] = True
                rights["ownership"]["is_owner"] = True

    # Check user roles
    from src.security.rbac.rbac import authorization_verify_based_on_roles

    is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
        request, acting_user_id, "update", podcast_uuid, db_session
    )

    if is_admin_or_maintainer:
        rights["roles"]["is_admin"] = True
        rights["roles"]["is_maintainer_role"] = True

    has_instructor_permissions = await authorization_verify_based_on_roles(
        request, acting_user_id, "create", "podcast_x", db_session
    )

    if has_instructor_permissions:
        rights["roles"]["is_instructor"] = True

    has_user_permissions = await authorization_verify_based_on_roles(
        request, current_user.id, "read", podcast_uuid, db_session
    )

    if has_user_permissions:
        rights["roles"]["is_user"] = True

    # Determine permissions based on ownership and roles
    is_podcast_owner = rights["ownership"]["is_owner"]
    is_admin = rights["roles"]["is_admin"]
    is_maintainer_role = rights["roles"]["is_maintainer_role"]
    is_instructor = rights["roles"]["is_instructor"]

    # READ permissions
    if podcast.public or is_podcast_owner or is_admin or is_maintainer_role or is_instructor or has_user_permissions:
        rights["permissions"]["read"] = True

    # CREATE permissions (podcast creation)
    if is_instructor or is_admin or is_maintainer_role:
        rights["permissions"]["create"] = True

    # UPDATE permissions
    if is_podcast_owner or is_admin or is_maintainer_role:
        rights["permissions"]["update"] = True

    # DELETE permissions
    if is_podcast_owner or is_admin or is_maintainer_role:
        rights["permissions"]["delete"] = True

    # EPISODE permissions
    if is_podcast_owner or is_admin or is_maintainer_role:
        rights["permissions"]["create_episodes"] = True
        rights["permissions"]["update_episodes"] = True
        rights["permissions"]["delete_episodes"] = True

    # ACCESS MANAGEMENT permissions
    if (rights["ownership"]["is_creator"] or rights["ownership"]["is_maintainer"] or
        is_admin or is_maintainer_role):
        rights["permissions"]["manage_access"] = True

    return rights
