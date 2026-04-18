import hmac
import os
from typing import List
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, UploadFile, File
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.boards import (
    BoardCreate,
    BoardRead,
    BoardUpdate,
    BoardMemberCreate,
    BoardMemberBatchCreate,
    BoardMemberRead,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_boards_feature
from src.services.boards.boards import (
    create_board,
    get_board,
    get_boards_by_org,
    update_board,
    duplicate_board,
    delete_board,
    add_board_member,
    add_board_members_batch,
    remove_board_member,
    check_board_membership,
    get_board_members,
    update_board_thumbnail,
    get_ydoc_state,
    store_ydoc_state,
)

router = APIRouter(dependencies=[Depends(require_boards_feature)])


async def verify_internal_key(x_internal_key: str = Header(...)):
    """FastAPI dependency that validates the shared collab internal key."""
    expected_key = os.getenv("COLLAB_INTERNAL_KEY", "")
    if not expected_key or not hmac.compare_digest(x_internal_key, expected_key):
        raise HTTPException(status_code=403, detail="Invalid internal key")


internal_router = APIRouter(dependencies=[Depends(verify_internal_key)])


@router.post(
    "/",
    response_model=BoardRead,
    summary="Create a board",
    description="Create a new collaborative board within an organization. The authenticated user becomes the board owner.",
    responses={
        200: {"description": "Board created successfully.", "model": BoardRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to create boards"},
        404: {"description": "Organization not found"},
    },
)
async def api_create_board(
    request: Request,
    org_id: int,
    board_object: BoardCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await create_board(request, org_id, board_object, current_user, db_session)


@router.get(
    "/org/{org_id}",
    response_model=List[BoardRead],
    summary="List boards for an organization",
    description="List all boards in the given organization that the current user is a member of or allowed to see.",
    responses={
        200: {"description": "List of boards accessible to the current user.", "model": List[BoardRead]},
        401: {"description": "Authentication required"},
        403: {"description": "Access denied to this organization"},
    },
)
async def api_get_boards_by_org(
    request: Request,
    org_id: int,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[BoardRead]:
    return await get_boards_by_org(request, org_id, current_user, db_session)


@router.get(
    "/{board_uuid}",
    response_model=BoardRead,
    summary="Get a board by UUID",
    description="Retrieve a single board by its UUID. The current user must be a member of the board.",
    responses={
        200: {"description": "The requested board.", "model": BoardRead},
        401: {"description": "Authentication required"},
        403: {"description": "Not a member of this board"},
        404: {"description": "Board not found"},
    },
)
async def api_get_board(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await get_board(request, board_uuid, current_user, db_session)


@router.put(
    "/{board_uuid}",
    response_model=BoardRead,
    summary="Update a board",
    description="Update a board's fields. The current user must have update permission on the board.",
    responses={
        200: {"description": "Board updated successfully.", "model": BoardRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to update board"},
        404: {"description": "Board not found"},
    },
)
async def api_update_board(
    request: Request,
    board_uuid: str,
    board_object: BoardUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await update_board(request, board_uuid, board_object, current_user, db_session)


@router.post(
    "/{board_uuid}/duplicate",
    response_model=BoardRead,
    summary="Duplicate a board",
    description="Create a copy of an existing board. The current user must have permission to create boards in the source org.",
    responses={
        200: {"description": "Board duplicated successfully.", "model": BoardRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Board not found"},
    },
)
async def api_duplicate_board(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await duplicate_board(request, board_uuid, current_user, db_session)


@router.delete(
    "/{board_uuid}",
    summary="Delete a board",
    description="Delete a board by UUID. The current user must be the board owner or have delete permission.",
    responses={
        200: {"description": "Board deleted successfully."},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to delete board"},
        404: {"description": "Board not found"},
    },
)
async def api_delete_board(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await delete_board(request, board_uuid, current_user, db_session)


@router.get(
    "/{board_uuid}/members",
    response_model=List[BoardMemberRead],
    summary="List board members",
    description="Return the list of members on a given board. The current user must be a member of the board.",
    responses={
        200: {"description": "List of board members.", "model": List[BoardMemberRead]},
        401: {"description": "Authentication required"},
        403: {"description": "Not a member of this board"},
        404: {"description": "Board not found"},
    },
)
async def api_get_board_members(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[BoardMemberRead]:
    return await get_board_members(request, board_uuid, current_user, db_session)


@router.post(
    "/{board_uuid}/thumbnail",
    response_model=BoardRead,
    summary="Upload a board thumbnail",
    description="Upload or replace the thumbnail image for a board. The current user must have update permission on the board.",
    responses={
        200: {"description": "Thumbnail uploaded and board updated.", "model": BoardRead},
        400: {"description": "No thumbnail file provided"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to update board"},
        404: {"description": "Board not found"},
    },
)
async def api_update_board_thumbnail(
    request: Request,
    board_uuid: str,
    thumbnail: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await update_board_thumbnail(request, board_uuid, current_user, db_session, thumbnail)


@router.post(
    "/{board_uuid}/members",
    response_model=BoardMemberRead,
    summary="Add a member to a board",
    description="Add a single user as a member of the given board. The current user must have permission to manage board members.",
    responses={
        200: {"description": "Member added to board.", "model": BoardMemberRead},
        401: {"description": "Authentication required"},
        403: {"description": "Board member limit reached or insufficient permissions"},
        404: {"description": "Board or user not found"},
        409: {"description": "User is already a board member"},
    },
)
async def api_add_board_member(
    request: Request,
    board_uuid: str,
    member_object: BoardMemberCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardMemberRead:
    return await add_board_member(request, board_uuid, member_object, current_user, db_session)


@router.post(
    "/{board_uuid}/members/batch",
    response_model=List[BoardMemberRead],
    summary="Add multiple members to a board",
    description="Add several users as members of a board in a single request. The current user must have permission to manage board members.",
    responses={
        200: {"description": "Members added to board.", "model": List[BoardMemberRead]},
        401: {"description": "Authentication required"},
        403: {"description": "Board member limit reached or insufficient permissions"},
        404: {"description": "Board not found"},
    },
)
async def api_add_board_members_batch(
    request: Request,
    board_uuid: str,
    batch_object: BoardMemberBatchCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[BoardMemberRead]:
    return await add_board_members_batch(request, board_uuid, batch_object, current_user, db_session)


@router.delete(
    "/{board_uuid}/members/{user_id}",
    summary="Remove a member from a board",
    description="Remove a user from a board's member list. The board owner cannot be removed via this endpoint.",
    responses={
        200: {"description": "Member removed from board."},
        400: {"description": "Cannot remove the board owner"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Board member not found"},
    },
)
async def api_remove_board_member(
    request: Request,
    board_uuid: str,
    user_id: int,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await remove_board_member(request, board_uuid, user_id, current_user, db_session)


@router.get(
    "/{board_uuid}/membership",
    response_model=BoardMemberRead,
    summary="Check current user's board membership",
    description="Return the current user's membership record on a board, if any. Used by clients to check role and access before loading the collab session.",
    responses={
        200: {"description": "The current user's membership record on the board.", "model": BoardMemberRead},
        401: {"description": "Authentication required"},
        403: {"description": "Not a member of this board"},
        404: {"description": "Board not found"},
    },
)
async def api_check_board_membership(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardMemberRead:
    return await check_board_membership(request, board_uuid, current_user, db_session)


# Internal endpoints for Hocuspocus collab server (protected by verify_internal_key dependency on internal_router)

@internal_router.get(
    "/{board_uuid}/ydoc",
    summary="Fetch the Yjs document state for a board",
    description="Return the persisted Yjs document binary state for a board. Internal endpoint used by the Hocuspocus collab server; requires the shared internal key header.",
    responses={
        200: {"description": "Binary Yjs document state (empty body if no state is stored).", "content": {"application/octet-stream": {}}},
        403: {"description": "Invalid internal key"},
    },
)
async def api_get_ydoc_state(
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    state = await get_ydoc_state(board_uuid, db_session)
    if state is None:
        return Response(content=b"", media_type="application/octet-stream")
    return Response(content=state, media_type="application/octet-stream")


@internal_router.put(
    "/{board_uuid}/ydoc",
    summary="Persist the Yjs document state for a board",
    description="Store the latest Yjs document binary state for a board. Internal endpoint used by the Hocuspocus collab server; requires the shared internal key header.",
    responses={
        200: {"description": "Yjs document state persisted successfully."},
        403: {"description": "Invalid internal key"},
        404: {"description": "Board not found"},
    },
)
async def api_store_ydoc_state(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    body = await request.body()
    return await store_ydoc_state(board_uuid, body, db_session)
