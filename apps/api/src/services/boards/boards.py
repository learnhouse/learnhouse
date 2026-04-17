from typing import List, Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select, func, col
from fastapi import HTTPException, Request, UploadFile
from src.db.boards import (
    Board,
    BoardCreate,
    BoardRead,
    BoardUpdate,
    BoardMember,
    BoardMemberCreate,
    BoardMemberBatchCreate,
    BoardMemberRead,
    BoardMemberRole,
)
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, User
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.security.rbac import AccessAction, check_resource_access
from src.security.org_auth import require_org_membership
from src.services.utils.upload_content import upload_file
from src.services.webhooks.dispatch import dispatch_webhooks


async def create_board(
    request: Request,
    org_id: int,
    board_object: BoardCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> BoardRead:
    await check_resource_access(request, db_session, current_user, "board_x", AccessAction.CREATE)

    board = Board(
        **board_object.model_dump(),
        org_id=org_id,
        board_uuid=f"board_{uuid4()}",
        created_by=current_user.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(board)
    db_session.flush()
    db_session.refresh(board)

    # Add creator as owner
    member = BoardMember(
        board_id=board.id,
        user_id=current_user.id,
        role=BoardMemberRole.OWNER,
        creation_date=str(datetime.now()),
    )
    db_session.add(member)

    # Track resource authorship
    resource_author = ResourceAuthor(
        resource_uuid=board.board_uuid,
        user_id=current_user.id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(resource_author)
    db_session.commit()

    await dispatch_webhooks(
        event_name="board_created",
        org_id=org_id,
        data={
            "board_uuid": board.board_uuid,
            "name": board.name,
            "created_by": current_user.id,
        },
    )

    return _board_to_read(board, db_session)


async def get_board(
    request: Request,
    board_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> BoardRead:
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.READ)
    return _board_to_read(board, db_session)


async def get_boards_by_org(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[BoardRead]:
    # Require org membership before listing boards — prevents unauthenticated
    # and cross-org enumeration of boards.
    require_org_membership(current_user.id, org_id, db_session)

    statement = (
        select(Board)
        .where(Board.org_id == org_id)
        .order_by(Board.creation_date.desc())
    )
    boards = db_session.exec(statement).all()
    if not boards:
        return []

    board_ids = [b.id for b in boards]
    count_rows = db_session.exec(
        select(BoardMember.board_id, func.count(BoardMember.id))
        .where(col(BoardMember.board_id).in_(board_ids))
        .group_by(BoardMember.board_id)
    ).all()
    counts = {row[0]: row[1] for row in count_rows}

    return [
        BoardRead(**b.model_dump(exclude={"ydoc_state"}), member_count=counts.get(b.id, 0))
        for b in boards
    ]


async def update_board(
    request: Request,
    board_uuid: str,
    board_object: BoardUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> BoardRead:
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.UPDATE)

    for var, value in vars(board_object).items():
        if value is not None:
            setattr(board, var, value)

    board.update_date = str(datetime.now())
    db_session.add(board)
    db_session.commit()
    db_session.refresh(board)

    return _board_to_read(board, db_session)


async def duplicate_board(
    request: Request,
    board_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> BoardRead:
    source = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, source.board_uuid, AccessAction.READ)
    # Also need create permission
    await check_resource_access(request, db_session, current_user, "board_x", AccessAction.CREATE)

    board = Board(
        org_id=source.org_id,
        board_uuid=f"board_{uuid4()}",
        name=f"{source.name} (copy)",
        description=source.description,
        thumbnail_image=source.thumbnail_image,
        public=source.public,
        created_by=current_user.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(board)
    db_session.flush()
    db_session.refresh(board)

    # Add current user as owner
    member = BoardMember(
        board_id=board.id,
        user_id=current_user.id,
        role=BoardMemberRole.OWNER,
        creation_date=str(datetime.now()),
    )
    db_session.add(member)

    resource_author = ResourceAuthor(
        resource_uuid=board.board_uuid,
        user_id=current_user.id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(resource_author)
    db_session.commit()

    return _board_to_read(board, db_session)


async def delete_board(
    request: Request,
    board_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.DELETE)

    db_session.delete(board)
    db_session.commit()

    return {"detail": "Board deleted"}


async def add_board_member(
    request: Request,
    board_uuid: str,
    member_object: BoardMemberCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> BoardMemberRead:
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.UPDATE)

    # Check member limit (max 10 per board)
    member_count = db_session.exec(
        select(func.count(BoardMember.id)).where(BoardMember.board_id == board.id)
    ).one()
    if member_count >= 10:
        raise HTTPException(status_code=403, detail="Board member limit reached (max 10)")

    # Check if already a member
    existing = db_session.exec(
        select(BoardMember).where(
            BoardMember.board_id == board.id,
            BoardMember.user_id == member_object.user_id,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="User is already a board member")

    member = BoardMember(
        board_id=board.id,
        user_id=member_object.user_id,
        role=member_object.role,
        creation_date=str(datetime.now()),
    )
    db_session.add(member)
    db_session.commit()
    db_session.refresh(member)

    await dispatch_webhooks(
        event_name="board_member_added",
        org_id=board.org_id,
        data={
            "board_uuid": board.board_uuid,
            "user_id": member_object.user_id,
            "role": member_object.role.value,
        },
    )

    return _member_to_read(member, db_session)


async def add_board_members_batch(
    request: Request,
    board_uuid: str,
    batch_object: BoardMemberBatchCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[BoardMemberRead]:
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.UPDATE)

    # Current member count
    member_count = db_session.exec(
        select(func.count(BoardMember.id)).where(BoardMember.board_id == board.id)
    ).one()

    added: List[BoardMemberRead] = []

    for member_create in batch_object.members:
        # Stop if we'd exceed the limit
        if member_count + len(added) >= 10:
            break

        # Skip duplicates silently
        existing = db_session.exec(
            select(BoardMember).where(
                BoardMember.board_id == board.id,
                BoardMember.user_id == member_create.user_id,
            )
        ).first()
        if existing:
            continue

        member = BoardMember(
            board_id=board.id,
            user_id=member_create.user_id,
            role=member_create.role,
            creation_date=str(datetime.now()),
        )
        db_session.add(member)
        db_session.flush()  # get the id without committing
        db_session.refresh(member)
        added.append(_member_to_read(member, db_session))

    db_session.commit()
    return added


async def remove_board_member(
    request: Request,
    board_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.UPDATE)

    member = db_session.exec(
        select(BoardMember).where(
            BoardMember.board_id == board.id,
            BoardMember.user_id == user_id,
        )
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="Board member not found")

    if member.role == BoardMemberRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot remove the board owner")

    db_session.delete(member)
    db_session.commit()

    return {"detail": "Member removed"}


async def check_board_membership(
    board_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> BoardMemberRead:
    # Single joined query: Board + BoardMember + User in one round-trip
    result = db_session.exec(
        select(BoardMember, User)
        .join(Board, BoardMember.board_id == Board.id)
        .join(User, BoardMember.user_id == User.id)
        .where(Board.board_uuid == board_uuid, BoardMember.user_id == current_user.id)
    ).first()

    if not result:
        # Check if board exists to give the right error
        board_exists = db_session.exec(
            select(Board.id).where(Board.board_uuid == board_uuid)
        ).first()
        if not board_exists:
            raise HTTPException(status_code=404, detail="Board not found")
        raise HTTPException(status_code=403, detail="Not a member of this board")

    member, user = result
    return BoardMemberRead(
        id=member.id,
        board_id=member.board_id,
        user_id=member.user_id,
        role=member.role,
        creation_date=member.creation_date,
        username=user.username if user else None,
        email=user.email if user else None,
        avatar_image=user.avatar_image if user else None,
        user_uuid=user.user_uuid if user else None,
    )


async def get_board_members(
    request: Request,
    board_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[BoardMemberRead]:
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.READ)

    members = db_session.exec(
        select(BoardMember).where(BoardMember.board_id == board.id)
    ).all()
    if not members:
        return []

    user_ids = [m.user_id for m in members]
    users = {
        u.id: u
        for u in db_session.exec(select(User).where(col(User.id).in_(user_ids))).all()
    }
    return [
        BoardMemberRead(
            id=m.id,
            board_id=m.board_id,
            user_id=m.user_id,
            role=m.role,
            creation_date=m.creation_date,
            username=users[m.user_id].username if m.user_id in users else None,
            email=users[m.user_id].email if m.user_id in users else None,
            avatar_image=users[m.user_id].avatar_image if m.user_id in users else None,
            user_uuid=users[m.user_id].user_uuid if m.user_id in users else None,
        )
        for m in members
    ]


async def update_board_thumbnail(
    request: Request,
    board_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
) -> BoardRead:
    board = _get_board_or_404(board_uuid, db_session)
    await check_resource_access(request, db_session, current_user, board.board_uuid, AccessAction.UPDATE)

    org = db_session.exec(select(Organization).where(Organization.id == board.org_id)).first()

    if not thumbnail_file or not thumbnail_file.filename:
        raise HTTPException(status_code=400, detail="No thumbnail file provided")

    name_in_disk = await upload_file(
        file=thumbnail_file,
        directory=f"boards/{board.board_uuid}/thumbnails",
        type_of_dir="orgs",
        uuid=org.org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
    )

    board.thumbnail_image = name_in_disk
    board.update_date = str(datetime.now())
    db_session.add(board)
    db_session.commit()
    db_session.refresh(board)

    return _board_to_read(board, db_session)


async def get_ydoc_state(
    board_uuid: str,
    db_session: Session,
) -> Optional[bytes]:
    board = _get_board_or_404(board_uuid, db_session)
    return board.ydoc_state


async def store_ydoc_state(
    board_uuid: str,
    state: bytes,
    db_session: Session,
):
    # Use SELECT ... FOR UPDATE to prevent concurrent writes from overwriting each other
    statement = select(Board).where(Board.board_uuid == board_uuid).with_for_update()
    board = db_session.exec(statement).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    board.ydoc_state = state
    board.update_date = str(datetime.now())
    db_session.add(board)
    db_session.commit()
    return {"detail": "Ydoc state stored"}


def _get_board_or_404(board_uuid: str, db_session: Session) -> Board:
    statement = select(Board).where(Board.board_uuid == board_uuid)
    board = db_session.exec(statement).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


def _board_to_read(board: Board, db_session: Session) -> BoardRead:
    member_count = db_session.exec(
        select(func.count(BoardMember.id)).where(BoardMember.board_id == board.id)
    ).one()
    return BoardRead(
        **board.model_dump(exclude={"ydoc_state"}),
        member_count=member_count,
    )


def _member_to_read(member: BoardMember, db_session: Session) -> BoardMemberRead:
    user = db_session.exec(select(User).where(User.id == member.user_id)).first()
    return BoardMemberRead(
        id=member.id,
        board_id=member.board_id,
        user_id=member.user_id,
        role=member.role,
        creation_date=member.creation_date,
        username=user.username if user else None,
        email=user.email if user else None,
        avatar_image=user.avatar_image if user else None,
        user_uuid=user.user_uuid if user else None,
    )
