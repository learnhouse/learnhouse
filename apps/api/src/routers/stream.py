"""
Video Streaming Router

This router provides optimized video streaming endpoints with proper HTTP Range
request handling for seamless playback of long video files.
"""

from fastapi import APIRouter, HTTPException, Request, Path
from fastapi.responses import StreamingResponse, Response
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


@router.get("/video/{org_uuid}/{course_uuid}/{activity_uuid}/{filename:path}")
async def stream_activity_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    filename: str = Path(..., description="Video filename"),
):
    """
    Stream a video file for an activity with proper Range request support.

    This endpoint supports:
    - HTTP Range requests for seeking in long videos
    - Efficient chunked streaming
    - Proper Content-Type headers
    - Cache-Control headers for browser caching
    """
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


@router.get("/block/{org_uuid}/{course_uuid}/{activity_uuid}/{block_uuid}/{filename:path}")
async def stream_block_video(
    request: Request,
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Video filename"),
):
    """
    Stream a video file from a video block with proper Range request support.

    This endpoint supports:
    - HTTP Range requests for seeking in long videos
    - Efficient chunked streaming
    - Proper Content-Type headers
    - Cache-Control headers for browser caching
    """
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
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    filename: str = Path(..., description="Video filename"),
):
    """
    HEAD request for activity video - returns metadata without body.

    This is used by video players to determine file size and supported ranges
    before starting playback.
    """
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
    org_uuid: str = Path(..., description="Organization UUID"),
    course_uuid: str = Path(..., description="Course UUID"),
    activity_uuid: str = Path(..., description="Activity UUID"),
    block_uuid: str = Path(..., description="Block UUID"),
    filename: str = Path(..., description="Video filename"),
):
    """
    HEAD request for block video - returns metadata without body.

    This is used by video players to determine file size and supported ranges
    before starting playback.
    """
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
):
    """
    Stream an audio file for a podcast episode with proper Range request support.

    This endpoint supports:
    - HTTP Range requests for seeking in audio files
    - Efficient chunked streaming
    - Proper Content-Type headers
    - Cache-Control headers for browser caching
    """
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
    org_uuid: str = Path(..., description="Organization UUID"),
    podcast_uuid: str = Path(..., description="Podcast UUID"),
    episode_uuid: str = Path(..., description="Episode UUID"),
    filename: str = Path(..., description="Audio filename"),
):
    """
    HEAD request for podcast audio - returns metadata without body.

    This is used by audio players to determine file size and supported ranges
    before starting playback.
    """
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
