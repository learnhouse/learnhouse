"""Dates as people read them in an email: "2 December 2026", never "2026-12-02"."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional, Union


def human_date(value: Optional[Union[date, datetime, str]]) -> str:
    """``2 December 2026`` for a date, datetime or ISO string; "" when empty.

    A string that is not an ISO date is returned unchanged, so a value that
    was already formatted passes through.
    """
    if not value:
        return ""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return f"{value.day} {value.strftime('%B %Y')}"
