"""Single-use enforcement for sign-in links.

Every single-use sign-in credential (the admin/integration link, the emailed
login link, the pending second-factor token) carries a random ``jti``.
Redeeming one inserts that ``jti`` into ``used_link_token``; the primary key
turns any replay into a constraint violation. The record lives in Postgres, so
a Redis outage or flush can never make an old link usable again, and any
failure to write it refuses the link.
"""

import asyncio
import contextlib
import logging
import secrets
import time

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.used_link_tokens import UsedLinkToken

logger = logging.getLogger(__name__)

# A row is only needed while its link's JWT could still verify. Prune well past
# that point so clock skew between pods can never drop a row for a live link.
_PRUNE_GRACE_SECONDS = 3600
# Pruning on every redemption is wasted work; a sample keeps the table small.
_PRUNE_ONE_IN = 20

# The Redis markers releases up to 1.4.0 used. Writing and honouring them for
# one release means a link spent on an old pod during a rolling deploy (or a
# rollback) is refused by a new one, and the other way round.
# TODO(1.5): drop once no pod running the Redis-only check can be live.
_LEGACY_REDIS_KEYS = {
    "magic_link": "magic_link_used:{jti}",
    "magic_login": "magic_login_used:{jti}",
}
_LEGACY_REDIS_TTL_SECONDS = 960


def _legacy_redis():  # pragma: no cover - thin import shim; patched in tests
    try:
        from src.core.redis import get_redis_client

        return get_redis_client()
    except Exception:
        return None


def _legacy_marker_seen(purpose: str, jti: str) -> bool:
    """Best effort: did an older pod already spend this link? Never raises."""
    pattern = _LEGACY_REDIS_KEYS.get(purpose)
    if not pattern:
        return False
    try:
        r = _legacy_redis()
        return bool(r is not None and r.exists(pattern.format(jti=jti)))
    except Exception:
        return False


def _claim_legacy_marker(purpose: str, jti: str) -> bool:
    """Best effort: tell older pods this link is spent. False only when an
    older pod claimed it first (between our check and now); never raises."""
    pattern = _LEGACY_REDIS_KEYS.get(purpose)
    if not pattern:
        return True
    try:
        r = _legacy_redis()
        if r is None:
            return True
        # SETNX, the same claim older pods make: whichever writes first wins.
        return r.set(pattern.format(jti=jti), "1", nx=True, ex=_LEGACY_REDIS_TTL_SECONDS) is not None
    except Exception:
        logger.warning("Could not set the legacy single-use marker", exc_info=True)
        return True


async def _rollback_quietly(db_session: AsyncSession) -> None:
    # A rollback that itself fails must not turn a 410/503 into a 500.
    with contextlib.suppress(Exception):
        await db_session.rollback()


async def redeem_link_token(
    db_session: AsyncSession, jti: str, purpose: str, expires_at: int
) -> bool:
    """Record ``jti`` as used. True on the first redemption, False on any reuse.

    Any other failure raises a 503: when we cannot record the use we refuse the
    link rather than risk it working twice.

    This commits (or, on reuse, rolls back) the whole session, so it must be the
    first write in the request and run before anything is loaded that later
    code relies on: a rollback expires every loaded object.
    """
    try:
        # A replay is only a read: spent links are refused without touching the
        # primary, so replaying one cannot be turned into a stream of writes.
        already = (
            await db_session.execute(select(UsedLinkToken.jti).where(UsedLinkToken.jti == jti))
        ).first()
        if already is not None or await asyncio.to_thread(_legacy_marker_seen, purpose, jti):
            await _rollback_quietly(db_session)
            return False

        if secrets.randbelow(_PRUNE_ONE_IN) == 0:
            await db_session.execute(
                delete(UsedLinkToken).where(
                    UsedLinkToken.expires_at < int(time.time()) - _PRUNE_GRACE_SECONDS
                )
            )
        db_session.add(UsedLinkToken(jti=jti, purpose=purpose, expires_at=int(expires_at)))
        await db_session.commit()
    except IntegrityError:
        # Lost a race with a concurrent redemption of the same link.
        await _rollback_quietly(db_session)
        return False
    except Exception:
        logger.exception("Could not record sign-in link redemption; refusing the link")
        await _rollback_quietly(db_session)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "SIGN_IN_UNAVAILABLE",
                "message": "Sign-in links are temporarily unavailable. Please try again in a moment.",
            },
        )

    # The row is written, so refusing here can never let the link work twice.
    return await asyncio.to_thread(_claim_legacy_marker, purpose, jti)


async def link_token_spent(db_session: AsyncSession, jti: str) -> bool:
    """Read-only: has ``jti`` already been redeemed?"""
    row = (
        await db_session.execute(select(UsedLinkToken.jti).where(UsedLinkToken.jti == jti))
    ).first()
    return row is not None
