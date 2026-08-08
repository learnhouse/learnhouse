"""
Read delivery outcomes back from the provider, so bounces and complaints are
noticed without anyone configuring a webhook.

Resend records the state of each message and exposes it as ``last_event`` on
the email object, so the ledger can simply ask. That costs one API call per
message sent, once, a day or two later — trivial at any volume this job
produces, and it means the feature protects the sending domain from a deploy
alone rather than a deploy plus a dashboard step somebody has to remember.

The webhook endpoint still exists and still works. Where it is configured it is
strictly better: it carries the bounce sub-type, so a permanent failure can be
told from a temporary one, and it arrives in seconds rather than a day. This is
the floor, not the ceiling.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.nudges import NudgeSend, NudgeSendStatus
from src.services.nudges.preferences import suppress_address

logger = logging.getLogger(__name__)

# `last_event` values meaning the address should not be mailed again.
TERMINAL_EVENTS = {
    "bounced": "bounce",
    "complained": "complaint",
}

# Wait before judging a message. A receiving server retries a transient failure
# for a while, and a message read too early can look bounced when it is only
# delayed — which would throw away a good address.
MIN_AGE_HOURS = 36

# Past this there is nothing useful left to learn.
MAX_AGE_DAYS = 7

# Bounded so one run cannot spend minutes talking to the provider.
MAX_PER_RUN = 500


async def _last_event(provider_id: str) -> Optional[str]:
    """Ask the provider what became of one message."""
    import resend

    email = await asyncio.to_thread(resend.Emails.get, provider_id)
    if isinstance(email, dict):
        return email.get("last_event")
    return getattr(email, "last_event", None)


async def reconcile_delivery(
    db_session: AsyncSession,
    now: Optional[datetime] = None,
    limit: int = MAX_PER_RUN,
) -> dict:
    """Poll recent sends and suppress the addresses that failed.

    Each message is checked at most once: the flag is set whatever the outcome,
    so a delivered message is never asked about again. A lookup that errors
    leaves the flag unset, so a provider outage delays the check rather than
    skipping it.
    """
    now = now or datetime.now(timezone.utc)

    rows = (
        await db_session.execute(
            select(NudgeSend)
            .where(
                NudgeSend.status == NudgeSendStatus.SENT,
                NudgeSend.delivery_checked.is_(False),
                NudgeSend.provider_id.is_not(None),
                NudgeSend.sent_at <= now - timedelta(hours=MIN_AGE_HOURS),
                NudgeSend.sent_at >= now - timedelta(days=MAX_AGE_DAYS),
            )
            .order_by(NudgeSend.sent_at)
            .limit(limit)
        )
    ).scalars().all()

    checked = 0
    suppressed = 0

    for row in rows:
        try:
            event = await _last_event(row.provider_id)
        except Exception as exc:
            logger.warning("Delivery lookup failed for %s: %s", row.provider_id, exc)
            continue

        reason = TERMINAL_EVENTS.get(str(event or "").lower())
        if reason:
            address = (row.meta or {}).get("email")
            if address and await suppress_address(db_session, address, reason):
                suppressed += 1

        row.delivery_checked = True
        db_session.add(row)
        checked += 1

    if checked:
        await db_session.commit()
        logger.info("Delivery reconcile: checked=%s suppressed=%s", checked, suppressed)

    return {"checked": checked, "suppressed": suppressed}
