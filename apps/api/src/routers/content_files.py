"""
Content Files Router

Serves static content files from S3 storage when S3 is enabled.
Replaces the StaticFiles mount for S3 deployments.

SECURITY:
- Activity content (videos, PDFs, blocks) for non-public courses requires auth
- Course-level metadata (thumbnails) is always public (shown in listings)
- Org-level content (logos, branding) is always public
- Podcast episode content for non-public podcasts requires auth
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from pathlib import Path
from sqlmodel import Session, select

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.podcasts.podcasts import Podcast
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.db.user_organizations import UserOrganization
from src.security.auth import get_current_user
from src.services.courses.transfer.storage_utils import (
    get_storage_client,
    get_s3_bucket_name,
)

router = APIRouter()

# MIME type mapping
MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.txt': 'text/plain',
}

CHUNK_SIZE = 1024 * 1024  # 1MB


def _get_mime_type(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    return MIME_TYPES.get(ext, 'application/octet-stream')


def _validate_content_path(file_path: str) -> str | None:
    """Validate and sanitize path, preventing directory traversal.

    Returns the sanitized relative path string, or None if the path is unsafe.
    """
    from urllib.parse import unquote
    # Decode any URL-encoded characters to catch %2e%2e etc.
    decoded = unquote(unquote(file_path))  # Double-decode to catch double-encoding
    if '..' in decoded or decoded.startswith('/') or '\x00' in decoded:
        return None
    # Normalize path separators
    normalized = decoded.replace('\\', '/')
    if '..' in normalized:
        return None
    # Defense-in-depth: resolve path and verify it stays within the content prefix
    base = Path("content").resolve()
    resolved = (base / normalized).resolve()
    if not str(resolved).startswith(str(base)):
        return None
    # Return the validated relative path derived from the resolved path
    return str(resolved.relative_to(base))


def _check_content_access(
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    """
    Check if the user has access to the requested content.

    Path patterns:
    - orgs/{uuid}/courses/{uuid}/activities/{uuid}/... → check course access
    - orgs/{uuid}/courses/{uuid}/...                   → course metadata (public)
    - orgs/{uuid}/podcasts/{uuid}/episodes/{uuid}/...  → check podcast access
    - orgs/{uuid}/...                                  → org-level (public)
    """
    parts = file_path.split('/')

    # Activity content: requires course to be public or user to be org member
    if (
        len(parts) >= 6
        and parts[0] == 'orgs'
        and parts[2] == 'courses'
        and parts[4] == 'activities'
    ):
        course_uuid = parts[3]
        course = db_session.exec(
            select(Course).where(Course.course_uuid == course_uuid)
        ).first()
        if not course:
            raise HTTPException(status_code=403, detail="Access denied")
        if course.public:
            return  # Public course — allow anonymous
        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=401, detail="Authentication required")
        # Verify API token is scoped to the correct org
        if isinstance(current_user, APITokenUser):
            if current_user.org_id != course.org_id:
                raise HTTPException(status_code=403, detail="Access denied")
            return
        # Verify user belongs to the org that owns this course
        membership = db_session.exec(
            select(UserOrganization).where(
                UserOrganization.user_id == current_user.id,
                UserOrganization.org_id == course.org_id,
            )
        ).first()
        if not membership:
            raise HTTPException(status_code=403, detail="Access denied")
        return

    # Podcast episode content: requires podcast to be public or user to be org member
    if (
        len(parts) >= 6
        and parts[0] == 'orgs'
        and parts[2] == 'podcasts'
        and parts[4] == 'episodes'
    ):
        podcast_uuid = parts[3]
        podcast = db_session.exec(
            select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
        ).first()
        if not podcast:
            raise HTTPException(status_code=403, detail="Access denied")
        if podcast.public:
            return  # Public podcast — allow anonymous
        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=401, detail="Authentication required")
        # Verify API token is scoped to the correct org
        if isinstance(current_user, APITokenUser):
            if current_user.org_id != podcast.org_id:
                raise HTTPException(status_code=403, detail="Access denied")
            return
        # Verify user belongs to the org that owns this podcast
        membership = db_session.exec(
            select(UserOrganization).where(
                UserOrganization.user_id == current_user.id,
                UserOrganization.org_id == podcast.org_id,
            )
        ).first()
        if not membership:
            raise HTTPException(status_code=403, detail="Access denied")
        return

    # Course metadata (thumbnails, etc.) and org-level content — always public
    if len(parts) >= 2 and parts[0] == 'orgs':
        return

    # User content (avatars, profile images) — always public
    if len(parts) >= 2 and parts[0] == 'users':
        return

    # Unknown path pattern — require auth as a safe default
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")


@router.get("/content/{file_path:path}")
async def serve_content_file(
    request: Request,
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Serve content files from S3 storage.

    Supports HTTP Range requests for video/audio seeking.
    """
    safe_path = _validate_content_path(file_path)
    if safe_path is None:
        raise HTTPException(status_code=400, detail="Invalid path")

    _check_content_access(safe_path, current_user, db_session)

    s3_key = f"content/{safe_path}"
    s3_client = get_storage_client()
    bucket = get_s3_bucket_name()

    if not s3_client:
        raise HTTPException(status_code=500, detail="Storage not configured")

    # Get file metadata
    try:
        head = s3_client.head_object(Bucket=bucket, Key=s3_key)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    file_size = head['ContentLength']
    mime_type = _get_mime_type(safe_path)

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    }

    range_header = request.headers.get("range")

    if range_header:
        # Parse range
        try:
            range_spec = range_header.replace('bytes=', '')
            if range_spec.startswith('-'):
                suffix_length = int(range_spec[1:])
                start = max(0, file_size - suffix_length)
                end = file_size - 1
            elif range_spec.endswith('-'):
                start = int(range_spec[:-1])
                end = file_size - 1
            else:
                parts = range_spec.split('-')
                start = int(parts[0])
                end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1

            start = max(0, min(start, file_size - 1))
            end = max(start, min(end, file_size - 1))
        except (ValueError, IndexError):
            start, end = 0, file_size - 1

        content_length = end - start + 1
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        headers["Content-Length"] = str(content_length)

        def stream_range():
            remaining = content_length
            pos = start
            while remaining > 0:
                chunk_end = min(pos + CHUNK_SIZE - 1, end)
                resp = s3_client.get_object(
                    Bucket=bucket, Key=s3_key,
                    Range=f"bytes={pos}-{chunk_end}",
                )
                data = resp['Body'].read()
                if not data:
                    break
                remaining -= len(data)
                pos += len(data)
                yield data

        return StreamingResponse(
            stream_range(),
            status_code=206,
            headers=headers,
            media_type=mime_type,
        )
    else:
        headers["Content-Length"] = str(file_size)

        def stream_full():
            remaining = file_size
            pos = 0
            while remaining > 0:
                chunk_end = min(pos + CHUNK_SIZE - 1, file_size - 1)
                resp = s3_client.get_object(
                    Bucket=bucket, Key=s3_key,
                    Range=f"bytes={pos}-{chunk_end}",
                )
                data = resp['Body'].read()
                if not data:
                    break
                remaining -= len(data)
                pos += len(data)
                yield data

        return StreamingResponse(
            stream_full(),
            status_code=200,
            headers=headers,
            media_type=mime_type,
        )


@router.head("/content/{file_path:path}")
async def head_content_file(
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """HEAD request for content files - returns metadata without body."""
    safe_path = _validate_content_path(file_path)
    if safe_path is None:
        raise HTTPException(status_code=400, detail="Invalid path")

    _check_content_access(safe_path, current_user, db_session)

    s3_key = f"content/{safe_path}"
    s3_client = get_storage_client()
    bucket = get_s3_bucket_name()

    if not s3_client:
        raise HTTPException(status_code=500, detail="Storage not configured")

    try:
        head = s3_client.head_object(Bucket=bucket, Key=s3_key)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    file_size = head['ContentLength']
    mime_type = _get_mime_type(safe_path)

    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Cache-Control": "public, max-age=86400",
        },
    )
