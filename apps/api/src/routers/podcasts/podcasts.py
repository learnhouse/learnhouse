from typing import List, Optional
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlmodel import Session
from src.db.podcasts.podcasts import (
    PodcastRead,
    PodcastUpdate,
    PodcastReadWithEpisodeCount,
)
from src.services.podcasts.podcasts import (
    get_podcast,
    get_podcast_meta,
    get_podcasts_orgslug,
    get_podcasts_count_orgslug,
    create_podcast,
    update_podcast,
    update_podcast_thumbnail,
    delete_podcast,
    get_podcast_user_rights,
)
from src.services.podcasts.episodes import (
    get_episodes_by_podcast,
    create_episode,
    reorder_episodes,
)
from src.db.podcasts.episodes import PodcastEpisodeRead
from src.core.events.database import get_db_session
from src.security.auth import get_current_user

router = APIRouter()


@router.post("/", response_model=PodcastRead)
async def api_create_podcast(
    request: Request,
    org_id: int,
    name: str = Form(...),
    description: Optional[str] = Form(None),
    about: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    public: bool = Form(False),
    thumbnail: Optional[UploadFile] = File(None),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Create a new podcast"""
    from src.db.podcasts.podcasts import PodcastCreate

    podcast_data = PodcastCreate(
        org_id=org_id,
        name=name,
        description=description,
        about=about,
        tags=tags,
        public=public,
        published=False,
    )

    podcast = await create_podcast(
        request, org_id, podcast_data, current_user, db_session, thumbnail
    )
    return podcast


@router.get("/{podcast_uuid}", response_model=PodcastRead)
async def api_get_podcast(
    request: Request,
    podcast_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Get a podcast by UUID"""
    podcast = await get_podcast(request, podcast_uuid, current_user, db_session)
    return podcast


@router.get("/{podcast_uuid}/meta")
async def api_get_podcast_meta(
    request: Request,
    podcast_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Get a podcast with its episodes"""
    result = await get_podcast_meta(request, podcast_uuid, current_user, db_session)
    return result


@router.get("/org_slug/{org_slug}/page/{page}/limit/{limit}", response_model=List[PodcastReadWithEpisodeCount])
async def api_get_podcasts_orgslug(
    request: Request,
    org_slug: str,
    page: int,
    limit: int,
    include_unpublished: bool = False,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Get paginated podcasts for an organization"""
    podcasts = await get_podcasts_orgslug(
        request, current_user, org_slug, db_session, page, limit, include_unpublished
    )
    return podcasts


@router.get("/org_slug/{org_slug}/count")
async def api_get_podcasts_count_orgslug(
    request: Request,
    org_slug: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Get total count of podcasts for an organization"""
    count = await get_podcasts_count_orgslug(request, current_user, org_slug, db_session)
    return {"count": count}


@router.put("/{podcast_uuid}", response_model=PodcastRead)
async def api_update_podcast(
    request: Request,
    podcast_uuid: str,
    podcast_object: PodcastUpdate,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Update a podcast"""
    podcast = await update_podcast(
        request, podcast_object, podcast_uuid, current_user, db_session
    )
    return podcast


@router.put("/{podcast_uuid}/thumbnail", response_model=PodcastRead)
async def api_update_podcast_thumbnail(
    request: Request,
    podcast_uuid: str,
    thumbnail: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Update podcast thumbnail"""
    podcast = await update_podcast_thumbnail(
        request, podcast_uuid, current_user, db_session, thumbnail
    )
    return podcast


@router.delete("/{podcast_uuid}")
async def api_delete_podcast(
    request: Request,
    podcast_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Delete a podcast"""
    result = await delete_podcast(request, podcast_uuid, current_user, db_session)
    return result


@router.get("/{podcast_uuid}/rights")
async def api_get_podcast_rights(
    request: Request,
    podcast_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Get user rights for a podcast"""
    rights = await get_podcast_user_rights(
        request, podcast_uuid, current_user, db_session
    )
    return rights


# Episode endpoints nested under podcast
@router.get("/{podcast_uuid}/episodes", response_model=List[PodcastEpisodeRead])
async def api_get_podcast_episodes(
    request: Request,
    podcast_uuid: str,
    include_unpublished: bool = False,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Get all episodes for a podcast"""
    from sqlmodel import select
    from src.db.podcasts.podcasts import Podcast

    # Get the podcast
    podcast_statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(podcast_statement).first()

    if not podcast:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Podcast not found")

    episodes = await get_episodes_by_podcast(
        request, podcast.id, db_session, current_user, include_unpublished
    )
    return episodes


@router.post("/{podcast_uuid}/episodes", response_model=PodcastEpisodeRead)
async def api_create_episode(
    request: Request,
    podcast_uuid: str,
    title: str = Form(...),
    description: Optional[str] = Form(None),
    duration_seconds: Optional[int] = Form(0),
    published: bool = Form(False),
    audio: Optional[UploadFile] = File(None),
    thumbnail: Optional[UploadFile] = File(None),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Create a new episode for a podcast"""
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Creating episode for podcast {podcast_uuid} with title: {title}")

    from src.db.podcasts.episodes import PodcastEpisodeCreate

    episode_data = PodcastEpisodeCreate(
        title=title,
        description=description,
        duration_seconds=duration_seconds,
        published=published,
    )

    episode = await create_episode(
        request, podcast_uuid, episode_data, current_user, db_session, audio, thumbnail
    )
    logger.info(f"Episode created successfully: {episode.episode_uuid}")
    return episode


@router.put("/{podcast_uuid}/episodes/reorder")
async def api_reorder_episodes(
    request: Request,
    podcast_uuid: str,
    episode_orders: List[dict],
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Reorder episodes in a podcast"""
    episodes = await reorder_episodes(
        request, podcast_uuid, episode_orders, current_user, db_session
    )
    return episodes
