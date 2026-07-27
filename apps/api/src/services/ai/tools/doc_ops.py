"""Pure, deterministic operations on a TipTap/ProseMirror activity document.

A document is ``{"type": "doc", "content": [ ...block nodes... ]}``. Nodes are
addressed by a ``path`` (list of ints) into the tree: ``[i]`` is the i-th
top-level block, ``[i, j]`` is the j-th child of block i (a listItem in a
list, a cell in a table row, ...).

Every function here is side-effect-free on its inputs unless documented as a
mutator; mutators change a node dict in place. The tool layer
(content_edit.py) reads the doc, applies one of these, re-validates, and
writes the whole doc back through ``update_activity`` (which snapshots a
version). Keeping nodes schema-valid matters: ProseMirror drops malformed
nodes (e.g. empty text nodes) on the next load.
"""

from __future__ import annotations

from typing import Any

# Blocks whose payload lives entirely in ``attrs`` (no child ``content``).
ATOM_BLOCKS = {
    "blockQuiz",
    "blockMagic",
    "blockImage",
    "blockVideo",
    "blockAudio",
    "blockPDF",
    "blockMathEquation",
    "blockEmbed",
    "blockWebPreview",
    "blockUser",
    "blockCode",
    "scenarios",
    "flipcard",
}

# Blocks holding inline text directly (``content: 'text*'`` — no paragraph wrapper).
TEXT_CONTENT_BLOCKS = {"callout", "calloutInfo", "calloutWarning", "badge", "button"}

# Prose leaves that hold inline text under ``content``.
TEXT_LEAF_BLOCKS = {"paragraph", "heading"}

# Nodes that may hold text runs directly (set_text / replace_runs targets).
_TEXT_HOLDERS = TEXT_LEAF_BLOCKS | TEXT_CONTENT_BLOCKS

# Blocks with a document-stable id attr (opportunistic; addressing is positional).
_STABLE_ID_ATTR = {"blockMagic": "blockUuid", "blockQuiz": "quizId"}


class PathError(ValueError):
    """Raised when a path can't be resolved (out of range / not a container)."""


class DocError(ValueError):
    """Raised when a document/node fails schema validation."""


def ensure_doc(content: Any) -> dict:
    """Coerce stored content into a well-formed empty-able doc envelope."""
    if isinstance(content, dict) and content.get("type") == "doc" and isinstance(
        content.get("content"), list
    ):
        return content
    return {"type": "doc", "content": []}


# ─── navigation ─────────────────────────────────────────────────────────────


def resolve_path(doc: dict, path: list[int]) -> tuple[list, int, dict]:
    """Return (parent_content_list, index_in_parent, node) for ``path``.

    ``path`` must be a non-empty list of ints. Raises PathError on an empty
    path, an out-of-range index, or descent into a node with no ``content``.
    """
    if not isinstance(path, list) or not path or not all(isinstance(i, int) for i in path):
        raise PathError(f"Invalid path {path!r}: expected a non-empty list of ints")
    parent = doc.get("content")
    if not isinstance(parent, list):
        raise PathError("Document has no content array")
    node = None
    for depth, idx in enumerate(path):
        if not isinstance(parent, list):
            raise PathError(f"Path {path} descends into a node with no children at depth {depth}")
        if idx < 0 or idx >= len(parent):
            raise PathError(f"Path {path} index {idx} out of range at depth {depth} (len {len(parent)})")
        node = parent[idx]
        if depth < len(path) - 1:
            child = node.get("content") if isinstance(node, dict) else None
            if not isinstance(child, list):
                raise PathError(f"Path {path} cannot descend into '{_type(node)}' at depth {depth} (not a container)")
            parent = child
    return parent, path[-1], node


def get_node(doc: dict, path: list[int]) -> dict:
    return resolve_path(doc, path)[2]


# ─── previews / outline ─────────────────────────────────────────────────────


def _type(node: Any) -> str:
    return node.get("type", "?") if isinstance(node, dict) else "?"


def node_text(node: Any) -> str:
    """Concatenate all descendant text runs' text (for previews + anchors)."""
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text", "")
    return "".join(node_text(c) for c in node.get("content", []) or [])


def _truncate(s: str, n: int = 160) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def preview(node: dict) -> dict:
    """A compact, human/agent-readable summary of a single node."""
    t = _type(node)
    attrs = node.get("attrs") or {}
    out: dict[str, Any] = {"type": t}
    stable = _STABLE_ID_ATTR.get(t)
    if stable and attrs.get(stable):
        out["stable_id"] = attrs[stable]
    if t == "heading":
        out["level"] = attrs.get("level")
        out["text"] = _truncate(node_text(node))
    elif t in _TEXT_HOLDERS:
        out["text"] = _truncate(node_text(node))
        if t == "callout":
            out["callout_type"] = attrs.get("type")
    elif t in ("bulletList", "orderedList"):
        out["items"] = [_truncate(node_text(li), 80) for li in node.get("content", []) or []]
    elif t == "blockQuiz":
        qs = attrs.get("questions") or []
        out["summary"] = f"{len(qs)} question(s): " + "; ".join(
            _truncate(q.get("question", ""), 60) for q in qs[:3]
        )
    elif t == "flipcard":
        out["summary"] = f"Q: {_truncate(attrs.get('question',''),60)} / A: {_truncate(attrs.get('answer',''),60)}"
    elif t == "scenarios":
        out["summary"] = f"{attrs.get('title','scenario')} ({len(attrs.get('scenarios') or [])} nodes)"
    elif t in ("blockImage", "blockVideo", "blockAudio", "blockPDF"):
        bo = attrs.get("blockObject") or {}
        out["summary"] = (bo.get("content") or {}).get("file_id") or "uploaded asset"
    elif t == "blockEmbed":
        out["summary"] = attrs.get("embedUrl") or attrs.get("embedType") or "embed"
    elif t == "blockWebPreview":
        out["summary"] = attrs.get("url") or "web preview"
    elif t == "blockCode":
        out["summary"] = f"{attrs.get('languageName','code')} playground"
    elif t == "blockMathEquation":
        out["summary"] = _truncate(attrs.get("math_equation", ""), 80)
    else:
        txt = node_text(node)
        if txt:
            out["text"] = _truncate(txt)
    return out


def outline(doc: dict, expand_lists: bool = True) -> list[dict]:
    """Indexed tree the agent reads to locate an edit target.

    Each entry is ``{"path": [...], **preview}``. List containers are expanded
    one level so their items get addressable child paths.
    """
    doc = ensure_doc(doc)
    out: list[dict] = []
    for i, node in enumerate(doc.get("content", []) or []):
        entry = {"path": [i], **preview(node)}
        out.append(entry)
        if expand_lists and _type(node) in ("bulletList", "orderedList"):
            for j, item in enumerate(node.get("content", []) or []):
                out.append({"path": [i, j], "type": "listItem", "text": _truncate(node_text(item), 100)})
    return out


# ─── mutators (in place) ────────────────────────────────────────────────────


def _text_run(text: str, marks: list | None = None) -> dict:
    run: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        run["marks"] = marks
    return run


def set_text(node: dict, text: str) -> None:
    """Replace a text-holding node's inline content with a single plain run.

    Valid on paragraph/heading and the text-content blocks (callout/badge/
    button). Rejects atoms and containers. Inline marks in the block are
    reset (use replace_runs to preserve them)."""
    t = _type(node)
    if t not in _TEXT_HOLDERS:
        raise DocError(f"set_text is not valid on '{t}' (only {sorted(_TEXT_HOLDERS)})")
    node["content"] = [_text_run(text)] if text else []


def replace_runs(node: dict, find: str, replace: str) -> int:
    """Per-run substring replace, preserving each run's marks. Returns the
    number of runs changed. Only touches ``text`` runs anywhere under the
    node, so a phrase must lie within a single run to be replaced (marks are
    never dropped). Empty results collapse the run out (invalid in PM)."""
    if not find:
        raise DocError("replace_runs requires a non-empty 'find'")
    changed = 0

    def _walk(container: dict) -> None:
        nonlocal changed
        kids = container.get("content")
        if not isinstance(kids, list):
            return
        new_kids = []
        for child in kids:
            if isinstance(child, dict) and child.get("type") == "text":
                original = child.get("text", "")
                if find in original:
                    updated = original.replace(find, replace)
                    changed += 1
                    if updated:  # drop empty text runs (invalid in ProseMirror)
                        child = {**child, "text": updated}
                    else:
                        continue
                new_kids.append(child)
            else:
                if isinstance(child, dict):
                    _walk(child)
                new_kids.append(child)
        container["content"] = new_kids

    _walk(node)
    return changed


def merge_attrs(node: dict, attrs: dict) -> None:
    """Shallow-merge ``attrs`` into the node's attrs (keys with value None are
    removed)."""
    if not isinstance(attrs, dict):
        raise DocError("attrs must be an object")
    current = dict(node.get("attrs") or {})
    for k, v in attrs.items():
        if v is None:
            current.pop(k, None)
        else:
            current[k] = v
    node["attrs"] = current


# ─── safety ─────────────────────────────────────────────────────────────────


def check_anchor(node: dict, anchor: dict | None) -> None:
    """Optional guard: the target node must match ``{type?, contains?}``.

    Prevents editing the wrong block when positions shift between the read and
    the patch."""
    if not anchor:
        return
    exp_type = anchor.get("type")
    if exp_type and _type(node) != exp_type:
        raise PathError(f"Anchor mismatch: expected type '{exp_type}', found '{_type(node)}'")
    contains = anchor.get("contains")
    if contains:
        haystack = (node_text(node) or "").lower()
        # also search atom attrs text (quiz/flipcard/etc.)
        if contains.lower() not in haystack and contains.lower() not in _attrs_text(node).lower():
            raise PathError(f"Anchor mismatch: block does not contain {contains!r}")


def _attrs_text(node: dict) -> str:
    import json

    try:
        return json.dumps(node.get("attrs") or {}, default=str)
    except Exception:
        return ""


def validate_doc(doc: Any) -> None:
    """Raise DocError if the doc would be corrupted/normalized-away by
    ProseMirror. Checks the envelope, empty text nodes, text-content block
    purity, and atoms having no children."""
    if not isinstance(doc, dict) or doc.get("type") != "doc" or not isinstance(doc.get("content"), list):
        raise DocError("Document must be {type: 'doc', content: [...] }")

    def _check(node: Any, where: str) -> None:
        if not isinstance(node, dict) or "type" not in node:
            raise DocError(f"Invalid node at {where}: {node!r}")
        t = node["type"]
        if t == "text":
            if not node.get("text"):
                raise DocError(f"Empty text node at {where} (ProseMirror strips these)")
            return
        kids = node.get("content")
        if t in ATOM_BLOCKS:
            if kids:
                raise DocError(f"Atom block '{t}' at {where} must not have content")
            return
        if t in TEXT_CONTENT_BLOCKS and kids:
            for i, c in enumerate(kids):
                if not isinstance(c, dict) or c.get("type") != "text":
                    raise DocError(f"'{t}' at {where} may only hold text nodes, found '{_type(c)}'")
        if isinstance(kids, list):
            for i, c in enumerate(kids):
                _check(c, f"{where}.content[{i}]")

    for i, node in enumerate(doc["content"]):
        _check(node, f"content[{i}]")
