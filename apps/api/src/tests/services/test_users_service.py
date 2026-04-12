"""Tests for src/services/users/users.py — read and delete user functions."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.user_organizations import UserOrganization
from src.db.users import User, UserReadPublic
from src.services.users.users import (
    delete_user_by_id,
    read_user_by_id,
    read_user_by_username,
    read_user_by_uuid,
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
