"""
Centralized organization authorization helpers.

All org membership and admin checks go through this module.
Superadmin bypass is baked in — superadmins pass every check automatically.
"""

import logging
from typing import Optional
from fastapi import HTTPException, status
from sqlmodel import Session, select

from src.db.user_organizations import UserOrganization
from src.db.roles import Role
from src.security.superadmin import is_user_superadmin
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS

logger = logging.getLogger(__name__)


def is_org_member(user_id: int, org_id: int, db_session: Session) -> bool:
    """Check if user is a member of the org (or a superadmin)."""
    if is_user_superadmin(user_id, db_session):
        logger.debug("Superadmin bypass: user %s accessed org %s", user_id, org_id)
        return True
    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id,
        UserOrganization.org_id == org_id,
    )
    return db_session.exec(statement).first() is not None


def is_org_admin(user_id: int, org_id: int, db_session: Session) -> bool:
    """Check if user is an admin/maintainer of the org (or a superadmin)."""
    if is_user_superadmin(user_id, db_session):
        logger.debug("Superadmin bypass: user %s accessed org %s", user_id, org_id)
        return True
    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id,
        UserOrganization.org_id == org_id,
        UserOrganization.role_id.in_(ADMIN_OR_MAINTAINER_ROLE_IDS),
    )
    return db_session.exec(statement).first() is not None


def get_user_org(user_id: int, org_id: int, db_session: Session) -> Optional[UserOrganization]:
    """Return the UserOrganization row, or None. Does NOT check superadmin."""
    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id,
        UserOrganization.org_id == org_id,
    )
    return db_session.exec(statement).first()


def get_user_org_role(user_id: int, org_id: int, db_session: Session) -> Optional[Role]:
    """Return the user's Role in the org, or None. Does NOT check superadmin."""
    user_org = get_user_org(user_id, org_id, db_session)
    if not user_org:
        return None
    statement = select(Role).where(Role.id == user_org.role_id)
    return db_session.exec(statement).first()


def require_org_membership(user_id: int, org_id: int, db_session: Session) -> None:
    """Raise 403 if user is not an org member and not a superadmin."""
    if not is_org_member(user_id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )


def require_org_admin(user_id: int, org_id: int, db_session: Session) -> None:
    """Raise 403 if user is not an org admin/maintainer and not a superadmin."""
    if not is_org_admin(user_id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization administrators and maintainers can perform this action",
        )


def require_org_role_permission(
    user_id: int,
    org_id: int,
    db_session: Session,
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
    if is_user_superadmin(user_id, db_session):
        logger.debug("Superadmin bypass: user %s accessed org %s", user_id, org_id)
        return

    user_org = get_user_org(user_id, org_id, db_session)
    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    role = db_session.exec(select(Role).where(Role.id == user_org.role_id)).first()
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
