"""Tests for src/services/users/usergroups.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.boards import Board
from src.db.usergroups import UserGroupCreate, UserGroupUpdate
from src.services.users.usergroups import (
    _validate_resource_exists_and_belongs_to_org,
    add_resources_to_usergroup,
    add_users_to_usergroup,
    create_usergroup,
    delete_usergroup_by_id,
    get_resources_by_usergroup,
    get_usergroups_by_resource,
    get_users_linked_to_usergroup,
    read_usergroup_by_id,
    read_usergroups_by_org_id,
    remove_resources_from_usergroup,
    remove_users_from_usergroup,
    update_usergroup_by_id,
)


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
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


class TestUsergroupsService:
    @pytest.mark.asyncio
    async def test_usergroup_crud_and_listing(
        self, mock_request, db, org, admin_user
    ):
        with patch(
            "src.services.users.usergroups.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.usergroups.check_limits_with_usage"
        ), patch(
            "src.services.users.usergroups.increase_feature_usage"
        ), patch(
            "src.services.users.usergroups.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            created = await create_usergroup(
                mock_request,
                db,
                admin_user,
                UserGroupCreate(name="UG", description="Desc", org_id=org.id),
            )
            fetched = await read_usergroup_by_id(
                mock_request, db, admin_user, created.id
            )
            listed = await read_usergroups_by_org_id(
                mock_request, db, admin_user, org.id
            )
            updated = await update_usergroup_by_id(
                mock_request,
                db,
                admin_user,
                created.id,
                UserGroupUpdate(name="Updated"),
            )
            deleted = await delete_usergroup_by_id(
                mock_request, db, admin_user, created.id
            )

        assert created.name == "UG"
        assert fetched.usergroup_uuid == created.usergroup_uuid
        assert len(listed) == 1
        assert updated.name == "Updated"
        assert deleted == "UserGroup deleted successfully"

    @pytest.mark.asyncio
    async def test_usergroup_user_and_resource_links(
        self, mock_request, db, org, admin_user, regular_user
    ):
        with patch(
            "src.services.users.usergroups.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.usergroups.check_limits_with_usage"
        ), patch(
            "src.services.users.usergroups.increase_feature_usage"
        ), patch(
            "src.services.users.usergroups.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            usergroup = await create_usergroup(
                mock_request,
                db,
                admin_user,
                UserGroupCreate(name="UG", description="Desc", org_id=org.id),
            )
            add_users = await add_users_to_usergroup(
                mock_request, db, admin_user, usergroup.id, f"{admin_user.id},{regular_user.id}"
            )

        board = _make_board(db, org, admin_user)
        with patch(
            "src.services.users.usergroups.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.usergroups.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            add_resources = await add_resources_to_usergroup(
                mock_request, db, admin_user, usergroup.id, board.board_uuid
            )
            users = await get_users_linked_to_usergroup(
                mock_request, db, admin_user, usergroup.id
            )
            resources = await get_resources_by_usergroup(
                mock_request, db, admin_user, usergroup.id
            )
            groups_for_resource = await get_usergroups_by_resource(
                mock_request, db, admin_user, board.board_uuid
            )
            remove_users = await remove_users_from_usergroup(
                mock_request, db, admin_user, usergroup.id, str(regular_user.id)
            )
            remove_resources = await remove_resources_from_usergroup(
                mock_request, db, admin_user, usergroup.id, board.board_uuid
            )

        assert add_users == "Users added to UserGroup successfully"
        assert add_resources == "Resources added to UserGroup successfully"
        assert {user.id for user in users} == {admin_user.id, regular_user.id}
        assert resources == [board.board_uuid]
        assert groups_for_resource[0].id == usergroup.id
        assert remove_users == "Users removed from UserGroup successfully"
        assert remove_resources == "Resources removed from UserGroup successfully"

    @pytest.mark.asyncio
    async def test_validate_resource_exists_and_belongs_to_org_and_errors(
        self, mock_request, db, org, other_org, admin_user
    ):
        board = _make_board(db, org, admin_user, board_uuid="board_org")
        _make_board(
            db,
            other_org,
            admin_user,
            id=2,
            board_uuid="board_other",
        )

        assert (
            await _validate_resource_exists_and_belongs_to_org(board.board_uuid, org.id, db)
            is True
        )

        with pytest.raises(HTTPException) as forbidden_exc:
            await _validate_resource_exists_and_belongs_to_org("board_other", org.id, db)
        assert forbidden_exc.value.status_code == 403

        with pytest.raises(HTTPException) as unknown_exc:
            await _validate_resource_exists_and_belongs_to_org("unknown_x", org.id, db)
        assert unknown_exc.value.status_code == 400

        with patch(
            "src.services.users.usergroups.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as missing_group_exc:
                await read_usergroup_by_id(mock_request, db, admin_user, 999)
        assert missing_group_exc.value.status_code == 404
