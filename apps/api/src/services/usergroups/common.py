"""Shared pieces of the user group features: loading groups, settings,
permissions (org admins and group managers), plan gates and history.

Permissions
-----------
Org admins (the ``usergroups`` rights of their role) can do everything on
every group of their org. A group manager (``usergroup_manager``) can, on
their own group and its sub-groups only, do what their row allows: manage
members, view progress, post announcements. Managers never reach org
settings, other groups, rules, access links or managers.

Plans
-----
Basic groups (manual members, access with dates, membership expiry, join
codes, CSV import, bulk tools, progress, history) follow the existing
``usergroups`` gate (Standard). Smart rules, nesting, managers, the group
space and messaging are ``usergroups_advanced`` (Pro). OSS and EE installs
are not plan-gated (``check_org_plan`` bypasses them).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Literal, Optional

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import audit_event
from src.db.usergroup_extras import UserGroupEvent, UserGroupManager
from src.db.usergroups import UserGroup
from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS
from src.db.users import AnonymousUser, APITokenUser, InternalUser, SuperadminAPITokenUser

ADVANCED_PLAN = FEATURE_PLAN_REQUIREMENTS["usergroups_advanced"]

DEFAULT_SETTINGS: dict[str, Any] = {
    # The group page members can open from their profile menu.
    "space_enabled": False,
    # Show the member list on the space (names and avatars only).
    "space_show_members": True,
    # Inbox notification when someone is added / when their membership ends.
    "notify_on_join": True,
    "notify_on_leave": True,
    # Members whose email domain is listed join automatically.
    "auto_join_domains": [],
}

Capability = Literal["view", "members", "progress", "post", "admin"]
_MANAGER_FLAG = {"members": "can_manage_members", "progress": "can_view_progress", "post": "can_post"}
MAX_DEPTH = 5


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands back naive datetimes; treat them as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    dt = aware(dt)
    return dt.isoformat() if dt else None


def parse_when(value: Any, field: str = "date") -> Optional[datetime]:
    """An ISO date or datetime from a request body, as an aware datetime."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return aware(value)
    try:
        text = str(value).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be an ISO date (YYYY-MM-DD or a full timestamp)")
    return aware(dt)


def group_settings(group: UserGroup) -> dict[str, Any]:
    raw = group.settings if isinstance(group.settings, dict) else {}
    out = dict(DEFAULT_SETTINGS)
    out.update({k: v for k, v in raw.items() if k in DEFAULT_SETTINGS})
    domains = out.get("auto_join_domains")
    out["auto_join_domains"] = [d for d in domains if isinstance(d, str)] if isinstance(domains, list) else []
    return out


_NOT_PEOPLE = (APITokenUser, SuperadminAPITokenUser, InternalUser, AnonymousUser)


def person_id(user: Any) -> Optional[int]:
    """The user id of a signed-in person, or None for API tokens (whose
    ``id`` is the token's, not a person's), internal and anonymous callers.
    Person-scoped lookups (my groups, groups I manage, my space, redeeming a
    code) must go through this, never ``user.id``."""
    if user is None or isinstance(user, _NOT_PEOPLE):
        return None
    uid = getattr(user, "id", None)
    return uid if isinstance(uid, int) and uid > 0 else None


def require_person(user: Any) -> int:
    """403 for API tokens, 401 for anonymous callers; else the person's id."""
    if isinstance(user, (APITokenUser, SuperadminAPITokenUser, InternalUser)):
        raise HTTPException(status_code=403, detail="This endpoint is for people, not API tokens")
    uid = person_id(user)
    if uid is None:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return uid


def actor_id(user: Any) -> Optional[int]:
    if isinstance(user, APITokenUser):
        return getattr(user, "created_by_user_id", None)
    uid = getattr(user, "id", None)
    return uid if isinstance(uid, int) and uid > 0 else None


async def load_group(db: AsyncSession, group_id: int) -> UserGroup:
    group = await db.get(UserGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="UserGroup not found")
    return group


async def load_group_by_uuid(db: AsyncSession, org_id: int, usergroup_uuid: str) -> UserGroup:
    group = (await db.execute(
        select(UserGroup).where(UserGroup.usergroup_uuid == usergroup_uuid, UserGroup.org_id == org_id)
    )).scalars().first()
    if group is None:
        raise HTTPException(status_code=404, detail="UserGroup not found")
    return group


async def org_groups(db: AsyncSession, org_id: int) -> list[UserGroup]:
    return list((await db.execute(
        select(UserGroup).where(UserGroup.org_id == org_id).order_by(UserGroup.name)
    )).scalars().all())


# ── plans ───────────────────────────────────────────────────────────────


async def advanced_enabled(db: AsyncSession, org_id: int) -> bool:
    from src.security.features_utils.plan_check import check_org_plan

    try:
        return bool(await check_org_plan(org_id, ADVANCED_PLAN, "Advanced user groups", db))
    except HTTPException:
        return False


async def require_advanced(db: AsyncSession, org_id: int, feature: str) -> None:
    from src.security.features_utils.plan_check import check_org_plan

    await check_org_plan(org_id, ADVANCED_PLAN, feature, db)


# ── permissions ─────────────────────────────────────────────────────────


def _admin_action(user: Any, action: str) -> str:
    """Every member role holds usergroups read (the catalog filters by
    group), so for people a management view takes the update right. API
    tokens keep their explicit read grant."""
    return "update" if action == "read" and not isinstance(user, APITokenUser) else action


async def is_org_admin(request: Optional[Request], db: AsyncSession, user: Any, org_id: int,
                       action: Literal["create", "read", "update", "delete"] = "update") -> bool:
    from src.services.users.usergroups import rbac_check

    if isinstance(user, InternalUser):
        return True
    # A token is bound to one org: refuse any other before looking anything up.
    if isinstance(user, APITokenUser) and user.org_id != org_id:
        return False
    try:
        await rbac_check(request, usergroup_uuid="usergroup_X", current_user=user, action=_admin_action(user, action),  # type: ignore[arg-type]
                         db_session=db, org_id=org_id)
    except HTTPException:
        return False
    return True


async def require_org_admin(request: Optional[Request], db: AsyncSession, user: Any, org_id: int,
                            action: Literal["create", "read", "update", "delete"] = "update") -> None:
    from src.services.users.usergroups import rbac_check

    if isinstance(user, APITokenUser) and user.org_id != org_id:
        raise HTTPException(status_code=403, detail="API token cannot access resources outside its organization")
    if isinstance(user, InternalUser):
        return
    await rbac_check(request, usergroup_uuid="usergroup_X", current_user=user, action=_admin_action(user, action),  # type: ignore[arg-type]
                     db_session=db, org_id=org_id)


async def ancestor_ids(db: AsyncSession, group: UserGroup) -> list[int]:
    """Parents of a group, nearest first (bounded, loop-safe)."""
    out: list[int] = []
    seen = {group.id}
    parent_id = group.parent_id
    while parent_id and parent_id not in seen and len(out) < MAX_DEPTH * 2:
        out.append(parent_id)
        seen.add(parent_id)
        parent = await db.get(UserGroup, parent_id)
        if parent is None or parent.org_id != group.org_id:
            break
        parent_id = parent.parent_id
    return out


async def manager_rows(db: AsyncSession, user_id: int, org_id: int) -> list[UserGroupManager]:
    return list((await db.execute(
        select(UserGroupManager).where(UserGroupManager.user_id == user_id, UserGroupManager.org_id == org_id)
    )).scalars().all())


async def managed_group_ids(db: AsyncSession, user_id: int, org_id: int, capability: Capability = "view") -> set[int]:
    """Groups a person manages (directly or as manager of an ancestor)."""
    rows = await manager_rows(db, user_id, org_id)
    flag = _MANAGER_FLAG.get(capability)
    roots = {r.usergroup_id for r in rows if flag is None or getattr(r, flag)}
    if not roots:
        return set()
    groups = await org_groups(db, org_id)
    children: dict[int, list[int]] = {}
    for g in groups:
        if g.parent_id:
            children.setdefault(g.parent_id, []).append(g.id)  # type: ignore[arg-type]
    out, stack = set(), list(roots)
    while stack:
        gid = stack.pop()
        if gid in out:
            continue
        out.add(gid)
        stack.extend(children.get(gid, []))
    return out


async def manager_can(db: AsyncSession, user: Any, group: UserGroup, capability: Capability) -> bool:
    uid = person_id(user)
    if capability == "admin" or uid is None:
        return False
    if not await advanced_enabled(db, group.org_id):
        return False
    from src.db.user_organizations import UserOrganization

    member = (await db.execute(select(UserOrganization.id).where(
        UserOrganization.user_id == uid, UserOrganization.org_id == group.org_id
    ))).first()
    if member is None:
        return False
    return group.id in await managed_group_ids(db, uid, group.org_id, capability)


async def require_group_access(request: Optional[Request], db: AsyncSession, user: Any, group: UserGroup,
                               capability: Capability) -> Literal["admin", "manager"]:
    """Admins pass for everything; managers for what their row allows on
    their own groups. Raises 403 otherwise (404-free: the group id is not a
    secret, but its contents are)."""
    action = "read" if capability == "view" and isinstance(user, APITokenUser) else "update"
    if await is_org_admin(request, db, user, group.org_id, action):
        return "admin"
    if await manager_can(db, user, group, capability):
        return "manager"
    raise HTTPException(status_code=403, detail="You don't have permission to manage this group")


async def capabilities_for(request: Optional[Request], db: AsyncSession, user: Any, group: UserGroup) -> dict:
    admin = await is_org_admin(request, db, user, group.org_id, "update")
    if admin:
        return {"role": "admin", "members": True, "progress": True, "post": True, "admin": True}
    caps = {c: await manager_can(db, user, group, c) for c in ("members", "progress", "post")}  # type: ignore[arg-type]
    return {"role": "manager" if any(caps.values()) else "none", **caps, "admin": False}


# ── history ─────────────────────────────────────────────────────────────


def record(
    db: AsyncSession,
    request: Optional[Request],
    group: UserGroup,
    action: str,
    actor: Any = None,
    *,
    via: str = "",
    details: Optional[dict] = None,
) -> None:
    """Add a history row (committed with the caller's transaction) and send
    the same change to the org audit log (EE, fire-and-forget)."""
    db.add(UserGroupEvent(
        usergroup_id=group.id, org_id=group.org_id, action=action[:48], actor_id=actor_id(actor),
        via=via[:24], details=details or None,
    ))
    audit_event(
        request, action=f"groups.{action}", org_id=group.org_id,
        **({"actor": actor} if actor is not None else {}),
        target_type="usergroup", target_id=group.usergroup_uuid, target_name=group.name,
        details={**(details or {}), **({"via": via} if via else {})} or None,
    )


def clip_ids(ids: Iterable[int], n: int = 100) -> list[int]:
    return list(ids)[:n]
