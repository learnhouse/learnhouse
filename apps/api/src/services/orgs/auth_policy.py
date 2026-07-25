"""Org-wide authentication-method policy + session isolation.

Two independent controls, both living in the org config blob (no migration):

* **allowed_auth_methods** — the set of sign-in methods a member may use to
  access this org. A session records *how* it was established (``amr``); if that
  method is not on the org's list, the member is refused and must sign in again
  with an allowed one. The default lists every method, i.e. no restriction.

* **allow_central_session_sharing** — whether a session established on the
  central apex (``learnhouse.io``) or for a *different* org may be used to reach
  this org directly. A session records which org it was minted for (``sorg``).
  When sharing is off, a member arriving with a foreign/central session is
  refused and must re-authenticate from this org. Default on = today's behavior.

Why per-org-access rather than at login: like the 2FA policy (see
``mfa_policy``), a user can belong to many orgs with different policies, so this
cannot be a login-time gate. It is evaluated per request against the session's
provenance, which is published on a contextvar by ``get_current_user``.

Fail-open: an evaluation error must never take down access — RBAC has already
run; this is an additional restriction, not the wall between a stranger and the
data.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_config import OrganizationConfig
from src.security.session_context import (
    AUTH_METHOD_API_TOKEN,
    POLICY_AUTH_METHODS,
    SessionProvenance,
    get_session_provenance,
)

logger = logging.getLogger(__name__)

METHOD_NOT_ALLOWED_CODE = "AUTH_METHOD_NOT_ALLOWED"
SESSION_NOT_BOUND_CODE = "SESSION_NOT_BOUND_TO_ORG"

_ALL_METHODS = frozenset(POLICY_AUTH_METHODS)


@dataclass
class OrgAuthPolicy:
    allowed_auth_methods: List[str] = field(default_factory=lambda: list(POLICY_AUTH_METHODS))
    allow_central_session_sharing: bool = True

    @property
    def method_restricted(self) -> bool:
        """True only when the org actually narrows the method set.

        An empty list is treated as unrestricted (a mis-save must not lock every
        method out), and a list covering all known methods is likewise a no-op.
        """
        allowed = set(self.allowed_auth_methods)
        return bool(allowed) and not _ALL_METHODS.issubset(allowed)


async def get_org_auth_policy(db_session: AsyncSession, org_id: int) -> OrgAuthPolicy:
    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    if row is None or not isinstance(row.config, dict):
        return OrgAuthPolicy()

    security = (row.config.get("admin_toggles") or {}).get("security") or {}
    try:
        methods = security.get("allowed_auth_methods")
        if not isinstance(methods, list):
            methods = list(POLICY_AUTH_METHODS)
        # Keep only recognised methods; an unknown string can never widen access.
        methods = [m for m in methods if m in _ALL_METHODS]
        return OrgAuthPolicy(
            allowed_auth_methods=methods,
            allow_central_session_sharing=bool(
                security.get("allow_central_session_sharing", True)
            ),
        )
    except (TypeError, ValueError, AttributeError):
        logger.exception("Malformed auth-method config for org %s", org_id)
        return OrgAuthPolicy()


def _method_label(method: str) -> str:
    return {
        "password": "email and password",
        "magic_login": "a magic login link",
        "google": "Google",
        "sso": "single sign-on (SSO)",
    }.get(method, method)


async def evaluate_org_auth(
    db_session: AsyncSession, user_id: int, org_id: int
) -> Optional[Dict[str, Any]]:
    """Return a block descriptor when the current session may not access the org,
    else None. Memoized per db session (a page load runs many gates)."""
    cache = getattr(db_session, "_auth_policy_cache", None)
    if cache is None:
        db_session._auth_policy_cache = {}
        cache = db_session._auth_policy_cache
    key = (user_id, org_id)
    if key in cache:
        return cache[key]

    result: Optional[Dict[str, Any]] = None
    try:
        from src.security.superadmin import is_user_superadmin

        # Superadmins operate across tenants and must never be locked out of one
        # by that tenant's own policy.
        if not await is_user_superadmin(user_id, db_session):
            policy = await get_org_auth_policy(db_session, org_id)

            # Fast path: default config (all methods, sharing on) is a pure no-op,
            # so unmodified orgs — and every existing test that never sets
            # provenance — are unaffected.
            if policy.method_restricted or not policy.allow_central_session_sharing:
                provenance = get_session_provenance() or SessionProvenance()

                # Machine credentials carry their own org boundary
                # (_verify_api_token_org_boundary) and are exempt from the human
                # auth-method policy.
                if provenance.amr != AUTH_METHOD_API_TOKEN:
                    allowed = set(policy.allowed_auth_methods)
                    if policy.method_restricted and (
                        provenance.amr is None or provenance.amr not in allowed
                    ):
                        result = {
                            "code": METHOD_NOT_ALLOWED_CODE,
                            "allowed_methods": sorted(allowed),
                        }
                    elif (
                        not policy.allow_central_session_sharing
                        and provenance.org_id != org_id
                    ):
                        result = {"code": SESSION_NOT_BOUND_CODE}
    except HTTPException:  # pragma: no cover - defensive: surface a policy 403 unchanged
        raise
    except Exception:
        logger.exception(
            "Auth-method policy evaluation failed for user %s in org %s; allowing through",
            user_id,
            org_id,
        )
        result = None

    cache[key] = result
    return result


def auth_policy_exception(block: Dict[str, Any]) -> HTTPException:
    if block["code"] == METHOD_NOT_ALLOWED_CODE:
        labels = ", ".join(_method_label(m) for m in block.get("allowed_methods", []))
        message = (
            "This organization requires you to sign in with "
            f"{labels or 'an approved method'}. Please sign in again from this "
            "organization using an allowed method."
        )
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": METHOD_NOT_ALLOWED_CODE,
                "message": message,
                "allowed_methods": block.get("allowed_methods", []),
            },
        )
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": SESSION_NOT_BOUND_CODE,
            "message": (
                "This organization does not accept sessions started elsewhere. "
                "Please sign in again from this organization's login page."
            ),
        },
    )


async def enforce_org_auth_policy(
    db_session: AsyncSession, user_id: int, org_id: int
) -> None:
    """Raise 403 if the current session may not access ``org_id`` under the org's
    auth-method / session-sharing policy."""
    block = await evaluate_org_auth(db_session, user_id, org_id)
    if block is not None:
        raise auth_policy_exception(block)
