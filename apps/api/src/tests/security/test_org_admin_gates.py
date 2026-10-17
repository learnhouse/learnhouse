"""Org-owner actions are Admin-only.

Maintainers pass the org ``rbac_check`` (it accepts admin or maintainer role
ids) but their seeded role has no organization update/delete or role rights.
These tests pin the Admin-only gates on role assignment, org deletion/wipe,
member removal, identity fields, and the member MFA reset.
"""

from contextlib import ExitStack
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.organizations import OrganizationCreate, OrganizationUpdate
from src.db.roles import Role, RoleCreate, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.tests.conftest import ADMIN_RIGHTS, USER_RIGHTS


async def _make_member(db, org, user_id, username, role_id):
    u = User(
        id=user_id,
        username=username,
        first_name=username,
        last_name="User",
        email=f"{username}@test.com",
        password="hashed_password",
        user_uuid=f"user_{username}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org.id,
            role_id=role_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


@pytest.fixture
async def maintainer_role(db):
    rights = USER_RIGHTS.model_dump()
    rights["dashboard"] = {"action_access": True}
    r = Role(
        id=2,
        name="Maintainer",
        org_id=None,
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_maintainer",
        rights=rights,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(r)
    await db.commit()
    return r


@pytest.fixture
async def maintainer_user(db, org, maintainer_role):
    return await _make_member(db, org, 3, "maintainer", maintainer_role.id)


@pytest.fixture
async def second_admin(db, org, admin_role):
    return await _make_member(db, org, 5, "admin2", admin_role.id)


@pytest.fixture
def side_effects():
    """Silence session-cache, usage, webhook and email side effects."""
    with ExitStack() as stack:
        for target in (
            "src.services.orgs.users.dispatch_webhooks",
            "src.services.orgs.users.decrease_feature_usage",
            "src.services.orgs.users.enforce_admin_seat_limit_for_role_change",
        ):
            stack.enter_context(patch(target, new_callable=AsyncMock))
        stack.enter_context(patch("src.routers.users._invalidate_session_cache"))
        stack.enter_context(patch("src.services.orgs.users.send_role_changed_email"))
        yield


async def _role_of(db, org, user_id):
    from src.security.org_auth import get_user_org

    db._user_org_cache = {}
    uo = await get_user_org(user_id, org.id, db)
    await db.refresh(uo)
    return uo.role_id


# ---------------------------------------------------------------------------
# Role assignment
# ---------------------------------------------------------------------------


class TestUpdateUserRole:
    async def test_maintainer_cannot_promote_self(
        self, db, org, admin_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        with pytest.raises(HTTPException) as exc:
            await update_user_role(
                mock_request, org.id, maintainer_user.id, "role_admin", db, maintainer_user
            )
        assert exc.value.status_code == 403
        assert await _role_of(db, org, maintainer_user.id) == 2

    async def test_maintainer_cannot_promote_others(
        self, db, org, admin_user, regular_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        with pytest.raises(HTTPException) as exc:
            await update_user_role(
                mock_request, org.id, regular_user.id, "role_admin", db, maintainer_user
            )
        assert exc.value.status_code == 403
        assert await _role_of(db, org, regular_user.id) == 4

    async def test_admin_can_promote_member(
        self, db, org, admin_user, regular_user, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        await update_user_role(
            mock_request, org.id, regular_user.id, "role_admin", db, admin_user
        )
        assert await _role_of(db, org, regular_user.id) == 1

    async def test_admin_cannot_change_own_role(
        self, db, org, admin_user, second_admin, user_role, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        with pytest.raises(HTTPException) as exc:
            await update_user_role(
                mock_request, org.id, admin_user.id, "role_user", db, admin_user
            )
        assert exc.value.status_code == 403

    async def test_cross_org_role_rejected(
        self, db, org, other_org, admin_user, regular_user, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        foreign = Role(
            id=10,
            name="Foreign",
            org_id=other_org.id,
            role_type=RoleTypeEnum.TYPE_ORGANIZATION,
            role_uuid="role_foreign",
            rights=ADMIN_RIGHTS.model_dump(),
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(foreign)
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await update_user_role(
                mock_request, org.id, regular_user.id, "role_foreign", db, admin_user
            )
        assert exc.value.status_code == 404
        assert await _role_of(db, org, regular_user.id) == 4

    async def test_maintainer_cannot_demote_an_admin(
        self, db, org, admin_user, second_admin, user_role, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        with pytest.raises(HTTPException) as exc:
            await update_user_role(
                mock_request, org.id, second_admin.id, "role_user", db, maintainer_user
            )
        assert exc.value.status_code == 403
        assert await _role_of(db, org, second_admin.id) == 1

    async def test_maintainer_cannot_grant_rights_they_lack(
        self, db, org, admin_user, regular_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        broad = Role(
            id=11,
            name="Broad custom",
            org_id=org.id,
            role_type=RoleTypeEnum.TYPE_ORGANIZATION,
            role_uuid="role_broad",
            rights=ADMIN_RIGHTS.model_dump(),
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(broad)
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await update_user_role(
                mock_request, org.id, regular_user.id, "role_broad", db, maintainer_user
            )
        assert exc.value.status_code == 403
        assert await _role_of(db, org, regular_user.id) == 4

    async def test_maintainer_can_grant_a_narrower_role(
        self, db, org, admin_user, regular_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import update_user_role

        narrow = Role(
            id=12,
            name="Reader",
            org_id=org.id,
            role_type=RoleTypeEnum.TYPE_ORGANIZATION,
            role_uuid="role_reader",
            rights=USER_RIGHTS.model_dump(),
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(narrow)
        await db.commit()

        await update_user_role(
            mock_request, org.id, regular_user.id, "role_reader", db, maintainer_user
        )
        assert await _role_of(db, org, regular_user.id) == 12


# ---------------------------------------------------------------------------
# Delete / wipe / remove
# ---------------------------------------------------------------------------


class TestDestructiveOrgActions:
    async def test_maintainer_cannot_delete_org(
        self, db, org, admin_user, maintainer_user, mock_request
    ):
        from src.services.orgs.orgs import delete_org

        with pytest.raises(HTTPException) as exc:
            await delete_org(mock_request, org.id, maintainer_user, db)
        assert exc.value.status_code == 403

    async def test_admin_can_delete_org(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import delete_org

        with patch("src.routers.users._invalidate_session_cache"), patch(
            "src.services.users.emails.send_org_deleted_email"
        ):
            result = await delete_org(mock_request, org.id, admin_user, db)
        assert result["org_id"] == org.id

    async def test_maintainer_cannot_wipe_org(
        self, db, org, admin_user, maintainer_user, mock_request
    ):
        from src.services.orgs.orgs import wipe_org_content

        with pytest.raises(HTTPException) as exc:
            await wipe_org_content(mock_request, org.id, maintainer_user, db)
        assert exc.value.status_code == 403

    async def test_admin_can_wipe_org(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import wipe_org_content

        result = await wipe_org_content(mock_request, org.id, admin_user, db)
        assert result["deleted_courses"] == 0

    async def test_maintainer_cannot_remove_all_users(
        self, db, org, admin_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_all_users_from_org

        with pytest.raises(HTTPException) as exc:
            await remove_all_users_from_org(mock_request, org.id, db, maintainer_user)
        assert exc.value.status_code == 403

    async def test_maintainer_cannot_remove_admin(
        self, db, org, admin_user, second_admin, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_user_from_org

        with pytest.raises(HTTPException) as exc:
            await remove_user_from_org(mock_request, org.id, admin_user.id, db, maintainer_user)
        assert exc.value.status_code == 403

    async def test_maintainer_cannot_batch_remove_admin(
        self, db, org, admin_user, second_admin, maintainer_user, regular_user,
        mock_request, side_effects,
    ):
        from src.services.orgs.users import remove_batch_users_from_org

        with pytest.raises(HTTPException) as exc:
            await remove_batch_users_from_org(
                mock_request, org.id, [regular_user.id, admin_user.id], db, maintainer_user
            )
        assert exc.value.status_code == 403
        assert await _role_of(db, org, regular_user.id) == 4

    async def test_maintainer_can_remove_member(
        self, db, org, admin_user, regular_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_user_from_org

        result = await remove_user_from_org(
            mock_request, org.id, regular_user.id, db, maintainer_user
        )
        assert result["detail"] == "User removed from org"

    async def test_admin_can_remove_admin(
        self, db, org, admin_user, second_admin, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_user_from_org

        result = await remove_user_from_org(
            mock_request, org.id, second_admin.id, db, admin_user
        )
        assert result["detail"] == "User removed from org"


# ---------------------------------------------------------------------------
# update_org identity fields + URL validation
# ---------------------------------------------------------------------------


class TestUpdateOrgFields:
    @pytest.mark.parametrize(
        "fields",
        [
            {"scripts": {"scripts": [{"content": "alert(1)"}]}},
            {"slug": "taken-over"},
            {"email": "attacker@evil.test"},
        ],
    )
    async def test_maintainer_cannot_change_admin_fields(
        self, db, org, admin_user, maintainer_user, mock_request, fields
    ):
        from src.services.orgs.orgs import update_org

        with pytest.raises(HTTPException) as exc:
            await update_org(mock_request, OrganizationUpdate(**fields), org.id, maintainer_user, db)
        assert exc.value.status_code == 403

    async def test_maintainer_can_edit_other_fields(
        self, db, org, admin_user, maintainer_user, mock_request
    ):
        from src.services.orgs.orgs import update_org

        # Resubmitting the unchanged slug/email is what the settings form does.
        result = await update_org(
            mock_request,
            OrganizationUpdate(name="Renamed", description="d", slug=org.slug, email=org.email),
            org.id,
            maintainer_user,
            db,
        )
        assert result.name == "Renamed"

    async def test_admin_can_change_admin_fields(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import update_org

        result = await update_org(
            mock_request,
            OrganizationUpdate(slug="new-slug", email="new@org.com", scripts={"scripts": []}),
            org.id,
            admin_user,
            db,
        )
        assert result.slug == "new-slug"
        assert result.email == "new@org.com"

    async def test_update_rejects_url_in_name(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import update_org

        with pytest.raises(HTTPException) as exc:
            await update_org(
                mock_request, OrganizationUpdate(name="Claim prize at evil.com/x"), org.id, admin_user, db
            )
        assert exc.value.status_code == 400

    async def test_create_rejects_url_in_name(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import create_org

        with patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True):
            with pytest.raises(HTTPException) as exc:
                await create_org(
                    mock_request,
                    OrganizationCreate(name="https://evil.test", slug="phish", email="p@x.com"),
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 400

    async def test_sender_name_rejects_url(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import update_org_email_sender_name_config

        with pytest.raises(HTTPException) as exc:
            await update_org_email_sender_name_config(
                mock_request, "Support www.evil.test", org.id, admin_user, db
            )
        assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# create_role escalation
# ---------------------------------------------------------------------------


async def test_create_role_cannot_grant_bucket_creator_lacks(db, org, admin_user, mock_request):
    from src.services.roles.roles import create_role

    creator_rights = ADMIN_RIGHTS.model_dump()
    del creator_rights["communities"]
    creator_role = Role(id=7, name="Partial", org_id=org.id, rights=creator_rights)

    with patch("src.services.roles.roles.rbac_check", new_callable=AsyncMock), patch(
        "src.services.roles.roles.require_org_role_permission", new_callable=AsyncMock
    ), patch(
        "src.services.roles.roles.get_user_org_role",
        new_callable=AsyncMock,
        return_value=creator_role,
    ), patch(
        "src.services.roles.roles.is_user_superadmin",
        new_callable=AsyncMock,
        return_value=False,
    ):
        with pytest.raises(HTTPException) as exc:
            await create_role(
                mock_request,
                db,
                RoleCreate(org_id=org.id, name="Escalated", rights=ADMIN_RIGHTS.model_dump()),
                admin_user,
            )
    assert exc.value.status_code == 403
    assert "communities" in exc.value.detail


# ---------------------------------------------------------------------------
# Member MFA reset
# ---------------------------------------------------------------------------


class TestOrgResetMemberMfa:
    async def test_maintainer_cannot_reset(
        self, db, org, admin_user, regular_user, maintainer_user
    ):
        from src.routers.mfa import api_org_reset_member_mfa

        with pytest.raises(HTTPException) as exc:
            await api_org_reset_member_mfa(org.id, regular_user.id, db, maintainer_user)
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "NOT_ORG_ADMIN"

    async def test_admin_cannot_reset_other_admin(self, db, org, admin_user, second_admin):
        from src.routers.mfa import api_org_reset_member_mfa

        with pytest.raises(HTTPException) as exc:
            await api_org_reset_member_mfa(org.id, second_admin.id, db, admin_user)
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "TARGET_IS_ADMIN"

    async def test_admin_can_reset_member(self, db, org, admin_user, regular_user):
        from src.routers.mfa import api_org_reset_member_mfa

        result = await api_org_reset_member_mfa(org.id, regular_user.id, db, admin_user)
        assert result["reset"] is True
