"""The group space and group messaging.

The space is a page members of a group can open when the group turns it on:
announcements, the content the group unlocks, and (if allowed) who else is
in it, by name and avatar only. Like the company space, anyone outside the
group gets a 404; org admins and the group's managers may preview it.

Announcements are posted by admins or managers with the post right; members
get an inbox notification. Emailing the group goes through the newsletter's
individual-email path (EE), which applies its deliverability rules
(suppression list, sending limits, review); only people who may send
newsletters can email a group.
"""

from __future__ import annotations

from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.usergroup_extras import UserGroupAnnouncement, UserGroupManager
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.usergroups.access import describe_resources, granting_uuids
from src.services.usergroups.common import (
    actor_id,
    advanced_enabled,
    capabilities_for,
    group_settings,
    iso,
    load_group,
    load_group_by_uuid,
    record,
    require_advanced,
    require_group_access,
    require_person,
)
from src.services.usergroups.groups import user_brief, users_by_id
from src.services.usergroups.membership import member_ids

MAX_ANNOUNCEMENTS = 30


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Group not found")


async def _ancestors_and_self(db: AsyncSession, group: UserGroup) -> list[int]:
    from src.services.usergroups.common import ancestor_ids

    return [group.id, *await ancestor_ids(db, group)]  # type: ignore[list-item]


def announcement_dict(a: UserGroupAnnouncement, people: dict) -> dict:
    author = people.get(a.author_id)
    return {"announcement_uuid": a.announcement_uuid, "title": a.title, "body": a.body, "pinned": a.pinned,
            "emailed": a.emailed, "created_at": iso(a.created_at), "author": user_brief(author) if author else None}


async def list_announcements_for(db: AsyncSession, group: UserGroup) -> list[dict]:
    rows = (await db.execute(select(UserGroupAnnouncement).where(UserGroupAnnouncement.usergroup_id == group.id)
                             .order_by(UserGroupAnnouncement.pinned.desc(), UserGroupAnnouncement.id.desc())  # type: ignore[union-attr]
                             .limit(MAX_ANNOUNCEMENTS))).scalars().all()
    people = await users_by_id(db, [a.author_id for a in rows])
    return [announcement_dict(a, people) for a in rows]


async def space(request: Request, db: AsyncSession, user: Any, org_id: int, short_uuid: str) -> dict:
    uid = require_person(user)
    uuid = short_uuid if short_uuid.startswith("usergroup_") else f"usergroup_{short_uuid}"
    try:
        group = await load_group_by_uuid(db, org_id, uuid)
    except HTTPException:
        raise _not_found()
    settings = group_settings(group)
    member = (await db.execute(select(UserGroupUser.id).where(
        UserGroupUser.usergroup_id == group.id, UserGroupUser.user_id == uid))).first() is not None
    caps = await capabilities_for(request, db, user, group)
    staff = caps["role"] in ("admin", "manager")
    if not staff and (not member or not settings["space_enabled"] or not await advanced_enabled(db, org_id)):
        raise _not_found()
    uuids = await granting_uuids(db, await _ancestors_and_self(db, group))
    info = await describe_resources(db, org_id, uuids)
    content = [{"resource_uuid": u, **info[u]} for u in uuids if u in info]
    directory = None
    if settings["space_show_members"] or staff:
        ids = sorted(await member_ids(db, group.id))[:500]
        people = await users_by_id(db, ids)
        directory = [user_brief(people[i]) for i in ids if i in people]
        directory.sort(key=lambda p: (p.get("first_name") or p["username"] or "").lower())
    mgr_rows = (await db.execute(select(UserGroupManager).where(UserGroupManager.usergroup_id == group.id))).scalars().all()
    mgr_people = await users_by_id(db, [m.user_id for m in mgr_rows])
    return {
        "group": {"id": group.id, "usergroup_uuid": group.usergroup_uuid, "name": group.name,
                  "description": group.description, "color": group.color, "space_enabled": settings["space_enabled"]},
        "is_member": member, "capabilities": caps, "preview": staff and not member,
        "announcements": await list_announcements_for(db, group),
        "content": content, "members": directory, "member_count": len(await member_ids(db, group.id)),
        "managers": [user_brief(mgr_people[m.user_id]) for m in mgr_rows if m.user_id in mgr_people],
    }


class AnnouncementBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field("", max_length=10000)
    pinned: bool = False
    # Also email it to the members (newsletter individual-email path, EE).
    email: bool = False


async def post_announcement(request: Request, db: AsyncSession, user: Any, group_id: int, body: AnnouncementBody) -> dict:
    group = await load_group(db, group_id)
    role = await require_group_access(request, db, user, group, "post")
    await require_advanced(db, group.org_id, "Group messaging")
    a = UserGroupAnnouncement(announcement_uuid=f"groupannouncement_{uuid4()}", usergroup_id=group.id, org_id=group.org_id,
                              author_id=actor_id(user), title=body.title.strip(), body=body.body.strip(), pinned=body.pinned)
    db.add(a)
    record(db, request, group, "announcement_posted", user, details={"title": a.title[:120]})
    await db.commit()
    await db.refresh(a)
    ids = await member_ids(db, group.id)
    try:
        from src.services.notifications.notifications import NotificationInput, notify

        await notify(db, [NotificationInput(
            user_id=uid, org_id=group.org_id, type="group_announcement", title=group.name, body=a.title,
            data={"usergroup_uuid": group.usergroup_uuid, "path": f"/groups/{group.usergroup_uuid.removeprefix('usergroup_')}",
                  "params": {"group": group.name}},
            dedupe_key=f"group_announcement:{a.id}",
        ) for uid in sorted(ids)[:5000] if uid != actor_id(user)])
    except Exception:  # pragma: no cover - notify never raises
        pass
    emailed: Optional[dict] = None
    if body.email:
        emailed = await email_group(request, db, user, group, a.title, a.body, role=role)
        a.emailed = int(emailed.get("queued") or 0)
        db.add(a)
        await db.commit()
    people = await users_by_id(db, [a.author_id])
    return {**announcement_dict(a, people), "email": emailed}


async def delete_announcement(request: Request, db: AsyncSession, user: Any, group_id: int, announcement_uuid: str) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "post")
    a = (await db.execute(select(UserGroupAnnouncement).where(
        UserGroupAnnouncement.usergroup_id == group.id, UserGroupAnnouncement.announcement_uuid == announcement_uuid
    ))).scalars().first()
    if a is None:
        raise HTTPException(status_code=404, detail="Announcement not found")
    await db.delete(a)
    record(db, request, group, "announcement_deleted", user, details={"title": a.title[:120]})
    await db.commit()
    return {"ok": True}


async def list_announcements(request: Request, db: AsyncSession, user: Any, group_id: int) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "view")
    return {"items": await list_announcements_for(db, group)}


async def email_group(request: Request, db: AsyncSession, user: Any, group: UserGroup, subject: str, text: str,
                      *, role: str = "admin") -> dict:
    """Queue an email to every member through the newsletter (EE). Managers
    who are not admins can post but not email."""
    from src.core.ee_hooks import send_ee_usergroup_email

    if role != "admin":
        raise HTTPException(status_code=403, detail="Only admins who can send newsletters can email a group")
    ids = sorted(await member_ids(db, group.id))
    if not ids:
        return {"queued": 0, "skipped": []}
    result = await send_ee_usergroup_email(db, group.org_id, user, ids, subject, text)
    if result is None:
        raise HTTPException(status_code=501, detail="Emailing a group needs the newsletter (Enterprise)")
    record(db, request, group, "group_emailed", user, details={"subject": subject[:120], "queued": result.get("queued", 0)})
    await db.commit()
    return result


class MessageBody(BaseModel):
    subject: str = Field(..., min_length=1, max_length=300)
    body: str = Field("", max_length=20000)


async def message_group(request: Request, db: AsyncSession, user: Any, group_id: int, body: MessageBody) -> dict:
    group = await load_group(db, group_id)
    role = await require_group_access(request, db, user, group, "post")
    await require_advanced(db, group.org_id, "Group messaging")
    return await email_group(request, db, user, group, body.subject.strip(), body.body.strip(), role=role)


async def send_digest(request: Request, db: AsyncSession, user: Any, group_id: int) -> dict:
    """Email this group's progress digest to its managers who opted in (EE)."""
    from src.core.ee_hooks import send_ee_usergroup_digest

    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "progress")
    await require_advanced(db, group.org_id, "Manager digests")
    result = await send_ee_usergroup_digest(db, group)
    if result is None:
        raise HTTPException(status_code=501, detail="Manager digests need the Enterprise edition")
    record(db, request, group, "digest_sent", user, details={"sent": result.get("sent", 0)})
    await db.commit()
    return result
