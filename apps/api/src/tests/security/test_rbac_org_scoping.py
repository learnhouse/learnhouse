"""Roles only count in the organization they are held in.

The seeded roles are global (org_id NULL), so a role must be taken from the
membership in the target org, not from any membership. Covers resources in an
org, user accounts (scoped to orgs the two users share) and creation from a
placeholder uuid ("course_x"), which has no org of its own.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.boards import BoardCreate
from src.db.folders.folders import FolderCreate
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User, UserUpdate
from src.security.rbac.rbac import authorization_verify_based_on_roles
from src.services.boards.boards import create_board
from src.services.folders.folders import create_folder
from src.services.users.users import update_user
from src.tests.conftest import ADMIN_RIGHTS

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def global_admin_role(db):
    role = Role(
        id=10,
        name="Global Admin",
        org_id=None,
        role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_admin_test",
        rights=ADMIN_RIGHTS.model_dump(),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(role)
    await db.commit()
    return role


async def _member(db, user_id, org_id, role_id):
    now = str(datetime.now())
    db.add(UserOrganization(
        user_id=user_id, org_id=org_id, role_id=role_id,
        creation_date=now, update_date=now,
    ))
    await db.commit()


async def _user(db, uid, username):
    now = str(datetime.now())
    u = User(
        id=uid, username=username, first_name="F", last_name="L",
        email=f"{username}@test.com", password="x", user_uuid=f"user_{username}",
        creation_date=now, update_date=now,
    )
    db.add(u)
    await db.commit()
    return PublicUser(
        id=u.id, username=u.username, first_name=u.first_name,
        last_name=u.last_name, email=u.email, user_uuid=u.user_uuid,
    )


@pytest.fixture
async def outsider_admin(db, org, other_org, user_role, global_admin_role):
    """Admin of their own org (other_org), plain learner in org."""
    u = await _user(db, 20, "outsider")
    await _member(db, u.id, other_org.id, global_admin_role.id)
    await _member(db, u.id, org.id, user_role.id)
    return u


class TestUserTarget:
    async def test_global_admin_elsewhere_cannot_edit_a_shared_member(
        self, db, org, user_role, outsider_admin, mock_request
    ):
        victim = await _user(db, 21, "victim")
        await _member(db, victim.id, org.id, user_role.id)

        assert await authorization_verify_based_on_roles(
            mock_request, outsider_admin.id, "update", victim.user_uuid, db
        ) is False

        with pytest.raises(HTTPException) as exc:
            await update_user(
                mock_request, db, victim.id, outsider_admin,
                UserUpdate(
                    username="victim", first_name="F", last_name="L",
                    email="attacker@test.com",
                ),
            )
        assert exc.value.status_code in (401, 403)

    async def test_admin_of_the_shared_org_still_can(
        self, db, org, user_role, admin_user, mock_request
    ):
        member = await _user(db, 22, "member")
        await _member(db, member.id, org.id, user_role.id)

        assert await authorization_verify_based_on_roles(
            mock_request, admin_user.id, "update", member.user_uuid, db
        ) is True


class TestPlaceholderCreate:
    async def test_admin_elsewhere_cannot_create_in_org_they_only_learn_in(
        self, db, org, outsider_admin, mock_request
    ):
        with pytest.raises(HTTPException) as exc:
            await create_board(
                mock_request, org.id, BoardCreate(name="b", description=""), outsider_admin, db
            )
        assert exc.value.status_code == 403

        with pytest.raises(HTTPException) as exc:
            await create_folder(
                mock_request, FolderCreate(name="f", org_id=org.id), outsider_admin, db
            )
        assert exc.value.status_code == 403

    async def test_admin_elsewhere_can_create_in_their_own_org(
        self, db, other_org, outsider_admin, mock_request
    ):
        board = await create_board(
            mock_request, other_org.id, BoardCreate(name="b", description=""), outsider_admin, db
        )
        assert board.org_id == other_org.id

    async def test_org_admin_can_create(self, db, org, admin_user, mock_request):
        folder = await create_folder(
            mock_request, FolderCreate(name="f", org_id=org.id), admin_user, db
        )
        assert folder.org_id == org.id


class TestOrgResource:
    async def test_admin_elsewhere_has_learner_rights_on_org_resources(
        self, db, org, outsider_admin, course, mock_request
    ):
        assert await authorization_verify_based_on_roles(
            mock_request, outsider_admin.id, "update", course.course_uuid, db
        ) is False

    async def test_org_admin_keeps_rights(self, db, org, admin_user, course, mock_request):
        assert await authorization_verify_based_on_roles(
            mock_request, admin_user.id, "update", course.course_uuid, db
        ) is True


class TestRouteOrgFallback:
    async def test_placeholder_create_uses_the_org_the_route_names(
        self, db, org, other_org, outsider_admin
    ):
        from starlette.requests import Request

        from src.security.rbac import AccessAction, check_resource_access

        def route(org_id):
            return Request({
                "type": "http", "method": "POST", "path": "/", "headers": [],
                "query_string": b"", "path_params": {"org_id": str(org_id)},
            })

        allowed = await check_resource_access(
            route(other_org.id), db, outsider_admin, "course_x", AccessAction.CREATE,
            raise_on_deny=False,
        )
        denied = await check_resource_access(
            route(org.id), db, outsider_admin, "course_x", AccessAction.CREATE,
            raise_on_deny=False,
        )
        assert allowed.allowed is True
        assert denied.allowed is False
