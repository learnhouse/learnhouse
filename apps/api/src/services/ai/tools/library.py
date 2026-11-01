"""Library tools: browse folders, organize them, place content, find media.

The library is Drive-like: folders nest, and resources (courses, podcasts,
communities, boards, media) are placed in folders or at the library root.
Placing or removing a resource only moves its library entry; the resource
itself is never changed. Every id is loaded through `refs` (only from the
connected organization) before the folder services run their own checks.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder, FolderCreate, FolderUpdate
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import require_org_role_permission
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.results import Paging
from src.services.folders.folders import (
    _apply_folder_sort,
    _can_read,
    _get_folders_sort_mode,
    _may_see_private,
    add_folder_content,
    add_org_root_content,
    create_folder,
    delete_folder,
    get_folder,
    get_org_root_items,
    move_folder_content,
    remove_folder_content,
    remove_org_root_content,
    update_folder,
)
from src.services.media.media import get_media, get_media_list
from src.services.media.media_access import load_folder_tree

FolderColor = Literal["violet", "blue", "emerald", "amber", "rose", "cyan", "fuchsia", "slate"]

# Library item type -> ref kind (and the page a person opens it on).
_ITEM_KIND = {
    "courses": "course",
    "podcasts": "podcast",
    "communities": "community",
    "boards": "board",
    "playgrounds": "playground",
    "media": "media",
}
# Prefixes a library entry can hold (playgrounds use bare ids and cannot be
# filed by id).
_PLACEABLE = ("course_", "podcast_", "community_", "board_", "media_")
# list_media with a query scans at most this many items the caller can see.
MEDIA_SCAN = 2000
_MEDIA_PAGE = 100


# ─── helpers ─────────────────────────────────────────────────────────────────


async def _folder_ref(ctx: ToolContext, folder, **extra) -> dict:
    return refs.ref(
        "folder",
        folder.folder_uuid,
        folder.name,
        await refs.web_url(ctx, "folder", folder=folder.folder_uuid),
        **extra,
    )


async def _item_url(ctx: ToolContext, kind: str, uuid: str) -> str | None:
    if kind in ("course", "community", "board", "playground"):
        return await refs.web_url(ctx, kind, **{kind: uuid})
    return None


async def _item_ref(ctx: ToolContext, item) -> dict:
    """A placed resource (FolderContentItem) as a ref with its kind."""
    kind = _ITEM_KIND.get(item.resource_type, item.resource_type)
    resource = item.resource or {}
    name = resource.get("name") or resource.get("title")
    extra: dict[str, Any] = {"public": resource.get("public")}
    if kind == "media":
        media_type = resource.get("media_type")
        extra["media_type"] = str(getattr(media_type, "value", media_type) or "").lower() or None
    return refs.ref(kind, item.resource_uuid, name, await _item_url(ctx, kind, item.resource_uuid), **extra)


async def _folder_counts(ctx: ToolContext, folder_ids: list[int]) -> dict[int, int]:
    """Sub-folders plus placed items per folder, two grouped queries."""
    if not folder_ids:
        return {}
    counts: dict[int, int] = {}
    for column, model in (
        (Folder.parent_folder_id, Folder),
        (FolderContent.folder_id, FolderContent),
    ):
        rows = (
            await ctx.db_session.execute(
                select(column, func.count()).select_from(model).where(column.in_(folder_ids)).group_by(column)
            )
        ).all()
        for folder_id, n in rows:
            counts[folder_id] = counts.get(folder_id, 0) + n
    return counts


async def _root_folders(ctx: ToolContext) -> list[Folder]:
    """The org's top-level folders the caller can read, in library order.

    Same rules as the folders listing route, without loading every folder's
    content the way that route does."""
    include_private = await _may_see_private(ctx.user, ctx.org.id, ctx.db_session)
    statement = select(Folder).where(Folder.org_id == ctx.org.id, Folder.parent_folder_id.is_(None))
    if not include_private:
        statement = statement.where(Folder.public == True)  # noqa: E712
    sort_mode = await _get_folders_sort_mode(ctx.db_session, ctx.org.id)
    rows = (await ctx.db_session.execute(_apply_folder_sort(statement, sort_mode))).scalars().all()
    return [
        f for f in rows
        if not include_private or await _can_read(ctx.request, ctx.user, ctx.db_session, f.folder_uuid)
    ]


async def _load_resource(ctx: ToolContext, resource_uuid: str) -> tuple[str, dict]:
    """Check a library resource id and return (kind, ref). Org-scoped."""
    uuid = (resource_uuid or "").strip()
    if not uuid.startswith(_PLACEABLE) or len(uuid) > 100:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{resource_uuid}' is not a valid library resource id. Pass a course_, podcast_, "
                "community_, board_ or media_ uuid."
            ),
        )
    if uuid.startswith("podcast_"):
        from src.db.podcasts.podcasts import Podcast

        row = (
            await ctx.db_session.execute(select(Podcast).where(Podcast.podcast_uuid == uuid))
        ).scalars().first()
        if row is None or row.org_id != ctx.org.id:
            raise refs.not_found("podcast", uuid)
        return "podcast", refs.ref("podcast", uuid, row.name)
    kind = refs.kind_of(uuid)
    row = await refs.load(ctx, kind, uuid)
    return kind, refs.ref(kind, uuid, refs.label(kind, row), await _item_url(ctx, kind, uuid))


async def _placed(ctx: ToolContext, folder: Folder | None, resource_uuid: str) -> bool:
    statement = select(FolderContent.id).where(
        FolderContent.org_id == ctx.org.id, FolderContent.resource_uuid == resource_uuid
    )
    if folder is None:
        statement = statement.where(FolderContent.folder_id.is_(None))
    else:
        statement = statement.where(FolderContent.folder_id == folder.id)
    return (await ctx.db_session.execute(statement)).first() is not None


async def _restrictions(ctx: ToolContext, folder: Folder | None) -> tuple[bool, set[frozenset]]:
    """(private, usergroup limits) a placement in ``folder`` puts on its
    content: a private folder anywhere above it makes it private, and each
    private folder linked to usergroups admits only those groups."""
    if folder is None:
        return False, set()
    tree = await load_folder_tree(ctx.db_session, ctx.org.id)
    chain = tree.chain([folder.id])
    private = any(not tree.public[f] for f in chain)
    limits = {frozenset(tree.groups[f]) for f in chain if not tree.public[f] and tree.groups.get(f)}
    return private, limits


async def _loosens(ctx: ToolContext, source: Folder | None, target: Folder | None) -> bool:
    """Whether taking an item out of ``source`` into ``target`` (None for the
    root, or for nowhere when removing) lets more people see it."""
    src_private, src_limits = await _restrictions(ctx, source)
    if not src_private:
        return False
    dst_private, dst_limits = await _restrictions(ctx, target)
    return not dst_private or not src_limits <= dst_limits


def _media_ref(media, detail: bool = False) -> dict:
    media_type = getattr(media.media_type, "value", media.media_type)
    media_type = str(media_type or "").lower() or None
    return refs.ref(
        "media",
        media.media_uuid,
        media.name,
        type=media_type,
        format=media.file_format or None,
        mime=media.file_mime or None,
        size=media.file_size,
        public=bool(media.public),
        embed_url=(media.url or None) if media_type == "embed" else None,
        description=results.clip(
            media.description or "", results.DETAIL_TEXT if detail else results.LIST_TEXT
        ) or None,
    )


async def _media_window(ctx: ToolContext, start: int, count: int) -> list:
    """Items [start, start + count) of the media list the caller can see."""
    out: list = []
    page_no, skip = start // _MEDIA_PAGE + 1, start % _MEDIA_PAGE
    while len(out) < count:
        batch = await get_media_list(
            ctx.request, str(ctx.org.id), ctx.user, ctx.db_session, page=page_no, limit=_MEDIA_PAGE
        )
        out.extend(batch[skip:])
        skip = 0
        if len(batch) < _MEDIA_PAGE:
            break
        page_no += 1
    return out[:count]


# ─── params ──────────────────────────────────────────────────────────────────


class BrowseLibraryParams(Paging):
    folder_uuid: str | None = Field(
        None, max_length=100, description="Folder to open; omit for the library root."
    )


class CreateFolderParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Folder name.")
    parent_folder_uuid: str | None = Field(
        None, max_length=100, description="Parent folder; omit to create it at the library root."
    )
    description: str | None = Field(None, max_length=2000, description="Short description.")
    color: FolderColor = Field("violet", description="Folder card color.")
    public: bool = Field(
        False, description="True shows it in the public library to signed-out visitors; otherwise members only."
    )


class UpdateFolderParams(BaseModel):
    folder_uuid: str = Field(..., max_length=100, description="The folder to change.")
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    description: str | None = Field(None, max_length=2000, description="New description.")
    color: FolderColor | None = Field(None, description="New card color.")
    public: bool | None = Field(None, description="True shows it to signed-out visitors, false to members only.")
    parent_folder_uuid: str | None = Field(
        None, max_length=100, description='Move it under this folder, or "root" for the library root.'
    )


class DeleteFolderParams(BaseModel):
    folder_uuid: str = Field(..., max_length=100, description="The folder to delete.")


class PlaceInLibraryParams(BaseModel):
    resource_uuid: str = Field(
        ..., max_length=100, description="Resource to place: a course_, podcast_, community_, board_ or media_ uuid."
    )
    folder_uuid: str | None = Field(
        None, max_length=100, description="Folder to place it in (or remove it from); omit for the library root."
    )
    remove: bool = Field(
        False, description="True takes it out of that folder or the root instead of adding it."
    )
    from_folder_uuid: str | None = Field(
        None,
        max_length=100,
        description='Move it: the folder it is in now, or "root". Omit to add without moving.',
    )


class ListMediaParams(Paging):
    media_uuid: str | None = Field(
        None, max_length=100, description="Return just this media item (with its full description)."
    )
    query: str | None = Field(
        None, min_length=1, max_length=200, description="Only media whose name or description contains this."
    )


# ─── executors ───────────────────────────────────────────────────────────────


async def _browse_library(ctx: ToolContext, p: BrowseLibraryParams):
    if p.folder_uuid:
        row = await refs.load(ctx, "folder", p.folder_uuid)
        # The service checks read access and hides what the caller cannot see.
        folder = await get_folder(ctx.request, row.folder_uuid, ctx.user, ctx.db_session)
        entries = [
            await _folder_ref(ctx, sub, public=bool(sub.public), items=sub.total_items)
            for sub in folder.subfolders
        ]
        entries += [await _item_ref(ctx, item) for item in folder.items]
        here = await _folder_ref(
            ctx, row, public=bool(row.public), description=results.clip(row.description or "") or None
        )
        path = [refs.ref("folder", c.folder_uuid, c.name) for c in folder.breadcrumbs[:-1]]
        return results.page_of(entries, p, folder=here, path=path)

    folders = await _root_folders(ctx)
    counts = await _folder_counts(ctx, [f.id for f in folders])
    entries = [
        await _folder_ref(ctx, f, public=bool(f.public), items=counts.get(f.id, 0)) for f in folders
    ]
    items = await get_org_root_items(ctx.request, str(ctx.org.id), ctx.user, ctx.db_session)
    entries += [await _item_ref(ctx, item) for item in items]
    return results.page_of(entries, p, folder=None, path=[])


async def _create_folder(ctx: ToolContext, p: CreateFolderParams):
    parent = await refs.load(ctx, "folder", p.parent_folder_uuid) if p.parent_folder_uuid else None
    created = await create_folder(
        ctx.request,
        FolderCreate(
            name=p.name,
            description=p.description or "",
            public=p.public,
            color=p.color,
            org_id=ctx.org.id,
            parent_folder_uuid=parent.folder_uuid if parent else None,
        ),
        ctx.user,
        ctx.db_session,
    )
    row = await refs.load(ctx, "folder", created.folder_uuid)
    where = f' in "{parent.name}"' if parent else " at the library root"
    return results.changed(
        f'Created {"public" if p.public else "members-only"} folder "{row.name}"{where}.',
        folder=await _folder_ref(ctx, row, public=bool(row.public)),
        parent=await _folder_ref(ctx, parent) if parent else None,
    )


async def _update_folder(ctx: ToolContext, p: UpdateFolderParams):
    row = await refs.load(ctx, "folder", p.folder_uuid)
    patch: dict[str, Any] = {
        k: v
        for k, v in {"name": p.name, "description": p.description, "color": p.color, "public": p.public}.items()
        if v is not None
    }
    if p.parent_folder_uuid is not None:
        if p.parent_folder_uuid.strip().lower() == "root":
            patch["parent_folder_uuid"] = "root"
        else:
            parent = await refs.load(ctx, "folder", p.parent_folder_uuid)
            patch["parent_folder_uuid"] = parent.folder_uuid
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    # Only the fields given: the service treats a present parent as a move.
    await update_folder(ctx.request, FolderUpdate(**patch), row.folder_uuid, ctx.user, ctx.db_session)
    await ctx.db_session.refresh(row)
    fields = ["parent" if k == "parent_folder_uuid" else k for k in patch]
    return results.changed(
        f'Updated folder "{row.name}" ({", ".join(fields)}).',
        folder=await _folder_ref(ctx, row, public=bool(row.public)),
    )


async def _delete_folder(ctx: ToolContext, p: DeleteFolderParams):
    row = await refs.load(ctx, "folder", p.folder_uuid)
    name = row.name
    await delete_folder(ctx.request, row.folder_uuid, ctx.user, ctx.db_session)
    return results.changed(
        f'Deleted folder "{name}" and its sub-folders. The resources placed in them were not deleted.',
        folder=refs.ref("folder", p.folder_uuid, name),
    )


async def _place_in_library(ctx: ToolContext, p: PlaceInLibraryParams):
    if p.remove and p.from_folder_uuid:
        raise HTTPException(
            status_code=400, detail="Pass either remove=true or from_folder_uuid (to move), not both."
        )
    kind, resource = await _load_resource(ctx, p.resource_uuid)
    uuid = resource["uuid"]
    target = await refs.load(ctx, "folder", p.folder_uuid) if p.folder_uuid else None
    target_ref = await _folder_ref(ctx, target) if target else "root"
    target_name = f'"{target.name}"' if target else "the library root"

    if p.remove:
        was_there = await _placed(ctx, target, uuid)
        if was_there and await _loosens(ctx, target, None):
            require_approval(ctx, "Taking an item out of a members-only folder needs the user's approval.")
        if target:
            await remove_folder_content(ctx.request, target.folder_uuid, uuid, ctx.user, ctx.db_session)
        else:
            await remove_org_root_content(ctx.request, ctx.org.id, uuid, ctx.user, ctx.db_session)
        summary = (
            f"Removed {resource.get('name') or uuid} from {target_name}; the {kind} itself is unchanged."
            if was_there
            else f"{resource.get('name') or uuid} was not in {target_name}; nothing changed."
        )
        return results.changed(summary, resource=resource, folder=target_ref)

    if p.from_folder_uuid is None:
        if target:
            await add_folder_content(ctx.request, target.folder_uuid, uuid, ctx.user, ctx.db_session)
        else:
            await add_org_root_content(ctx.request, ctx.org.id, uuid, ctx.user, ctx.db_session)
        return results.changed(
            f"Placed {resource.get('name') or uuid} in {target_name}.", resource=resource, folder=target_ref
        )

    # A move. Both ends are checked before anything changes, and the new
    # entry is written before the old one goes, so a refusal never drops the
    # item from the library.
    from_root = p.from_folder_uuid.strip().lower() == "root"
    source = None if from_root else await refs.load(ctx, "folder", p.from_folder_uuid)
    if (source is None and target is None) or (source and target and source.id == target.id):
        raise HTTPException(status_code=400, detail="from_folder_uuid and folder_uuid name the same place.")
    if not await _placed(ctx, source, uuid):
        where = f'folder "{source.name}"' if source else "the library root"
        raise HTTPException(
            status_code=404, detail=f"{resource.get('name') or uuid} is not in {where}. Check with browse_library."
        )
    if await _loosens(ctx, source, target):
        require_approval(
            ctx, "Moving an item out of a members-only folder to a more open place needs the user's approval."
        )

    if source and target:
        await move_folder_content(
            ctx.request, source.folder_uuid, target.folder_uuid, uuid, ctx.user, ctx.db_session
        )
    elif source:
        await check_resource_access(
            ctx.request, ctx.db_session, ctx.user, source.folder_uuid, AccessAction.UPDATE
        )
        await add_org_root_content(ctx.request, ctx.org.id, uuid, ctx.user, ctx.db_session)
        await remove_folder_content(ctx.request, source.folder_uuid, uuid, ctx.user, ctx.db_session)
    else:
        # Taking something off the root takes the org-wide folders update right.
        await check_resource_access(ctx.request, ctx.db_session, ctx.user, "folder_x", AccessAction.UPDATE)
        await require_org_role_permission(
            resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session, "folders", "action_update"
        )
        await add_folder_content(ctx.request, target.folder_uuid, uuid, ctx.user, ctx.db_session)
        await remove_org_root_content(ctx.request, ctx.org.id, uuid, ctx.user, ctx.db_session)

    from_name = f'"{source.name}"' if source else "the library root"
    return results.changed(
        f"Moved {resource.get('name') or uuid} from {from_name} to {target_name}.",
        resource=resource,
        folder=target_ref,
        from_folder=await _folder_ref(ctx, source) if source else "root",
    )


async def _list_media(ctx: ToolContext, p: ListMediaParams):
    if p.media_uuid:
        row = await refs.load(ctx, "media", p.media_uuid)
        media = await get_media(ctx.request, row.media_uuid, ctx.user, ctx.db_session)
        return results.page([_media_ref(media, detail=True)], offset=0, limit=1, total=1)

    offset = results.offset_of(p.cursor)
    if not p.query:
        window = await _media_window(ctx, offset, p.limit + 1)
        return results.page(
            [_media_ref(m) for m in window[: p.limit]],
            offset=offset,
            limit=p.limit,
            has_more=len(window) > p.limit,
        )

    needle = p.query.casefold()
    scanned = await _media_window(ctx, 0, MEDIA_SCAN + 1)
    matches = [
        _media_ref(m)
        for m in scanned[:MEDIA_SCAN]
        if needle in (m.name or "").casefold() or needle in (m.description or "").casefold()
    ]
    extra = {"partial": True} if len(scanned) > MEDIA_SCAN else {}
    return results.page_of(matches, p, **extra)


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="browse_library",
        description=(
            "Open the library root or one folder: its sub-folders, then the resources placed in it "
            "(courses, podcasts, communities, boards, media), each with kind and link. Paged; a "
            "folder also returns its path."
        ),
        params_model=BrowseLibraryParams,
        tier=ActionTier.READ,
        rights_bucket="folders",
        access_action=AccessAction.READ,
        execute=_browse_library,
        target_param="folder_uuid",
        target_kind="folder",
        title="Browse library",
    ),
    ToolSpec(
        name="create_folder",
        description=(
            "Create a library folder at the root or inside parent_folder_uuid. Members-only by "
            "default; a public folder needs approval. Returns the new folder."
        ),
        params_model=CreateFolderParams,
        tier=ActionTier.CREATE,
        rights_bucket="folders",
        access_action=AccessAction.CREATE,
        execute=_create_folder,
        target_kind="folder",
        approval_if=lambda p: p.public,
        summarize=lambda p: f'Create {"public" if p.public else "members-only"} folder "{p.name}"',
        title="Create folder",
    ),
    ToolSpec(
        name="update_folder",
        description=(
            'Rename, recolor, describe, change visibility of, or move a folder (parent_folder_uuid, '
            'or "root"). Send only what changes. Visibility changes need approval.'
        ),
        params_model=UpdateFolderParams,
        tier=ActionTier.EDIT,
        rights_bucket="folders",
        access_action=AccessAction.UPDATE,
        execute=_update_folder,
        target_param="folder_uuid",
        target_kind="folder",
        approval_if=lambda p: p.public is not None,
        idempotent=True,
        summarize=lambda p: "Update folder: "
        + ", ".join(p.model_dump(exclude={"folder_uuid"}, exclude_none=True) or ["nothing"]),
        title="Update folder",
    ),
    ToolSpec(
        name="delete_folder",
        description=(
            "Permanently delete a folder and its sub-folders. The courses, media and other resources "
            "placed in them are not deleted, only their library entries."
        ),
        params_model=DeleteFolderParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="folders",
        access_action=AccessAction.DELETE,
        execute=_delete_folder,
        target_param="folder_uuid",
        target_kind="folder",
        summarize=lambda p: f"Delete folder {p.folder_uuid} and its sub-folders",
        title="Delete folder",
    ),
    ToolSpec(
        name="place_in_library",
        description=(
            "Add a resource to a folder (or the root when folder_uuid is omitted), remove it with "
            "remove=true, or move it with from_folder_uuid. Only the library entry changes; the "
            "resource itself is untouched. Taking it out of a members-only folder to a more open "
            "place needs approval."
        ),
        params_model=PlaceInLibraryParams,
        tier=ActionTier.EDIT,
        rights_bucket="folders",
        access_action=AccessAction.UPDATE,
        execute=_place_in_library,
        target_param="folder_uuid",
        target_kind="folder",
        approval_in_call=True,
        idempotent=True,
        summarize=lambda p: (
            f"{'Remove' if p.remove else 'Move' if p.from_folder_uuid else 'Place'} {p.resource_uuid} "
            f"{'from' if p.remove else 'to'} {p.folder_uuid or 'the library root'}"
        ),
        title="Place in library",
    ),
    ToolSpec(
        name="list_media",
        description=(
            "List the media library you can see (uploads and embeds): name, type, format, size, "
            "visibility. Filter by text with query, or pass media_uuid for one item. Paged."
        ),
        params_model=ListMediaParams,
        tier=ActionTier.READ,
        rights_bucket="media",
        access_action=AccessAction.READ,
        execute=_list_media,
        target_param="media_uuid",
        target_kind="media",
        title="List media",
    ),
]
