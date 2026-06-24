"""Shared media-access helpers (folder-aware privacy)."""

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession


async def media_in_any_private_folder(db_session: AsyncSession, media_uuid: str) -> bool:
    """True if this media is placed in at least one non-public folder.

    Most-restrictive rule: a file inside any private folder is private even if its
    own `public` flag is True. Root-level placements (folder_id NULL) impose no
    constraint. Used both by the RBAC public-check and the file endpoint.
    """
    from src.db.folders.folder_content import FolderContent
    from src.db.folders.folders import Folder

    folder_ids = (
        await db_session.execute(
            select(FolderContent.folder_id).where(
                FolderContent.resource_uuid == media_uuid,
                FolderContent.folder_id.is_not(None),
            )
        )
    ).scalars().all()
    if not folder_ids:
        return False
    private = (
        await db_session.execute(
            select(Folder.id).where(
                Folder.id.in_(folder_ids),
                Folder.public == False,  # noqa: E712
            )
        )
    ).scalars().first()
    return private is not None
