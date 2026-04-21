"""
Regression tests for the F-02 cross-org RBAC fix.

Before the fix, ``authorization_verify_based_on_roles`` loaded every role the
user held in every org they belonged to and returned True the moment any role
granted the action. A user with (e.g.) admin rights in Org A could therefore
mutate resources in Org B simply by supplying the target resource's UUID.

These tests assert that role-based fallback only considers roles that apply
to the *target* resource's organization.
"""

from datetime import datetime
from unittest.mock import Mock

import pytest
from fastapi import Request
from sqlmodel import Session

from src.db.courses.courses import Course
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.rbac import authorization_verify_based_on_roles

from src.tests.conftest import ADMIN_RIGHTS


def _mk_user(db: Session, *, uid: int, username: str, email: str) -> User:
    u = User(
        id=uid,
        username=username,
        first_name="First",
        last_name="Last",
        email=email,
        password="x",
        user_uuid=f"user_{username}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _mk_course(db: Session, *, cid: int, org_id: int, uuid: str, public: bool = False) -> Course:
    c = Course(
        id=cid,
        name=f"Course {cid}",
        description="x",
        public=public,
        published=True,
        open_to_contributors=False,
        org_id=org_id,
        course_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _attach_role(db: Session, *, user_id: int, org_id: int, role_id: int) -> None:
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=role_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    db.commit()


@pytest.fixture
def mock_request():
    return Mock(spec=Request)


class TestCrossOrgRoleFallback:
    """Cross-org isolation for role-based authorization fallback."""

    @pytest.mark.asyncio
    async def test_admin_in_org_a_cannot_update_course_in_org_b(
        self, db, org, other_org, admin_role, mock_request
    ):
        """Alice is admin in org-A. A course in org-B must not be writable by her."""
        alice = _mk_user(db, uid=42, username="alice", email="alice@test.com")
        _attach_role(db, user_id=alice.id, org_id=org.id, role_id=admin_role.id)

        org_b_course = _mk_course(
            db, cid=100, org_id=other_org.id, uuid="course_org_b", public=False
        )

        allowed = await authorization_verify_based_on_roles(
            mock_request, alice.id, "update", org_b_course.course_uuid, db
        )
        assert allowed is False, (
            "admin-in-org-A must not be granted role-based update on a course in org-B"
        )

    @pytest.mark.asyncio
    async def test_admin_can_still_update_own_org_course(
        self, db, org, admin_role, mock_request
    ):
        """The same admin retains her legitimate permissions inside her own org."""
        alice = _mk_user(db, uid=43, username="alice_own", email="alice2@test.com")
        _attach_role(db, user_id=alice.id, org_id=org.id, role_id=admin_role.id)

        own_course = _mk_course(
            db, cid=101, org_id=org.id, uuid="course_own", public=False
        )

        allowed = await authorization_verify_based_on_roles(
            mock_request, alice.id, "update", own_course.course_uuid, db
        )
        assert allowed is True

    @pytest.mark.asyncio
    async def test_user_with_no_membership_gets_denied(
        self, db, org, other_org, admin_role, mock_request
    ):
        """A user with an admin role on org-A but no membership link to org-B."""
        bob = _mk_user(db, uid=44, username="bob", email="bob@test.com")
        _attach_role(db, user_id=bob.id, org_id=org.id, role_id=admin_role.id)

        victim_course = _mk_course(
            db, cid=102, org_id=other_org.id, uuid="course_victim", public=False
        )

        for action in ("read", "update", "delete"):
            allowed = await authorization_verify_based_on_roles(
                mock_request, bob.id, action, victim_course.course_uuid, db
            )
            assert allowed is False, f"cross-org {action} must be denied"

    @pytest.mark.asyncio
    async def test_global_default_role_requires_target_org_membership(
        self, db, org, other_org, mock_request
    ):
        """
        A global-default role (``org_id IS NULL``) may only take effect when
        the user is also a member of the target org. Without the membership
        tether, a globally defined "editor" role could turn every user in the
        platform into a writer on every other tenant.
        """
        # Create a global (org_id=None) role with broad rights.
        global_role = Role(
            id=999,
            name="Global Default",
            org_id=None,
            role_type=RoleTypeEnum.TYPE_GLOBAL,
            role_uuid="role_global",
            rights=ADMIN_RIGHTS.model_dump(),
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(global_role)
        db.commit()

        # Carol holds the global role via membership in org-A only.
        carol = _mk_user(db, uid=45, username="carol", email="carol@test.com")
        _attach_role(db, user_id=carol.id, org_id=org.id, role_id=global_role.id)

        org_b_course = _mk_course(
            db, cid=103, org_id=other_org.id, uuid="course_global_victim", public=False
        )

        allowed = await authorization_verify_based_on_roles(
            mock_request, carol.id, "update", org_b_course.course_uuid, db
        )
        assert allowed is False

    @pytest.mark.asyncio
    async def test_placeholder_create_target_still_works(
        self, db, org, admin_role, mock_request
    ):
        """
        For top-level create placeholders (``course_x``) ``target_org_id`` is
        ``None``; role-based checks must still work so create flows are
        unaffected by the cross-org fix.
        """
        alice = _mk_user(db, uid=46, username="alice_create", email="alice3@test.com")
        _attach_role(db, user_id=alice.id, org_id=org.id, role_id=admin_role.id)

        allowed = await authorization_verify_based_on_roles(
            mock_request, alice.id, "create", "course_x", db
        )
        assert allowed is True
