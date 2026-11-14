"""The editor's ``comment`` mark, as the API sees it.

Editors anchor comment threads on activity text with a ProseMirror mark,
``{"type": "comment", "attrs": {"threadId": "thread_..."}}``. It lives in
the stored document like bold or a link, because that is what lets it follow
the text through edits and sync through the collaboration server.

Comments are for the people building the course. Every path that hands a
document to anyone else (the learner read, the chapter tree, AI indexes,
exports, copies, templates) drops the mark with ``strip_comment_marks``. The
learner renderer would otherwise not even load the page: an editor schema
without the mark replaces a document it cannot parse with an empty one.
"""

from typing import Any

COMMENT_MARK = "comment"

# Deeper than any real document; guards the walk against hostile JSON.
_MAX_DEPTH = 200


def _is_comment(mark: Any) -> bool:
    return isinstance(mark, dict) and mark.get("type") == COMMENT_MARK


def has_comment_marks(doc: Any) -> bool:
    """Whether any text in ``doc`` carries a comment mark."""
    stack: list[tuple[Any, int]] = [(doc, 0)]
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict) or depth > _MAX_DEPTH:
            continue
        marks = node.get("marks")
        if isinstance(marks, list) and any(_is_comment(m) for m in marks):
            return True
        kids = node.get("content")
        if isinstance(kids, list):
            stack.extend((kid, depth + 1) for kid in kids)
    return False


def comment_thread_ids(doc: Any) -> set[str]:
    """The thread ids the document's comment marks point at."""
    ids: set[str] = set()
    stack: list[tuple[Any, int]] = [(doc, 0)]
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict) or depth > _MAX_DEPTH:
            continue
        for mark in node.get("marks") or []:
            if _is_comment(mark):
                thread_id = (mark.get("attrs") or {}).get("threadId")
                if isinstance(thread_id, str) and thread_id:
                    ids.add(thread_id)
        kids = node.get("content")
        if isinstance(kids, list):
            stack.extend((kid, depth + 1) for kid in kids)
    return ids


def _strip(node: Any, depth: int) -> Any:
    if not isinstance(node, dict) or depth > _MAX_DEPTH:
        return node
    out = node
    marks = node.get("marks")
    if isinstance(marks, list) and any(_is_comment(m) for m in marks):
        out = dict(node)
        kept = [m for m in marks if not _is_comment(m)]
        if kept:
            out["marks"] = kept
        else:
            out.pop("marks", None)
    kids = node.get("content")
    if isinstance(kids, list):
        new_kids = [_strip(kid, depth + 1) for kid in kids]
        if any(a is not b for a, b in zip(new_kids, kids)):
            if out is node:
                out = dict(node)
            out["content"] = new_kids
    return out


def strip_comment_marks(doc: Any) -> Any:
    """``doc`` without comment marks; the same object when it has none.

    Only nodes on the path to a comment mark are copied, so the input is never
    mutated and an uncommented document costs one read-only walk.
    """
    if not has_comment_marks(doc):
        return doc
    return _strip(doc, 0)
