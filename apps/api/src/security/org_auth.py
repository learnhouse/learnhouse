"""
Centralized organization authorization helpers.

All org membership and admin checks go through this module.
Superadmin bypass is baked in — superadmins pass every check automatically.
"""

import logging
from typing import Optional
from fastapi import HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.user_organizations import UserOrganization
from src.db.roles import Role
from src.security.superadmin import is_user_superadmin
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS

logger = logging.getLogger(__name__)


async def get_user_org(user_id: int, org_id: int, db_session: AsyncSession) -> Optional[UserOrganization]:
    """Return the UserOrganization row, or None. Does NOT check superadmin."""
    _cache = getattr(db_session, '_user_org_cache', None)
    if _cache is None:
        db_session._user_org_cache = {}
        _cache = db_session._user_org_cache
    key = (user_id, org_id)
    if key in _cache:
        return _cache[key]
    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id,
        UserOrganization.org_id == org_id,
    )
    result = (await db_session.execute(statement)).scalars().first()
    # Only cache positive memberships. Caching a None ("not a member") result
    # is unsafe: a membership granted later within the same request/session
    # (e.g. add-to-org immediately followed by an authz check) would otherwise
    # keep returning the stale "not a member" answer and incorrectly deny
    # access. Positive rows are safe to memoize for the request's lifetime.
    if result is not None:
        _cache[key] = result
    return result


async def is_org_member(user_id: int, org_id: int, db_session: AsyncSession) -> bool:
    """Check if user is a member of the org (or a superadmin)."""
    if await is_user_superadmin(user_id, db_session):
        logger.debug("Superadmin bypass: user %s accessed org %s", user_id, org_id)
        return True
    return await get_user_org(user_id, org_id, db_session) is not None


async def is_org_admin(user_id: int, org_id: int, db_session: AsyncSession) -> bool:
    """Check if user is an admin/maintainer of the org (or a superadmin)."""
    if await is_user_superadmin(user_id, db_session):
        logger.debug("Superadmin bypass: user %s accessed org %s", user_id, org_id)
        return True
    user_org = await get_user_org(user_id, org_id, db_session)
    return user_org is not None and user_org.role_id in ADMIN_OR_MAINTAINER_ROLE_IDS


async def get_user_org_role(user_id: int, org_id: int, db_session: AsyncSession) -> Optional[Role]:
    """Return the user's Role in the org, or None. Does NOT check superadmin."""
    user_org = await get_user_org(user_id, org_id, db_session)
    if not user_org:
        return None
    statement = select(Role).where(Role.id == user_org.role_id)
    return (await db_session.execute(statement)).scalars().first()


async def enforce_org_mfa(user_id: int, org_id: int, db_session: AsyncSession) -> None:
    """Apply the org's per-access session policies, if it has any.

    Despite the historical name, this is the single seam through which **all**
    org-level session policies are enforced at a request gate:

    * the "require two-factor" policy (:mod:`src.services.orgs.mfa_policy`), and
    * the auth-method / session-sharing policy
      (:mod:`src.services.orgs.auth_policy`) — which methods may access the org
      and whether a central/foreign session is accepted.

    Every ``require_*`` gate and every additive call site funnels through here,
    so folding both policies in keeps them enforced in lockstep with one edit.
    Kept out of :func:`is_org_member` / :func:`is_org_admin` on purpose: those are
    plain predicates used to *shape* results (search scoping, admin-only fields),
    and raising from inside them would turn a presentation decision into a 403.
    Both policies are no-ops under default config.
    """
    from src.services.orgs.mfa_policy import enforce_org_mfa_policy
    from src.services.orgs.auth_policy import enforce_org_auth_policy

    await enforce_org_mfa_policy(db_session, user_id, org_id)
    await enforce_org_auth_policy(db_session, user_id, org_id)


async def require_org_membership(user_id: int, org_id: int, db_session: AsyncSession) -> None:
    """Raise 403 if user is not an org member and not a superadmin."""
    if not await is_org_member(user_id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )
    await enforce_org_mfa(user_id, org_id, db_session)


async def require_org_admin(user_id: int, org_id: int, db_session: AsyncSession) -> None:
    """Raise 403 if user is not an org admin/maintainer and not a superadmin."""
    if not await is_org_admin(user_id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization administrators and maintainers can perform this action",
        )
    await enforce_org_mfa(user_id, org_id, db_session)


async def require_org_role_permission(
    user_id: int,
    org_id: int,
    db_session: AsyncSession,
    resource: str,
    action: str,
    fallback_role_ids: frozenset = ADMIN_OR_MAINTAINER_ROLE_IDS,
) -> None:
    """
    Check that the user has a specific permission via their org role's rights dict.
    Superadmins bypass entirely.

    Args:
        resource: e.g. 'roles', 'courses'
        action: e.g. 'action_create', 'action_read'
        fallback_role_ids: allowed role IDs when rights dict is absent
    """
    if await is_user_superadmin(user_id, db_session):
        logger.debug("Superadmin bypass: user %s accessed org %s", user_id, org_id)
        return

    user_org = await get_user_org(user_id, org_id, db_session)
    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    role = (await db_session.execute(select(Role).where(Role.id == user_org.role_id))).scalars().first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role in this organization could not be determined",
        )

    if role.rights and isinstance(role.rights, dict):
        resource_rights = role.rights.get(resource, {})
        if not resource_rights.get(action, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You don't have permission to perform this action ({resource}.{action})",
            )
    else:
        if role.id not in fallback_role_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin or Maintainer role required for this action",
            )

    # Applied last, once the role permission itself has passed. Running it
    # earlier would also mean issuing DB queries in the middle of the role
    # lookup, which is both wasteful and surprising.
    await enforce_org_mfa(user_id, org_id, db_session)
