"""Circuit breaker so a Brand Center outage never blocks AI generation (fail-open)."""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

OPEN_SECONDS = 300.0

_lock = threading.Lock()
_open_until = 0.0
_last_logged = 0.0


def _now() -> float:
    return time.monotonic()


def is_open() -> bool:
    return _now() < _open_until


def trip(reason: str) -> None:
    """Open the breaker for ``OPEN_SECONDS``; log once per window. ``reason`` is an error type only."""
    global _open_until, _last_logged
    with _lock:
        now = _now()
        _open_until = now + OPEN_SECONDS
        if now - _last_logged >= OPEN_SECONDS or _last_logged == 0.0:
            _last_logged = now
            logger.warning(
                "MKA_BRAND_MCP_DOWN reason=%s; continuing without Brand Center tools for %ds",
                reason,
                int(OPEN_SECONDS),
            )


def reset() -> None:
    global _open_until, _last_logged
    with _lock:
        _open_until = 0.0
        _last_logged = 0.0
