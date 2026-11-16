"""Lock-based access checks for chapters and activities.

Mirrors the Playground access-type pattern but keyed on chapter_uuid /
activity_uuid in ``usergroupresource``. Lock tiers:

- ``public``:        anyone, including anonymous, can read
- ``authenticated``: must be signed in
- ``restricted``:    must be in an assigned usergroup (or an org admin)

Batch helpers are provided for TOC-style reads where many resources need
to be checked at once without N+1 queries.
"""

from typing import Iterable

from sqlalchemy import and_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.session_memo import session_memo
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import resolve_acting_user_id
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS


async def is_org_admin(user_id: int, org_id: int, db_session: AsyncSession) -> bool:
    """True if user is admin/maintainer on this org (bypasses all locks)."""
    from src.security.org_auth import get_user_org

    uo = await get_user_org(user_id, org_id, db_session)
    return bool(uo and uo.role_id in ADMIN_OR_MAINTAINER_ROLE_IDS)


async def batch_accessible_restricted_uuids(
    user_id: int,
    resource_uuids: Iterable[str],
    db_session: AsyncSession,
) -> set[str]:
    """Return the subset of resource_uuids the user can access via usergroup.

    Reading a chapter's activities asks this once per activity, mostly about
    the same course and chapter, and the paywall asks it about the course.
    Answers are kept in the session memo, which is dropped on any write, so a
    membership added during the request still counts.
    """
    uuids = list(dict.fromkeys(u for u in resource_uuids if u))
    if not uuids:
        return set()

    memo = session_memo(db_session)
    known = {} if memo is None else {
        u: memo[("usergroup_access", user_id, u)]
        for u in uuids if ("usergroup_access", user_id, u) in memo
    }
    accessible = {u for u, granted in known.items() if granted}
    pending = [u for u in uuids if u not in known]
    if not pending:
        return accessible

    # Every usergroup linked to the resources, with the user's membership of
    # it when there is one: linked-and-member means accessible.
    rows = (await db_session.execute(
        select(UserGroupResource.resource_uuid, UserGroupUser.id)
        .outerjoin(
            UserGroupUser,
            and_(
                UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,  # type: ignore[arg-type]
                UserGroupUser.user_id == user_id,  # type: ignore[arg-type]
            ),
        )
        .where(UserGroupResource.resource_uuid.in_(pending))  # type: ignore[attr-defined]
    )).all()
    granted = {resource_uuid for resource_uuid, membership_id in rows if membership_id is not None}
    if memo is not None:
        for resource_uuid in pending:
            memo[("usergroup_access", user_id, resource_uuid)] = resource_uuid in granted
    return accessible | granted


async def is_locked_for_user(
    lock_type: str | None,
    resource_uuid: str,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
    *,
    accessible_restricted_uuids: set[str] | None = None,
    is_admin: bool | None = None,
) -> bool:
    """True if the resource should be hidden from current_user.

    ``accessible_restricted_uuids`` and ``is_admin`` are pre-computed escape
    hatches for batch callers -- they avoid repeating the same queries for
    every row. When absent, this function resolves them on its own.
    """
    lt = (lock_type or "public").lower()
    if lt == "public":
        return False

    is_anon = isinstance(current_user, AnonymousUser)
    if lt == "authenticated":
        return is_anon

    if lt != "restricted":
        # Unknown value -- fail safe (treat as public to avoid accidentally
        # locking people out after a rename/migration mishap).
        return False

    if is_anon:
        return True

    acting_user_id = resolve_acting_user_id(current_user)
    admin = is_admin if is_admin is not None else await is_org_admin(acting_user_id, org_id, db_session)
    if admin:
        return False

    if accessible_restricted_uuids is not None:
        return resource_uuid not in accessible_restricted_uuids

    accessible = await batch_accessible_restricted_uuids(
        acting_user_id, [resource_uuid], db_session
    )
    return resource_uuid not in accessible
