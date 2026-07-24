"""
Local Content Files Router

Serves static content files from the local filesystem with access control.
Replaces the unauthenticated StaticFiles mount to enforce authorization
on private course/podcast content while allowing public content through.

SECURITY:
- Activity content (videos, PDFs, blocks) for non-public courses requires auth
- Course-level metadata (thumbnails) is always public (shown in listings)
- Org-level content (logos, branding) is always public
- Podcast episode content for non-public podcasts requires auth
"""

import os
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.podcasts.podcasts import Podcast
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.db.user_organizations import UserOrganization
from src.security.auth import get_current_user
from src.security.submission_file_access import (
    is_submission_file,
    enforce_submission_file_access,
)

router = APIRouter()

CONTENT_DIR = Path("content")


def _normalize_content_relpath(file_path: str) -> str | None:
    """Decode and vet the request path, returning a safe CONTENT_DIR-relative
    string, or None if it is unsafe.

    Pure string handling only — no filesystem access. Each handler does the
    realpath + containment check inline against this value (see
    ``serve_local_content``); keeping the resolve-and-guard together with the
    filesystem sink, from the tainted input, is what makes the guard hold at
    runtime and what static analysis can follow.
    """
    # Decode URL-encoded characters (double-decode for double-encoding attacks)
    decoded = unquote(unquote(file_path))
    if '..' in decoded or decoded.startswith('/') or '\x00' in decoded:
        return None
    normalized = decoded.replace('\\', '/')
    if '..' in normalized or normalized.startswith('/'):
        return None
    return normalized




async def _check_content_access(
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    request: Request | None = None,
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

    # Assignment submission files must be gated to the owner or an instructor —
    # not the generic activity-content grant below (which would let any org
    # member, or anyone on a public course, download another learner's work).
    if is_submission_file(parts):
        await enforce_submission_file_access(parts, current_user, db_session, request)
        return

    # Activity content: requires course to be public or user to be org member
    if (
        len(parts) >= 6
        and parts[0] == 'orgs'
        and parts[2] == 'courses'
        and parts[4] == 'activities'
    ):
        course_uuid = parts[3]
        course = (await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )).scalars().first()
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
        membership = (await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == current_user.id,
                UserOrganization.org_id == course.org_id,
            )
        )).scalars().first()
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
        podcast = (await db_session.execute(
            select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
        )).scalars().first()
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
        membership = (await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == current_user.id,
                UserOrganization.org_id == podcast.org_id,
            )
        )).scalars().first()
        if not membership:
            raise HTTPException(status_code=403, detail="Access denied")
        return

    # Library media content: enforce the media's (folder-aware) access. Closes
    # the legacy hole where orgs/{}/media/... fell through to the public branch.
    if len(parts) >= 4 and parts[0] == 'orgs' and parts[2] == 'media':
        from src.security.rbac import check_resource_access, AccessAction
        media_uuid = parts[3]  # legacy keys embed media_uuid as the directory
        if media_uuid.startswith('media_'):
            await check_resource_access(
                request, db_session, current_user, media_uuid, AccessAction.READ
            )
            return
        # Randomized keys don't embed the media_uuid → deny direct /content
        # access (these are only served via /media/{uuid}/file).
        raise HTTPException(status_code=403, detail="Access denied")

    # Course metadata (thumbnails, etc.) and org-level content — always public
    # These are displayed on listing pages to all users
    if len(parts) >= 2 and parts[0] == 'orgs':
        return

    # User content (avatars, profile images) — always public
    # Paths: users/{user_uuid}/avatars/...
    if len(parts) >= 2 and parts[0] == 'users':
        return

    # Unknown path pattern — deny by default. Previously this only blocked
    # anonymous users and silently served the file to any authenticated user,
    # which leaked content across tenants for any path layout that didn't match
    # the recognised org/user prefixes. Mirror the S3 router and deny.
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    raise HTTPException(status_code=403, detail="Access denied")


# MIME type mapping
_MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.txt': 'text/plain',
}


@router.get(
    "/content/{file_path:path}",
    summary="Serve a local content file",
    description="Streams a content file from the local filesystem with access control. Public course and podcast content is accessible anonymously; private content requires authentication and org membership.",
    responses={
        200: {"description": "File served successfully"},
        400: {"description": "Invalid or unsafe file path"},
        401: {"description": "Authentication required to access this file"},
        403: {"description": "User is not permitted to access this file"},
        404: {"description": "File not found on disk"},
    },
)
async def serve_local_content(
    request: Request,
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Serve content files from local filesystem with access control.

    SECURITY: Validates user access based on resource ownership.
    Public courses/podcasts are accessible to anonymous users.
    Private content requires authentication.
    """
    rel_path = _normalize_content_relpath(file_path)
    if rel_path is None:
        raise HTTPException(status_code=400, detail="Invalid path")

    # Resolve and guard inline, from the vetted relative path, so the whole
    # join -> realpath -> containment-check -> filesystem-touch chain lives in
    # one place. Anything that escapes CONTENT_DIR (including via a symlink,
    # which the string checks above cannot see) is refused before any sink.
    base_real = os.path.realpath(str(CONTENT_DIR))
    safe_real = os.path.realpath(os.path.join(base_real, rel_path))
    if not (safe_real == base_real or safe_real.startswith(base_real + os.sep)):
        raise HTTPException(status_code=400, detail="Invalid path")

    # Run the access check against the CANONICAL content-relative path derived
    # from the resolved file, never the request string. `_normalize_content_relpath`
    # rejects `..` but leaves `.`/`//` segments intact, so a path like
    # `orgs/./{uuid}/courses/...` would shift `_check_content_access`'s segment
    # indices, miss every private pattern, and fall through to the public branch
    # while realpath still serves the real private file (auth bypass / IDOR).
    # Deriving the path from `safe_real` keeps the access check and the
    # filesystem touch looking at exactly the same, collapsed, path.
    canonical_rel = os.path.relpath(safe_real, base_real).replace(os.sep, '/')
    await _check_content_access(canonical_rel, current_user, db_session, request=request)

    if not os.path.isfile(safe_real):
        raise HTTPException(status_code=404, detail="File not found")

    ext = os.path.splitext(safe_real)[1].lower()
    media_type = _MIME_TYPES.get(ext, 'application/octet-stream')

    return FileResponse(
        path=safe_real,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.head(
    "/content/{file_path:path}",
    summary="Get local content file metadata",
    description="Returns metadata for a local content file without the body. Used by clients to probe file size and MIME type before issuing a GET.",
    responses={
        200: {"description": "File metadata returned via response headers"},
        400: {"description": "Invalid or unsafe file path"},
        401: {"description": "Authentication required to access this file"},
        403: {"description": "User is not permitted to access this file"},
        404: {"description": "File not found on disk"},
    },
)
async def head_local_content(
    request: Request,
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """HEAD request for content files — returns metadata without body."""
    rel_path = _normalize_content_relpath(file_path)
    if rel_path is None:
        raise HTTPException(status_code=400, detail="Invalid path")

    # Resolve and guard inline from the vetted relative path (see
    # serve_local_content for the rationale). Sinks operate on ``safe_real``.
    base_real = os.path.realpath(str(CONTENT_DIR))
    safe_real = os.path.realpath(os.path.join(base_real, rel_path))
    if not (safe_real == base_real or safe_real.startswith(base_real + os.sep)):
        raise HTTPException(status_code=400, detail="Invalid path")

    # Access check against the CANONICAL path from safe_real, not the request
    # string — see serve_local_content: a `.`/`//` segment would otherwise slip
    # private content past the pattern matching (auth bypass / IDOR).
    canonical_rel = os.path.relpath(safe_real, base_real).replace(os.sep, '/')
    await _check_content_access(canonical_rel, current_user, db_session, request=request)

    if not os.path.isfile(safe_real):
        raise HTTPException(status_code=404, detail="File not found")

    ext = os.path.splitext(safe_real)[1].lower()
    media_type = _MIME_TYPES.get(ext, 'application/octet-stream')
    file_size = os.path.getsize(safe_real)

    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": media_type,
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )
