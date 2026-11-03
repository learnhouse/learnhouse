"""Board tools: collaborative whiteboards and their members.

Boards act as a person: the HTTP routes refuse API tokens, so these tools do
too (a token caller would otherwise be recorded as the board's owner by its
token id). Every id is loaded through `refs` (only from the connected
organization), and people through `refs.load_member`, before the boards
service runs its own checks. The whiteboard drawing itself is not exposed.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from src.db.boards import BoardCreate, BoardMemberCreate, BoardUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import Paging
from src.services.boards.boards import (
    add_board_member,
    create_board,
    delete_board,
    duplicate_board,
    get_board,
    get_board_members,
    get_boards_by_org,
    remove_board_member,
    update_board,
)

BOARD_MEMBER_CAP = 10


# ─── helpers ─────────────────────────────────────────────────────────────────


async def _board_ref(ctx: ToolContext, board, **extra) -> dict:
    return refs.ref(
        "board",
        board.board_uuid,
        board.name,
        await refs.web_url(ctx, "board", board=board.board_uuid),
        **extra,
    )


# ─── params ──────────────────────────────────────────────────────────────────


class ListBoardsParams(Paging):
    pass


class GetBoardParams(BaseModel):
    board_uuid: str = Field(..., max_length=100, description="The board, e.g. board_...")


class CreateBoardParams(BaseModel):
    name: str | None = Field(
        None, min_length=1, max_length=200, description="Board name. Required unless copying."
    )
    description: str | None = Field(None, max_length=2000, description="Short description.")
    public: bool = Field(
        False, description="True lets anyone with the link view it; boards are private to their members by default."
    )
    copy_from_board_uuid: str | None = Field(
        None, max_length=100, description="Start from a copy of this board's settings."
    )

    @model_validator(mode="after")
    def _needs_name(self):
        if not self.name and not self.copy_from_board_uuid:
            raise ValueError("name is required unless copy_from_board_uuid is given")
        return self


class UpdateBoardParams(BaseModel):
    board_uuid: str = Field(..., max_length=100, description="The board to change.")
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    description: str | None = Field(None, max_length=2000, description="New description.")
    public: bool | None = Field(None, description="True makes it viewable by anyone, false private to members.")


class BoardMemberAdd(BaseModel):
    member: str = Field(..., min_length=1, max_length=320, description="user_uuid, email or username of an org member.")
    role: Literal["editor", "viewer"] = Field("editor", description="editor can draw, viewer can only look.")


class ManageBoardMembersParams(BaseModel):
    board_uuid: str = Field(..., max_length=100, description="The board.")
    add: list[BoardMemberAdd] = Field(
        default_factory=list, max_length=BOARD_MEMBER_CAP, description="Members to add, with their role."
    )
    remove: list[str] = Field(
        default_factory=list,
        max_length=BOARD_MEMBER_CAP,
        description="Members to take off the board (user_uuid, email or username).",
    )

    @model_validator(mode="after")
    def _something(self):
        if not self.add and not self.remove:
            raise ValueError("pass at least one member in add or remove")
        return self


class DeleteBoardParams(BaseModel):
    board_uuid: str = Field(..., max_length=100, description="The board to delete.")


# ─── executors ───────────────────────────────────────────────────────────────


async def _list_boards(ctx: ToolContext, p: ListBoardsParams):
    # The service keeps private boards to their members (admins see all).
    boards = await get_boards_by_org(ctx.request, ctx.org.id, ctx.user, ctx.db_session)
    offset = results.offset_of(p.cursor)
    chunk = boards[offset : offset + p.limit]
    items = [
        await _board_ref(
            ctx,
            b,
            public=bool(b.public),
            members=b.member_count,
            description=results.clip(b.description or "") or None,
            updated_at=b.update_date or None,
        )
        for b in chunk
    ]
    out = results.page(items, offset=offset, limit=p.limit, total=len(boards))
    # Board names and descriptions are written by their members.
    return results.untrusted(out, "items") if items else out


async def _get_board(ctx: ToolContext, p: GetBoardParams):
    row = await refs.load(ctx, "board", p.board_uuid)
    board = await get_board(ctx.request, row.board_uuid, ctx.user, ctx.db_session)
    members = await get_board_members(ctx.request, row.board_uuid, ctx.user, ctx.db_session)
    out = {
        "board": await _board_ref(ctx, board),
        "description": board.description or "",
        "public": bool(board.public),
        "created_at": board.creation_date or None,
        "updated_at": board.update_date or None,
        # Name and role only; emails stay with the dashboard.
        "members": [
            {"user": refs.ref("user", m.user_uuid, m.username), "role": str(getattr(m.role, "value", m.role))}
            for m in members
        ],
        "member_limit": BOARD_MEMBER_CAP,
    }
    results.clip_field(out, "description")
    return results.untrusted(out, "board", "description", "members")


async def _create_board(ctx: ToolContext, p: CreateBoardParams):
    if p.copy_from_board_uuid:
        source = await refs.load(ctx, "board", p.copy_from_board_uuid)
        # The service checks the caller can read the source and create boards.
        copy = await duplicate_board(ctx.request, source.board_uuid, ctx.user, ctx.db_session)
        # A copy takes the source's visibility; set the one asked for instead.
        patch = {"public": p.public}
        if p.name:
            patch["name"] = p.name
        if p.description is not None:
            patch["description"] = p.description
        board = await update_board(ctx.request, copy.board_uuid, BoardUpdate(**patch), ctx.user, ctx.db_session)
        return results.changed(
            f'Created {"public" if board.public else "private"} board "{board.name}" as a copy of "{source.name}".',
            board=await _board_ref(ctx, board, public=bool(board.public)),
            copied_from=await _board_ref(ctx, source),
        )
    board = await create_board(
        ctx.request,
        ctx.org.id,
        BoardCreate(name=p.name, description=p.description, public=p.public),
        ctx.user,
        ctx.db_session,
    )
    return results.changed(
        f'Created {"public" if board.public else "private"} board "{board.name}"; you are its owner.',
        board=await _board_ref(ctx, board, public=bool(board.public)),
    )


async def _update_board(ctx: ToolContext, p: UpdateBoardParams):
    row = await refs.load(ctx, "board", p.board_uuid)
    patch = p.model_dump(include={"name", "description", "public"}, exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    board = await update_board(ctx.request, row.board_uuid, BoardUpdate(**patch), ctx.user, ctx.db_session)
    return results.changed(
        f'Updated board "{board.name}" ({", ".join(patch)}).',
        board=await _board_ref(ctx, board, public=bool(board.public)),
    )


async def _manage_board_members(ctx: ToolContext, p: ManageBoardMembersParams):
    row = await refs.load(ctx, "board", p.board_uuid)
    # Resolve everyone first so a typo changes nothing.
    to_add = [(await refs.load_member(ctx, entry.member), entry.role) for entry in p.add]
    to_remove = [await refs.load_member(ctx, who) for who in p.remove]

    outcomes = []
    for user, role in to_add:
        user_ref = refs.ref("user", user.user_uuid, user.username)
        try:
            await add_board_member(
                ctx.request, row.board_uuid, BoardMemberCreate(user_id=user.id, role=role), ctx.user, ctx.db_session
            )
            outcomes.append({"user": user_ref, "result": "added", "role": role})
        except HTTPException as e:
            if e.status_code == 409:
                outcomes.append({"user": user_ref, "result": "already_member"})
            elif e.status_code == 403 and "limit" in str(e.detail).lower():
                outcomes.append({"user": user_ref, "result": "not_added", "error": str(e.detail)})
            else:
                raise
    for user in to_remove:
        user_ref = refs.ref("user", user.user_uuid, user.username)
        try:
            await remove_board_member(ctx.request, row.board_uuid, user.id, ctx.user, ctx.db_session)
            outcomes.append({"user": user_ref, "result": "removed"})
        except HTTPException as e:
            if e.status_code == 404:
                outcomes.append({"user": user_ref, "result": "not_a_member"})
            elif e.status_code == 400:
                outcomes.append({"user": user_ref, "result": "not_removed", "error": str(e.detail)})
            else:
                raise

    added = sum(1 for o in outcomes if o["result"] == "added")
    removed = sum(1 for o in outcomes if o["result"] == "removed")
    return results.changed(
        f'Board "{row.name}": {added} added, {removed} removed.',
        board=await _board_ref(ctx, row),
        members=outcomes,
    )


async def _delete_board(ctx: ToolContext, p: DeleteBoardParams):
    row = await refs.load(ctx, "board", p.board_uuid)
    name = row.name
    await delete_board(ctx.request, row.board_uuid, ctx.user, ctx.db_session)
    return results.changed(
        f'Deleted board "{name}" with its drawing and members.', board=refs.ref("board", p.board_uuid, name)
    )


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_boards",
        description=(
            "List the whiteboards you can open, newest first: name, link, public flag, member "
            "count. Paged."
        ),
        params_model=ListBoardsParams,
        tier=ActionTier.READ,
        rights_bucket="boards",
        access_action=AccessAction.READ,
        execute=_list_boards,
        api_tokens=False,
        title="List boards",
    ),
    ToolSpec(
        name="get_board",
        description="One whiteboard: description, visibility and its members with their roles (owner, editor, viewer).",
        params_model=GetBoardParams,
        tier=ActionTier.READ,
        rights_bucket="boards",
        access_action=AccessAction.READ,
        execute=_get_board,
        target_param="board_uuid",
        target_kind="board",
        api_tokens=False,
        title="Get board",
    ),
    ToolSpec(
        name="create_board",
        description=(
            "Create a whiteboard you own, private by default, or copy another board's settings with "
            "copy_from_board_uuid. A public board needs approval."
        ),
        params_model=CreateBoardParams,
        tier=ActionTier.CREATE,
        rights_bucket="boards",
        access_action=AccessAction.CREATE,
        execute=_create_board,
        target_kind="board",
        api_tokens=False,
        approval_if=lambda p: p.public,
        summarize=lambda p: (
            f"Copy board {p.copy_from_board_uuid}" if p.copy_from_board_uuid else f'Create board "{p.name}"'
        )
        + (" as public" if p.public else ""),
        title="Create board",
    ),
    ToolSpec(
        name="update_board",
        description=(
            "Rename a whiteboard, change its description, or make it public or private. Send only "
            "what changes. Visibility changes need approval."
        ),
        params_model=UpdateBoardParams,
        tier=ActionTier.EDIT,
        rights_bucket="boards",
        access_action=AccessAction.UPDATE,
        execute=_update_board,
        target_param="board_uuid",
        target_kind="board",
        api_tokens=False,
        approval_if=lambda p: p.public is not None,
        idempotent=True,
        summarize=lambda p: "Update board: "
        + ", ".join(p.model_dump(exclude={"board_uuid"}, exclude_none=True) or ["nothing"]),
        title="Update board",
    ),
    ToolSpec(
        name="manage_board_members",
        description=(
            "Add org members to a whiteboard as editor or viewer, or remove them (by user_uuid, "
            f"email or username). At most {BOARD_MEMBER_CAP} members per board; the owner stays. "
            "Returns the result per person. Needs approval."
        ),
        params_model=ManageBoardMembersParams,
        tier=ActionTier.EDIT,
        rights_bucket="boards",
        access_action=AccessAction.UPDATE,
        execute=_manage_board_members,
        target_param="board_uuid",
        target_kind="board",
        api_tokens=False,
        approval=True,
        idempotent=True,
        summarize=lambda p: (
            f"Board members: add {', '.join(f'{a.member} ({a.role})' for a in p.add) or 'nobody'}; "
            f"remove {', '.join(p.remove) or 'nobody'}"
        ),
        title="Manage board members",
    ),
    ToolSpec(
        name="delete_board",
        description="Permanently delete a whiteboard with its drawing and member list.",
        params_model=DeleteBoardParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="boards",
        access_action=AccessAction.DELETE,
        execute=_delete_board,
        target_param="board_uuid",
        target_kind="board",
        api_tokens=False,
        summarize=lambda p: f"Delete board {p.board_uuid}",
        title="Delete board",
    ),
]
