"""Org-wide "require two-factor" policy.

Why this is evaluated per org-access rather than at login
---------------------------------------------------------
Users can belong to many orgs (``UserOrganization`` is many-to-many). Someone
who is in Org A (2FA required) and Org B (not) must still be able to sign in
and use Org B. So the policy cannot be a login-time gate — it is a property of
*accessing a particular org*, evaluated per request.

Deliberately NOT enforced by suspending or deleting accounts: a user past their
deadline keeps their session and their other orgs, and is simply blocked from
this one until they enroll. The state is fully reversible the moment they do.
"""

import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.auth.mfa import is_mfa_active

logger = logging.getLogger(__name__)

# signup_method values that mean "an external identity provider vouched for
# this user". Kept conservative: an unrecognised value is treated as a local
# password account, i.e. subject to the policy.
EXTERNAL_AUTH_METHODS = {"google", "sso", "saml", "oidc", "workos", "keycloak", "okta", "auth0"}


@dataclass
class OrgMFAPolicy:
    require_2fa: bool = False
    grace_days: int = 0
    enabled_at: Optional[str] = None
    exempt_external_auth: bool = True


@dataclass
class MFAComplianceState:
    """What the caller needs to render a banner, a countdown, or a hard block."""

    required: bool
    satisfied: bool
    # None when there is no deadline (policy off, or already satisfied).
    deadline: Optional[str] = None
    days_remaining: Optional[int] = None
    # True only when the user must be stopped right now.
    blocking: bool = False
    exempt_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    """Best-effort parse of the mixed date shapes stored across this codebase.

    Dates are persisted as ``str(datetime.now())`` in some tables and ISO-8601
    in others. A value we cannot parse must not be allowed to silently become
    "no deadline" — callers treat None as "unknown" and fall back to the policy
    anchor rather than granting an open-ended grace period.
    """
    if not value:
        return None
    raw = str(value).strip()
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    logger.warning("Could not parse a date for MFA policy evaluation: %r", value)
    return None


async def get_org_mfa_policy(db_session: AsyncSession, org_id: int) -> OrgMFAPolicy:
    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    if row is None or not isinstance(row.config, dict):
        return OrgMFAPolicy()

    security = (row.config.get("admin_toggles") or {}).get("security") or {}
    try:
        return OrgMFAPolicy(
            require_2fa=bool(security.get("require_2fa", False)),
            grace_days=max(0, int(security.get("require_2fa_grace_days", 0) or 0)),
            enabled_at=security.get("require_2fa_enabled_at"),
            exempt_external_auth=bool(security.get("exempt_external_auth", True)),
        )
    except (TypeError, ValueError):
        # Malformed config must not fail open into "policy enforced but with a
        # nonsense deadline"; fall back to the safe default of no policy and
        # let an admin fix the config.
        logger.exception("Malformed security config for org %s", org_id)
        return OrgMFAPolicy()


async def evaluate_mfa_compliance(
    db_session: AsyncSession,
    user: User,
    org_id: int,
) -> MFAComplianceState:
    """Decide whether ``user`` may currently act inside ``org_id``."""
    policy = await get_org_mfa_policy(db_session, org_id)

    if not policy.require_2fa:
        return MFAComplianceState(required=False, satisfied=True)

    if await is_mfa_active(db_session, user.id):
        return MFAComplianceState(required=True, satisfied=True)

    if policy.exempt_external_auth and (user.signup_method or "").lower() in EXTERNAL_AUTH_METHODS:
        return MFAComplianceState(
            required=True,
            satisfied=True,
            exempt_reason="external_auth",
        )

    # Not satisfied — work out whether they are still inside their grace window.
    anchor = _parse_dt(policy.enabled_at)
    membership = (
        await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == user.id,
                UserOrganization.org_id == org_id,
            )
        )
    ).scalars().first()
    joined = _parse_dt(membership.creation_date) if membership else None

    # Later of "policy switched on" and "user joined this org" — see the
    # SecurityAdminToggle docstring for why the max() is load-bearing.
    candidates = [d for d in (anchor, joined) if d is not None]
    start = max(candidates) if candidates else datetime.now()
    deadline = start + timedelta(days=policy.grace_days)

    now = datetime.now()
    remaining = (deadline - now).total_seconds()
    days_remaining = max(0, int(remaining // 86400)) if remaining > 0 else 0

    return MFAComplianceState(
        required=True,
        satisfied=False,
        deadline=deadline.isoformat(),
        days_remaining=days_remaining,
        blocking=remaining <= 0,
    )


### 🔒 Enforcement ##############################################################


MFA_POLICY_ERROR_CODE = "MFA_REQUIRED_BY_ORG"


async def is_org_mfa_blocking(db_session: AsyncSession, user_id: int, org_id: int) -> Optional[MFAComplianceState]:
    """Return the compliance state when the user must be stopped, else None.

    Memoized per DB session: a single page load can run several access checks
    against the same org, and this would otherwise repeat the config + factor
    lookups every time.
    """
    cache = getattr(db_session, "_mfa_policy_cache", None)
    if cache is None:
        db_session._mfa_policy_cache = {}
        cache = db_session._mfa_policy_cache

    key = (user_id, org_id)
    if key in cache:
        return cache[key]

    result: Optional[MFAComplianceState] = None
    try:
        # Superadmins operate across tenants and frequently have no membership
        # row in the org at all; a per-org policy must not strand them.
        from src.security.superadmin import is_user_superadmin

        if not await is_user_superadmin(user_id, db_session):
            user = (
                await db_session.execute(select(User).where(User.id == user_id))
            ).scalars().first()
            if user is not None:
                state = await evaluate_mfa_compliance(db_session, user, org_id)
                if state.blocking:
                    result = state
    except HTTPException:  # pragma: no cover - defensive: surface a policy 403 unchanged
        raise
    except Exception:
        # A policy lookup that errors must not take down ordinary access. The
        # policy is an additional restriction layered on top of RBAC, never the
        # thing standing between a stranger and the data — RBAC has already run.
        logger.exception(
            "MFA policy evaluation failed for user %s in org %s; allowing through",
            user_id,
            org_id,
        )
        result = None

    cache[key] = result
    return result


def mfa_policy_exception(state: MFAComplianceState) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": MFA_POLICY_ERROR_CODE,
            "message": (
                "Your organization requires two-factor authentication. "
                "Enable it on your account to regain access."
            ),
            "deadline": state.deadline,
        },
    )


async def enforce_org_mfa_policy(db_session: AsyncSession, user_id: int, org_id: int) -> None:
    """Raise 403 if ``user_id`` is past their two-factor deadline in ``org_id``."""
    state = await is_org_mfa_blocking(db_session, user_id, org_id)
    if state is not None:
        raise mfa_policy_exception(state)
