"""What a group unlocks: courses, paths, communities, podcasts, live
sessions, boards and library items, each with an optional access window.

A link restricts the resource to the groups linked to it (the existing
rule), and grants this group's members access between ``starts_at`` and
``expires_at``. A path is not gated by itself: adding one links each of its
courses, with the same window.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.usergroup_resources import UserGroupResource
from src.services.security.rate_limiting import enforce_batch_size_limit
from src.services.usergroups.windows import ugr_granting
from src.services.usergroups.common import (
    iso,
    load_group,
    parse_when,
    record,
    require_group_access,
    require_org_admin,
    utcnow,
    aware,
)

# uuid prefix -> kind shown in the UI
KINDS = {
    "course_": "course", "path_": "path", "community_": "community", "podcast_": "podcast",
    "livesession_": "live_session", "board_": "board", "folder_": "folder", "media_": "media",
}


def kind_of(uuid: str) -> Optional[str]:
    for prefix, kind in KINDS.items():
        if uuid.startswith(prefix):
            return kind
    return None


def _model(kind: str):
    if kind == "course":
        from src.db.courses.courses import Course
        return Course, Course.course_uuid, "name"
    if kind == "path":
        from src.db.paths import Path
        return Path, Path.path_uuid, "name"
    if kind == "community":
        from src.db.communities.communities import Community
        return Community, Community.community_uuid, "name"
    if kind == "podcast":
        from src.db.podcasts.podcasts import Podcast
        return Podcast, Podcast.podcast_uuid, "name"
    if kind == "board":
        from src.core.ee_hooks import get_ee_module

        boards = get_ee_module("ee.db.boards")  # Boards are EE-only
        if boards is None:
            return None
        return boards.Board, boards.Board.board_uuid, "name"
    if kind == "folder":
        from src.db.folders.folders import Folder
        return Folder, Folder.folder_uuid, "name"
    if kind == "media":
        from src.db.media.media import Media
        return Media, Media.media_uuid, "name"
    if kind == "live_session":
        from src.core.ee_hooks import get_ee_module

        mod = get_ee_module("ee.db.live_sessions")
        if mod is None:
            return None
        return mod.LiveSession, mod.LiveSession.live_session_uuid, "title"
    return None  # pragma: no cover


async def describe_resources(db: AsyncSession, org_id: int, uuids: list[str]) -> dict[str, dict]:
    """{uuid: {kind, name, thumbnail}} for resources of this org (others are left out)."""
    by_kind: dict[str, list[str]] = {}
    for u in uuids:
        k = kind_of(u)
        if k:
            by_kind.setdefault(k, []).append(u)
    out: dict[str, dict] = {}
    for kind, items in by_kind.items():
        spec = _model(kind)
        if spec is None:
            continue
        model, col, name_attr = spec
        for row in (await db.execute(select(model).where(col.in_(items), model.org_id == org_id))).scalars().all():
            uuid = getattr(row, col.key)
            out[uuid] = {"kind": kind, "name": getattr(row, name_attr, None) or uuid,
                         "thumbnail_image": getattr(row, "thumbnail_image", None) or None}
            if kind == "live_session":
                out[uuid]["starts_at"] = iso(getattr(row, "starts_at", None))
    return out


def status_of(starts: Optional[datetime], ends: Optional[datetime], now: datetime) -> str:
    if ends is not None and aware(ends) <= now:  # type: ignore[operator]
        return "expired"
    if starts is not None and aware(starts) > now:  # type: ignore[operator]
        return "scheduled"
    return "active"


async def list_access(request: Request, db: AsyncSession, user: Any, group_id: int) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "view")
    links = (await db.execute(select(UserGroupResource).where(UserGroupResource.usergroup_id == group.id).order_by(UserGroupResource.id))).scalars().all()
    info = await describe_resources(db, group.org_id, [link.resource_uuid for link in links])
    now = utcnow()
    items = []
    for link in links:
        meta = info.get(link.resource_uuid) or {"kind": kind_of(link.resource_uuid) or "resource", "name": link.resource_uuid}
        items.append({
            "resource_uuid": link.resource_uuid, **meta, "starts_at": iso(link.starts_at), "expires_at": iso(link.expires_at),
            "status": status_of(link.starts_at, link.expires_at, now), "linked_at": link.creation_date or None,
        })
    return {"items": items}


class AccessBody(BaseModel):
    resource_uuids: list[str] = Field(default_factory=list, max_length=100)
    starts_at: Optional[str] = None
    expires_at: Optional[str] = None


async def _expand(db: AsyncSession, org_id: int, uuids: list[str]) -> tuple[list[str], list[dict]]:
    """Validate that every uuid is a resource of this org; paths become their
    courses. Returns (link uuids, per-item results for the refused ones)."""
    info = await describe_resources(db, org_id, uuids)
    links: list[str] = []
    refused: list[dict] = []
    for u in dict.fromkeys(uuids):
        kind = kind_of(u)
        if kind is None:
            refused.append({"resource_uuid": u, "result": "not_linkable"})
            continue
        if u not in info:
            refused.append({"resource_uuid": u, "result": "not_found"})
            continue
        if kind == "path":
            from src.db.courses.courses import Course
            from src.db.paths import Path, PathCourse

            courses = (await db.execute(
                select(Course.course_uuid).join(PathCourse, PathCourse.course_id == Course.id)
                .join(Path, Path.id == PathCourse.path_id).where(Path.path_uuid == u, Path.org_id == org_id, Course.org_id == org_id)
            )).scalars().all()
            links.extend(courses)
            continue
        links.append(u)
    return list(dict.fromkeys(links)), refused


async def add_access(request: Request, db: AsyncSession, user: Any, group_id: int, body: AccessBody) -> dict:
    from src.services.webhooks.dispatch import dispatch_webhooks

    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id)
    enforce_batch_size_limit(len(body.resource_uuids), "resources")
    starts = parse_when(body.starts_at, "starts_at")
    ends = parse_when(body.expires_at, "expires_at")
    if starts and ends and ends <= starts:
        raise HTTPException(status_code=422, detail="The access end must be after its start")
    links, results = await _expand(db, group.org_id, body.resource_uuids)
    existing = {link.resource_uuid: link for link in (await db.execute(
        select(UserGroupResource).where(UserGroupResource.usergroup_id == group.id)
    )).scalars().all()}
    added, updated = [], []
    for u in links:
        link = existing.get(u)
        if link is None:
            db.add(UserGroupResource(usergroup_id=group.id, resource_uuid=u, org_id=group.org_id,
                                     creation_date=str(datetime.now()), update_date=str(datetime.now()),
                                     starts_at=starts, expires_at=ends))
            added.append(u)
        elif aware(link.starts_at) != starts or aware(link.expires_at) != ends:
            link.starts_at, link.expires_at = starts, ends
            link.update_date = str(datetime.now())
            db.add(link)
            updated.append(u)
    results += [{"resource_uuid": u, "result": "linked"} for u in added]
    results += [{"resource_uuid": u, "result": "window_updated"} for u in updated]
    results += [{"resource_uuid": u, "result": "already_linked"} for u in links if u not in added and u not in updated]
    if added or updated:
        record(db, request, group, "access_added" if added else "access_updated", user, details={
            "resource_uuids": (added + updated)[:50], "count": len(added) + len(updated),
            **({"starts_at": iso(starts)} if starts else {}), **({"expires_at": iso(ends)} if ends else {}),
        })
    await db.commit()
    if added:
        await dispatch_webhooks(event_name="usergroup_resources_added", org_id=group.org_id, data={
            "usergroup_id": group.id, "usergroup_uuid": group.usergroup_uuid, "resource_uuids": added})
    return {"results": results}


async def remove_access(request: Request, db: AsyncSession, user: Any, group_id: int, resource_uuids: list[str]) -> dict:
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id)
    enforce_batch_size_limit(len(resource_uuids), "resources")
    removed = []
    for link in (await db.execute(select(UserGroupResource).where(
        UserGroupResource.usergroup_id == group.id, UserGroupResource.resource_uuid.in_(resource_uuids)  # type: ignore[attr-defined]
    ))).scalars().all():
        await db.delete(link)
        removed.append(link.resource_uuid)
    if removed:
        record(db, request, group, "access_removed", user, details={"resource_uuids": removed[:50], "count": len(removed)})
    await db.commit()
    return {"removed": removed}


async def access_options(request: Request, db: AsyncSession, user: Any, group_id: int, q: str = "", kind: str = "") -> dict:
    """Resources of the org the Access tab can add, searchable."""
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id, "read")
    needle = q.strip().lower()
    out = []
    for k in ([kind] if kind in KINDS.values() else list(KINDS.values())):
        spec = _model(k)
        if spec is None:
            continue
        model, col, name_attr = spec
        stmt = select(model).where(model.org_id == group.org_id)
        if needle:
            stmt = stmt.where(getattr(model, name_attr).ilike(f"%{needle}%"))
        for row in (await db.execute(stmt.limit(30))).scalars().all():
            out.append({"resource_uuid": getattr(row, col.key), "kind": k, "name": getattr(row, name_attr, None) or "",
                        "thumbnail_image": getattr(row, "thumbnail_image", None) or None})
    return {"items": out}


async def granting_uuids(db: AsyncSession, group_ids: list[int]) -> list[str]:
    if not group_ids:
        return []
    return list(dict.fromkeys((await db.execute(select(UserGroupResource.resource_uuid).where(
        UserGroupResource.usergroup_id.in_(group_ids), ugr_granting()  # type: ignore[attr-defined]
    ))).scalars().all()))
