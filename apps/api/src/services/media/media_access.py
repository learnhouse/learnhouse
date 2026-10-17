"""Shared library-access helpers (folder-aware privacy).

Folder rules reach down the whole tree: an item placed in a folder, at any
depth, takes the most restrictive rule of every folder above it. A private
folder makes everything below it private, and a private folder restricted to
UserGroups restricts everything below it to those groups.
"""

from dataclasses import dataclass, field
from typing import Iterable, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession


@dataclass
class FolderTree:
    """One org's folder hierarchy, loaded in a couple of queries so the
    ancestor rules can be evaluated in memory instead of one walk per item."""

    parents: dict[int, Optional[int]] = field(default_factory=dict)
    public: dict[int, bool] = field(default_factory=dict)
    uuids: dict[int, str] = field(default_factory=dict)
    groups: dict[int, set[int]] = field(default_factory=dict)

    def chain(self, folder_ids: Iterable[Optional[int]]) -> set[int]:
        """The given folders plus every folder above them."""
        seen: set[int] = set()
        for folder_id in folder_ids:
            while folder_id is not None and folder_id in self.parents and folder_id not in seen:
                seen.add(folder_id)
                folder_id = self.parents[folder_id]
        return seen

    def any_private(self, folder_ids: Iterable[Optional[int]]) -> bool:
        return any(not self.public[f] for f in self.chain(folder_ids))

    def blocks(
        self,
        folder_ids: Iterable[Optional[int]],
        viewer_groups: set[int],
        authored_uuids: set[str],
    ) -> bool:
        """True if a private folder in the chain is restricted to UserGroups
        the viewer is not in, and the viewer doesn't author that folder."""
        for f in self.chain(folder_ids):
            linked = self.groups.get(f)
            if (
                linked
                and not self.public[f]
                and not (linked & viewer_groups)
                and self.uuids[f] not in authored_uuids
            ):
                return True
        return False

    def private_ids(self) -> set[int]:
        """Folders that are private themselves or sit below a private one."""
        return {f for f in self.parents if self.any_private([f])}

    def blocked_ids(self, viewer_groups: set[int], authored_uuids: set[str]) -> set[int]:
        """Folders the viewer is kept out of by a UserGroup restriction."""
        return {f for f in self.parents if self.blocks([f], viewer_groups, authored_uuids)}


async def load_folder_tree(db_session: AsyncSession, org_id: int) -> FolderTree:
    from src.db.folders.folders import Folder
    from src.db.usergroup_resources import UserGroupResource

    tree = FolderTree()
    rows = (
        await db_session.execute(
            select(Folder.id, Folder.parent_folder_id, Folder.public, Folder.folder_uuid).where(
                Folder.org_id == org_id
            )
        )
    ).all()
    for folder_id, parent_id, public, folder_uuid in rows:
        tree.parents[folder_id] = parent_id
        tree.public[folder_id] = bool(public)
        tree.uuids[folder_id] = folder_uuid
    links = (
        await db_session.execute(
            select(Folder.id, UserGroupResource.usergroup_id)
            .join(UserGroupResource, UserGroupResource.resource_uuid == Folder.folder_uuid)
            .where(Folder.org_id == org_id)
        )
    ).all()
    for folder_id, usergroup_id in links:
        tree.groups.setdefault(folder_id, set()).add(usergroup_id)
    return tree


async def viewer_folder_grants(
    db_session: AsyncSession, user_id: int
) -> tuple[set[int], set[str]]:
    """The viewer's UserGroup ids and the folders they actively author."""
    from src.db.resource_authors import (
        ResourceAuthor,
        ResourceAuthorshipEnum,
        ResourceAuthorshipStatusEnum,
    )
    from src.db.usergroup_user import UserGroupUser

    if not user_id:
        return set(), set()
    groups = set(
        (
            await db_session.execute(
                select(UserGroupUser.usergroup_id).where(UserGroupUser.user_id == user_id)
            )
        ).scalars().all()
    )
    authored = set(
        (
            await db_session.execute(
                select(ResourceAuthor.resource_uuid).where(
                    ResourceAuthor.user_id == user_id,
                    ResourceAuthor.resource_uuid.startswith("folder_"),
                    ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
                    ResourceAuthor.authorship.in_([
                        ResourceAuthorshipEnum.CREATOR,
                        ResourceAuthorshipEnum.MAINTAINER,
                        ResourceAuthorshipEnum.CONTRIBUTOR,
                    ]),
                )
            )
        ).scalars().all()
    )
    return groups, authored


async def media_folder_ids(db_session: AsyncSession, media_uuid: str) -> list[int]:
    """Folders this media is placed in (root placements carry no folder)."""
    from src.db.folders.folder_content import FolderContent

    return list(
        (
            await db_session.execute(
                select(FolderContent.folder_id).where(
                    FolderContent.resource_uuid == media_uuid,
                    FolderContent.folder_id.is_not(None),
                )
            )
        ).scalars().all()
    )


async def media_in_any_private_folder(db_session: AsyncSession, media_uuid: str) -> bool:
    """True if this media sits, at any depth, below at least one non-public folder.

    Most-restrictive rule: a file inside any private folder is private even if its
    own `public` flag is True. Root-level placements (folder_id NULL) impose no
    constraint. Used both by the RBAC public-check and the file endpoint.
    """
    from src.db.folders.folders import Folder

    folder_ids = await media_folder_ids(db_session, media_uuid)
    if not folder_ids:
        return False
    org_ids = set(
        (
            await db_session.execute(select(Folder.org_id).where(Folder.id.in_(folder_ids)))
        ).scalars().all()
    )
    for org_id in org_ids:
        if (await load_folder_tree(db_session, org_id)).any_private(folder_ids):
            return True
    return False
