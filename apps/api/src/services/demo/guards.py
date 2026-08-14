"""Is-this-a-demo-org lookups, and the guard that blocks demo-unsafe actions.

Kept in its own module with no imports from the rest of the demo package so
that billing, nudges, email and explore can all depend on it without dragging
in the bundle loader or the generator.
"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization


async def is_demo_org(org_id: int | None, db_session: AsyncSession) -> bool:
    """True when `org_id` is the shared demo organization.

    Selects the single boolean rather than loading the Organization: this runs
    on the active-user billing path, which already does enough work per
    request, and on a scan over every org.
    """
    if not org_id:
        return False
    result = await db_session.execute(
        select(Organization.is_demo).where(Organization.id == int(org_id))
    )
    return bool(result.scalar_one_or_none())


async def demo_org_ids(db_session: AsyncSession) -> set[int]:
    """Every demo org id, for filtering an in-memory collection.

    There is only ever one demo org, so this is a one-row query; it returns a
    set so callers reading `not in` stay correct if that assumption ever
    changes.
    """
    result = await db_session.execute(
        select(Organization.id).where(Organization.is_demo.is_(True))
    )
    return {int(row) for row in result.scalars().all() if row is not None}


def hide_other_visitors(statement, acting_user_id: int):
    """Narrow a query over an org's members to the seeded students plus the caller.

    The demo is one shared organization and every visitor joins it as an admin,
    which is exactly the privilege that member-listing surfaces are gated on.
    Left alone, anyone who opened the demo could read the name, email address
    and login state of every other person who had ever tried it.

    Callers decide whether the org is a demo; this only expresses the
    predicate, so that every surface applies the same one. Add it to any query
    that returns an organization's users.
    """
    from src.db.users import User
    from src.services.demo.flags import DEMO_SIGNUP_METHOD

    return statement.where(
        (User.signup_method == DEMO_SIGNUP_METHOD) | (User.id == acting_user_id)
    )


async def require_not_demo_org(org_id: int | None, db_session: AsyncSession) -> None:
    """Reject an action that must never run against the demo organization.

    Applied server-side to the handful of endpoints that would either cost real
    money, touch DNS, or let a visitor use the platform to mail strangers.
    Everything else stays open — the demo exists to be used, and the hourly
    refresh undoes ordinary damage.
    """
    if await is_demo_org(org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action is not available in the demo organization.",
        )
