"""Board tools — list/read/create/update/duplicate/delete + member management.

Every tool wraps an existing boards service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the service's own RBAC
checks stay authoritative. Params models are curated subsets of the service
schemas — enough for an agent, nothing internal (ydoc state, thumbnails).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from src.db.boards import BoardCreate, BoardMemberCreate, BoardUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
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


def _compact_board(board) -> dict:
    data = jsonable(board)
    keep = (
        "board_uuid",
        "name",
        "description",
        "public",
        "thumbnail_image",
        "member_count",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    return out


def _compact_member(member) -> dict:
    data = jsonable(member)
    keep = ("user_uuid", "user_id", "username", "role", "creation_date")
    return {k: data.get(k) for k in keep if k in data}


# ─── params ────────────────────────────────────────────────────────────────


class ListBoardsParams(BaseModel):
    pass


class GetBoardParams(BaseModel):
    board_uuid: str


class CreateBoardParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    public: bool = Field(
        False,
        description="Whether the board is publicly visible; boards are private by default.",
    )


class UpdateBoardParams(BaseModel):
    board_uuid: str
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    public: bool | None = None


class DuplicateBoardParams(BaseModel):
    board_uuid: str


class DeleteBoardParams(BaseModel):
    board_uuid: str
    confirm: bool | None = None


class ManageBoardMembersParams(BaseModel):
    board_uuid: str
    operation: Literal["add", "remove"] = Field(
        ..., description="'add' to invite the user to the board, 'remove' to take them off it."
    )
    user_id: int = Field(..., ge=1, description="Numeric id of the target user (must belong to the organization).")
    role: Literal["editor", "viewer"] = Field(
        "editor",
        description="Role granted when adding (ignored on remove). Ownership is not assignable.",
    )


class ListBoardMembersParams(BaseModel):
    board_uuid: str


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_boards(ctx: ToolContext, p: ListBoardsParams):
    boards = await get_boards_by_org(ctx.request, ctx.org.id, ctx.user, ctx.db_session)
    return [_compact_board(b) for b in boards]


async def _get_board(ctx: ToolContext, p: GetBoardParams):
    board = await get_board(ctx.request, p.board_uuid, ctx.user, ctx.db_session)
    return jsonable(board)


async def _create_board(ctx: ToolContext, p: CreateBoardParams):
    board = await create_board(
        ctx.request,
        ctx.org.id,
        BoardCreate(name=p.name, description=p.description, public=p.public),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(board)


async def _update_board(ctx: ToolContext, p: UpdateBoardParams):
    patch = p.model_dump(exclude={"board_uuid"}, exclude_none=True)
    board = await update_board(
        ctx.request,
        p.board_uuid,
        BoardUpdate(**patch),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(board)


async def _duplicate_board(ctx: ToolContext, p: DuplicateBoardParams):
    board = await duplicate_board(ctx.request, p.board_uuid, ctx.user, ctx.db_session)
    return _compact_board(board)


async def _delete_board(ctx: ToolContext, p: DeleteBoardParams):
    return jsonable(
        await delete_board(ctx.request, p.board_uuid, ctx.user, ctx.db_session)
    )


async def _manage_board_members(ctx: ToolContext, p: ManageBoardMembersParams):
    if p.operation == "add":
        member = await add_board_member(
            ctx.request,
            p.board_uuid,
            BoardMemberCreate(user_id=p.user_id, role=p.role),
            ctx.user,
            ctx.db_session,
        )
        return _compact_member(member)
    return jsonable(
        await remove_board_member(
            ctx.request, p.board_uuid, p.user_id, ctx.user, ctx.db_session
        )
    )


async def _list_board_members(ctx: ToolContext, p: ListBoardMembersParams):
    members = await get_board_members(ctx.request, p.board_uuid, ctx.user, ctx.db_session)
    return [_compact_member(m) for m in members]


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_boards",
        description=(
            "List the organization's collaborative whiteboards (name, "
            "visibility, member count). Use FIRST to resolve a board "
            "mentioned by name before acting on it."
        ),
        params_model=ListBoardsParams,
        tier=ActionTier.READ,
        rights_bucket="boards",
        access_action=AccessAction.READ,
        execute=_list_boards,
    ),
    ToolSpec(
        name="get_board",
        description="Get one board's full details by uuid.",
        params_model=GetBoardParams,
        tier=ActionTier.READ,
        rights_bucket="boards",
        access_action=AccessAction.READ,
        execute=_get_board,
        target_param="board_uuid",
        target_kind="board",
    ),
    ToolSpec(
        name="create_board",
        description=(
            "Create a new collaborative whiteboard in the organization; the "
            "caller becomes its owner."
        ),
        params_model=CreateBoardParams,
        tier=ActionTier.CREATE,
        rights_bucket="boards",
        access_action=AccessAction.CREATE,
        execute=_create_board,
        target_kind="board",
        summarize=lambda p: f'Create board "{p.name}"',
    ),
    ToolSpec(
        name="update_board",
        description=(
            "Update board fields (name, description, public visibility). "
            "Only send fields to change."
        ),
        params_model=UpdateBoardParams,
        tier=ActionTier.EDIT,
        rights_bucket="boards",
        access_action=AccessAction.UPDATE,
        execute=_update_board,
        target_param="board_uuid",
        target_kind="board",
        summarize=lambda p: "Update board fields: "
        + ", ".join(p.model_dump(exclude={"board_uuid"}, exclude_none=True) or ["-"]),
    ),
    ToolSpec(
        name="duplicate_board",
        description=(
            "Duplicate an existing board (name, description, visibility); "
            "the copy starts empty of members besides the caller as owner."
        ),
        params_model=DuplicateBoardParams,
        tier=ActionTier.CREATE,
        rights_bucket="boards",
        access_action=AccessAction.CREATE,
        execute=_duplicate_board,
        target_param="board_uuid",
        target_kind="board",
    ),
    ToolSpec(
        name="delete_board",
        description=(
            "Permanently delete a board, its content and its memberships. "
            "Irreversible."
        ),
        params_model=DeleteBoardParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="boards",
        access_action=AccessAction.DELETE,
        execute=_delete_board,
        target_param="board_uuid",
        target_kind="board",
    ),
    ToolSpec(
        name="manage_board_members",
        description=(
            "Add a user to a board (as editor or viewer) or remove one. "
            "Boards cap at 10 members and the owner cannot be removed. "
            "Resolve the user's numeric id first (e.g. via user tools)."
        ),
        params_model=ManageBoardMembersParams,
        tier=ActionTier.EDIT,
        rights_bucket="boards",
        access_action=AccessAction.UPDATE,
        execute=_manage_board_members,
        target_param="board_uuid",
        target_kind="board",
        summarize=lambda p: (
            f"Add user {p.user_id} to board as {p.role}"
            if p.operation == "add"
            else f"Remove user {p.user_id} from board"
        ),
    ),
    ToolSpec(
        name="list_board_members",
        description="List a board's members with their roles.",
        params_model=ListBoardMembersParams,
        tier=ActionTier.READ,
        rights_bucket="boards",
        access_action=AccessAction.READ,
        execute=_list_board_members,
        target_param="board_uuid",
        target_kind="board",
    ),
]
