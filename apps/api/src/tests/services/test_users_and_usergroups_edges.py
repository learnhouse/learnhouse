"""Edge branches of src/services/users/users.py and usergroups.py.

users.py:
  * the welcome email's CTA URL falls back to None (the email still goes out)
    when the org URL cannot be resolved,
  * anonymous callers can never look another user up,
  * a failing goodbye email does not undo or fail an account deletion.
usergroups.py:
  * a superadmin (who passes the membership gates for any org) still gets a
    400 when creating a usergroup in an org that does not exist,
  * internal callers and org API tokens may always manage usergroups,
  * a membership row whose user no longer exists is skipped, not linked.
"""

import logging
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup, UserGroupCreate
from src.db.users import AnonymousUser, APITokenUser, InternalUser, User
from src.services.users.usergroups import (
    _can_manage_usergroups,
    add_users_to_usergroup,
    create_usergroup,
)
from src.services.users.users import (
    _can_see_user,
    _get_welcome_cta_url,
    delete_user_by_id,
)


class TestWelcomeCtaUrl:
    async def test_unresolvable_org_url_falls_back_to_none(self, mock_request, db, org, caplog):
        with patch(
            "src.services.email.utils.get_org_signup_base_url",
            AsyncMock(side_effect=RuntimeError("bad custom domain row")),
        ), caplog.at_level(logging.WARNING):
            assert await _get_welcome_cta_url(mock_request, db, org.id) is None

        assert "Could not resolve welcome email CTA URL" in caplog.text


class TestCanSeeUser:
    async def test_anonymous_caller_sees_nobody(self, db, regular_user):
        assert await _can_see_user(AnonymousUser(), regular_user, db) is False


class TestDeleteAccountGoodbyeEmail:
    async def test_email_failure_does_not_fail_the_deletion(
        self, mock_request, db, regular_user, caplog
    ):
        with patch(
            "src.services.users.users.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ), patch(
            "src.services.users.emails.send_account_deleted_email",
            side_effect=RuntimeError("smtp down"),
        ) as send, caplog.at_level(logging.ERROR):
            result = await delete_user_by_id(mock_request, db, regular_user, regular_user.id)

        assert result == {"detail": "User deleted successfully"}
        send.assert_called_once_with(regular_user.email, regular_user.username)
        assert "send_account_deleted_email failed" in caplog.text
        gone = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        assert gone is None


class TestCreateUsergroupMissingOrg:
    async def test_superadmin_gets_400_for_an_org_that_does_not_exist(self, mock_request, db):
        superadmin = User(
            id=601,
            username="root",
            first_name="Root",
            last_name="Admin",
            email="root@test.com",
            password="hashed",
            user_uuid="user_root601",
            is_superadmin=True,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(superadmin)
        await db.commit()

        with patch("src.services.users.usergroups.rbac_check", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc_info:
                await create_usergroup(
                    mock_request,
                    db,
                    superadmin,
                    UserGroupCreate(name="UG", description="d", org_id=424242),
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "Organization does not exist"
        assert (await db.execute(select(UserGroup))).scalars().all() == []


class TestCanManageUsergroups:
    async def test_internal_and_api_token_callers_are_trusted(self, db, org):
        # No membership lookup happens for these: the internal caller is the
        # server itself, and an API token was already org-bound upstream.
        assert await _can_manage_usergroups(InternalUser(id=0), org.id, db) is True
        assert await _can_manage_usergroups(APITokenUser(org_id=org.id), org.id, db) is True


class TestAddUsersOrphanMembership:
    async def test_membership_without_user_row_is_skipped(
        self, mock_request, db, org, admin_user, caplog
    ):
        usergroup = UserGroup(
            name="UG",
            description="d",
            org_id=org.id,
            usergroup_uuid="usergroup_orphan",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        # A membership row left behind for an account that no longer exists.
        db.add(usergroup)
        db.add(
            UserOrganization(
                user_id=7777,
                org_id=org.id,
                role_id=4,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()
        await db.refresh(usergroup)

        with patch(
            "src.services.users.usergroups.rbac_check", new_callable=AsyncMock
        ), caplog.at_level(logging.ERROR):
            await add_users_to_usergroup(mock_request, db, admin_user, usergroup.id, "7777")

        assert "User with id 7777 not found" in caplog.text
        links = (
            await db.execute(select(UserGroupUser).where(UserGroupUser.usergroup_id == usergroup.id))
        ).scalars().all()
        assert links == []
