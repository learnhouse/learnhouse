"""
Video Streaming Router

This router provides optimized video streaming endpoints with proper HTTP Range
request handling for seamless playback of long video files.

SECURITY: All streaming endpoints validate resource access using the RBAC system.
Anonymous users can only stream content from public+published resources.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Path
from fastapi.responses import StreamingResponse, Response
from sqlmodel import Session, select

from src.db.courses.courses import Course
from src.db.courses.activities import Activity
from src.db.podcasts.podcasts import Podcast
from src.db.podcasts.episodes import PodcastEpisode
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.security.rbac.resource_access import ResourceAccessChecker, AccessAction, AccessContext
from src.services.utils.video_streaming import (
    stream_video_file,
    parse_range_header,
    get_file_info,
    validate_video_path,
    CHUNK_SIZE,
)

router = APIRouter()

# Base content directory
CONTENT_DIR = "content"


async def _verify_course_activity_access(
    request: Request,
    course_uuid: str,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    """
    Verify user has read access to the course/activity.

    SECURITY: This ensures that:
    - Anonymous users can only access public+published courses
    - Authenticated users can access courses they have permission to view
    - Activity must belong to the specified course
    """
    # Verify activity exists and belongs to the course
    activity_stmt = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(activity_stmt).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Verify course exists and activity belongs to it
    course_stmt = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(course_stmt).first()

    if not course or course.course_uuid != course_uuid:
        raise HTTPException(status_code=404, detail="Course not found or activity doesn't belong to course")

    # RBAC check - verify user can read this course
    checker = ResourceAccessChecker(request, db_session, current_user)
    decision = await checker.check_access(course_uuid, AccessAction.READ, AccessContext.PUBLIC_VIEW)

    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.reason)


async def _verify_podcast_episode_access(
    request: Request,
    podcast_uuid: str,
    episode_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    """
    Verify user has read access to the podcast/episode.

    SECURITY: This ensures that:
    - Anonymous users can only access public+published podcasts
    - Authenticated users can access podcasts they have permission to view
    - Episode must belong to the specified podcast
    """
    # Verify episode exists and belongs to the podcast
    episode_stmt = select(PodcastEpisode).where(PodcastEpisode.episode_uuid == episode_uuid)
    episode = db_session.exec(episode_stmt).first()

    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")

    podcast_stmt = select(Podcast).where(Podcast.id == episode.podcast_id)
    podcast = db_session.exec(podcast_stmt).first()

    if not podcast or podcast.podcast_uuid != podcast_uuid:
        raise HTTPException(status_code=404, detail="Podcast not found or episode doesn't belong to podcast")

    # RBAC check - verify user can read this podcast
    checker = ResourceAccessChecker(request, db_session, current_user)
    decision = await checker.check_access(podcast_uuid, AccessAction.READ, AccessContext.PUBLIC_VIEW)

    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.reason)


@router.get("/video/{org_uuid}/{course_uuid}/{activity_uuid}/{filename:path}")
async def stream_activity_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Stream a video file for an activity with proper Range request support.

    This endpoint supports:
    - HTTP Range requests for seeking in long videos
    - Efficient chunked streaming
    - Proper Content-Type headers
    - Cache-Control headers for browser caching

    SECURITY: Validates user has read access to the course via RBAC.
    """
    # SECURITY: Verify user has access to this course/activity
    await _verify_course_activity_access(request, course_uuid, activity_uuid, current_user, db_session)

    # Construct and validate the file path
    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "courses",
        course_uuid,
        "activities",
        activity_uuid,
        "video",
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Video not found")

    # Get file info
    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Video not found")

    # Parse Range header if present
    range_header = request.headers.get("range")
    start, end = parse_range_header(range_header, file_size)

    # Calculate content length for this range
    content_length = end - start + 1

    # Common headers for video streaming
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
        "Cache-Control": "public, max-age=86400",  # Cache for 24 hours
        "X-Content-Type-Options": "nosniff",
    }

    if range_header:
        # Partial content response (206)
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        headers["Content-Length"] = str(content_length)

        return StreamingResponse(
            stream_video_file(file_path, start, end, CHUNK_SIZE),
            status_code=206,
            headers=headers,
            media_type=mime_type,
        )
    else:
        # Full content response (200)
        headers["Content-Length"] = str(file_size)

        return StreamingResponse(
            stream_video_file(file_path, 0, file_size - 1, CHUNK_SIZE),
            status_code=200,
            headers=headers,
            media_type=mime_type,
        )


@router.get("/block/audio/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}")
async def stream_block_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Stream an audio file from an audio block with proper Range request support.

    SECURITY: Validates user has read access to the course via RBAC.
    """
    # SECURITY: Verify user has access to this course/activity
    await _verify_course_activity_access(request, course_uuid, activity_uuid, current_user, db_session)

    # Construct and validate the file path
    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "courses",
        course_uuid,
        "activities",
        activity_uuid,
        "dynamic",
        "blocks",
        "audioBlock",
        block_uuid,
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Audio not found")

    # Get file info
    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Audio not found")

    # Parse Range header if present
    range_header = request.headers.get("range")
    start, end = parse_range_header(range_header, file_size)

    # Calculate content length for this range
    content_length = end - start + 1

    # Common headers for audio streaming
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    }

    if range_header:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        headers["Content-Length"] = str(content_length)

        return StreamingResponse(
            stream_video_file(file_path, start, end, CHUNK_SIZE),
            status_code=206,
            headers=headers,
            media_type=mime_type,
        )
    else:
        headers["Content-Length"] = str(file_size)

        return StreamingResponse(
            stream_video_file(file_path, 0, file_size - 1, CHUNK_SIZE),
            status_code=200,
            headers=headers,
            media_type=mime_type,
        )


@router.head("/block/audio/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}")
async def head_block_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    HEAD request for block audio - returns metadata without body.

    SECURITY: Validates user has read access to the course via RBAC.
    """
    await _verify_course_activity_access(request, course_uuid, activity_uuid, current_user, db_session)

    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "courses",
        course_uuid,
        "activities",
        activity_uuid,
        "dynamic",
        "blocks",
        "audioBlock",
        block_uuid,
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Audio not found")

    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Audio not found")

    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get("/block/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}")
async def stream_block_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Stream a video file from a video block with proper Range request support.

    This endpoint supports:
    - HTTP Range requests for seeking in long videos
    - Efficient chunked streaming
    - Proper Content-Type headers
    - Cache-Control headers for browser caching

    SECURITY: Validates user has read access to the course via RBAC.
    """
    # SECURITY: Verify user has access to this course/activity
    await _verify_course_activity_access(request, course_uuid, activity_uuid, current_user, db_session)

    # Construct and validate the file path
    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "courses",
        course_uuid,
        "activities",
        activity_uuid,
        "dynamic",
        "blocks",
        "videoBlock",
        block_uuid,
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Video not found")

    # Get file info
    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Video not found")

    # Parse Range header if present
    range_header = request.headers.get("range")
    start, end = parse_range_header(range_header, file_size)

    # Calculate content length for this range
    content_length = end - start + 1

    # Common headers for video streaming
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
        "Cache-Control": "public, max-age=86400",  # Cache for 24 hours
        "X-Content-Type-Options": "nosniff",
    }

    if range_header:
        # Partial content response (206)
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        headers["Content-Length"] = str(content_length)

        return StreamingResponse(
            stream_video_file(file_path, start, end, CHUNK_SIZE),
            status_code=206,
            headers=headers,
            media_type=mime_type,
        )
    else:
        # Full content response (200)
        headers["Content-Length"] = str(file_size)

        return StreamingResponse(
            stream_video_file(file_path, 0, file_size - 1, CHUNK_SIZE),
            status_code=200,
            headers=headers,
            media_type=mime_type,
        )


@router.head("/video/{org_uuid}/{course_uuid}/{activity_uuid}/{filename:path}")
async def head_activity_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    HEAD request for activity video - returns metadata without body.

    This is used by video players to determine file size and supported ranges
    before starting playback.

    SECURITY: Validates user has read access to the course via RBAC.
    """
    # SECURITY: Verify user has access to this course/activity
    await _verify_course_activity_access(request, course_uuid, activity_uuid, current_user, db_session)

    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "courses",
        course_uuid,
        "activities",
        activity_uuid,
        "video",
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Video not found")

    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Video not found")

    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.head("/block/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}")
async def head_block_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    HEAD request for block video - returns metadata without body.

    This is used by video players to determine file size and supported ranges
    before starting playback.

    SECURITY: Validates user has read access to the course via RBAC.
    """
    # SECURITY: Verify user has access to this course/activity
    await _verify_course_activity_access(request, course_uuid, activity_uuid, current_user, db_session)

    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "courses",
        course_uuid,
        "activities",
        activity_uuid,
        "dynamic",
        "blocks",
        "videoBlock",
        block_uuid,
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Video not found")

    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Video not found")

    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get("/audio/{org_uuid}/{podcast_uuid}/{episode_uuid}/{filename:path}")
async def stream_podcast_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    podcast_uuid: str = Path(..., description="Podcast UUID"),
    episode_uuid: str = Path(..., description="Episode UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Stream an audio file for a podcast episode with proper Range request support.

    This endpoint supports:
    - HTTP Range requests for seeking in audio files
    - Efficient chunked streaming
    - Proper Content-Type headers
    - Cache-Control headers for browser caching

    SECURITY: Validates user has read access to the podcast via RBAC.
    """
    # SECURITY: Verify user has access to this podcast/episode
    await _verify_podcast_episode_access(request, podcast_uuid, episode_uuid, current_user, db_session)

    # Construct and validate the file path
    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "podcasts",
        podcast_uuid,
        "episodes",
        episode_uuid,
        "audio",
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Audio not found")

    # Get file info
    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Audio not found")

    # Parse Range header if present
    range_header = request.headers.get("range")
    start, end = parse_range_header(range_header, file_size)

    # Calculate content length for this range
    content_length = end - start + 1

    # Common headers for audio streaming
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
        "Cache-Control": "public, max-age=86400",  # Cache for 24 hours
        "X-Content-Type-Options": "nosniff",
    }

    if range_header:
        # Partial content response (206)
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        headers["Content-Length"] = str(content_length)

        return StreamingResponse(
            stream_video_file(file_path, start, end, CHUNK_SIZE),
            status_code=206,
            headers=headers,
            media_type=mime_type,
        )
    else:
        # Full content response (200)
        headers["Content-Length"] = str(file_size)

        return StreamingResponse(
            stream_video_file(file_path, 0, file_size - 1, CHUNK_SIZE),
            status_code=200,
            headers=headers,
            media_type=mime_type,
        )


@router.head("/audio/{org_uuid}/{podcast_uuid}/{episode_uuid}/{filename:path}")
async def head_podcast_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    podcast_uuid: str = Path(..., description="Podcast UUID"),
    episode_uuid: str = Path(..., description="Episode UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    HEAD request for podcast audio - returns metadata without body.

    This is used by audio players to determine file size and supported ranges
    before starting playback.

    SECURITY: Validates user has read access to the podcast via RBAC.
    """
    # SECURITY: Verify user has access to this podcast/episode
    await _verify_podcast_episode_access(request, podcast_uuid, episode_uuid, current_user, db_session)

    file_path = validate_video_path(
        CONTENT_DIR,
        "orgs",
        org_uuid,
        "podcasts",
        podcast_uuid,
        "episodes",
        episode_uuid,
        "audio",
        filename,
    )

    if not file_path:
        raise HTTPException(status_code=404, detail="Audio not found")

    file_size, mime_type, exists = get_file_info(file_path)

    if not exists:
        raise HTTPException(status_code=404, detail="Audio not found")

    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Cache-Control": "public, max-age=86400",
        },
    )
