"""
Read and write per-user email preferences.

The absence of a row means "opted in, never asked", so reads coalesce to False
and writes upsert. Callers on the send path use :func:`get_opted_out_user_ids`
to fetch the whole opt-out set in one query rather than probing per user.
"""

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional, Set

from sqlalchemy import or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.nudges import EmailPreference
from src.db.users import User

logger = logging.getLogger(__name__)


async def get_user_by_uuid(db_session: AsyncSession, user_uuid: str) -> Optional[User]:
    return (
        await db_session.execute(select(User).where(User.user_uuid == user_uuid))
    ).scalars().first()


async def get_opted_out_user_ids(
    db_session: AsyncSession, user_ids: Iterable[int]
) -> Set[int]:
    """Ids from the given set that must not be mailed.

    Covers two different things deliberately: someone who asked to stop, and
    an address a provider told us is undeliverable or whose owner reported us
    as spam. The first is a preference; the second is a fact, and mailing
    through it is what actually burns a sending domain.
    """
    ids = list(user_ids)
    if not ids:
        return set()

    rows = (
        await db_session.execute(
            select(EmailPreference.user_id).where(
                EmailPreference.user_id.in_(ids),
                or_(
                    EmailPreference.lifecycle_opt_out.is_(True),
                    EmailPreference.suppressed.is_(True),
                ),
            )
        )
    ).scalars().all()
    return set(rows)


async def suppress_address(
    db_session: AsyncSession, email: str, reason: str
) -> Optional[EmailPreference]:
    """Stop mailing an address after a hard bounce or a spam complaint.

    Keyed on the address rather than a user id because that is all a provider
    webhook gives us. Returns None when the address matches no account, which
    is normal — the bounce may be for a user since deleted.

    This is set independently of ``lifecycle_opt_out`` so that a later
    re-subscribe cannot silently undo it.
    """
    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalars().first()
    if user is None or user.id is None:
        logger.info("Suppression for unknown address ignored (%s)", reason)
        return None

    pref = (
        await db_session.execute(
            select(EmailPreference).where(EmailPreference.user_id == user.id)
        )
    ).scalars().first()

    if pref is None:
        pref = EmailPreference(user_id=user.id, source=reason)
        db_session.add(pref)

    pref.suppressed = True
    pref.suppressed_reason = reason
    if pref.unsubscribed_at is None:
        pref.unsubscribed_at = datetime.now(timezone.utc)
    db_session.add(pref)
    await db_session.commit()
    await db_session.refresh(pref)
    logger.info("Suppressed address for user %s (%s)", user.id, reason)
    return pref


async def is_suppressed(db_session: AsyncSession, user_id: int) -> bool:
    pref = (
        await db_session.execute(
            select(EmailPreference).where(EmailPreference.user_id == user_id)
        )
    ).scalars().first()
    return bool(pref and pref.suppressed)


async def is_opted_out(db_session: AsyncSession, user_id: int) -> bool:
    pref = (
        await db_session.execute(
            select(EmailPreference).where(EmailPreference.user_id == user_id)
        )
    ).scalars().first()
    return bool(pref and pref.lifecycle_opt_out)


async def set_lifecycle_opt_out(
    db_session: AsyncSession,
    user_id: int,
    opted_out: bool = True,
    source: str = "email_link",
) -> EmailPreference:
    """Upsert the user's lifecycle preference. Idempotent.

    One-click unsubscribe is retried by some mail providers, and people click
    the link twice — repeating the call must not error or change the outcome.
    """
    pref = (
        await db_session.execute(
            select(EmailPreference).where(EmailPreference.user_id == user_id)
        )
    ).scalars().first()

    now = datetime.now(timezone.utc)
    if pref is None:
        pref = EmailPreference(
            user_id=user_id,
            lifecycle_opt_out=opted_out,
            unsubscribed_at=now if opted_out else None,
            source=source,
        )
        db_session.add(pref)
    else:
        pref.lifecycle_opt_out = opted_out
        # Keep the original opt-out timestamp on a repeat click; only stamp it
        # on the transition into the opted-out state.
        if opted_out and pref.unsubscribed_at is None:
            pref.unsubscribed_at = now
        if not opted_out:
            pref.unsubscribed_at = None
        # `suppressed` is untouched on purpose: a hard bounce or spam complaint
        # is a delivery fact, and re-subscribing cannot make a dead address
        # deliverable again.
        pref.source = source
        db_session.add(pref)

    await db_session.commit()
    await db_session.refresh(pref)
    return pref
