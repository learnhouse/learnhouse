"""Per-user interface preferences (theme…), stored on ``user.ui_preferences``.

The blob is private to its owner: it is read and written only through the
``/users/me/preferences`` endpoints and returned in the user's own session.
"""

from fastapi import HTTPException
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import PublicUser, User, UserPreferences, UserPreferencesUpdate


def preferences_from(raw: object) -> UserPreferences:
    """The modelled preferences in a stored blob; anything invalid reads as unset."""
    if not isinstance(raw, dict):
        return UserPreferences()
    theme = raw.get("theme")
    return UserPreferences(theme=theme if theme in ("light", "dark") else None)


async def _load_user(db_session: AsyncSession, current_user: PublicUser) -> User:
    user = (
        await db_session.execute(select(User).where(User.id == current_user.id))
    ).scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def get_user_preferences(
    db_session: AsyncSession, current_user: PublicUser
) -> UserPreferences:
    user = await _load_user(db_session, current_user)
    return preferences_from(user.ui_preferences)


async def update_user_preferences(
    db_session: AsyncSession,
    current_user: PublicUser,
    update: UserPreferencesUpdate,
) -> UserPreferences:
    user = await _load_user(db_session, current_user)
    stored = dict(user.ui_preferences) if isinstance(user.ui_preferences, dict) else {}
    stored.update(update.model_dump(exclude_unset=True))
    user.ui_preferences = stored
    flag_modified(user, "ui_preferences")
    db_session.add(user)
    await db_session.commit()
    return preferences_from(stored)
