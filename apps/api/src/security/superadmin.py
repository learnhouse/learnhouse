import logging
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
EE_SUPERADMIN_REQUIRED_DETAIL = {
    "error": "ee_required",
    "feature": "superadmin",
    "message": "Enterprise Edition license required.",
}


def ensure_ee_superadmin_surface() -> None:
    """Block the superadmin surface on OSS deployments.

    Denies only when the mode is definitively 'oss'. Both 'saas' and 'ee' pass
    through untouched — never invert this to ``!= 'ee'``, which would 403 the
    live SaaS deployment.

    The import is lazy so the mode is resolved per request rather than frozen
    when the dependency is constructed, and to stay clear of the
    rbac -> superadmin -> auth -> users -> rbac import cycle this module
    already works around.
    """
    from src.core.deployment_mode import get_deployment_mode

    if get_deployment_mode() == 'oss':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=dict(EE_SUPERADMIN_REQUIRED_DETAIL),
        )


async def is_user_superadmin(user_id: int, db_session: AsyncSession) -> bool:
    """Check if a user is a superadmin by querying the database directly."""
    _cache = getattr(db_session, '_superadmin_cache', None)
    if _cache is None:
        db_session._superadmin_cache = {}
        _cache = db_session._superadmin_cache
    if user_id in _cache:
        return _cache[user_id]
    result = (await db_session.execute(select(User.is_superadmin).where(User.id == user_id))).scalars().first()
    value = bool(result)
    _cache[user_id] = value
    return value


async def _get_current_user_lazy(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    """Lazy wrapper to avoid circular import (rbac -> superadmin -> auth -> users -> rbac)."""
    from src.security.auth import get_current_user
    return await get_current_user(request, db_session)


async def require_superadmin(
    current_user=Depends(_get_current_user_lazy),
    db_session: AsyncSession = Depends(get_db_session),
):
    """FastAPI dependency that requires the current user to be a superadmin.

    Accepts:
      - regular ``PublicUser``: checks ``User.is_superadmin``
      - ``SuperadminAPITokenUser``: re-checks the minting user is STILL a
        superadmin (so demoting a user invalidates all of their tokens
        without a separate revocation step)

    Rejects:
      - ``AnonymousUser`` (401)
      - ``APITokenUser`` (org-scoped token; 403 — org tokens are never superadmins)
    """
    from src.db.users import AnonymousUser, APITokenUser, SuperadminAPITokenUser

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    # Defense in depth. The EE superadmin routers are already mounted behind
    # their own OSS check, so on those routes this never fires — it is here so
    # that any core route which adopts require_superadmin later inherits the
    # gate instead of quietly shipping a superadmin surface to OSS.
    # Ordered after the 401 so anonymous callers still get 401, and before the
    # principal-type branches so OSS never reveals which principals would pass.
    ensure_ee_superadmin_surface()

    # Org-scoped API tokens are never superadmins, regardless of who minted them.
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required",
        )

    if isinstance(current_user, SuperadminAPITokenUser):
        # Re-check the minting user still has is_superadmin=True. If they've
        # been demoted, the token loses effect immediately — no separate
        # revocation needed.
        if not await is_user_superadmin(current_user.created_by_user_id, db_session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token creator is no longer a superadmin",
            )
        return current_user

    if not await is_user_superadmin(current_user.id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required",
        )

    return current_user
