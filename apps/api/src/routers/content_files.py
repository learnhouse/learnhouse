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

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from pathlib import Path
from urllib.parse import quote
from sqlmodel import select
from botocore.exceptions import ClientError

from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.security.auth import get_current_user
from src.services.courses.activities.access import verify_activity_reader_access_by_uuid
from src.security.submission_file_access import (
    enforce_solution_file_access,
    enforce_submission_file_access,
    is_solution_file,
    is_submission_file,
)
from src.services.courses.transfer.storage_utils import (
    get_storage_client,
    get_s3_bucket_name,
)

router = APIRouter()

# MIME type mapping.
#
# SECURITY: no type a browser executes as a document is listed here; no
# text/html, application/javascript, text/css or application/xml. Content keys
# can carry a caller-chosen extension (course import packages name their own
# files), and this endpoint answers on the shared API origin where every
# tenant's session cookies live, so a renderable Content-Type would be a
# stored-XSS primitive. Unknown extensions fall back to application/octet-stream
# and, like every non-media type, are served as an attachment.
#
# SVG is the one exception: org logos and thumbnails are legitimately uploaded
# as SVG, so refusing to render it would blank them out. It keeps its real type
# and stays inline, but is served under `_SVG_CSP`; scripting inside an SVG is
# already disabled when it loads through <img>, and the CSP covers the
# remaining case of someone opening the URL top-level or framing it.
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
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.txt': 'text/plain',
}

CHUNK_SIZE = 1024 * 1024  # 1MB

# Only these types are rendered inline; everything else is downloaded. Same
# treatment as `src/services/media/media_serve.py`.
_INLINE_MIME_PREFIXES = ('image/', 'audio/', 'video/')
_INLINE_MIME_TYPES = frozenset({'application/pdf'})

# Neutralizes an SVG opened top-level or framed: no script, no subresources,
# and an opaque origin, so it cannot reach the API it is served from.
_SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"


# Gated files must stay out of shared caches (CDN, proxies): a copy cached
# there would be served to the next caller without the access check. Browsers
# may still keep them, which is what video seeking relies on.
PUBLIC_CACHE_CONTROL = "public, max-age=86400"
PRIVATE_CACHE_CONTROL = "private, max-age=86400"


def content_cache_control(is_public: bool) -> str:
    return PUBLIC_CACHE_CONTROL if is_public else PRIVATE_CACHE_CONTROL


def _get_mime_type(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    return MIME_TYPES.get(ext, 'application/octet-stream')


def _security_headers(mime_type: str) -> dict[str, str]:
    """Extra response headers for types that need containment."""
    if mime_type == 'image/svg+xml':
        return {'Content-Security-Policy': _SVG_CSP}
    return {}


def _content_disposition(mime_type: str, file_path: str) -> str:
    """Build the Content-Disposition header for a served file.

    Renderable media stays inline (players and <img> need it); anything else,
    including every unrecognized extension, is forced to download so the file
    can never be interpreted as a document on the API origin. RFC 5987
    encoding keeps non-ASCII filenames intact.
    """
    inline = mime_type.startswith(_INLINE_MIME_PREFIXES) or mime_type in _INLINE_MIME_TYPES
    disposition = "inline" if inline else "attachment"
    filename = Path(file_path).name or "file"
    return f"{disposition}; filename*=UTF-8''{quote(filename, safe='')}"


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
    # Canonicalize via os.path.realpath (resolves symlinks, normalizes) and verify containment.
    # realpath is used deliberately: it is a recognized path-injection sanitizer.
    base_real = os.path.realpath(str(Path("content")))
    full_real = os.path.realpath(os.path.join(base_real, normalized))
    if not full_real.startswith(base_real + os.sep):
        return None
    # Return the validated relative path
    return os.path.relpath(full_real, base_real)


async def _verify_course_in_org(
    org_uuid: str, course_uuid: str, db_session: AsyncSession
) -> None:
    """404 unless ``course_uuid`` exists and belongs to the org ``org_uuid``."""
    course_org_uuid = (await db_session.execute(
        select(Organization.org_uuid)
        .join(Course, Course.org_id == Organization.id)  # type: ignore[arg-type]
        .where(Course.course_uuid == course_uuid)
    )).scalars().first()
    if course_org_uuid is None or course_org_uuid != org_uuid:
        raise HTTPException(status_code=404, detail="File not found")


async def _verify_episode_access(
    org_uuid: str,
    podcast_uuid: str,
    episode_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    request: Request | None,
) -> None:
    """Gate a podcast episode file like the podcast read itself.

    The podcast must belong to ``org_uuid`` and the episode to the podcast
    (404 otherwise). The caller needs podcast READ (anonymous: public and
    published), and an unpublished podcast or episode is only served to
    someone who can edit the podcast.
    """
    row = (await db_session.execute(
        select(Podcast, Organization.org_uuid)
        .join(Organization, Organization.id == Podcast.org_id)  # type: ignore[arg-type]
        .where(Podcast.podcast_uuid == podcast_uuid)
    )).first()
    if not row or row[1] != org_uuid:
        raise HTTPException(status_code=404, detail="File not found")
    podcast = row[0]
    episode = (await db_session.execute(
        select(PodcastEpisode).where(
            PodcastEpisode.episode_uuid == episode_uuid,
            PodcastEpisode.podcast_id == podcast.id,
        )
    )).scalars().first()
    if not episode:
        raise HTTPException(status_code=404, detail="File not found")

    from src.security.rbac import check_resource_access, AccessAction

    decision = await check_resource_access(
        request, db_session, current_user, podcast.podcast_uuid,
        AccessAction.READ, raise_on_deny=False,
    )
    if not decision.allowed:
        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=401, detail="Authentication required")
        raise HTTPException(status_code=403, detail="Access denied")

    if not (podcast.published and episode.published):
        can_edit = (await check_resource_access(
            request, db_session, current_user, podcast.podcast_uuid,
            AccessAction.UPDATE, raise_on_deny=False,
        )).allowed
        if not can_edit:
            raise HTTPException(status_code=404, detail="File not found")


async def _check_content_access(
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    request: Request | None = None,
) -> bool:
    """
    Check if the user has access to the requested content.

    Returns True when the file is public by design (org branding, course
    thumbnails, avatars) and may be cached by shared caches; False for files
    served after a per-user check.

    Path patterns:
    - orgs/{uuid}/courses/{uuid}/activities/{uuid}/... → check course access
    - orgs/{uuid}/courses/{uuid}/...                   → course metadata (public)
    - orgs/{uuid}/podcasts/{uuid}/episodes/{uuid}/...  → check podcast access
    - orgs/{uuid}/...                                  → org-level (public)
    """
    parts = file_path.split('/')

    # Course activity files (including submission files): the org segment must
    # be the course's org, so one org's path can't front another org's file.
    if (
        len(parts) >= 6
        and parts[0] == 'orgs'
        and parts[2] == 'courses'
        and parts[4] == 'activities'
    ):
        await _verify_course_in_org(parts[1], parts[3], db_session)

    # Assignment submission files must be gated to the owner or an instructor,
    # not the generic activity-content grant below (which would let any org
    # member, or anyone on a public course, download another learner's work).
    if is_submission_file(parts):
        await enforce_submission_file_access(parts, current_user, db_session, request)
        return False

    # Activity content: requires course to be public or user to be org member
    if (
        len(parts) >= 6
        and parts[0] == 'orgs'
        and parts[2] == 'courses'
        and parts[4] == 'activities'
    ):
        # The files under an activity (HLS segments and key, captions, block
        # uploads) are the activity: apply the activity's own gate (course
        # read, published, paywall, locks), not just "public course or member".
        course_uuid, activity_uuid = parts[3], parts[5]
        await verify_activity_reader_access_by_uuid(
            request, activity_uuid, current_user, db_session, course_uuid=course_uuid
        )
        # The model answer follows the assignment's reveal rule, same as the API
        if is_solution_file(parts):
            await enforce_solution_file_access(parts, current_user, db_session, request)
        return False

    # Podcast episode content: same gate as reading the podcast, plus the
    # episode itself must be published unless the caller can edit the podcast.
    if (
        len(parts) >= 6
        and parts[0] == 'orgs'
        and parts[2] == 'podcasts'
        and parts[4] == 'episodes'
    ):
        await _verify_episode_access(
            parts[1], parts[3], parts[5], current_user, db_session, request
        )
        return False

    # Library media content: enforce the media's (folder-aware) access. Closes
    # the legacy hole where orgs/{}/media/... fell through to the public branch.
    if len(parts) >= 4 and parts[0] == 'orgs' and parts[2] == 'media':
        from src.security.rbac import check_resource_access, AccessAction
        media_uuid = parts[3]  # legacy keys embed media_uuid as the directory
        if media_uuid.startswith('media_'):
            await check_resource_access(
                request, db_session, current_user, media_uuid, AccessAction.READ
            )
            return False
        # Randomized keys don't embed the media_uuid → deny direct /content
        # access (these are only served via /media/{uuid}/file).
        raise HTTPException(status_code=403, detail="Access denied")

    # Course metadata (thumbnails, etc.) and org-level content: always public
    if len(parts) >= 2 and parts[0] == 'orgs':
        return True

    # User content (avatars, profile images): always public
    if len(parts) >= 2 and parts[0] == 'users':
        return True

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    raise HTTPException(status_code=403, detail="Access denied")


@router.get(
    "/content/{file_path:path}",
    summary="Serve a content file",
    description="Streams a content file (videos, PDFs, images, etc.) from S3 storage. Supports HTTP Range requests for video/audio seeking. Access is enforced based on the path prefix: activity and podcast episode content require authentication and org membership for non-public resources, while course metadata and org branding are public.",
    responses={
        200: {"description": "File streamed successfully"},
        206: {"description": "Partial content returned for a Range request"},
        400: {"description": "Invalid or unsafe file path"},
        401: {"description": "Authentication required to access this file"},
        403: {"description": "User is not permitted to access this file"},
        404: {"description": "File not found in storage"},
        500: {"description": "Storage backend is not configured"},
    },
)
async def serve_content_file(
    request: Request,
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Serve content files from S3 storage.

    Supports HTTP Range requests for video/audio seeking.
    """
    safe_path = _validate_content_path(file_path)
    if safe_path is None:
        raise HTTPException(status_code=400, detail="Invalid path")

    is_public = await _check_content_access(safe_path, current_user, db_session, request=request)

    s3_key = f"content/{safe_path}"
    s3_client = get_storage_client()
    bucket = get_s3_bucket_name()

    if not s3_client:
        raise HTTPException(status_code=500, detail="Storage not configured")

    # Get file metadata
    try:
        head = s3_client.head_object(Bucket=bucket, Key=s3_key)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            raise HTTPException(status_code=404, detail="File not found")
        elif code in ("AccessDenied", "403"):
            raise HTTPException(status_code=403, detail="Access denied")
        else:
            raise HTTPException(status_code=502, detail="Storage service error")
    except Exception:
        raise HTTPException(status_code=502, detail="Storage service error")

    file_size = head['ContentLength']
    mime_type = _get_mime_type(safe_path)

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
        "Cache-Control": content_cache_control(is_public),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": _content_disposition(mime_type, safe_path),
        **_security_headers(mime_type),
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
                try:
                    data = resp['Body'].read()
                finally:
                    resp['Body'].close()
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
                try:
                    data = resp['Body'].read()
                finally:
                    resp['Body'].close()
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


@router.head(
    "/content/{file_path:path}",
    summary="Get content file metadata",
    description="Returns metadata for a content file without the body. Used by clients to probe file size, MIME type, and Range support before issuing a GET.",
    responses={
        200: {"description": "File metadata returned via response headers"},
        400: {"description": "Invalid or unsafe file path"},
        401: {"description": "Authentication required to access this file"},
        403: {"description": "User is not permitted to access this file"},
        404: {"description": "File not found in storage"},
        500: {"description": "Storage backend is not configured"},
    },
)
async def head_content_file(
    request: Request,
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """HEAD request for content files - returns metadata without body."""
    safe_path = _validate_content_path(file_path)
    if safe_path is None:
        raise HTTPException(status_code=400, detail="Invalid path")

    is_public = await _check_content_access(safe_path, current_user, db_session, request=request)

    s3_key = f"content/{safe_path}"
    s3_client = get_storage_client()
    bucket = get_s3_bucket_name()

    if not s3_client:
        raise HTTPException(status_code=500, detail="Storage not configured")

    try:
        head = s3_client.head_object(Bucket=bucket, Key=s3_key)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            raise HTTPException(status_code=404, detail="File not found")
        elif code in ("AccessDenied", "403"):
            raise HTTPException(status_code=403, detail="Access denied")
        else:
            raise HTTPException(status_code=502, detail="Storage service error")
    except Exception:
        raise HTTPException(status_code=502, detail="Storage service error")

    file_size = head['ContentLength']
    mime_type = _get_mime_type(safe_path)

    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Cache-Control": content_cache_control(is_public),
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": _content_disposition(mime_type, safe_path),
            **_security_headers(mime_type),
        },
    )
