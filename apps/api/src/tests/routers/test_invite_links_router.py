"""/api/v1/invite-links: the personal link in an invitation email.

Pins the security rules: the token is single use, expires, is bound to the
invited address and org, only the newest link for an invitation works, and a
withdrawn or answered invitation kills it. Following the link proves the inbox,
so a new account starts verified; an existing account must be signed in as the
invited address.
"""

import json
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock, patch

import fakeredis
import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User
from src.routers.invite_links import router as invite_links_router
from src.security.auth import get_current_user
from src.services.onboarding import invite_links

BASE = "/api/v1/invite-links"
EMAIL = "invitee@example.com"
TTL = 3600


@pytest.fixture
def fake_redis():
    r = fakeredis.FakeRedis()
    with patch("src.core.redis.get_redis_client", return_value=r), patch(
        "src.services.security.rate_limiting.get_redis_connection", return_value=r
    ):
        yield r


@pytest.fixture
def make_app(db, fake_redis):
    def build(user=None):
        app = FastAPI()
        app.include_router(invite_links_router, prefix=BASE)
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user or AnonymousUser()
        return app

    return build


async def call(app, path: str, body: dict):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(BASE + path, json=body)


def invite(r, org, email=EMAIL, code_uuid=None, pending=True):
    """What invite_batch_users stores: the link record and the invite record."""
    token, digest = invite_links.create_invite_link(r, email, org.id, org.org_uuid, code_uuid, TTL)
    r.set(
        f"invited_user:{email}:org:{org.org_uuid}",
        json.dumps({"email": email, "org_id": org.id, "invite_code_uuid": code_uuid, "pending": pending, "link_hash": digest}),
        ex=TTL,
    )
    return token, digest


@contextmanager
def signup_side_effects(mode="saas"):
    """Silence email, analytics, quota and webhooks around create_user."""
    stack = ExitStack()
    mocks = {}
    for target, kwargs in [
        ("src.services.users.users.check_limits_with_usage", {"new_callable": AsyncMock}),
        ("src.services.users.users.increase_feature_usage", {"new_callable": AsyncMock}),
        ("src.services.users.users.track", {"new_callable": AsyncMock}),
        ("src.services.users.users.dispatch_webhooks", {"new_callable": AsyncMock}),
        ("src.services.users.users.send_account_creation_email", {}),
        ("src.services.users.email_verification.send_verification_email", {"new_callable": AsyncMock}),
        ("src.services.users.users.get_deployment_mode", {"return_value": mode}),
        ("src.services.users.users.authorization_verify_based_on_roles_and_authorship", {"new_callable": AsyncMock}),
        ("src.services.feature_notifications.notify_member_joined", {"new_callable": AsyncMock}),
        ("src.services.users.users.rbac_check", {"new_callable": AsyncMock}),
    ]:
        mocks[target.rsplit(".", 1)[1]] = stack.enter_context(patch(target, **kwargs))
    with stack:
        yield mocks


@contextmanager
def join_side_effects():
    with patch("src.routers.users._invalidate_session_cache"), patch(
        "src.services.orgs.join_notifications.notify_user_joined_org", new=AsyncMock()
    ), patch("src.security.features_utils.usage.check_limits_with_usage", new=AsyncMock()), patch(
        "src.security.features_utils.usage.increase_feature_usage", new=AsyncMock()
    ), patch("src.services.analytics.analytics.track", new=AsyncMock()):
        yield


async def add_user(db, uid=20, email=EMAIL, verified=True):
    db.add(User(
        id=uid, username=f"u{uid}", first_name="In", last_name="Vitee", email=email, password="x",
        user_uuid=f"user_{uid}", email_verified=verified,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    return PublicUser(id=uid, username=f"u{uid}", first_name="In", last_name="Vitee", email=email, user_uuid=f"user_{uid}")


class TestPeek:
    async def test_names_the_org_and_address(self, make_app, org, fake_redis):
        token, _ = invite(fake_redis, org)
        res = await call(make_app(), "/peek", {"token": token})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["email"] == EMAIL and body["account_exists"] is False
        assert body["org"] == {"id": org.id, "org_uuid": "org_test", "slug": "test-org", "name": "Test Org", "logo_image": org.logo_image}

    async def test_says_when_an_account_exists(self, make_app, db, org, fake_redis):
        await add_user(db, email="Invitee@Example.com")
        token, _ = invite(fake_redis, org)
        assert (await call(make_app(), "/peek", {"token": token})).json()["account_exists"] is True

    @pytest.mark.parametrize("token", ["short", "x" * 40 + "!", "a" * 200])
    async def test_malformed_tokens_are_refused(self, make_app, org, fake_redis, token):
        res = await call(make_app(), "/peek", {"token": token})
        assert res.status_code in (404, 422)

    async def test_unknown_token(self, make_app, org, fake_redis):
        res = await call(make_app(), "/peek", {"token": "A" * 43})
        assert res.status_code == 404 and res.json()["detail"]["code"] == "INVITE_LINK_INVALID"

    async def test_expired_even_if_redis_kept_it(self, make_app, org, fake_redis):
        token, digest = invite(fake_redis, org)
        rec = json.loads(fake_redis.get(f"invite_link:{digest}"))
        rec["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        fake_redis.set(f"invite_link:{digest}", json.dumps(rec))
        assert (await call(make_app(), "/peek", {"token": token})).status_code == 404

    async def test_corrupt_record(self, make_app, org, fake_redis):
        token, digest = invite(fake_redis, org)
        fake_redis.set(f"invite_link:{digest}", "{not json")
        assert (await call(make_app(), "/peek", {"token": token})).status_code == 404
        fake_redis.set(f"invite_link:{digest}", json.dumps({"email": EMAIL}))
        assert (await call(make_app(), "/peek", {"token": token})).status_code == 404

    async def test_withdrawn_answered_or_replaced_invitation_kills_the_link(self, make_app, org, fake_redis):
        token, _ = invite(fake_redis, org)
        key = f"invited_user:{EMAIL}:org:{org.org_uuid}"
        app = make_app()
        fake_redis.delete(key)  # withdrawn by the admin
        assert (await call(app, "/peek", {"token": token})).status_code == 404
        token, _ = invite(fake_redis, org, pending=False)  # already answered
        assert (await call(app, "/peek", {"token": token})).status_code == 404
        old, _ = invite(fake_redis, org)
        new, _ = invite(fake_redis, org)  # re-invited: only the newest link works
        assert (await call(app, "/peek", {"token": old})).status_code == 404
        assert (await call(app, "/peek", {"token": new})).status_code == 200

    async def test_missing_or_demo_org(self, make_app, db, org, fake_redis):
        token, digest = invite(fake_redis, org)
        org.is_demo = True
        db.add(org)
        await db.commit()
        assert (await call(make_app(), "/peek", {"token": token})).status_code == 404
        rec = json.loads(fake_redis.get(f"invite_link:{digest}"))
        rec["org_uuid"] = "org_gone"
        fake_redis.set(f"invite_link:{digest}", json.dumps(rec))
        fake_redis.set(f"invited_user:{EMAIL}:org:org_gone", json.dumps({"pending": True, "link_hash": digest}))
        assert (await call(make_app(), "/peek", {"token": token})).status_code == 404

    async def test_redis_down(self, make_app, org):
        with patch("src.core.redis.get_redis_client", return_value=None):
            res = await call(make_app(), "/peek", {"token": "A" * 43})
        assert res.status_code == 503

    async def test_rate_limited_per_ip(self, make_app, org, fake_redis):
        app = make_app()
        with patch.dict("src.routers.invite_links.LIMITS", {"peek": (2, 600)}):
            codes = [(await call(app, "/peek", {"token": "A" * 43})).status_code for _ in range(3)]
        assert codes == [404, 404, 429]

    async def test_rate_limit_fails_open(self, make_app, org, fake_redis):
        with patch("src.services.security.rate_limiting.check_rate_limit", side_effect=RuntimeError("down")):
            assert (await call(make_app(), "/peek", {"token": "A" * 43})).status_code == 404


class TestSignup:
    async def test_creates_a_verified_member_and_uses_up_the_link(self, make_app, db, org, user_role, fake_redis):
        token, digest = invite(fake_redis, org)
        app = make_app()
        with signup_side_effects() as m, patch("src.routers.users._enforce_signup_rate_limit"):
            res = await call(app, "/signup", {"token": token, "password": "blue river 42", "first_name": " Ada ", "last_name": ""})
        assert res.status_code == 200, res.text
        assert res.json() == {"email": EMAIL, "org": {"id": 1, "org_uuid": "org_test", "slug": "test-org", "name": "Test Org", "logo_image": org.logo_image}}
        user = (await db.execute(select(User).where(User.email == EMAIL))).scalars().one()
        assert user.email_verified is True and user.first_name == "Ada"
        assert user.username.startswith("invitee") and user.password != "blue river 42"
        member = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == user.id))).scalars().one()
        assert member.org_id == org.id and member.role_id == 4
        # Welcome email, no verification email: the link proved the inbox.
        m["send_account_creation_email"].assert_called_once()
        m["send_verification_email"].assert_not_awaited()
        assert fake_redis.get(f"invite_link:{digest}") is None
        assert json.loads(fake_redis.get(f"invited_user:{EMAIL}:org:org_test"))["pending"] is False
        assert fake_redis.get(f"invite_link_claim:{digest}") is None
        # Single use.
        assert (await call(app, "/signup", {"token": token, "password": "blue river 42"})).status_code == 404

    async def test_weak_password_keeps_the_link(self, make_app, org, fake_redis):
        token, digest = invite(fake_redis, org)
        with signup_side_effects(), patch("src.routers.users._enforce_signup_rate_limit"):
            res = await call(make_app(), "/signup", {"token": token, "password": "short"})
        assert res.status_code == 400 and res.json()["detail"]["code"] == "WEAK_PASSWORD"
        assert fake_redis.get(f"invite_link:{digest}") is not None
        assert fake_redis.get(f"invite_link_claim:{digest}") is None

    async def test_joins_the_invite_codes_group(self, make_app, db, org, user_role, fake_redis):
        fake_redis.set(f"code_1:org:{org.org_uuid}:code:ABC", json.dumps({"usergroup_id": 7}))
        token, _ = invite(fake_redis, org, code_uuid="code_1")
        add = AsyncMock()
        with signup_side_effects(), patch("src.routers.users._enforce_signup_rate_limit"), patch(
            "src.services.users.usergroups.add_users_to_usergroup", new=add
        ):
            assert (await call(make_app(), "/signup", {"token": token, "password": "blue river 42"})).status_code == 200
        assert add.await_args.args[3] == 7

    async def test_group_failure_does_not_fail_the_signup(self, make_app, org, user_role, fake_redis):
        fake_redis.set(f"code_1:org:{org.org_uuid}:code:ABC", json.dumps({"usergroup_id": 7}))
        token, _ = invite(fake_redis, org, code_uuid="code_1")
        with signup_side_effects(), patch("src.routers.users._enforce_signup_rate_limit"), patch(
            "src.services.users.usergroups.add_users_to_usergroup", new=AsyncMock(side_effect=HTTPException(400))
        ):
            assert (await call(make_app(), "/signup", {"token": token, "password": "blue river 42"})).status_code == 200

    async def test_existing_account_must_sign_in(self, make_app, db, org, fake_redis):
        await add_user(db)
        token, _ = invite(fake_redis, org)
        with patch("src.routers.users._enforce_signup_rate_limit"):
            res = await call(make_app(), "/signup", {"token": token, "password": "blue river 42"})
        assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_EXISTS"

    async def test_one_redemption_at_a_time(self, make_app, org, fake_redis):
        token, digest = invite(fake_redis, org)
        fake_redis.set(f"invite_link_claim:{digest}", "1")
        with patch("src.routers.users._enforce_signup_rate_limit"):
            res = await call(make_app(), "/signup", {"token": token, "password": "blue river 42"})
        assert res.status_code == 409 and res.json()["detail"]["code"] == "INVITE_LINK_IN_USE"

    async def test_org_that_refuses_password_accounts(self, make_app, org, fake_redis):
        token, _ = invite(fake_redis, org)
        with patch("src.routers.users._enforce_signup_rate_limit"), patch(
            "src.routers.users._enforce_password_signup_allowed", new=AsyncMock(side_effect=HTTPException(403, "no passwords"))
        ):
            res = await call(make_app(), "/signup", {"token": token, "password": "blue river 42"})
        assert res.status_code == 403

    async def test_signup_rate_limit_applies(self, make_app, org, fake_redis):
        with patch("src.routers.users._enforce_signup_rate_limit", side_effect=HTTPException(429, "slow down")):
            res = await call(make_app(), "/signup", {"token": "A" * 43, "password": "x"})
        assert res.status_code == 429


class TestUsername:
    async def test_short_local_part_is_padded(self, db, org):
        assert (await invite_links._username_for(db, "al@x.com")).startswith("aluser")

    async def test_falls_back_when_every_try_is_taken(self, db, org):
        taken = Mock()
        taken.first = Mock(return_value=(1,))
        with patch.object(db, "execute", new=AsyncMock(return_value=taken)):
            name = await invite_links._username_for(db, "invitee@x.com")
        assert name.startswith("invitee") and len(name) == len("invitee") + 8


class TestAccept:
    async def test_requires_a_session(self, make_app, org, fake_redis):
        token, _ = invite(fake_redis, org)
        assert (await call(make_app(), "/accept", {"token": token})).status_code == 401

    async def test_refuses_impersonation_and_lms_sessions(self, make_app, db, org, fake_redis):
        me = await add_user(db)
        token, _ = invite(fake_redis, org)
        with patch("src.security.session_context.refuse_lms_session", side_effect=HTTPException(403, "no")):
            assert (await call(make_app(me), "/accept", {"token": token})).status_code == 403

    async def test_joins_when_signed_in_as_the_invited_address(self, make_app, db, org, user_role, fake_redis):
        me = await add_user(db, email="INVITEE@example.com")
        token, digest = invite(fake_redis, org)
        with join_side_effects():
            res = await call(make_app(me), "/accept", {"token": token})
        assert res.status_code == 200, res.text
        assert res.json()["already_member"] is False and res.json()["org"]["slug"] == "test-org"
        assert (await db.execute(select(UserOrganization).where(UserOrganization.user_id == me.id))).scalars().one().role_id == 4
        assert fake_redis.get(f"invite_link:{digest}") is None
        with join_side_effects():
            assert (await call(make_app(me), "/accept", {"token": token})).status_code == 404

    async def test_wrong_address_is_refused_and_keeps_the_link(self, make_app, db, org, fake_redis):
        me = await add_user(db, email="someone.else@example.com")
        token, digest = invite(fake_redis, org)
        res = await call(make_app(me), "/accept", {"token": token})
        assert res.status_code == 403 and res.json()["detail"]["code"] == "INVITE_EMAIL_MISMATCH"
        assert fake_redis.get(f"invite_link:{digest}") is not None

    async def test_the_link_verifies_an_unverified_address(self, make_app, db, org, user_role, fake_redis):
        me = await add_user(db, verified=False)
        token, _ = invite(fake_redis, org)
        drop = AsyncMock()
        with join_side_effects(), patch("src.services.auth.utils._drop_unverified_sso_links", new=drop):
            assert (await call(make_app(me), "/accept", {"token": token})).status_code == 200
        user = (await db.execute(select(User).where(User.id == me.id))).scalars().one()
        assert user.email_verified is True and user.email_verified_at
        drop.assert_awaited_once()

    async def test_already_member_just_uses_up_the_link(self, make_app, db, org, user_role, fake_redis):
        me = await add_user(db)
        db.add(UserOrganization(user_id=me.id, org_id=org.id, role_id=4, creation_date="x", update_date="x"))
        await db.commit()
        token, digest = invite(fake_redis, org, code_uuid="code_1")
        res = await call(make_app(me), "/accept", {"token": token})
        assert res.status_code == 200 and res.json()["already_member"] is True
        assert fake_redis.get(f"invite_link:{digest}") is None
        assert json.loads(fake_redis.get(f"invited_user:{EMAIL}:org:org_test"))["pending"] is False

    async def test_user_row_gone(self, make_app, org, fake_redis):
        token, _ = invite(fake_redis, org)
        ghost = PublicUser(id=999, username="g", first_name="G", last_name="G", email=EMAIL, user_uuid="user_g")
        assert (await call(make_app(ghost), "/accept", {"token": token})).status_code == 404
