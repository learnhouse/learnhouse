"""Per-session focus state for the Atlas agent.

The agent works on one course at a time — this module stores that focus on
the MCP server between tool calls so the agent never has to thread UUIDs
itself. State is keyed by ``(user_uuid, org_id)`` instead of the bearer
token because Atlas rotates its session token roughly every 15 minutes
and we want focus to survive the rotation within a conversation.

Everything here is process-local. The MCP server is horizontally scalable
because there's no affinity requirement — a user whose next request lands
on a different instance simply won't see their previous focus, and the
agent will refocus transparently with one ``focus_course`` call.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from .runtime import get_current_ctx


# Focused-course snapshot cache TTL. Long enough to fuse a burst of
# selector calls into one underlying describe round-trip, short enough
# that an edit through another tab shows up without a full refresh.
_SNAPSHOT_TTL_SECONDS = 30.0
# Drop sessions that haven't been touched for this long. Keyed against the
# wall clock, not the TTL above.
_SESSION_IDLE_EXPIRY_SECONDS = 60 * 60  # 1 hour
# Cap the in-memory store so a buggy client can't grow it unbounded.
_MAX_SESSIONS = 10_000


@dataclass
class FocusedCourse:
    """The course the agent is currently operating on, plus a cached snapshot.

    The snapshot is the compact shape returned by the ``describe_course``
    tool: ``{course: {...}, chapters: [{id, name, activities: [{id, uuid,
    name, activity_type, ...}]}]}``. We cache it so selector resolution
    (name -> id/uuid) doesn't have to hit the API on every call.
    """

    course_uuid: str
    course_id: int
    course_name: str
    snapshot: dict[str, Any] = field(default_factory=dict)
    snapshot_taken_at: float = 0.0

    def snapshot_is_fresh(self) -> bool:
        return (
            bool(self.snapshot)
            and (time.monotonic() - self.snapshot_taken_at) < _SNAPSHOT_TTL_SECONDS
        )


@dataclass
class AtlasSession:
    focused: FocusedCourse | None = None
    last_seen_at: float = field(default_factory=time.monotonic)


_sessions: dict[tuple[str, int], AtlasSession] = {}
_lock = threading.Lock()


def _session_key() -> tuple[str, int]:
    """Key the focus state by (user_uuid, org_id) so token rotation doesn't
    wipe it. OrgContext is populated by the auth middleware on every
    request — this call raises if anyone reaches for focus state outside
    the HTTP flow, which is exactly what we want."""
    ctx = get_current_ctx()
    return (ctx.user_uuid, ctx.org_id)


def _gc_if_needed() -> None:
    """Drop idle sessions. Runs lazily on every access — no background
    task to manage. The caps are generous enough that this rarely does
    real work."""
    if len(_sessions) < _MAX_SESSIONS // 2:
        # Under half capacity: amortize by only GC'ing when we approach
        # the ceiling. Keeps the hot path fast.
        return
    cutoff = time.monotonic() - _SESSION_IDLE_EXPIRY_SECONDS
    stale = [k for k, s in _sessions.items() if s.last_seen_at < cutoff]
    for k in stale:
        _sessions.pop(k, None)


def get_session() -> AtlasSession:
    key = _session_key()
    with _lock:
        session = _sessions.get(key)
        if session is None:
            _gc_if_needed()
            session = AtlasSession()
            _sessions[key] = session
        session.last_seen_at = time.monotonic()
        return session


def set_focus(
    *, course_uuid: str, course_id: int, course_name: str, snapshot: dict[str, Any]
) -> FocusedCourse:
    session = get_session()
    session.focused = FocusedCourse(
        course_uuid=course_uuid,
        course_id=course_id,
        course_name=course_name,
        snapshot=snapshot,
        snapshot_taken_at=time.monotonic(),
    )
    return session.focused


def clear_focus() -> None:
    session = get_session()
    session.focused = None


def update_snapshot(snapshot: dict[str, Any]) -> None:
    """Refresh the cached snapshot for the currently focused course. Called
    by tools that mutate the tree so the agent's next read doesn't see
    stale data."""
    session = get_session()
    if session.focused is None:
        return
    session.focused.snapshot = snapshot
    session.focused.snapshot_taken_at = time.monotonic()


def invalidate_snapshot() -> None:
    """Force the next selector to re-fetch from the API. Cheaper than
    computing a full snapshot inside every write tool."""
    session = get_session()
    if session.focused is not None:
        session.focused.snapshot = {}
        session.focused.snapshot_taken_at = 0.0


class NoFocusError(RuntimeError):
    """Raised when a selector tool runs without a focused course. The
    agent's system prompt tells it to call focus_course first; this
    surfaces the failure cleanly when it doesn't."""


class AmbiguousSelectorError(RuntimeError):
    """A name matched more than one candidate. Carries the candidates so
    the tool can return them to the agent for disambiguation."""

    def __init__(self, kind: str, name: str, candidates: list[dict[str, Any]]):
        super().__init__(
            f"{kind} name {name!r} matched {len(candidates)} candidates — "
            "disambiguate with additional scope."
        )
        self.kind = kind
        self.name = name
        self.candidates = candidates


class NotFoundSelectorError(RuntimeError):
    """A name didn't match anything."""

    def __init__(self, kind: str, name: str, available: list[str]):
        super().__init__(f"{kind} named {name!r} not found in the focused course.")
        self.kind = kind
        self.name = name
        self.available = available


def require_focus() -> FocusedCourse:
    session = get_session()
    if session.focused is None:
        raise NoFocusError(
            "No course is focused. Call focus_course(name_or_uuid) first — "
            "the selector tools resolve chapter/activity names relative to "
            "a focused course."
        )
    return session.focused
