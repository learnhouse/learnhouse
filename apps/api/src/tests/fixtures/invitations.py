"""Shared fixtures and helpers for the invitation tests (registered in
src/tests/conftest.py): an org with built-in and custom roles, a maintainer,
groups and courses on both sides of an org boundary, and quiet side effects."""

from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.org_invitations import OrgInvitation
from src.db.organization_config import OrganizationConfig
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.usergroups import UserGroup
from src.db.users import PublicUser, User
from src.services.orgs.invitations import codes, service
from src.tests.conftest import ADMIN_RIGHTS, USER_RIGHTS

NOW = str(datetime.now())
# The real sender, before the autouse fixture swaps it for a mock.
_REAL_SEND = service._send_email


def _rights(base, **changes) -> dict:
    rights = base.model_dump()
    for bucket, perms in changes.items():
        rights[bucket] = {**rights[bucket], **perms}
    return rights


async def _role(db, id, name, rights, org_id=None, uuid=None):
    role = Role(
        id=id, name=name, org_id=org_id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION if org_id else RoleTypeEnum.TYPE_GLOBAL,
        role_uuid=uuid or f"role_{name.lower().replace(' ', '_')}",
        rights=rights, creation_date=NOW, update_date=NOW,
    )
    db.add(role)
    await db.commit()
    return role


async def _user(db, id, email, org=None, role_id=None, verified=True):
    user = User(
        id=id, username=email.split("@")[0], first_name="", last_name="", email=email,
        password="x", user_uuid=f"user_{id}", email_verified=verified,
        creation_date=NOW, update_date=NOW,
    )
    db.add(user)
    if org is not None:
        db.add(UserOrganization(user_id=id, org_id=org.id, role_id=role_id, creation_date=NOW, update_date=NOW))
    await db.commit()
    return user


def _public(user: User) -> PublicUser:
    return PublicUser(
        id=user.id, username=user.username, first_name="", last_name="",
        email=user.email, user_uuid=user.user_uuid,
    )


@pytest.fixture
async def world(db, org, other_org, admin_user, regular_user, admin_role, user_role, course):
    """Roles (built-in and custom, this org's and another's), a maintainer,
    groups and courses on both sides, and a config row."""
    maintainer_rights = _rights(ADMIN_RIGHTS, organizations={"action_update": False, "action_delete": False}, roles={"action_create": False})
    instructor_rights = _rights(USER_RIGHTS, dashboard={"action_access": True}, courses={"action_create": True})
    maintainer_role = await _role(db, 2, "Maintainer", maintainer_rights, uuid="role_global_maintainer")
    instructor = await _role(db, 3, "Instructor", instructor_rights, uuid="role_global_instructor")
    reviewer = await _role(db, 8, "Reviewer", _rights(USER_RIGHTS, usergroups={"action_create": True}), org_id=org.id)
    learner = await _role(db, 9, "Learner Plus", USER_RIGHTS.model_dump(), org_id=org.id)
    foreign = await _role(db, 10, "Foreign", USER_RIGHTS.model_dump(), org_id=other_org.id)
    maintainer = await _user(db, 3, "maint@test.com", org, maintainer_role.id)
    db.add_all([
        UserGroup(id=1, org_id=org.id, name="Cohort A", description="", usergroup_uuid="usergroup_a", creation_date=NOW, update_date=NOW),
        UserGroup(id=2, org_id=other_org.id, name="Elsewhere", description="", usergroup_uuid="usergroup_x", creation_date=NOW, update_date=NOW),
        OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "free"}),
    ])
    from src.db.courses.courses import Course

    db.add(Course(
        id=2, name="Foreign course", description="", public=True, published=True, open_to_contributors=False,
        org_id=other_org.id, course_uuid="course_foreign", creation_date=NOW, update_date=NOW,
    ))
    await db.commit()
    return SimpleNamespace(
        org=org, other_org=other_org, admin=admin_user, regular=regular_user, maintainer=_public(maintainer),
        admin_role=admin_role, user_role=user_role, maintainer_role=maintainer_role, instructor=instructor,
        reviewer=reviewer, learner=learner, foreign=foreign, course=course,
    )


@pytest.fixture
def quiet():
    """Mail, rate limits, webhooks, Redis and the session cache faked."""
    send = AsyncMock(return_value=True)
    with patch("src.services.orgs.invitations.service._send_email", send), patch(
        "src.services.security.rate_limiting.enforce_invite_rate_limit"
    ) as rate, patch("src.services.webhooks.dispatch.dispatch_webhooks", new_callable=AsyncMock) as hooks, patch(
        "src.core.redis.get_redis_client", return_value=None
    ), patch("src.routers.users._invalidate_session_cache"), patch(
        "src.services.orgs.join_notifications.notify_user_joined_org", new_callable=AsyncMock
    ) as joined, patch("src.services.users.usergroups.dispatch_webhooks", new_callable=AsyncMock), patch(
        "src.services.orgs.users.dispatch_webhooks", new_callable=AsyncMock
    ):
        yield SimpleNamespace(send=send, rate=rate, hooks=hooks, joined=joined)


@contextmanager
def saas():
    """Plan limits on: SaaS mode for usage, resolution and plan limits."""
    with patch("src.security.features_utils.usage._is_non_saas", return_value=False), patch(
        "src.security.features_utils.resolve.get_deployment_mode", return_value="saas"
    ), patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"):
        yield


def _body(emails, **kw):
    return service.InvitationCreate(emails=emails, **kw)


async def _invite(world, mock_request, db, emails="new@test.com", user=None, **kw):
    return await service.create_invitations(mock_request, db, world.org.id, _body(emails, **kw), user or world.admin)


async def _row(db, email) -> OrgInvitation:
    return (await db.execute(select(OrgInvitation).where(OrgInvitation.email == email).order_by(OrgInvitation.id.desc()))).scalars().first()


async def _membership(db, user_id, org_id) -> UserOrganization:
    return (await db.execute(
        select(UserOrganization).where(UserOrganization.user_id == user_id, UserOrganization.org_id == org_id)
    )).scalars().first()


async def _code(world, mock_request, db, user=None, **kw):
    with patch("src.services.analytics.analytics.track", new_callable=AsyncMock):
        return await codes.create_code(mock_request, db, world.org.id, codes.InviteCodeCreate(**kw), user or world.admin)
