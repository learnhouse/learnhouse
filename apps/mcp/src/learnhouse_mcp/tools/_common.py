"""Shared helpers for write/destructive/macro tools."""

import re
import uuid
from typing import Any

from ..errors import AtlasToolError
from ..schemas import PreviewEnvelope, ResourceRef


def new_pending_id() -> str:
    return uuid.uuid4().hex


def envelope(
    *,
    tool: str,
    tier: str,
    target: ResourceRef,
    mode: str,
    summary: str,
    patch: dict[str, Any] | None = None,
    proposed: dict[str, Any] | None = None,
    current: dict[str, Any] | None = None,
    requires_confirmation: bool = False,
    expected_version: int | None = None,
    blast_radius: dict[str, Any] | None = None,
) -> dict[str, Any]:
    env = PreviewEnvelope(
        pending_id=new_pending_id(),
        tool=tool,
        tier=tier,
        target=target,
        mode=mode,
        summary=summary,
        patch=patch,
        proposed=proposed,
        current=current,
        requires_confirmation=requires_confirmation,
        expected_version=expected_version,
        blast_radius=blast_radius,
    )
    return env.model_dump(exclude_none=False)


_YOUTUBE_PATTERNS = [
    re.compile(r"^https?://(?:www\.)?youtube\.com/watch\?v=([A-Za-z0-9_-]{11})"),
    re.compile(r"^https?://youtu\.be/([A-Za-z0-9_-]{11})"),
    re.compile(r"^https?://(?:www\.)?youtube\.com/embed/([A-Za-z0-9_-]{11})"),
    re.compile(r"^https?://(?:www\.)?youtube\.com/shorts/([A-Za-z0-9_-]{11})"),
]


def parse_youtube_id(url: str) -> str:
    for pat in _YOUTUBE_PATTERNS:
        m = pat.match(url.strip())
        if m:
            return m.group(1)
    raise AtlasToolError(
        code="INVALID_YOUTUBE_URL",
        message=f"Not a recognized YouTube URL: {url}",
    )


def diff_keys(patch: dict[str, Any]) -> list[str]:
    """Keys with non-None values — used to summarize what an update touches."""
    return [k for k, v in patch.items() if v is not None]


def first_text(content: dict | None, limit: int = 200) -> str:
    """Pull the first chunk of plain text from a Tiptap doc for preview blurbs."""
    if not isinstance(content, dict):
        return ""
    out: list[str] = []
    remaining = [content]
    while remaining and sum(len(s) for s in out) < limit:
        node = remaining.pop(0)
        if not isinstance(node, dict):
            continue
        if node.get("type") == "text" and isinstance(node.get("text"), str):
            out.append(node["text"])
        for child in node.get("content", []) or []:
            remaining.append(child)
    joined = " ".join(out).strip()
    return joined[:limit] + ("…" if len(joined) > limit else "")
