"""
Loops.so marketing-audience sync (API side).

The web app (apps/web) already talks to Loops via the official ``loops`` npm
client for signup / onboarding. Org ADMIN role assignment, however, is decided
authoritatively HERE in the Python API (org creation, role promotion), and can
target a DIFFERENT user than the one making the request (an admin promoting a
member). So the admin → Loops sync lives here, at the authoritative point,
rather than relying on a client-side call that only ever knows the acting user.

This mirrors the web helper's contact shape exactly (``userGroup``,
``source``, ``is_org_admin``, ``org_slug``, ``firstName``/``lastName`` and the
``became_org_admin`` event) so both sides upsert the same contact.

Design mirrors ``src/services/analytics/analytics.py``:
  - fire-and-forget via ``asyncio.create_task`` (never blocks the request),
  - SaaS-gated and a no-op when ``LOOPS_API_KEY`` is unset,
  - all errors swallowed + logged — a marketing-sync failure must NEVER break
    org creation or a role change.

Loops REST API (matches what the npm client calls):
  - PUT  https://app.loops.so/api/v1/contacts/update  -> upsert contact
  - POST https://app.loops.so/api/v1/events/send      -> send event
"""

import asyncio
import logging
import os

import httpx

from src.core.deployment_mode import get_deployment_mode

logger = logging.getLogger(__name__)

_LOOPS_API_ROOT = "https://app.loops.so/api/"

# Must match apps/web/services/emails/loops.ts.
_LOOPS_SIGNED_USERS_GROUP = "signed-users"
_LOOPS_SOURCE = "learnhouse.io"

# Lazy singleton httpx client for Loops requests.
_loops_client: httpx.AsyncClient | None = None

# Strong references so the GC does not collect fire-and-forget tasks before they
# complete (Python 3.12+ only keeps weak refs in the event loop).
_background_tasks: set = set()


def _loops_api_key() -> str | None:
    key = os.getenv("LOOPS_API_KEY")
    return key or None


def _get_loops_client() -> httpx.AsyncClient | None:
    """Return the shared Loops client, or None when Loops isn't configured /
    we're not in SaaS mode (so OSS/EE self-hosted never calls out)."""
    global _loops_client
    if get_deployment_mode() != "saas":
        return None
    key = _loops_api_key()
    if not key:
        return None
    if _loops_client is not None:
        return _loops_client
    _loops_client = httpx.AsyncClient(
        base_url=_LOOPS_API_ROOT,
        headers={"Authorization": f"Bearer {key}"},
        timeout=10.0,
    )
    return _loops_client


async def close_loops_client() -> None:
    """Shutdown hook -- call from the app shutdown event if wired."""
    global _loops_client
    if _loops_client is not None:
        await _loops_client.aclose()
        _loops_client = None


def record_org_admin_in_loops(
    email: str | None,
    org_slug: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
) -> None:
    """
    Fire-and-forget: ensure an org ADMIN is on the Loops marketing audience.

    Best-effort and non-blocking — safe to call from inside a request handler.
    No-op when the email is missing, when not in SaaS mode, or when
    ``LOOPS_API_KEY`` is unset.
    """
    if not email:
        return
    if _get_loops_client() is None:
        return
    task = asyncio.create_task(
        _record_org_admin(email, org_slug, first_name, last_name)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _record_org_admin(
    email: str,
    org_slug: str | None,
    first_name: str | None,
    last_name: str | None,
) -> None:
    client = _get_loops_client()
    if client is None:
        return

    # Contact properties — mirror apps/web/services/emails/loops.ts so both
    # sides upsert the same shape. update (PUT) upserts, so it's idempotent.
    properties: dict = {
        "email": email,
        "userGroup": _LOOPS_SIGNED_USERS_GROUP,
        "source": _LOOPS_SOURCE,
        "is_org_admin": True,
    }
    if org_slug:
        properties["org_slug"] = org_slug
    if first_name:
        properties["firstName"] = first_name
    if last_name:
        properties["lastName"] = last_name

    try:
        resp = await client.put("v1/contacts/update", json=properties)
        if resp.status_code >= 400:
            logger.warning(
                "Loops contact upsert failed (%s): %s",
                resp.status_code,
                resp.text[:200],
            )
    except Exception:
        logger.warning("Loops contact upsert errored for admin", exc_info=True)

    # Fire the segmentation event (best-effort; independent of the upsert).
    event: dict = {"email": email, "eventName": "became_org_admin"}
    if org_slug:
        event["eventProperties"] = {"org_slug": org_slug}
    try:
        resp = await client.post("v1/events/send", json=event)
        if resp.status_code >= 400:
            logger.warning(
                "Loops event send failed (%s): %s",
                resp.status_code,
                resp.text[:200],
            )
    except Exception:
        logger.warning("Loops event send errored for admin", exc_info=True)
