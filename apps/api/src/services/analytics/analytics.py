"""Analytics tracking hook.

Org analytics is an Enterprise Edition feature: the event writer, storage,
dashboards and the browser beacon live in EE. Core code still calls
``track()`` wherever something worth counting happens; it forwards the event
to EE when EE is installed and does nothing otherwise. Event names come from
the catalog in ``events.py``.

``track()`` never raises and never blocks on storage: analytics must not break
the request that triggered it.
"""

import logging

from src.core.ee_hooks import track_ee_analytics_event

logger = logging.getLogger(__name__)


async def track(
    event_name: str,
    org_id: int,
    user_id: int = 0,
    session_id: str = "",
    properties: dict | None = None,
    source: str = "api",
    actor_key: str | None = None,
    country: str | None = None,
    device: str | None = None,
) -> None:
    """Record an analytics event with EE. A no-op without EE; never raises."""
    try:
        await track_ee_analytics_event(
            event_name=event_name,
            org_id=org_id,
            user_id=user_id,
            session_id=session_id,
            properties=properties,
            source=source,
            actor_key=actor_key,
            country=country,
            device=device,
        )
    except Exception:
        logger.warning("Could not record analytics event %s", event_name, exc_info=True)
