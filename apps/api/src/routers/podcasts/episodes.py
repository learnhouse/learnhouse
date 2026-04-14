from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlmodel import Session
from src.db.podcasts.episodes import (
    PodcastEpisodeRead,
    PodcastEpisodeUpdate,
)
from src.services.podcasts.episodes import (
    get_episode,
    update_episode,
    delete_episode,
    upload_episode_audio_file,
    upload_episode_thumbnail_file,
)
from src.core.events.database import get_db_session
from src.security.auth import get_current_user

router = APIRouter()


@router.get(
    "/episodes/{episode_uuid}",
    response_model=PodcastEpisodeRead,
    summary="Get a podcast episode",
    description="Fetch a podcast episode by its UUID.",
    responses={
        200: {"description": "Episode details.", "model": PodcastEpisodeRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to read this episode"},
        404: {"description": "Episode not found"},
    },
)
async def api_get_episode(
    request: Request,
    episode_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Get an episode by UUID"""
    episode = await get_episode(request, episode_uuid, current_user, db_session)
    return episode


@router.put(
    "/episodes/{episode_uuid}",
    response_model=PodcastEpisodeRead,
    summary="Update a podcast episode",
    description="Update an episode's metadata. The caller must have write access to the parent podcast.",
    responses={
        200: {"description": "Episode updated successfully.", "model": PodcastEpisodeRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to update this episode"},
        404: {"description": "Episode not found"},
    },
)
async def api_update_episode(
    request: Request,
    episode_uuid: str,
    episode_object: PodcastEpisodeUpdate,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Update an episode"""
    episode = await update_episode(
        request, episode_uuid, episode_object, current_user, db_session
    )
    return episode


@router.delete(
    "/episodes/{episode_uuid}",
    summary="Delete a podcast episode",
    description="Delete a podcast episode and its associated files. This operation cannot be undone.",
    responses={
        200: {"description": "Episode deleted successfully."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this episode"},
        404: {"description": "Episode not found"},
    },
)
async def api_delete_episode(
    request: Request,
    episode_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Delete an episode"""
    result = await delete_episode(request, episode_uuid, current_user, db_session)
    return result


@router.put(
    "/episodes/{episode_uuid}/audio",
    response_model=PodcastEpisodeRead,
    summary="Upload episode audio",
    description="Upload or replace the audio file for a podcast episode.",
    responses={
        200: {"description": "Audio uploaded and episode updated.", "model": PodcastEpisodeRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to update this episode"},
        404: {"description": "Episode not found"},
    },
)
async def api_upload_episode_audio(
    request: Request,
    episode_uuid: str,
    audio: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Upload audio file for an episode"""
    episode = await upload_episode_audio_file(
        request, episode_uuid, audio, current_user, db_session
    )
    return episode


@router.put(
    "/episodes/{episode_uuid}/thumbnail",
    response_model=PodcastEpisodeRead,
    summary="Upload episode thumbnail",
    description="Upload or replace the thumbnail image for a podcast episode.",
    responses={
        200: {"description": "Thumbnail uploaded and episode updated.", "model": PodcastEpisodeRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to update this episode"},
        404: {"description": "Episode not found"},
    },
)
async def api_upload_episode_thumbnail(
    request: Request,
    episode_uuid: str,
    thumbnail: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Upload thumbnail for an episode"""
    episode = await upload_episode_thumbnail_file(
        request, episode_uuid, thumbnail, current_user, db_session
    )
    return episode
