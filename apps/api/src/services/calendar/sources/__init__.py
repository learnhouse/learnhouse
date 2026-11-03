"""Calendar source registry.

A source is ``async def fn(ctx: CalendarContext) -> list[CalendarEvent]`` that
returns the events of one kind the current user may see inside ``ctx``'s
window. It is responsible for its own access checks. Register it with
``register_source(fn)`` (usable as a decorator); EE adds its own sources
through ``register_ee_calendar_sources`` below.
"""

from __future__ import annotations

from typing import Awaitable, Callable, Optional

from src.services.calendar.types import CalendarContext, CalendarEvent

CalendarSource = Callable[[CalendarContext], Awaitable[list[CalendarEvent]]]

_SOURCES: dict[str, CalendarSource] = {}


def register_source(fn: CalendarSource, *, key: Optional[str] = None) -> CalendarSource:
    """Add a source. Registering the same key again replaces it, so a module
    imported twice does not produce duplicate events."""
    _SOURCES[key or f"{fn.__module__}.{fn.__qualname__}"] = fn
    return fn


def unregister_source(key: str) -> None:
    _SOURCES.pop(key, None)


def registered_sources() -> dict[str, CalendarSource]:
    return dict(_SOURCES)


# Register the built-in sources.
from src.services.calendar.sources import assignments, courses, podcasts  # noqa: E402,F401
from src.core.ee_hooks import register_ee_calendar_sources  # noqa: E402

register_ee_calendar_sources()
