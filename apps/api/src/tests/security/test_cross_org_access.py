"""Cross-org and reader-visibility regressions.

The common thread: a user who is admin of *their own* org and a plain member
of another org. Global default roles (Admin, User...) carry no org of their
own, so role lookups that weren't pinned to the target org's membership row
made that user admin everywhere they belonged.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.courses import AuthorWithRole, Course
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User, UserRead
from src.security.org_auth import require_org_create_permission
from src.security.rbac.rbac import authorization_verify_based_on_roles


async def _add_user(db, id, org_id, role_id, uuid):
    db.add(User(
        id=id, username=uuid, first_name="", last_name="", email=f"{uuid}@test.com",
        password="x", user_uuid=uuid,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    db.add(UserOrganization(
        user_id=id, org_id=org_id, role_id=role_id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    return PublicUser(
        id=id, username=uuid, first_name="", last_name="",
        email=f"{uuid}@test.com", user_uuid=uuid,
    )


@pytest.fixture
async def own_org_admin(db, org, other_org, admin_role, user_role):
    """Admin of other_org, plain member (User role) of org."""
    db.add(User(
        id=10, username="dual", first_name="", last_name="", email="dual@test.com",
        password="x", user_uuid="user_dual",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    for org_id, role_id in ((other_org.id, admin_role.id), (org.id, user_role.id)):
        db.add(UserOrganization(
            user_id=10, org_id=org_id, role_id=role_id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
    await db.commit()
    return PublicUser(
        id=10, username="dual", first_name="", last_name="",
        email="dual@test.com", user_uuid="user_dual",
    )


async def _course(db, id, org_id, uuid, public=True, published=True):
    c = Course(
        id=id, name=uuid, description="", public=public, published=published,
        open_to_contributors=False, org_id=org_id, course_uuid=uuid,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(c)
    await db.commit()
    return c


class TestAdminRoleStaysInItsOrg:
    async def test_admin_elsewhere_cannot_edit_course_here(self, db, course, own_org_admin, mock_request):
        assert not await authorization_verify_based_on_roles(
            mock_request, own_org_admin.id, "update", course.course_uuid, db
        )
        assert not await authorization_verify_based_on_roles(
            mock_request, own_org_admin.id, "delete", course.course_uuid, db
        )

    async def test_admin_here_still_can(self, db, course, admin_user, mock_request):
        assert await authorization_verify_based_on_roles(
            mock_request, admin_user.id, "update", course.course_uuid, db
        )

    async def test_admin_elsewhere_cannot_act_on_coworker_account(
        self, db, own_org_admin, regular_user, mock_request
    ):
        """Shared org is `org`, where the caller is a plain user."""
        assert not await authorization_verify_based_on_roles(
            mock_request, own_org_admin.id, "update", "user_regular", db
        )


class TestPlaceholderCreatesArePinnedToTheOrg:
    async def test_admin_elsewhere_cannot_create_here(self, db, org, own_org_admin):
        with pytest.raises(HTTPException) as exc:
            await require_org_create_permission(own_org_admin, org.id, db, "courses")
        assert exc.value.status_code == 403

    async def test_admin_can_create_in_own_org(self, db, org, other_org, own_org_admin):
        await require_org_create_permission(own_org_admin, other_org.id, db, "courses")

    async def test_admin_can_create(self, db, org, admin_user):
        await require_org_create_permission(admin_user, org.id, db, "courses")


class TestAuthorsArePublicProfiles:
    def test_author_payload_has_no_email(self):
        user = UserRead(
            id=1, user_uuid="u", username="x", first_name="", last_name="",
            email="secret@test.com", is_superadmin=True, signup_method="email",
        )
        dumped = AuthorWithRole(
            user=user, authorship="CREATOR", authorship_status="ACTIVE",
            creation_date="", update_date="",
        ).model_dump()["user"]
        assert "email" not in dumped
        assert "is_superadmin" not in dumped
        assert "signup_method" not in dumped


class TestOrgWideItemsStayInTheOrg:
    async def test_other_orgs_user_sees_only_public_courses(
        self, db, org, admin_role, other_org, regular_user, mock_request
    ):
        from src.services.courses.courses import get_courses_orgslug

        await _course(db, 1, org.id, "course_public")
        await _course(db, 2, org.id, "course_members", public=False)
        outsider = await _outsider(db, other_org, admin_role)

        with patch("src.services.courses.cache.get_cached_courses_list", return_value=None):
            seen_by_member = {c.course_uuid for c in await get_courses_orgslug(
                mock_request, regular_user, org.slug, db
            )}
            seen_by_outsider = {c.course_uuid for c in await get_courses_orgslug(
                mock_request, outsider, org.slug, db
            )}

        assert seen_by_member == {"course_public", "course_members"}
        assert seen_by_outsider == {"course_public"}


async def _outsider(db, other_org, role):
    db.add(User(
        id=20, username="outsider", first_name="", last_name="", email="o@test.com",
        password="x", user_uuid="user_outsider",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    db.add(UserOrganization(
        user_id=20, org_id=other_org.id, role_id=role.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    return PublicUser(
        id=20, username="outsider", first_name="", last_name="",
        email="o@test.com", user_uuid="user_outsider",
    )


class TestReaderPathsRespectThePaywall:
    async def test_activity_by_id_strips_unpaid_content(
        self, db, course, activity, regular_user, mock_request
    ):
        from src.services.courses.activities.activities import get_activityby_id

        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock, return_value=False,
        ):
            result = await get_activityby_id(mock_request, activity.id, regular_user, db)

        assert result.content == {"paid_access": False}

    async def test_export_needs_edit_rights(self, db, course, regular_user, mock_request):
        from src.services.courses.transfer.export_service import export_courses_batch

        with pytest.raises(HTTPException) as exc:
            await export_courses_batch(mock_request, [course.course_uuid], regular_user, db)
        assert exc.value.status_code == 403


class TestAuditDossier:
    async def test_superadmin_outside_the_org_is_not_disclosed(self, db, org, other_org, admin_role):
        from src.routers.audit import _verify_target_in_org

        db.add(User(
            id=30, username="ops", first_name="", last_name="", email="ops@test.com",
            password="x", user_uuid="user_ops", is_superadmin=True,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await _verify_target_in_org(30, org.id, db, acting_user_id=1)
        assert exc.value.status_code == 404


class TestMediaRespectsThePaywall:
    async def test_stream_refuses_unpaid_reader(self, db, course, activity, regular_user, mock_request):
        from src.routers.stream import _verify_course_activity_access
        from src.security.rbac.resource_access import AccessDecision

        with patch(
            "src.services.courses.activities.access.check_resource_access",
            new_callable=AsyncMock,
            return_value=AccessDecision(allowed=True, reason="ok"),
        ), patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock, return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                await _verify_course_activity_access(
                    mock_request, course.course_uuid, activity.activity_uuid, regular_user, db
                )
        assert exc.value.status_code == 402


class TestAccountsAreNotAnyOrgsToRewrite:
    async def test_admin_of_shared_org_cannot_change_email(self, db, org, admin_user, regular_user, mock_request):
        from src.db.users import UserUpdate
        from src.services.users.users import update_user

        with pytest.raises(HTTPException) as exc:
            await update_user(
                mock_request, db, regular_user.id, admin_user,
                UserUpdate(
                    username=regular_user.username, first_name="R", last_name="U",
                    email="attacker@evil.example",
                ),
            )
        assert exc.value.status_code == 403

    async def test_admin_of_shared_org_cannot_delete_account(self, db, org, admin_user, regular_user, mock_request):
        from src.services.users.users import delete_user_by_id

        with pytest.raises(HTTPException) as exc:
            await delete_user_by_id(mock_request, db, admin_user, regular_user.id)
        assert exc.value.status_code == 403

    async def test_org_owns_account_only_when_it_is_the_only_org(self, db, org, other_org, regular_user, own_org_admin):
        from src.security.org_auth import org_owns_account

        assert await org_owns_account(regular_user.id, org.id, db) is True
        # own_org_admin belongs to both orgs
        assert await org_owns_account(own_org_admin.id, org.id, db) is False

    async def test_maintainer_cannot_delete_the_org(self, db, org, user_role, admin_role, mock_request):
        from src.db.roles import Role, RoleTypeEnum
        from src.services.orgs.orgs import delete_org

        db.add(Role(
            id=2, name="Maintainer", org_id=None, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
            role_uuid="role_maintainer",
            rights={"organizations": {"action_create": False, "action_read": True, "action_update": False, "action_delete": False}},
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()
        maintainer = await _add_user(db, 40, org.id, 2, "user_maint")

        with pytest.raises(HTTPException) as exc:
            await delete_org(mock_request, org.id, maintainer, db)
        assert exc.value.status_code == 403
