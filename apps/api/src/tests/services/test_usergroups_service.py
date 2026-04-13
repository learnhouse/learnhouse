"""Tests for src/services/users/usergroups.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.boards import Board
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import APITokenUser, InternalUser
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
    rbac_check,
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
    async def test_rbac_check_branches(self, mock_request, db, org, admin_user):
        with patch(
            "src.services.users.usergroups.authorization_verify_based_on_roles_and_authorship_or_api_token",
            new_callable=AsyncMock,
        ) as api_token_auth, patch(
            "src.services.users.usergroups.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as anon_auth, patch(
            "src.services.users.usergroups.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ) as role_auth, patch(
            "src.services.users.usergroups.require_org_role_permission"
        ) as require_perm:
            assert (
                await rbac_check(
                    mock_request,
                    "usergroup_x",
                    InternalUser(),
                    "read",
                    db,
                )
                is True
            )

            token_user = APITokenUser(
                org_id=org.id,
                rights={},
                token_name="token",
                created_by_user_id=admin_user.id,
            )
            await rbac_check(
                mock_request,
                "usergroup_x",
                token_user,
                "update",
                db,
            )
            api_token_auth.assert_awaited_once()

            await rbac_check(
                mock_request,
                "usergroup_x",
                admin_user,
                "delete",
                db,
                org_id=org.id,
            )
            anon_auth.assert_awaited_once_with(admin_user.id)
            require_perm.assert_called_once_with(
                admin_user.id,
                org.id,
                db,
                "usergroups",
                "action_delete",
            )

            await rbac_check(
                mock_request,
                "usergroup_x",
                admin_user,
                "read",
                db,
            )
            role_auth.assert_awaited_once_with(
                mock_request,
                admin_user.id,
                "read",
                "usergroup_x",
                db,
            )

    @pytest.mark.asyncio
    async def test_validate_resource_helper_cover_all_resource_types_and_errors(
        self, db, org
    ):
        def _db_with_resource(resource):
            session = SimpleNamespace()
            session.exec = MagicMock()
            session.exec.return_value.first.return_value = resource
            return session

        with patch(
            "src.services.users.usergroups.get_resource_config",
            return_value=SimpleNamespace(resource_type="courses"),
        ):
            assert await _validate_resource_exists_and_belongs_to_org(
                "course_x",
                org.id,
                _db_with_resource(SimpleNamespace(org_id=org.id)),
            )

        for resource_type, resource_uuid in (
            ("podcasts", "podcast_x"),
            ("communities", "community_x"),
            ("collections", "collection_x"),
            ("boards", "board_x"),
        ):
            with patch(
                "src.services.users.usergroups.get_resource_config",
                return_value=SimpleNamespace(resource_type=resource_type),
            ):
                assert await _validate_resource_exists_and_belongs_to_org(
                    resource_uuid,
                    org.id,
                    _db_with_resource(SimpleNamespace(org_id=org.id)),
                )

        with patch(
            "src.services.users.usergroups.get_resource_config",
            return_value=SimpleNamespace(resource_type="unsupported"),
        ):
            with pytest.raises(HTTPException) as unsupported_exc:
                await _validate_resource_exists_and_belongs_to_org(
                    "resource_x",
                    org.id,
                    _db_with_resource(SimpleNamespace(org_id=org.id)),
                )
            assert unsupported_exc.value.status_code == 400

        with patch(
            "src.services.users.usergroups.get_resource_config",
            return_value=SimpleNamespace(resource_type="boards"),
        ):
            with pytest.raises(HTTPException) as missing_exc:
                await _validate_resource_exists_and_belongs_to_org(
                    "resource_missing",
                    org.id,
                    _db_with_resource(None),
                )
            assert missing_exc.value.status_code == 404

        with patch(
            "src.services.users.usergroups.get_resource_config",
            return_value=SimpleNamespace(resource_type="boards"),
        ):
            with pytest.raises(HTTPException) as no_org_exc:
                await _validate_resource_exists_and_belongs_to_org(
                    "resource_no_org",
                    org.id,
                    _db_with_resource(SimpleNamespace()),
                )
            assert no_org_exc.value.status_code == 500

        with patch(
            "src.services.users.usergroups.get_resource_config",
            return_value=SimpleNamespace(resource_type="boards"),
        ):
            with pytest.raises(HTTPException) as forbidden_exc:
                await _validate_resource_exists_and_belongs_to_org(
                    "resource_other_org",
                    org.id,
                    _db_with_resource(SimpleNamespace(org_id=org.id + 1)),
                )
            assert forbidden_exc.value.status_code == 403

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
            updated_description = await update_usergroup_by_id(
                mock_request,
                db,
                admin_user,
                created.id,
                UserGroupUpdate(description="Updated Desc"),
            )
            deleted = await delete_usergroup_by_id(
                mock_request, db, admin_user, created.id
            )

        assert created.name == "UG"
        assert fetched.usergroup_uuid == created.usergroup_uuid
        assert len(listed) == 1
        assert updated.name == "Updated"
        assert updated_description.description == "Updated Desc"
        assert deleted == "UserGroup deleted successfully"

    @pytest.mark.asyncio
    async def test_usergroup_missing_and_empty_branches(
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
            _ = await create_usergroup(
                mock_request,
                db,
                admin_user,
                UserGroupCreate(name="UG", description="Desc", org_id=org.id),
            )

        with patch(
            "src.services.users.usergroups.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as missing_org_exc:
                await create_usergroup(
                    mock_request,
                    db,
                    admin_user,
                    UserGroupCreate(name="UG2", description="Desc", org_id=999999),
                )
        assert missing_org_exc.value.status_code == 400

        with patch(
            "src.services.users.usergroups.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as missing_group_exc:
                await get_users_linked_to_usergroup(
                    mock_request, db, admin_user, 999999
                )
            with pytest.raises(HTTPException) as missing_group_resources_exc:
                await get_resources_by_usergroup(
                    mock_request, db, admin_user, 999999
                )
            with pytest.raises(HTTPException) as missing_group_update_exc:
                await update_usergroup_by_id(
                    mock_request,
                    db,
                    admin_user,
                    999999,
                    UserGroupUpdate(name="Updated"),
                )
            with pytest.raises(HTTPException) as missing_group_delete_exc:
                await delete_usergroup_by_id(
                    mock_request, db, admin_user, 999999
                )
            with pytest.raises(HTTPException) as missing_group_add_users_exc:
                await add_users_to_usergroup(
                    mock_request, db, admin_user, 999999, "1"
                )
            with pytest.raises(HTTPException) as missing_group_remove_users_exc:
                await remove_users_from_usergroup(
                    mock_request, db, admin_user, 999999, "1"
                )
            with pytest.raises(HTTPException) as missing_group_add_resources_exc:
                await add_resources_to_usergroup(
                    mock_request, db, admin_user, 999999, "board_x"
                )
            with pytest.raises(HTTPException) as missing_group_remove_resources_exc:
                await remove_resources_from_usergroup(
                    mock_request, db, admin_user, 999999, "board_x"
                )
            assert missing_group_exc.value.status_code == 404
            assert missing_group_resources_exc.value.status_code == 404
            assert missing_group_update_exc.value.status_code == 404
            assert missing_group_delete_exc.value.status_code == 404
            assert missing_group_add_users_exc.value.status_code == 404
            assert missing_group_remove_users_exc.value.status_code == 404
            assert missing_group_add_resources_exc.value.status_code == 404
            assert missing_group_remove_resources_exc.value.status_code == 404

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
            empty_groups = await get_usergroups_by_resource(
                mock_request, db, admin_user, "board_not_linked"
            )

        assert empty_groups == []

    @pytest.mark.asyncio
    async def test_usergroup_branch_coverage_for_duplicate_and_missing_links(
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

        board = _make_board(db, org, admin_user, board_uuid="board_primary")
        board_other = _make_board(db, org, admin_user, board_uuid="board_other")

        existing_link = UserGroupResource(
            usergroup_id=usergroup.id,
            resource_uuid=board.board_uuid,
            org_id=org.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(existing_link)
        db.commit()

        existing_user_link = UserGroupUser(
            usergroup_id=usergroup.id,
            user_id=regular_user.id,
            org_id=org.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(existing_user_link)
        db.commit()

        with patch(
            "src.services.users.usergroups.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.usergroups.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.usergroups.logging.error"
        ) as log_error:
            add_users_result = await add_users_to_usergroup(
                mock_request,
                db,
                admin_user,
                usergroup.id,
                f"{regular_user.id},999999",
            )
            add_resources_result = await add_resources_to_usergroup(
                mock_request,
                db,
                admin_user,
                usergroup.id,
                f"{board.board_uuid},{board_other.board_uuid}",
            )
            remove_users_result = await remove_users_from_usergroup(
                mock_request,
                db,
                admin_user,
                usergroup.id,
                f"{regular_user.id},999999",
            )
            remove_resources_result = await remove_resources_from_usergroup(
                mock_request,
                db,
                admin_user,
                usergroup.id,
                f"{board.board_uuid},board_missing",
            )

        assert add_users_result == "Users added to UserGroup successfully"
        assert add_resources_result == "Resources added to UserGroup successfully"
        assert remove_users_result == "Users removed from UserGroup successfully"
        assert remove_resources_result == "Resources removed from UserGroup successfully"
        assert log_error.call_count >= 4

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
