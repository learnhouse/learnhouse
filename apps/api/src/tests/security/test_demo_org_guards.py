"""Core guardrails around a demo organization.

The demo itself (seeding, refresh, the /demo routes) ships with EE, but the
guards that stop a shared, everyone-is-admin org from being abused live in
core and key off ``Organization.is_demo``. These tests pin them without EE.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.constants import ADMIN_ROLE_ID


def _always(value):
    """An async stand-in that ignores its arguments and returns `value`."""

    async def _stub(*args, **kwargs):
        return value

    return _stub


@pytest.fixture
async def demo_org(db):
    org = Organization(
        # Explicit id: the shared `org` fixture pins id=1.
        id=99,
        name="Demo Academy",
        slug="demo",
        email="demo@example.com",
        org_uuid="org_demo",
        is_demo=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org)
    await db.commit()
    return org


async def _join_as_admin(db, org_id: int, user_id: int) -> None:
    """Make the user an admin of the org, the way every demo visitor is."""
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=ADMIN_ROLE_ID,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


async def test_invites_are_blocked_in_a_demo_org(db, demo_org, admin_user):
    from src.services.orgs.invites import create_invite_code

    with pytest.raises(HTTPException) as exc:
        await create_invite_code(
            request=None,  # type: ignore[arg-type]
            org_id=demo_org.id,
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403
    # RBAC also answers 403 here; pin the guard's own message.
    assert "demo" in str(exc.value.detail).lower()


async def test_batch_invites_are_blocked_in_a_demo_org(db, demo_org, admin_user):
    from src.services.orgs.users import invite_batch_users

    await _join_as_admin(db, demo_org.id, admin_user.id)

    with pytest.raises(HTTPException) as exc:
        await invite_batch_users(
            request=None,  # type: ignore[arg-type]
            org_id=demo_org.id,
            emails="victim@example.com",
            invite_code_uuid=None,
            db_session=db,
            current_user=admin_user,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_custom_scripts_cannot_be_set_on_a_demo_org(db, demo_org, admin_user, monkeypatch):
    from src.db.organizations import OrganizationUpdate
    from src.services.orgs.orgs import update_org

    # Get past RBAC so the 403 below is the guard's, not "not an admin".
    monkeypatch.setattr("src.services.orgs.orgs.rbac_check", _always(True))

    payload = OrganizationUpdate(
        scripts={"scripts": [{"name": "pwn", "content": "alert(document.cookie)"}]}
    )
    with pytest.raises(HTTPException) as exc:
        await update_org(
            request=None,  # type: ignore[arg-type]
            org_object=payload,
            org_id=demo_org.id,
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403
    assert "scripts" in str(exc.value.detail).lower()


async def test_deleting_a_demo_org_is_blocked(db, demo_org, admin_user):
    from src.services.orgs.orgs import delete_org

    with pytest.raises(HTTPException) as exc:
        await delete_org(
            request=None,  # type: ignore[arg-type]
            org_id=demo_org.id,
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_resetting_a_members_two_factor_is_blocked_in_a_demo_org(
    db, demo_org, admin_user, monkeypatch
):
    from src.routers.mfa import api_org_reset_member_mfa

    await _join_as_admin(db, demo_org.id, admin_user.id)
    monkeypatch.setattr("src.security.org_auth.is_org_admin", _always(True))
    monkeypatch.setattr("src.routers.mfa._require_human_user", _always(admin_user))

    with pytest.raises(HTTPException) as exc:
        await api_org_reset_member_mfa(
            org_id=demo_org.id,
            user_id=4242,
            db_session=db,
            current_user=admin_user,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_two_factor_compliance_list_hides_other_visitors(
    db, demo_org, admin_user, monkeypatch
):
    from src.routers.mfa import api_org_mfa_compliance_list

    await _join_as_admin(db, demo_org.id, admin_user.id)
    stranger = User(
        id=888,
        username="stranger",
        first_name="Stran",
        last_name="Ger",
        email="stranger@example.com",
        password="hashed",
        user_uuid="user_stranger_mfa",
        signup_method="email",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(stranger)
    await db.flush()
    await _join_as_admin(db, demo_org.id, stranger.id)

    monkeypatch.setattr("src.security.org_auth.is_org_admin", _always(True))
    monkeypatch.setattr("src.routers.mfa._require_human_user", _always(admin_user))

    result = await api_org_mfa_compliance_list(
        org_id=demo_org.id, db_session=db, current_user=admin_user
    )
    emails = {member["email"] for member in result["members"]}
    assert "stranger@example.com" not in emails
    assert admin_user.email in emails, "you can always see yourself"


async def test_api_tokens_cannot_be_minted_in_a_demo_org(db, demo_org, admin_user):
    from src.db.api_tokens import APITokenCreate
    from src.services.api_tokens.api_tokens import create_api_token

    await _join_as_admin(db, demo_org.id, admin_user.id)

    with pytest.raises(HTTPException) as exc:
        await create_api_token(
            request=None,  # type: ignore[arg-type]
            org_id=demo_org.id,
            token_data=APITokenCreate(name="mine"),
            current_user=admin_user,
            db_session=db,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_webhooks_cannot_be_registered_in_a_demo_org(db, demo_org, admin_user):
    from src.db.webhooks import WebhookEndpointCreate
    from src.services.webhooks.webhooks import create_webhook_endpoint

    await _join_as_admin(db, demo_org.id, admin_user.id)

    with pytest.raises(HTTPException) as exc:
        await create_webhook_endpoint(
            request=None,  # type: ignore[arg-type]
            db_session=db,
            org_id=demo_org.id,
            webhook_object=WebhookEndpointCreate(
                url="https://attacker.example.com/hook",
                events=["user.signed_up"],
                description="mine",
            ),
            current_user=admin_user,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()
