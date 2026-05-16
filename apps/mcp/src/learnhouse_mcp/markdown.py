"""Markdown → Tiptap JSON.

Walks the `markdown-it-py` token stream and emits a Tiptap document
compatible with the LearnHouse StarterKit-based editor schema. Supports
the subset Atlas needs to author lesson content:

  Block nodes:  doc, paragraph, heading (1-3), bulletList, orderedList,
                listItem, codeBlock, blockquote, horizontalRule
  Marks:        bold, italic, code, link

Anything else degrades to plain text inside a paragraph so the LLM can
never produce a Tiptap doc the editor cannot render.
"""

from typing import Any

from markdown_it import MarkdownIt

from .errors import AtlasToolError

TiptapNode = dict[str, Any]


def markdown_to_tiptap(md: str) -> TiptapNode:
    if md is None:
        return _doc([])
    try:
        parser = MarkdownIt("commonmark", {"html": False, "linkify": True, "breaks": False})
        tokens = parser.parse(md)
    except Exception as exc:
        raise AtlasToolError(
            code="INVALID_MARKDOWN",
            message=f"Could not parse markdown: {exc}",
        ) from exc
    nodes = _convert_block_tokens(tokens, 0, len(tokens))[0]
    return _doc(nodes)


def _doc(content: list[TiptapNode]) -> TiptapNode:
    return {"type": "doc", "content": content or [{"type": "paragraph"}]}


def _convert_block_tokens(
    tokens: list, start: int, end: int
) -> tuple[list[TiptapNode], int]:
    """Convert tokens[start:end] into a list of block-level Tiptap nodes.

    Returns (nodes, next_index). Recursive for container blocks.
    """
    out: list[TiptapNode] = []
    i = start
    while i < end:
        tok = tokens[i]
        ttype = tok.type

        if ttype == "heading_open":
            level = int(tok.tag[1:]) if tok.tag and tok.tag.startswith("h") else 1
            level = max(1, min(3, level))
            inline = tokens[i + 1]
            i += 3  # heading_open, inline, heading_close
            out.append(
                {
                    "type": "heading",
                    "attrs": {"level": level},
                    "content": _convert_inline(inline.children or []),
                }
            )
            continue

        if ttype == "paragraph_open":
            inline = tokens[i + 1]
            i += 3
            content = _convert_inline(inline.children or [])
            if content:
                out.append({"type": "paragraph", "content": content})
            else:
                out.append({"type": "paragraph"})
            continue

        if ttype == "bullet_list_open":
            end_idx = _find_matching(tokens, i, "bullet_list_open", "bullet_list_close")
            items = _convert_list_items(tokens, i + 1, end_idx)
            out.append({"type": "bulletList", "content": items})
            i = end_idx + 1
            continue

        if ttype == "ordered_list_open":
            end_idx = _find_matching(tokens, i, "ordered_list_open", "ordered_list_close")
            items = _convert_list_items(tokens, i + 1, end_idx)
            out.append({"type": "orderedList", "content": items})
            i = end_idx + 1
            continue

        if ttype == "blockquote_open":
            end_idx = _find_matching(tokens, i, "blockquote_open", "blockquote_close")
            inner, _ = _convert_block_tokens(tokens, i + 1, end_idx)
            out.append({"type": "blockquote", "content": inner or [{"type": "paragraph"}]})
            i = end_idx + 1
            continue

        if ttype == "fence" or ttype == "code_block":
            text = tok.content or ""
            if text.endswith("\n"):
                text = text[:-1]
            node: TiptapNode = {"type": "codeBlock"}
            if ttype == "fence" and tok.info:
                node["attrs"] = {"language": tok.info.strip()}
            if text:
                node["content"] = [{"type": "text", "text": text}]
            out.append(node)
            i += 1
            continue

        if ttype == "hr":
            out.append({"type": "horizontalRule"})
            i += 1
            continue

        # Unknown / unsupported block — fall back to plain text paragraph.
        if tok.content:
            out.append(
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": tok.content}],
                }
            )
        i += 1

    return out, i


def _find_matching(tokens: list, open_idx: int, open_t: str, close_t: str) -> int:
    depth = 0
    for j in range(open_idx, len(tokens)):
        if tokens[j].type == open_t:
            depth += 1
        elif tokens[j].type == close_t:
            depth -= 1
            if depth == 0:
                return j
    return len(tokens) - 1


def _convert_list_items(tokens: list, start: int, end: int) -> list[TiptapNode]:
    items: list[TiptapNode] = []
    i = start
    while i < end:
        if tokens[i].type == "list_item_open":
            close_idx = _find_matching(tokens, i, "list_item_open", "list_item_close")
            inner, _ = _convert_block_tokens(tokens, i + 1, close_idx)
            items.append({"type": "listItem", "content": inner or [{"type": "paragraph"}]})
            i = close_idx + 1
        else:
            i += 1
    return items


def _convert_inline(tokens: list) -> list[TiptapNode]:
    """Inline-level conversion. Builds text nodes with marks."""
    out: list[TiptapNode] = []
    mark_stack: list[dict[str, Any]] = []
    for tok in tokens:
        ttype = tok.type
        if ttype == "text":
            if tok.content:
                out.append(_text(tok.content, mark_stack))
        elif ttype == "softbreak":
            out.append(_text(" ", mark_stack))
        elif ttype == "hardbreak":
            out.append({"type": "hardBreak"})
        elif ttype == "strong_open":
            mark_stack.append({"type": "bold"})
        elif ttype == "strong_close":
            _pop_mark(mark_stack, "bold")
        elif ttype == "em_open":
            mark_stack.append({"type": "italic"})
        elif ttype == "em_close":
            _pop_mark(mark_stack, "italic")
        elif ttype == "code_inline":
            out.append(_text(tok.content or "", mark_stack + [{"type": "code"}]))
        elif ttype == "link_open":
            attrs = tok.attrs or {}
            if isinstance(attrs, dict):
                href = attrs.get("href", "")
            else:
                href = next((v for k, v in attrs if k == "href"), "")
            mark_stack.append({"type": "link", "attrs": {"href": href}})
        elif ttype == "link_close":
            _pop_mark(mark_stack, "link")
        elif ttype == "image":
            alt = tok.content or ""
            if alt:
                out.append(_text(alt, mark_stack))
        # else: silently ignore unsupported inline token types.
    return out


def _text(text: str, marks: list[dict[str, Any]]) -> TiptapNode:
    node: TiptapNode = {"type": "text", "text": text}
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def _pop_mark(stack: list[dict[str, Any]], mark_type: str) -> None:
    for i in range(len(stack) - 1, -1, -1):
        if stack[i]["type"] == mark_type:
            stack.pop(i)
            return
