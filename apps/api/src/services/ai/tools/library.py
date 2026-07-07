"""Library tools — browse/search the org library, manage folders, place
content, and read media.

Every tool wraps an existing service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the services' own RBAC
checks stay authoritative. The library is Drive-like: folders nest, and
resources (courses, media, boards, ...) are placed inside folders or
directly at the org root.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.db.folders.folders import FolderCreate, FolderUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.folders.folders import (
    add_folder_content,
    add_org_root_content,
    create_folder,
    delete_folder,
    get_folder,
    get_folders,
    get_org_root_items,
    move_folder_content,
    remove_folder_content,
    remove_org_root_content,
    search_library,
    update_folder,
)
from src.services.media.media import get_media, get_media_list


def _trim(text, limit: int = 280):
    if isinstance(text, str) and len(text) > limit:
        return text[:limit] + "…"
    return text


def _compact_folder(folder) -> dict:
    data = jsonable(folder)
    keep = (
        "folder_uuid",
        "name",
        "description",
        "public",
        "color",
        "total_items",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    out["description"] = _trim(out.get("description"))
    return out


def _compact_item(item) -> dict:
    """Compact projection of a resolved library item (FolderContentItem or
    the equivalent dict from search_library)."""
    data = jsonable(item)
    resource = data.get("resource") or {}
    return {
        "resource_uuid": data.get("resource_uuid"),
        "resource_type": data.get("resource_type"),
        "name": resource.get("name") or resource.get("title"),
        "description": _trim(resource.get("description")),
        "public": resource.get("public"),
    }


def _folder_view(folder) -> dict:
    """A folder plus its direct children (sub-folders + leaf items)."""
    out = _compact_folder(folder)
    out["breadcrumbs"] = jsonable(folder.breadcrumbs)
    out["subfolders"] = [_compact_folder(s) for s in folder.subfolders]
    out["items"] = [_compact_item(i) for i in folder.items]
    return out


def _compact_media(media) -> dict:
    data = jsonable(media)
    keep = (
        "media_uuid",
        "name",
        "description",
        "media_type",
        "url",
        "public",
        "file_format",
        "file_size",
        "file_mime",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    out["description"] = _trim(out.get("description"))
    return out


# ─── params ────────────────────────────────────────────────────────────────


class BrowseLibraryParams(BaseModel):
    folder_uuid: str | None = Field(
        None,
        description="Folder to open; omit to browse the org library root "
        "(root folders + items placed at the root).",
    )


class SearchLibraryParams(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        description="Free-text search across folder names and library item names",
    )


class CreateFolderParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    public: bool = True
    color: str = Field("violet", description="Folder card color label")
    parent_folder_uuid: str | None = Field(
        None, description="Parent folder uuid; omit to create at the library root."
    )


class UpdateFolderParams(BaseModel):
    folder_uuid: str
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    public: bool | None = None
    color: str | None = None
    parent_folder_uuid: str | None = Field(
        None,
        description='New parent folder uuid to re-parent the folder; pass "root" '
        "to move it to the library root.",
    )


class DeleteFolderParams(BaseModel):
    folder_uuid: str
    confirm: bool | None = None


class MoveLibraryContentParams(BaseModel):
    operation: Literal["add", "remove", "move"] = Field(
        ...,
        description='"add"/"remove" place or unplace a resource in one location; '
        '"move" relocates it between two locations.',
    )
    resource_uuid: str = Field(
        ...,
        description="Uuid of the resource to place (course_*, media_*, board_*, "
        "podcast_*, community_*, playground_*).",
    )
    folder_uuid: str | None = Field(
        None,
        description="For add/remove: the folder to add to / remove from; omit "
        "for the library root.",
    )
    source_folder_uuid: str | None = Field(
        None, description="For move: the folder it currently sits in; omit for the library root."
    )
    target_folder_uuid: str | None = Field(
        None, description="For move: the destination folder; omit for the library root."
    )


class ListMediaParams(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)


class GetMediaParams(BaseModel):
    media_uuid: str


# ─── executors ─────────────────────────────────────────────────────────────


async def _browse_library(ctx: ToolContext, p: BrowseLibraryParams):
    if p.folder_uuid:
        folder = await get_folder(ctx.request, p.folder_uuid, ctx.user, ctx.db_session)
        return _folder_view(folder)
    folders = await get_folders(ctx.request, str(ctx.org.id), ctx.user, ctx.db_session)
    items = await get_org_root_items(
        ctx.request, str(ctx.org.id), ctx.user, ctx.db_session
    )
    return {
        "folders": [_compact_folder(f) for f in folders],
        "items": [_compact_item(i) for i in items],
    }


async def _search_library(ctx: ToolContext, p: SearchLibraryParams):
    results = await search_library(
        ctx.request, str(ctx.org.id), p.query, ctx.user, ctx.db_session
    )
    folders = []
    for f in results.get("folders", []):
        compact = _compact_folder(f)
        compact["path"] = jsonable(f.get("path", []))
        folders.append(compact)
    items = []
    for i in results.get("items", []):
        compact = _compact_item(i)
        compact["path"] = jsonable(i.get("path", []))
        items.append(compact)
    return {"folders": folders, "items": items}


async def _create_folder(ctx: ToolContext, p: CreateFolderParams):
    folder = await create_folder(
        ctx.request,
        FolderCreate(
            name=p.name,
            description=p.description,
            public=p.public,
            color=p.color,
            org_id=ctx.org.id,
            parent_folder_uuid=p.parent_folder_uuid,
        ),
        ctx.user,
        ctx.db_session,
    )
    return _folder_view(folder)


async def _update_folder(ctx: ToolContext, p: UpdateFolderParams):
    patch = p.model_dump(exclude={"folder_uuid"}, exclude_none=True)
    folder = await update_folder(
        ctx.request,
        FolderUpdate(**patch),
        p.folder_uuid,
        ctx.user,
        ctx.db_session,
    )
    return _folder_view(folder)


async def _delete_folder(ctx: ToolContext, p: DeleteFolderParams):
    return jsonable(
        await delete_folder(ctx.request, p.folder_uuid, ctx.user, ctx.db_session)
    )


async def _move_library_content(ctx: ToolContext, p: MoveLibraryContentParams):
    if p.operation == "add":
        if p.folder_uuid:
            folder = await add_folder_content(
                ctx.request, p.folder_uuid, p.resource_uuid, ctx.user, ctx.db_session
            )
            return _folder_view(folder)
        item = await add_org_root_content(
            ctx.request, ctx.org.id, p.resource_uuid, ctx.user, ctx.db_session
        )
        return {
            "detail": "Added to library root",
            "item": _compact_item(item) if item else None,
        }

    if p.operation == "remove":
        if p.folder_uuid:
            folder = await remove_folder_content(
                ctx.request, p.folder_uuid, p.resource_uuid, ctx.user, ctx.db_session
            )
            return _folder_view(folder)
        return jsonable(
            await remove_org_root_content(
                ctx.request, ctx.org.id, p.resource_uuid, ctx.user, ctx.db_session
            )
        )

    # move
    if p.source_folder_uuid and p.target_folder_uuid:
        folder = await move_folder_content(
            ctx.request,
            p.source_folder_uuid,
            p.target_folder_uuid,
            p.resource_uuid,
            ctx.user,
            ctx.db_session,
        )
        return _folder_view(folder)
    if p.source_folder_uuid and not p.target_folder_uuid:
        # folder → root
        await remove_folder_content(
            ctx.request, p.source_folder_uuid, p.resource_uuid, ctx.user, ctx.db_session
        )
        item = await add_org_root_content(
            ctx.request, ctx.org.id, p.resource_uuid, ctx.user, ctx.db_session
        )
        return {
            "detail": "Moved to library root",
            "item": _compact_item(item) if item else None,
        }
    if p.target_folder_uuid and not p.source_folder_uuid:
        # root → folder
        await remove_org_root_content(
            ctx.request, ctx.org.id, p.resource_uuid, ctx.user, ctx.db_session
        )
        folder = await add_folder_content(
            ctx.request, p.target_folder_uuid, p.resource_uuid, ctx.user, ctx.db_session
        )
        return _folder_view(folder)
    raise HTTPException(
        status_code=400,
        detail="A move needs a source_folder_uuid and/or a target_folder_uuid",
    )


async def _list_media(ctx: ToolContext, p: ListMediaParams):
    media_items = await get_media_list(
        ctx.request,
        str(ctx.org.id),
        ctx.user,
        ctx.db_session,
        page=p.page,
        limit=p.limit,
    )
    return [_compact_media(m) for m in media_items]


async def _get_media(ctx: ToolContext, p: GetMediaParams):
    media = await get_media(ctx.request, p.media_uuid, ctx.user, ctx.db_session)
    return jsonable(media)


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="browse_library",
        description=(
            "Browse the org library: the root (folders + items placed at the "
            "root) or, with folder_uuid, one folder's sub-folders and items. "
            "Use to see where content lives before moving or organizing it."
        ),
        params_model=BrowseLibraryParams,
        tier=ActionTier.READ,
        rights_bucket="folders",
        access_action=AccessAction.READ,
        execute=_browse_library,
        target_param="folder_uuid",
        target_kind="folder",
    ),
    ToolSpec(
        name="search_library",
        description=(
            "Search the whole library tree by name — matches folders and "
            "placed items (courses, media, boards, ...) with their folder "
            "path. Use FIRST to locate a folder or item mentioned by name."
        ),
        params_model=SearchLibraryParams,
        tier=ActionTier.READ,
        rights_bucket="folders",
        access_action=AccessAction.READ,
        execute=_search_library,
    ),
    ToolSpec(
        name="create_folder",
        description=(
            "Create a library folder, at the root or nested under "
            "parent_folder_uuid."
        ),
        params_model=CreateFolderParams,
        tier=ActionTier.CREATE,
        rights_bucket="folders",
        access_action=AccessAction.CREATE,
        execute=_create_folder,
        target_kind="folder",
        summarize=lambda p: f'Create folder "{p.name}"',
    ),
    ToolSpec(
        name="update_folder",
        description=(
            "Update a folder (rename, description, color, visibility) or "
            're-parent it (parent_folder_uuid; "root" moves it to the '
            "library root). Only send fields to change."
        ),
        params_model=UpdateFolderParams,
        tier=ActionTier.EDIT,
        rights_bucket="folders",
        access_action=AccessAction.UPDATE,
        execute=_update_folder,
        target_param="folder_uuid",
        target_kind="folder",
        summarize=lambda p: "Update folder fields: "
        + ", ".join(p.model_dump(exclude={"folder_uuid"}, exclude_none=True) or ["-"]),
    ),
    ToolSpec(
        name="delete_folder",
        description=(
            "Permanently delete a folder, its sub-folders, and their content "
            "placements (the placed resources themselves survive). "
            "Irreversible."
        ),
        params_model=DeleteFolderParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="folders",
        access_action=AccessAction.DELETE,
        execute=_delete_folder,
        target_param="folder_uuid",
        target_kind="folder",
    ),
    ToolSpec(
        name="move_library_content",
        description=(
            "Place, unplace, or relocate a resource in the library: "
            'operation="add"/"remove" with folder_uuid (omit for the root), '
            'or operation="move" with source/target_folder_uuid (omit either '
            "for the root). Removing a placement never deletes the resource."
        ),
        params_model=MoveLibraryContentParams,
        tier=ActionTier.EDIT,
        rights_bucket="folders",
        access_action=AccessAction.UPDATE,
        execute=_move_library_content,
        target_param="folder_uuid",
        target_kind="folder",
        summarize=lambda p: f"{p.operation.capitalize()} library item {p.resource_uuid}",
    ),
    ToolSpec(
        name="list_media",
        description=(
            "List the organization's media assets (uploads and embeds), "
            "paginated. Use to find media to attach or place in folders."
        ),
        params_model=ListMediaParams,
        tier=ActionTier.READ,
        rights_bucket="media",
        access_action=AccessAction.READ,
        execute=_list_media,
    ),
    ToolSpec(
        name="get_media",
        description=(
            "Get one media asset's details (type, url, file format/size) by "
            "uuid."
        ),
        params_model=GetMediaParams,
        tier=ActionTier.READ,
        rights_bucket="media",
        access_action=AccessAction.READ,
        execute=_get_media,
        target_param="media_uuid",
        target_kind="media",
    ),
]
