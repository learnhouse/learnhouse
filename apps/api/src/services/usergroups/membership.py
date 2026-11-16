"""Membership primitives: who is in a group, and why.

``usergroupuser`` stays the one table every access check reads. A row holds
the reasons the person is in the group (``sources``): added by hand, matched
by the group's rules, inherited from a sub-group, joined with a code, by CSV
import or by email domain. Adding a reason that is already there does
nothing; removing the last reason deletes the row. Everything here is
idempotent, so the background sync can run as often as it likes.

Nesting: a parent group's rows carry ``inherited`` for everyone in any of
its sub-groups, so whatever the parent unlocks reaches them. After a
membership change, :func:`refresh_ancestors` recomputes that up the chain.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Iterable, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.usergroups.common import ancestor_ids, aware, group_settings, utcnow

logger = logging.getLogger(__name__)

# Reasons a person removes when they are taken out of a group by hand, or
# when their membership expires. Rules and sub-groups keep their own.
DIRECT_SOURCES = ("manual", "code", "import", "domain")


def sources_of(row: UserGroupUser) -> list[str]:
    raw = row.sources
    if not isinstance(raw, list) or not raw:
        return ["manual"]
    return [s for s in raw if isinstance(s, str)] or ["manual"]


async def org_member_ids(db: AsyncSession, org_id: int) -> set[int]:
    return set((await db.execute(
        select(UserOrganization.user_id).where(UserOrganization.org_id == org_id)
    )).scalars().all())


async def rows_for(db: AsyncSession, group_id: int) -> dict[int, UserGroupUser]:
    """{user_id: row}. Duplicate legacy rows keep the first one."""
    out: dict[int, UserGroupUser] = {}
    for row in (await db.execute(
        select(UserGroupUser).where(UserGroupUser.usergroup_id == group_id).order_by(UserGroupUser.id)
    )).scalars().all():
        out.setdefault(row.user_id, row)
    return out


async def member_ids(db: AsyncSession, group_id: int) -> set[int]:
    return set((await db.execute(
        select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == group_id)
    )).scalars().all())


def _stamp() -> str:
    return str(datetime.now())


async def add_source(
    db: AsyncSession,
    group: UserGroup,
    user_id: int,
    source: str,
    *,
    expires_at: Optional[datetime] = None,
    actor_id: Optional[int] = None,
    row: Optional[UserGroupUser] = None,
    lookup: bool = True,
) -> str:
    """Give ``user_id`` the reason ``source`` to be in ``group``. Returns
    ``added`` (new row), ``source_added`` or ``unchanged``. Does not commit."""
    if row is None and lookup:
        row = (await db.execute(
            select(UserGroupUser).where(UserGroupUser.usergroup_id == group.id, UserGroupUser.user_id == user_id)
            .order_by(UserGroupUser.id)
        )).scalars().first()
    if row is None:
        db.add(UserGroupUser(
            usergroup_id=group.id, user_id=user_id, org_id=group.org_id,
            creation_date=_stamp(), update_date=_stamp(), sources=[source],
            expires_at=expires_at, added_by_id=actor_id,
        ))
        return "added"
    current = sources_of(row)
    changed = False
    if source not in current:
        row.sources = [*current, source]
        changed = True
    elif row.sources is None:
        row.sources = current
    if source in DIRECT_SOURCES and expires_at is not None and aware(row.expires_at) != expires_at:
        row.expires_at = expires_at
        changed = True
    if changed:
        row.update_date = _stamp()
        db.add(row)
        return "source_added"
    return "unchanged"


async def remove_sources(
    db: AsyncSession,
    group: UserGroup,
    user_id: int,
    sources: Iterable[str],
    *,
    row: Optional[UserGroupUser] = None,
    lookup: bool = True,
) -> str:
    """Drop reasons; delete the row when none is left. Returns ``removed``
    (row deleted), ``kept`` (other reasons hold it) or ``absent``."""
    drop = set(sources)
    if row is None and lookup:
        row = (await db.execute(
            select(UserGroupUser).where(UserGroupUser.usergroup_id == group.id, UserGroupUser.user_id == user_id)
            .order_by(UserGroupUser.id)
        )).scalars().first()
    if row is None:
        return "absent"
    current = sources_of(row)
    left = [s for s in current if s not in drop]
    if not left:
        await db.delete(row)
        return "removed"
    if left != current:
        row.sources = left
        if not set(left) & set(DIRECT_SOURCES):
            row.expires_at = None
        row.update_date = _stamp()
        db.add(row)
    return "kept"


async def child_ids(db: AsyncSession, group: UserGroup) -> list[int]:
    return list((await db.execute(
        select(UserGroup.id).where(UserGroup.parent_id == group.id, UserGroup.org_id == group.org_id)
    )).scalars().all())


async def recompute_inherited(db: AsyncSession, group: UserGroup) -> tuple[set[int], set[int]]:
    """Make ``inherited`` match the members of the group's sub-groups.
    Returns (added, removed) user ids. Does not commit."""
    children = await child_ids(db, group)
    desired: set[int] = set()
    if children:
        desired = set((await db.execute(
            select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id.in_(children))  # type: ignore[attr-defined]
        )).scalars().all())
    rows = await rows_for(db, group.id)
    added: set[int] = set()
    removed: set[int] = set()
    for uid in desired:
        result = await add_source(db, group, uid, "inherited", row=rows.get(uid), lookup=False)
        if result == "added":
            added.add(uid)
    for uid, row in rows.items():
        if uid not in desired and "inherited" in sources_of(row):
            if await remove_sources(db, group, uid, ["inherited"], row=row, lookup=False) == "removed":
                removed.add(uid)
    return added, removed


async def refresh_ancestors(db: AsyncSession, group: UserGroup) -> None:
    """Recompute inherited membership for every parent, nearest first, and
    commit."""
    for parent_id in await ancestor_ids(db, group):
        parent = await db.get(UserGroup, parent_id)
        if parent is None:
            break
        await db.flush()
        await recompute_inherited(db, parent)
    await db.commit()


# ── notifications ───────────────────────────────────────────────────────


async def notify_members(db: AsyncSession, group: UserGroup, user_ids: Iterable[int], kind: str) -> int:
    """Inbox (and push) notification for people added to / removed from a
    group, when the group's settings ask for it. Never raises."""
    ids = sorted(set(user_ids))
    if not ids:
        return 0
    settings = group_settings(group)
    if kind == "joined" and not settings["notify_on_join"]:
        return 0
    if kind == "left" and not settings["notify_on_leave"]:
        return 0
    try:
        from src.services.notifications.notifications import NotificationInput, notify

        title = group.name
        body = "You were added to this group" if kind == "joined" else "Your membership in this group has ended"
        stamp = utcnow().strftime("%Y%m%d%H")
        await notify(db, [
            NotificationInput(
                user_id=uid, org_id=group.org_id, type=f"group_{kind}", title=title, body=body,
                data={"usergroup_uuid": group.usergroup_uuid, "path": f"/groups/{group.usergroup_uuid.removeprefix('usergroup_')}",
                      "params": {"group": group.name}},
                dedupe_key=f"group_{kind}:{group.id}:{stamp}",
            )
            for uid in ids[:2000]
        ])
        return len(ids)
    except Exception:  # pragma: no cover - notify never raises; belt and braces
        logger.warning("Group notification failed for group %s", group.id, exc_info=True)
        return 0


def describe(row: UserGroupUser) -> dict[str, Any]:
    from src.services.usergroups.common import iso

    return {
        "sources": sources_of(row),
        "expires_at": iso(row.expires_at),
        "joined_at": row.creation_date or None,
        "added_by_id": row.added_by_id,
    }
