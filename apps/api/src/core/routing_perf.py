"""Skip included routers whose prefix cannot match the request path.

FastAPI keeps every ``include_router`` as a nested branch and, to find the
endpoint for a request, asks each branch in turn whether it matches. A branch
answers by trying every route it holds, and the same walk runs again one level
down when the request is handed to it. With ~1,700 routes that was several
milliseconds of regex matching per request before any endpoint code ran, more
for routes registered late, and a 404 paid for all of them.

Every route in a branch starts with the branch's full prefix (FastAPI builds
each route path as ``prefix + path``), so a request path without that prefix can
never match anything inside it. Answering "no match" up front gives exactly the
result the full walk would have, minus the walk.

Applied once at import of ``app.py``. If a FastAPI upgrade renames the internals
this relies on, it does nothing and routing works as before, just slower.
"""

from __future__ import annotations

import logging

from starlette._utils import get_route_path
from starlette.routing import Match

logger = logging.getLogger(__name__)

_PATCHED_FLAG = "_lh_prefix_short_circuit"


def install_router_prefix_short_circuit() -> bool:
    """Patch FastAPI's included-router matcher. Returns True when applied."""
    try:
        from fastapi import routing as fastapi_routing

        included = fastapi_routing._IncludedRouter
        original = included.matches
    except AttributeError:
        logger.info("FastAPI router internals changed; prefix short-circuit not installed")
        return False

    if getattr(original, _PATCHED_FLAG, False):
        return True

    def matches(self, scope):  # type: ignore[no-untyped-def]
        context = getattr(self, "include_context", None)
        prefix = getattr(context, "prefix", "") or ""
        if prefix and scope.get("type") in ("http", "websocket"):
            if not get_route_path(scope).startswith(prefix):
                return Match.NONE, {}
        return original(self, scope)

    setattr(matches, _PATCHED_FLAG, True)
    matches.__wrapped__ = original  # type: ignore[attr-defined]
    included.matches = matches
    return True
