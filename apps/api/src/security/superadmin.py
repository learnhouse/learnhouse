import logging
from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from src.db.users import PublicUser, User

logger = logging.getLogger(__name__)


def is_user_superadmin(user_id: int, db_session: Session) -> bool:
    """Check if a user is a superadmin by querying the database directly."""
    result = db_session.exec(select(User.is_superadmin).where(User.id == user_id)).first()
    return bool(result)


async def _get_current_user_lazy(request: Request, db_session: Session = Depends(get_db_session)):
    """Lazy wrapper to avoid circular import (rbac -> superadmin -> auth -> users -> rbac)."""
    from src.security.auth import get_current_user
    return await get_current_user(request, db_session)


async def require_superadmin(
    current_user: PublicUser = Depends(_get_current_user_lazy),
    db_session: Session = Depends(get_db_session),
) -> PublicUser:
    """FastAPI dependency that requires the current user to be a superadmin."""
    from src.db.users import AnonymousUser

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    if not is_user_superadmin(current_user.id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required",
        )

    return current_user
