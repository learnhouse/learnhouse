"""Regression tests for the invitation security review (each failed before
its fix).

1. A link the admin copied doesn't prove the invitee's inbox.
2. A self-hosted account marked verified without proof can't see, accept or
   decline invitations to its address.
3. An invite code's use cap holds: the use is counted before the membership.
4. Leftover invitations never change an existing member's role behind their
   back, and close when the address joins another way.
5. The org row is locked around the capacity check; codes only carry roles
   within the built-in User role; revoking needs the right to grant the role.
"""

from datetime import timedelta
from unittest.mock import AsyncMock, patch

import fakeredis
import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.org_invitations import OrgInvitation, OrgInviteCode
from src.db.users import User
from src.services.onboarding import hub, invite_links
from src.services.onboarding import invites as hub_invites
from src.services.orgs.invitations import apply, codes, policy, service
from src.tests.conftest import USER_RIGHTS
from src.tests.fixtures.invitations import _code, _invite, _membership, _public, _rights, _role, _row, _user
from src.tests.routers.test_invite_links_router import join_side_effects, signup_side_effects
from src.tests.security.test_invitations_security import LINKS, _app, _post, _token_for

pytestmark = pytest.mark.usefixtures("quiet")


@pytest.fixture(autouse=True)
def no_rate_limits():
    with patch("src.routers.invite_links._limit"), patch("src.routers.users._enforce_signup_rate_limit"):
        yield


async def _unproven(db, user_id):
    """A self-hosted signup: verified flag on, nothing proved the inbox."""
    user = await db.get(User, user_id)
    user.email_verified = True
    user.email_verified_at = ""
    db.add(user)
    await db.commit()
    return user


def _pending(world, email, role_id=4, **kw):
    now = policy.utcnow()
    return OrgInvitation(
        invitation_uuid=f"invitation_{email}_{role_id}", org_id=world.org.id, email=email, role_id=role_id,
        invited_by_user_id=world.admin.id, expires_at=now + timedelta(days=3), created_at=now, updated_at=now,
        token_delivery="email", **kw,
    )


# ---------------------------------------------------------------------------
# 1. Copied links prove nothing about the inbox
# ---------------------------------------------------------------------------


async def test_copied_link_signup_creates_an_unverified_account_and_waits(world, mock_request, db):
    token, inv = await _token_for(world, mock_request, db, "ceo@bigcorp.com", delivery="copied", role_id=3)
    assert inv.token_delivery == "copied"
    peek = await _post(_app(db), f"{LINKS}/peek", {"token": token})
    assert peek.json()["invitation"]["proves_inbox"] is False

    with signup_side_effects() as side, join_side_effects():
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.status_code == 200, res.text
    assert res.json()["verification_required"] is True
    user = (await db.execute(select(User).where(User.email == "ceo@bigcorp.com"))).scalars().one()
    # SaaS: the account waits for its verification email; no membership, no role.
    assert user.email_verified is False
    side["send_verification_email"].assert_awaited_once()
    assert await _membership(db, user.id, world.org.id) is None
    await db.refresh(inv)
    assert inv.status == "pending"

    # Signed in but still unverified: the copied link can't be accepted.
    app = _app(db, _public(user))
    with join_side_effects():
        refused = await _post(app, f"{LINKS}/accept", {"token": token})
    assert refused.status_code == 403 and refused.json()["detail"]["code"] == "INVITE_VERIFY_EMAIL"
    await db.refresh(user)
    assert user.email_verified is False

    # Once the email is verified, accepting through the same link works.
    user.email_verified = True
    user.email_verified_at = policy.utcnow().isoformat()
    db.add(user)
    await db.commit()
    with join_side_effects():
        ok = await _post(app, f"{LINKS}/accept", {"token": token})
    assert ok.status_code == 200, ok.text
    assert (await _membership(db, user.id, world.org.id)).role_id == 3


async def test_copied_link_on_self_hosted_sends_a_proof_request(world, mock_request, db):
    token, _inv = await _token_for(world, mock_request, db, "new@self.host", delivery="copied")
    with signup_side_effects(mode="oss"), join_side_effects(), patch(
        "src.services.users.email_verification.send_verification_email", new_callable=AsyncMock
    ) as proof:
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.json()["verification_required"] is True
    user = (await db.execute(select(User).where(User.email == "new@self.host"))).scalars().one()
    # Marked verified without an email round trip, so a proof request goes out.
    assert user.email_verified is True and user.email_verified_at == ""
    proof.assert_awaited_once()
    assert proof.await_args.args[3] == world.org.id

    # A failure to send never fails the signup.
    with patch("src.services.users.email_verification.send_verification_email", AsyncMock(side_effect=RuntimeError("smtp"))):
        await invite_links._send_proof_request(mock_request, db, user.id, world.org)
    await invite_links._send_proof_request(mock_request, db, 999, world.org)


async def test_resending_by_email_restores_the_proof(world, mock_request, db):
    _token, inv = await _token_for(world, mock_request, db, "lea@test.com", delivery="copied")
    await service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(), world.admin)
    await db.refresh(inv)
    assert inv.token_delivery == "email"
    token = service._send_email.await_args.args[5]
    with signup_side_effects(), join_side_effects():
        res = await _post(_app(db), f"{LINKS}/signup", {"token": token, "password": "blue river 42"})
    assert res.json()["verification_required"] is False
    user = (await db.execute(select(User).where(User.email == "lea@test.com"))).scalars().one()
    assert user.email_verified is True


# ---------------------------------------------------------------------------
# 2. Self-hosted accounts with an unproven inbox
# ---------------------------------------------------------------------------


async def test_unproven_self_hosted_account_cannot_claim_invitations(world, mock_request, db):
    db.add(_pending(world, "regular@test.com", role_id=1))
    await db.commit()
    await _user(db, 80, "boss@test.com")
    db.add(_pending(world, "boss@test.com", role_id=1))
    await db.commit()
    boss = await _unproven(db, 80)

    assert await hub_invites.list_pending_invites(db, 80) == []
    for call in (hub_invites.accept_invite(mock_request, db, 80, world.org.org_uuid), hub_invites.decline_invite(db, 80, world.org.org_uuid)):
        with pytest.raises(HTTPException) as exc:
            await call
        assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await apply.accept_invitation(mock_request, db, boss, world.org, await _row(db, "boss@test.com"), via="hub")
    assert exc.value.status_code == 404
    summary = await hub.hub_summary(db, 80)
    assert summary["email_verified"] is False and summary["invites"] == []

    # The emailed personal link is itself the proof.
    inv = await _row(db, "boss@test.com")
    token, digest = policy.mint_token()
    inv.token_hash = digest
    db.add(inv)
    await db.commit()
    with join_side_effects():
        res = await _post(_app(db, _public(boss)), f"{LINKS}/accept", {"token": token})
    assert res.status_code == 200, res.text
    await db.refresh(boss)
    assert boss.email_verified_at != ""
    assert (await _membership(db, 80, world.org.id)).role_id == 1


async def test_verification_email_proves_a_self_hosted_inbox(world, mock_request, db):
    from src.services.users.email_verification import resend_verification_email, verify_email_token

    await _user(db, 81, "self@test.com")
    user = await _unproven(db, 81)
    redis = fakeredis.FakeRedis()
    with patch("src.services.users.email_verification.get_redis_connection", return_value=redis), patch(
        "src.services.users.email_verification.send_verification_email", new_callable=AsyncMock
    ) as send, patch("src.services.users.email_verification.check_verification_resend_rate_limit", return_value=(True, 0)):
        await resend_verification_email(mock_request, db, "self@test.com")
    send.assert_awaited_once()

    import json

    token = "tok123"
    redis.set(
        f"email_verification:{user.user_uuid}:org:none:token:{token}",
        json.dumps({"user_uuid": user.user_uuid, "email": user.email, "expires_at": policy.utcnow().timestamp() + 600}),
    )
    with patch("src.services.users.email_verification.get_redis_connection", return_value=redis):
        verified, _msg = await verify_email_token(mock_request, db, token, user.user_uuid, "none")
    assert verified.email_verified_at != ""
    assert await hub_invites.list_pending_invites(db, 81) == []  # nothing pending, but no longer refused


async def test_open_join_with_an_unproven_inbox_is_a_plain_join(world, mock_request, db):
    from src.services.orgs.join import JoinOrg, join_org
    from src.tests.routers.test_auth_invitations_v2 import _signup_mode

    await _signup_mode(db, world.org, "open")
    await _user(db, 82, "maybe@test.com")
    user = await _unproven(db, 82)
    db.add(_pending(world, "maybe@test.com", role_id=1))
    await db.commit()
    with join_side_effects(), patch("src.services.orgs.join.increase_feature_usage", new=AsyncMock()), patch(
        "src.services.orgs.join.notify_user_joined_org", new=AsyncMock()
    ):
        await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=82), _public(user), db)
    assert (await _membership(db, 82, world.org.id)).role_id == 4
    # The invitation stays pending: an unproven signup can't cancel the real
    # person's invite, and can't claim it either.
    inv = await _row(db, "maybe@test.com")
    assert inv.status == "pending"
    with pytest.raises(HTTPException):
        await apply.accept_invitation(mock_request, db, user, world.org, inv, via="hub")


# ---------------------------------------------------------------------------
# 3. Invite code use caps
# ---------------------------------------------------------------------------


async def test_code_cap_is_counted_before_the_membership(world, mock_request, db):
    from src.services.orgs.join import JoinOrg, join_org
    from src.services.users.users import create_user_with_invite
    from src.db.users import UserCreate, AnonymousUser
    from src.tests.routers.test_auth_invitations_v2 import _signup_mode

    await _signup_mode(db, world.org, "inviteOnly")
    code = await _code(world, mock_request, db, role_id=9, max_uses=1)
    row = (await db.execute(select(OrgInviteCode))).scalars().one()
    data = codes.as_join_data(row)
    sam = await _user(db, 83, "sam@test.com")
    # Someone else took the last use after the code was looked up.
    row.uses = 1
    db.add(row)
    await db.commit()
    with join_side_effects(), patch("src.services.orgs.join.get_invite_code", AsyncMock(return_value=data)):
        with pytest.raises(HTTPException) as exc:
            await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=83, invite_code=code["invite_code"]), _public(sam), db)
    assert exc.value.status_code == 403 and exc.value.detail["code"] == "INVITE_CODE_EXHAUSTED"
    assert await _membership(db, 83, world.org.id) is None

    with signup_side_effects(), patch("src.services.users.users.get_invite_code", AsyncMock(return_value=data)):
        with pytest.raises(HTTPException) as exc:
            await create_user_with_invite(
                mock_request, db, AnonymousUser(),
                UserCreate(email="kim@test.com", username="kimkim", password="blue river 42"), world.org.id, code["invite_code"],
            )
    assert exc.value.status_code == 403
    assert (await db.execute(select(User).where(User.email == "kim@test.com"))).scalars().first() is None

    # With a use left, joining counts it once (not again when applying).
    row.uses = 0
    db.add(row)
    await db.commit()
    with join_side_effects(), patch("src.services.orgs.join.get_invite_code", AsyncMock(return_value=data)), patch(
        "src.services.orgs.join.increase_feature_usage", new=AsyncMock()
    ), patch("src.services.orgs.join.notify_user_joined_org", new=AsyncMock()):
        await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=83, invite_code=code["invite_code"]), _public(sam), db)
    await db.refresh(row)
    assert row.uses == 1 and (await _membership(db, 83, world.org.id)).role_id == 9
    assert await apply.claim_code_for_join(db, None) is False
    assert await apply.claim_code_for_join(db, {"usergroup_id": 1}) is False


async def test_google_into_an_invite_only_org_with_a_used_up_code(world, mock_request, db):
    from src.tests.routers.test_auth_invitations_v2 import _google, _login, _signup_mode, _with

    await _signup_mode(db, world.org, "inviteOnly")
    code = await _code(world, mock_request, db, max_uses=1)
    row = (await db.execute(select(OrgInviteCode))).scalars().one()
    await _user(db, 84, "goo@test.com")
    data = codes.as_join_data(row)
    row.uses = 1
    db.add(row)
    await db.commit()
    with join_side_effects(), patch("src.services.orgs.invites.get_invite_code", AsyncMock(return_value=data)):
        with pytest.raises(HTTPException) as exc:
            await _with(_google(db, 84, "goo@test.com", world.org), _login(db, world.org, invite_code=code["invite_code"]))
    assert exc.value.status_code == 403
    assert await _membership(db, 84, world.org.id) is None


# ---------------------------------------------------------------------------
# 4. Existing members and leftover invitations
# ---------------------------------------------------------------------------


async def test_google_sign_in_never_changes_an_existing_members_role(world, mock_request, db):
    from src.tests.routers.test_auth_invitations_v2 import _google, _login, _with

    # The maintainer has a leftover invitation, edited down to User.
    db.add(_pending(world, "maint@test.com", role_id=4))
    await db.commit()
    with join_side_effects():
        await _with(_google(db, world.maintainer.id, "maint@test.com", world.org), _login(db, world.org))
    assert (await _membership(db, world.maintainer.id, world.org.id)).role_id == 2
    assert (await _row(db, "maint@test.com")).status == "pending"


async def test_explicit_acceptance_never_demotes(world, mock_request, db):
    # Maintainer -> Instructor takes rights away: the role stays.
    db.add(_pending(world, "maint@test.com", role_id=3))
    await db.commit()
    maint = await db.get(User, world.maintainer.id)
    maint.email_verified = True
    db.add(maint)
    await db.commit()
    with join_side_effects():
        out = await hub_invites.accept_invite(mock_request, db, world.maintainer.id, world.org.org_uuid)
    assert out["role"] is None
    assert (await _membership(db, world.maintainer.id, world.org.id)).role_id == 2

    # User -> Learner Plus (same rights) is allowed; an upgrade too.
    regular = await db.get(User, world.regular.id)
    regular.email_verified = True
    db.add(regular)
    db.add(_pending(world, "regular@test.com", role_id=3))
    await db.commit()
    with join_side_effects():
        out = await apply.accept_invitation(mock_request, db, regular, world.org, await _row(db, "regular@test.com"), via="hub")
    assert out["role"] == "Instructor"

    # An automatic path never changes an existing member's role.
    db.add(_pending(world, "regular@test.com", role_id=2))
    await db.commit()
    with join_side_effects():
        out = await apply.accept_invitation(
            mock_request, db, regular, world.org, await _row(db, "regular@test.com"), via="auto", may_change_role=False,
        )
    assert out["role"] is None and (await _membership(db, world.regular.id, world.org.id)).role_id == 3


async def test_joining_another_way_closes_pending_invitations(world, mock_request, db):
    from src.services.orgs.join import JoinOrg, join_org
    from src.tests.routers.test_auth_invitations_v2 import _signup_mode

    # An invite code join.
    await _signup_mode(db, world.org, "inviteOnly")
    code = await _code(world, mock_request, db)
    token, inv = await _token_for(world, mock_request, db, "zoe@test.com", role_id=1)
    zoe = await _user(db, 85, "zoe@test.com")
    with join_side_effects(), patch("src.services.orgs.join.increase_feature_usage", new=AsyncMock()), patch(
        "src.services.orgs.join.notify_user_joined_org", new=AsyncMock()
    ):
        await join_org(mock_request, JoinOrg(org_id=world.org.id, user_id=85, invite_code=code["invite_code"]), _public(zoe), db)
    await db.refresh(inv)
    assert inv.status == "revoked"
    # The old emailed link no longer hands out Admin.
    with join_side_effects():
        res = await _post(_app(db, _public(zoe)), f"{LINKS}/accept", {"token": token})
    assert res.status_code == 404
    assert (await _membership(db, 85, world.org.id)).role_id == 4

    # A plain signup into the org (create_user without keep_invitations).
    from src.db.users import AnonymousUser, UserCreate
    from src.services.users.users import create_user

    db.add(_pending(world, "new@test.com", role_id=1))
    await db.commit()
    with signup_side_effects():
        await create_user(mock_request, db, AnonymousUser(), UserCreate(email="new@test.com", username="newnew", password="blue river 42"), world.org.id)
    # The signup hasn't proven the address yet, so the invitation stays.
    assert (await _row(db, "new@test.com")).status == "pending"
    assert await apply.close_pending_invitations(mock_request, db, world.org.id, "new@test.com", owner_proven=False) == 0
    assert await apply.close_pending_invitations(mock_request, db, world.org.id, "new@test.com", owner_proven=True) == 1
    assert (await _row(db, "new@test.com")).status == "revoked"
    assert await apply.close_pending_invitations(mock_request, db, world.org.id, "", owner_proven=True) == 0


async def test_admin_api_provisioning_closes_pending_invitations(world, mock_request, db):
    from src.db.users import APITokenUser
    from src.services.admin import admin

    db.add(_pending(world, "prov@test.com", role_id=1))
    await db.commit()
    from src.tests.conftest import ADMIN_RIGHTS

    token = APITokenUser(org_id=world.org.id, rights=ADMIN_RIGHTS.model_dump(), created_by_user_id=world.admin.id)
    with patch("src.services.admin.admin.increase_feature_usage", new=AsyncMock()), patch(
        "src.services.admin.admin.dispatch_webhooks", new=AsyncMock()
    ), patch("src.services.admin.admin.check_limits_with_usage", new=AsyncMock()), patch(
        "src.services.admin.admin.track", new=AsyncMock()
    ):
        await admin.provision_user(token, "prov@test.com", "provuser", "", "", None, 4, mock_request, db)
    assert (await _row(db, "prov@test.com")).status == "revoked"


# ---------------------------------------------------------------------------
# 5. Locking, code roles, revoke permission
# ---------------------------------------------------------------------------


async def test_capacity_check_runs_under_an_org_lock(world, mock_request, db):
    seen = []
    real_execute = db.execute

    async def spy(statement, *args, **kwargs):
        if getattr(statement, "_for_update_arg", None) is not None:
            seen.append(statement)
        return await real_execute(statement, *args, **kwargs)

    with patch.object(db, "execute", side_effect=spy):
        await _invite(world, mock_request, db, "a@test.com")
    assert len(seen) == 1
    from sqlalchemy.dialects import postgresql

    assert "FOR UPDATE" in str(seen[0].compile(dialect=postgresql.dialect()))


async def test_codes_only_carry_roles_within_the_user_role(world, mock_request, db):
    # No management rights, but course write access: not on a code.
    await _role(db, 12, "Course Editor", _rights(USER_RIGHTS, courses={"action_update": True}), org_id=world.org.id)
    with pytest.raises(HTTPException) as exc:
        await _code(world, mock_request, db, role_id=12)
    assert exc.value.detail["code"] == "CODE_ROLE_NOT_ALLOWED"
    options = await service.invitation_options(mock_request, db, world.org.id, world.admin)
    by_id = {r["id"]: r for r in options["roles"]}
    assert by_id[12]["code_allowed"] is False and by_id[9]["code_allowed"] is True and by_id[4]["code_allowed"] is True


async def test_maintainer_cannot_revoke_an_admin_level_invitation(world, mock_request, db):
    await _invite(world, mock_request, db, "boss@test.com", role_id=1)
    inv = await _row(db, "boss@test.com")
    with pytest.raises(HTTPException) as exc:
        await service.revoke_invitation(mock_request, db, world.org.id, inv.invitation_uuid, world.maintainer)
    assert exc.value.status_code == 403
    out = await service.bulk_invitations(
        mock_request, db, world.org.id, service.InvitationBulk(action="revoke", invitation_uuids=[inv.invitation_uuid]), world.maintainer
    )
    assert out["results"][0]["status"] == "failed"
    await db.refresh(inv)
    assert inv.status == "pending"
    # A learner-level one is fine.
    await _invite(world, mock_request, db, "kid@test.com", role_id=4, user=world.maintainer)
    kid = await _row(db, "kid@test.com")
    assert (await service.revoke_invitation(mock_request, db, world.org.id, kid.invitation_uuid, world.maintainer))["status"] == "revoked"


async def test_hub_rows_carry_the_role_uuid_for_translation(world, mock_request, db):
    await _user(db, 86, "hub@test.com")
    db.add(_pending(world, "hub@test.com", role_id=4))
    await db.commit()
    rows = await hub_invites.list_pending_invites(db, 86)
    assert rows[0]["role_uuid"] == "role_user"


# ---------------------------------------------------------------------------
# Re-review: provisioning, verification, probing, third-party sign-in, roles
# ---------------------------------------------------------------------------


async def test_admin_provisioned_accounts_cannot_claim_other_orgs_invitations(world, mock_request, db):
    from src.db.users import APITokenUser
    from src.services.admin import admin
    from src.services.users.users import inbox_proven
    from src.tests.conftest import ADMIN_RIGHTS

    # Another org (the "victim") invited the address as a Maintainer.
    now = policy.utcnow()
    db.add(OrgInvitation(
        invitation_uuid="invitation_ceo", org_id=world.other_org.id, email="ceo@corp.com", role_id=2,
        expires_at=now + timedelta(days=3), created_at=now, updated_at=now, token_delivery="email",
    ))
    await db.commit()
    token = APITokenUser(org_id=world.org.id, rights=ADMIN_RIGHTS.model_dump(), created_by_user_id=world.admin.id)
    with patch("src.services.admin.admin.increase_feature_usage", new=AsyncMock()), patch(
        "src.services.admin.admin.dispatch_webhooks", new=AsyncMock()
    ), patch("src.services.admin.admin.check_limits_with_usage", new=AsyncMock()), patch(
        "src.services.admin.admin.track", new=AsyncMock()
    ):
        created = await admin.provision_user(token, "ceo@corp.com", "ceouser", "", "", "blue river 42 X!", 4, mock_request, db)
        # Attaching an existing account is refused, so nobody else's state changes.
        with pytest.raises(HTTPException) as exc:
            await admin.provision_user(token, "admin@test.com", "dupe", "", "", None, 4, mock_request, db)
        assert exc.value.status_code == 409
    user = await db.get(User, created.id)
    # Signs in to the provisioning org (verified), but the inbox isn't proven.
    assert user.email_verified is True and inbox_proven(user) is False
    assert (await _membership(db, user.id, world.org.id)).role_id == 4
    assert await hub_invites.list_pending_invites(db, user.id) == []
    with pytest.raises(HTTPException) as refused:
        await hub_invites.accept_invite(mock_request, db, user.id, world.other_org.org_uuid)
    assert refused.value.status_code == 403
    admin_row = await db.get(User, world.admin.id)
    assert admin_row.email_verified_at != ""


async def test_verification_drops_a_password_set_before_the_proof(world, mock_request, db):
    import json

    from src.services.users.email_verification import INBOX_CLAIMED, verify_email_token

    await _user(db, 90, "newhire@test.com")
    user = await _unproven(db, 90)
    assert user.password  # chosen by whoever registered the address
    redis = fakeredis.FakeRedis()
    redis.set(
        f"email_verification:{user.user_uuid}:org:none:token:tok",
        json.dumps({"user_uuid": user.user_uuid, "email": user.email, "expires_at": policy.utcnow().timestamp() + 600}),
    )
    with patch("src.services.users.email_verification.get_redis_connection", return_value=redis), patch(
        "src.security.auth.revoke_user_sessions_before"
    ) as revoke:
        verified, message = await verify_email_token(mock_request, db, "tok", user.user_uuid, "none")
    assert message == INBOX_CLAIMED
    assert verified.password == "" and verified.email_verified_at != ""
    revoke.assert_called_once_with(90)

    # No password to drop: plainly verified.
    await _user(db, 91, "nopass@test.com")
    other = await _unproven(db, 91)
    other.password = ""
    db.add(other)
    await db.commit()
    redis.set(
        f"email_verification:{other.user_uuid}:org:none:token:tok2",
        json.dumps({"user_uuid": other.user_uuid, "email": other.email, "expires_at": policy.utcnow().timestamp() + 600}),
    )
    with patch("src.services.users.email_verification.get_redis_connection", return_value=redis):
        _u, message = await verify_email_token(mock_request, db, "tok2", other.user_uuid, "none")
    assert message == "Email verified"


async def test_copied_link_peek_does_not_reveal_accounts(world, mock_request, db):
    await _user(db, 93, "outside@test.com")  # has an account, not in the org
    token, _inv = await _token_for(world, mock_request, db, "outside@test.com", delivery="copied")
    body = (await _post(_app(db), f"{LINKS}/peek", {"token": token})).json()
    assert "account_exists" not in body and body["email"] == "outside@test.com"
    emailed, _inv2 = await _token_for(world, mock_request, db, "someone@test.com")
    assert (await _post(_app(db), f"{LINKS}/peek", {"token": emailed})).json()["account_exists"] is False


async def test_unproven_third_party_sign_in_cannot_close_invitations(world, mock_request, db):
    from src.routers.auth import _apply_oauth_invites

    sam = await _user(db, 92, "sam@test.com", world.org, 4, verified=False)
    db.add(_pending(world, "sam@test.com", role_id=3))
    await db.commit()
    # No Google vouching for the address and an unproven account: nothing closes.
    await _apply_oauth_invites(mock_request, db, sam.id, world.org.id, None, google_verified_email=None, was_member=False)
    assert (await _row(db, "sam@test.com")).status == "pending"
    # The closing helper needs every caller to say whether the owner is proven.
    with pytest.raises(TypeError):
        await apply.close_pending_invitations(mock_request, db, world.org.id, "sam@test.com")


async def test_a_missing_or_foreign_current_role_is_never_upgraded_blind(world, mock_request, db):
    from src.db.roles import Role

    # Current role from another org: not an upgrade.
    assert await apply._role_is_upgrade(db, world.org.id, 10, await db.get(Role, 3)) is False
    # Current role gone: only a role within the User role may fill the gap.
    assert await apply._role_is_upgrade(db, world.org.id, 999, await db.get(Role, 3)) is False
    assert await apply._role_is_upgrade(db, world.org.id, 999, await db.get(Role, 9)) is True
    assert await apply._role_is_upgrade(db, world.org.id, None, await db.get(Role, 4)) is True
    # Same org, more rights: an upgrade.
    assert await apply._role_is_upgrade(db, world.org.id, 4, await db.get(Role, 3)) is True
