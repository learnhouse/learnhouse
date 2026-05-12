"""Shared search-term normalization helpers.

Kept in its own module so any service that builds a LIKE/ILIKE pattern can
reuse it without pulling in `services/search/search.py` (which itself depends
on `services/courses/courses.py`, creating a cycle if imported the other way).
"""

import unicodedata
from typing import Optional


# Escape character used by `build_like_pattern` when emitting `\%` / `\_` / `\\`.
# Pass this to `column.ilike(pattern, escape=LIKE_ESCAPE_CHAR)` so the database
# treats the escaped sequence as a literal — without it, `\%` is read as
# (literal `\`) + (wildcard `%`) and our escape function is purely cosmetic.
LIKE_ESCAPE_CHAR = "\\"


def normalize_search_term(query: Optional[str]) -> str:
    """Normalize a user-supplied search term for consistent matching.

    Stored text and the query can otherwise differ in unicode form (NFC vs
    NFD), making emoji with modifiers (skin tones, ZWJ family sequences) and
    accented characters silently fail to match under LIKE/ILIKE. NFC on both
    sides — plus a strip — keeps the comparison consistent.
    """
    if not query:
        return ""
    return unicodedata.normalize("NFC", query).strip()


def escape_like_wildcards(query: str) -> str:
    """Escape SQL LIKE wildcards so user input can't be interpreted as a pattern.

    Order matters: backslash must be escaped first, otherwise `%` -> `\\%`
    would itself be re-escaped to `\\\\%` on the next pass.
    """
    return query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_like_pattern(query: Optional[str]) -> str:
    """Normalize, escape, and wrap a term as a substring LIKE/ILIKE pattern."""
    return f"%{escape_like_wildcards(normalize_search_term(query))}%"
