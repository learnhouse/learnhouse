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


# Analytics events that are also audit log entries. Each is tracked from
# every code path that causes it (self-service, dashboard, admin API,
# completion), so the audit log reads them here rather than at each caller.
# (action, target type, property holding the target id)
_AUDITED_EVENTS = {
    "user_joined_org": ("members.joined", "user", None),
    "course_enrolled": ("enrollment.created", "course", "course_uuid"),
    "course_left": ("enrollment.removed", "course", "course_uuid"),
    "path_enrolled": ("enrollment.created", "path", "path_uuid"),
    "certificate_claimed": ("certificate.issued", "course", "course_uuid"),
    "certificate_revoked": ("certificate.revoked", "course", "course_uuid"),
    "payment_refunded": ("billing.payment_refunded", None, None),
}


def _audit_bridge(event_name: str, org_id: int, user_id: int, properties: dict | None) -> None:
    spec = _AUDITED_EVENTS.get(event_name)
    if spec is None:
        return
    action, target_type, id_key = spec
    props = dict(properties or {})
    target_id = props.pop(id_key, None) if id_key else (user_id if target_type == "user" else None)
    from src.core.ee_hooks import audit_event

    audit_event(
        None,
        action=action,
        org_id=org_id,
        target_type=target_type,
        target_id=target_id,
        details={**({"learner_id": user_id} if user_id and target_type != "user" else {}), **props},
        fallback_actor=user_id or None,
    )


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
    _audit_bridge(event_name, org_id, user_id, properties)
    from src.security.impersonation import is_impersonating

    if is_impersonating():
        # An impersonation acting as a member is not that member's
        # activity: it stays out of the org's analytics (the audit entry above
        # still records what happened, attributed to support).
        return
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
