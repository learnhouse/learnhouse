"""Per-session OrganizationConfig lookup.

A single request often reads the same org's config several times: the MFA
gate, the auth-method gate, then the endpoint itself (plan, AI credits, ...).
Each of those used to run its own SELECT, which Sentry reports as an N+1.

An ORM select for a row the session has already loaded hands back that same
instance from the identity map without refreshing it. The identity map only
holds weak references though, and the gates drop the row as soon as they've
read their policy out of it, so we pin the row in ``session.info``. Returning
the pinned instance gives the caller exactly what the SELECT would have, minus
the round-trip. A row that was expired, deleted or detached since is reloaded.
"""

from typing import Optional

from sqlalchemy import inspect
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_config import OrganizationConfig

_INFO_KEY = "org_config_rows"


def _pinned_rows(db_session: AsyncSession) -> Optional[dict]:
    try:
        info = db_session.sync_session.info
    except Exception:
        # Not a real AsyncSession (e.g. a test double); just query.
        return None
    if not isinstance(info, dict):
        return None
    return info.setdefault(_INFO_KEY, {})


def _still_valid(db_session: AsyncSession, row: OrganizationConfig) -> bool:
    state = inspect(row)
    return not (
        state.expired_attributes
        or state.deleted
        or state.was_deleted
        or state.detached
        or state.session is not db_session.sync_session
    )


async def get_session_org_config(
    db_session: AsyncSession, org_id: int
) -> Optional[OrganizationConfig]:
    """Return the org's config row, reusing one this session already loaded."""
    pinned = _pinned_rows(db_session)
    if pinned is not None:
        row = pinned.get(org_id)
        if row is not None and _still_valid(db_session, row):
            return row

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    row = (await db_session.execute(statement)).scalars().first()
    if pinned is not None:
        if row is None:
            pinned.pop(org_id, None)
        else:
            pinned[org_id] = row
    return row
