"""One read of an org's security config per request, shared by both policies.

``admin_toggles.security`` in the org config blob holds *both* per-org session
policies — the "require two-factor" policy (:mod:`.mfa_policy`) and the
auth-method / session-sharing policy (:mod:`.auth_policy`). They are enforced in
lockstep (see :func:`src.security.org_auth.enforce_org_mfa`), so every gated
request used to read the byte-identical ``OrganizationConfig`` row twice, once
per policy loader. Both loaders memoize their own *result*, but nothing memoized
the row they share, so the duplicate round trip survived — and the dashboard
polls ``/auth/mfa/org-policy/{org_id}``, which pays it on every page load.

This module owns the single read. It lives apart from the two policy modules
only to keep them from importing each other.

The cache is deliberately request-scoped (it hangs off the ``AsyncSession``,
which FastAPI creates per request) rather than Redis-backed: a policy save has
to be visible immediately, on every pod, to the very next request. Same
lifetime, and same fail-open contract, as the per-result caches in
``evaluate_org_auth`` and ``is_org_mfa_blocking``.
"""

import logging
from typing import Any, Dict

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_config import OrganizationConfig

logger = logging.getLogger(__name__)

_CACHE_ATTR = "_org_security_config_cache"


async def get_org_security_config(db_session: AsyncSession, org_id: int) -> Dict[str, Any]:
    """The org's ``admin_toggles.security`` sub-dict, or ``{}``.

    Treat the result as read-only — callers share one dict per session. An org
    with no config row, a malformed blob, or a security key of the wrong shape
    all collapse to ``{}``, which every consumer reads as "policy defaults".
    """
    cache = getattr(db_session, _CACHE_ATTR, None)
    if cache is None:
        cache = {}
        setattr(db_session, _CACHE_ATTR, cache)
    if org_id in cache:
        return cache[org_id]

    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()

    security: Dict[str, Any] = {}
    if row is not None and isinstance(row.config, dict):
        toggles = row.config.get("admin_toggles")
        # Every level is shape-checked rather than trusted: this blob is stored
        # as JSON with no schema behind it, and a policy loader that raises on a
        # malformed one would take the org's whole API down instead of falling
        # back to "no policy".
        candidate = toggles.get("security") if isinstance(toggles, dict) else None
        if isinstance(candidate, dict):
            # Copied so an in-place mutation of the row's JSON elsewhere in the
            # request cannot rewrite what the policy gates already decided on.
            security = dict(candidate)

    cache[org_id] = security
    return security


def invalidate_org_security_config(db_session: AsyncSession, org_id: int) -> None:
    """Drop the memoized config after a save, so the same request re-reads it.

    Load-bearing on the policy PUT: the request's own access gates populate the
    cache before the handler writes, and the handler answers with the saved
    policy read back through the same loaders. Without this the save would echo
    the pre-save values — the "save, then the old values reappear" bug the
    settings endpoint exists to avoid.
    """
    cache = getattr(db_session, _CACHE_ATTR, None)
    if cache is not None:
        cache.pop(org_id, None)
