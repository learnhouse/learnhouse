"""Page content tools: read a page, write it from Markdown, edit it in place,
and move through its saved versions.

A page (a dynamic activity) is one editor document. `get_activity_content`
shows it as an outline of blocks with their paths, as Markdown, or as raw
JSON. `write_activity_content` replaces or extends it from Markdown.
`edit_activity_content` applies a batch of small, typed operations (replace a
phrase, set a block's text or settings, insert, replace, delete or move a
block) to one loaded copy and saves it once.

Every write goes through `update_activity`, which snapshots the previous
version, so `restore_activity_version` undoes it. Rights are checked before
any Markdown is converted, and conversion runs off the event loop.
"""

from __future__ import annotations

import copy
import json
from functools import partial
from typing import Annotated, Any, Literal, Union

import anyio
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum, ActivityUpdate
from src.db.courses.courses import Course
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import markdown as md
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable, require_approval
from src.services.courses.activities.activities import get_activity, update_activity
from src.services.courses.activities.versioning import (
    get_activity_versions,
    restore_activity_version,
)

RESULT_BUDGET = 25_000
JSON_BUDGET = 40_000
BLOCK_TEXT = 1000
MAX_OPS_MARKDOWN = md.MAX_CHARS
MAX_OPS = 100

Path = Annotated[
    list[Annotated[int, Field(ge=0, le=100_000)]],
    Field(min_length=1, max_length=d.MAX_DEPTH, description="Block path from the outline, e.g. [3] or [3, 1]."),
]

_UUID = Field(..., min_length=1, max_length=100, description="The page (activity_...).")
_VERSION = Field(
    None,
    ge=1,
    description="The version you read. The call is refused (conflict) if the page changed since; read it again and retry.",
)


# ─── loading and saving ──────────────────────────────────────────────────────


class Page:
    """An activity loaded for a tool call, with its course and links."""

    def __init__(self, activity: Any, course: Course):
        self.activity = activity
        self.course = course

    @property
    def uuid(self) -> str:
        return self.activity.activity_uuid

    @property
    def version(self) -> int:
        return int(self.activity.current_version or 1)

    async def ref(self, ctx: ToolContext) -> dict:
        return refs.ref(
            "activity",
            self.uuid,
            self.activity.name,
            await refs.web_url(ctx, "activity", course=self.course.course_uuid, activity=self.uuid),
            editor_url=await refs.web_url(
                ctx, "activity_editor", course=self.course.course_uuid, activity=self.uuid
            ),
        )


async def load_page(ctx: ToolContext, activity_uuid: str, action: AccessAction) -> Page:
    """The activity, only from this organization, after checking the caller
    may `action` its course (the same check the activity services make)."""
    activity = await refs.load(ctx, "activity", activity_uuid)
    course = await ctx.db_session.get(Course, activity.course_id)
    if course is None or course.org_id != ctx.org.id:
        raise refs.not_found("activity", activity_uuid)
    await check_resource_access(
        ctx.request, ctx.db_session, ctx.user, course.course_uuid, action
    )
    return Page(activity, course)


async def load_editable(ctx: ToolContext, activity_uuid: str, expected_version: int | None = None) -> tuple[Page, dict]:
    """A page the caller may edit, with a working copy of its document.

    The row is locked until the call's transaction ends, so two edits to the
    same page run one after the other: the second sees the first one's
    version and fails its expected_version check instead of overwriting it."""
    page = await load_page(ctx, activity_uuid, AccessAction.UPDATE)
    locked = (
        await ctx.db_session.execute(
            select(Activity)
            .where(Activity.id == page.activity.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalars().first()
    if locked is not None:
        page = Page(locked, page.course)
    activity_type = getattr(page.activity.activity_type, "value", page.activity.activity_type)
    if activity_type != ActivityTypeEnum.TYPE_DYNAMIC.value:
        kind = str(activity_type).removeprefix("TYPE_").lower()
        raise HTTPException(
            status_code=400,
            detail=f"This activity is a {kind} activity, not a page; only pages have editable content.",
        )
    check_version(page, expected_version)
    doc = d.normalize_legacy(copy.deepcopy(d.ensure_doc(page.activity.content)))
    return page, doc


def check_version(page: Page, expected: int | None) -> None:
    if expected is not None and int(expected) != page.version:
        raise HTTPException(
            status_code=409,
            detail=(
                f"The page changed since you read it: it is at version {page.version}, you read "
                f"version {expected}. Read it again with get_activity_content and redo the change."
            ),
        )


async def save(ctx: ToolContext, page: Page, doc: dict) -> tuple[int, int, dict | None]:
    """Write the document (one new version). Returns (before, after, undo)."""
    try:
        d.check_loadable(doc)
    except d.DocError as e:
        raise HTTPException(status_code=400, detail=str(e))
    before = page.version
    had_content = bool(page.activity.content)
    updated = await update_activity(
        ctx.request, ActivityUpdate(content=doc), page.uuid, ctx.user, ctx.db_session
    )
    after = int(jsonable(updated).get("current_version") or before)
    undo = None
    if had_content:
        undo = {
            "tool": "restore_activity_version",
            "args": {"activity_uuid": page.uuid, "version": before},
        }
    return before, after, undo


def require_risky_approval(ctx: ToolContext, old_doc: dict, new_doc: dict, also: str | None = None) -> None:
    """Custom HTML, embed code, H5P and web previews run or frame outside
    content for every learner, so adding or changing one needs a person's yes.
    Any doubt about the comparison asks too. `also` adds another reason to
    the same request (fetching files), so the person answers once."""
    try:
        risky = d.added_risky(old_doc, new_doc)
    except Exception:
        risky = ["unknown"]
    reasons = [f"Adding or changing {', '.join(risky)} blocks needs the user's approval."] if risky else []
    if also:
        reasons.append(also)
    if reasons:
        require_approval(ctx, " ".join(reasons))


async def _in_thread(fn, *args, **kwargs):
    return await anyio.to_thread.run_sync(partial(fn, *args, **kwargs))


def _json_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str))


# ─── get_activity_content ────────────────────────────────────────────────────


class GetContentParams(BaseModel):
    activity_uuid: str = _UUID
    format: Literal["outline", "markdown", "json"] = Field(
        "outline",
        description=(
            "outline: every block with its path, full text and key settings (default, best for "
            "finding what to edit). markdown: the page as Markdown. json: raw editor JSON."
        ),
    )
    paths: list[Path] | None = Field(
        None, max_length=50, description="Only these blocks (and what is inside them)."
    )
    query: str | None = Field(
        None, min_length=1, max_length=200, description="Only blocks whose text contains this (case-insensitive)."
    )


def _under(path: list[int], roots: list[list[int]]) -> bool:
    return any(path[: len(r)] == r for r in roots)


def _outline(doc: dict, p: GetContentParams) -> dict:
    entries = list(d.outline_entries(doc, BLOCK_TEXT))
    if p.paths:
        entries = [(e, s) for e, s in entries if _under(e["path"], p.paths)]
        # A block the outline folds into its parent (a lone paragraph in a
        # callout, a table cell) still answers when asked for by path.
        shown = {tuple(e["path"]) for e, _s in entries}
        for path in p.paths:
            if tuple(path) not in shown:
                try:
                    _parent, _idx, node = d.locate(doc, path)
                except d.PathError:
                    continue
                entries.append(d.entry(node, list(path), BLOCK_TEXT))
        entries.sort(key=lambda es: es[0]["path"])
    if p.query:
        q = p.query.lower()
        hits = [(e, s) for e, s in entries if q in s.lower()]
        hit_paths = [e["path"] for e, _s in hits]
        # Keep the most precise matches: drop a container when a block inside it matched.
        entries = [
            (e, s) for e, s in hits
            if not any(len(o) > len(e["path"]) and o[: len(e["path"])] == e["path"] for o in hit_paths)
        ]
    blocks: list[dict] = []
    used = 0
    out: dict[str, Any] = {}
    for entry, _search in entries:
        size = _json_size(entry) + 2
        if used + size > RESULT_BUDGET and blocks:
            out["truncated"] = True
            out["guidance"] = (
                f"Showing {len(blocks)} of {len(entries)} blocks (up to {blocks[-1]['path']}). "
                f"Read the rest with paths (e.g. [[{entry['path'][0]}], ...]) or narrow with query."
            )
            break
        blocks.append(entry)
        used += size
    out["blocks"] = blocks
    if p.query:
        out["matches"] = len(entries)
    return out


def _markdown(doc: dict, p: GetContentParams) -> dict:
    chunks: list[tuple[list[int], str]] = []
    if p.paths:
        for path in p.paths:
            try:
                _parent, _idx, node = d.locate(doc, path)
            except d.PathError:
                continue
            body = "\n".join(md.render_block(node, list(path)))
            chunks.append((list(path), f"<!-- at {list(path)} -->\n{body}"))
    else:
        for i, node in enumerate(d.children(doc)):
            text = "\n".join(md.render_block(node, [i]))
            if p.query and p.query.lower() not in (text + d.block_text(node)).lower():
                continue
            chunks.append(([i], text))
    parts: list[str] = []
    used = 0
    out: dict[str, Any] = {}
    partial_view = bool(p.paths or p.query)
    for path, text in chunks:
        if used + len(text) + 2 > RESULT_BUDGET and parts:
            out["truncated"] = True
            partial_view = True
            out["guidance"] = (
                f"Cut before block {path}. Read the rest with paths or format=outline. "
                "This Markdown is incomplete: do not write it back with mode=replace."
            )
            break
        if len(text) > RESULT_BUDGET:
            text = text[: RESULT_BUDGET - 200] + f"\n<!-- block {path} cut here: read it with format=json and paths -->"
            out["truncated"] = True
            partial_view = True
        parts.append(text)
        used += len(text) + 2
    out["markdown"] = "\n\n".join(parts) + ("\n" if parts else "")
    note = (
        "Blocks Markdown cannot show are written as <!-- block [path] type --> comments. "
        "Writing this Markdown back with mode=replace keeps each of those blocks where its "
        "comment is; delete a comment to delete its block."
    )
    if partial_view:
        note += " This is part of the page: use edit_activity_content to change it."
    out["about"] = note
    return out


def _json(doc: dict, p: GetContentParams) -> dict:
    if not p.paths:
        size = _json_size(doc)
        if size > JSON_BUDGET:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"The page is {size} characters of JSON. Pass paths (up to 50) to read parts "
                    "of it, or use format=outline to find them."
                ),
            )
        return {"doc": doc}
    nodes = []
    used = 0
    missing = []
    out: dict[str, Any] = {}
    for path in p.paths:
        try:
            _parent, _idx, node = d.locate(doc, path)
        except d.PathError:
            missing.append(list(path))
            continue
        size = _json_size(node)
        if used + size > JSON_BUDGET:
            out["truncated"] = True
            out["guidance"] = f"Stopped before {list(path)}: ask for fewer or smaller blocks (children have their own paths)."
            break
        nodes.append({"path": list(path), "node": node})
        used += size
    out["nodes"] = nodes
    if missing:
        out["missing_paths"] = missing
    return out


async def _get_content(ctx: ToolContext, p: GetContentParams):
    row = await refs.load(ctx, "activity", p.activity_uuid)
    course = await ctx.db_session.get(Course, row.course_id)
    if course is None:
        raise refs.not_found("activity", p.activity_uuid)
    # The service checks read access, hides drafts and redacts locked or paid
    # content for this reader, exactly as the page itself would.
    activity = jsonable(await get_activity(ctx.request, p.activity_uuid, ctx.user, ctx.db_session))
    page = Page(row, course)
    doc = d.normalize_legacy(copy.deepcopy(d.ensure_doc(activity.get("content"))))
    out: dict[str, Any] = {
        "activity": await page.ref(ctx),
        "version": int(activity.get("current_version") or 1),
        "format": p.format,
        "top_level_blocks": len(d.children(doc)),
    }
    if p.format == "outline":
        out.update(_outline(doc, p))
    elif p.format == "markdown":
        out.update(await _in_thread(_markdown, doc, p))
    else:
        out.update(_json(doc, p))
    if p.paths:
        missing = []
        for path in p.paths:
            try:
                d.locate(doc, path)
            except d.PathError:
                missing.append(list(path))
        if missing:
            out["missing_paths"] = missing
    return results.untrusted(out)


# ─── write_activity_content ──────────────────────────────────────────────────


class WriteContentParams(BaseModel):
    activity_uuid: str = _UUID
    markdown: str = Field(
        ...,
        min_length=1,
        max_length=md.MAX_CHARS,
        description=(
            "Page content in Markdown: # headings, **bold**, *italic*, `code`, [links](https://...), "
            "lists, tables, ``` code fences, > quotes, > [!TIP] / > [!WARNING] callouts, $$ math $$, "
            "and ```quiz / ```flipcards / ```exercise / ```scenario / ```embed / ```button / ```badge "
            "/ ```preview / ```h5p / ```widget fences for rich blocks. "
            "Keep <!-- block [path] type --> comments from a read to keep those blocks."
        ),
    )
    mode: Literal["replace", "append", "prepend"] = Field(
        "replace", description="replace the whole page, or add to its end or start."
    )
    expected_version: int | None = _VERSION


def _resolve_kept(new_doc: dict, old_doc: dict) -> tuple[list[dict], set[tuple], list[str]]:
    """Swap the block comments of a replace for the blocks they name.
    Returns (kept nodes, their paths in the old page, problems)."""
    kept: list[dict] = []
    kept_paths: set[tuple] = set()
    problems: list[str] = []
    seen: set[int] = set()
    content = []
    for node in new_doc["content"]:
        if node.get("type") != md.KEEP:
            content.append(node)
            continue
        path, want = node["path"], node["node_type"]
        try:
            _parent, _idx, original = d.locate(old_doc, path)
        except d.PathError:
            problems.append(f"no block at {path}")
            continue
        if d.kind(original) != want:
            problems.append(f"the block at {path} is a {d.kind(original)}, not a {want}")
            continue
        if id(original) in seen:
            problems.append(f"the block at {path} is kept twice")
            continue
        seen.add(id(original))
        node = copy.deepcopy(original)
        content.append(node)
        kept.append(node)
        kept_paths.add(tuple(path))
    new_doc["content"] = content or [{"type": "paragraph"}]
    return kept, kept_paths, problems


async def _write_content(ctx: ToolContext, p: WriteContentParams):
    # content_assets builds on this module, so its media helpers load here.
    from src.services.ai.tools.content_assets import attach_media, check_media, media_reason

    page, old_doc = await load_editable(ctx, p.activity_uuid, p.expected_version)
    converted = await _in_thread(md.convert, p.markdown, keep_blocks=p.mode == "replace", media=True)
    check_media(converted.media)
    new_doc = converted.doc
    notes = list(converted.notes)
    kept: list[dict] = []
    removed: list[dict] = []
    if p.mode == "replace":
        kept, kept_paths, problems = _resolve_kept(new_doc, old_doc)
        if problems:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Some <!-- block --> comments do not match this version of the page ("
                    + "; ".join(problems[:5])
                    + "). Read the page again as Markdown and keep its comments as they are."
                ),
            )
        for i, node in enumerate(d.children(old_doc)):
            if (i,) not in kept_paths and not md.is_prose(node):
                removed.append({"path": [i], "type": d.kind(node)})
        body = new_doc["content"]
    else:
        body = new_doc["content"]
        if old_doc["content"] == [{"type": "paragraph"}]:
            old_doc["content"] = []
        new_doc = {
            "type": "doc",
            "content": [*old_doc["content"], *body] if p.mode == "append" else [*body, *old_doc["content"]],
        }
    problems = []
    for i, node in enumerate(body):
        if any(node is k for k in kept):
            continue  # an existing block, written back as it was
        problems += d.strict_problems(node, (i,))
    if problems:
        raise HTTPException(status_code=400, detail=" ".join(problems[:5]))
    require_risky_approval(ctx, old_doc, new_doc, media_reason(converted.media))
    before, after, undo = await save(ctx, page, new_doc)
    media = await attach_media(ctx, page.uuid, converted.media)
    if media:
        after = media.pop("version_after", after)
    out = results.changed(
        f"Wrote {len(body)} block{'s' if len(body) != 1 else ''} ({p.mode}) to '{page.activity.name}'.",
        activity=await page.ref(ctx),
        version_before=before,
        version_after=after,
        top_level_blocks=len(new_doc["content"]),
    )
    if kept:
        out["kept_blocks"] = len(kept)
    if media:
        out["media"] = media
    if removed:
        out["removed_rich_blocks"] = removed
        notes.append(
            "Blocks that Markdown cannot show (media, scenarios, code exercises, ...) were removed "
            "because their <!-- block --> comments were not in the Markdown. Undo restores them."
        )
    if notes:
        out["notes"] = notes
    if undo:
        out["undo"] = undo
    return out


# ─── edit_activity_content ───────────────────────────────────────────────────


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MarkdownBlock(_Strict):
    markdown: str = Field(
        ..., min_length=1, max_length=md.MAX_CHARS,
        description="One or more blocks written in Markdown (rich blocks as ```quiz, ```exercise, ```scenario, ... fences).",
    )


class QuizOption(_Strict):
    text: str = Field(..., min_length=1, max_length=1000, description="Option text.")
    correct: bool = Field(..., description="Whether this option is a right answer.")


class QuizQuestion(_Strict):
    text: str = Field(..., min_length=1, max_length=2000, description="The question.")
    options: list[QuizOption] = Field(..., min_length=2, max_length=12, description="2 to 12 options, at least one correct.")
    explanation: str | None = Field(
        None, max_length=2000, description="Optional note stored with the question (not shown to learners today)."
    )


class QuizSpec(_Strict):
    questions: list[QuizQuestion] = Field(..., min_length=1, max_length=50, description="1 to 50 questions.")


class QuizBlock(_Strict):
    quiz: QuizSpec = Field(..., description="A multiple-choice quiz; ids are generated for you.")


class CalloutSpec(_Strict):
    type: Literal["info", "tip", "warning", "success", "error"] = Field("info", description="Callout style.")
    markdown: str = Field(..., min_length=1, max_length=20_000, description="Callout body: paragraphs and lists.")


class CalloutBlock(_Strict):
    callout: CalloutSpec = Field(..., description="A highlighted note box.")


class NodeBlock(_Strict):
    node: dict[str, Any] = Field(
        ..., description="One raw editor node, checked against the editor schema (see describe_activity_blocks)."
    )


Block = Annotated[
    Union[MarkdownBlock, QuizBlock, CalloutBlock, NodeBlock],
    Field(description="What to add: {markdown} | {quiz} | {callout} | {node}."),
]


class ReplaceTextOp(_Strict):
    op: Literal["replace_text"]
    find: str = Field(..., min_length=1, max_length=2000, description="Exact text to find (case-sensitive).")
    replace: str = Field(..., max_length=20_000, description="Replacement text; formatting of the match is kept.")
    path: Path | None = Field(None, description="Only search inside this block.")
    all: bool = Field(False, description="Replace every match. Without it, the text must occur exactly once.")


class SetTextOp(_Strict):
    op: Literal["set_text"]
    path: Path
    text: str = Field(
        ..., max_length=20_000,
        description="New text of the block, as inline Markdown (**bold**, *italic*, `code`, links). Newlines become line breaks.",
    )


class SetAttrsOp(_Strict):
    op: Literal["set_attrs"]
    path: Path
    attrs: dict[str, Any] = Field(
        ..., min_length=1, max_length=30,
        description="Settings to change, e.g. {\"type\": \"warning\"} on a callout or {\"level\": 2} on a heading. null resets one.",
    )


class InsertOp(_Strict):
    op: Literal["insert"]
    at: Literal["start", "end", "before", "after", "inside_start", "inside_end"] = Field(
        "end", description="Where: start/end of the page, before/after the block at path, or inside it (first/last child)."
    )
    path: Path | None = Field(None, description="Reference block; required unless at is start or end.")
    block: Block


class ReplaceBlockOp(_Strict):
    op: Literal["replace_block"]
    path: Path
    block: Block


class DeleteOp(_Strict):
    op: Literal["delete"]
    path: Path


class MoveOp(_Strict):
    op: Literal["move"]
    from_path: Path
    to: Literal["before", "after"] = Field(..., description="Place it before or after the block at path.")
    path: Path


Op = Annotated[
    Union[ReplaceTextOp, SetTextOp, SetAttrsOp, InsertOp, ReplaceBlockOp, DeleteOp, MoveOp],
    Field(discriminator="op"),
]


class EditContentParams(BaseModel):
    activity_uuid: str = _UUID
    expected_version: int | None = _VERSION
    ops: list[Op] = Field(
        ...,
        min_length=1,
        max_length=MAX_OPS,
        description=(
            "Changes, applied in order and saved together as one version. Every path refers to "
            "the page as you read it; earlier ops never shift later paths."
        ),
    )


def _block_nodes(block: Any, notes: set[str]) -> list[dict]:
    if isinstance(block, MarkdownBlock):
        converted = md.convert(block.markdown)
        notes.update(converted.notes)
        return converted.doc["content"]
    if isinstance(block, QuizBlock):
        return [d.quiz_node([q.model_dump() for q in block.quiz.questions])]
    if isinstance(block, CalloutBlock):
        node, extra = md.callout(block.callout.type, block.callout.markdown)
        notes.update(extra)
        return [node]
    node = copy.deepcopy(block.node)
    if node.get("type") == "blockQuiz" and isinstance(node.get("attrs"), dict):
        node["attrs"]["questions"] = d.fill_quiz_ids(node["attrs"].get("questions"))
        node["attrs"].setdefault("quizId", None)
    return [node]


def _convert_blocks(ops: list, notes: set[str]) -> dict[int, list[dict]]:
    out = {}
    for i, op in enumerate(ops):
        block = getattr(op, "block", None)
        if block is not None:
            out[i] = _block_nodes(block, notes)
    return out


def _inline_lines(text: str) -> list[dict]:
    nodes: list[dict] = []
    for k, line in enumerate(text.split("\n")):
        if k:
            nodes.append({"type": "hardBreak"})
        nodes.extend(md.inline(line))
    return nodes


def _apply(editor: d.Editor, k: int, op: Any, blocks: dict[int, list[dict]]) -> tuple[dict, list[dict]]:
    """Run one op. Returns (result, nodes whose final path to report)."""
    name = op.op
    if name == "replace_text":
        if "￼" in op.find:
            raise d.DocError("find contains an unsupported character.")
        root = editor.node(op.path) if op.path else editor.doc
        targets = list(d.text_targets(root, tuple(op.path or ())))
        counts = [(path, node, d.count_in(node, op.find)) for path, node in targets]
        counts = [c for c in counts if c[2]]
        total = sum(c[2] for c in counts)
        if not total:
            hint = ""
            lowered = op.find.lower()
            if any(lowered in d.block_text(n).lower() for _p, n in targets):
                hint = " (it occurs with different capitalization)"
            where = f" in {op.path}" if op.path else ""
            raise d.DocError(f"'{op.find}' was not found{where}{hint}. Matching is exact; read the outline to copy the text.")
        if total > 1 and not op.all:
            spots = ", ".join(str(list(c[0])) for c in counts[:5])
            raise d.DocError(
                f"'{op.find}' occurs {total} times (in {spots}). Pass path to pick one block, "
                "a longer find, or all=true."
            )
        done = 0
        for _path, node, _n in counts:
            done += d.replace_in(node, op.find, op.replace, None if op.all else 1)
        return {"replaced": done}, [c[1] for c in counts]
    if name == "set_text":
        t = editor.set_text(op.path, d.clean_marks(_inline_lines(op.text)), op.text)
        return {"type": t}, [editor.node(op.path)]
    if name == "set_attrs":
        t, before = editor.set_attrs(op.path, op.attrs)
        return {"type": t, "before": before}, [editor.node(op.path)]
    if name == "insert":
        if op.at not in ("start", "end") and not op.path:
            raise d.DocError(f"insert at '{op.at}' needs a path.")
        nodes = blocks[k]
        editor.insert(op.at, op.path, nodes)
        return {"inserted": [d.kind(n) for n in nodes]}, nodes
    if name == "replace_block":
        nodes = blocks[k]
        old = editor.replace(op.path, nodes)
        return {"replaced_type": old, "inserted": [d.kind(n) for n in nodes]}, nodes
    if name == "delete":
        removed = editor.delete(op.path)
        text, _cut = d.clip(d.block_text(removed), 120)
        return {"deleted_type": d.kind(removed), "deleted_text": text or None}, []
    if name == "move":
        node = editor.node(op.from_path)
        moved = editor.move(op.from_path, op.to, op.path)
        return {"moved_type": moved}, [node]
    raise d.DocError(f"Unknown op {name!r}.")


def _run_ops(doc: dict, ops: list, blocks: dict[int, list[dict]]) -> list[dict]:
    editor = d.Editor(doc)
    report: list[tuple[dict, list[dict]]] = []
    for k, op in enumerate(ops):
        try:
            result, nodes = _apply(editor, k, op, blocks)
        except (d.PathError, d.DocError) as e:
            raise HTTPException(status_code=400, detail=f"Op {k} ({op.op}) failed, nothing was saved: {e}")
        report.append(({"op": k, "kind": op.op, **{a: v for a, v in result.items() if v is not None}}, nodes))
    try:
        editor.check()
    except d.DocError as e:
        raise HTTPException(status_code=400, detail=f"The edited page would not load in the editor, nothing was saved: {e}")
    out = []
    for entry, nodes in report:
        paths = [p for p in (d.find_path(doc, n) for n in nodes) if p is not None]
        if paths:
            entry["paths"] = paths[:20]
        out.append(entry)
    return out


async def _edit_content(ctx: ToolContext, p: EditContentParams):
    page, doc = await load_editable(ctx, p.activity_uuid, p.expected_version)
    total_md = sum(
        len(getattr(getattr(op, "block", None), "markdown", "") or "")
        + len(getattr(getattr(getattr(op, "block", None), "callout", None), "markdown", "") or "")
        for op in p.ops
    )
    if total_md > MAX_OPS_MARKDOWN:
        raise HTTPException(
            status_code=400,
            detail=f"The ops carry {total_md} characters of Markdown; the limit per call is {MAX_OPS_MARKDOWN}.",
        )
    notes: set[str] = set()
    original = copy.deepcopy(doc)
    blocks = await _in_thread(_convert_blocks, p.ops, notes)
    report = await _in_thread(_run_ops, doc, p.ops, blocks)
    require_risky_approval(ctx, original, doc)
    before, after, undo = await save(ctx, page, doc)
    kinds = sorted({op.op for op in p.ops})
    out = results.changed(
        f"Applied {len(p.ops)} change{'s' if len(p.ops) != 1 else ''} ({', '.join(kinds)}) to '{page.activity.name}'.",
        activity=await page.ref(ctx),
        version_before=before,
        version_after=after,
        ops=report,
    )
    if notes:
        out["notes"] = sorted(notes)
    if undo:
        out["undo"] = undo
    return out


def _edit_summary(p: EditContentParams) -> str:
    kinds = sorted({op.op.replace("_", " ") for op in p.ops})
    return f"Edit page content: {len(p.ops)} change{'s' if len(p.ops) != 1 else ''} ({', '.join(kinds)})"


# ─── versions ────────────────────────────────────────────────────────────────


class ListVersionsParams(results.Paging):
    activity_uuid: str = _UUID


class RestoreVersionParams(BaseModel):
    activity_uuid: str = _UUID
    version: int = Field(..., ge=1, le=1_000_000, description="Version number from list_activity_versions.")


def _version_preview(content: Any) -> tuple[int, str | None]:
    doc = d.ensure_doc(content)
    blocks = d.children(doc)
    for node in blocks:
        text = d.block_text(node).strip()
        if text:
            return len(blocks), d.clip(" ".join(text.split()), 140)[0]
    return len(blocks), None


async def _list_versions(ctx: ToolContext, p: ListVersionsParams):
    page = await load_page(ctx, p.activity_uuid, AccessAction.UPDATE)
    offset = results.offset_of(p.cursor)
    rows = await get_activity_versions(
        ctx.request, p.activity_uuid, ctx.user, ctx.db_session, limit=p.limit + 1, offset=offset
    )
    items = []
    for row in rows[: p.limit]:
        blocks, preview = _version_preview(row.content)
        items.append({
            "version": row.version_number,
            "saved_at": row.created_at.isoformat() if row.created_at else None,
            "saved_by": row.created_by_username,
            "top_level_blocks": blocks,
            "starts_with": preview,
        })
    return results.page(
        items,
        offset=offset,
        limit=p.limit,
        has_more=len(rows) > p.limit,
        activity=await page.ref(ctx),
        current_version=page.version,
    )


async def _restore_version(ctx: ToolContext, p: RestoreVersionParams):
    page = await load_page(ctx, p.activity_uuid, AccessAction.UPDATE)
    before = page.version
    try:
        restored = await restore_activity_version(
            ctx.request, p.activity_uuid, p.version, ctx.user, ctx.db_session
        )
    except HTTPException as e:
        if e.status_code == 404 and "version" in str(e.detail).lower():
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No saved version {p.version} (the page is at version {before}). "
                    "list_activity_versions shows the saved ones."
                ),
            )
        raise
    after = int(getattr(restored, "current_version", None) or before)
    return results.changed(
        f"Restored '{page.activity.name}' to the content of version {p.version}.",
        activity=await page.ref(ctx),
        version_before=before,
        version_after=after,
        undo={"tool": "restore_activity_version", "args": {"activity_uuid": page.uuid, "version": before}},
    )


# ─── specs ───────────────────────────────────────────────────────────────────

_PAGE = dict(rights_bucket="activities", target_param="activity_uuid", target_kind="activity")

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_activity_content",
        title="Read page content",
        description=(
            "Read a page. format=outline (default) lists every block with its path, full text "
            "and key settings (quiz questions, callout type, media); markdown renders the page; "
            "json returns raw editor JSON. Narrow with paths or query. Returns the version to "
            "pass as expected_version when editing."
        ),
        params_model=GetContentParams,
        tier=ActionTier.READ,
        access_action=AccessAction.READ,
        execute=_get_content,
        **_PAGE,
    ),
    ToolSpec(
        name="write_activity_content",
        title="Write page content",
        description=(
            "Write a page from Markdown: replace it, or append/prepend. Best for drafting or "
            "rewriting a whole page; for small changes use edit_activity_content. Quizzes, "
            "flipcards, code exercises, scenarios, embeds and buttons are written as ```quiz-style "
            "fences. Long pages can be written in parts with mode=append. In replace mode, "
            "<!-- block [path] type --> comments from a Markdown read keep those blocks. Saves one "
            "version; returns an undo."
        ),
        params_model=WriteContentParams,
        tier=ActionTier.EDIT,
        access_action=AccessAction.UPDATE,
        execute=_write_content,
        approval_in_call=True,
        open_world=True,
        summarize=lambda p: (
            f"{'Replace' if p.mode == 'replace' else p.mode.capitalize()} page content "
            f"from Markdown ({len(p.markdown)} characters)"
        ),
        **_PAGE,
    ),
    ToolSpec(
        name="edit_activity_content",
        title="Edit page content",
        description=(
            "Change parts of a page in one atomic call: replace_text, set_text, set_attrs, insert, "
            "replace_block, delete, move (1 to 100 ops, paths from get_activity_content). Insert "
            "takes Markdown, a quiz, a callout or a raw node (describe_activity_blocks). Adding "
            "or changing custom HTML, embed code, H5P or web preview blocks needs approval. Saves "
            "one version; returns per-op results and an undo."
        ),
        params_model=EditContentParams,
        tier=ActionTier.EDIT,
        access_action=AccessAction.UPDATE,
        execute=_edit_content,
        approval_in_call=True,
        summarize=_edit_summary,
        **_PAGE,
    ),
    ToolSpec(
        name="list_activity_versions",
        title="List page versions",
        description=(
            "List a page's saved versions, newest first, with when, who and how each starts. "
            "Editors only. Pick one for restore_activity_version."
        ),
        params_model=ListVersionsParams,
        tier=ActionTier.READ,
        access_action=AccessAction.UPDATE,
        execute=_list_versions,
        **_PAGE,
    ),
    ToolSpec(
        name="restore_activity_version",
        title="Restore page version",
        description=(
            "Bring back the content of an earlier version of a page. The current content is "
            "saved as a new version first, so this can itself be undone."
        ),
        params_model=RestoreVersionParams,
        tier=ActionTier.EDIT,
        access_action=AccessAction.UPDATE,
        execute=_restore_version,
        idempotent=True,
        summarize=lambda p: f"Restore page content to version {p.version}",
        **_PAGE,
    ),
]
