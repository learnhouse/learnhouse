import logging
from fastapi import Depends, HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.users import PublicUser, User

logger = logging.getLogger(__name__)


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
