"""Google sign-in and joining an open org with database invitations and codes.

Whichever way an invited person arrives, the invitation for their (verified)
address is accepted with its role, groups and courses; a person who joins
through an invite code gets the code's settings, existing members don't burn
a use."""

import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, Response
from sqlmodel import select

from src.db.org_invitations import OrgInviteCode
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, User
from src.routers.auth import _apply_oauth_invites, third_party_login
from src.services.orgs.join import JoinOrg, _join_with_invitation, join_org
from src.tests.routers.test_invite_links_router import join_side_effects
from src.tests.fixtures.invitations import _code, _invite, _membership, _row, _user

pytestmark = pytest.mark.usefixtures("quiet")


_CONFIG = SimpleNamespace(
    redis_config=SimpleNamespace(redis_connection_string=""),
    hosting_config=SimpleNamespace(tenancy="single"),
)


async def _signup_mode(db, org, mode):
    config = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().one()
    config.config = {**config.config, "admin_toggles": {"members": {"signup_mode": mode}}}
    db.add(config)
    await db.commit()


def _google(db, user_id, email, org=None):
    """Google says ``email``; signing in makes the account a member (as
    signWithGoogle does for an org_id)."""

    async def sign(request, token, body_email, org_id, current_user, db_session, outcome=None):
        user = await db_session.get(User, user_id)
        joined = False
        if org_id and await _membership(db_session, user_id, org_id) is None:
            db_session.add(UserOrganization(user_id=user_id, org_id=org_id, role_id=4, creation_date="", update_date=""))
            await db_session.commit()
            joined = True
        if outcome is not None:
            outcome["joined"] = joined
        return user

    return (
        patch("src.routers.auth.signWithGoogle", sign),
        patch("src.routers.auth.get_google_user_info", AsyncMock(return_value={"email": email, "email_verified": True})),
        patch("src.routers.auth.set_auth_cookies"),
        patch("src.routers.auth.get_learnhouse_config", return_value=_CONFIG),
        patch("src.routers.auth._bind_session_to_custom_domain", AsyncMock(return_value=(org.id if org else None, False))),
        patch("src.routers.auth.issue_session_or_challenge", AsyncMock(return_value=SimpleNamespace(mfa_required=False, access_token="a", refresh_token="r"))),
        patch("src.routers.auth.UserRead", SimpleNamespace(model_validate=lambda u: u)),
    )


async def _login(db, org, invite_code=None):
    return await third_party_login(
        request=SimpleNamespace(), response=Response(),
        body=SimpleNamespace(email="ignored@x.io", provider="google", access_token="tok"),
        org_id=org.id, invite_code=invite_code, current_user=AnonymousUser(), db_session=db,
    )


async def _with(patches, coro):
    for p in patches:
        p.start()
    try:
        return await coro
    finally:
        for p in reversed(patches):
            p.stop()


async def test_google_into_an_invite_only_org_with_an_invitation(world, mock_request, db):
    await _signup_mode(db, world.org, "inviteOnly")
    await _invite(world, mock_request, db, "lea@test.com", role_id=9, usergroup_ids=[1])
    await _user(db, 60, "lea@test.com")
    with join_side_effects():
        result = await _with(_google(db, 60, "Lea@test.com", world.org), _login(db, world.org))
    assert result["tokens"]["access_token"] == "a"
    assert (await _membership(db, 60, world.org.id)).role_id == 9
    assert (await _row(db, "lea@test.com")).status == "accepted"


async def test_google_into_an_open_org_with_a_code(world, mock_request, db):
    await _signup_mode(db, world.org, "open")
    code = await _code(world, mock_request, db, role_id=9)
    await _user(db, 61, "sam@test.com")
    with join_side_effects():
        await _with(_google(db, 61, "sam@test.com", world.org), _login(db, world.org, invite_code=code["invite_code"]))
    assert (await _membership(db, 61, world.org.id)).role_id == 9
    assert (await db.execute(select(OrgInviteCode))).scalars().one().uses == 1

    # Already a member: signing in with the code link again uses nothing.
    with join_side_effects():
        await _with(_google(db, 61, "sam@test.com", world.org), _login(db, world.org, invite_code=code["invite_code"]))
    assert (await db.execute(select(OrgInviteCode))).scalars().one().uses == 1

    # An unknown code is just ignored on an open org.
    await _user(db, 62, "kim@test.com")
    with join_side_effects():
        await _with(_google(db, 62, "kim@test.com", world.org), _login(db, world.org, invite_code="NOPE1234"))
    assert (await _membership(db, 62, world.org.id)).role_id == 4


async def test_apply_after_google_edges(world, mock_request, db):
    # Not a member (nothing to apply to) and unknown ids return quietly.
    await _user(db, 63, "out@test.com")
    await _apply_oauth_invites(mock_request, db, 63, world.org.id, {"source": "db", "id": 1})
    await _apply_oauth_invites(mock_request, db, 999, world.org.id, None)
    assert await _membership(db, 63, world.org.id) is None


async def test_joining_an_open_org_applies_an_invitation_or_a_code(world, mock_request, db):
    await _signup_mode(db, world.org, "open")
    await _invite(world, mock_request, db, "lea@test.com", role_id=9)
    lea = await _user(db, 70, "lea@test.com")
    with join_side_effects(), patch("src.services.orgs.join.increase_feature_usage", new=AsyncMock()), patch(
        "src.services.orgs.join.notify_user_joined_org", new=AsyncMock()
    ):
        await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=70), _as_public(lea), db)
        assert (await _membership(db, 70, world.org.id)).role_id == 9

        code = await _code(world, mock_request, db, role_id=9)
        sam = await _user(db, 71, "sam@test.com")
        await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=71, invite_code=code["invite_code"]), _as_public(sam), db)
        assert (await _membership(db, 71, world.org.id)).role_id == 9

        kim = await _user(db, 72, "kim@test.com")
        await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=72, invite_code="NOPE1234"), _as_public(kim), db)
        assert (await _membership(db, 72, world.org.id)).role_id == 4

    # A refused acceptance never fails the join itself: it becomes a plain join.
    await _invite(world, mock_request, db, "zoe@test.com")
    zoe = await _user(db, 73, "zoe@test.com")
    with patch("src.services.orgs.invitations.apply.accept_invitation", AsyncMock(side_effect=HTTPException(status_code=404))):
        assert await _join_with_invitation(mock_request, db, zoe, world.org) is False


def _as_public(user):
    from src.tests.fixtures.invitations import _public

    return _public(user)
