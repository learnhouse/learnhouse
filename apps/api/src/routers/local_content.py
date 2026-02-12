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
from sqlmodel import Session, select

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.podcasts.podcasts import Podcast
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.db.user_organizations import UserOrganization
from src.security.auth import get_current_user

router = APIRouter()

CONTENT_DIR = Path("content")


def _validate_content_path(file_path: str) -> bool:
    """Validate path is safe — prevents directory traversal."""
    # Decode URL-encoded characters (double-decode for double-encoding attacks)
    decoded = unquote(unquote(file_path))
    if '..' in decoded or decoded.startswith('/') or '\x00' in decoded:
        return False
    normalized = decoded.replace('\\', '/')
    if '..' in normalized:
        return False

    # Resolve and verify the path stays within CONTENT_DIR
    try:
        resolved = (CONTENT_DIR / decoded).resolve()
        base_resolved = CONTENT_DIR.resolve()
        if not str(resolved).startswith(str(base_resolved) + os.sep) and resolved != base_resolved:
            return False
    except (OSError, ValueError):
        return False

    return True


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
    # These are displayed on listing pages to all users
    if len(parts) >= 2 and parts[0] == 'orgs':
        return

    # User content (avatars, profile images) — always public
    # Paths: users/{user_uuid}/avatars/...
    if len(parts) >= 2 and parts[0] == 'users':
        return

    # Unknown path pattern — require auth as a safe default
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")


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


@router.get("/content/{file_path:path}")
async def serve_local_content(
    request: Request,
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Serve content files from local filesystem with access control.

    SECURITY: Validates user access based on resource ownership.
    Public courses/podcasts are accessible to anonymous users.
    Private content requires authentication.
    """
    if not _validate_content_path(file_path):
        raise HTTPException(status_code=400, detail="Invalid path")

    _check_content_access(file_path, current_user, db_session)

    full_path = CONTENT_DIR / file_path
    resolved = full_path.resolve()

    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    ext = resolved.suffix.lower()
    media_type = _MIME_TYPES.get(ext, 'application/octet-stream')

    return FileResponse(
        path=str(resolved),
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.head("/content/{file_path:path}")
async def head_local_content(
    request: Request,
    file_path: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """HEAD request for content files — returns metadata without body."""
    if not _validate_content_path(file_path):
        raise HTTPException(status_code=400, detail="Invalid path")

    _check_content_access(file_path, current_user, db_session)

    full_path = CONTENT_DIR / file_path
    resolved = full_path.resolve()

    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    ext = resolved.suffix.lower()
    media_type = _MIME_TYPES.get(ext, 'application/octet-stream')
    file_size = resolved.stat().st_size

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
