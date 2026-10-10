"""Dynamic pages: the TipTap document plus the files its blocks uploaded."""

from __future__ import annotations

from typing import Callable, Optional

from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.blocks import Block, BlockTypeEnum
from src.services.ai.rag.media import Media, status_of, transcript_segments
from src.services.ai.rag.sources import SourceContext, source
from src.services.ai.rag.formats import (
    html_text,
    is_safe_file_name,
    join,
    read_pdf_pages,
    prose_strings,
)
from src.services.ai.rag.types import Segment, SourceType

# ProseMirror only defines heading levels 1-6.
MAX_HEADING_LEVEL = 6
MAX_MAGIC_HTML_CHARS = 20_000

# Folder each uploaded block type is stored under (see services/blocks/block_types).
_BLOCK_DIRS = {
    BlockTypeEnum.BLOCK_DOCUMENT_PDF: "pdfBlock",
    BlockTypeEnum.BLOCK_AUDIO: "audioBlock",
    BlockTypeEnum.BLOCK_VIDEO: "videoBlock",
    BlockTypeEnum.BLOCK_IMAGE: "imageBlock",
}


@source(ActivityTypeEnum.TYPE_DYNAMIC)
async def extract(activity: Activity, ctx: SourceContext) -> list[Segment]:
    # Markdown and embed pages only store an external URL, so the walk yields
    # nothing for them and they are found by name (activity_summary). Fetching
    # arbitrary URLs server-side is not worth the SSRF exposure.
    segments = [Segment(text=extract_text_from_prosemirror(activity.content), source_type=SourceType.PAGE)]
    blocks = (await ctx.db.execute(
        select(Block).where(Block.activity_id == activity.id)
    )).scalars().all()
    for block in blocks:
        segments += await _block_segments(block, activity, ctx)
    return segments


# ---------------------------------------------------------------------------
# Uploaded blocks
# ---------------------------------------------------------------------------

def _block_file_key(block: Block, ctx: SourceContext) -> Optional[str]:
    content = block.content or {}
    folder = _BLOCK_DIRS.get(block.block_type)
    file_id, file_format = content.get("file_id"), content.get("file_format")
    if not (folder and is_safe_file_name(block.block_uuid) and is_safe_file_name(file_id)
            and is_safe_file_name(file_format)):
        return None
    activity_uuid = content.get("activity_uuid") or (ctx.activity.activity_uuid if ctx.activity else "")
    if not is_safe_file_name(activity_uuid):
        return None
    return f"{ctx.activity_dir(activity_uuid)}/dynamic/blocks/{folder}/{block.block_uuid}/{file_id}.{file_format}"


async def _block_segments(block: Block, activity: Activity, ctx: SourceContext) -> list[Segment]:
    content = block.content or {}
    label = content.get("file_name") or ""

    if block.block_type == BlockTypeEnum.BLOCK_DOCUMENT_PDF:
        key = _block_file_key(block, ctx)
        return [
            Segment(text=text, source_type=SourceType.PDF_BLOCK, block_uuid=block.block_uuid, locator={"page": page})
            for page, text in (await read_pdf_pages(key) if key else [])
        ]

    if block.block_type in (BlockTypeEnum.BLOCK_AUDIO, BlockTypeEnum.BLOCK_VIDEO):
        source_type = SourceType.AUDIO_BLOCK if block.block_type == BlockTypeEnum.BLOCK_AUDIO else SourceType.VIDEO_BLOCK
        segments = []
        if label:
            kind = "Audio" if source_type == SourceType.AUDIO_BLOCK else "Video"
            segments.append(Segment(text=f"{kind} in activity '{activity.name}': {label}",
                                    source_type=source_type, block_uuid=block.block_uuid))
        key = _block_file_key(block, ctx)
        if key:
            media = Media(org_id=activity.org_id, owner="block", owner_id=block.id, source_key=key,
                          status=status_of(content))
            segments += await transcript_segments(ctx, media, source_type, block.block_uuid)
        return segments

    if block.block_type == BlockTypeEnum.BLOCK_IMAGE:
        alt = content.get("alt") or content.get("caption") or ""
        text = join([f"Image in activity '{activity.name}'", label and f"File: {label}",
                     alt and f"Description: {alt}"], ". ")
        return [Segment(text=text, source_type=SourceType.IMAGE_BLOCK, block_uuid=block.block_uuid)]

    if block.block_type == BlockTypeEnum.BLOCK_CUSTOM:
        text = join(prose_strings(content))
        return [Segment(text=text, source_type=SourceType.CUSTOM_BLOCK, block_uuid=block.block_uuid)]

    return []


# ---------------------------------------------------------------------------
# TipTap / ProseMirror document
# ---------------------------------------------------------------------------

def extract_text_from_prosemirror(content) -> str:
    """Walk a TipTap/ProseMirror JSON tree and return its text.

    Keeps heading hierarchy as # markers. Interactive blocks that keep their
    text in node attributes (quizzes, flipcards, scenarios, ...) are included,
    without answer keys or solutions.
    """
    if not content or not isinstance(content, dict):
        return ""
    parts: list[str] = []
    _walk_prosemirror_node(content, parts)
    return "\n".join(parts).strip()


def _walk_prosemirror_node(node: dict, parts: list[str]) -> None:
    handler = _NODE_HANDLERS.get(node.get("type", ""))
    if handler is not None:
        handler(node, parts)
        return
    for child in _child_nodes(node):
        _walk_prosemirror_node(child, parts)


def _child_nodes(node: dict) -> list:
    """Only the dict children of a stored node.

    ``content`` may be missing, a scalar, or hold non-node entries; dropping
    those keeps a poisoned row from crashing the whole re-index.
    """
    children = node.get("content")
    if not isinstance(children, list):
        return []
    return [child for child in children if isinstance(child, dict)]


def _attrs(node: dict) -> dict:
    attrs = node.get("attrs")
    return attrs if isinstance(attrs, dict) else {}


def _str(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _safe_heading_level(node: dict) -> int:
    """Clamp a stored heading level to the ProseMirror range.

    ``activity.content`` is free-form JSON, so ``level`` is untrusted: used raw
    as a string repeat count an oversized value asks for a multi-GB allocation
    and OOM-kills the indexing worker. Anything that isn't a real int is 1.
    """
    level = _attrs(node).get("level", 1)
    if isinstance(level, bool) or not isinstance(level, int):
        return 1
    return max(1, min(level, MAX_HEADING_LEVEL))


def _collect_inline_text(node: dict) -> str:
    texts = []
    for child in _child_nodes(node):
        if child.get("type") == "text":
            text = child.get("text", "")
            texts.append(text if isinstance(text, str) else "")
        elif child.get("type") == "hardBreak":
            texts.append("\n")
        else:
            texts.append(_collect_inline_text(child))
    return "".join(texts)


def _append(parts: list[str], text: str) -> None:
    if text:
        parts.append(text)


def _text(node, parts):
    text = node.get("text", "")
    if text and isinstance(text, str):
        parts.append(text)


def _heading(node, parts):
    texts = _collect_inline_text(node)
    if texts:
        parts.append("#" * _safe_heading_level(node) + " " + texts)


def _paragraph(node, parts):
    _append(parts, _collect_inline_text(node))


def _list(node, parts):
    for child in _child_nodes(node):
        _walk_prosemirror_node(child, parts)


def _list_item(node, parts):
    texts = []
    for child in _child_nodes(node):
        if child.get("type") == "paragraph":
            t = _collect_inline_text(child)
            if t:
                texts.append(t)
        else:
            _walk_prosemirror_node(child, parts)
    if texts:
        parts.append("- " + " ".join(texts))


def _blockquote(node, parts):
    for child in _child_nodes(node):
        sub_parts: list[str] = []
        _walk_prosemirror_node(child, sub_parts)
        parts.extend("> " + p for p in sub_parts)


def _code_block(node, parts):
    texts = _collect_inline_text(node)
    if texts:
        parts.append(f"```\n{texts}\n```")


def _callout(node, parts):
    texts = _collect_inline_text(node)
    if texts:
        parts.append(f"[{node.get('type')}] {texts}")


def _table(node, parts):
    for row in _child_nodes(node):
        cells = [t for t in (_collect_inline_text(cell) for cell in _child_nodes(row)) if t]
        if cells:
            parts.append(" | ".join(cells))


def _h5p(node, parts):
    # Embed-only: the interactive content lives on the author's H5P host, so
    # the title is all there is. An emptied block may still carry the title of
    # the embed it used to hold; skip it so search stops citing it.
    attrs = _attrs(node)
    if _str(attrs.get("h5pUrl")) and _str(attrs.get("title")):
        parts.append(f"[H5P interactive content] {_str(attrs.get('title'))}")


def _quiz(node, parts):
    # Question and answer text only: the `correct` flags are the answer key.
    for question in _attrs(node).get("questions") or []:
        if not isinstance(question, dict) or not _str(question.get("question")):
            continue
        answers = [_str(a.get("answer")) for a in question.get("answers") or [] if isinstance(a, dict)]
        parts.append(join([f"Quiz question: {_str(question.get('question'))}",
                           *(f"- {a}" for a in answers if a)]))


def _flipcard(node, parts):
    attrs = _attrs(node)
    _append(parts, join([_str(attrs.get("question")) and f"Flashcard: {_str(attrs.get('question'))}",
                         _str(attrs.get("answer")) and f"Answer: {_str(attrs.get('answer'))}"]))


def _scenarios(node, parts):
    attrs = _attrs(node)
    lines = [_str(attrs.get("title")) and f"Scenario: {_str(attrs.get('title'))}"]
    for step in attrs.get("scenarios") or []:
        if not isinstance(step, dict):
            continue
        lines.append(_str(step.get("text")))
        lines += [f"- {_str(o.get('text'))}" for o in step.get("options") or []
                  if isinstance(o, dict) and _str(o.get("text"))]
    _append(parts, join(lines))


def _math(node, parts):
    equation = _str(_attrs(node).get("math_equation"))
    if equation:
        parts.append(f"$$ {equation} $$")


def _code_playground(node, parts):
    # The exercise as a learner sees it: never the solution or test cases.
    attrs = _attrs(node)
    hints = [h for h in (_str(h) for h in attrs.get("hints") or []) if h]
    starter = _str(attrs.get("starterCode"))
    _append(parts, join([
        _str(attrs.get("description")) and f"Coding exercise ({_str(attrs.get('languageName')) or 'code'}): "
                                           f"{_str(attrs.get('description'))}",
        *(f"Hint: {h}" for h in hints),
        starter and f"```\n{starter}\n```",
    ]))


def _web_preview(node, parts):
    attrs = _attrs(node)
    _append(parts, join([_str(attrs.get("title")) and f"Link: {_str(attrs.get('title'))}",
                         _str(attrs.get("description"))]))


def _library(node, parts):
    snapshot = _attrs(node).get("snapshot")
    if isinstance(snapshot, dict) and _str(snapshot.get("name")):
        parts.append(f"Resource: {_str(snapshot.get('name'))}")


def _magic(node, parts):
    attrs = _attrs(node)
    html = attrs.get("htmlContent")
    body = html_text(html[:MAX_MAGIC_HTML_CHARS]) if isinstance(html, str) and html.strip() else ""
    if body:
        _append(parts, join([_str(attrs.get("title")) and f"Interactive element: {_str(attrs.get('title'))}", body]))


_NODE_HANDLERS: dict[str, Callable[[dict, list[str]], None]] = {
    "text": _text,
    "heading": _heading,
    "paragraph": _paragraph,
    "bulletList": _list,
    "orderedList": _list,
    "listItem": _list_item,
    "blockquote": _blockquote,
    "codeBlock": _code_block,
    "calloutInfo": _callout,
    "calloutWarning": _callout,
    "calloutDanger": _callout,
    "calloutSuccess": _callout,
    "table": _table,
    "blockH5P": _h5p,
    "blockQuiz": _quiz,
    "flipcard": _flipcard,
    "scenarios": _scenarios,
    "blockMathEquation": _math,
    "blockCode": _code_playground,
    "blockWebPreview": _web_preview,
    "blockLibrary": _library,
    "blockMagic": _magic,
}
