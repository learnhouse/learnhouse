import secrets
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, UploadFile
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.db.media.media import (
    Media,
    MediaCreate,
    MediaRead,
    MediaTypeEnum,
    MediaUpdate,
)
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.media.media_share_token import MediaShareToken
from src.security.auth import resolve_acting_user_id
from src.security.rbac import check_resource_access, AccessAction
from src.services.media.media_access import media_in_any_private_folder
from src.services.utils.upload_content import upload_file


# Validation categories (see src/security/file_validation.py). Office docs and
# zip archives are validated by magic bytes + a zip-bomb guard and are only ever
# served as downloads, never executed/rendered inline.
ALLOWED_MEDIA_TYPES = [
    "image",
    "video",
    "document",
    "audio",
    "office",
    "office_legacy",
    "archive",
]


async def _get_org_uuid(db_session: AsyncSession, org_id: int) -> str:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org.org_uuid


async def create_media(
    request: Request,
    media_object: MediaCreate,
    current_user: PublicUser,
    db_session: AsyncSession,
    file: Optional[UploadFile] = None,
) -> MediaRead:
    await check_resource_access(
        request, db_session, current_user, "media_x", AccessAction.CREATE
    )

    media = Media(
        name=media_object.name,
        description=media_object.description or "",
        media_type=media_object.media_type,
        url=media_object.url or "",
        thumbnail_image=media_object.thumbnail_image or "",
        public=media_object.public,
        org_id=media_object.org_id,
        media_uuid=f"media_{uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    if media_object.media_type == MediaTypeEnum.UPLOAD:
        if file is None:
            raise HTTPException(status_code=400, detail="A file is required for UPLOAD media")
        org_uuid = await _get_org_uuid(db_session, media_object.org_id)
        # Randomize BOTH the directory and the filename so the storage path is
        # not derivable from the media_uuid (which is returned in API responses).
        rand_dir = secrets.token_urlsafe(16)
        directory = f"media/{rand_dir}"
        filename = await upload_file(
            file=file,
            directory=directory,
            type_of_dir="orgs",
            uuid=org_uuid,
            allowed_types=ALLOWED_MEDIA_TYPES,
            filename_prefix="media",
        )
        parts = filename.rsplit(".", 1)
        media.file_id = filename
        # Server-only key (under content/), never returned to clients.
        media.storage_key = f"orgs/{org_uuid}/{directory}/{filename}"
        media.file_format = parts[1] if len(parts) > 1 else ""
        media.file_mime = file.content_type or ""
        try:
            file.file.seek(0)
            media.file_size = len(await file.read())
        except Exception:
            media.file_size = None
    elif media_object.media_type == MediaTypeEnum.EMBED:
        if not media_object.url:
            raise HTTPException(status_code=400, detail="A url is required for EMBED media")

    db_session.add(media)
    await db_session.commit()
    await db_session.refresh(media)

    user_id = resolve_acting_user_id(current_user)
    if user_id:
        db_session.add(
            ResourceAuthor(
                resource_uuid=media.media_uuid,
                user_id=user_id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db_session.commit()
        await db_session.refresh(media)

    # Place into a folder, or at the library root (Drive-like) when no folder given,
    # so uploaded media always appears in the library.
    if media_object.folder_uuid:
        from src.services.folders.folders import add_folder_content

        await add_folder_content(
            request, media_object.folder_uuid, media.media_uuid, current_user, db_session
        )
    else:
        from src.services.folders.folders import add_org_root_content

        await add_org_root_content(
            request, media_object.org_id, media.media_uuid, current_user, db_session
        )
    await db_session.refresh(media)

    return MediaRead.model_validate(media)


async def get_media(
    request: Request,
    media_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> MediaRead:
    media = (
        await db_session.execute(select(Media).where(Media.media_uuid == media_uuid))
    ).scalars().first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    await check_resource_access(
        request, db_session, current_user, media.media_uuid, AccessAction.READ
    )
    return MediaRead.model_validate(media)


async def update_media(
    request: Request,
    media_object: MediaUpdate,
    media_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> MediaRead:
    media = (
        await db_session.execute(select(Media).where(Media.media_uuid == media_uuid))
    ).scalars().first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    await check_resource_access(
        request, db_session, current_user, media.media_uuid, AccessAction.UPDATE
    )

    data = media_object.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is not None:
            setattr(media, key, value)
    media.update_date = str(datetime.now())
    db_session.add(media)
    await db_session.commit()
    await db_session.refresh(media)
    return MediaRead.model_validate(media)


async def delete_media(
    request: Request,
    media_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
):
    media = (
        await db_session.execute(select(Media).where(Media.media_uuid == media_uuid))
    ).scalars().first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    await check_resource_access(
        request, db_session, current_user, media.media_uuid, AccessAction.DELETE
    )

    from src.db.folders.folder_content import FolderContent

    placements = (
        await db_session.execute(
            select(FolderContent).where(FolderContent.resource_uuid == media_uuid)
        )
    ).scalars().all()
    for placement in placements:
        await db_session.delete(placement)

    await db_session.delete(media)
    await db_session.commit()
    return {"detail": "Media deleted"}


async def get_media_list(
    request: Request,
    org_id: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    page: int = 1,
    limit: int = 50,
) -> List[MediaRead]:
    anonymous = resolve_acting_user_id(current_user) == 0
    statement = select(Media).where(Media.org_id == int(org_id))
    if anonymous:
        statement = statement.where(Media.public == True)  # noqa: E712
        # Most-restrictive: also hide media that sit in any private folder.
        from src.db.folders.folder_content import FolderContent
        from src.db.folders.folders import Folder

        private_media = (
            select(FolderContent.resource_uuid)
            .join(Folder, Folder.id == FolderContent.folder_id)
            .where(Folder.public == False)  # noqa: E712
        )
        statement = statement.where(Media.media_uuid.not_in(private_media))
    statement = statement.offset((page - 1) * limit).limit(limit)
    media_items = (await db_session.execute(statement)).scalars().all()
    return [MediaRead.model_validate(m) for m in media_items]


# ---------------------------------------------------------------------------
# File serving + shareable links
# ---------------------------------------------------------------------------

async def authorize_media_file(
    request: Request,
    media_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Load media and enforce (folder-aware) READ access. Returns (media, is_public)."""
    media = (
        await db_session.execute(select(Media).where(Media.media_uuid == media_uuid))
    ).scalars().first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    await check_resource_access(
        request, db_session, current_user, media.media_uuid, AccessAction.READ
    )
    is_public = bool(media.public) and not await media_in_any_private_folder(
        db_session, media.media_uuid
    )
    return media, is_public


async def create_media_share_link(
    request: Request,
    media_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    """Mint a NEW random token (unique every call) for a media the caller can read."""
    media = (
        await db_session.execute(select(Media).where(Media.media_uuid == media_uuid))
    ).scalars().first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    await check_resource_access(
        request, db_session, current_user, media.media_uuid, AccessAction.READ
    )
    token = secrets.token_urlsafe(32)
    db_session.add(
        MediaShareToken(
            token=token,
            media_uuid=media.media_uuid,
            org_id=media.org_id,
            created_by_user_id=resolve_acting_user_id(current_user) or None,
            revoked=False,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db_session.commit()
    return {"token": token}


async def authorize_share_token(
    request: Request,
    token: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Resolve a share token → media, then enforce the REQUESTING user's access.

    The token is NOT an access bypass: an anonymous/unauthorized recipient is
    still denied. Returns (media, is_public).
    """
    row = (
        await db_session.execute(
            select(MediaShareToken).where(MediaShareToken.token == token)
        )
    ).scalars().first()
    if not row or row.revoked:
        raise HTTPException(status_code=404, detail="Invalid or expired link")
    media = (
        await db_session.execute(select(Media).where(Media.media_uuid == row.media_uuid))
    ).scalars().first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    await check_resource_access(
        request, db_session, current_user, media.media_uuid, AccessAction.READ
    )
    is_public = bool(media.public) and not await media_in_any_private_folder(
        db_session, media.media_uuid
    )
    return media, is_public
