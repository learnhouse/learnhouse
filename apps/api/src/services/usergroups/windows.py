"""SQL clauses for the time windows on group links and memberships.

Kept free of service imports so the access checks (RBAC, course listings)
can use them without import cycles.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, or_

from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser


def _now(now: Optional[datetime]) -> datetime:
    return now or datetime.now(timezone.utc)


def ugr_granting(now: Optional[datetime] = None):
    """Links whose access window is open (no dates = always open)."""
    now = _now(now)
    return and_(
        or_(UserGroupResource.starts_at.is_(None), UserGroupResource.starts_at <= now),  # type: ignore[union-attr]
        or_(UserGroupResource.expires_at.is_(None), UserGroupResource.expires_at > now),  # type: ignore[union-attr]
    )


def ugu_current(now: Optional[datetime] = None):
    """Memberships that have not expired."""
    now = _now(now)
    return or_(UserGroupUser.expires_at.is_(None), UserGroupUser.expires_at > now)  # type: ignore[union-attr]
