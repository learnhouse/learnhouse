"""Public entry points for the shared demo organization."""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.demo_state import DEMO_STATE_ID, DemoState, DemoStateEnum
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.demo import flags

router = APIRouter()


class DemoStatus(BaseModel):
    enabled: bool
    slug: str
    state: str
    ready: bool
    next_refresh_at: Optional[str] = None
    refresh_minutes: int


class DemoEntry(BaseModel):
    org_slug: str
    org_id: int


async def _load_state(db_session: AsyncSession) -> Optional[DemoState]:
    return (
        await db_session.execute(select(DemoState).where(DemoState.id == DEMO_STATE_ID))
    ).scalars().first()


@router.get("/status", response_model=DemoStatus)
async def demo_status(db_session: AsyncSession = Depends(get_db_session)):
    """Whether a demo is available, and when it next resets.

    Public and unauthenticated: the onboarding page needs it to decide whether
    to offer the demo at all, and it is called before the visitor has done
    anything.
    """
    interval = flags.refresh_minutes()

    if not flags.demo_enabled():
        return DemoStatus(
            enabled=False,
            slug=flags.demo_slug(),
            state="DISABLED",
            ready=False,
            refresh_minutes=interval,
        )

    state = await _load_state(db_session)
    if state is None:
        return DemoStatus(
            enabled=True,
            slug=flags.demo_slug(),
            state=DemoStateEnum.PROVISIONING,
            ready=False,
            refresh_minutes=interval,
        )

    next_refresh = None
    if state.last_refresh_at:
        try:
            last = datetime.fromisoformat(state.last_refresh_at)
            # last_refresh_at is stored as str(datetime.now()) — naive *server
            # local* time. Serialising that without an offset makes the browser
            # parse it as ITS OWN local time, so the countdown is wrong by the
            # difference between the two: on a UTC server with a UTC+2 viewer it
            # reads two hours in the future and never counts down. astimezone()
            # attaches the server's offset so the instant is unambiguous.
            next_refresh = (
                (last + timedelta(minutes=interval)).astimezone().isoformat()
            )
        except ValueError:
            next_refresh = None

    return DemoStatus(
        enabled=True,
        slug=flags.demo_slug(),
        state=state.state,
        ready=state.state == DemoStateEnum.READY,
        next_refresh_at=next_refresh,
        refresh_minutes=interval,
    )


@router.post("/enter", response_model=DemoEntry)
async def enter_demo(
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    """Join the signed-in user to the demo organization as an admin.

    Idempotent: a returning visitor already has a membership and simply gets
    the slug back. Admin is deliberate — the demo exists to show the
    administrator's view, which is where the progress, cohorts and grading all
    live. The endpoints that would let an admin do real damage (invites,
    custom domains, billing, deleting the org) are blocked separately.
    """
    if not flags.demo_enabled():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The demo is not available on this instance.",
        )

    if isinstance(current_user, AnonymousUser) or not getattr(current_user, "id", None):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to explore the demo.",
        )

    state = await _load_state(db_session)
    if state is None or state.state != DemoStateEnum.READY:
        # 409 rather than 503: the demo is being built and will exist shortly,
        # which is a different thing from the service being unavailable.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The demo is still being prepared. Try again in a moment.",
        )

    org = (
        await db_session.execute(
            select(Organization).where(
                Organization.id == state.org_id, Organization.is_demo.is_(True)
            )
        )
    ).scalars().first()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The demo is still being prepared. Try again in a moment.",
        )

    existing = (
        await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == int(current_user.id),
                UserOrganization.org_id == org.id,
            )
        )
    ).scalars().first()

    if existing is None:
        now = str(datetime.now())
        db_session.add(
            UserOrganization(
                user_id=int(current_user.id),
                org_id=org.id,
                role_id=ADMIN_ROLE_ID,
                creation_date=now,
                update_date=now,
            )
        )
        await db_session.commit()

        # The session cache holds the user's roles; without this the visitor
        # lands in the demo with no permissions until their session expires.
        from src.routers.users import _invalidate_session_cache

        _invalidate_session_cache(int(current_user.id))

    return DemoEntry(org_slug=org.slug, org_id=org.id)  # type: ignore[arg-type]
