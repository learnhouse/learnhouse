"""
Free-tier abuse mitigation: minimum account + organization age gate.

After a phishing-relay incident — a freshly-registered free org blasted
hundreds of phishing invite emails within minutes of signup, exhausting the
shared email quota and taking down platform email — several abuse-prone
surfaces now require BOTH the acting user's account AND their organization to
be at least ``FREE_TIER_MIN_AGE_DAYS`` old before the action is allowed.

Design notes:
- Paid orgs are exempt: the age gate only applies to the ``free`` plan, where
  signup is free and disposable. Upgrading lifts the gate immediately.
- Non-SaaS deployments (self-hosted EE/OSS) skip the gate entirely — there is
  no free-tier abuse economics to defend against.
- ``creation_date`` is persisted as ``str(datetime.now())`` (a naive,
  space-separated server-local timestamp like ``2026-07-09 11:47:21.155477``),
  so parsing must tolerate that format. Unparseable/missing dates fail OPEN:
  the abuse vector is brand-new accounts, which always carry a valid
  creation_date, so only genuinely new accounts are ever gated. Legacy rows
  with an empty/odd date are treated as old enough.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.users import User
from src.security.features_utils.usage import (
    _get_org_config,
    _get_org_plan,
    _is_non_saas,
)

# Minimum age (in days) for a free-tier account AND its org before gated
# actions are allowed. Kept as a module constant so tests can monkeypatch it.
FREE_TIER_MIN_AGE_DAYS = 7


def parse_creation_date(raw: Optional[str]) -> Optional[datetime]:
    """Parse a stored ``creation_date`` string into a tz-aware UTC datetime.

    Handles the primary persisted format ``str(datetime.now())`` (naive,
    space-separated) as well as ISO-8601 strings with an explicit offset or a
    trailing ``Z``. Naive values are assumed to be UTC (the server runs UTC in
    production). Returns ``None`` if the value is missing or unparseable.
    """
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def account_age_days(
    raw: Optional[str], *, now: Optional[datetime] = None
) -> Optional[float]:
    """Return the age in days for a stored creation_date, or ``None`` if the
    date cannot be parsed (caller decides how to treat unknown ages)."""
    created = parse_creation_date(raw)
    if created is None:
        return None
    now = now or datetime.now(timezone.utc)
    return (now - created).total_seconds() / 86400.0


async def is_free_tier_age_gated(
    org_id: int,
    user_id: int,
    db_session: AsyncSession,
    *,
    min_age_days: int = FREE_TIER_MIN_AGE_DAYS,
) -> list[str]:
    """Return the list of subjects (``"organization"`` / ``"account"``) that
    are younger than ``min_age_days`` and would block a gated free-tier action.

    Returns an empty list when the action should be allowed — i.e. the org is
    on a paid plan, the deployment is non-SaaS, or both the org and account are
    old enough (or have unparseable/legacy dates that fail open).
    """
    # Self-hosted EE/OSS: no free-tier abuse economics, skip the gate.
    if _is_non_saas():
        return []

    # Paid orgs are exempt.
    org_config = await _get_org_config(org_id, db_session)
    if org_config is not None and _get_org_plan(org_config) not in ("free",):
        return []

    now = datetime.now(timezone.utc)

    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    user = (
        await db_session.execute(select(User).where(User.id == user_id))
    ).scalars().first()

    org_age = account_age_days(org.creation_date, now=now) if org else None
    user_age = account_age_days(user.creation_date, now=now) if user else None

    too_new: list[str] = []
    # None means "unparseable/legacy date" → fail open (treat as old enough).
    if org_age is not None and org_age < min_age_days:
        too_new.append("organization")
    if user_age is not None and user_age < min_age_days:
        too_new.append("account")
    return too_new


async def enforce_free_tier_age_gate(
    org_id: int,
    user_id: int,
    db_session: AsyncSession,
    *,
    action: str = "perform this action",
    min_age_days: int = FREE_TIER_MIN_AGE_DAYS,
) -> None:
    """Raise HTTP 403 (``ACCOUNT_TOO_NEW``) if a free-tier org or its acting
    user is younger than ``min_age_days``. No-op for paid orgs, non-SaaS
    deployments, and sufficiently old accounts.

    ``action`` is woven into the error message (e.g. ``"invite members"``).
    Pass the *real* acting user id (resolve API tokens to their creator via
    ``resolve_acting_user_id``) so token-driven calls are gated correctly.
    """
    too_new = await is_free_tier_age_gated(
        org_id, user_id, db_session, min_age_days=min_age_days
    )
    if not too_new:
        return

    subjects = " and ".join(too_new)
    raise HTTPException(
        status_code=403,
        detail={
            "code": "ACCOUNT_TOO_NEW",
            "message": (
                f"Your {subjects} must be at least {min_age_days} days old to "
                f"{action}. This limit protects the platform from abuse; it is "
                f"lifted automatically with age, or immediately when you "
                f"upgrade to a paid plan."
            ),
            "min_age_days": min_age_days,
        },
    )
