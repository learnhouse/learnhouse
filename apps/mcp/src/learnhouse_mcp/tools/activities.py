from __future__ import annotations

import re
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="list_chapter_activities",
        description=(
            "List every activity inside a chapter, in display order. Pass the numeric "
            "chapter_id. Use this to see what's in a chapter before adding or editing."
        ),
    )
    async def list_chapter_activities(chapter_id: int) -> list[dict]:
        return await client.get(f"/activities/chapter/{chapter_id}")

    @mcp.tool(
        name="get_activity",
        description="Get a single activity by its UUID. Returns name, content, and metadata.",
    )
    async def get_activity(activity_uuid: str) -> dict:
        return await client.get(f"/activities/{activity_uuid}")

    @mcp.tool(
        name="create_activity",
        description=(
            "Create a new markdown/rich-text activity inside a chapter. This creates a "
            "TYPE_DYNAMIC / SUBTYPE_DYNAMIC_PAGE activity with the given name and "
            "optional content. For video and PDF activities, the API requires file "
            "uploads which this MCP server does not support yet — create them in the "
            "LearnHouse UI."
        ),
    )
    async def create_activity(
        chapter_id: int,
        name: str,
        content: dict | None = None,
        published: bool = False,
    ) -> dict:
        body = {
            "chapter_id": chapter_id,
            "name": name,
            "activity_type": "TYPE_DYNAMIC",
            "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
            "content": content or {},
            "details": {},
            "published": published,
            "lock_type": "public",
        }
        return await client.post("/activities/", json=body)

    @mcp.tool(
        name="create_external_video_activity",
        description=(
            "Create an activity that embeds a video hosted externally (YouTube or "
            "Vimeo) rather than uploading a file. Supply the chapter_id, a display "
            "name, the video URL (uri), and the provider type."
        ),
    )
    async def create_external_video_activity(
        chapter_id: int,
        name: str,
        uri: str,
        type: str = "youtube",
    ) -> dict:
        if type not in {"youtube", "vimeo"}:
            raise ValueError("type must be 'youtube' or 'vimeo'.")
        body = {
            "chapter_id": str(chapter_id),
            "name": name,
            "uri": uri,
            "type": type,
            "details": "{}",
        }
        return await client.post("/activities/external_video", json=body)

    @mcp.tool(
        name="create_video_activity",
        description=(
            "Create a VIDEO-type activity as an empty shell — no file uploaded. "
            "The user can upload a video later in the editor UI. Pass chapter_id "
            "(numeric) and a display name. For externally-hosted videos (YouTube, "
            "Vimeo), use create_external_video_activity instead."
        ),
    )
    async def create_video_activity(
        chapter_id: int,
        name: str,
    ) -> dict:
        form = {
            "name": name,
            "chapter_id": str(chapter_id),
            "details": "{}",
        }
        return await client.post_form("/activities/video", form=form)

    @mcp.tool(
        name="create_pdf_activity",
        description=(
            "Create a DOCUMENT (PDF)-type activity as an empty shell — no file "
            "uploaded. The user can upload a PDF later in the editor UI. Pass "
            "chapter_id (numeric) and a display name."
        ),
    )
    async def create_pdf_activity(
        chapter_id: int,
        name: str,
    ) -> dict:
        form = {
            "name": name,
            "chapter_id": str(chapter_id),
        }
        return await client.post_form("/activities/documentpdf", form=form)

    @mcp.tool(
        name="set_activity_content_from_markdown",
        description=(
            "Populate a DYNAMIC-type activity's body from a markdown string and "
            "save it (creates a new version). Supports:\n"
            "- Headings: # h1 / ## h2 / ### h3 / #### h4\n"
            "- Paragraphs (blank-line separated)\n"
            "- Bullet lists: '- item' or '* item'\n"
            "- Numbered lists: '1. item'\n"
            "- Fenced code blocks: ```python ... ``` with language label\n"
            "- Blockquotes: '> quote text'\n"
            "- Horizontal rule: '---' on its own line\n"
            "- GFM pipe tables: | h1 | h2 |\\n|---|---|\\n| a | b |\n"
            "- YouTube embeds: '@[youtube](https://youtube.com/watch?v=...)' on its own line\n"
            "- Inline: **bold**, *italic*, `code`, [link text](https://url)\n\n"
            "Use real fenced ```lang blocks for code, not indented paragraphs — "
            "the editor syntax-highlights them. Images and callouts aren't yet "
            "emitted; add them via the editor UI if needed. Returns the updated "
            "activity."
        ),
    )
    async def set_activity_content_from_markdown(
        activity_uuid: str,
        markdown: Annotated[str, Field(min_length=1, max_length=50_000)],
        publish: bool = False,
    ) -> dict:
        doc = _markdown_to_tiptap(markdown)
        payload: dict[str, Any] = {"content": doc}
        if publish:
            payload["published"] = True
        return await client.put(f"/activities/{activity_uuid}", json=payload)

    @mcp.tool(
        name="update_activity",
        description=(
            "Low-level: update a single activity by UUID. Use this only for "
            "targeted one-off edits or from external MCP clients. For work "
            "inside the focused course — publishing, renaming, filling "
            "content — use the focus_* selector tools instead "
            "(set_activities_published, fill_activity, rename_activity). "
            "Looping update_activity on many UUIDs is an anti-pattern and "
            "will introduce UUID typos.\n\n"
            "Changing `content` creates a new version. `details` is a "
            "free-form JSON dict (observed keys: thumbnail, duration, "
            "difficulty)."
        ),
    )
    async def update_activity(
        activity_uuid: str,
        name: str | None = None,
        content: dict | None = None,
        published: bool | None = None,
        details: dict[str, Any] | None = None,
    ) -> dict:
        payload = {
            k: v
            for k, v in {
                "name": name,
                "content": content,
                "published": published,
                "details": details,
            }.items()
            if v is not None
        }
        if not payload:
            raise ValueError("update_activity requires at least one field to change.")
        return await client.put(f"/activities/{activity_uuid}", json=payload)

    @mcp.tool(
        name="delete_activity",
        description=(
            "DESTRUCTIVE: permanently delete an activity by UUID. Confirm with the "
            "user before calling."
        ),
    )
    async def delete_activity(activity_uuid: str) -> dict:
        return await client.delete(f"/activities/{activity_uuid}")

    @mcp.tool(
        name="list_activity_versions",
        description=(
            "List the version history for an activity (newest first). Each activity "
            "keeps a version on every content change; use this to inspect or roll back."
        ),
    )
    async def list_activity_versions(
        activity_uuid: str,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict]:
        return await client.get(
            f"/activities/{activity_uuid}/versions",
            params={"limit": limit, "offset": offset},
        )

    @mcp.tool(
        name="restore_activity_version",
        description=(
            "Restore an activity to a previous version number. This appends a NEW "
            "version with the restored content — it does not rewrite history."
        ),
    )
    async def restore_activity_version(activity_uuid: str, version_number: int) -> dict:
        return await client.post(
            f"/activities/{activity_uuid}/versions/{version_number}/restore"
        )


_INLINE_BOLD_RE = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_INLINE_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)\*(?!\*)|(?<!_)_(?!_)(.+?)_(?!_)")
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_INLINE_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")

_BLOCK_BREAK_RE = re.compile(
    r"^(#{1,4}\s|[-*]\s|\d+\.\s|>\s|```|---\s*$|\|)"
)


def _inline_to_tiptap(text: str) -> list[dict[str, Any]]:
    """Tokenize a single line's inline markdown into Tiptap text nodes.

    Handles bold, italic, inline code, and links. Overlapping/ambiguous
    cases resolve to the earliest match. Everything else becomes plain text.
    """
    if not text:
        return []

    remaining = text
    out: list[dict[str, Any]] = []

    def _emit_text(s: str) -> None:
        if s:
            out.append({"type": "text", "text": s})

    def _emit_marked(s: str, marks: list[dict[str, Any]]) -> None:
        if s:
            out.append({"type": "text", "marks": marks, "text": s})

    while remaining:
        best: tuple[int, int, str, list[dict[str, Any]]] | None = None
        # Links first: [text](href)
        m = _INLINE_LINK_RE.search(remaining)
        if m:
            best = (
                m.start(),
                m.end(),
                m.group(1),
                [{"type": "link", "attrs": {"href": m.group(2)}}],
            )
        for pattern, mark in (
            (_INLINE_BOLD_RE, "bold"),
            (_INLINE_ITALIC_RE, "italic"),
            (_INLINE_CODE_RE, "code"),
        ):
            m = pattern.search(remaining)
            if m and (best is None or m.start() < best[0]):
                content = next((g for g in m.groups() if g is not None), "")
                best = (m.start(), m.end(), content, [{"type": mark}])
        if best is None:
            _emit_text(remaining)
            break
        start, end, content, marks = best
        _emit_text(remaining[:start])
        _emit_marked(content, marks)
        remaining = remaining[end:]
    return out


_YOUTUBE_EMBED_RE = re.compile(r"^@\[youtube\]\((\S+)\)\s*$")


def _parse_table(lines: list[str], start: int) -> tuple[dict[str, Any] | None, int]:
    """Parse a GFM pipe table starting at `start`. Returns (node, next_idx) or
    (None, start) if the lines don't form a valid header + separator + rows
    sequence — the caller should fall back to paragraph parsing."""
    if start + 1 >= len(lines):
        return None, start
    header = lines[start].strip()
    sep = lines[start + 1].strip()
    if not header.startswith("|") or not sep.startswith("|"):
        return None, start
    # Separator row is all | and --- (optionally : for alignment); accept any
    # combination so long as each cell matches.
    sep_cells = [c.strip() for c in sep.strip("|").split("|")]
    if not sep_cells or not all(
        re.fullmatch(r":?-{3,}:?", c or "") for c in sep_cells
    ):
        return None, start

    def _split_cells(row: str) -> list[str]:
        return [c.strip() for c in row.strip().strip("|").split("|")]

    header_cells = _split_cells(header)
    if len(header_cells) != len(sep_cells):
        return None, start

    header_row = {
        "type": "tableRow",
        "content": [
            {
                "type": "tableHeader",
                "content": [
                    {"type": "paragraph", "content": _inline_to_tiptap(cell)}
                ],
            }
            for cell in header_cells
        ],
    }

    body_rows: list[dict[str, Any]] = []
    i = start + 2
    while i < len(lines):
        row = lines[i].strip()
        if not row.startswith("|"):
            break
        cells = _split_cells(row)
        if len(cells) != len(header_cells):
            break
        body_rows.append(
            {
                "type": "tableRow",
                "content": [
                    {
                        "type": "tableCell",
                        "content": [
                            {"type": "paragraph", "content": _inline_to_tiptap(cell)}
                        ],
                    }
                    for cell in cells
                ],
            }
        )
        i += 1
    return {"type": "table", "content": [header_row, *body_rows]}, i


def _markdown_to_tiptap(md: str) -> dict[str, Any]:
    """Convert a subset of markdown to Tiptap ProseMirror JSON.

    Blocks: headings (#...####), paragraphs (blank-line separated), bullet
    lists (- / *), numbered lists (1.), fenced code blocks (```lang),
    blockquotes (>), horizontal rules (---), GFM pipe tables, and YouTube
    embeds (@[youtube](url)). Inline: **bold**, *italic*, `code`,
    [text](url) links.

    All emitted node types are validated against the Tiptap extensions
    registered in apps/web/components/Objects/Activities/DynamicCanva.
    """
    lines = md.replace("\r\n", "\n").split("\n")
    content: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # Fenced code block: ``` or ```language
        code_open = re.match(r"^```\s*([\w+-]*)\s*$", stripped)
        if code_open:
            language = code_open.group(1) or None
            i += 1
            code_lines: list[str] = []
            while i < len(lines) and not re.match(r"^```\s*$", lines[i].strip()):
                code_lines.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1  # consume closing fence
            code_block: dict[str, Any] = {
                "type": "codeBlock",
                "content": [{"type": "text", "text": "\n".join(code_lines)}]
                if code_lines
                else [],
            }
            if language:
                code_block["attrs"] = {"language": language}
            content.append(code_block)
            continue

        # Horizontal rule: --- on its own line (and not a table separator
        # which would look like |---|---|)
        if re.fullmatch(r"-{3,}", stripped):
            content.append({"type": "horizontalRule"})
            i += 1
            continue

        # YouTube embed shortcut
        yt = _YOUTUBE_EMBED_RE.match(stripped)
        if yt:
            content.append({"type": "youtube", "attrs": {"src": yt.group(1)}})
            i += 1
            continue

        # GFM table
        if stripped.startswith("|"):
            table, next_i = _parse_table(lines, i)
            if table is not None:
                content.append(table)
                i = next_i
                continue
            # Not a valid table — fall through to paragraph handling.

        # Blockquote: consume one or more `> ...` lines into a single
        # blockquote containing one paragraph per line group.
        if stripped.startswith(">"):
            buf: list[str] = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            content.append(
                {
                    "type": "blockquote",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": _inline_to_tiptap(" ".join(buf).strip()),
                        }
                    ],
                }
            )
            continue

        heading_match = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading_match:
            level = len(heading_match.group(1))
            text = heading_match.group(2).strip()
            content.append(
                {
                    "type": "heading",
                    "attrs": {"level": level},
                    "content": _inline_to_tiptap(text),
                }
            )
            i += 1
            continue

        # Bullet list (- or *) — consume a contiguous run.
        if re.match(r"^[-*]\s+", stripped):
            items: list[dict[str, Any]] = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                item_text = re.sub(r"^\s*[-*]\s+", "", lines[i]).strip()
                items.append(
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": _inline_to_tiptap(item_text),
                            }
                        ],
                    }
                )
                i += 1
            content.append({"type": "bulletList", "content": items})
            continue

        # Ordered list (1. / 2. / ...)
        if re.match(r"^\d+\.\s+", stripped):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                item_text = re.sub(r"^\s*\d+\.\s+", "", lines[i]).strip()
                items.append(
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": _inline_to_tiptap(item_text),
                            }
                        ],
                    }
                )
                i += 1
            content.append({"type": "orderedList", "content": items})
            continue

        # Paragraph: join consecutive non-blank, non-special lines with a space.
        buf = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt:
                break
            if _BLOCK_BREAK_RE.match(nxt):
                break
            buf.append(nxt)
            i += 1
        content.append(
            {
                "type": "paragraph",
                "content": _inline_to_tiptap(" ".join(buf)),
            }
        )

    if not content:
        content = [{"type": "paragraph"}]
    return {"type": "doc", "content": content}
