from typing import List
from uuid import uuid4
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipStatusEnum
from src.db.users import PublicUser, AnonymousUser
from src.db.podcasts.podcasts import Podcast
from src.db.podcasts.episodes import (
    PodcastEpisode,
    PodcastEpisodeCreate,
    PodcastEpisodeRead,
    PodcastEpisodeUpdate,
)
from src.services.podcasts.thumbnails import upload_episode_thumbnail, upload_episode_audio
from fastapi import HTTPException, Request, UploadFile
from datetime import datetime
from src.security.rbac import check_resource_access, AccessAction
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.security.superadmin import is_user_superadmin


async def _user_can_view_unpublished_episode(
    request: Request,
    episode: PodcastEpisode,
    podcast: Podcast,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> bool:
    """
    Check if the user has permission to view an unpublished episode.
    """
    if isinstance(current_user, AnonymousUser):
        return False

    # Superadmins can view everything
    if is_user_superadmin(current_user.id, db_session):
        return True

    # Check if user is a resource author of this podcast
    author_statement = select(ResourceAuthor).where(
        ResourceAuthor.resource_uuid == podcast.podcast_uuid,
        ResourceAuthor.user_id == current_user.id,
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
        .where(UserOrganization.user_id == current_user.id)
    )
    user_roles = db_session.exec(role_statement).all()
    for role in user_roles:
        if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS:
            return True

    return False


async def get_episode(
    request: Request,
    episode_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PodcastEpisodeRead:
    statement = select(PodcastEpisode).where(PodcastEpisode.episode_uuid == episode_uuid)
    episode = db_session.exec(statement).first()

    if not episode:
        raise HTTPException(
            status_code=404,
            detail="Episode not found",
        )

    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.id == episode.podcast_id)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.READ)

    # Check if episode is published
    if not episode.published:
        can_view_unpublished = await _user_can_view_unpublished_episode(
            request, episode, podcast, current_user, db_session
        )
        if not can_view_unpublished:
            raise HTTPException(
                status_code=404,
                detail="Episode not found",
            )

    return PodcastEpisodeRead(**episode.model_dump())


async def get_episodes_by_podcast(
    request: Request,
    podcast_id: int,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    include_unpublished: bool = False,
) -> List[PodcastEpisodeRead]:
    # Get the podcast first
    podcast_statement = select(Podcast).where(Podcast.id == podcast_id)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # Check if user can view unpublished episodes
    can_view_unpublished = False
    if include_unpublished and not isinstance(current_user, AnonymousUser):
        author_statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == podcast.podcast_uuid,
            ResourceAuthor.user_id == current_user.id,
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
        )
        is_author = db_session.exec(author_statement).first()
        if is_author:
            can_view_unpublished = True

        if not can_view_unpublished:
            role_statement = (
                select(Role)
                .join(UserOrganization)
                .where(UserOrganization.org_id == podcast.org_id)
                .where(UserOrganization.user_id == current_user.id)
            )
            user_roles = db_session.exec(role_statement).all()
            for role in user_roles:
                if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS:
                    can_view_unpublished = True
                    break

    # Query episodes
    query = select(PodcastEpisode).where(PodcastEpisode.podcast_id == podcast_id)

    if not can_view_unpublished:
        query = query.where(PodcastEpisode.published == True)

    query = query.order_by(PodcastEpisode.order.asc())

    episodes = db_session.exec(query).all()

    return [PodcastEpisodeRead(**episode.model_dump()) for episode in episodes]


async def create_episode(
    request: Request,
    podcast_uuid: str,
    episode_object: PodcastEpisodeCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    audio_file: UploadFile | None = None,
    thumbnail_file: UploadFile | None = None,
) -> PodcastEpisodeRead:
    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.CREATE)

    # Get organization
    org_statement = select(Organization).where(Organization.id == podcast.org_id)
    org = db_session.exec(org_statement).first()

    # Create episode with required fields
    episode_data = episode_object.model_dump()
    episode_data['podcast_id'] = podcast.id
    episode_data['org_id'] = podcast.org_id
    episode_data['episode_uuid'] = str(f"episode_{uuid4()}")
    episode_data['creation_date'] = str(datetime.now())
    episode_data['update_date'] = str(datetime.now())

    episode = PodcastEpisode.model_validate(episode_data)

    # Get the next order number
    max_order_query = select(PodcastEpisode).where(PodcastEpisode.podcast_id == podcast.id).order_by(PodcastEpisode.order.desc())
    max_order_episode = db_session.exec(max_order_query).first()
    episode.order = (max_order_episode.order + 1) if max_order_episode else 0

    # Get the next episode number
    max_number_query = select(PodcastEpisode).where(PodcastEpisode.podcast_id == podcast.id).order_by(PodcastEpisode.episode_number.desc())
    max_number_episode = db_session.exec(max_number_query).first()
    episode.episode_number = (max_number_episode.episode_number + 1) if max_number_episode else 1

    # Upload audio file
    if audio_file and audio_file.filename:
        name_in_disk = await upload_episode_audio(
            audio_file, org.org_uuid, podcast.podcast_uuid, episode.episode_uuid
        )
        episode.audio_file = name_in_disk

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = await upload_episode_thumbnail(
            thumbnail_file, org.org_uuid, podcast.podcast_uuid, episode.episode_uuid
        )
        episode.thumbnail_image = name_in_disk

    # Insert episode
    db_session.add(episode)
    db_session.commit()
    db_session.refresh(episode)

    return PodcastEpisodeRead(**episode.model_dump())


async def update_episode(
    request: Request,
    episode_uuid: str,
    episode_object: PodcastEpisodeUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PodcastEpisodeRead:
    statement = select(PodcastEpisode).where(PodcastEpisode.episode_uuid == episode_uuid)
    episode = db_session.exec(statement).first()

    if not episode:
        raise HTTPException(
            status_code=404,
            detail="Episode not found",
        )

    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.id == episode.podcast_id)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in
    # Skip empty strings for file fields to prevent accidental clearing
    file_fields = {'audio_file', 'thumbnail_image'}
    for var, value in vars(episode_object).items():
        if value is not None:
            # Don't overwrite file fields with empty strings
            if var in file_fields and value == "":
                continue
            setattr(episode, var, value)

    episode.update_date = str(datetime.now())

    db_session.add(episode)
    db_session.commit()
    db_session.refresh(episode)

    return PodcastEpisodeRead(**episode.model_dump())


async def delete_episode(
    request: Request,
    episode_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(PodcastEpisode).where(PodcastEpisode.episode_uuid == episode_uuid)
    episode = db_session.exec(statement).first()

    if not episode:
        raise HTTPException(
            status_code=404,
            detail="Episode not found",
        )

    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.id == episode.podcast_id)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.DELETE)

    # Clean up content files from storage
    from src.db.organizations import Organization
    org_statement = select(Organization).where(Organization.id == podcast.org_id)
    org = db_session.exec(org_statement).first()
    if org:
        from src.services.courses.transfer.storage_utils import delete_storage_directory
        content_path = f"content/orgs/{org.org_uuid}/podcasts/{podcast.podcast_uuid}/episodes/{episode_uuid}"
        delete_storage_directory(content_path)

    db_session.delete(episode)
    db_session.commit()

    return {"detail": "Episode deleted"}


async def upload_episode_audio_file(
    request: Request,
    episode_uuid: str,
    audio_file: UploadFile,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PodcastEpisodeRead:
    statement = select(PodcastEpisode).where(PodcastEpisode.episode_uuid == episode_uuid)
    episode = db_session.exec(statement).first()

    if not episode:
        raise HTTPException(
            status_code=404,
            detail="Episode not found",
        )

    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.id == episode.podcast_id)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.UPDATE)

    # Get organization
    org_statement = select(Organization).where(Organization.id == podcast.org_id)
    org = db_session.exec(org_statement).first()

    # Upload audio file
    if audio_file and audio_file.filename:
        name_in_disk = await upload_episode_audio(
            audio_file, org.org_uuid, podcast.podcast_uuid, episode.episode_uuid
        )
        episode.audio_file = name_in_disk
    else:
        raise HTTPException(
            status_code=400,
            detail="No audio file provided",
        )

    episode.update_date = str(datetime.now())

    db_session.add(episode)
    db_session.commit()
    db_session.refresh(episode)

    return PodcastEpisodeRead(**episode.model_dump())


async def upload_episode_thumbnail_file(
    request: Request,
    episode_uuid: str,
    thumbnail_file: UploadFile,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PodcastEpisodeRead:
    statement = select(PodcastEpisode).where(PodcastEpisode.episode_uuid == episode_uuid)
    episode = db_session.exec(statement).first()

    if not episode:
        raise HTTPException(
            status_code=404,
            detail="Episode not found",
        )

    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.id == episode.podcast_id)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.UPDATE)

    # Get organization
    org_statement = select(Organization).where(Organization.id == podcast.org_id)
    org = db_session.exec(org_statement).first()

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = await upload_episode_thumbnail(
            thumbnail_file, org.org_uuid, podcast.podcast_uuid, episode.episode_uuid
        )
        episode.thumbnail_image = name_in_disk
    else:
        raise HTTPException(
            status_code=400,
            detail="No thumbnail file provided",
        )

    episode.update_date = str(datetime.now())

    db_session.add(episode)
    db_session.commit()
    db_session.refresh(episode)

    return PodcastEpisodeRead(**episode.model_dump())


async def reorder_episodes(
    request: Request,
    podcast_uuid: str,
    episode_orders: List[dict],  # [{"episode_uuid": "...", "order": 0}, ...]
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[PodcastEpisodeRead]:
    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, podcast.podcast_uuid, AccessAction.UPDATE)

    # Update episode orders
    for item in episode_orders:
        episode_uuid = item.get("episode_uuid")
        new_order = item.get("order")

        if episode_uuid is None or new_order is None:
            continue

        statement = select(PodcastEpisode).where(
            PodcastEpisode.episode_uuid == episode_uuid,
            PodcastEpisode.podcast_id == podcast.id
        )
        episode = db_session.exec(statement).first()

        if episode:
            episode.order = new_order
            episode.update_date = str(datetime.now())
            db_session.add(episode)

    db_session.commit()

    # Return updated episodes
    return await get_episodes_by_podcast(request, podcast.id, db_session, current_user, include_unpublished=True)
