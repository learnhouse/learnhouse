"""A real invitee gets in through every door, with the invitation applied and
closed; nobody gets in before proving the inbox.

Covers the invite / join / signup sweep: signing up to an invite-only org
with a pending invitation (database or Redis), invitations applied on email
verification, joining with or without a code while an invitation waits, the
copied link kept apart from the emailed one, Google sign-in from a personal
link (``invite_token``), peek of an accepted invitation, the magic link's
``next``, status races, one pending invitation per address and one membership
per person, and the smaller fixes around them.
"""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import fakeredis
import pytest
from fastapi import FastAPI, HTTPException, Response
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.org_invitations import OrgInvitation
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, APITokenUser, User
from src.security.auth import get_current_user
from src.services.onboarding import invite_links
from src.services.onboarding import invites as hub
from src.services.orgs.invitations import apply, policy, service
from src.tests.conftest import ADMIN_RIGHTS
from src.tests.fixtures.invitations import _invite, _membership, _public, _row, _user, saas
from src.tests.routers.test_auth_invitations_v2 import _CONFIG, _google, _signup_mode, _with
from src.tests.routers.test_invite_links_router import invite as legacy_link, join_side_effects, signup_side_effects
from src.tests.security.test_invitations_security import LINKS, _app, _post, _token_for

pytestmark = pytest.mark.usefixtures("quiet")


@pytest.fixture(autouse=True)
def no_rate_limits():
    with patch("src.routers.invite_links._limit"), patch("src.routers.users._enforce_signup_rate_limit"):
        yield


@pytest.fixture
def redis():
    """A Redis for the legacy records (overrides the quiet fixture's None)."""
    r = fakeredis.FakeRedis()
    with patch("src.core.redis.get_redis_client", return_value=r), patch(
        "src.services.users.email_verification.get_redis_connection", return_value=r
    ):
        yield r


def _legacy(r, email, org, code_uuid=None, pending=True):
    r.set(
        f"invited_user:{email}:org:{org.org_uuid}",
        json.dumps({"email": email, "org_id": org.id, "invite_code_uuid": code_uuid, "pending": pending}),
        ex=3600,
    )


def _legacy_record(r, email, org) -> dict:
    return json.loads(r.get(f"invited_user:{email}:org:{org.org_uuid}"))


async def _unproven(db, user_id):
    user = await db.get(User, user_id)
    user.email_verified = True
    user.email_verified_at = ""
    db.add(user)
    await db.commit()
    return user


def _pending(world, email, role_id=4, org=None, days=3, **kw):
    now = policy.utcnow()
    return OrgInvitation(
        invitation_uuid=f"invitation_{email}_{role_id}_{(org or world.org).id}", org_id=(org or world.org).id,
        email=email, role_id=role_id, invited_by_user_id=world.admin.id,
        expires_at=now + timedelta(days=days), created_at=now, updated_at=now, token_delivery="email", **kw,
    )


def _users_app(db):
    from src.routers.users import router as users_router

    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    return app


def _verification_token(r, user, next_path=None):
    data = {
        "user_uuid": user.user_uuid, "email": user.email,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": datetime.now(timezone.utc).timestamp() + 600,
    }
    if next_path:
        data["next"] = next_path
    r.set(f"email_verification:{user.user_uuid}:org:none:token:tok", json.dumps(data))


# ---------------------------------------------------------------------------
# 1. Signing up to an invite-only org with a pending invitation
# ---------------------------------------------------------------------------


async def test_invite_only_signup_with_an_invitation_creates_the_account_first(world, mock_request, db, redis):
    from src.services.users.email_verification import verify_email_token

    await _signup_mode(db, world.org, "inviteOnly")
    db.add(_pending(world, "lea@test.com", role_id=9, usergroup_ids=[1]))
    await db.commit()
    body = {"email": "lea@test.com", "username": "lea", "first_name": "Lea", "last_name": "", "password": "Blue river 42!"}

    with signup_side_effects() as side:
        res = await _post(_users_app(db), f"/api/v1/users/{world.org.id}?next=/courses", body)
    assert res.status_code == 200, res.text
    assert res.json()["invitation_pending"] is True and res.json()["email"] == "lea@test.com"
    user = (await db.execute(select(User).where(User.email == "lea@test.com"))).scalars().one()
    # No membership until the inbox is proven; the verification email lands
    # back on the page the person came from. Whoever signed up may not own
    # the inbox: the password is marked as set before the proof.
    assert await _membership(db, user.id, world.org.id) is None
    assert user.email_verified is False and user.email_verified_at == "" and user.password
    side["send_verification_email"].assert_awaited_once()
    assert side["send_verification_email"].await_args.kwargs == {"org_id": world.org.id, "next_path": "/courses"}

    # Verifying drops that password (the owner sets their own), then applies
    # the invitation.
    _verification_token(redis, user)
    with join_side_effects(), patch("src.security.auth.revoke_user_sessions_before") as revoke:
        verified, message = await verify_email_token(mock_request, db, "tok", user.user_uuid, "none")
    assert message == "Email verified. Set a new password to sign in with one."
    revoke.assert_called_once_with(user.id)
    assert verified.password == "" and verified.email_verified is True and verified.email_verified_at
    assert (await _membership(db, user.id, world.org.id)).role_id == 9
    assert (await _row(db, "lea@test.com")).status == "accepted"


async def test_invite_only_signup_with_a_legacy_invitation_or_none(world, mock_request, db, redis):
    await _signup_mode(db, world.org, "inviteOnly")
    _legacy(redis, "old@test.com", world.org)
    body = {"email": "Old@test.com", "username": "olduser", "first_name": "", "last_name": "", "password": "Blue river 42!"}
    with signup_side_effects():
        res = await _post(_users_app(db), f"/api/v1/users/{world.org.id}", body)
    assert res.status_code == 200 and res.json()["invitation_pending"] is True

    # No invitation: still refused.
    body = {**body, "email": "stranger@test.com", "username": "stranger"}
    with signup_side_effects():
        refused = await _post(_users_app(db), f"/api/v1/users/{world.org.id}", body)
    assert refused.status_code == 403 and refused.json()["detail"] == "You need an invite to join this organization"

    # An answered Redis invitation doesn't count.
    _legacy(redis, "done@test.com", world.org, pending=False)
    body = {**body, "email": "done@test.com", "username": "doneuser"}
    with signup_side_effects():
        assert (await _post(_users_app(db), f"/api/v1/users/{world.org.id}", body)).status_code == 403


async def test_open_org_signup_joins_right_away(world, mock_request, db):
    await _signup_mode(db, world.org, "open")
    body = {"email": "open@test.com", "username": "openuser", "first_name": "", "last_name": "", "password": "Blue river 42!"}
    with signup_side_effects():
        res = await _post(_users_app(db), f"/api/v1/users/{world.org.id}", body)
    assert res.status_code == 200 and res.json()["invitation_pending"] is False
    user = (await db.execute(select(User).where(User.email == "open@test.com"))).scalars().one()
    assert (await _membership(db, user.id, world.org.id)).role_id == 4


async def test_invited_signup_keeps_the_orgs_signup_fields(world, mock_request, db):
    from src.db.users import UserCreate
    from src.services.users.users import create_user_without_org

    config = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == world.org.id))).scalars().one()
    config.config = {**config.config, "customization": {"signup_fields": {"fields": [{"key": "school", "label": "School"}]}}}
    db.add(config)
    await db.commit()
    with signup_side_effects():
        user = await create_user_without_org(
            mock_request, db, AnonymousUser(),
            UserCreate(email="f@test.com", username="fieldy", password="Blue river 42!", custom_fields={"school": "Lycée", "x": "y"}),
            invited_org_id=world.org.id,
        )
    assert user.extra_metadata == {"school": "Lycée"}


# ---------------------------------------------------------------------------
# 2. Invitations apply once the inbox is proven
# ---------------------------------------------------------------------------


async def test_verifying_the_email_accepts_every_waiting_invitation(world, mock_request, db, redis):
    from src.services.users.email_verification import verify_email_token

    sam = await _user(db, 70, "sam@test.com", verified=False)
    db.add(_pending(world, "sam@test.com", role_id=9, usergroup_ids=[1], course_uuids=["course_test"]))
    await db.commit()
    _legacy(redis, "sam@test.com", world.other_org)
    _verification_token(redis, sam)
    with join_side_effects(), patch("src.security.auth.revoke_user_sessions_before"):
        _user_out, message = await verify_email_token(mock_request, db, "tok", sam.user_uuid, "none")
    # The password set before this proof goes before the invitations apply.
    assert message == "Email verified. Set a new password to sign in with one." and _user_out.password == ""
    assert (await _membership(db, 70, world.org.id)).role_id == 9
    assert (await _membership(db, 70, world.other_org.id)).role_id == 4
    assert _legacy_record(redis, "sam@test.com", world.other_org)["pending"] is False


async def test_a_member_still_sees_a_richer_invitation_in_the_hub(world, mock_request, db, redis):
    regular = await db.get(User, world.regular.id)
    regular.email_verified = True
    db.add(regular)
    db.add(_pending(world, "regular@test.com", role_id=3))
    await db.commit()
    _legacy(redis, "regular@test.com", world.other_org)
    rows = await hub.list_pending_invites(db, world.regular.id)
    by_org = {r["org_id"]: r for r in rows}
    assert by_org[world.org.id]["already_member"] is True and by_org[world.org.id]["role"] == "Instructor"
    assert by_org[world.other_org.id]["already_member"] is False
    # A Redis invitation adds nothing to a member: not listed.
    redis.delete(f"invited_user:regular@test.com:org:{world.other_org.org_uuid}")
    _legacy(redis, "admin@test.com", world.org)
    assert await hub.list_pending_invites(db, world.admin.id) == []


async def test_apply_all_pending_invites_edges(world, mock_request, db, redis, caplog):
    # An unproven inbox gets nothing.
    await _user(db, 71, "un@test.com")
    unproven = await _unproven(db, 71)
    db.add(_pending(world, "un@test.com"))
    await db.commit()
    assert await hub.apply_all_pending_invites(mock_request, db, unproven, via="t") == []

    kim = await _user(db, 72, "kim@test.com")
    # Listing failed: nothing, no error.
    with patch.object(hub, "_db_pending", AsyncMock(side_effect=RuntimeError("db"))):
        assert await hub.apply_all_pending_invites(mock_request, db, kim, via="t") == []

    # A demo org is skipped, a failing acceptance is logged, a Redis record for
    # an org that also has a database invitation defers to it, and a failing
    # Redis acceptance is logged too.
    world.other_org.is_demo = True
    db.add(world.other_org)
    db.add(_pending(world, "kim@test.com", org=world.other_org))
    db.add(_pending(world, "kim@test.com", role_id=9))
    await db.commit()
    _legacy(redis, "kim@test.com", world.org)
    with join_side_effects():
        assert await hub.apply_all_pending_invites(mock_request, db, kim, via="t") == [world.org.id]
    assert (await _membership(db, 72, world.org.id)).role_id == 9
    assert _legacy_record(redis, "kim@test.com", world.org)["pending"] is True

    lou = await _user(db, 73, "lou@test.com")
    db.add(_pending(world, "lou@test.com"))
    await db.commit()
    world.other_org.is_demo = False
    db.add(world.other_org)
    await db.commit()
    _legacy(redis, "lou@test.com", world.other_org)
    with patch("src.services.orgs.invitations.apply.accept_invitation", AsyncMock(side_effect=RuntimeError("x"))), patch.object(
        hub, "accept_legacy_invite", AsyncMock(side_effect=RuntimeError("y"))
    ):
        assert await hub.apply_all_pending_invites(mock_request, db, lou, via="t") == []
    assert "Could not accept invitation" in caplog.text and "legacy invitation" in caplog.text


async def test_legacy_group_and_concurrent_join(world, mock_request, db, redis):
    lou = await _user(db, 74, "lou@test.com")
    # No Redis, an unreadable code lookup, no group on the code, a group add
    # that fails: all quiet.
    with patch.object(hub, "_redis", return_value=None):
        await hub._add_legacy_group(mock_request, db, lou, world.org, {"invite_code_uuid": "c"})
    with patch.object(hub, "_invite_usergroup", side_effect=RuntimeError("scan")):
        await hub._add_legacy_group(mock_request, db, lou, world.org, {"invite_code_uuid": "c"})
    await hub._add_legacy_group(mock_request, db, lou, world.org, {})
    with patch.object(hub, "_invite_usergroup", return_value=1), patch(
        "src.services.users.usergroups.add_users_to_usergroup", AsyncMock(side_effect=HTTPException(400, "no"))
    ) as add:
        await hub._add_legacy_group(mock_request, db, lou, world.org, {"invite_code_uuid": "c"})
    add.assert_awaited_once()

    # Someone who became a member a moment ago: joining again is a no-op.
    with join_side_effects(), patch("src.services.orgs.invitations.apply.stage_membership", AsyncMock(return_value=None)):
        assert await hub.join_from_invite(mock_request, db, lou, world.org, join_method="t") is False


async def test_a_self_hosted_proof_from_a_copied_link_drops_the_password_and_asks_for_a_new_one(world, mock_request, db, redis):
    from src.routers.auth import router as auth_router

    token, inv = await _token_for(world, mock_request, db, "new@self.host", delivery="copied", role_id=9)
    with signup_side_effects(mode="oss"), join_side_effects(), patch(
        "src.services.users.email_verification.send_verification_email", new_callable=AsyncMock
    ) as proof:
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.json()["verification_required"] is True
    assert proof.await_args.kwargs == {"next_path": f"/signup?invite={token}"}
    user = (await db.execute(select(User).where(User.email == "new@self.host"))).scalars().one()
    assert user.password

    # Whoever held the copied link may not own the inbox: the proof drops the
    # password set before it, the invitation applies, and the page is told to
    # ask for a new password before going back to the invitation.
    _verification_token(redis, user, next_path=f"/signup?invite={token}")
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    with join_side_effects(), patch("src.routers.auth.check_email_verification_rate_limit", return_value=(True, 0)), patch(
        "src.security.auth.revoke_user_sessions_before"
    ), patch("src.routers.auth._bind_session_to_custom_domain", AsyncMock(side_effect=HTTPException(403, "no auto sign-in"))):
        out = await _post(app, "/api/v1/auth/verify-email", {"token": "tok", "user_uuid": user.user_uuid, "org_uuid": "none"})
    assert out.json() == {
        "message": "Email verified. Set a new password to sign in with one.",
        "next": f"/signup?invite={token}",
        "set_password": True,
        "email": "new@self.host",
    }
    await db.refresh(user)
    assert user.password == "" and user.email_verified_at not in ("", None)
    assert (await _membership(db, user.id, world.org.id)).role_id == 9


async def test_an_invitees_verification_link_is_the_platforms(world, mock_request, db, redis):
    from src.services.users.email_verification import send_verification_email

    db.add(_pending(world, "proof@test.com"))
    await db.commit()
    proof_user = await _user(db, 75, "proof@test.com")
    with patch("src.services.users.email_verification.send_email_verification_email", return_value=True) as mail, patch(
        "src.services.email.utils.get_org_signup_base_url", AsyncMock(return_value="https://acme.test")
    ):
        await send_verification_email(mock_request, db, proof_user, world.org.id, next_path="/signup?invite=x")
    # Invited, not a member yet: never the org's host (an org could read the
    # token off its own domain); the relative next brings them back.
    assert mail.call_args.kwargs["base_url"] != "https://acme.test" and mail.call_args.kwargs["organization"] is None
    stored = [json.loads(redis.get(k)) for k in redis.scan_iter("email_verification:*")]
    assert "keep_password" not in stored[0] and stored[0]["next"] == "/signup?invite=x"


# ---------------------------------------------------------------------------
# 3 / 4. Joining an invite-only org while an invitation waits
# ---------------------------------------------------------------------------


async def test_joining_an_invite_only_org_without_a_code_accepts_the_invitation(world, mock_request, db, redis):
    from src.services.orgs.join import JoinOrg, join_org

    await _signup_mode(db, world.org, "inviteOnly")
    db.add(_pending(world, "ana@test.com", role_id=9))
    await db.commit()
    ana = await _user(db, 76, "ana@test.com")
    with join_side_effects():
        assert await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=76), _public(ana), db)
    assert (await _membership(db, 76, world.org.id)).role_id == 9

    # An older Redis invitation works the same way, and is marked answered.
    _legacy(redis, "ben@test.com", world.org)
    ben = await _user(db, 77, "ben@test.com")
    with join_side_effects():
        await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=77), _public(ben), db)
    assert (await _membership(db, 77, world.org.id)).role_id == 4
    assert _legacy_record(redis, "ben@test.com", world.org)["pending"] is False


async def test_join_refusals(world, mock_request, db):
    from src.services.orgs.join import JoinOrg, join_org

    cal = await _user(db, 78, "cal@test.com")
    # A join mechanism this code doesn't know.
    with join_side_effects(), patch("src.services.orgs.join.get_org_join_mechanism", AsyncMock(return_value="closed")):
        with pytest.raises(HTTPException) as odd:
            await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=78), _public(cal), db)
    assert odd.value.detail == "Something wrong, try later."

    # A concurrent join got there first: the same "already part of it".
    await _signup_mode(db, world.org, "open")
    with join_side_effects(), patch("src.services.orgs.invitations.apply.stage_membership", AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as dup:
            await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=78), _public(cal), db)
    assert dup.value.status_code == 400


# ---------------------------------------------------------------------------
# 6. Plan capacity: only the free plan caps members
# ---------------------------------------------------------------------------


async def test_paid_plans_may_go_over_the_member_limit(world, mock_request, db):
    config = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == world.org.id))).scalars().one()
    config.config = {"config_version": "2.0", "plan": "pro"}
    db.add(config)
    await db.commit()
    with saas(), patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 3}):
        cap = await policy.capacity(db, world.org.id)
    assert cap["plan"] == "pro" and cap["members"]["limit"] is None


# ---------------------------------------------------------------------------
# 7. Removing a member withdraws their invitations
# ---------------------------------------------------------------------------


async def test_removing_a_member_withdraws_their_pending_invitations(world, mock_request, db):
    from src.services.orgs.users import _drop_accepted_invites

    db.add(_pending(world, "regular@test.com", role_id=3))
    await db.commit()
    await _drop_accepted_invites(db, world.org, [world.regular.id])
    assert (await _row(db, "regular@test.com")).status == "revoked"


# ---------------------------------------------------------------------------
# 8 / 9 / 14. Personal links: copied apart from emailed, no account probing
# ---------------------------------------------------------------------------


async def test_copying_a_link_keeps_the_emailed_one_working(world, mock_request, db):
    emailed, inv = await _token_for(world, mock_request, db, "dee@test.com", role_id=9)
    link = await service.invitation_link(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
    copied = link["url"].split("invite=", 1)[1]
    assert await apply.invitation_by_token(db, copied) == inv
    assert apply.token_emailed(inv, emailed) is True and apply.token_emailed(inv, copied) is False

    copied_peek = (await _post(_app(db), f"{LINKS}/peek", {"token": copied})).json()
    emailed_peek = (await _post(_app(db), f"{LINKS}/peek", {"token": emailed})).json()
    assert copied_peek["invitation"]["proves_inbox"] is False and "account_exists" not in copied_peek
    assert emailed_peek["invitation"]["proves_inbox"] is True and emailed_peek["status"] == "pending"

    # The emailed link still signs up (verified) and applies the invitation.
    with signup_side_effects(), join_side_effects():
        res = await _post(_app(db), f"{LINKS}/signup", {"token": emailed, "password": "blue river 42"})
    assert res.json()["verification_required"] is False
    user = (await db.execute(select(User).where(User.email == "dee@test.com"))).scalars().one()
    assert (await _membership(db, user.id, world.org.id)).role_id == 9


async def test_a_copied_link_never_tells_whether_the_address_has_an_account(world, mock_request, db, quiet):
    await _user(db, 79, "known@test.com")
    token, inv = await _token_for(world, mock_request, db, "known@test.com", delivery="copied")
    quiet.send.reset_mock()
    res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.status_code == 200 and res.json()["verification_required"] is True
    # The owner gets the invitation (with this link) to sign in and accept.
    quiet.send.assert_awaited_once()
    assert quiet.send.await_args.args[5] == token

    # Without a sender to mail it from, nothing goes out (same answer).
    inv.invited_by_user_id = None
    db.add(inv)
    await db.commit()
    quiet.send.reset_mock()
    res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.status_code == 200 and quiet.send.await_count == 0

    # The emailed link's holder was told by peek: still a 409 there.
    emailed, _inv = await _token_for(world, mock_request, db, "known@test.com")
    assert (await _post(_app(db), f"{LINKS}/signup", {"token": emailed, "password": "blue river 42"})).status_code == 409


async def test_a_failed_claim_leaves_no_membership(world, mock_request, db):
    token, inv = await _token_for(world, mock_request, db, "eve@test.com", role_id=9)
    with signup_side_effects(), join_side_effects(), patch(
        "src.services.orgs.invitations.apply.accept_invitation", AsyncMock(side_effect=HTTPException(404, "gone"))
    ), patch("src.security.features_utils.usage.decrease_feature_usage", new=AsyncMock()) as decrease:
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.status_code == 404
    user = (await db.execute(select(User).where(User.email == "eve@test.com"))).scalars().one()
    assert await _membership(db, user.id, world.org.id) is None
    decrease.assert_awaited_once()
    # Nothing to undo: quiet.
    await invite_links._undo_membership(db, user.id, world.org.id)


async def test_peek_of_an_accepted_invitation(world, mock_request, db):
    token, inv = await _token_for(world, mock_request, db, "fay@test.com")
    inv.status = "accepted"
    db.add(inv)
    await db.commit()
    body = (await _post(_app(db), f"{LINKS}/peek", {"token": token})).json()
    assert body["status"] == "accepted" and body["org"]["slug"] == world.org.slug
    # Revoked or expired: still a 404.
    inv.status = "revoked"
    db.add(inv)
    await db.commit()
    assert (await _post(_app(db), f"{LINKS}/peek", {"token": token})).status_code == 404


# ---------------------------------------------------------------------------
# Google sign-in from a personal link (POST /auth/oauth?invite_token=...)
# ---------------------------------------------------------------------------


async def _oauth(db, org_id, invite_token, invite_code=None):
    from src.routers.auth import third_party_login

    return await third_party_login(
        request=SimpleNamespace(), response=Response(),
        body=SimpleNamespace(email="ignored@x.io", provider="google", access_token="tok"),
        org_id=org_id, invite_code=invite_code, invite_token=invite_token,
        current_user=AnonymousUser(), db_session=db,
    )


async def test_google_with_the_invitation_link_accepts_it(world, mock_request, db):
    await _signup_mode(db, world.org, "inviteOnly")
    token, inv = await _token_for(world, mock_request, db, "gil@test.com", role_id=9, usergroup_ids=[1])
    await _user(db, 80, "gil@test.com")
    with join_side_effects():
        # No org_id: the invitation's org.
        result = await _with(_google(db, 80, "Gil@test.com", world.org), _oauth(db, None, token))
    assert result["invite_accepted"] is True
    assert (await _membership(db, 80, world.org.id)).role_id == 9
    assert (await _row(db, "gil@test.com")).status == "accepted"

    # Used now: ignored, and an existing member just signs in.
    with join_side_effects():
        again = await _with(_google(db, 80, "gil@test.com", world.org), _oauth(db, world.org.id, token))
    assert again["invite_accepted"] is False and again["tokens"]["access_token"] == "a"


async def test_google_as_another_address_is_refused_with_a_hint(world, mock_request, db):
    await _signup_mode(db, world.org, "open")
    token, _inv = await _token_for(world, mock_request, db, "bob@example.com")
    await _user(db, 81, "mallory@test.com")
    with join_side_effects(), pytest.raises(HTTPException) as exc:
        await _with(_google(db, 81, "mallory@test.com", world.org), _oauth(db, world.org.id, token))
    assert exc.value.status_code == 403
    assert exc.value.detail == {
        "code": "INVITE_EMAIL_MISMATCH",
        "message": "This invitation was sent to b***@example.com. Sign in with that Google account to accept it.",
        "invited_email_hint": "b***@example.com",
    }
    # Not joined, even to an open org.
    assert await _membership(db, 81, world.org.id) is None
    assert (await _row(db, "bob@example.com")).status == "pending"


async def test_google_link_edges(world, mock_request, db, redis):
    from src.routers.auth import _legacy_invite_pending

    await _signup_mode(db, world.org, "open")
    db.add(OrganizationConfig(org_id=world.other_org.id, config={"config_version": "2.0", "plan": "free"}))
    await db.commit()
    await _user(db, 82, "hal@test.com")
    # A token for another org than the one asked for, or an unknown one: ignored.
    token, _inv = await _token_for(world, mock_request, db, "hal@test.com")
    with join_side_effects():
        out = await _with(_google(db, 82, "hal@test.com", world.org), _oauth(db, world.other_org.id, token))
    assert out["invite_accepted"] is False
    with join_side_effects():
        out = await _with(_google(db, 82, "hal@test.com", world.org), _oauth(db, world.org.id, "x" * 43))
    assert out["invite_accepted"] is False

    # A second factor: the flag rides along with the challenge.
    mfa_token, _inv2 = await _token_for(world, mock_request, db, "ida@test.com")
    await _user(db, 93, "ida@test.com")
    patches = list(_google(db, 93, "ida@test.com", world.org))
    patches[-2] = patch("src.routers.auth.issue_session_or_challenge", AsyncMock(return_value=SimpleNamespace(mfa_required=True, mfa_token="m")))
    with join_side_effects(), patch("src.services.auth.mfa.is_mfa_active", AsyncMock(return_value=True)):
        mfa = await _with(patches, _oauth(db, world.org.id, mfa_token))
    # Nothing joins and the invitation waits until the second factor is done
    # (then accepted from the link, signed in).
    assert mfa == {"mfa_required": True, "mfa_token": "m", "invite_accepted": False}
    assert (await _row(db, "ida@test.com")).status == "pending"
    assert await _membership(db, 93, world.org.id) is None

    assert _legacy_invite_pending(None) is False
    assert _legacy_invite_pending("{not json") is False
    assert _legacy_invite_pending(json.dumps({"pending": False})) is False
    assert _legacy_invite_pending(json.dumps({"email": "x"})) is True


async def test_google_with_a_legacy_link(world, mock_request, db, redis):
    await _signup_mode(db, world.org, "inviteOnly")
    token, digest = legacy_link(redis, world.org, email="ivy@test.com")
    await _user(db, 83, "ivy@test.com")
    with join_side_effects():
        out = await _with(_google(db, 83, "ivy@test.com", world.org), _oauth(db, None, token))
    assert out["invite_accepted"] is True
    assert (await _membership(db, 83, world.org.id)).role_id == 4
    assert _legacy_record(redis, "ivy@test.com", world.org)["pending"] is False
    assert redis.get(f"invite_link:{digest}") is None


async def test_resolve_invite_token_and_accept_after_google_edges(world, mock_request, db, redis, caplog):
    assert await invite_links.resolve_invite_token(db, None) is None
    assert await invite_links.resolve_invite_token(db, "short") is None
    token, inv = await _token_for(world, mock_request, db, "jo@test.com")
    inv.status = "revoked"
    db.add(inv)
    await db.commit()
    assert await invite_links.resolve_invite_token(db, token) is None
    token2, inv2 = await _token_for(world, mock_request, db, "jay@test.com")
    world.org.is_demo = True
    db.add(world.org)
    await db.commit()
    assert await invite_links.resolve_invite_token(db, token2) is None
    world.org.is_demo = False
    db.add(world.org)
    await db.commit()
    # Unknown in Redis, Redis failing, no Redis at all.
    assert await invite_links.resolve_invite_token(db, "y" * 43) is None
    with patch.object(invite_links, "_load", side_effect=RuntimeError("redis down")):
        assert await invite_links.resolve_invite_token(db, "y" * 43) is None
    with patch.object(invite_links, "_redis", return_value=None):
        assert await invite_links.resolve_invite_token(db, "y" * 43) is None

    # Accepting fails: false, never an error.
    found = await invite_links.resolve_invite_token(db, token2)
    with patch("src.services.orgs.invitations.apply.accept_invitation", AsyncMock(side_effect=RuntimeError("x"))):
        assert await invite_links.accept_after_google(mock_request, db, world.admin.id, found, joined_now=False) is False
    assert "Could not accept the invitation after Google sign-in" in caplog.text

    # A legacy link accepted without Redis to consume it afterwards.
    legacy_token, _digest = legacy_link(redis, world.org, email="admin@test.com")
    legacy = await invite_links.resolve_invite_token(db, legacy_token)
    with join_side_effects(), patch.object(invite_links, "_redis", return_value=None):
        assert await invite_links.accept_after_google(mock_request, db, world.admin.id, legacy, joined_now=False) is True
    assert invite_links.mask_email("nodomain") == "***"


async def test_invite_only_refusal_carries_a_code(world, mock_request, db):
    await _signup_mode(db, world.org, "inviteOnly")
    await _user(db, 84, "nobody@test.com")
    with join_side_effects(), pytest.raises(HTTPException) as exc:
        await _with(_google(db, 84, "nobody@test.com", world.org), _oauth(db, world.org.id, None))
    assert exc.value.detail == {"code": "INVITE_REQUIRED", "message": "You need an invite to join this organization"}


async def test_an_answered_redis_invitation_does_not_open_the_gate(world, mock_request, db, redis):
    await _signup_mode(db, world.org, "inviteOnly")
    await _user(db, 85, "past@test.com")
    _legacy(redis, "past@test.com", world.org, pending=False)
    config = SimpleNamespace(
        redis_config=SimpleNamespace(redis_connection_string="redis://fake"), hosting_config=_CONFIG.hosting_config,
    )
    patches = list(_google(db, 85, "past@test.com", world.org))
    patches[3] = patch("src.routers.auth.get_learnhouse_config", return_value=config)
    with join_side_effects(), patch("redis.Redis.from_url", return_value=redis), pytest.raises(HTTPException) as exc:
        await _with(patches, _oauth(db, world.org.id, None))
    assert exc.value.status_code == 403 and exc.value.detail["code"] == "INVITE_REQUIRED"


# ---------------------------------------------------------------------------
# A / B. One pending invitation per address, no status races
# ---------------------------------------------------------------------------


async def test_reviving_an_expired_invitation_while_a_newer_one_is_pending(world, mock_request, db):
    old = _pending(world, "kit@test.com", days=-1)
    old.invitation_uuid = "invitation_old"
    old.status = "expired"
    db.add(old)
    db.add(_pending(world, "kit@test.com", role_id=9))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await service.resend_invitation(mock_request, db, world.org.id, "invitation_old", service.InvitationResend(), world.admin)
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "INVITATION_SUPERSEDED"


async def test_an_accepted_invitation_is_never_revoked_or_declined_after_the_fact(world, mock_request, db):
    from sqlalchemy import update

    db.add(_pending(world, "liz@test.com"))
    await db.commit()
    inv = await _row(db, "liz@test.com")
    # Accepted meanwhile (another request), this one still holds it as pending.
    await db.execute(
        update(OrgInvitation).where(OrgInvitation.id == inv.id).values(status="accepted").execution_options(synchronize_session=False)
    )
    await db.commit()
    with pytest.raises(HTTPException) as revoke:
        await service._revoke(mock_request, db, world.org, inv, world.admin)
    assert revoke.value.status_code == 409 and inv.status == "accepted"

    liz = await _user(db, 86, "liz@test.com")
    with db.sync_session.no_autoflush:
        inv.status = "pending"  # the stale view the hub would have read
        with patch("src.services.orgs.invitations.apply.find_pending_invitation", AsyncMock(return_value=inv)):
            with pytest.raises(HTTPException) as decline:
                await hub.decline_invite(db, liz.id, world.org.org_uuid, mock_request)
    assert decline.value.status_code == 409
    assert (await _row(db, "liz@test.com")).status == "accepted"


async def test_accepting_settles_the_other_pending_invitations_and_counts_only_live_ones(world, mock_request, db):
    db.add(_pending(world, "max@test.com", role_id=9))
    expired = _pending(world, "old@test.com", days=-1)
    db.add(expired)
    await db.commit()
    # Only a pending, unexpired invitation counts.
    assert await apply.has_pending_invitations(db, world.other_org.id) is False
    assert await apply.has_pending_invitations(db, world.org.id) is True
    max_ = await _user(db, 87, "max@test.com")
    with join_side_effects():
        await apply.accept_invitation(mock_request, db, max_, world.org, await _row(db, "max@test.com"), via="t")
    assert (await _row(db, "max@test.com")).status == "accepted"


# ---------------------------------------------------------------------------
# C. One membership per person and org
# ---------------------------------------------------------------------------


async def test_a_second_membership_is_refused_by_the_database(world, mock_request, db):
    assert await apply.stage_membership(db, world.regular.id, world.org.id, 4) is None
    await db.commit()
    rows = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == world.regular.id))).scalars().all()
    assert len(rows) == 1


async def test_accepting_when_a_concurrent_join_got_there_first(world, mock_request, db):
    db.add(_pending(world, "ned@test.com", role_id=9))
    await db.commit()
    ned = await _user(db, 88, "ned@test.com")

    async def joined_meanwhile(db_session, user_id, org_id, role_id):
        db_session.add(UserOrganization(user_id=user_id, org_id=org_id, role_id=4, creation_date="", update_date=""))
        await db_session.flush()
        return None

    with join_side_effects(), patch.object(apply, "stage_membership", joined_meanwhile):
        out = await apply.accept_invitation(mock_request, db, ned, world.org, await _row(db, "ned@test.com"), via="t")
    assert out["already_member"] is True
    # The explicit acceptance still upgrades the plain membership.
    assert (await _membership(db, 88, world.org.id)).role_id == 9


# ---------------------------------------------------------------------------
# D. Email-domain groups need a proven address
# ---------------------------------------------------------------------------


async def test_email_domain_groups_skip_unproven_addresses(world, mock_request, db):
    from src.services.usergroups import rules

    await _user(db, 89, "a@school.edu", world.org, 4)
    await _user(db, 90, "b@school.edu", world.org, 4)
    await _unproven(db, 90)
    await _user(db, 91, "c@school.edu", world.org, 4, verified=False)
    condition = {"type": "email_domain", "values": ["school.edu"]}
    assert await rules.condition_set(db, world.org.id, condition, {89, 90, 91}, proven_only=True) == {89}
    assert await rules.condition_set(db, world.org.id, condition, {89, 90, 91}) == {89, 90, 91}


async def test_domain_sync_never_adds_unproven_people_nor_removes_them_for_it(world, mock_request, db):
    from src.db.usergroup_user import UserGroupUser
    from src.db.usergroups import UserGroup
    from src.services.usergroups import sync

    for uid, email in ((94, "a@school.edu"), (95, "b@school.edu"), (96, "c@school.edu")):
        await _user(db, uid, email, world.org, 4)
    await _unproven(db, 95)
    await _unproven(db, 96)
    group = await db.get(UserGroup, 1)
    group.settings = {**(group.settings or {}), "auto_join_domains": ["school.edu"]}
    group.kind = "smart"
    group.rules = {"match": "all", "conditions": [{"type": "email_domain", "values": ["school.edu"]}]}
    db.add(group)
    # 96 joined by the domain before (a self-hosted member, not verified yet).
    db.add(UserGroupUser(usergroup_id=1, user_id=96, org_id=world.org.id, sources=["domain", "rule"], creation_date="", update_date=""))
    await db.commit()
    with patch("src.services.usergroups.sync.advanced_enabled", AsyncMock(return_value=True)):
        await sync.sync_org(db, world.org.id)
    rows = {r.user_id: r for r in (await db.execute(select(UserGroupUser).where(UserGroupUser.usergroup_id == 1))).scalars().all()}
    assert 94 in rows and 95 not in rows and 96 in rows


# ---------------------------------------------------------------------------
# F / 12 / 13. Smaller fixes
# ---------------------------------------------------------------------------


async def test_an_api_token_can_withdraw_an_invitation(world, mock_request, db):
    from src.services.orgs.users import remove_invited_user

    db.add(_pending(world, "tok@test.com"))
    await db.commit()
    token = APITokenUser(org_id=world.org.id, rights=ADMIN_RIGHTS.model_dump(), created_by_user_id=world.admin.id)
    assert await remove_invited_user(mock_request, world.org.id, "Tok@test.com", db, token) == {"detail": "User removed"}
    assert (await _row(db, "tok@test.com")).status == "revoked"


async def test_deleting_a_code_works_without_redis(world, mock_request, db):
    from src.services.orgs.invites import delete_invite_code
    from src.tests.fixtures.invitations import _code

    code = await _code(world, mock_request, db)
    no_redis = SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string=""))
    with patch("src.services.orgs.invites.get_learnhouse_config", return_value=no_redis):
        out = await delete_invite_code(mock_request, world.org.id, code["invite_code_uuid"], world.admin, db)
        assert out["revoked"] is True
        # An older Redis code can't be found without Redis.
        with pytest.raises(HTTPException) as exc:
            await delete_invite_code(mock_request, world.org.id, "org_invite_code_00000000-0000-4000-8000-000000000000", world.admin, db)
    assert exc.value.status_code == 500


async def test_provisioning_refuses_an_address_differing_only_in_case(world, mock_request, db):
    from src.services.admin import admin

    token = APITokenUser(org_id=world.org.id, rights=ADMIN_RIGHTS.model_dump(), created_by_user_id=world.admin.id)
    with patch("src.services.admin.admin.check_limits_with_usage", new=AsyncMock()), pytest.raises(HTTPException) as exc:
        await admin.provision_user(token, "ADMIN@Test.com", "dupe", "", "", None, 4, mock_request, db)
    assert exc.value.status_code == 409


async def test_invitation_link_signups_are_counted_apart_from_codes(world, mock_request, db):
    token, _inv = await _token_for(world, mock_request, db, "lin@test.com")
    with signup_side_effects() as side, join_side_effects():
        await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    joins = [c.kwargs["properties"] for c in side["track"].await_args_list if "join_method" in c.kwargs["properties"]]
    assert joins == [{"join_method": "invite_link"}]


# ---------------------------------------------------------------------------
# 15. The magic link keeps where it was asked from
# ---------------------------------------------------------------------------


async def test_magic_link_carries_next(world, mock_request, db):
    from src.routers.auth import router as auth_router
    from src.security.auth import decode_jwt
    from src.services.auth.magic_login import issue_magic_login_token, send_magic_login_email

    token = issue_magic_login_token("admin@test.com", None, "/signup?invite=abc")
    assert decode_jwt(token)["next"] == "/signup?invite=abc"
    assert "next" not in decode_jwt(issue_magic_login_token("admin@test.com", None, "https://evil.test"))
    with patch("src.services.email.pipeline.send_email", return_value=True) as sent:
        send_magic_login_email(SimpleNamespace(username="a", email="a@x"), "a@x", "https://acme.test", "jwt", next_path="/signup?invite=abc")
    assert sent.call_args.args[2]["url"] == "https://acme.test/auth/magic?token=jwt&next=%2Fsignup%3Finvite%3Dabc"

    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    # The request stores the page; verifying returns it.
    with patch("src.routers.auth.check_login_rate_limit", return_value=(True, None)), patch(
        "src.routers.auth.check_rate_limit", return_value=(True, 1, 900)
    ), patch("src.services.auth.magic_login.send_magic_login_email") as send, patch(
        "src.services.email.utils.get_member_link_base_url", AsyncMock(return_value="https://acme.test")
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.post("/api/v1/auth/magic-link/request", json={"email": "admin@test.com", "next": "/signup?invite=abc"})
    assert send.call_args.kwargs["next_path"] == "/signup?invite=abc"
    issued = send.call_args.args[3]
    with patch("src.routers.auth.set_auth_cookies"), patch("src.routers.auth.get_token_expiry_ms", return_value=1):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            res = await c.post("/api/v1/auth/magic-link/verify", json={"token": issued})
    assert res.status_code == 200, res.text
    assert res.json()["next"] == res.json()["redirect_to"] == "/signup?invite=abc"

    # With a second factor, the page still learns where to land.
    second = issue_magic_login_token("admin@test.com", None, "/signup?invite=abc")
    with patch(
        "src.routers.auth.issue_session_or_challenge", AsyncMock(return_value=SimpleNamespace(mfa_required=True, mfa_token="m"))
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            res = await c.post("/api/v1/auth/magic-link/verify", json={"token": second})
    assert res.json() == {"mfa_required": True, "mfa_token": "m", "next": "/signup?invite=abc", "redirect_to": "/signup?invite=abc"}


async def test_an_invitees_magic_link_is_the_platforms(world, mock_request, db):
    from src.routers.auth import router as auth_router

    db.add(_pending(world, "inv@test.com"))
    await db.commit()
    await _user(db, 92, "inv@test.com")
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    with patch("src.routers.auth.check_login_rate_limit", return_value=(True, None)), patch(
        "src.routers.auth.check_rate_limit", return_value=(True, 1, 900)
    ), patch("src.services.auth.magic_login.send_magic_login_email") as send, patch(
        "src.services.email.utils.get_member_link_base_url", AsyncMock(return_value="https://platform.test")
    ), patch("src.services.email.utils.get_org_signup_base_url", AsyncMock(return_value="https://acme.test")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.post("/api/v1/auth/magic-link/request", json={"email": "inv@test.com", "org_slug": world.org.slug})
    # Not a member yet: the platform's link, never the org's host.
    assert send.call_args.args[2] == "https://platform.test"


# ---------------------------------------------------------------------------
# G / J. Invitation email in the reader's language, webhook schema
# ---------------------------------------------------------------------------


def test_dates_and_sender_line_in_the_emails_language():
    from datetime import date

    from src.services.email import layout
    from src.services.email.dates import human_date
    from src.services.email.translations import SUPPORTED_LANGUAGES, t

    day = date(2026, 12, 2)
    assert human_date(day, "fr") == "2 décembre 2026"
    assert human_date(day, "de") == "2. Dezember 2026"
    assert human_date(day, "es") == "2 de diciembre de 2026"
    assert human_date(day, "ja") == "2026年12月2日"
    assert human_date(day, "ru") == "2 декабря 2026 г."
    assert human_date(day, "pt-BR") == "2 de dezembro de 2026"
    assert human_date(day, "sk") == "2 December 2026" and human_date(day, None) == "2 December 2026"
    for lang in SUPPORTED_LANGUAGES:
        assert human_date(day, lang)
        line = t(lang, "common.sent_by", org="Acme")
        assert "Acme" in line and "LearnHouse" in line and "{org}" not in line
    assert layout.sent_by("fr", "Acme") == "Envoyé par Acme via LearnHouse"


def test_invited_webhook_schema_matches_its_payload():
    from src.services.webhooks.events import WEBHOOK_EVENTS

    schema = WEBHOOK_EVENTS["user_invited_to_org"]["data_schema"]
    assert set(schema) == {"org_id", "emails", "invited_by", "role_uuid", "usergroup_ids", "course_uuids"}


async def test_the_invitation_email_dates_follow_the_org_language(world, mock_request, db):
    from src.tests.fixtures.invitations import _REAL_SEND

    inv = _pending(world, "fr@test.com")
    db.add(inv)
    await db.commit()
    branding = SimpleNamespace(lang="fr", as_kwargs=lambda: {"lang": "fr"})
    with patch("src.services.email.branding.resolve_org_email_branding", return_value=branding), patch(
        "src.services.users.emails.send_invitation_email", Mock(return_value=True)
    ) as mail, patch("src.services.orgs.invitations.service._signup_url", AsyncMock(return_value="https://x/signup")):
        assert await _REAL_SEND(mock_request, db, world.org, await db.get(User, world.admin.id), inv, "t", None) is True
    expires = mail.call_args.kwargs["expires_on"]
    assert any(month in expires for month in ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"))


async def test_legacy_invitation_helpers_never_raise(world, mock_request, db, redis):
    assert apply.find_legacy_invite("", world.org) is None
    redis.set(f"invited_user:bad@test.com:org:{world.org.org_uuid}", "{not json")
    assert apply.find_legacy_invite("bad@test.com", world.org) is None
    with patch("src.core.redis.get_redis_client", return_value=None):
        assert apply.find_legacy_invite("bad@test.com", world.org) is None
        apply.consume_legacy_invite("invited_user:x:org:y", {"pending": True})
    broken = Mock(ttl=Mock(side_effect=RuntimeError("down")))
    with patch("src.core.redis.get_redis_client", return_value=broken):
        apply.consume_legacy_invite("invited_user:x:org:y", {"pending": True})
    # No TTL left: kept without one.
    redis.set("invited_user:k:org:o", "{}")
    apply.consume_legacy_invite("invited_user:k:org:o", {"pending": True})
    assert json.loads(redis.get("invited_user:k:org:o")) == {"pending": False} and redis.ttl("invited_user:k:org:o") == -1


async def test_a_code_still_applies_over_an_older_redis_invitation(world, mock_request, db, redis):
    from src.services.orgs.join import JoinOrg, join_org
    from src.tests.fixtures.invitations import _code

    code = await _code(world, mock_request, db, role_id=9)
    for mode, uid, email in (("inviteOnly", 94, "pia@test.com"), ("open", 95, "quin@test.com")):
        await _signup_mode(db, world.org, mode)
        _legacy(redis, email, world.org)
        person = await _user(db, uid, email)
        with join_side_effects():
            await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=uid, invite_code=code["invite_code"]), _public(person), db)
        # The code's role, and the Redis invitation answered.
        assert (await _membership(db, uid, world.org.id)).role_id == 9
        assert _legacy_record(redis, email, world.org)["pending"] is False


async def test_signups_with_a_waiting_invitation_lose_their_password_on_proof(world, mock_request, db, redis):
    from src.db.users import UserCreate
    from src.services.users.users import _unverified_marker, create_user

    # Open org, SaaS, an invitation waiting elsewhere (another org's Redis
    # record): marked. No invitation, or no password (Google): not marked.
    _legacy(redis, "zed@test.com", world.other_org)
    with signup_side_effects():
        zed = await create_user(mock_request, db, AnonymousUser(), UserCreate(email="zed@test.com", username="zeduser", password="Blue river 42!"), world.org.id)
        plain = await create_user(mock_request, db, AnonymousUser(), UserCreate(email="pat@test.com", username="patuser", password="Blue river 42!"), world.org.id)
    assert (await db.get(User, zed.id)).email_verified_at == ""
    assert (await db.get(User, plain.id)).email_verified_at is None
    assert await _unverified_marker(db, UserCreate(email="zed@test.com", username="g", password="")) is None


async def test_a_failing_grant_rolls_the_claim_back(world, mock_request, db):
    db.add(_pending(world, "rex@test.com", role_id=9))
    await db.commit()
    rex = await _user(db, 97, "rex@test.com")
    inv = await _row(db, "rex@test.com")
    with join_side_effects(), patch.object(apply, "_grant_courses", AsyncMock(side_effect=RuntimeError("course table locked"))):
        with pytest.raises(RuntimeError):
            await apply.accept_invitation(mock_request, db, rex, world.org, inv, via="t")
    # The row in memory doesn't claim otherwise.
    assert inv.status == "pending"
    await db.commit()  # a caller that carries on
    assert (await _row(db, "rex@test.com")).status == "pending"
    assert await _membership(db, 97, world.org.id) is None


async def test_re_inviting_or_changing_the_role_retires_the_copied_link(world, mock_request, db):
    token, inv = await _token_for(world, mock_request, db, "sue@test.com", delivery="copied")
    assert inv.copy_token_hash is not None
    await _invite(world, mock_request, db, "sue@test.com", role_id=9)
    await db.refresh(inv)
    assert inv.copy_token_hash is None and inv.role_id == 9
    assert await apply.invitation_by_token(db, token) is None

    await service.invitation_link(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
    await db.refresh(inv)
    copied = inv.copy_token_hash
    # A plain resend keeps it; a role change doesn't.
    await service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(), world.admin)
    await db.refresh(inv)
    assert inv.copy_token_hash == copied
    await service.update_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationUpdate(role_id=4), world.admin)
    await db.refresh(inv)
    assert inv.copy_token_hash is None
    # Nor do group or course changes.
    for update in (service.InvitationUpdate(usergroup_ids=[1]), service.InvitationUpdate(course_uuids=["course_test"])):
        await service.invitation_link(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
        await service.update_invitation(mock_request, db, world.org.id, inv.invitation_uuid, update, world.admin)
        await db.refresh(inv)
        assert inv.copy_token_hash is None


async def _verify(mock_request, db, redis, user):
    from src.services.users.email_verification import verify_email_token

    _verification_token(redis, user)
    with join_side_effects(), patch("src.security.auth.revoke_user_sessions_before"):
        return await verify_email_token(mock_request, db, "tok", user.user_uuid, "none")


async def test_an_invitation_sent_after_the_signup_still_drops_the_password(world, mock_request, db, redis):
    from src.db.users import UserCreate
    from src.services.users.users import create_user_without_org

    with signup_side_effects():
        created = await create_user_without_org(mock_request, db, AnonymousUser(), UserCreate(email="late@test.com", username="lateuser", password="Blue river 42!"))
    user = await db.get(User, created.id)
    assert user.email_verified_at is None  # nothing waited at signup
    db.add(_pending(world, "late@test.com", role_id=9))
    await db.commit()
    verified, message = await _verify(mock_request, db, redis, user)
    assert message == "Email verified. Set a new password to sign in with one."
    assert verified.password == ""
    assert (await _membership(db, user.id, world.org.id)).role_id == 9


async def test_changing_the_email_to_an_invited_address_drops_the_password_on_proof(world, mock_request, db, redis):
    from src.db.users import UserUpdate
    from src.services.admin.admin import update_user_profile
    from src.services.users.users import update_user

    db.add(_pending(world, "boss@test.com", role_id=1))
    db.add(_pending(world, "chief@test.com", role_id=1))
    await db.commit()

    # Self-service change.
    with patch("src.services.users.users.rbac_check", new_callable=AsyncMock), patch(
        "src.services.users.users._require_reauth_for_email_change", new_callable=AsyncMock
    ), patch("src.services.users.users._after_email_change", new_callable=AsyncMock):
        await update_user(mock_request, db, world.regular.id, world.regular, UserUpdate(
            username=world.regular.username, first_name="R", last_name="U", email="boss@test.com",
        ))
    me = await db.get(User, world.regular.id)
    assert me.password and me.email_verified is False
    verified, message = await _verify(mock_request, db, redis, me)
    assert message.startswith("Email verified. Set a new password") and verified.password == ""
    assert (await _membership(db, me.id, world.org.id)).role_id == 1

    # An org's API token changing a member's address.
    member = await _user(db, 98, "member@test.com", world.other_org, 4)
    token = APITokenUser(org_id=world.other_org.id, rights=ADMIN_RIGHTS.model_dump(), created_by_user_id=world.admin.id)
    await update_user_profile(token, member.id, {"email": "chief@test.com"}, db)
    member = await db.get(User, 98)
    verified, message = await _verify(mock_request, db, redis, member)
    assert message.startswith("Email verified. Set a new password") and verified.password == ""
    assert (await _membership(db, 98, world.org.id)).role_id == 1


async def test_a_negated_domain_never_makes_an_unproven_address_addable(world, mock_request, db):
    from src.services.usergroups import rules

    await _user(db, 99, "x@school.edu", world.org, 4)
    await _unproven(db, 99)
    not_school = {"match": "all", "conditions": [{"type": "email_domain", "values": ["school.edu"], "negate": True}]}
    assert 99 not in await rules.evaluate(db, world.org.id, not_school, members={99}, proven_only=True)


def test_redis_lookups_take_the_address_literally(redis):
    redis.set("invited_user:ab@x.com:org:org_1", json.dumps({"pending": True}))
    redis.set("invited_user:a*@x.com:org:org_2", json.dumps({"pending": True}))
    assert set(hub._pending_records("a*@x.com")) == {"org_2"}
    assert hub._glob_escape("a?[b]\\c") == "a\\?\\[b\\]\\\\c"



# ---------------------------------------------------------------------------
# E1-E5. Reset keeps the invitation, emails in the org's words
# ---------------------------------------------------------------------------


async def test_a_platform_reset_keeps_where_the_person_was_going(world, mock_request, db, redis):
    from src.services.users import password_reset
    from src.services.users.emails import _reset_url

    with patch.object(password_reset, "_get_redis_connection", return_value=redis), patch.object(
        password_reset, "_enforce_send_ip_rate_limit"
    ), patch.object(password_reset, "send_password_reset_email_platform", return_value=True) as mail, patch.object(
        password_reset, "get_member_link_base_url", AsyncMock(return_value="https://platform.test")
    ):
        await password_reset.send_reset_password_code_platform(mock_request, db, AnonymousUser(), "admin@test.com", next_path="/signup?invite=abc")
        # Anything that could leave the host is dropped.
        await password_reset.send_reset_password_code_platform(mock_request, db, AnonymousUser(), "admin@test.com", next_path="//evil.test")
    assert mail.call_args_list[0].kwargs["next_path"] == "/signup?invite=abc"
    assert mail.call_args_list[1].kwargs["next_path"] is None
    stored = {json.loads(redis.get(k)).get("next") for k in redis.scan_iter("pwd_reset:*")}
    assert stored == {"/signup?invite=abc", None}
    assert _reset_url("https://p.test", "a@x", "C0DE", "/signup?invite=abc").endswith("&next=%2Fsignup%3Finvite%3Dabc")

    codes = {json.loads(redis.get(k)).get("next"): json.loads(redis.get(k))["reset_code"] for k in redis.scan_iter("pwd_reset:*")}
    with patch.object(password_reset, "_get_redis_connection", return_value=redis), patch.object(password_reset, "_invalidate_reset_codes"):
        done = await password_reset.change_password_with_reset_code_platform(
            mock_request, db, AnonymousUser(), "Blue river 42!", "admin@test.com", codes["/signup?invite=abc"],
        )
        plain = await password_reset.change_password_with_reset_code_platform(
            mock_request, db, AnonymousUser(), "Blue river 43!", "admin@test.com", codes[None],
        )
    assert done == {"detail": "Password changed", "next": "/signup?invite=abc"}
    assert plain == "Password changed"


async def test_the_platform_reset_endpoint_takes_next(world, mock_request, db):
    from src.routers.users import router as users_router

    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    with patch("src.routers.users.check_password_reset_rate_limit", return_value=(True, 0)), patch(
        "src.routers.users.send_reset_password_code_platform", AsyncMock(return_value="sent")
    ) as send:
        await _post(app, "/api/v1/users/reset_password/platform/send_reset_code", {"email": "a@test.com", "next": "/signup?invite=abc"})
    assert send.await_args.kwargs == {"next_path": "/signup?invite=abc"}


async def test_an_invitees_platform_emails_speak_the_orgs_language(world, mock_request, db, redis):
    from src.services.users.email_verification import invitee_email_branding, send_verification_email

    config = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == world.org.id))).scalars().one()
    config.config = {**config.config, "customization": {"general": {"default_language": "fr"}}}
    db.add(config)
    db.add(_pending(world, "eloi@test.com"))
    await db.commit()
    eloi = await _user(db, 100, "eloi@test.com")
    with patch("src.services.orgs.orgs.get_org_default_language", return_value="fr"), patch(
        "src.services.email.pipeline.deliver_message", return_value=True
    ) as sent:
        await send_verification_email(mock_request, db, eloi, world.org.id, next_path="/signup?invite=x")
    body = sent.call_args.kwargs["body"]
    assert world.org.name in body and "/verify-email?" in body and "org=none" in body
    assert 'lang="fr"' in body
    # Not invited: the plain platform email.
    stranger = await _user(db, 101, "stranger@test.com")
    assert await invitee_email_branding(mock_request, db, stranger.email, world.org) == {}


def test_every_button_has_its_translated_fallback_line():
    from src.services.email.translations import SUPPORTED_LANGUAGES, t

    for lang in SUPPORTED_LANGUAGES:
        assert t(lang, "common.copy_paste") == t(lang, "email_verification.copy_paste")
    with patch("src.services.email.pipeline.deliver_message", return_value=True) as sent:
        from src.services.users.emails import send_invitation_email

        send_invitation_email("a@x.y", "Acme", "bob", "https://x/signup", lang="fr", role_name="Apprenant")
    assert "Ou copiez et collez ce lien" in sent.call_args.kwargs["body"]
    assert "paste this link" not in sent.call_args.kwargs["body"].lower()


async def test_built_in_roles_are_named_as_the_app_names_them(world, mock_request, db):
    from src.db.roles import Role

    assert service.role_label(await db.get(Role, 4), "en") == "Learner"
    assert service.role_label(await db.get(Role, 4), "fr") == "Apprenant"
    assert service.role_label(await db.get(Role, 1), "de") == "Admin"
    assert service.role_label(await db.get(Role, 9), "fr") == "Learner Plus"  # a custom role
    assert service.role_label(None, "en") is None


async def test_a_full_org_tells_the_invitee_in_their_words(world, mock_request, db):
    full = HTTPException(403, "Usage Limit has been reached for Members. Your plan includes 10 members. upgrade to add more.")
    db.add(_pending(world, "tom@test.com"))
    await db.commit()
    tom = await _user(db, 102, "tom@test.com")
    with patch("src.security.features_utils.usage.check_limits_with_usage", AsyncMock(side_effect=full)):
        with pytest.raises(HTTPException) as exc:
            await apply.accept_invitation(mock_request, db, tom, world.org, await _row(db, "tom@test.com"), via="t")
        with pytest.raises(HTTPException) as legacy:
            await hub.join_from_invite(mock_request, db, tom, world.org, join_method="t")
    assert exc.value.detail == apply.INVITEE_ORG_FULL == legacy.value.detail
    assert exc.value.detail["code"] == "MEMBER_LIMIT_REACHED" and exc.value.detail["invitee"] is True
    # Anything else passes through untouched.
    other = HTTPException(404, "Organization has no config")
    with patch("src.security.features_utils.usage.check_limits_with_usage", AsyncMock(side_effect=other)):
        with pytest.raises(HTTPException) as passthrough:
            await apply.check_room_for_invitee(world.org.id, db)
    assert passthrough.value is other

    # Signing up from the emailed link into a full org.
    token, _inv = await _token_for(world, mock_request, db, "una@test.com")
    with signup_side_effects() as side, join_side_effects():
        side["check_limits_with_usage"].side_effect = full
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
        side["check_limits_with_usage"].side_effect = other
        res2 = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.status_code == 403 and res.json()["detail"]["invitee"] is True
    assert res2.status_code == 404
