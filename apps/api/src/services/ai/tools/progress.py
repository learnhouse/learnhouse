"""Progress reports from long tools (bulk generation, many items).

A tool calls `report_progress(done, total, label)` as it goes. The caller
running the tool (Atlas) installs a reporter with `progress_reporter(fn)`
around the call to show a live "6 of 14" line; elsewhere (MCP, tests) it is
a no-op. Reporting never raises into the tool.
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
from typing import Callable, Iterator

logger = logging.getLogger(__name__)

Reporter = Callable[[int, int, str | None], None]
_reporter: contextvars.ContextVar[Reporter | None] = contextvars.ContextVar("ai_tool_progress", default=None)


def report_progress(done: int, total: int, label: str | None = None) -> None:
    fn = _reporter.get()
    if fn is None:
        return
    try:
        fn(int(done), int(total), label)
    except Exception:
        logger.debug("progress reporter failed", exc_info=True)


@contextlib.contextmanager
def progress_reporter(fn: Reporter | None) -> Iterator[None]:
    token = _reporter.set(fn)
    try:
        yield
    finally:
        _reporter.reset(token)
