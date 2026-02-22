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


@router.post("/")
async def api_create_board(
    request: Request,
    org_id: int,
    board_object: BoardCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await create_board(request, org_id, board_object, current_user, db_session)


@router.get("/org/{org_id}")
async def api_get_boards_by_org(
    request: Request,
    org_id: int,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[BoardRead]:
    return await get_boards_by_org(request, org_id, current_user, db_session)


@router.get("/{board_uuid}")
async def api_get_board(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await get_board(request, board_uuid, current_user, db_session)


@router.put("/{board_uuid}")
async def api_update_board(
    request: Request,
    board_uuid: str,
    board_object: BoardUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await update_board(request, board_uuid, board_object, current_user, db_session)


@router.delete("/{board_uuid}")
async def api_delete_board(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await delete_board(request, board_uuid, current_user, db_session)


@router.get("/{board_uuid}/members")
async def api_get_board_members(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[BoardMemberRead]:
    return await get_board_members(request, board_uuid, current_user, db_session)


@router.post("/{board_uuid}/thumbnail")
async def api_update_board_thumbnail(
    request: Request,
    board_uuid: str,
    thumbnail: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardRead:
    return await update_board_thumbnail(request, board_uuid, current_user, db_session, thumbnail)


@router.post("/{board_uuid}/members")
async def api_add_board_member(
    request: Request,
    board_uuid: str,
    member_object: BoardMemberCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardMemberRead:
    return await add_board_member(request, board_uuid, member_object, current_user, db_session)


@router.post("/{board_uuid}/members/batch")
async def api_add_board_members_batch(
    request: Request,
    board_uuid: str,
    batch_object: BoardMemberBatchCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[BoardMemberRead]:
    return await add_board_members_batch(request, board_uuid, batch_object, current_user, db_session)


@router.delete("/{board_uuid}/members/{user_id}")
async def api_remove_board_member(
    request: Request,
    board_uuid: str,
    user_id: int,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    return await remove_board_member(request, board_uuid, user_id, current_user, db_session)


@router.get("/{board_uuid}/membership")
async def api_check_board_membership(
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BoardMemberRead:
    return await check_board_membership(board_uuid, current_user, db_session)


# Internal endpoints for Hocuspocus collab server (protected by verify_internal_key dependency on internal_router)

@internal_router.get("/{board_uuid}/ydoc")
async def api_get_ydoc_state(
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    state = await get_ydoc_state(board_uuid, db_session)
    if state is None:
        return Response(content=b"", media_type="application/octet-stream")
    return Response(content=state, media_type="application/octet-stream")


@internal_router.put("/{board_uuid}/ydoc")
async def api_store_ydoc_state(
    request: Request,
    board_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    body = await request.body()
    return await store_ydoc_state(board_uuid, body, db_session)
