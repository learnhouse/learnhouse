"""Locating blocks in a page without node ids (pure, unit tested).

A page is a ProseMirror document: ``{"type": "doc", "content": [block, ...]}``.
Its blocks carry no stable id, so a suggestion or a credit points at blocks
by a **fingerprint** (type + normalized text, or the settings of a block with
no text) plus the top-level index it was seen at. Locating is: the run of
blocks with the wanted fingerprints nearest that index. This is the same
scheme the AI editor uses for its proposals (web
``Editor/AI/engine/proposals.ts``) and the one the learner page mirrors in
``Contributions/blockKeys.ts`` (both work from JSON, so they agree).

When a block was edited since, its fingerprint changes. Credits then fall
back to a fuzzy match (same type, similar text, nearby) so they survive
ordinary edits; suggestions don't (the reviewer decides, see ``place``).
"""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

FP_TEXT_MAX = 500
FP_ATTRS_MAX = 600
# Attributes regenerated on copy (ids), not part of what a block says.
VOLATILE_ATTRS = frozenset({"id", "quizId", "blockId", "uuid", "question_id", "answer_id"})
# How alike two texts must be for a credit to follow an edited block.
FUZZY_THRESHOLD = 0.6
# How far (in blocks) a fuzzy match may be from where the block was.
FUZZY_WINDOW = 12
MAX_DEPTH = 40
SAFE_SCHEMES = frozenset({"http", "https", "mailto", "tel", ""})
# Attributes that hold a URL (links, images, embeds, buttons). Also any key
# ending in "url"/"href"/"src", at any depth (see _clean_value).
URL_ATTRS = frozenset({"href", "src", "url", "link", "embedUrl"})
# Blocks that render raw HTML or third-party code: contributors may keep,
# move or remove them, never create or change them.
RESTRICTED_TYPES = frozenset({"blockEmbed", "blockMagic", "blockH5P"})
_UNSAFE_VALUE = re.compile(r"^\s*(javascript|vbscript|data:text/html)", re.IGNORECASE)

_WS = re.compile(r"\s+")


def _norm(text: str) -> str:
    return _WS.sub(" ", text).strip().lower()


def text_of(node: Any) -> str:
    """All the text of a node, joined without separators (ProseMirror's
    ``textContent``)."""
    if not isinstance(node, dict):
        return ""
    text = node.get("text")
    if isinstance(text, str):
        return text
    content = node.get("content")
    if not isinstance(content, list):
        return ""
    return "".join(text_of(c) for c in content)


def _stable_attrs(attrs: Any) -> str:
    if not isinstance(attrs, dict):
        return ""
    keys = sorted(
        k for k, v in attrs.items()
        if k not in VOLATILE_ATTRS and v is not None and v != ""
    )
    if not keys:
        return ""
    try:
        return json.dumps([[k, attrs[k]] for k in keys], separators=(",", ":"), ensure_ascii=False)[:FP_ATTRS_MAX]
    except (TypeError, ValueError):
        return ",".join(keys)


def fingerprint(node: Any) -> str:
    """What identifies a block: its type and text, or its settings."""
    if not isinstance(node, dict):
        return "?|"
    kind = str(node.get("type") or "?")
    text = _norm(text_of(node))
    if text:
        return f"{kind}|{text[:FP_TEXT_MAX]}"
    return f"{kind}|#{_stable_attrs(node.get('attrs'))}"


def blocks_of(doc: Any) -> list[dict]:
    if not isinstance(doc, dict):
        return []
    content = doc.get("content")
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def fingerprints(blocks: Iterable[dict]) -> list[str]:
    return [fingerprint(b) for b in blocks]


def _nearest(candidates: list[int], target: int) -> Optional[int]:
    if not candidates:
        return None
    return min(candidates, key=lambda c: (abs(c - target), c))


def locate_run(fps: list[str], want: list[str], target: int) -> Optional[int]:
    """Start index of the run of ``want`` in ``fps`` nearest ``target``."""
    if not want:
        return None
    n = len(want)
    starts = [i for i in range(len(fps) - n + 1) if fps[i:i + n] == want]
    return _nearest(starts, target)


def locate_insert(fps: list[str], prev_fp: Optional[str], target: int) -> Optional[int]:
    """Where an insert goes: right after its previous block (nearest the
    target), or at the top when it was made at the top."""
    if not prev_fp:
        return 0 if target == 0 else None
    found = [i + 1 for i, f in enumerate(fps) if f == prev_fp]
    return _nearest(found, target)


def similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def _fp_type(fp: str) -> str:
    return fp.split("|", 1)[0]


def _fp_body(fp: str) -> str:
    return fp.split("|", 1)[1] if "|" in fp else ""


def fuzzy_locate(fps: list[str], fp: str, target: int) -> Optional[int]:
    """The block ``fp`` most likely became: same type, text at least
    ``FUZZY_THRESHOLD`` alike, within ``FUZZY_WINDOW`` of ``target``."""
    if fp in fps:
        return _nearest([i for i, f in enumerate(fps) if f == fp], target)
    kind, body = _fp_type(fp), _fp_body(fp)
    if body.startswith("#"):
        # A block without text: only the same settings identify it.
        return None
    best: tuple[float, int] | None = None
    lo, hi = max(0, target - FUZZY_WINDOW), min(len(fps), target + FUZZY_WINDOW + 1)
    for i in range(lo, hi):
        if _fp_type(fps[i]) != kind:
            continue
        score = similarity(body, _fp_body(fps[i]))
        if score >= FUZZY_THRESHOLD and (best is None or score > best[0] or (score == best[0] and abs(i - target) < abs(best[1] - target))):
            best = (score, i)
    return best[1] if best else None


def best_region(blocks: list[dict], before: list[dict], target: int) -> tuple[int, list[dict]]:
    """For a reviewer comparing a suggestion that no longer fits: the part of
    the page that looks most like what it replaced."""
    n = max(1, len(before))
    if not blocks:
        return 0, []
    want = " ".join(_norm(text_of(b)) for b in before)
    best = (-1.0, min(max(0, target), max(0, len(blocks) - n)))
    lo = max(0, target - FUZZY_WINDOW)
    hi = min(len(blocks) - n, target + FUZZY_WINDOW)
    for i in range(lo, hi + 1):
        got = " ".join(_norm(text_of(b)) for b in blocks[i:i + n])
        score = similarity(want, got)
        if score > best[0]:
            best = (score, i)
    start = best[1]
    return start, blocks[start:start + n]


# ─── validation ──────────────────────────────────────────────────────────────


def _safe_url(value: Any) -> bool:
    if not isinstance(value, str):
        return True
    v = value.strip()
    if not v:
        return True
    try:
        scheme = urlparse(v).scheme.lower()
    except ValueError:
        return False
    return scheme in SAFE_SCHEMES


def _url_key(key: str) -> bool:
    k = key.lower()
    return key in URL_ATTRS or k.endswith(("url", "href", "src"))


def _clean_value(value: Any, depth: int) -> tuple[bool, Any]:
    """(keep, value): drops unsafe URLs and script-like strings at any depth
    of an attribute value (lists and nested objects included)."""
    if depth > MAX_DEPTH:
        return False, None
    if isinstance(value, str):
        return (not _UNSAFE_VALUE.match(value)), value
    if isinstance(value, list):
        out = []
        for item in value:
            keep, v = _clean_value(item, depth + 1)
            if keep:
                out.append(v)
        return True, out
    if isinstance(value, dict):
        out_d = {}
        for k, v in value.items():
            if not isinstance(k, str):
                continue
            if _url_key(k) and not _safe_url(v):
                continue
            keep, cv = _clean_value(v, depth + 1)
            if keep:
                out_d[k] = cv
        return True, out_d
    return True, value


def _restricted(nodes: Iterable[Any]) -> list[str]:
    out: list[str] = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        if n.get("type") in RESTRICTED_TYPES:
            out.append(json.dumps(n, sort_keys=True))
        out.extend(_restricted(n.get("content") or []))
    return out


def new_restricted_nodes(before: list[dict], after: list[dict]) -> list[str]:
    """Restricted blocks in ``after`` that aren't exactly one of ``before``."""
    existing = _restricted(before)
    added = []
    for n in _restricted(after):
        if n in existing:
            existing.remove(n)
        else:
            added.append(n)
    return added


def clean_node(node: Any, depth: int = 0) -> Optional[dict]:
    """A copy of a suggested node that keeps only the JSON shape ProseMirror
    uses, and drops link marks and URL attributes with unsafe schemes
    (``javascript:``, ``data:``). Returns None for something that is not a
    node."""
    if depth > MAX_DEPTH or not isinstance(node, dict):
        return None
    kind = node.get("type")
    if not isinstance(kind, str) or not kind or len(kind) > 64:
        return None
    out: dict = {"type": kind}
    attrs = node.get("attrs")
    if isinstance(attrs, dict):
        _keep, clean_attrs = _clean_value(attrs, depth)
        out["attrs"] = clean_attrs
    text = node.get("text")
    if isinstance(text, str):
        out["text"] = text
    marks = node.get("marks")
    if isinstance(marks, list):
        kept = []
        for m in marks:
            if not isinstance(m, dict) or not isinstance(m.get("type"), str):
                continue
            mattrs = m.get("attrs") if isinstance(m.get("attrs"), dict) else None
            if mattrs and not all(_safe_url(v) for k, v in mattrs.items() if isinstance(k, str) and _url_key(k)):
                continue
            if mattrs:
                mattrs = _clean_value(mattrs, depth)[1]
            kept.append({"type": m["type"], **({"attrs": mattrs} if mattrs else {})})
        if kept:
            out["marks"] = kept
    content = node.get("content")
    if isinstance(content, list):
        out["content"] = [c for c in (clean_node(x, depth + 1) for x in content) if c is not None]
    return out


def clean_blocks(blocks: Iterable[Any]) -> list[dict]:
    return [b for b in (clean_node(x) for x in blocks) if b is not None]


def same_blocks(a: list[dict], b: list[dict]) -> bool:
    return fingerprints(a) == fingerprints(b) and json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


# ─── summaries ───────────────────────────────────────────────────────────────

_TYPE_LABELS = {
    "paragraph": "paragraph",
    "heading": "heading",
    "bulletList": "list",
    "orderedList": "list",
    "taskList": "list",
    "blockquote": "quote",
    "codeBlock": "code block",
    "table": "table",
    "blockImage": "image",
    "blockVideo": "video",
    "blockQuiz": "quiz",
    "calloutInfo": "callout",
    "calloutWarning": "callout",
    "callout": "callout",
}


def block_label(node: dict) -> str:
    kind = str(node.get("type") or "block")
    return _TYPE_LABELS.get(kind, re.sub(r"(?<!^)(?=[A-Z])", " ", kind).lower())


def _snippet(blocks: list[dict], limit: int = 80) -> str:
    text = " ".join(_WS.sub(" ", text_of(b)).strip() for b in blocks).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def summarize(before: list[dict], after: list[dict]) -> str:
    """One plain line for lists and notifications: what changed, where."""
    if before and not after:
        what = block_label(before[0]) if len(before) == 1 else f"{len(before)} blocks"
        snip = _snippet(before)
        return f"Removes {what}" + (f": “{snip}”" if snip else "")
    if after and not before:
        what = block_label(after[0]) if len(after) == 1 else f"{len(after)} blocks"
        snip = _snippet(after)
        return f"Adds {what}" + (f": “{snip}”" if snip else "")
    what = block_label(before[0]) if len(before) == 1 else f"{len(before)} blocks"
    snip = _snippet(after) or _snippet(before)
    return f"Edits {what}" + (f": “{snip}”" if snip else "")
