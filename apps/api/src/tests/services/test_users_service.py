"""Tests for src/services/users/users.py."""

import json

from datetime import datetime
from io import BytesIO
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select

from src.db.roles import RoleRead
from src.db.user_organizations import UserOrganization
from src.db.users import (
    AnonymousUser,
    InternalUser,
    PublicUser,
    User,
    UserCreate,
    UserReadPublic,
    UserUpdate,
    UserUpdatePassword,
)
from src.security.security import security_hash_password
from src.services.users.users import (
    authorize_user_action,
    create_user,
    create_user_without_org,
    create_user_with_invite,
    delete_user_by_id,
    get_user_session,
    read_user_by_id,
    read_user_by_username,
    read_user_by_uuid,
    security_get_user,
    update_user,
    update_user_avatar,
    update_user_password,
    rbac_check,
)


def _user_create(
    username: str,
    email: str,
    *,
    password: str = "Password123!",
    first_name: str = "New",
    last_name: str = "User",
):
    return UserCreate(
        username=username,
        first_name=first_name,
        last_name=last_name,
        email=email,
        password=password,
    )


# ---------------------------------------------------------------------------
# read_user_by_id
# ---------------------------------------------------------------------------


class TestReadUserById:
    @pytest.mark.asyncio
    async def test_read_user_by_id_found(self, mock_request, db, admin_user):
        result = await read_user_by_id(mock_request, db, admin_user, 1)

        assert isinstance(result, UserReadPublic)
        assert result.id == 1
        assert result.username == "admin"
        assert result.user_uuid == "user_admin"

    @pytest.mark.asyncio
    async def test_read_user_by_id_not_found(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await read_user_by_id(mock_request, db, admin_user, 999)

        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# read_user_by_uuid
# ---------------------------------------------------------------------------


class TestReadUserByUuid:
    @pytest.mark.asyncio
    async def test_read_user_by_uuid_found(self, mock_request, db, admin_user):
        result = await read_user_by_uuid(mock_request, db, admin_user, "user_admin")

        assert isinstance(result, UserReadPublic)
        assert result.user_uuid == "user_admin"
        assert result.username == "admin"

    @pytest.mark.asyncio
    async def test_read_user_by_uuid_not_found(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await read_user_by_uuid(mock_request, db, admin_user, "user_nonexistent")

        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# read_user_by_username
# ---------------------------------------------------------------------------


class TestReadUserByUsername:
    @pytest.mark.asyncio
    async def test_read_user_by_username_found(self, mock_request, db, admin_user):
        result = await read_user_by_username(mock_request, db, admin_user, "admin")

        assert isinstance(result, UserReadPublic)
        assert result.username == "admin"
        assert result.id == 1

    @pytest.mark.asyncio
    async def test_read_user_by_username_not_found(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await read_user_by_username(mock_request, db, admin_user, "nonexistent")

        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# delete_user_by_id
# ---------------------------------------------------------------------------


class TestDeleteUserById:
    @pytest.mark.asyncio
    @patch(
        "src.services.users.users.authorization_verify_if_user_is_anon",
        new_callable=AsyncMock,
    )
    @patch(
        "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
        new_callable=AsyncMock,
    )
    async def test_delete_user_by_id(
        self, mock_rbac_roles, mock_rbac_anon, mock_request, db, admin_user, org
    ):
        # Create a separate user to delete (id=10)
        user_to_delete = User(
            id=10,
            username="deleteme",
            first_name="Delete",
            last_name="Me",
            email="deleteme@test.com",
            password="hashed",
            user_uuid="user_deleteme",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user_to_delete)
        db.commit()

        uo = UserOrganization(
            user_id=10,
            org_id=org.id,
            role_id=1,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(uo)
        db.commit()

        result = await delete_user_by_id(mock_request, db, admin_user, 10)
        assert result == {"detail": "User deleted successfully"}

        # Verify the user no longer exists
        assert db.exec(select(User).where(User.id == 10)).first() is None

        # Verify the UserOrganization link is also gone
        assert (
            db.exec(
                select(UserOrganization).where(UserOrganization.user_id == 10)
            ).first()
            is None
        )


class TestCreateAndUpdateUser:
    @pytest.mark.asyncio
    async def test_create_user_and_update_flows(
        self, mock_request, db, admin_user, org
    ):
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch(
            "src.services.users.users.check_limits_with_usage"
        ), patch(
            "src.services.users.users.increase_feature_usage"
        ), patch(
            "src.services.users.users.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.send_account_creation_email"
        ), patch(
            "src.services.users.users.get_deployment_mode",
            return_value="oss",
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="newuser",
                    first_name="New",
                    last_name="User",
                    email="newuser@test.com",
                    password="Password123!",
                ),
                org.id,
            )

            updated = await update_user(
                mock_request,
                db,
                created.id,
                admin_user,
                UserUpdate(
                    username="updateduser",
                    first_name="Updated",
                    last_name="User",
                    email="updateduser@test.com",
                    avatar_image="",
                    bio="bio",
                    details={},
                    profile={},
                ),
            )

        assert created.email_verified is True
        assert updated.username == "updateduser"

    @pytest.mark.asyncio
    async def test_create_user_branch_modes_and_duplicate_guards(
        self, mock_request, db, admin_user, org
    ):
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch("src.services.users.users.check_limits_with_usage"), patch(
            "src.services.users.users.increase_feature_usage"
        ), patch(
            "src.services.users.users.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
        ) as mock_verification_email, patch(
            "src.services.users.users.send_account_creation_email"
        ) as mock_account_email, patch(
            "src.services.users.users.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            created = await create_user(
                mock_request,
                db,
                admin_user,
                _user_create("saas-user", "saas-user@test.com"),
                org.id,
            )

            oauth_created = await create_user(
                mock_request,
                db,
                admin_user,
                _user_create("oauth-user", "oauth-user@test.com"),
                org.id,
                is_oauth=True,
                signup_provider="google",
            )

            with pytest.raises(HTTPException) as username_exc:
                await create_user(
                    mock_request,
                    db,
                    admin_user,
                    _user_create("saas-user", "duplicate-user@test.com"),
                    org.id,
                )

            with pytest.raises(HTTPException) as email_exc:
                await create_user(
                    mock_request,
                    db,
                    admin_user,
                    _user_create("duplicate-email", "saas-user@test.com"),
                    org.id,
                )

        assert created.email_verified is False
        assert created.signup_method == "email"
        assert oauth_created.email_verified is True
        assert oauth_created.signup_method == "google"
        assert mock_verification_email.await_count == 1
        mock_account_email.assert_called_once()
        assert username_exc.value.status_code == 400
        assert email_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_create_user_missing_org(self, mock_request, db, admin_user):
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch("src.services.users.users.check_limits_with_usage"), patch(
            "src.services.users.users.increase_feature_usage"
        ), patch(
            "src.services.users.users.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_user(
                    mock_request,
                    db,
                    admin_user,
                    _user_create("missing-org", "missing-org@test.com"),
                    999,
                )

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_create_user_without_org_and_duplicate_guards(
        self, mock_request, db, admin_user
    ):
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch(
            "src.services.users.users.send_account_creation_email"
        ), patch(
            "src.services.users.users.get_deployment_mode",
            return_value="oss",
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            created = await create_user_without_org(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="solo",
                    first_name="Solo",
                    last_name="User",
                    email="solo@test.com",
                    password="Password123!",
                ),
            )

            with pytest.raises(HTTPException) as dup_exc:
                await create_user_without_org(
                    mock_request,
                    db,
                    admin_user,
                    UserCreate(
                        username="solo",
                        first_name="Solo",
                        last_name="User",
                        email="solo2@test.com",
                        password="Password123!",
                    ),
                )

        assert created.username == "solo"
        assert dup_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_create_user_rejects_missing_org_and_weak_password(
        self, mock_request, db, admin_user
    ):
        weak_validation = Mock(
            is_valid=False,
            errors=["too short"],
            requirements=["length"],
        )
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=weak_validation,
        ):
            with pytest.raises(HTTPException) as weak_exc:
                await create_user(
                    mock_request,
                    db,
                    admin_user,
                    UserCreate(
                        username="weak",
                        first_name="Weak",
                        last_name="User",
                        email="weak@test.com",
                        password="weak",
                    ),
                    999,
                )

        assert weak_exc.value.status_code == 400


class TestUserPasswordAvatarSession:
    @pytest.mark.asyncio
    async def test_update_password_avatar_and_session(
        self, mock_request, db, admin_user, org
    ):
        user = db.get(User, admin_user.id)
        user.password = security_hash_password("old-password")
        db.add(user)
        db.commit()
        upload = UploadFile(filename="avatar.png", file=BytesIO(b"avatar"))

        with patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.upload_avatar",
            new_callable=AsyncMock,
            return_value="avatar.png",
        ):
            avatar_updated = await update_user_avatar(
                mock_request, db, admin_user, upload
            )

        updated_password = await update_user_password(
            mock_request,
            db,
            admin_user,
            admin_user.id,
            UserUpdatePassword(
                old_password="old-password",
                new_password="NewPassword123!",
            ),
        )
        session = await get_user_session(mock_request, db, admin_user)

        assert avatar_updated.avatar_image == "avatar.png"
        assert updated_password.id == admin_user.id
        assert len(session.roles) == 1
        assert isinstance(session.roles[0].role, RoleRead)

    @pytest.mark.asyncio
    async def test_update_password_guards(self, mock_request, db, admin_user, regular_user):
        weak_validation = Mock(
            is_valid=False,
            errors=["too short"],
            requirements=["length"],
        )
        with pytest.raises(HTTPException) as own_exc:
            await update_user_password(
                mock_request,
                db,
                admin_user,
                regular_user.id,
                UserUpdatePassword(old_password="x", new_password="NewPassword123!"),
            )
        assert own_exc.value.status_code == 403

        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=weak_validation,
        ):
            with pytest.raises(HTTPException) as weak_exc:
                await update_user_password(
                    mock_request,
                    db,
                    admin_user,
                    admin_user.id,
                    UserUpdatePassword(old_password="hashed_password", new_password="weak"),
                )
        assert weak_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_update_user_avatar_failure_and_wrong_password(
        self, mock_request, db, admin_user
    ):
        user = db.get(User, admin_user.id)
        user.password = security_hash_password("old-password")
        db.add(user)
        db.commit()
        with patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.upload_avatar",
            new_callable=AsyncMock,
            side_effect=Exception("boom"),
        ):
            with pytest.raises(HTTPException) as avatar_exc:
                await update_user_avatar(
                    mock_request,
                    db,
                    admin_user,
                    UploadFile(filename="avatar.png", file=BytesIO(b"avatar")),
                )
        assert avatar_exc.value.status_code == 400

        with pytest.raises(HTTPException) as password_exc:
            await update_user_password(
                mock_request,
                db,
                admin_user,
                admin_user.id,
                UserUpdatePassword(old_password="wrong", new_password="NewPassword123!"),
            )
        assert password_exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_create_user_without_org_branch_modes_and_duplicate_email(
        self, mock_request, db, admin_user
    ):
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
        ) as mock_verification_email, patch(
            "src.services.users.users.send_account_creation_email"
        ) as mock_account_email, patch(
            "src.services.users.users.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            created = await create_user_without_org(
                mock_request,
                db,
                admin_user,
                _user_create("platform-user", "platform-user@test.com"),
            )

            oauth_created = await create_user_without_org(
                mock_request,
                db,
                admin_user,
                _user_create("platform-oauth", "platform-oauth@test.com"),
                is_oauth=True,
                signup_provider="google",
            )

            with pytest.raises(HTTPException) as dup_email_exc:
                await create_user_without_org(
                    mock_request,
                    db,
                    admin_user,
                    _user_create("platform-email-dup", "platform-user@test.com"),
                )

        assert created.email_verified is False
        assert oauth_created.email_verified is True
        assert mock_verification_email.await_count == 1
        mock_account_email.assert_called_once()
        assert dup_email_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_create_user_without_org_weak_password_and_email_failure(
        self, mock_request, db, admin_user
    ):
        weak_validation = Mock(
            is_valid=False,
            errors=["too short"],
            requirements=["length"],
        )

        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=weak_validation,
        ):
            with pytest.raises(HTTPException) as weak_exc:
                await create_user_without_org(
                    mock_request,
                    db,
                    admin_user,
                    _user_create(
                        "weak-platform",
                        "weak-platform@test.com",
                        password="weak",
                    ),
                )
        assert weak_exc.value.status_code == 400

        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            side_effect=Exception("boom"),
        ), patch(
            "src.services.users.users.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            created = await create_user_without_org(
                mock_request,
                db,
                admin_user,
                _user_create("weak-platform-ok", "weak-platform-ok@test.com"),
            )

        assert created.email_verified is False

    @pytest.mark.asyncio
    async def test_create_user_with_invite_success_and_redis_update(
        self, mock_request, db, admin_user, org
    ):
        fake_redis = Mock()
        fake_redis.get.return_value = json.dumps({"pending": True})
        fake_redis.ttl.return_value = 90

        with patch(
            "src.services.users.users.get_invite_code",
            new_callable=AsyncMock,
            return_value={"usergroup_id": 12},
        ), patch(
            "src.services.users.users.create_user",
            new_callable=AsyncMock,
            return_value=Mock(id=77, email="invite@test.com"),
        ), patch(
            "src.services.users.users.check_limits_with_usage"
        ), patch(
            "src.services.users.users.increase_feature_usage"
        ), patch(
            "src.services.users.users.add_users_to_usergroup",
            new_callable=AsyncMock,
        ) as mock_add_users_to_usergroup, patch(
            "src.services.users.users.get_learnhouse_config",
            return_value=Mock(redis_config=Mock(redis_connection_string="redis://test")),
        ), patch(
            "src.services.users.users.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            result = await create_user_with_invite(
                mock_request,
                db,
                admin_user,
                _user_create("invite-user", "invite@test.com"),
                org.id,
                "INVITE123",
            )

        assert result.id == 77
        mock_add_users_to_usergroup.assert_awaited_once()
        args = mock_add_users_to_usergroup.await_args.args
        assert isinstance(args[2], InternalUser)
        assert args[3] == 12
        assert args[4] == "77"
        fake_redis.set.assert_called_once()
        assert fake_redis.set.call_args.kwargs["ex"] == 90
        assert json.loads(fake_redis.set.call_args.args[1])["pending"] is False

    @pytest.mark.asyncio
    async def test_create_user_with_invite_missing_code_and_redis_failure(
        self, mock_request, db, admin_user, org
    ):
        with patch(
            "src.services.users.users.get_invite_code",
            new_callable=AsyncMock,
            return_value=None,
        ):
            with pytest.raises(HTTPException) as missing_code_exc:
                await create_user_with_invite(
                    mock_request,
                    db,
                    admin_user,
                    _user_create("invite-missing", "invite-missing@test.com"),
                    org.id,
                    "BADCODE",
                )

        assert missing_code_exc.value.status_code == 400

        with patch(
            "src.services.users.users.get_invite_code",
            new_callable=AsyncMock,
            return_value={"usergroup_id": None},
        ), patch(
            "src.services.users.users.create_user",
            new_callable=AsyncMock,
            return_value=Mock(id=78, email="invite-redis@test.com"),
        ), patch(
            "src.services.users.users.check_limits_with_usage"
        ), patch(
            "src.services.users.users.increase_feature_usage"
        ), patch(
            "src.services.users.users.get_learnhouse_config",
            return_value=Mock(redis_config=Mock(redis_connection_string="redis://test")),
        ), patch(
            "src.services.users.users.redis.Redis.from_url",
            side_effect=Exception("boom"),
        ), patch(
            "src.services.users.users.logging.getLogger"
        ) as mock_get_logger:
            mock_logger = Mock()
            mock_get_logger.return_value = mock_logger

            result = await create_user_with_invite(
                mock_request,
                db,
                admin_user,
                _user_create("invite-redis", "invite-redis@test.com"),
                org.id,
                "CODE2",
            )

        assert result.id == 78
        mock_logger.warning.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_user_and_related_missing_and_duplicate_paths(
        self, mock_request, db, admin_user, regular_user
    ):
        with patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as missing_user_exc:
                await update_user(
                    mock_request,
                    db,
                    999,
                    admin_user,
                    UserUpdate(
                        username="missing",
                        first_name="Missing",
                        last_name="User",
                        email="missing@test.com",
                        avatar_image="",
                        bio="",
                        details={},
                        profile={},
                    ),
                )

            with pytest.raises(HTTPException) as email_dup_exc:
                await update_user(
                    mock_request,
                    db,
                    regular_user.id,
                    regular_user,
                    UserUpdate(
                        username="regular-unique",
                        first_name="Regular",
                        last_name="User",
                        email=admin_user.email,
                        avatar_image="",
                        bio="",
                        details={},
                        profile={},
                    ),
                )

            with pytest.raises(HTTPException) as username_dup_exc:
                await update_user(
                    mock_request,
                    db,
                    regular_user.id,
                    regular_user,
                    UserUpdate(
                        username="admin",
                        first_name="Regular",
                        last_name="User",
                        email="regular-unique@test.com",
                        avatar_image="",
                        bio="",
                        details={},
                        profile={},
                    ),
                )

        assert missing_user_exc.value.status_code == 400
        assert email_dup_exc.value.status_code == 400
        assert username_dup_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_update_user_avatar_and_password_missing_users(
        self, mock_request, db, admin_user
    ):
        ghost_user = PublicUser(
            id=999,
            username="ghost",
            first_name="Ghost",
            last_name="User",
            email="ghost@test.com",
            user_uuid="user_ghost",
        )

        with pytest.raises(HTTPException) as avatar_exc:
            await update_user_avatar(mock_request, db, ghost_user, None)
        assert avatar_exc.value.status_code == 400

        user_row = db.get(User, admin_user.id)
        db.delete(user_row)
        db.commit()

        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ):
            with pytest.raises(HTTPException) as password_exc:
                await update_user_password(
                    mock_request,
                    db,
                    admin_user,
                    admin_user.id,
                    UserUpdatePassword(
                        old_password="old-password",
                        new_password="NewPassword123!",
                    ),
                )

        assert password_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_get_session_authorize_and_delete_missing_user(
        self, mock_request, db, admin_user
    ):
        user_row = db.get(User, admin_user.id)
        db.delete(user_row)
        db.commit()

        with pytest.raises(HTTPException) as session_exc:
            await get_user_session(mock_request, db, admin_user)
        assert session_exc.value.status_code == 400

        with pytest.raises(HTTPException) as auth_exc:
            await authorize_user_action(
                mock_request,
                db,
                admin_user,
                "resource_x",
                "read",
            )
        assert auth_exc.value.status_code == 400

        with pytest.raises(HTTPException) as delete_exc:
            await delete_user_by_id(mock_request, db, admin_user, admin_user.id)
        assert delete_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_rbac_check_anonymous_and_self_and_other_paths(
        self, mock_request, db, admin_user, regular_user
    ):
        anonymous = AnonymousUser()

        assert await rbac_check(mock_request, anonymous, "create", "user_x", db)
        assert await rbac_check(mock_request, anonymous, "read", "user_x", db)

        with patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_auth_verify, patch(
            "src.services.users.users.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as mock_anon_verify:
            assert await rbac_check(
                mock_request,
                admin_user,
                "update",
                admin_user.user_uuid,
                db,
            )
            mock_anon_verify.assert_awaited_once_with(admin_user.id)
            mock_auth_verify.assert_not_awaited()

            await rbac_check(
                mock_request,
                admin_user,
                "delete",
                regular_user.user_uuid,
                db,
            )

        mock_auth_verify.assert_awaited_once_with(
            mock_request,
            admin_user.id,
            "delete",
            regular_user.user_uuid,
            db,
        )


class TestSecurityHelpers:
    @pytest.mark.asyncio
    async def test_authorize_user_action_and_security_get_user(
        self, mock_request, db, admin_user
    ):
        with patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
            return_value=True,
        ):
            assert await authorize_user_action(
                mock_request, db, admin_user, "resource_x", "read"
            ) is True

        fetched = await security_get_user(mock_request, db, admin_user.email)
        missing = await security_get_user(mock_request, db, "missing@test.com")

        assert fetched is not None
        assert fetched.email == admin_user.email
        assert missing is None

    @pytest.mark.asyncio
    async def test_authorize_user_action_denied_and_duplicate_update(
        self, mock_request, db, admin_user, regular_user
    ):
        with patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as auth_exc:
                await authorize_user_action(
                    mock_request, db, admin_user, "resource_x", "delete"
                )
        assert auth_exc.value.status_code == 403

        with patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as update_exc:
                await update_user(
                    mock_request,
                    db,
                    regular_user.id,
                    admin_user,
                    UserUpdate(
                        username="admin",
                        first_name="Regular",
                        last_name="User",
                        email=regular_user.email,
                        avatar_image="",
                        bio="",
                        details={},
                        profile={},
                    ),
                )
        assert update_exc.value.status_code == 400
