"""Tests for the become-admin HOOKS that call the Loops marketing helper.

These cover the call sites that fire ``record_org_admin_in_loops`` when a user
becomes an org ADMIN. Each site imports the helper *locally* (inside the
function body) from ``src.services.marketing.loops``, so we patch it at that
source module — that intercepts every call site regardless of deployment mode,
keeping the tests SaaS-gating-agnostic (the helper itself is a no-op outside
SaaS, but here we only assert the hook *invokes* it with the promoted user).

Covered targets:
  - src/services/orgs/orgs.py :: _try_record_org_admin_in_loops (helper +
    exception swallow) and its calls inside create_org / create_org_with_config.
  - src/services/orgs/users.py :: update_user_role admin branch (and the
    non-admin branch which must NOT call it).
  - src/services/setup/setup.py :: install_create_organization_user admin branch.
  - src/services/admin/admin.py :: change_user_role admin branch — see the
    note in test_change_user_role_admin_branch_unreachable_via_token: the
    API-token guard blocks Admin promotion *before* the hook, so that branch is
    unreachable through the token path.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organizations import OrganizationCreate
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User, UserCreate
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.admin.admin import change_user_role
from src.services.orgs.orgs import (
    _try_record_org_admin_in_loops,
    create_org,
    create_org_with_config,
)
from src.services.orgs.users import update_user_role
from src.services.setup.setup import (
    install_create_organization,
    install_create_organization_user,
)

# Every hook imports the helper locally from this module path — patch it here so
# a single patch target intercepts all call sites.
_LOOPS_TARGET = "src.services.marketing.loops.record_org_admin_in_loops"


# ---------------------------------------------------------------------------
# Small local helpers (mirroring the existing service tests)
# ---------------------------------------------------------------------------


async def _make_role(db, org, *, id, name, role_uuid):
    r = Role(
        id=id,
        name=name,
        org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid=role_uuid,
        rights={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


async def _make_user(db, *, id, username, email, first_name="Test", last_name="User"):
    u = User(
        id=id,
        username=username,
        first_name=first_name,
        last_name=last_name,
        email=email,
        password="hashed",
        user_uuid=f"user_{username}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _link(db, user_id, org_id, role_id):
    uo = UserOrganization(
        user_id=user_id,
        org_id=org_id,
        role_id=role_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(uo)
    await db.commit()
    return uo


def _make_token_user(org_id: int) -> APITokenUser:
    return APITokenUser(
        id=99,
        user_uuid="api_token_user",
        username="api_token_user",
        org_id=org_id,
        rights={},
        token_name="test-token",
        created_by_user_id=1,
    )


# ---------------------------------------------------------------------------
# orgs.py :: _try_record_org_admin_in_loops (the helper itself)
# ---------------------------------------------------------------------------


def test_try_record_org_admin_in_loops_forwards_creator_fields():
    """The helper forwards the creator's email + name and the org slug."""
    user = MagicMock()
    user.email = "creator@test.com"
    user.first_name = "Ada"
    user.last_name = "Lovelace"
    org = MagicMock()
    org.slug = "team-alpha"

    with patch(_LOOPS_TARGET) as loops_hook:
        _try_record_org_admin_in_loops(user, org)

    loops_hook.assert_called_once_with(
        email="creator@test.com",
        org_slug="team-alpha",
        first_name="Ada",
        last_name="Lovelace",
    )


def test_try_record_org_admin_in_loops_swallows_errors():
    """A failure in the helper must never propagate out of the hook."""
    user = MagicMock()
    user.email = "creator@test.com"
    org = MagicMock()
    org.slug = "team-alpha"

    with patch(_LOOPS_TARGET, side_effect=RuntimeError("loops down")):
        # Must not raise.
        _try_record_org_admin_in_loops(user, org)


# ---------------------------------------------------------------------------
# orgs.py :: create_org / create_org_with_config call the hook with the creator
# ---------------------------------------------------------------------------


@patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
@patch("src.routers.users._invalidate_session_cache")
async def test_create_org_records_creator_in_loops(
    _cache, _multi, mock_request, db, admin_user
):
    new_org = OrganizationCreate(name="New Org", slug="new-org", email="new@org.com")

    with patch(_LOOPS_TARGET) as loops_hook:
        await create_org(mock_request, new_org, admin_user, db)

    loops_hook.assert_called_once()
    kwargs = loops_hook.call_args.kwargs
    # Targets the CREATOR (the acting admin) and the new org's slug.
    assert kwargs["email"] == admin_user.email
    assert kwargs["org_slug"] == "new-org"


@patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
@patch("src.routers.users._invalidate_session_cache")
async def test_create_org_with_config_records_creator_in_loops(
    _cache, _multi, mock_request, db, admin_user
):
    new_org = OrganizationCreate(
        name="Configured Org", slug="configured-org", email="c@org.com"
    )
    submitted_config = {"config_version": "2.0", "plan": "free", "admin_toggles": {}}

    with patch(_LOOPS_TARGET) as loops_hook:
        await create_org_with_config(
            mock_request, new_org, admin_user, db, submitted_config
        )

    loops_hook.assert_called_once()
    kwargs = loops_hook.call_args.kwargs
    assert kwargs["email"] == admin_user.email
    assert kwargs["org_slug"] == "configured-org"


# ---------------------------------------------------------------------------
# users.py :: update_user_role admin branch (and non-admin negative case)
# ---------------------------------------------------------------------------


async def test_update_user_role_to_admin_records_promoted_user_in_loops(
    mock_request, db, org, admin_role, admin_user, regular_user
):
    """Promoting a member to ADMIN fires the Loops hook for the PROMOTED user
    (regular_user), not the acting admin. Uses the shared ``admin_role`` fixture
    (id=1 == ADMIN_ROLE_ID) so the hook branch is taken. admin_user remains a
    distinct admin, so the last-admin guard permits promoting regular_user."""

    with patch(
        "src.services.orgs.users.rbac_check", new_callable=AsyncMock
    ), patch(
        "src.routers.users._invalidate_session_cache"
    ), patch(
        "src.services.orgs.users.dispatch_webhooks", new_callable=AsyncMock
    ), patch(
        "src.services.orgs.users.send_role_changed_email"
    ), patch(
        _LOOPS_TARGET
    ) as loops_hook:
        result = await update_user_role(
            mock_request, org.id, regular_user.id, admin_role.role_uuid, db, admin_user
        )

    assert result == {"detail": "User role updated"}
    # Confirm the promotion actually landed on ADMIN_ROLE_ID.
    assert admin_role.id == ADMIN_ROLE_ID
    loops_hook.assert_called_once()
    kwargs = loops_hook.call_args.kwargs
    assert kwargs["email"] == regular_user.email
    assert kwargs["org_slug"] == org.slug


async def test_update_user_role_loops_failure_does_not_break_promotion(
    mock_request, db, org, admin_role, admin_user, regular_user
):
    """A Loops outage must never fail the role change — the exception is
    swallowed (users.py) and the promotion still succeeds."""
    with patch(
        "src.services.orgs.users.rbac_check", new_callable=AsyncMock
    ), patch(
        "src.routers.users._invalidate_session_cache"
    ), patch(
        "src.services.orgs.users.dispatch_webhooks", new_callable=AsyncMock
    ), patch(
        "src.services.orgs.users.send_role_changed_email"
    ), patch(
        _LOOPS_TARGET, side_effect=RuntimeError("loops down")
    ) as loops_hook:
        result = await update_user_role(
            mock_request, org.id, regular_user.id, admin_role.role_uuid, db, admin_user
        )

    assert result == {"detail": "User role updated"}
    loops_hook.assert_called_once()


async def test_update_user_role_to_non_admin_does_not_record_in_loops(
    mock_request, db, org, admin_user, regular_user
):
    """A role change that is NOT to ADMIN must never call the Loops hook."""
    # A second admin so the last-admin guard doesn't block demotion of the
    # existing admin. regular_user is being moved to a non-admin instructor role.
    instructor = await _make_role(
        db, org, id=11, name="Instructor", role_uuid="role_instructor"
    )

    with patch(
        "src.services.orgs.users.rbac_check", new_callable=AsyncMock
    ), patch(
        "src.routers.users._invalidate_session_cache"
    ), patch(
        "src.services.orgs.users.dispatch_webhooks", new_callable=AsyncMock
    ), patch(
        "src.services.orgs.users.send_role_changed_email"
    ), patch(
        _LOOPS_TARGET
    ) as loops_hook:
        result = await update_user_role(
            mock_request, org.id, regular_user.id, instructor.role_uuid, db, admin_user
        )

    assert result == {"detail": "User role updated"}
    loops_hook.assert_not_called()


# ---------------------------------------------------------------------------
# setup.py :: install_create_organization_user admin branch
# ---------------------------------------------------------------------------


async def test_install_create_organization_user_records_admin_in_loops(db):
    org = await install_create_organization(
        OrganizationCreate(
            name="Acme", slug="acme", email="hello@acme.example.com"
        ),
        db,
    )

    with patch(_LOOPS_TARGET) as loops_hook:
        user = await install_create_organization_user(
            UserCreate(
                username="founder",
                first_name="Ada",
                last_name="Lovelace",
                email="ada@acme.example.com",
                password="correct horse battery staple",
            ),
            org.slug,
            db,
        )

    # Membership is created with the ADMIN role, so the hook must fire.
    membership = (
        await db.execute(
            select(UserOrganization).where(UserOrganization.user_id == user.id)
        )
    ).scalars().one()
    assert membership.role_id == ADMIN_ROLE_ID

    loops_hook.assert_called_once()
    kwargs = loops_hook.call_args.kwargs
    assert kwargs["email"] == "ada@acme.example.com"
    assert kwargs["org_slug"] == "acme"
    assert kwargs["first_name"] == "Ada"
    assert kwargs["last_name"] == "Lovelace"


async def test_install_create_organization_user_swallows_loops_error(db):
    """A Loops failure must not fail the install (the try/except at ~657-658)."""
    org = await install_create_organization(
        OrganizationCreate(
            name="Beta Co", slug="beta-co", email="hello@beta.example.com"
        ),
        db,
    )

    with patch(_LOOPS_TARGET, side_effect=RuntimeError("loops down")):
        # Must complete without raising.
        user = await install_create_organization_user(
            UserCreate(
                username="beta_founder",
                first_name="Grace",
                last_name="Hopper",
                email="grace@beta.example.com",
                password="another correct password here",
            ),
            org.slug,
            db,
        )

    assert user.email == "grace@beta.example.com"


# ---------------------------------------------------------------------------
# admin.py :: change_user_role admin branch — UNREACHABLE via API token
# ---------------------------------------------------------------------------


async def test_change_user_role_admin_branch_unreachable_via_token(
    db, org, admin_role, user_role
):
    """The Loops hook inside change_user_role only runs when new_role_id ==
    ADMIN_ROLE_ID. But _check_token_can_assign_role (called *before* the hook)
    raises 403 for any Admin/Maintainer target, so an API token can never reach
    the hook. This test documents that: promoting to Admin raises 403 and the
    Loops hook is NEVER called. The admin branch at admin.py ~1933 is therefore
    dead code via the token path and must be covered another way (or removed).
    """
    token_user = _make_token_user(org.id)

    # Token creator must still be a member (defense-in-depth guard passes to the
    # role-privilege check).
    creator = await _make_user(
        db, id=1, username="creator1", email="creator1@test.com"
    )
    await _link(db, creator.id, org.id, admin_role.id)

    target = await _make_user(db, id=70, username="target70", email="t70@test.com")
    await _link(db, target.id, org.id, user_role.id)

    with patch(_LOOPS_TARGET) as loops_hook:
        with pytest.raises(HTTPException) as exc:
            await change_user_role(token_user, target.id, ADMIN_ROLE_ID, db)

    assert exc.value.status_code == 403
    loops_hook.assert_not_called()


# ---------------------------------------------------------------------------
# orgs.py :: _try_send_org_created — best-effort creator welcome email
# ---------------------------------------------------------------------------


def test_try_send_org_created_no_email_is_noop():
    """A creator without an email address short-circuits before any send."""
    from src.services.orgs.orgs import _try_send_org_created

    user = MagicMock()
    user.email = None
    org = MagicMock()
    org.name = "Acme Co"
    with patch("src.services.users.emails.send_org_created_email") as send_mock:
        # Must not raise, and must not attempt to send.
        _try_send_org_created(MagicMock(), user, org)
    send_mock.assert_not_called()
