"""Small helpers every feature uses to raise a notification.

``emit`` writes one row per recipient for a type from the catalog
(src/db/notifications.py). ``emit_admin`` resolves who should hear about an
admin event in an org (its routing: admins, maintainers, the course's
authors) and writes to them. Both never raise and return the rows written.

``params`` goes into ``data["params"]``: the variable parts of the message
(course name, actor name, count…). The web renders a translated sentence
from the type and these params, and falls back to ``title``/``body`` (the
English copy the mobile app and pushes show) when it has no template.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.notifications import (
    ADMIN_ROLE_GROUPS,
    NOTIFICATION_TYPE_META,
    OrgNotificationSetting,
    meta_for,
)
from src.services.notifications.notifications import NotificationInput, now_iso, notify

logger = logging.getLogger(__name__)

MAX_RECIPIENTS = 5000


async def emit(
    db: AsyncSession,
    type_: str,
    user_ids: Iterable[Optional[int]],
    *,
    org_id: Optional[int],
    title: str,
    body: str = "",
    data: Optional[dict] = None,
    params: Optional[dict] = None,
    path: Optional[str] = None,
    image: Optional[str] = None,
    actor_id: Optional[int] = None,
    group_key: Optional[str] = None,
    dedupe_key: Optional[str] = None,
    priority: Optional[str] = None,
    audience: Optional[str] = None,
    expires_at: Optional[str] = None,
    push: bool = True,
    exclude: Iterable[Optional[int]] = (),
    replace_read: bool = False,
) -> list:
    try:
        skip = {u for u in exclude if u}
        if actor_id:
            skip.add(actor_id)
        ids = sorted({u for u in user_ids if u and u not in skip})[:MAX_RECIPIENTS]
        if not ids:
            return []
        payload = dict(data or {})
        if params:
            payload["params"] = {k: v for k, v in params.items() if v is not None}
        if path:
            payload["path"] = path
        return await notify(db, [
            NotificationInput(
                user_id=uid,
                org_id=org_id,
                type=type_,
                title=title,
                body=body,
                data=payload,
                image=image,
                group_key=group_key.format(user_id=uid) if group_key else None,
                dedupe_key=dedupe_key.format(user_id=uid) if dedupe_key else None,
                push=push,
                priority=priority,
                audience=audience,
                actor_id=actor_id,
                expires_at=expires_at,
                replace_read=replace_read,
            )
            for uid in ids
        ])
    except Exception:
        logger.warning("Notification %s failed", type_, exc_info=True)
        return []


# ---------------------------------------------------------------------------
# Admin routing
# ---------------------------------------------------------------------------


def admin_types() -> list[str]:
    """Admin types the org can route. Types without default roles (an Atlas
    agent's run) go to one person and are not routable."""
    return [k for k, m in NOTIFICATION_TYPE_META.items() if m.audience == "admin" and m.default_roles]


async def _setting(db: AsyncSession, org_id: int) -> Optional[OrgNotificationSetting]:
    return (await db.execute(
        select(OrgNotificationSetting).where(OrgNotificationSetting.org_id == org_id)
    )).scalars().first()


def routing_view(setting: Optional[OrgNotificationSetting]) -> dict:
    saved = (setting.admin_routing if setting else None) or {}
    out = {}
    for type_ in admin_types():
        meta = meta_for(type_)
        roles = saved.get(type_)
        if not isinstance(roles, list):
            roles = list(meta.default_roles)
        out[type_] = {
            "category": meta.category,
            "priority": meta.priority,
            "roles": [r for r in roles if r in ADMIN_ROLE_GROUPS],
            "default_roles": list(meta.default_roles),
        }
    return out


async def get_org_routing(db: AsyncSession, org_id: int) -> dict:
    return {"org_id": org_id, "role_groups": list(ADMIN_ROLE_GROUPS), "types": routing_view(await _setting(db, org_id))}


async def update_org_routing(db: AsyncSession, org_id: int, routing: dict[str, list[str]]) -> dict:
    known = set(admin_types())
    unknown = set(routing) - known
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown admin notification types: {', '.join(sorted(unknown))}")
    for type_, roles in routing.items():
        bad = set(roles) - set(ADMIN_ROLE_GROUPS)
        if bad:
            raise HTTPException(status_code=400, detail=f"Unknown roles: {', '.join(sorted(bad))}")
    setting = await _setting(db, org_id)
    if setting is None:
        setting = OrgNotificationSetting(org_id=org_id, admin_routing={})
    setting.admin_routing = {**(setting.admin_routing or {}), **{k: sorted(set(v)) for k, v in routing.items()}}
    setting.update_date = now_iso()
    db.add(setting)
    await db.commit()
    await db.refresh(setting)
    return await get_org_routing(db, org_id)


async def _role_members(db: AsyncSession, org_id: int, role_ids: set[int]) -> set[int]:
    from src.db.user_organizations import UserOrganization

    if not role_ids:
        return set()
    rows = (await db.execute(
        select(UserOrganization.user_id).where(
            UserOrganization.org_id == org_id,
            UserOrganization.role_id.in_(role_ids),  # type: ignore[attr-defined]
        )
    )).scalars().all()
    return set(rows)


async def course_author_ids(db: AsyncSession, course_uuid: Optional[str]) -> set[int]:
    if not course_uuid:
        return set()
    from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum

    rows = (await db.execute(
        select(ResourceAuthor.user_id).where(
            ResourceAuthor.resource_uuid == course_uuid,
            ResourceAuthor.authorship.in_([  # type: ignore[attr-defined]
                ResourceAuthorshipEnum.CREATOR,
                ResourceAuthorshipEnum.MAINTAINER,
                ResourceAuthorshipEnum.CONTRIBUTOR,
            ]),
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
        )
    )).scalars().all()
    return set(rows)


async def admin_recipients(db: AsyncSession, org_id: int, type_: str, *, course_uuid: Optional[str] = None) -> list[int]:
    """Who hears about this admin event in this org, per its routing. A course
    event routed to course authors falls back to the org admins when the
    course has none."""
    from src.security.rbac.constants import ADMIN_ROLE_ID, MAINTAINER_ROLE_ID

    roles = routing_view(await _setting(db, org_id)).get(type_, {}).get("roles")
    if roles is None:
        roles = list(meta_for(type_).default_roles) or ["admins"]
    role_ids = set()
    if "admins" in roles:
        role_ids.add(ADMIN_ROLE_ID)
    if "maintainers" in roles:
        role_ids.add(MAINTAINER_ROLE_ID)
    ids = await _role_members(db, org_id, role_ids)
    if "course_authors" in roles:
        authors = await course_author_ids(db, course_uuid)
        if authors:
            # Authors who left the org no longer hear about it.
            ids |= authors & await _org_members(db, org_id, authors)
        elif not ids:
            ids = await _role_members(db, org_id, {ADMIN_ROLE_ID})
    return sorted(ids)


async def _org_members(db: AsyncSession, org_id: int, user_ids: set[int]) -> set[int]:
    from src.db.user_organizations import UserOrganization

    rows = (await db.execute(
        select(UserOrganization.user_id).where(
            UserOrganization.org_id == org_id,
            UserOrganization.user_id.in_(user_ids),  # type: ignore[attr-defined]
        )
    )).scalars().all()
    return set(rows)


async def emit_admin(
    db: AsyncSession,
    type_: str,
    *,
    org_id: int,
    title: str,
    course_uuid: Optional[str] = None,
    extra_user_ids: Iterable[int] = (),
    **kwargs: Any,
) -> list:
    """Notify whoever the org routes this admin event to. Never raises."""
    try:
        ids = set(await admin_recipients(db, org_id, type_, course_uuid=course_uuid)) | set(extra_user_ids)
    except Exception:
        logger.warning("Resolving recipients for %s failed", type_, exc_info=True)
        return []
    return await emit(db, type_, ids, org_id=org_id, title=title, audience="admin", **kwargs)
