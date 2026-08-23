"""
Best-effort user-activity tracking for active-user billing.

An "active user" is a member seen on the site on at least 2 distinct UTC
calendar days in a month. This module records one row per (org, user, day)
so that count is authoritative. Everything here is best-effort: it must never
raise into a request path.

Recording runs on SaaS and on self-hosted enterprise deployments. It used to
be SaaS-only, on the assumption that active-user counts existed purely for
overage billing. They are also what an enterprise deployment reports as its
own usage, and with recording disabled that number was structurally zero on
every self-hosted install. Plain OSS still skips it — nothing there consumes
the table, so the write would buy nothing.

The rows never leave the deployment's own database. Only aggregate counts are
reported, and only by deployments that already report usage.
"""

import logging
from datetime import date, datetime, timezone

from typing import Optional

from src.core.redis import get_redis_client

logger = logging.getLogger(__name__)


def _activity_tracking_enabled() -> bool:
    """True on deployments where something actually consumes the activity rows.

    SaaS uses them for overage billing; enterprise reports them as its own
    usage. Plain OSS has no consumer, so it skips the write entirely.
    """
    from src.core.deployment_mode import get_deployment_mode

    return get_deployment_mode() in ('saas', 'ee')

# Cache org slug/uuid -> id for a day; org identity is effectively immutable.
_ORG_ID_CACHE_TTL = 86400


def _seconds_until_utc_midnight() -> int:
    """Seconds remaining until the next UTC midnight (>=1)."""
    now = datetime.now(timezone.utc)
    tomorrow = date.fromordinal(now.date().toordinal() + 1)
    midnight = datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=timezone.utc)
    return max(1, int((midnight - now).total_seconds()))


async def _insert_activity_row(org_id: int, user_id: int, day: date) -> None:
    """Insert today's activity row in its own short-lived session.

    Uses a dedicated session (not the request's mid-transaction session) so
    committing the activity row never flushes/commits request work. Idempotent
    across dialects: a duplicate (same org/user/day) hits the unique constraint
    and is silently ignored — the row already exists.
    """
    from sqlalchemy.exc import IntegrityError
    from src.core.events.database import _async_session_factory
    from src.db.user_activity import UserActivityDay

    async with _async_session_factory() as session:
        session.add(
            UserActivityDay(org_id=org_id, user_id=user_id, activity_date=day)
        )
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()  # already recorded today — no-op


async def _resolve_org_id(
    org_id: Optional[int],
    org_slug: Optional[str],
    org_uuid: Optional[str],
) -> Optional[int]:
    """Resolve an org id from id / slug / uuid. Slug and uuid are cached in
    Redis (org identity is effectively immutable) and otherwise looked up once
    in a dedicated session. Runs in the background task, never on the request
    critical path."""
    if org_id:
        return org_id

    key_val = org_slug or org_uuid
    if not key_val:
        return None

    r = get_redis_client()
    cache_key = f"org_id_by_ref:{'slug' if org_slug else 'uuid'}:{key_val}"
    if r is not None:
        try:
            cached = r.get(cache_key)
            if cached is not None:
                return int(cached)
        except Exception:
            logger.debug("org id cache read failed", exc_info=True)

    from sqlmodel import select
    from src.core.events.database import _async_session_factory
    from src.db.organizations import Organization

    async with _async_session_factory() as session:
        if org_slug:
            stmt = select(Organization.id).where(Organization.slug == org_slug)
        else:
            stmt = select(Organization.id).where(Organization.org_uuid == org_uuid)
        resolved = (await session.execute(stmt)).scalars().first()

    if resolved is not None and r is not None:
        try:
            r.set(cache_key, str(resolved), ex=_ORG_ID_CACHE_TTL)
        except Exception:
            logger.debug("org id cache write failed", exc_info=True)
    return resolved


async def record_user_activity(
    user_id: int,
    org_id: Optional[int] = None,
    org_slug: Optional[str] = None,
    org_uuid: Optional[str] = None,
) -> None:
    """
    Mark (org, user) active for today's UTC date. Best-effort, never raises.

    The org may be given directly (org_id) or resolved from a slug/uuid route
    param (learner content routes are slug/uuid-scoped) — resolution happens
    here in the background task, off the request critical path. A cheap Redis
    SETNX day-key then guards the DB so the insert runs at most once per
    user/org/day. When Redis is unavailable the DB insert still runs
    (idempotent via the unique constraint), so tracking degrades gracefully.

    All activity capture is server-side: it cannot be blocked by ad/tracker
    blockers, which only affect client-side third-party requests.
    """
    try:
        if not _activity_tracking_enabled():
            return
        if not user_id:
            return

        org_id = await _resolve_org_id(org_id, org_slug, org_uuid)
        if not org_id:
            return

        today = datetime.now(timezone.utc).date()

        r = get_redis_client()
        if r is not None:
            try:
                key = f"activity_touched:{org_id}:{user_id}:{today.isoformat()}"
                # If the key already exists we've written today's row -> skip DB.
                if not r.set(key, "1", nx=True, ex=_seconds_until_utc_midnight()):
                    return
            except Exception:
                logger.debug("activity Redis guard failed; falling through to DB", exc_info=True)

        await _insert_activity_row(org_id, user_id, today)
    except Exception:
        logger.debug("record_user_activity failed (non-fatal)", exc_info=True)
