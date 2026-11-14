"""Sanitizing the rich text of a learner note.

Notes are TipTap documents. Only the small schema the notes editor offers is
kept (paragraphs, headings, lists, checkboxes, quotes, bold / italic / strike /
code, links); any other node or mark is dropped, every attribute that isn't on
the list is removed, and links keep only safe targets. The browser renders the
result through the same TipTap schema, never as raw HTML.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import HTTPException

from src.db.learner_notes import CONTENT_MAX_BYTES, PLAIN_TEXT_MAX

MAX_DEPTH = 12
MAX_NODES = 4_000
TEXT_NODE_MAX = 10_000
HREF_MAX = 2_000

# node type -> allowed attributes (and their sanitizer)
_BLOCKS_WITH_CHILDREN = {
    "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem",
    "taskList", "taskItem", "blockquote",
}
_LEAVES = {"text", "hardBreak", "horizontalRule"}
_MARKS = {"bold", "italic", "strike", "code", "link"}
_SAFE_SCHEMES = ("http://", "https://", "mailto:")


def _safe_href(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    href = value.strip()
    if not href or len(href) > HREF_MAX:
        return None
    lowered = href.lower()
    if lowered.startswith(_SAFE_SCHEMES):
        return href
    # In-app links: a path on this site or a spot on the page. "//host" is a
    # protocol-relative link to somewhere else and is refused.
    if (href.startswith("/") and not href.startswith("//")) or href.startswith("#"):
        return href
    return None


def _clean_marks(marks: Any) -> list[dict]:
    out: list[dict] = []
    if not isinstance(marks, list):
        return out
    seen: set[str] = set()
    for mark in marks:
        kind = mark.get("type") if isinstance(mark, dict) else None
        if kind not in _MARKS or kind in seen:
            continue
        if kind == "link":
            href = _safe_href((mark.get("attrs") or {}).get("href"))
            if not href:
                continue
            out.append({"type": "link", "attrs": {"href": href}})
        else:
            out.append({"type": kind})
        seen.add(kind)
    return out


def _clean_attrs(kind: str, attrs: Any) -> Optional[dict]:
    attrs = attrs if isinstance(attrs, dict) else {}
    if kind == "heading":
        level = attrs.get("level")
        return {"level": level if level in (1, 2, 3) else 3}
    if kind == "orderedList":
        start = attrs.get("start")
        return {"start": start if isinstance(start, int) and 0 <= start <= 10_000 else 1}
    if kind == "taskItem":
        return {"checked": attrs.get("checked") is True}
    return None


class _Budget:
    def __init__(self) -> None:
        self.nodes = 0


def _clean_node(node: Any, depth: int, budget: _Budget) -> Optional[dict]:
    if not isinstance(node, dict) or depth > MAX_DEPTH:
        return None
    budget.nodes += 1
    if budget.nodes > MAX_NODES:
        raise HTTPException(status_code=413, detail="Note is too long")
    kind = node.get("type")
    if kind == "text":
        text = node.get("text")
        if not isinstance(text, str) or not text:
            return None
        out: dict = {"type": "text", "text": text[:TEXT_NODE_MAX]}
        marks = _clean_marks(node.get("marks"))
        if marks:
            out["marks"] = marks
        return out
    if kind in _LEAVES:
        return {"type": kind}
    if kind not in _BLOCKS_WITH_CHILDREN:
        return None
    out = {"type": kind}
    attrs = _clean_attrs(kind, node.get("attrs"))
    if attrs is not None:
        out["attrs"] = attrs
    children = node.get("content")
    if isinstance(children, list):
        cleaned = [c for c in (_clean_node(child, depth + 1, budget) for child in children) if c]
        if cleaned:
            out["content"] = cleaned
    return out


def sanitize_note_content(content: Any) -> dict:
    """Return a safe TipTap document; an unusable payload becomes an empty doc."""
    if not isinstance(content, dict):
        return {"type": "doc", "content": []}
    if len(json.dumps(content, separators=(",", ":"))) > CONTENT_MAX_BYTES * 2:
        raise HTTPException(status_code=413, detail="Note is too long")
    root = dict(content, type="doc")
    cleaned = _clean_node(root, 0, _Budget()) or {"type": "doc"}
    cleaned.setdefault("content", [])
    if len(json.dumps(cleaned, separators=(",", ":"))) > CONTENT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Note is too long")
    return cleaned


_BLOCK_BREAK = {"paragraph", "heading", "listItem", "taskItem", "blockquote", "horizontalRule"}


def note_plain_text(content: dict) -> str:
    """The note's words, one line per block, for search and the word count."""
    parts: list[str] = []

    def walk(node: dict) -> None:
        kind = node.get("type")
        if kind == "text":
            parts.append(node.get("text", ""))
        elif kind == "hardBreak":
            parts.append("\n")
        for child in node.get("content") or []:
            walk(child)
        if kind in _BLOCK_BREAK:
            parts.append("\n")

    walk(content)
    lines = [line.strip() for line in "".join(parts).split("\n")]
    return "\n".join(line for line in lines if line)[:PLAIN_TEXT_MAX]
