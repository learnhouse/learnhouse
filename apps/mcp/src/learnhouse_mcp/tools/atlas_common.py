"""Shared helpers for Atlas MCP tools.

Atlas tools share a few conventions:
  - Tier/meta annotations (so the API-side ToolProxy can build typed specs).
  - Consistent error shape: ``{ok: false, code, message, retriable, details}``.
  - Consistent success shape for ``propose_*``: ``{ok: true, preview: {...}}``.
  - Consistent success shape for ``apply_*``: ``{ok: true, target, version_after, undo_token}``.
  - Markdown→Tiptap conversion (re-exports from ``activities`` for now).
"""

from __future__ import annotations

from typing import Any, Optional

# Tier strings as plain literals so the Atlas tool registrations stay readable
# without an extra Enum import.
TIER_READ = "READ"
TIER_CREATE = "CREATE"
TIER_EDIT = "EDIT"
TIER_DESTRUCTIVE = "DESTRUCTIVE"


def tier_meta(
    tier: str,
    *,
    is_apply: bool = False,
    requires_preview: Optional[bool] = None,
    requires_challenge: Optional[bool] = None,
) -> dict[str, Any]:
    """Build the ``_meta`` dict an Atlas MCP tool registers with.

    Defaults follow the rules in the rewrite plan: non-READ propose_*
    tools require a preview; DESTRUCTIVE tools require a typed challenge.
    """
    if requires_preview is None:
        requires_preview = tier != TIER_READ and not is_apply
    if requires_challenge is None:
        requires_challenge = tier == TIER_DESTRUCTIVE
    return {
        "atlas.tier": tier,
        "atlas.is_apply": is_apply,
        "atlas.requires_preview": requires_preview,
        "atlas.requires_challenge": requires_challenge,
    }


def error(
    code: str, message: str, *, retriable: bool = False, **details: Any
) -> dict[str, Any]:
    """Return the canonical Atlas tool-error payload."""
    return {
        "ok": False,
        "code": code,
        "message": message,
        "retriable": retriable,
        **({"details": details} if details else {}),
    }


def from_upstream_http_error(exc: Exception) -> dict[str, Any]:
    """Translate an httpx/HTTPException into the Atlas error shape.

    Best-effort: pulls status from the exception when present and maps
    well-known codes to stable Atlas codes the UI / pipeline recognize.
    """
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    msg = str(exc) or "Upstream LearnHouse API error."
    mapping = {
        400: ("invalid_argument", False),
        401: ("unauthorized", False),
        403: ("forbidden", False),
        404: ("not_found", False),
        409: ("conflict", False),
        422: ("invalid_argument", False),
        429: ("rate_limited", True),
        500: ("internal_error", True),
        502: ("upstream_unavailable", True),
        503: ("upstream_unavailable", True),
        504: ("upstream_unavailable", True),
    }
    code, retriable = mapping.get(int(status) if status else 0, ("internal_error", False))
    return error(code, msg, retriable=retriable, http_status=status)


# Pull the markdown→Tiptap helpers from ``activities.py`` rather than
# duplicating them. This keeps a single source of truth for Tiptap node
# shapes the frontend renders.
from .activities import _markdown_to_tiptap as markdown_to_tiptap  # noqa: E402,F401
