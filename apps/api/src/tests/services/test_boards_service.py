"""Tests for src/services/boards/boards.py."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select

from src.db.boards import (
    Board,
    BoardCreate,
    BoardMember,
    BoardMemberBatchCreate,
    BoardMemberCreate,
    BoardMemberRole,
    BoardUpdate,
)
from src.db.resource_authors import ResourceAuthor
from src.db.users import User
from src.services.boards.boards import (
    add_board_member,
    add_board_members_batch,
    check_board_membership,
    create_board,
    delete_board,
    duplicate_board,
    get_board,
    get_board_members,
    get_boards_by_org,
    get_ydoc_state,
    remove_board_member,
    store_ydoc_state,
    update_board,
    update_board_thumbnail,
)


def _make_user(db, *, id, email, username):
    user = User(
        id=id,
        username=username,
        first_name=username.capitalize(),
        last_name="User",
        email=email,
        password="hashed",
        user_uuid=f"user_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_board(db, org, admin_user, **overrides):
    board = Board(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Board"),
        description=overrides.pop("description", "Desc"),
        thumbnail_image=overrides.pop("thumbnail_image", ""),
        public=overrides.pop("public", True),
        board_uuid=overrides.pop("board_uuid", "board_test"),
        created_by=overrides.pop("created_by", admin_user.id),
        ydoc_state=overrides.pop("ydoc_state", None),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


def _make_member(db, board_id, user_id, role=BoardMemberRole.EDITOR):
    member = BoardMember(
        board_id=board_id,
        user_id=user_id,
        role=role,
        creation_date=str(datetime.now()),
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


class TestBoardsService:
    @pytest.mark.asyncio
    async def test_create_get_update_duplicate_delete_board(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.boards.boards.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            created = await create_board(
                mock_request,
                org.id,
                BoardCreate(name="Board", description="Desc", thumbnail_image=""),
                admin_user,
                db,
            )

            fetched = await get_board(mock_request, created.board_uuid, admin_user, db)
            updated = await update_board(
                mock_request,
                created.board_uuid,
                BoardUpdate(name="Updated", public=False),
                admin_user,
                db,
            )
            duplicated = await duplicate_board(
                mock_request, created.board_uuid, admin_user, db
            )
            deleted = await delete_board(
                mock_request, created.board_uuid, admin_user, db
            )

        assert created.name == "Board"
        assert fetched.board_uuid == created.board_uuid
        assert updated.name == "Updated"
        assert updated.public is False
        assert duplicated.name.endswith("(copy)")
        assert deleted == {"detail": "Board deleted"}
        assert db.exec(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == duplicated.board_uuid
            )
        ).first() is not None

    @pytest.mark.asyncio
    async def test_get_boards_by_org_and_get_board_members(
        self, db, org, admin_user, mock_request
    ):
        board = _make_board(db, org, admin_user)
        _make_member(db, board.id, admin_user.id, BoardMemberRole.OWNER)
        other_user = _make_user(
            db, id=20, email="member@test.com", username="member"
        )
        _make_member(db, board.id, other_user.id)

        with patch("src.services.boards.boards.require_org_membership"), patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ):
            boards = await get_boards_by_org(mock_request, org.id, admin_user, db)
            members = await get_board_members(
                mock_request, board.board_uuid, admin_user, db
            )

        assert len(boards) == 1
        assert boards[0].member_count == 2
        assert {member.user_id for member in members} == {admin_user.id, other_user.id}

    @pytest.mark.asyncio
    async def test_add_and_batch_add_members(
        self, db, org, admin_user, mock_request
    ):
        board = _make_board(db, org, admin_user)
        _make_member(db, board.id, admin_user.id, BoardMemberRole.OWNER)
        _make_user(db, id=21, email="first@test.com", username="first")
        _make_user(db, id=22, email="second@test.com", username="second")
        _make_user(db, id=23, email="third@test.com", username="third")
        member_create = BoardMemberCreate(user_id=21, role=BoardMemberRole.EDITOR)
        member_create.role = BoardMemberRole.EDITOR
        batch_create = BoardMemberBatchCreate(
            members=[
                BoardMemberCreate(user_id=21, role=BoardMemberRole.EDITOR),
                BoardMemberCreate(user_id=22, role=BoardMemberRole.VIEWER),
                BoardMemberCreate(user_id=23, role=BoardMemberRole.EDITOR),
            ]
        )
        batch_create.members[0].role = BoardMemberRole.EDITOR
        batch_create.members[1].role = BoardMemberRole.VIEWER
        batch_create.members[2].role = BoardMemberRole.EDITOR

        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.boards.boards.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            added = await add_board_member(
                mock_request,
                board.board_uuid,
                member_create,
                admin_user,
                db,
            )
            batched = await add_board_members_batch(
                mock_request,
                board.board_uuid,
                batch_create,
                admin_user,
                db,
            )

        assert added.user_id == 21
        assert [member.user_id for member in batched] == [22, 23]

    @pytest.mark.asyncio
    async def test_add_board_member_rejects_duplicate_and_limit(
        self, db, org, admin_user, mock_request
    ):
        board = _make_board(db, org, admin_user)
        _make_member(db, board.id, admin_user.id, BoardMemberRole.OWNER)
        _make_user(db, id=30, email="dup@test.com", username="dup")
        _make_member(db, board.id, 30)

        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as duplicate_exc:
                await add_board_member(
                    mock_request,
                    board.board_uuid,
                    BoardMemberCreate(user_id=30, role=BoardMemberRole.EDITOR),
                    admin_user,
                    db,
                )

        assert duplicate_exc.value.status_code == 409

        for user_id in range(31, 39):
            _make_user(
                db, id=user_id, email=f"user{user_id}@test.com", username=f"user{user_id}"
            )
            _make_member(db, board.id, user_id)
        _make_user(db, id=39, email="overflow@test.com", username="overflow")

        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as limit_exc:
                await add_board_member(
                    mock_request,
                    board.board_uuid,
                    BoardMemberCreate(user_id=39, role=BoardMemberRole.EDITOR),
                    admin_user,
                    db,
                )

        assert limit_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_remove_member_and_membership_checks(
        self, db, org, admin_user, mock_request
    ):
        board = _make_board(db, org, admin_user)
        owner = _make_member(db, board.id, admin_user.id, BoardMemberRole.OWNER)
        member_user = _make_user(
            db, id=40, email="member40@test.com", username="member40"
        )
        _make_member(db, board.id, member_user.id)

        membership = await check_board_membership(board.board_uuid, admin_user, db)
        assert membership.role == BoardMemberRole.OWNER

        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ):
            removed = await remove_board_member(
                mock_request, board.board_uuid, member_user.id, admin_user, db
            )
        assert removed == {"detail": "Member removed"}

        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as owner_exc:
                await remove_board_member(
                    mock_request, board.board_uuid, admin_user.id, admin_user, db
                )
        assert owner_exc.value.status_code == 400
        assert owner.id is not None

    @pytest.mark.asyncio
    async def test_check_board_membership_errors(self, db, org, admin_user):
        board = _make_board(db, org, admin_user)

        with pytest.raises(HTTPException) as missing_member_exc:
            await check_board_membership(board.board_uuid, admin_user, db)
        assert missing_member_exc.value.status_code == 403

        with pytest.raises(HTTPException) as missing_board_exc:
            await check_board_membership("missing_board", admin_user, db)
        assert missing_board_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_update_thumbnail_and_ydoc_state(
        self, db, org, admin_user, mock_request
    ):
        board = _make_board(db, org, admin_user)
        upload = UploadFile(filename="thumb.png", file=SimpleNamespace())

        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.boards.boards.upload_file",
            new_callable=AsyncMock,
            return_value="uploaded-thumb.png",
        ):
            updated = await update_board_thumbnail(
                mock_request, board.board_uuid, admin_user, db, upload
            )

        assert updated.thumbnail_image == "uploaded-thumb.png"

        state_before = await get_ydoc_state(board.board_uuid, db)
        assert state_before is None

        stored = await store_ydoc_state(board.board_uuid, b"hello", db)
        state_after = await get_ydoc_state(board.board_uuid, db)

        assert stored == {"detail": "Ydoc state stored"}
        assert state_after == b"hello"

    @pytest.mark.asyncio
    async def test_update_thumbnail_requires_file(
        self, db, org, admin_user, mock_request
    ):
        board = _make_board(db, org, admin_user)

        with patch(
            "src.services.boards.boards.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_board_thumbnail(
                    mock_request, board.board_uuid, admin_user, db, None
                )

        assert exc_info.value.status_code == 400
