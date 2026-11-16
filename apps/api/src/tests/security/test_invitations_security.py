"""Security rules for invitations and invite codes, end to end.

- Role escalation: only Admins invite Admins or Maintainers; below Admin
  nobody grants a permission their own role lacks; API tokens are held to
  their own rights too.
- Cross-org: another org's roles, groups, courses, invitations and codes are
  404s; another org's admin is refused.
- Invite codes never carry a management or dashboard role.
- Personal links are bound to the invited address; accepting needs being
  signed in as it (or signing up with it), and proves the inbox.
- Tokens are stored hashed, single use, expire, and resending retires the old
  one.
- Who has an account is only told to the holder of the link.
"""

from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.org_invitations import OrgInvitation
from src.db.users import AnonymousUser, User
from src.routers.invite_links import router as invite_links_router
from src.routers.orgs.invitations import router as invitations_router
from src.security.auth import get_current_user
from src.services.onboarding import invites as hub
from src.services.onboarding import invite_links
from src.services.orgs.invitations import codes, policy, service
from src.tests.routers.test_invite_links_router import add_user, join_side_effects, signup_side_effects
from src.tests.fixtures.invitations import _code, _invite, _membership, _public, _role, _row, _rights, _user
from src.tests.conftest import USER_RIGHTS

pytestmark = pytest.mark.usefixtures("quiet")


LINKS = "/api/v1/invite-links"
ORGS = "/api/v1/orgs"


def _app(db, user=None):
    app = FastAPI()
    app.include_router(invite_links_router, prefix=LINKS)
    app.include_router(invitations_router, prefix=ORGS)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user or AnonymousUser()
    return app


async def _post(app, path, body=None):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, json=body)


async def _token_for(world, mock_request, db, email, **kw):
    """Send an invitation and return its link token (from the link endpoint)."""
    await _invite(world, mock_request, db, email, **kw)
    inv = await _row(db, email)
    link = await service.invitation_link(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
    return link["url"].split("invite=", 1)[1], inv


@pytest.fixture(autouse=True)
def no_rate_limits():
    with patch("src.routers.invite_links._limit"), patch("src.routers.users._enforce_signup_rate_limit"):
        yield


# ---------------------------------------------------------------------------
# Role escalation
# ---------------------------------------------------------------------------


async def test_only_admins_invite_admins_or_maintainers(world, mock_request, db):
    for role_id in (1, 2):
        with pytest.raises(HTTPException) as exc:
            await _invite(world, mock_request, db, "x@test.com", role_id=role_id, user=world.maintainer)
        assert exc.value.status_code == 403 and exc.value.detail["code"] == "ROLE_ADMIN_ONLY"
    out = await _invite(world, mock_request, db, "boss@test.com", role_id=1)
    assert out["results"][0]["status"] == "sent"


async def test_nobody_grants_more_than_their_own_role(world, mock_request, db):
    # A custom staff role that may write the org (passes the manager gate)
    # but can't create courses: it may not hand out Instructor.
    staff_rights = _rights(USER_RIGHTS, organizations={"action_create": True}, users={"action_create": True})
    await _role(db, 11, "Coordinator", staff_rights, org_id=world.org.id)
    coord = await _user(db, 30, "coord@test.com", world.org, 11)
    with patch("src.security.org_auth.holds_admin_or_maintainer_role", AsyncMock(return_value=True)):
        with pytest.raises(HTTPException) as exc:
            await _invite(world, mock_request, db, "t@test.com", role_id=3, user=_public(coord))
        assert exc.value.detail["code"] == "ROLE_ABOVE_YOUR_ROLE"
        # Editing a pending invitation is held to the same rule.
        await _invite(world, mock_request, db, "t2@test.com", role_id=3)
        inv = await _row(db, "t2@test.com")
        with pytest.raises(HTTPException) as edit:
            await service.update_invitation(
                mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationUpdate(message="hi"), _public(coord)
            )
        assert edit.value.status_code == 403
        for call in (
            service.invitation_link(mock_request, db, world.org.id, inv.invitation_uuid, _public(coord)),
            service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(), _public(coord)),
        ):
            with pytest.raises(HTTPException) as exc:
                await call
            assert exc.value.status_code == 403
        ok = await _invite(world, mock_request, db, "l@test.com", role_id=4, user=_public(coord))
    assert ok["results"][0]["status"] == "sent"


async def test_learners_cannot_invite_or_list(world, mock_request, db):
    app = _app(db, world.regular)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get(f"{ORGS}/{world.org.id}/invitations")).status_code == 403
        assert (await c.post(f"{ORGS}/{world.org.id}/invitations", json={"emails": ["a@test.com"]})).status_code == 403
        assert (await c.get(f"{ORGS}/{world.org.id}/invite-codes")).status_code == 403


# ---------------------------------------------------------------------------
# Cross-org
# ---------------------------------------------------------------------------


async def test_another_orgs_ids_are_not_found(world, mock_request, db):
    for kw in ({"role_id": 10}, {"usergroup_ids": [2]}, {"course_uuids": ["course_foreign"]}):
        with pytest.raises(HTTPException) as exc:
            await _invite(world, mock_request, db, "x@test.com", **kw)
        assert exc.value.status_code == 404
    # An invitation of org 1 can't be reached through org 2's id, even by its admin.
    await _invite(world, mock_request, db, "a@test.com")
    inv = await _row(db, "a@test.com")
    from src.db.user_organizations import UserOrganization

    db.add(UserOrganization(user_id=world.admin.id, org_id=world.other_org.id, role_id=1, creation_date="", update_date=""))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await service.revoke_invitation(mock_request, db, world.other_org.id, inv.invitation_uuid, world.admin)
    assert exc.value.status_code == 404
    out = await service.bulk_invitations(
        mock_request, db, world.other_org.id, service.InvitationBulk(action="revoke", invitation_uuids=[inv.invitation_uuid]), world.admin
    )
    assert out["results"] == [{"invitation_uuid": inv.invitation_uuid, "status": "not_found"}]
    code = await _code(world, mock_request, db)
    with pytest.raises(HTTPException) as exc:
        await codes.update_code(mock_request, db, world.other_org.id, code["invite_code_uuid"], codes.InviteCodeUpdate(max_uses=1), world.admin)
    assert exc.value.status_code == 404


async def test_admin_of_another_org_is_refused(world, mock_request, db):
    app = _app(db, world.admin)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get(f"{ORGS}/{world.other_org.id}/invitations")).status_code == 403
        assert (await c.get(f"{ORGS}/{world.other_org.id}/invitations/options")).status_code == 403


# ---------------------------------------------------------------------------
# Invite codes
# ---------------------------------------------------------------------------


async def test_codes_never_grant_management_roles(world, mock_request, db):
    for role_id in (1, 2, 3, 8):
        with pytest.raises(HTTPException) as exc:
            await _code(world, mock_request, db, role_id=role_id)
        assert exc.value.detail["code"] == "CODE_ROLE_NOT_ALLOWED"
    code = await _code(world, mock_request, db, role_id=9)
    with pytest.raises(HTTPException) as exc:
        await codes.update_code(mock_request, db, world.org.id, code["invite_code_uuid"], codes.InviteCodeUpdate(role_id=1), world.admin)
    assert exc.value.detail["code"] == "CODE_ROLE_NOT_ALLOWED"


# ---------------------------------------------------------------------------
# Personal links: bound to the address, prove the inbox
# ---------------------------------------------------------------------------


async def test_link_signup_applies_everything(world, mock_request, db):
    token, inv = await _token_for(
        world, mock_request, db, "new@test.com", role_id=3, usergroup_ids=[1], course_uuids=["course_test"], message="Glad you're here"
    )
    peek = await _post(_app(db), f"{LINKS}/peek", {"token": token})
    assert peek.status_code == 200, peek.text
    body = peek.json()
    assert body["email"] == "new@test.com" and body["account_exists"] is False
    assert body["invitation"]["role"]["name"] == "Instructor" and body["invitation"]["invited_by"] == "Admin User"
    assert body["invitation"]["usergroups"] == ["Cohort A"] and body["invitation"]["courses"] == ["Test Course"]
    assert body["invitation"]["message"] == "Glad you're here"

    with signup_side_effects(), join_side_effects():
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42", "first_name": "Lea"})
    assert res.status_code == 200, res.text
    user = (await db.execute(select(User).where(User.email == "new@test.com"))).scalars().one()
    assert user.email_verified is True
    assert (await _membership(db, user.id, world.org.id)).role_id == 3
    await db.refresh(inv)
    assert inv.status == "accepted" and inv.accepted_user_id == user.id

    # Single use.
    again = await _post(_app(db), f"{LINKS}/peek", {"token": token})
    assert again.status_code == 404


async def test_link_signup_refuses_an_existing_account(world, mock_request, db):
    token, _ = await _token_for(world, mock_request, db, "known@test.com")
    await add_user(db, uid=40, email="known@test.com")
    peek = await _post(_app(db), f"{LINKS}/peek", {"token": token})
    assert peek.json()["account_exists"] is True
    with signup_side_effects():
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_EXISTS"


async def test_link_accept_is_bound_to_the_invited_address(world, mock_request, db):
    token, inv = await _token_for(world, mock_request, db, "lea@test.com", role_id=9)
    other = await add_user(db, uid=41, email="someone@test.com")
    with join_side_effects():
        res = await _post(_app(db, other), f"{LINKS}/accept", {"token": token})
    assert res.status_code == 403 and res.json()["detail"]["code"] == "INVITE_EMAIL_MISMATCH"
    anon = await _post(_app(db), f"{LINKS}/accept", {"token": token})
    assert anon.status_code == 401

    lea = await add_user(db, uid=42, email="Lea@Test.com", verified=False)
    with join_side_effects():
        res = await _post(_app(db, lea), f"{LINKS}/accept", {"token": token})
    assert res.status_code == 200, res.text
    assert res.json()["role"] == "Learner Plus" and res.json()["already_member"] is False
    row = await db.get(User, 42)
    await db.refresh(row)
    assert row.email_verified is True  # holding the mailed link proves the inbox
    assert (await _membership(db, 42, world.org.id)).role_id == 9


async def test_link_redis_claim_when_redis_is_there(world, mock_request, db):
    import fakeredis

    r = fakeredis.FakeRedis()
    token, inv = await _token_for(world, mock_request, db, "lea@test.com")
    r.set(invite_links.CLAIM_PREFIX + inv.token_hash, "1")
    lea = await add_user(db, uid=43, email="lea@test.com")
    with patch("src.core.redis.get_redis_client", return_value=r), join_side_effects():
        busy = await _post(_app(db, lea), f"{LINKS}/accept", {"token": token})
        assert busy.status_code == 409
        r.delete(invite_links.CLAIM_PREFIX + inv.token_hash)
        res = await _post(_app(db, lea), f"{LINKS}/accept", {"token": token})
    assert res.status_code == 200
    assert not r.exists(invite_links.CLAIM_PREFIX + policy.hash_token(token))

    token2, _ = await _token_for(world, mock_request, db, "new2@test.com")
    with patch("src.core.redis.get_redis_client", return_value=r), signup_side_effects(), join_side_effects():
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token2, "password": "blue river 42"})
    assert res.status_code == 200


async def test_link_for_a_demo_or_closed_invitation(world, mock_request, db):
    token, inv = await _token_for(world, mock_request, db, "lea@test.com")
    world.org.is_demo = True
    db.add(world.org)
    await db.commit()
    assert (await _post(_app(db), f"{LINKS}/peek", {"token": token})).status_code == 404
    world.org.is_demo = False
    db.add(world.org)
    await db.commit()
    lea = await add_user(db, uid=44, email="lea@test.com")
    await db.delete(await db.get(User, 44))
    await db.commit()
    with join_side_effects():
        gone = await _post(_app(db, lea), f"{LINKS}/accept", {"token": token})
    assert gone.status_code == 404


async def test_hub_uses_the_verified_address_only(world, mock_request, db):
    await _invite(world, mock_request, db, "lea@test.com", role_id=9, usergroup_ids=[1], message="Hi Lea")
    await _user(db, 50, "lea@test.com", verified=False)
    assert await hub.list_pending_invites(db, 50) == []
    with pytest.raises(HTTPException) as exc:
        await hub.accept_invite(mock_request, db, 50, world.org.org_uuid)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await hub.decline_invite(db, 50, world.org.org_uuid)
    assert exc.value.status_code == 403

    lea = await db.get(User, 50)
    lea.email_verified = True
    db.add(lea)
    await db.commit()
    pending = await hub.list_pending_invites(db, 50)
    assert len(pending) == 1
    row = pending[0]
    assert row["org_uuid"] == world.org.org_uuid and row["role"] == "Learner Plus"
    assert row["invited_by"] == "Admin User" and row["message"] == "Hi Lea" and row["usergroups"] == 1
    with join_side_effects():
        joined = await hub.accept_invite(mock_request, db, 50, world.org.org_uuid)
    assert joined["role"] == "Learner Plus"
    assert (await _membership(db, 50, world.org.id)).role_id == 9
    assert await hub.list_pending_invites(db, 50) == []


async def test_hub_decline_and_mixed_sources(world, mock_request, db):
    import json

    await _invite(world, mock_request, db, "lea@test.com")
    await _user(db, 51, "lea@test.com")
    redis = AsyncMock()
    with patch("src.services.orgs.invitations.service.audit_event"), patch(
        "src.core.ee_hooks.audit_event"
    ) as audit:
        out = await hub.decline_invite(db, 51, world.org.org_uuid, mock_request)
    assert out == {"org_id": world.org.id, "declined": True}
    assert audit.call_args.kwargs["action"] == "members.invitation.declined"
    assert (await _row(db, "lea@test.com")).status == "declined"
    del redis

    # A legacy Redis invitation from another org still lists beside nothing.
    class R:
        def scan_iter(self, match, count):
            return [f"invited_user:lea@test.com:org:{world.other_org.org_uuid}"]

        def get(self, key):
            return json.dumps({"pending": True, "created_at": "2026-01-01"})

    with patch("src.core.redis.get_redis_client", return_value=R()):
        rows = await hub.list_pending_invites(db, 51)
    assert [r["org_uuid"] for r in rows] == [world.other_org.org_uuid]
    assert rows[0]["invited_at"] == "2026-01-01" and "role" not in rows[0]


# ---------------------------------------------------------------------------
# Tokens: hashed, single use, expiring, rotated
# ---------------------------------------------------------------------------


async def test_tokens_are_hashed_rotated_and_expire(world, mock_request, db, quiet):
    token, inv = await _token_for(world, mock_request, db, "lea@test.com")
    assert inv.token_hash == policy.hash_token(token) and token not in (inv.token_hash or "")
    stored = (await db.execute(select(OrgInvitation.token_hash))).scalars().all()
    assert token not in stored

    # Resending mints a new token: the old link is dead.
    await service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(), world.admin)
    import fakeredis

    # The replaced token is unknown everywhere (the Redis fallback included).
    with patch("src.core.redis.get_redis_client", return_value=fakeredis.FakeRedis()):
        assert (await _post(_app(db), f"{LINKS}/peek", {"token": token})).status_code == 404
    new_token = quiet.send.await_args.args[5]
    assert (await _post(_app(db), f"{LINKS}/peek", {"token": new_token})).status_code == 200

    # Expired.
    await db.refresh(inv)
    inv.expires_at = policy.utcnow() - timedelta(seconds=1)
    db.add(inv)
    await db.commit()
    assert (await _post(_app(db), f"{LINKS}/peek", {"token": new_token})).status_code == 404

    # Revoked.
    token3, inv3 = await _token_for(world, mock_request, db, "sam@test.com")
    await service.revoke_invitation(mock_request, db, world.org.id, inv3.invitation_uuid, world.admin)
    assert (await _post(_app(db), f"{LINKS}/peek", {"token": token3})).status_code == 404
    # Malformed tokens never reach the database.
    assert (await _post(_app(db), f"{LINKS}/peek", {"token": "bad token!"})).status_code == 404
