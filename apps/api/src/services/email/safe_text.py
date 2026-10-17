"""Render-time scrubbing of user/org-controlled text that lands in an email.

Names are stored data an attacker can control (an org admin types the org
name, anyone picks a username), so before they reach a template they are
reduced to link-free text, and anything bound for a header loses its line
breaks.
"""

import re
from typing import Optional

from src.services.security.profile_validation import sanitize_display_name

_HEADER_BREAKS = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")
_WHITESPACE_RUN = re.compile(r"\s+")


def email_org_name(value: Optional[str]) -> str:
    """Link-free org name for email copy and subjects."""
    return sanitize_display_name(value, fallback="A LearnHouse organization")


def email_user_name(value: Optional[str]) -> str:
    """Link-free user display name for email copy and subjects."""
    return sanitize_display_name(value)


def header_safe(value: Optional[str]) -> str:
    """Strip CR/LF and other control characters from a header value."""
    if not value:
        return ""
    return _WHITESPACE_RUN.sub(" ", _HEADER_BREAKS.sub(" ", str(value))).strip()
