"""Surgical activity-content editing tools.

Instead of rewriting the whole TipTap document, the agent reads an indexed
outline (`read_activity_content`), locates the target block by its path, and
applies ONE precise patch that mutates only that node. Every patch goes
through `update_activity` (whole-doc write) so it inherits version snapshots
+ undo (`restore_activity_version`) and can be gated by `expected_version`
(optimistic concurrency) and an `anchor` (type/text guard) for safety.

Workflow the agent should follow (also stated in the tool descriptions):
  1. read_activity_content(activity_uuid)  -> outline with a `path` per block
  2. pick the block whose text/type matches the request
  3. call the SMALLEST patch: edit_block_text (wording) / update_block_attrs
     (a setting like a callout type or a quiz answer) — not a full rewrite
  4. pass expected_version (from the read) and an anchor snippet for safety
"""

from __future__ import annotations

from typing import Callable, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.db.courses.activities import ActivityUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.courses.activities.activities import get_activity, update_activity


# ─── shared load / write / apply ────────────────────────────────────────────


async def _load(ctx: ToolContext, activity_uuid: str) -> tuple[dict, int]:
    activity = await get_activity(ctx.request, activity_uuid, ctx.user, ctx.db_session)
    data = jsonable(activity)
    return d.ensure_doc(data.get("content")), int(data.get("current_version") or 1)


def _check_version(expected: int | None, current: int) -> None:
    if expected is not None and int(expected) != current:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Activity changed since you read it (now version {current}, you "
                f"expected {expected}). Re-read the content and retry."
            ),
        )


async def _apply(
    ctx: ToolContext,
    activity_uuid: str,
    expected_version: int | None,
    mutate: Callable[[dict], dict],
) -> dict:
    """Load -> version-check -> mutate (may raise Path/DocError) -> validate ->
    write. Returns a result dict with the mutation's summary + new version."""
    doc, current = await _load(ctx, activity_uuid)
    _check_version(expected_version, current)
    try:
        summary = mutate(doc)
        d.validate_doc(doc)
    except (d.PathError, d.DocError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    updated = await update_activity(
        ctx.request, ActivityUpdate(content=doc), activity_uuid, ctx.user, ctx.db_session
    )
    new_data = jsonable(updated)
    return {
        "activity_uuid": activity_uuid,
        "previous_version": current,
        "current_version": new_data.get("current_version"),
        "undo_hint": f"restore_activity_version to version {current} to undo",
        **summary,
    }


# ─── params ─────────────────────────────────────────────────────────────────

_PATH_DESC = "Node path from read_activity_content, e.g. [3] or [2,1]."
_ANCHOR_DESC = (
    "Optional safety guard {type?, contains?}: the target block must be this "
    "type and/or contain this text, else the edit is refused."
)
_VER_DESC = "Optional current_version from read_activity_content; edit is refused if the activity has changed since."


class ReadContentParams(BaseModel):
    activity_uuid: str


class FindParams(BaseModel):
    activity_uuid: str
    query: str = Field(..., min_length=1)


class EditTextParams(BaseModel):
    activity_uuid: str
    path: list[int] = Field(..., description=_PATH_DESC)
    text: str | None = Field(None, description="Set the block's whole text (resets inline formatting in that block).")
    find: str | None = Field(None, description="Substring to replace (preserves marks); pair with 'replace'.")
    replace: str | None = Field(None, description="Replacement for 'find'.")
    expected_version: int | None = Field(None, description=_VER_DESC)
    anchor: dict | None = Field(None, description=_ANCHOR_DESC)


class UpdateAttrsParams(BaseModel):
    activity_uuid: str
    path: list[int] = Field(..., description=_PATH_DESC)
    attrs: dict = Field(..., description="Attrs to shallow-merge into the block (value null removes a key).")
    expected_version: int | None = Field(None, description=_VER_DESC)
    anchor: dict | None = Field(None, description=_ANCHOR_DESC)


class ReplaceBlockParams(BaseModel):
    activity_uuid: str
    path: list[int] = Field(..., description=_PATH_DESC)
    new_block: dict = Field(..., description="Replacement node (see describe_activity_blocks for shapes).")
    expected_version: int | None = Field(None, description=_VER_DESC)
    anchor: dict | None = Field(None, description=_ANCHOR_DESC)


class InsertBlockParams(BaseModel):
    activity_uuid: str
    path: list[int] = Field(..., description="Reference node path; the new block is placed relative to it.")
    new_block: dict = Field(..., description="Node to insert (see describe_activity_blocks).")
    position: Literal["before", "after", "child_start", "child_end"] = Field("after")
    expected_version: int | None = Field(None, description=_VER_DESC)


class DeleteBlockParams(BaseModel):
    activity_uuid: str
    path: list[int] = Field(..., description=_PATH_DESC)
    expected_version: int | None = Field(None, description=_VER_DESC)
    anchor: dict | None = Field(None, description=_ANCHOR_DESC)
    confirm: bool | None = None


class MoveBlockParams(BaseModel):
    activity_uuid: str
    from_path: list[int] = Field(..., description="Path of the node to move.")
    to_path: list[int] = Field(..., description="Reference node path to move next to.")
    position: Literal["before", "after"] = Field("after")
    expected_version: int | None = Field(None, description=_VER_DESC)


# ─── executors ──────────────────────────────────────────────────────────────


async def _read_content(ctx: ToolContext, p: ReadContentParams):
    doc, current = await _load(ctx, p.activity_uuid)
    return {"activity_uuid": p.activity_uuid, "current_version": current, "outline": d.outline(doc)}


async def _find(ctx: ToolContext, p: FindParams):
    doc, current = await _load(ctx, p.activity_uuid)
    q = p.query.lower()
    hits = []
    for entry in d.outline(doc):
        text = entry.get("text") or entry.get("summary") or " ".join(entry.get("items") or [])
        if q in (text or "").lower():
            hits.append({"path": entry["path"], "type": entry["type"], "snippet": text})
    return {"activity_uuid": p.activity_uuid, "current_version": current, "matches": hits}


async def _edit_text(ctx: ToolContext, p: EditTextParams):
    def mutate(doc):
        _parent, _idx, node = d.resolve_path(doc, p.path)
        d.check_anchor(node, p.anchor)
        before = d.node_text(node)
        if p.find is not None:
            n = d.replace_runs(node, p.find, p.replace or "")
            if n == 0:
                raise d.DocError(f"'{p.find}' not found in the block at {p.path}")
        elif p.text is not None:
            d.set_text(node, p.text)
        else:
            raise d.DocError("Provide either 'text' or 'find'+'replace'")
        return {"path": p.path, "before": before, "after": d.node_text(node)}

    return await _apply(ctx, p.activity_uuid, p.expected_version, mutate)


async def _update_attrs(ctx: ToolContext, p: UpdateAttrsParams):
    def mutate(doc):
        _parent, _idx, node = d.resolve_path(doc, p.path)
        d.check_anchor(node, p.anchor)
        before = dict(node.get("attrs") or {})
        d.merge_attrs(node, p.attrs)
        return {"path": p.path, "type": node.get("type"), "before_attrs": before, "after_attrs": node.get("attrs")}

    return await _apply(ctx, p.activity_uuid, p.expected_version, mutate)


async def _replace_block(ctx: ToolContext, p: ReplaceBlockParams):
    def mutate(doc):
        parent, idx, node = d.resolve_path(doc, p.path)
        d.check_anchor(node, p.anchor)
        old_type = node.get("type")
        parent[idx] = p.new_block
        return {"path": p.path, "replaced_type": old_type, "new_type": p.new_block.get("type")}

    return await _apply(ctx, p.activity_uuid, p.expected_version, mutate)


async def _insert_block(ctx: ToolContext, p: InsertBlockParams):
    def mutate(doc):
        parent, idx, node = d.resolve_path(doc, p.path)
        if p.position in ("child_start", "child_end"):
            children = node.get("content")
            if not isinstance(children, list):
                if node.get("type") in d.ATOM_BLOCKS:
                    raise d.DocError(f"Cannot insert into atom block '{node.get('type')}'")
                node["content"] = children = []
            children.insert(0 if p.position == "child_start" else len(children), p.new_block)
        else:
            parent.insert(idx if p.position == "before" else idx + 1, p.new_block)
        return {"path": p.path, "position": p.position, "inserted_type": p.new_block.get("type")}

    return await _apply(ctx, p.activity_uuid, p.expected_version, mutate)


async def _delete_block(ctx: ToolContext, p: DeleteBlockParams):
    def mutate(doc):
        parent, idx, node = d.resolve_path(doc, p.path)
        d.check_anchor(node, p.anchor)
        removed = parent.pop(idx)
        return {"path": p.path, "deleted_type": removed.get("type"), "deleted_preview": d.preview(removed)}

    return await _apply(ctx, p.activity_uuid, p.expected_version, mutate)


async def _move_block(ctx: ToolContext, p: MoveBlockParams):
    def mutate(doc):
        # Resolve source, detach, then resolve destination on the mutated tree.
        src_parent, src_idx, _src = d.resolve_path(doc, p.from_path)
        node = src_parent.pop(src_idx)
        try:
            dst_parent, dst_idx, _dst = d.resolve_path(doc, p.to_path)
        except d.PathError:
            src_parent.insert(src_idx, node)  # restore on failure
            raise
        dst_parent.insert(dst_idx if p.position == "before" else dst_idx + 1, node)
        return {"from_path": p.from_path, "to_path": p.to_path, "position": p.position, "moved_type": node.get("type")}

    return await _apply(ctx, p.activity_uuid, p.expected_version, mutate)


# ─── specs ──────────────────────────────────────────────────────────────────


def _edit_spec(name, desc, model, execute, summarize):
    return ToolSpec(
        name=name, description=desc, params_model=model, tier=ActionTier.EDIT,
        rights_bucket="activities", access_action=AccessAction.UPDATE, execute=execute,
        target_param="activity_uuid", target_kind="activity", summarize=summarize,
    )


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="read_activity_content",
        description=(
            "Read an activity's content as an indexed outline (a `path` + type + "
            "text preview per block). ALWAYS call this before editing an existing "
            "activity so you can target the exact block to change and get "
            "current_version for a safe edit."
        ),
        params_model=ReadContentParams,
        tier=ActionTier.READ,
        rights_bucket="activities",
        access_action=AccessAction.READ,
        execute=_read_content,
        target_param="activity_uuid",
        target_kind="activity",
    ),
    ToolSpec(
        name="find_in_activity",
        description="Find blocks in an activity whose text matches a query; returns their paths. Use to locate the block to edit in a long activity.",
        params_model=FindParams,
        tier=ActionTier.READ,
        rights_bucket="activities",
        access_action=AccessAction.READ,
        execute=_find,
        target_param="activity_uuid",
        target_kind="activity",
    ),
    _edit_spec(
        "edit_block_text",
        "Edit the text of one block WITHOUT touching the rest of the document. "
        "Use `find`+`replace` for a surgical wording change (preserves bold/links); "
        "use `text` to rewrite the whole block's text. Works on paragraphs, "
        "headings, callouts, badges, buttons.",
        EditTextParams, _edit_text,
        lambda p: (f"Replace \"{p.find}\" → \"{p.replace}\" at {p.path}" if p.find is not None
                   else f"Set text at {p.path}"),
    ),
    _edit_spec(
        "update_block_attrs",
        "Change a block's settings by merging attrs — e.g. a callout's `type`, a "
        "flipcard's question/answer, a quiz's `questions`, an embed's url. Only "
        "the given keys change (null removes a key). See describe_activity_blocks "
        "for each block's attrs.",
        UpdateAttrsParams, _update_attrs,
        lambda p: f"Update {list(p.attrs)} on the block at {p.path}",
    ),
    _edit_spec(
        "replace_block",
        "Replace one block entirely with a new node (see describe_activity_blocks). "
        "Use when changing a block's type or rebuilding a complex block.",
        ReplaceBlockParams, _replace_block,
        lambda p: f"Replace block at {p.path} with a {p.new_block.get('type','block')}",
    ),
    _edit_spec(
        "insert_block",
        "Insert a new block relative to an existing one (before/after, or "
        "child_start/child_end to nest inside a list). Use describe_activity_blocks "
        "for the node shape.",
        InsertBlockParams, _insert_block,
        lambda p: f"Insert a {p.new_block.get('type','block')} {p.position} {p.path}",
    ),
    _edit_spec(
        "delete_block",
        "Delete one block from an activity (undoable via restore_activity_version).",
        DeleteBlockParams, _delete_block,
        lambda p: f"Delete the block at {p.path}",
    ),
    _edit_spec(
        "move_block",
        "Reorder a block: move it before/after another block.",
        MoveBlockParams, _move_block,
        lambda p: f"Move block {p.from_path} {p.position} {p.to_path}",
    ),
]
