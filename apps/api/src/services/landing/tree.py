"""Small, pure edits on a page document's node tree (tools and tests)."""

from __future__ import annotations

import copy
from typing import Any, Optional

from src.services.landing.recipes import reid

TEXT_FIELDS = ("text", "label", "markdown", "caption", "alt", "logoText", "copyright", "placeholder", "buttonLabel", "successText", "submitLabel", "doneText", "emptyText")


def find(doc: dict, node_id: str) -> Optional[tuple[list, int, Optional[dict]]]:
    """(list holding the node, index, parent node or None) for ``node_id``,
    searching the page and its symbols."""

    def search(nodes: list, parent: Optional[dict]):
        for i, n in enumerate(nodes):
            if n.get("id") == node_id:
                return nodes, i, parent
            hit = search(n.get("children") or [], n)
            if hit:
                return hit
        return None

    hit = search(doc.get("root") or [], None)
    if hit:
        return hit
    for sym in (doc.get("symbols") or {}).values():
        node = sym.get("node")
        if isinstance(node, dict):
            if node.get("id") == node_id:
                return [node], 0, None
            hit = search(node.get("children") or [], node)
            if hit:
                return hit
    return None


def get(doc: dict, node_id: str) -> dict:
    hit = find(doc, node_id)
    if not hit:
        raise KeyError(node_id)
    nodes, i, _ = hit
    return nodes[i]


def is_inside(doc: dict, node_id: str, ancestor_id: str) -> bool:
    ancestor = get(doc, ancestor_id)

    def has(n: dict) -> bool:
        return any(c.get("id") == node_id or has(c) for c in n.get("children") or [])

    return has(ancestor)


def insert(doc: dict, node: dict, parent_id: Optional[str], index: Optional[int] = None) -> dict:
    doc = copy.deepcopy(doc)
    if parent_id:
        parent = get(doc, parent_id)
        target = parent.setdefault("children", [])
    else:
        target = doc.setdefault("root", [])
    pos = len(target) if index is None else max(0, min(len(target), index))
    target.insert(pos, node)
    return doc


def remove(doc: dict, node_id: str) -> tuple[dict, dict]:
    doc = copy.deepcopy(doc)
    hit = find(doc, node_id)
    if not hit:
        raise KeyError(node_id)
    nodes, i, _ = hit
    node = nodes.pop(i)
    return doc, node


def move(doc: dict, node_id: str, parent_id: Optional[str], index: Optional[int] = None) -> dict:
    if parent_id and (parent_id == node_id or is_inside(doc, parent_id, node_id)):
        raise ValueError("an element cannot move inside itself")
    hit = find(doc, node_id)
    if not hit:
        raise KeyError(node_id)
    nodes, i, parent = hit
    same_list = (parent.get("id") if parent else None) == parent_id
    doc, node = remove(doc, node_id)
    if same_list and index is not None and index > i:
        index -= 1
    return insert(doc, node, parent_id, index)


def duplicate(doc: dict, node_id: str) -> tuple[dict, dict]:
    doc = copy.deepcopy(doc)
    hit = find(doc, node_id)
    if not hit:
        raise KeyError(node_id)
    nodes, i, _ = hit
    clone = reid(nodes[i])
    clone.pop("anchor", None)
    nodes.insert(i + 1, clone)
    return doc, clone


def merge_style(style: Optional[dict], patch: dict) -> dict:
    """Merge ``{breakpoint: {key: value|None}}`` into a node style; None removes."""
    out = copy.deepcopy(style or {})
    for bp, values in patch.items():
        if values is None:
            out.pop(bp, None)
            continue
        cur = dict(out.get(bp) or {})
        for k, v in values.items():
            if v is None:
                cur.pop(k, None)
            else:
                cur[k] = v
        if cur:
            out[bp] = cur
        else:
            out.pop(bp, None)
    return out


def set_path(obj: Any, path: str, value: Any) -> None:
    """Set ``a.b.0.c`` inside nested dicts/lists (props)."""
    parts = path.split(".")
    cur = obj
    for i, part in enumerate(parts):
        last = i == len(parts) - 1
        if isinstance(cur, list):
            try:
                idx = int(part)
            except ValueError:
                raise KeyError(path)
            if not -len(cur) <= idx < len(cur):
                raise KeyError(path)
            if last:
                cur[idx] = value
            else:
                cur = cur[idx]
        elif isinstance(cur, dict):
            if last:
                cur[part] = value
            else:
                if part not in cur:
                    raise KeyError(path)
                cur = cur[part]
        else:
            raise KeyError(path)


def outline(doc: dict, *, depth: int = 6) -> list[dict]:
    """A compact view of the tree: ids, types, names and short text."""

    def text_of(n: dict) -> Optional[str]:
        props = n.get("props") or {}
        for key in TEXT_FIELDS:
            v = props.get(key)
            if isinstance(v, str) and v:
                return v[:120]
        if n.get("type") in ("features", "testimonials", "faq", "stats", "pricing", "steps", "logos", "gallery", "instructors"):
            items = props.get("items") or props.get("plans") or props.get("people") or props.get("images") or []
            return f"{len(items)} item(s)"
        return None

    def view(n: dict, d: int) -> dict:
        out: dict[str, Any] = {"id": n.get("id"), "type": n.get("type")}
        if n.get("name"):
            out["name"] = n["name"]
        t = text_of(n)
        if t:
            out["text"] = t
        if n.get("hidden"):
            out["hidden"] = n["hidden"]
        kids = n.get("children") or []
        if kids:
            out["children"] = [view(c, d + 1) for c in kids] if d < depth else f"{len(kids)} element(s)"
        return out

    return [view(n, 1) for n in doc.get("root") or []]
