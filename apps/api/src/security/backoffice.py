import contextvars
import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.users import User

logger = logging.getLogger(__name__)

#: Machine-readable body for "this surface is Enterprise Edition only".
#: The web client matches this exact shape (403 + detail.error === 'ee_required')
#: in apps/web/components/Admin/EELicenseError.tsx::isEERequiredError.
#:
#: Deliberately not the 503 'ee_license_inactive' shape: that one means EE is
#: installed but its license check is failing, which is transient and worth a
#: retry. This one means the feature does not exist on this deployment.
EE_BACKOFFICE_REQUIRED_DETAIL = {
    "error": "ee_required",
    "feature": "backoffice",
    "message": "Enterprise Edition license required.",
}


def ensure_ee_backoffice_surface() -> None:
    """Block the backoffice surface on OSS deployments.

    Denies only when the mode is definitively 'oss'. Both 'saas' and 'ee' pass
    through untouched. Never invert this to ``!= 'ee'``, which would 403 the
    live SaaS deployment.

    The import is lazy so the mode is resolved per request rather than frozen
    when the dependency is constructed, and to stay clear of the
    rbac -> backoffice -> auth -> users -> rbac import cycle this module
    already works around.
    """
    from src.core.deployment_mode import get_deployment_mode

    if get_deployment_mode() == 'oss':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=dict(EE_BACKOFFICE_REQUIRED_DETAIL),
        )


# The backoffice staff member's own browser session used to pass every org gate: the old
# "enter any org" path. Staff now get org access only through an impersonation
# (src.security.impersonation, started from the console or the "not a member"
# interstitial), which is bounded, attributed and audited. On every request of
# a backoffice staff member's own session outside the platform console, get_current_user
# switches their backoffice status off (block_backoffice_org_bypass), so every
# backoffice shortcut in core and EE code (RBAC, membership gates, feature
# checks) falls back to what their real memberships grant. The console's own
# routes, backoffice API tokens and background jobs are untouched.
_org_bypass_blocked_for: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
    "lh_backoffice_org_bypass_blocked", default=None
)

#: The platform console: the only paths where a backoffice session is one.
BACKOFFICE_CONSOLE_PREFIX = "/api/v1/ee/backoffice"
#: Deprecated alias EE still mounts the console under, so web, mobile and
#: desktop builds from before the Backoffice rename keep working. Remove with
#: the alias in ee/hooks.py.
LEGACY_BACKOFFICE_CONSOLE_PREFIX = "/api/v1/ee/superadmin"
BACKOFFICE_CONSOLE_PREFIXES = (BACKOFFICE_CONSOLE_PREFIX, LEGACY_BACKOFFICE_CONSOLE_PREFIX)


def is_backoffice_console_path(path: str) -> bool:
    return any(path == prefix or path.startswith(prefix + "/") for prefix in BACKOFFICE_CONSOLE_PREFIXES)


def block_backoffice_org_bypass(user_id: int, path: str) -> None:
    """Treat this backoffice session request as an ordinary user's, unless it
    is a platform console request."""
    if is_backoffice_console_path(path):
        return
    _org_bypass_blocked_for.set(user_id)


def backoffice_org_bypass_blocked(user_id: Optional[int]) -> bool:
    return user_id is not None and _org_bypass_blocked_for.get() == user_id


async def is_user_backoffice_staff(user_id: int, db_session: AsyncSession) -> bool:
    """Check if a user is a backoffice staff member by querying the database directly.

    False for the backoffice staff member whose own session is making a non-console request
    (see block_backoffice_org_bypass): outside the console they are a user.
    """
    if backoffice_org_bypass_blocked(user_id):
        return False
    _cache = getattr(db_session, '_backoffice_cache', None)
    if _cache is None:
        db_session._backoffice_cache = {}
        _cache = db_session._backoffice_cache
    if user_id in _cache:
        return _cache[user_id]
    result = (await db_session.execute(select(User.is_backoffice_staff).where(User.id == user_id))).scalars().first()
    value = bool(result)
    _cache[user_id] = value
    return value


async def _get_current_user_lazy(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    """Lazy wrapper to avoid circular import (rbac -> backoffice -> auth -> users -> rbac)."""
    from src.security.auth import get_current_user
    return await get_current_user(request, db_session)


async def require_backoffice(
    current_user=Depends(_get_current_user_lazy),
    db_session: AsyncSession = Depends(get_db_session),
):
    """FastAPI dependency that requires the current user to be a backoffice staff member.

    Accepts:
      - regular ``PublicUser``: checks ``User.is_backoffice_staff``
      - ``BackofficeAPITokenUser``: re-checks the minting user is STILL a
        backoffice (so demoting a user invalidates all of their tokens
        without a separate revocation step)

    Rejects:
      - ``AnonymousUser`` (401)
      - ``APITokenUser`` (org-scoped token; 403, since org tokens are never backoffice staff)
    """
    from src.db.users import AnonymousUser, APITokenUser, BackofficeAPITokenUser

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    # Defense in depth. The EE backoffice routers are already mounted behind
    # their own OSS check, so on those routes this never fires. It is here so
    # that any core route which adopts require_backoffice later inherits the
    # gate instead of quietly shipping a backoffice surface to OSS.
    # Ordered after the 401 so anonymous callers still get 401, and before the
    # principal-type branches so OSS never reveals which principals would pass.
    ensure_ee_backoffice_surface()

    # Org-scoped API tokens are never backoffice staff, regardless of who minted them.
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Backoffice access required",
        )

    if isinstance(current_user, BackofficeAPITokenUser):
        # Re-check the minting user still has is_backoffice_staff=True. If they've
        # been demoted, the token loses effect immediately, no separate
        # revocation needed.
        if not await is_user_backoffice_staff(current_user.created_by_user_id, db_session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token creator is no longer a backoffice staff member",
            )
        return current_user

    if not await is_user_backoffice_staff(current_user.id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Backoffice access required",
        )

    return current_user
