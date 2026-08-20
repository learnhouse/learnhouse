from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.db.folders.folders import (
    Folder,
    FolderBreadcrumb,
    FolderContentItem,
    FolderCreate,
    FolderRead,
    FolderUpdate,
    FolderUpdateOrder,
)
from src.db.folders.folder_content import FolderContent
from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import is_org_member, require_org_membership
from src.security.rbac import check_resource_access, AccessAction
from src.services.webhooks.dispatch import dispatch_webhooks


# ----------------------------------------------------------------------------
# Folder ordering — org-scoped, admin-controlled sort mode
# ----------------------------------------------------------------------------

VALID_SORT_MODES = ("name_asc", "name_desc", "newest", "oldest", "manual")


async def _get_folders_sort_mode(db_session: AsyncSession, org_id: int) -> str:
    """Read the org's library folders.sort_mode from organization_config.

    Stored at config["general"]["folders"]["sort_mode"]. Falls back to the v1
    features.folders location, then to the deterministic default "name_asc".
    """
    org_config = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    if org_config is None:
        return "name_asc"

    config = org_config.config or {}
    mode = (
        (config.get("general", {}) or {}).get("folders", {}) or {}
    ).get("sort_mode")
    if not mode:
        mode = (
            (config.get("features", {}) or {}).get("folders", {}) or {}
        ).get("sort_mode")
    if mode not in VALID_SORT_MODES:
        return "name_asc"
    return mode


def _apply_folder_sort(statement, sort_mode: str):
    """Append the ORDER BY for the given sort mode to a Folder select."""
    if sort_mode == "name_desc":
        return statement.order_by(Folder.name.desc())
    if sort_mode == "newest":
        return statement.order_by(Folder.creation_date.desc())
    if sort_mode == "oldest":
        return statement.order_by(Folder.creation_date.asc())
    if sort_mode == "manual":
        return statement.order_by(Folder.order.asc(), Folder.id.asc())
    # name_asc (default)
    return statement.order_by(Folder.name.asc())


def _item_name(item: FolderContentItem) -> str:
    """Display name of a resolved item — courses/media expose `name`, some
    resources only carry a `title`. Lowercased to match the client comparator."""
    resource = item.resource or {}
    return str(resource.get("name") or resource.get("title") or "").lower()


def _item_date(item: FolderContentItem) -> str:
    """Creation timestamp of a resolved item, in the same fallback order the
    client comparator uses (creation_date -> created_at -> update_date).
    'newest'/'oldest' mean creation date on both sides — every course carries a
    non-empty update_date, so preferring it would put the API and the browser in
    permanent disagreement. Timestamps are stored as sortable strings."""
    resource = item.resource or {}
    return str(
        resource.get("creation_date")
        or resource.get("created_at")
        or resource.get("update_date")
        or ""
    )


def _sort_items(
    items: List[FolderContentItem], sort_mode: str
) -> List[FolderContentItem]:
    """Order a folder's CONTENT items by the org's sort mode, mirroring
    _apply_folder_sort so folders and their content agree.

    FolderContent.position is applied first and Python's sort is stable, so the
    admin's drag order stays the tiebreaker for the name modes — and is the only
    key in 'manual' mode. The date modes break ties by name instead, the way the
    client comparator does (`_dateOf(b) - _dateOf(a) || byName(a, b)`).
    """
    items.sort(key=lambda i: i.position)
    if sort_mode == "manual":
        return items
    if sort_mode == "name_desc":
        items.sort(key=_item_name, reverse=True)
    elif sort_mode == "newest":
        items.sort(key=_item_name)
        items.sort(key=_item_date, reverse=True)
    elif sort_mode == "oldest":
        items.sort(key=_item_name)
        items.sort(key=_item_date)
    else:  # name_asc (default)
        items.sort(key=_item_name)
    return items


# ----------------------------------------------------------------------------
# Resource resolution — folders are polymorphic containers
# ----------------------------------------------------------------------------

def _resource_registry():
    """prefix -> (resource_type label, model, uuid_field). Lazy to avoid cycles."""
    from src.db.courses.courses import Course
    from src.db.podcasts.podcasts import Podcast
    from src.db.communities.communities import Community
    from src.db.boards import Board
    from src.db.playgrounds import Playground
    from src.db.media.media import Media

    return {
        "course_": ("courses", Course, "course_uuid"),
        "podcast_": ("podcasts", Podcast, "podcast_uuid"),
        "community_": ("communities", Community, "community_uuid"),
        "board_": ("boards", Board, "board_uuid"),
        "playground_": ("playgrounds", Playground, "playground_uuid"),
        "media_": ("media", Media, "media_uuid"),
    }


def _public_resource_dump(resource) -> dict:
    """Serialize a resolved resource for the client.

    Media rows must go through MediaRead: dumping the table model would ship
    `file_id` and `storage_key`, and the whole point of the randomized storage
    key is that the client can never derive a storage path (bytes are only
    reachable via GET /media/{uuid}/file).
    """
    from src.db.media.media import Media, MediaRead

    if isinstance(resource, Media):
        return MediaRead.model_validate(resource, from_attributes=True).model_dump()
    return resource.model_dump()


async def _resolve_items(
    db_session: AsyncSession,
    content_rows: list[FolderContent],
    include_private: bool,
    sort_mode: str = "manual",
) -> List[FolderContentItem]:
    """Resolve FolderContent rows into typed items, batching per resource type.

    The resolved items are ordered by the org's sort mode, the same mode the
    sibling folders are ordered by — otherwise a folder's content would render
    in a different order than the dashboard shows.
    """
    registry = _resource_registry()

    by_prefix: dict[str, list[str]] = {}
    position_map: dict[str, int] = {}
    for row in content_rows:
        position_map[row.resource_uuid] = row.position
        for prefix in registry:
            if row.resource_uuid.startswith(prefix):
                by_prefix.setdefault(prefix, []).append(row.resource_uuid)
                break

    items: List[FolderContentItem] = []
    for prefix, uuids in by_prefix.items():
        resource_type, model, uuid_field = registry[prefix]
        uuid_col = getattr(model, uuid_field)
        rows = (
            await db_session.execute(select(model).where(uuid_col.in_(uuids)))
        ).scalars().all()
        for resource in rows:
            if not include_private and not getattr(resource, "public", False):
                continue
            r_uuid = getattr(resource, uuid_field)
            items.append(
                FolderContentItem(
                    resource_uuid=r_uuid,
                    resource_type=resource_type,
                    position=position_map.get(r_uuid, 0),
                    resource=_public_resource_dump(resource),
                )
            )

    return _sort_items(items, sort_mode)


async def _build_breadcrumbs(db_session: AsyncSession, folder: Folder) -> List[FolderBreadcrumb]:
    """Walk parent_folder_id up to the root."""
    crumbs: List[FolderBreadcrumb] = []
    current: Optional[Folder] = folder
    seen: set[int] = set()
    while current is not None:
        if current.id in seen:  # guard against cycles
            break
        seen.add(current.id)
        crumbs.append(FolderBreadcrumb(folder_uuid=current.folder_uuid, name=current.name))
        if current.parent_folder_id is None:
            break
        current = (
            await db_session.execute(
                select(Folder).where(Folder.id == current.parent_folder_id)
            )
        ).scalars().first()
    crumbs.reverse()
    return crumbs


async def _folder_to_read(
    db_session: AsyncSession,
    folder: Folder,
    include_private: bool,
    with_children: bool = True,
) -> FolderRead:
    from sqlalchemy import func

    subfolders: List[FolderRead] = []
    items: List[FolderContentItem] = []
    breadcrumbs: List[FolderBreadcrumb] = []

    # Always compute a lightweight total count (sub-folders + leaf content) so
    # cards show the right number even for nested folders rendered without
    # their children loaded.
    sub_count = (
        await db_session.execute(
            select(func.count()).select_from(Folder).where(Folder.parent_folder_id == folder.id)
        )
    ).scalar() or 0
    content_count = (
        await db_session.execute(
            select(func.count()).select_from(FolderContent).where(FolderContent.folder_id == folder.id)
        )
    ).scalar() or 0
    total_items = int(sub_count) + int(content_count)

    if with_children:
        sort_mode = await _get_folders_sort_mode(db_session, folder.org_id)
        sub_stmt = _apply_folder_sort(
            select(Folder).where(Folder.parent_folder_id == folder.id), sort_mode
        )
        sub_rows = (await db_session.execute(sub_stmt)).scalars().all()
        for sub in sub_rows:
            if not include_private and not sub.public:
                continue
            subfolders.append(
                await _folder_to_read(db_session, sub, include_private, with_children=False)
            )

        content_rows = (
            await db_session.execute(
                select(FolderContent).where(FolderContent.folder_id == folder.id)
            )
        ).scalars().all()
        items = await _resolve_items(
            db_session, list(content_rows), include_private, sort_mode
        )
        breadcrumbs = await _build_breadcrumbs(db_session, folder)

    return FolderRead(
        **folder.model_dump(),
        subfolders=subfolders,
        items=items,
        breadcrumbs=breadcrumbs,
        total_items=total_items,
    )


def _is_anonymous(current_user) -> bool:
    return resolve_acting_user_id(current_user) == 0


async def _may_see_private(current_user, org_id: int, db_session: AsyncSession) -> bool:
    """Whether the caller may see this org's private folders and resources.

    The org-scoped listing endpoints take `org_id` straight from the path, so
    being signed in *somewhere* must not unlock another tenant's library. Only
    membership in the requested org does; a signed-in non-member is served
    exactly what an anonymous visitor is served (public items only), which keeps
    the public org library browsable without leaking private rows.
    """
    user_id = resolve_acting_user_id(current_user)
    if not user_id:
        return False
    return await is_org_member(user_id, org_id, db_session)


def _add_creator_author(db_session: AsyncSession, resource_uuid: str, user_id: int):
    db_session.add(
        ResourceAuthor(
            resource_uuid=resource_uuid,
            user_id=user_id,
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )


# ----------------------------------------------------------------------------
# CRUD
# ----------------------------------------------------------------------------

async def create_folder(
    request: Request,
    folder_object: FolderCreate,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> FolderRead:
    await check_resource_access(
        request, db_session, current_user, "folder_x", AccessAction.CREATE
    )
    # The "folder_x" placeholder has no organization of its own, so the RBAC
    # check above accepts any role the caller holds in ANY org. The target org
    # comes from the request body — gate it explicitly.
    await require_org_membership(
        resolve_acting_user_id(current_user), folder_object.org_id, db_session
    )

    parent_folder_id = None
    if folder_object.parent_folder_uuid:
        parent = (
            await db_session.execute(
                select(Folder).where(Folder.folder_uuid == folder_object.parent_folder_uuid)
            )
        ).scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
        if parent.org_id != folder_object.org_id:
            raise HTTPException(status_code=400, detail="Parent folder is in another organization")
        parent_folder_id = parent.id

    folder = Folder(
        name=folder_object.name,
        public=folder_object.public,
        description=folder_object.description or "",
        thumbnail_image=folder_object.thumbnail_image or "",
        color=folder_object.color or "violet",
        org_id=folder_object.org_id,
        parent_folder_id=parent_folder_id,
        folder_uuid=f"folder_{uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(folder)
    await db_session.commit()
    await db_session.refresh(folder)

    user_id = resolve_acting_user_id(current_user)
    if user_id:
        _add_creator_author(db_session, folder.folder_uuid, user_id)
        await db_session.commit()
        await db_session.refresh(folder)

    await dispatch_webhooks(
        event_name="folder_created",
        org_id=folder.org_id,
        data={"folder_uuid": folder.folder_uuid, "name": folder.name},
    )

    return await _folder_to_read(db_session, folder, include_private=True)


async def get_folder(
    request: Request,
    folder_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> FolderRead:
    folder = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == folder_uuid))
    ).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder does not exist")

    await check_resource_access(
        request, db_session, current_user, folder.folder_uuid, AccessAction.READ
    )

    include_private = not _is_anonymous(current_user)
    return await _folder_to_read(db_session, folder, include_private=include_private)


async def update_folder(
    request: Request,
    folder_object: FolderUpdate,
    folder_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> FolderRead:
    folder = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == folder_uuid))
    ).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder does not exist")

    await check_resource_access(
        request, db_session, current_user, folder.folder_uuid, AccessAction.UPDATE
    )

    data = folder_object.model_dump(exclude_unset=True)

    if "parent_folder_uuid" in data:
        new_parent_uuid = data.pop("parent_folder_uuid")
        if not new_parent_uuid or new_parent_uuid in ("root", ""):
            folder.parent_folder_id = None
        else:
            parent = (
                await db_session.execute(
                    select(Folder).where(Folder.folder_uuid == new_parent_uuid)
                )
            ).scalars().first()
            if not parent:
                raise HTTPException(status_code=404, detail="Parent folder not found")
            if parent.id == folder.id:
                raise HTTPException(status_code=400, detail="A folder cannot be its own parent")
            if await _would_create_cycle(db_session, folder.id, parent.id):
                raise HTTPException(status_code=400, detail="Cannot move a folder into its own descendant")
            folder.parent_folder_id = parent.id

    for key, value in data.items():
        if value is not None:
            setattr(folder, key, value)

    folder.update_date = str(datetime.now())
    db_session.add(folder)
    await db_session.commit()
    await db_session.refresh(folder)

    await dispatch_webhooks(
        event_name="folder_updated",
        org_id=folder.org_id,
        data={"folder_uuid": folder.folder_uuid, "name": folder.name},
    )

    return await _folder_to_read(db_session, folder, include_private=True)


async def upload_folder_thumbnail(
    request: Request,
    folder_uuid: str,
    thumbnail_file,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> FolderRead:
    from src.db.organizations import Organization
    from src.services.utils.upload_content import upload_file

    folder = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == folder_uuid))
    ).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder does not exist")

    await check_resource_access(
        request, db_session, current_user, folder.folder_uuid, AccessAction.UPDATE
    )

    org = (
        await db_session.execute(select(Organization).where(Organization.id == folder.org_id))
    ).scalars().first()

    filename = await upload_file(
        file=thumbnail_file,
        directory=f"folders/{folder.folder_uuid}/thumbnails",
        type_of_dir="orgs",
        uuid=org.org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
    )
    folder.thumbnail_image = filename
    folder.update_date = str(datetime.now())
    db_session.add(folder)
    await db_session.commit()
    await db_session.refresh(folder)
    return await _folder_to_read(db_session, folder, include_private=True)


async def delete_folder(
    request: Request,
    folder_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
):
    folder = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == folder_uuid))
    ).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    await check_resource_access(
        request, db_session, current_user, folder.folder_uuid, AccessAction.DELETE
    )

    name = folder.name
    org_id = folder.org_id

    # Sub-folders and FolderContent rows cascade via FK ON DELETE CASCADE.
    await db_session.delete(folder)
    await db_session.commit()

    await dispatch_webhooks(
        event_name="folder_deleted",
        org_id=org_id,
        data={"folder_uuid": folder_uuid, "name": name},
    )

    return {"detail": "Folder deleted"}


# ----------------------------------------------------------------------------
# Listing
# ----------------------------------------------------------------------------

async def get_folders(
    request: Request,
    org_id: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    parent_folder_uuid: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> List[FolderRead]:
    """List folders for an org. Lists root folders by default; pass
    parent_folder_uuid to list a folder's direct sub-folders."""
    parent_id = None
    if parent_folder_uuid:
        parent = (
            await db_session.execute(
                select(Folder).where(Folder.folder_uuid == parent_folder_uuid)
            )
        ).scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
        parent_id = parent.id

    include_private = await _may_see_private(current_user, int(org_id), db_session)

    statement = select(Folder).where(
        Folder.org_id == int(org_id),
        Folder.parent_folder_id == parent_id,
    )
    if not include_private:
        statement = statement.where(Folder.public == True)  # noqa: E712

    sort_mode = await _get_folders_sort_mode(db_session, int(org_id))
    statement = _apply_folder_sort(statement, sort_mode)
    statement = statement.offset((page - 1) * limit).limit(limit)
    folders = (await db_session.execute(statement)).scalars().all()

    return [
        await _folder_to_read(db_session, folder, include_private=include_private)
        for folder in folders
    ]


async def reorder_folders(
    request: Request,
    org_id: int,
    order: FolderUpdateOrder,
    current_user: PublicUser,
    db_session: AsyncSession,
    parent_folder_uuid: Optional[str] = None,
) -> dict:
    """Persist the manual (admin drag) ordering of sibling folders.

    Scoped to a single parent: pass parent_folder_uuid to reorder a folder's
    direct sub-folders, or omit it to reorder root folders. Only reindexes the
    rows matching that scope so a drag in one subfolder never reshuffles
    siblings elsewhere. Position is derived from the array index.
    """
    from src.db.organizations import Organization
    from src.services.orgs.orgs import rbac_check

    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Admin gate (403 for non-admins), same helper the org config writes use.
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    parent_id = None
    if parent_folder_uuid:
        parent = (
            await db_session.execute(
                select(Folder).where(Folder.folder_uuid == parent_folder_uuid)
            )
        ).scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
        parent_id = parent.id

    folders = (
        await db_session.execute(
            select(Folder).where(
                Folder.org_id == org_id,
                Folder.parent_folder_id == parent_id,
            )
        )
    ).scalars().all()
    folders_by_id = {folder.id: folder for folder in folders}

    for fo in order.folder_order_by_ids:
        if fo.folder_id not in folders_by_id:
            raise HTTPException(
                status_code=400,
                detail=f"Folder {fo.folder_id} is not in this organization/parent scope",
            )

    for index, fo in enumerate(order.folder_order_by_ids):
        folder = folders_by_id[fo.folder_id]
        folder.order = index
        db_session.add(folder)

    await db_session.commit()

    return {"detail": "Folder order updated"}


async def reorder_folder_content(
    request: Request,
    folder_uuid: str,
    resource_uuids: list[str],
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    """Persist the manual (admin drag) ordering of a folder's CONTENT items
    (courses, media, …). Position is derived from the array index — matching how
    `_sort_items` orders items by FolderContent.position in 'manual' mode (and
    uses it as the tiebreaker in every other mode). Admin only.
    """
    from src.db.organizations import Organization
    from src.services.orgs.orgs import rbac_check

    folder = (
        await db_session.execute(
            select(Folder).where(Folder.folder_uuid == folder_uuid)
        )
    ).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    org = (
        await db_session.execute(
            select(Organization).where(Organization.id == folder.org_id)
        )
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Admin gate (403 for non-admins), same helper folder reordering uses.
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    rows = (
        await db_session.execute(
            select(FolderContent).where(FolderContent.folder_id == folder.id)
        )
    ).scalars().all()
    rows_by_uuid = {row.resource_uuid: row for row in rows}

    for resource_uuid in resource_uuids:
        if resource_uuid not in rows_by_uuid:
            raise HTTPException(
                status_code=400,
                detail=f"Resource {resource_uuid} is not in this folder",
            )

    for index, resource_uuid in enumerate(resource_uuids):
        row = rows_by_uuid[resource_uuid]
        row.position = index
        db_session.add(row)

    await db_session.commit()

    return {"detail": "Folder content order updated"}


# ----------------------------------------------------------------------------
# Content management
# ----------------------------------------------------------------------------

async def add_folder_content(
    request: Request,
    folder_uuid: str,
    resource_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
    position: int = 0,
) -> FolderRead:
    folder = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == folder_uuid))
    ).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    await check_resource_access(
        request, db_session, current_user, folder.folder_uuid, AccessAction.UPDATE
    )
    await check_resource_access(
        request, db_session, current_user, resource_uuid, AccessAction.READ
    )

    existing = (
        await db_session.execute(
            select(FolderContent).where(
                FolderContent.folder_id == folder.id,
                FolderContent.resource_uuid == resource_uuid,
            )
        )
    ).scalars().first()
    if not existing:
        db_session.add(
            FolderContent(
                folder_id=folder.id,
                resource_uuid=resource_uuid,
                org_id=folder.org_id,
                position=position,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db_session.commit()

    await db_session.refresh(folder)
    return await _folder_to_read(db_session, folder, include_private=True)


async def remove_folder_content(
    request: Request,
    folder_uuid: str,
    resource_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> FolderRead:
    folder = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == folder_uuid))
    ).scalars().first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    await check_resource_access(
        request, db_session, current_user, folder.folder_uuid, AccessAction.UPDATE
    )

    rows = (
        await db_session.execute(
            select(FolderContent).where(
                FolderContent.folder_id == folder.id,
                FolderContent.resource_uuid == resource_uuid,
            )
        )
    ).scalars().all()
    for row in rows:
        await db_session.delete(row)
    await db_session.commit()
    await db_session.refresh(folder)
    return await _folder_to_read(db_session, folder, include_private=True)


async def move_folder_content(
    request: Request,
    source_folder_uuid: str,
    target_folder_uuid: str,
    resource_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> FolderRead:
    """Move a leaf item from one folder to another."""
    source = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == source_folder_uuid))
    ).scalars().first()
    target = (
        await db_session.execute(select(Folder).where(Folder.folder_uuid == target_folder_uuid))
    ).scalars().first()
    if not source or not target:
        raise HTTPException(status_code=404, detail="Folder not found")

    await check_resource_access(
        request, db_session, current_user, source.folder_uuid, AccessAction.UPDATE
    )
    await check_resource_access(
        request, db_session, current_user, target.folder_uuid, AccessAction.UPDATE
    )

    row = (
        await db_session.execute(
            select(FolderContent).where(
                FolderContent.folder_id == source.id,
                FolderContent.resource_uuid == resource_uuid,
            )
        )
    ).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Item not found in source folder")

    dup = (
        await db_session.execute(
            select(FolderContent).where(
                FolderContent.folder_id == target.id,
                FolderContent.resource_uuid == resource_uuid,
            )
        )
    ).scalars().first()
    if dup:
        await db_session.delete(row)
    else:
        row.folder_id = target.id
        row.update_date = str(datetime.now())
        db_session.add(row)
    await db_session.commit()
    await db_session.refresh(target)
    return await _folder_to_read(db_session, target, include_private=True)


# ----------------------------------------------------------------------------
# Library search — across the WHOLE tree, with folder-path context per result
# ----------------------------------------------------------------------------

async def search_library(
    request: Request,
    org_id: str,
    q: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> dict:
    from sqlalchemy import func

    query = (q or "").strip()
    if not query:
        return {"folders": [], "items": []}

    include_private = await _may_see_private(current_user, int(org_id), db_session)
    like = f"%{query.lower()}%"

    # Cache folder paths (full breadcrumb chain) by folder id
    path_cache: dict[int, list] = {}

    async def folder_path(folder_id: Optional[int]) -> list:
        if folder_id is None:
            return []
        if folder_id in path_cache:
            return path_cache[folder_id]
        fobj = (
            await db_session.execute(select(Folder).where(Folder.id == folder_id))
        ).scalars().first()
        crumbs = await _build_breadcrumbs(db_session, fobj) if fobj else []
        path = [c.model_dump() for c in crumbs]
        path_cache[folder_id] = path
        return path

    # --- Folders matching by name ---
    fstmt = select(Folder).where(
        Folder.org_id == int(org_id),
        func.lower(Folder.name).like(like),
    )
    if not include_private:
        fstmt = fstmt.where(Folder.public == True)  # noqa: E712
    folder_rows = (await db_session.execute(fstmt)).scalars().all()

    folder_results = []
    for f in folder_rows:
        crumbs = await _build_breadcrumbs(db_session, f)
        d = f.model_dump()
        # parent path = breadcrumb chain excluding the folder itself
        d["path"] = [c.model_dump() for c in crumbs[:-1]]
        # lightweight count
        sub_c = (await db_session.execute(
            select(func.count()).select_from(Folder).where(Folder.parent_folder_id == f.id)
        )).scalar() or 0
        cont_c = (await db_session.execute(
            select(func.count()).select_from(FolderContent).where(FolderContent.folder_id == f.id)
        )).scalar() or 0
        d["total_items"] = int(sub_c) + int(cont_c)
        folder_results.append(d)

    # --- Content items matching by resource name (any folder, any depth + root) ---
    registry = _resource_registry()
    rows = (await db_session.execute(
        select(FolderContent).where(FolderContent.org_id == int(org_id))
    )).scalars().all()

    by_prefix: dict[str, list] = {}
    for r in rows:
        for prefix in registry:
            if r.resource_uuid.startswith(prefix):
                by_prefix.setdefault(prefix, []).append(r)
                break

    items: list = []
    seen: set[str] = set()
    for prefix, rrows in by_prefix.items():
        rtype, model, uuid_field = registry[prefix]
        uuid_col = getattr(model, uuid_field)
        uuids = list({r.resource_uuid for r in rrows})
        resources = (await db_session.execute(select(model).where(uuid_col.in_(uuids)))).scalars().all()
        rmap = {getattr(x, uuid_field): x for x in resources}
        for r in rrows:
            if r.resource_uuid in seen:
                continue
            res = rmap.get(r.resource_uuid)
            if not res:
                continue
            if not include_private and not getattr(res, "public", False):
                continue
            name = (getattr(res, "name", None) or getattr(res, "title", "") or "")
            if query.lower() not in name.lower():
                continue
            seen.add(r.resource_uuid)
            items.append({
                "resource_uuid": r.resource_uuid,
                "resource_type": rtype,
                "position": r.position,
                "resource": _public_resource_dump(res),
                "path": await folder_path(r.folder_id),
            })

    return {"folders": folder_results, "items": items}


# ----------------------------------------------------------------------------
# Root (Drive-like): content placed directly at the org library root (folder_id NULL)
# ----------------------------------------------------------------------------

async def get_org_root_items(
    request: Request,
    org_id: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> List[FolderContentItem]:
    """Resolve the items that live at the org library root (no parent folder)."""
    include_private = await _may_see_private(current_user, int(org_id), db_session)
    content_rows = (
        await db_session.execute(
            select(FolderContent).where(
                FolderContent.org_id == int(org_id),
                FolderContent.folder_id.is_(None),
            )
        )
    ).scalars().all()
    sort_mode = await _get_folders_sort_mode(db_session, int(org_id))
    return await _resolve_items(
        db_session, list(content_rows), include_private=include_private, sort_mode=sort_mode
    )


async def add_org_root_content(
    request: Request,
    org_id: int,
    resource_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
    position: int = 0,
) -> FolderContentItem | None:
    """Place a resource at the org library root (folder_id NULL)."""
    await check_resource_access(
        request, db_session, current_user, "folder_x", AccessAction.CREATE
    )
    # "folder_x" carries no organization, so the check above is satisfied by any
    # role the caller holds anywhere. org_id is caller-supplied — gate it.
    await require_org_membership(
        resolve_acting_user_id(current_user), int(org_id), db_session
    )
    await check_resource_access(
        request, db_session, current_user, resource_uuid, AccessAction.READ
    )

    existing = (
        await db_session.execute(
            select(FolderContent).where(
                FolderContent.org_id == int(org_id),
                FolderContent.folder_id.is_(None),
                FolderContent.resource_uuid == resource_uuid,
            )
        )
    ).scalars().first()
    if not existing:
        db_session.add(
            FolderContent(
                folder_id=None,
                resource_uuid=resource_uuid,
                org_id=int(org_id),
                position=position,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db_session.commit()

    items = await get_org_root_items(request, str(org_id), current_user, db_session)
    return next((i for i in items if i.resource_uuid == resource_uuid), None)


async def remove_org_root_content(
    request: Request,
    org_id: int,
    resource_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
):
    await check_resource_access(
        request, db_session, current_user, "folder_x", AccessAction.UPDATE
    )
    # Same "folder_x" placeholder caveat as add_org_root_content: the target org
    # is only ever checked here.
    await require_org_membership(
        resolve_acting_user_id(current_user), int(org_id), db_session
    )
    rows = (
        await db_session.execute(
            select(FolderContent).where(
                FolderContent.org_id == int(org_id),
                FolderContent.folder_id.is_(None),
                FolderContent.resource_uuid == resource_uuid,
            )
        )
    ).scalars().all()
    for row in rows:
        await db_session.delete(row)
    await db_session.commit()
    return {"detail": "Removed from library root"}


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

async def _would_create_cycle(db_session: AsyncSession, folder_id: int, new_parent_id: int) -> bool:
    """Return True if making new_parent_id the parent of folder_id creates a cycle."""
    current_id: Optional[int] = new_parent_id
    seen: set[int] = set()
    while current_id is not None:
        if current_id == folder_id:
            return True
        if current_id in seen:
            return False
        seen.add(current_id)
        parent = (
            await db_session.execute(
                select(Folder.parent_folder_id).where(Folder.id == current_id)
            )
        ).scalars().first()
        current_id = parent
    return False
