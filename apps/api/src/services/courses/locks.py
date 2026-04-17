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

from sqlmodel import Session, select

from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS


def is_org_admin(user_id: int, org_id: int, db_session: Session) -> bool:
    """True if user is admin/maintainer on this org (bypasses all locks)."""
    uo = db_session.exec(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    ).first()
    return bool(uo and uo.role_id in ADMIN_OR_MAINTAINER_ROLE_IDS)


def batch_accessible_restricted_uuids(
    user_id: int,
    resource_uuids: Iterable[str],
    db_session: Session,
) -> set[str]:
    """Return the subset of resource_uuids the user can access via usergroup."""
    uuids = [u for u in resource_uuids if u]
    if not uuids:
        return set()

    ugrs = db_session.exec(
        select(
            UserGroupResource.resource_uuid,
            UserGroupResource.usergroup_id,
        ).where(UserGroupResource.resource_uuid.in_(uuids))
    ).all()
    if not ugrs:
        return set()

    ug_ids = list({row[1] for row in ugrs})
    member_ug_ids = set(
        db_session.exec(
            select(UserGroupUser.usergroup_id).where(
                UserGroupUser.usergroup_id.in_(ug_ids),
                UserGroupUser.user_id == user_id,
            )
        ).all()
    )
    return {resource_uuid for resource_uuid, ug_id in ugrs if ug_id in member_ug_ids}


def is_locked_for_user(
    lock_type: str | None,
    resource_uuid: str,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
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

    admin = is_admin if is_admin is not None else is_org_admin(current_user.id, org_id, db_session)
    if admin:
        return False

    if accessible_restricted_uuids is not None:
        return resource_uuid not in accessible_restricted_uuids

    accessible = batch_accessible_restricted_uuids(
        current_user.id, [resource_uuid], db_session
    )
    return resource_uuid not in accessible
