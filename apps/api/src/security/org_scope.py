"""Request-scoped organization boundary.

Some callers act for one organization only: an app connected over MCP was
approved for a single org, and the in-app agent works inside the org it was
opened in. A member who also belongs to other organizations must not be able
to reach those through such a caller, even though their own account could.

While a boundary is set, `check_resource_access` refuses every resource that
belongs to another organization. The services keep their own checks; this
only narrows what they can be asked about.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Iterator, Optional

_current: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
    "org_scope", default=None
)


def get_org_scope() -> Optional[int]:
    return _current.get()


@contextmanager
def org_scope(org_id: Optional[int]) -> Iterator[None]:
    """Bound everything inside the block to `org_id` (None lifts nothing)."""
    token = _current.set(org_id)
    try:
        yield
    finally:
        _current.reset(token)
