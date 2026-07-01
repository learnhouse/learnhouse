"""
Video Streaming Router

This router provides optimized video streaming endpoints with proper HTTP Range
request handling for seamless playback of long video files.

SECURITY: All streaming endpoints validate resource access using the RBAC system.
Anonymous users can only stream content from public+published resources.
"""

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Path
from fastapi.responses import StreamingResponse, Response, RedirectResponse
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.courses.activities import Activity
from src.db.podcasts.podcasts import Podcast
from src.db.podcasts.episodes import PodcastEpisode
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.security.rbac.resource_access import ResourceAccessChecker, AccessAction, AccessContext
from src.services.courses.transfer.storage_utils import (
    is_s3_enabled,
    generate_presigned_get_url,
    read_file_content,
)
from src.services.utils.video_streaming import (
    stream_video_file,
    parse_range_header,
    get_file_info,
    validate_video_path,
    CHUNK_SIZE,
)
from src.services.utils.hls_playlist import rewrite_playlist

router = APIRouter()

# Base content directory
CONTENT_DIR = "content"

# HLS MIME types (not covered by the generic media maps).
_HLS_MIME = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
    ".m4s": "video/iso.segment",
}


def _safe_hls_relpath(hls_path: str) -> str | None:
    """Validate the client-supplied HLS sub-path (playlist or segment).

    Only bare filenames and single-level rendition dirs (e.g. `master.m3u8`,
    `v720p/index.m3u8`, `v720p/seg_0003.ts`) are allowed. Rejects traversal,
    absolute paths, and unexpected extensions.
    """
    if not hls_path or "\x00" in hls_path or hls_path.startswith("/"):
        return None
    parts = hls_path.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    if os.path.splitext(parts[-1])[1].lower() not in _HLS_MIME:
        return None
    return "/".join(parts)

# The 302 to the presigned URL is cacheable for a bounded window. This is
# critical for smooth playback: without it (no-store) the browser re-resolves
# the redirect — re-running RBAC + presign (~0.3–1.3s) — on every seek and
# reconnect, starving the buffer and causing periodic stalls. Caching lets the
# browser resolve once and reuse the same R2 URL for all Range requests. The
# 6h window stays well under the 24h presign TTL so a cached 302 never points
# at an expired URL. "private" keeps shared caches (Cloudflare) from storing a
# user-scoped signed URL.
_PRESIGNED_REDIRECT_HEADERS = {"Cache-Control": "private, max-age=21600"}


def _redirect_to_storage(file_path: str) -> RedirectResponse | None:
    """
    When S3/R2 is enabled, build a 302 redirect to a presigned URL so the
    browser streams media directly from object storage (native Range support,
    full edge throughput) instead of proxying every byte through this API.

    Returns None when S3 isn't enabled or signing fails, so the caller falls
    back to streaming the file through the API.

    SECURITY: callers MUST run their RBAC check before calling this — the
    presigned URL grants temporary unauthenticated read access to the object.
    """
    if not is_s3_enabled():
        return None
    presigned = generate_presigned_get_url(file_path)
    if not presigned:
        return None
    return RedirectResponse(
        url=presigned,
        status_code=302,
        headers=_PRESIGNED_REDIRECT_HEADERS,
    )


async def _verify_course_activity_access(
    request: Request,
    course_uuid: str,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
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
    activity = (await db_session.execute(activity_stmt)).scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Verify course exists and activity belongs to it
    course_stmt = select(Course).where(Course.id == activity.course_id)
    course = (await db_session.execute(course_stmt)).scalars().first()

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
    db_session: AsyncSession,
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
    episode = (await db_session.execute(episode_stmt)).scalars().first()

    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")

    podcast_stmt = select(Podcast).where(Podcast.id == episode.podcast_id)
    podcast = (await db_session.execute(podcast_stmt)).scalars().first()

    if not podcast or podcast.podcast_uuid != podcast_uuid:
        raise HTTPException(status_code=404, detail="Podcast not found or episode doesn't belong to podcast")

    # RBAC check - verify user can read this podcast
    checker = ResourceAccessChecker(request, db_session, current_user)
    decision = await checker.check_access(podcast_uuid, AccessAction.READ, AccessContext.PUBLIC_VIEW)

    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.reason)


@router.get(
    "/video/{org_uuid}/{course_uuid}/{activity_uuid}/{filename:path}",
    summary="Stream an activity video",
    description="Streams a video file for a course activity with HTTP Range request support. Validates user read access via RBAC before serving the file.",
    responses={
        200: {"description": "Full video streamed successfully"},
        206: {"description": "Partial video content returned for a Range request"},
        403: {"description": "User is not permitted to read this course"},
        404: {"description": "Activity, course, or video file not found"},
    },
)
async def stream_activity_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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

    # S3/R2: redirect to object storage so the browser streams directly. RBAC
    # was already enforced above, so the short-lived presigned URL is safe.
    redirect = _redirect_to_storage(file_path)
    if redirect:
        return redirect

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


@router.get(
    "/hls/{org_uuid}/{course_uuid}/{activity_uuid}/{hls_path:path}",
    summary="Serve an HLS playlist or segment for an activity video",
    description=(
        "Serves the adaptive-bitrate HLS assets for a hosted video activity. "
        "Playlists (.m3u8) are returned after an RBAC check with every segment "
        "URL rewritten to a presigned R2 URL, so the player fetches segments "
        "directly from object storage. Segments are only served here in local "
        "filesystem mode."
    ),
    responses={
        200: {"description": "Playlist or segment returned"},
        302: {"description": "Redirect to a presigned segment URL (S3/R2 mode)"},
        403: {"description": "User is not permitted to read this course"},
        404: {"description": "Activity, course, or HLS asset not found"},
    },
)
async def stream_activity_hls(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    hls_path: str = Path(..., description="HLS asset path (e.g. master.m3u8)"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Serve HLS playlists (rewriting segment URLs to presigned R2 URLs) and, in
    local mode, the segments themselves.

    SECURITY: RBAC runs before any content is read or any URL is signed.
    """
    await _verify_course_activity_access(request, course_uuid, activity_uuid, current_user, db_session)

    rel = _safe_hls_relpath(hls_path)
    if rel is None:
        raise HTTPException(status_code=404, detail="HLS asset not found")

    # S3 keys use forward slashes; the on-disk layout mirrors it.
    base_key = f"{CONTENT_DIR}/orgs/{org_uuid}/courses/{course_uuid}/activities/{activity_uuid}/video/hls"
    asset_key = f"{base_key}/{rel}"
    ext = os.path.splitext(rel)[1].lower()

    if ext == ".m3u8":
        raw = read_file_content(asset_key)
        if raw is None:
            raise HTTPException(status_code=404, detail="Playlist not found")
        playlist_dir_key = asset_key.rsplit("/", 1)[0]
        # In S3 mode generate_presigned_get_url signs each segment; in local
        # mode it returns None, so segment refs stay relative and come back here.
        body = rewrite_playlist(
            raw.decode("utf-8", errors="replace"),
            playlist_dir_key,
            generate_presigned_get_url,
        )
        return Response(
            content=body,
            media_type=_HLS_MIME[".m3u8"],
            headers={
                # Shorter than the presign TTL so cached playlists never carry
                # expired segment URLs.
                "Cache-Control": "private, max-age=300",
                "X-Content-Type-Options": "nosniff",
            },
        )

    # Segment request. In S3 mode the player uses presigned URLs directly, so
    # this is only hit in local mode — but redirect defensively if S3 is on.
    redirect = _redirect_to_storage(asset_key)
    if redirect:
        return redirect
    raw = read_file_content(asset_key)
    if raw is None:
        raise HTTPException(status_code=404, detail="Segment not found")
    return Response(
        content=raw,
        media_type=_HLS_MIME.get(ext, "application/octet-stream"),
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/block/audio/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}",
    summary="Stream an audio block file",
    description="Streams an audio file attached to an audio block within an activity, with HTTP Range request support. Validates user read access to the parent course via RBAC.",
    responses={
        200: {"description": "Full audio streamed successfully"},
        206: {"description": "Partial audio content returned for a Range request"},
        403: {"description": "User is not permitted to read this course"},
        404: {"description": "Activity, course, or audio file not found"},
    },
)
async def stream_block_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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

    # S3/R2: redirect to object storage so the browser streams directly. RBAC
    # was already enforced above, so the short-lived presigned URL is safe.
    redirect = _redirect_to_storage(file_path)
    if redirect:
        return redirect

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


@router.head(
    "/block/audio/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}",
    summary="Get audio block file metadata",
    description="Returns metadata for an audio block file without the body. Used by audio players to probe file size and MIME type before playback.",
    responses={
        200: {"description": "Audio metadata returned via response headers"},
        403: {"description": "User is not permitted to read this course"},
        404: {"description": "Activity, course, or audio file not found"},
    },
)
async def head_block_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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


@router.get(
    "/block/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}",
    summary="Stream a video block file",
    description="Streams a video file attached to a video block within an activity, with HTTP Range request support. Validates user read access to the parent course via RBAC.",
    responses={
        200: {"description": "Full video streamed successfully"},
        206: {"description": "Partial video content returned for a Range request"},
        403: {"description": "User is not permitted to read this course"},
        404: {"description": "Activity, course, or video file not found"},
    },
)
async def stream_block_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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

    # S3/R2: redirect to object storage so the browser streams directly. RBAC
    # was already enforced above, so the short-lived presigned URL is safe.
    redirect = _redirect_to_storage(file_path)
    if redirect:
        return redirect

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


@router.head(
    "/video/{org_uuid}/{course_uuid}/{activity_uuid}/{filename:path}",
    summary="Get activity video metadata",
    description="Returns metadata for an activity video without the body. Used by video players to probe file size and Range support before playback.",
    responses={
        200: {"description": "Video metadata returned via response headers"},
        403: {"description": "User is not permitted to read this course"},
        404: {"description": "Activity, course, or video file not found"},
    },
)
async def head_activity_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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


@router.head(
    "/block/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}",
    summary="Get video block file metadata",
    description="Returns metadata for a video block file without the body. Used by video players to probe file size and Range support before playback.",
    responses={
        200: {"description": "Video metadata returned via response headers"},
        403: {"description": "User is not permitted to read this course"},
        404: {"description": "Activity, course, or video file not found"},
    },
)
async def head_block_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Video filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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


@router.get(
    "/audio/{org_uuid}/{podcast_uuid}/{episode_uuid}/{filename:path}",
    summary="Stream a podcast episode audio",
    description="Streams a podcast episode audio file with HTTP Range request support. Validates user read access to the podcast via RBAC before serving the file.",
    responses={
        200: {"description": "Full audio streamed successfully"},
        206: {"description": "Partial audio content returned for a Range request"},
        403: {"description": "User is not permitted to read this podcast"},
        404: {"description": "Podcast, episode, or audio file not found"},
    },
)
async def stream_podcast_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    podcast_uuid: str = Path(..., description="Podcast UUID"),
    episode_uuid: str = Path(..., description="Episode UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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

    # S3/R2: redirect to object storage so the browser streams directly. RBAC
    # was already enforced above, so the short-lived presigned URL is safe.
    redirect = _redirect_to_storage(file_path)
    if redirect:
        return redirect

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


@router.head(
    "/audio/{org_uuid}/{podcast_uuid}/{episode_uuid}/{filename:path}",
    summary="Get podcast audio metadata",
    description="Returns metadata for a podcast episode audio file without the body. Used by audio players to probe file size and Range support before playback.",
    responses={
        200: {"description": "Audio metadata returned via response headers"},
        403: {"description": "User is not permitted to read this podcast"},
        404: {"description": "Podcast, episode, or audio file not found"},
    },
)
async def head_podcast_audio(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    podcast_uuid: str = Path(..., description="Podcast UUID"),
    episode_uuid: str = Path(..., description="Episode UUID"),
    filename: str = Path(..., description="Audio filename"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
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
