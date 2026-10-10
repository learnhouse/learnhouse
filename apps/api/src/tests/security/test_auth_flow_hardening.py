"""Regression tests for the authentication-flow hardening.

Covers: verification tokens bound to the address they were mailed to, email
change re-authentication and org-admin scope, the Google pre-hijack guard,
password-reset org scoping / single-use codes / link host, magic-link and
verification branding for non-members, two-factor session revocation, and
URL escaping in mail.
"""

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User, UserCreate, UserUpdate
from src.security.security import security_hash_password


def _public(u: User) -> PublicUser:
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


async def _make_user(db, id, email, **kw):
    u = User(
        id=id,
        username=kw.pop("username", f"user{id}"),
        first_name="First",
        last_name="Last",
        email=email,
        password=kw.pop("password", security_hash_password("CurrentPass1!")),
        user_uuid=f"user_{id}",
        email_verified=kw.pop("email_verified", True),
        signup_method=kw.pop("signup_method", "email"),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        **kw,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _join(db, user_id, org_id, role_id=4):
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=role_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


def _update(user: User, **overrides) -> UserUpdate:
    data = dict(
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
        avatar_image="",
        bio="",
        details={},
        profile={},
    )
    data.update(overrides)
    return UserUpdate(**data)


# ── Email verification ───────────────────────────────────────────────────────


class TestVerificationTokenBoundToEmail:
    async def _verify(self, db, mock_request, user, token_email):
        from src.services.users.email_verification import verify_email_token

        payload = {
            "token": "tok",
            "user_uuid": user.user_uuid,
            "org_uuid": "none",
            "email": token_email,
            "expires_at": datetime.now(timezone.utc).timestamp() + 600,
        }
        fake_redis = Mock(get=Mock(return_value=json.dumps(payload)), delete=Mock())
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            return await verify_email_token(mock_request, db, "tok", user.user_uuid, "none")

    async def test_token_for_previous_address_is_refused(self, db, mock_request):
        user = await _make_user(db, 50, "new@test.com", email_verified=False)
        with pytest.raises(HTTPException) as exc:
            await self._verify(db, mock_request, user, "old@test.com")
        assert exc.value.status_code == 400
        await db.refresh(user)
        assert user.email_verified is False

    async def test_matching_address_verifies_case_insensitively(self, db, mock_request):
        user = await _make_user(db, 51, "Mixed@Test.com", email_verified=False)
        verified, _ = await self._verify(db, mock_request, user, "mixed@test.com ")
        assert verified.email_verified is True

    async def test_invalidate_without_org_clears_every_org(self):
        from src.services.users.email_verification import invalidate_verification_tokens

        fake_redis = Mock(scan_iter=Mock(return_value=[b"k1"]), delete=Mock())
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            invalidate_verification_tokens("user_x")
        assert fake_redis.scan_iter.call_args.kwargs["match"] == "email_verification:user_x:org:*:token:*"

    async def test_non_member_gets_platform_verification_mail(self, db, mock_request, org):
        from src.services.users.email_verification import send_verification_email

        user = await _make_user(db, 52, "outsider@test.com", email_verified=False)
        fake_redis = Mock(setex=Mock())
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ), patch(
            "src.services.users.email_verification.send_email_verification_email",
            return_value=True,
        ) as send_mock:
            await send_verification_email(mock_request, db, user, org.id)
        assert send_mock.call_args.kwargs["organization"] is None
        assert ":org:none:" in fake_redis.setex.call_args.args[0]


# ── Email change ─────────────────────────────────────────────────────────────


class TestEmailChange:
    async def _change(self, db, mock_request, user, actor, **overrides):
        from src.services.users.users import update_user

        with patch("src.services.users.users.rbac_check", new=AsyncMock()):
            return await update_user(mock_request, db, user.id, _public(actor), _update(user, **overrides))

    async def test_requires_current_password(self, db, mock_request):
        user = await _make_user(db, 60, "me@test.com")
        with pytest.raises(HTTPException) as exc:
            await self._change(db, mock_request, user, user, email="else@test.com")
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "INVALID_PASSWORD"

        with pytest.raises(HTTPException) as exc:
            await self._change(
                db, mock_request, user, user, email="else@test.com", current_password="wrong"
            )
        assert exc.value.detail["code"] == "INVALID_PASSWORD"

    async def test_correct_password_changes_and_notifies(self, db, mock_request):
        user = await _make_user(db, 61, "me2@test.com")
        with patch(
            "src.services.users.email_verification.invalidate_verification_tokens"
        ) as invalidate_mock, patch(
            "src.services.users.email_verification.send_verification_email",
            new=AsyncMock(),
        ) as verify_mock, patch(
            "src.services.users.emails.send_email_changed_notice"
        ) as notice_mock:
            result = await self._change(
                db, mock_request, user, user,
                email="moved@test.com", current_password="CurrentPass1!",
            )
        assert result.email == "moved@test.com"
        assert result.email_verified is False
        invalidate_mock.assert_called_once_with("user_61")
        assert verify_mock.await_count == 1
        assert notice_mock.call_args.kwargs["email"] == "me2@test.com"
        assert notice_mock.call_args.kwargs["new_email"] == "moved@test.com"

    async def test_profile_edit_without_email_change_needs_no_password(self, db, mock_request):
        user = await _make_user(db, 62, "me3@test.com")
        result = await self._change(db, mock_request, user, user, first_name="Renamed")
        assert result.first_name == "Renamed"

    async def test_resaving_a_mixed_case_email_is_not_an_email_change(self, db, mock_request):
        # EmailStr lowercases the domain the profile form re-sends.
        user = await _make_user(db, 65, "Mixed@Example.COM")
        result = await self._change(
            db, mock_request, user, user, email="Mixed@example.com", first_name="Same"
        )
        assert result.first_name == "Same"
        assert result.email == "Mixed@Example.COM"
        assert result.email_verified is True

    async def test_passwordless_account_without_mfa_is_told_to_set_a_password(self, db, mock_request):
        user = await _make_user(db, 63, "google@test.com", password="")
        with pytest.raises(HTTPException) as exc:
            await self._change(db, mock_request, user, user, email="else2@test.com")
        assert exc.value.detail["code"] == "PASSWORD_REQUIRED"

    async def test_passwordless_account_with_mfa_uses_a_code(self, db, mock_request):
        user = await _make_user(db, 64, "google2@test.com", password="")
        mfa = Mock(confirmed_at="now", secret_encrypted="x", last_used_timestep=None)
        with patch("src.services.auth.mfa.get_user_mfa", new=AsyncMock(return_value=mfa)), patch(
            "src.services.auth.mfa.decrypt_secret", return_value="secret"
        ), patch(
            "src.services.auth.mfa.verify_and_consume_totp", new=AsyncMock(return_value=False)
        ):
            with pytest.raises(HTTPException) as exc:
                await self._change(
                    db, mock_request, user, user, email="else3@test.com", mfa_code="123456"
                )
        assert exc.value.detail["code"] == "INVALID_MFA_CODE"

        with patch("src.services.auth.mfa.get_user_mfa", new=AsyncMock(return_value=mfa)), patch(
            "src.services.auth.mfa.decrypt_secret", return_value="secret"
        ), patch(
            "src.services.auth.mfa.verify_and_consume_totp", new=AsyncMock(return_value=True)
        ), patch("src.services.users.users._after_email_change", new=AsyncMock()):
            result = await self._change(
                db, mock_request, user, user, email="else3@test.com", mfa_code="123456"
            )
        assert result.email == "else3@test.com"

    async def test_duplicate_email_check_is_case_insensitive(self, db, mock_request):
        await _make_user(db, 65, "taken@test.com")
        user = await _make_user(db, 66, "mine@test.com")
        with pytest.raises(HTTPException) as exc:
            await self._change(
                db, mock_request, user, user,
                email="TAKEN@test.com", current_password="CurrentPass1!",
            )
        assert exc.value.status_code == 400

    async def test_signup_duplicate_email_check_is_case_insensitive(self, db, mock_request):
        from src.services.users.users import create_user_without_org

        await _make_user(db, 67, "exists@test.com")
        with pytest.raises(HTTPException) as exc:
            await create_user_without_org(
                mock_request,
                db,
                AnonymousUser(),
                UserCreate(
                    username="fresh",
                    email="Exists@Test.com",
                    password="Str0ng!Passw0rd",
                ),
            )
        assert exc.value.status_code == 400

    async def test_unreadable_password_hash_is_a_wrong_password(self, db, mock_request):
        user = await _make_user(db, 68, "legacy@test.com", password="not-a-known-hash")
        with pytest.raises(HTTPException) as exc:
            await self._change(
                db, mock_request, user, user, email="else4@test.com", current_password="anything"
            )
        assert exc.value.detail["code"] == "INVALID_PASSWORD"

    async def test_missing_actor_is_refused(self, db):
        # update_user looks the actor up again; a row gone by then fails closed.
        from src.services.users.users import _require_reauth_for_email_change

        user = await _make_user(db, 69, "gone@test.com")
        with pytest.raises(HTTPException) as exc:
            await _require_reauth_for_email_change(None, _update(user), db)
        assert exc.value.status_code == 403

    async def test_mail_failures_do_not_stop_the_old_address_warning(self, db, mock_request):
        from src.services.users.users import _after_email_change

        user = await _make_user(db, 70, "new@test.com")
        with patch(
            "src.services.users.email_verification.invalidate_verification_tokens",
            side_effect=RuntimeError("redis down"),
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new=AsyncMock(side_effect=RuntimeError("smtp down")),
        ), patch("src.services.users.emails.send_email_changed_notice") as notice_mock:
            await _after_email_change(mock_request, db, user, "old@test.com")
        notice_mock.assert_called_once_with(
            email="old@test.com", new_email="new@test.com", username=user.username
        )

    def test_email_changed_notice_goes_to_the_old_address_escaped(self):
        from src.services.users import emails

        with patch.object(emails, "_send_notification_email", return_value=True) as send_mock:
            assert emails.send_email_changed_notice(
                email="old@test.com", new_email="<b>evil</b>@test.com", username="<i>u</i>"
            ) is True
        kwargs = send_mock.call_args.kwargs
        assert kwargs["to"] == "old@test.com"
        assert kwargs["subject"]
        assert "<b>evil</b>" not in kwargs["body"]
        assert "&lt;b&gt;evil&lt;/b&gt;@test.com" in kwargs["body"]
        assert "<i>u</i>" not in kwargs["body"]


class TestOrgAdminProfileEditScope:
    async def _edit(self, db, mock_request, admin, target):
        from src.services.users.users import update_user

        with patch("src.services.users.users.rbac_check", new=AsyncMock()):
            return await update_user(
                mock_request, db, target.id, admin, _update(target, first_name="Edited")
            )

    async def test_sole_org_member_can_be_edited(self, db, mock_request, org, admin_user):
        target = await _make_user(db, 70, "member@test.com")
        await _join(db, target.id, org.id)
        result = await self._edit(db, mock_request, admin_user, target)
        assert result.first_name == "Edited"

    async def test_account_in_another_org_is_refused(self, db, mock_request, org, other_org, admin_user):
        target = await _make_user(db, 71, "shared@test.com")
        await _join(db, target.id, org.id)
        await _join(db, target.id, other_org.id)
        with pytest.raises(HTTPException) as exc:
            await self._edit(db, mock_request, admin_user, target)
        assert exc.value.status_code == 403

    async def test_admin_or_maintainer_is_refused(self, db, mock_request, org, admin_user):
        target = await _make_user(db, 72, "colleague@test.com")
        await _join(db, target.id, org.id, role_id=2)
        with pytest.raises(HTTPException) as exc:
            await self._edit(db, mock_request, admin_user, target)
        assert exc.value.status_code == 403

    async def test_superadmin_is_refused(self, db, mock_request, org, admin_user):
        target = await _make_user(db, 73, "root@test.com", is_superadmin=True)
        await _join(db, target.id, org.id)
        with pytest.raises(HTTPException) as exc:
            await self._edit(db, mock_request, admin_user, target)
        assert exc.value.status_code == 403


# ── Google sign-in ───────────────────────────────────────────────────────────


def _google_request():
    return Request({"type": "http", "method": "POST", "headers": [], "client": ("127.0.0.1", 0)})


class TestGooglePreHijack:
    async def _sign_in(self, db, email):
        from src.services.auth.utils import signWithGoogle

        payload = {"email": email, "email_verified": True}
        with patch(
            "src.services.auth.utils.get_google_user_info", new=AsyncMock(return_value=payload)
        ), patch("src.services.auth.utils.update_login_info", return_value=None), patch(
            "src.security.auth.revoke_user_sessions_before"
        ) as revoke_mock:
            await signWithGoogle(
                _google_request(), access_token="t", email=email, org_id=None,
                current_user=None, db_session=db,
            )
        return revoke_mock

    async def test_unverified_password_account_loses_its_password(self, db):
        user = await _make_user(db, 80, "victim@test.com", email_verified=False)
        revoke_mock = await self._sign_in(db, "victim@test.com")
        await db.refresh(user)
        assert user.password == ""
        assert user.password_changed_at is not None
        assert user.email_verified is True
        revoke_mock.assert_called_once_with(user.id)

    async def test_admin_provisioned_password_is_dropped(self, db):
        user = await _make_user(db, 81, "provisioned@test.com", signup_method="admin_api")
        await self._sign_in(db, "provisioned@test.com")
        await db.refresh(user)
        assert user.password == ""

    async def test_owner_chosen_password_is_kept(self, db):
        user = await _make_user(
            db, 82, "owner@test.com", signup_method="admin_api",
            password_changed_at=datetime(2026, 1, 1),
        )
        verified = await _make_user(db, 83, "verified@test.com")
        revoke_mock = await self._sign_in(db, "owner@test.com")
        await self._sign_in(db, "verified@test.com")
        await db.refresh(user)
        await db.refresh(verified)
        assert user.password and verified.password
        revoke_mock.assert_not_called()


# ── Password reset ───────────────────────────────────────────────────────────


class TestPasswordReset:
    async def test_org_send_skips_non_members(self, db, mock_request, org):
        from src.services.users.password_reset import send_reset_password_code

        await _make_user(db, 90, "nonmember@test.com")
        with patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=MagicMock(incr=Mock(return_value=1)),
        ), patch(
            "src.services.users.password_reset.send_password_reset_email"
        ) as send_mock:
            result = await send_reset_password_code(
                mock_request, db, AnonymousUser(), org.id, "nonmember@test.com"
            )
        assert result.startswith("If an account")
        send_mock.assert_not_called()

    async def test_org_change_refuses_non_members(self, db, mock_request, org):
        from src.services.users.password_reset import change_password_with_reset_code

        await _make_user(db, 91, "nonmember2@test.com")
        with pytest.raises(HTTPException) as exc:
            await change_password_with_reset_code(
                mock_request, db, AnonymousUser(), "N3w!Password", org.id,
                "nonmember2@test.com", "ABCDEFGH",
            )
        assert exc.value.status_code == 400

    async def test_code_is_taken_atomically_and_siblings_die(self, db, mock_request):
        from src.services.users.password_reset import change_password_with_reset_code_platform

        user = await _make_user(db, 92, "resetme@test.com")
        stored = json.dumps({"reset_code_expires": int(datetime.now().timestamp()) + 600})
        fake_redis = Mock(
            getdel=Mock(return_value=stored),
            scan_iter=Mock(return_value=[b"pwd_reset:user:user_92:org:x:code:OTHER"]),
            delete=Mock(),
        )
        with patch(
            "src.services.users.password_reset._get_redis_connection", return_value=fake_redis
        ):
            await change_password_with_reset_code_platform(
                mock_request, db, AnonymousUser(), "N3w!Password9", user.email, "ABCDEFGH"
            )
        fake_redis.getdel.assert_called_once_with("pwd_reset:user:user_92:platform:code:ABCDEFGH")
        assert fake_redis.scan_iter.call_args.kwargs["match"] == "pwd_reset:user:user_92:*"
        fake_redis.delete.assert_called_once_with(b"pwd_reset:user:user_92:org:x:code:OTHER")

        # Second use of the same code finds nothing.
        fake_redis.getdel.return_value = None
        with patch(
            "src.services.users.password_reset._get_redis_connection", return_value=fake_redis
        ), pytest.raises(HTTPException):
            await change_password_with_reset_code_platform(
                mock_request, db, AnonymousUser(), "N3w!Password9", user.email, "ABCDEFGH"
            )

    async def test_platform_send_uses_member_aware_link_and_is_ip_limited(self, db):
        from src.services.users.password_reset import send_reset_password_code_platform

        await _make_user(db, 93, "platform@test.com")
        request = Request({
            "type": "http", "method": "POST", "path": "/", "query_string": b"",
            "headers": [(b"origin", b"https://custom.attacker.example")],
            "client": ("127.0.0.1", 0),
        })
        fake_redis = MagicMock(incr=Mock(return_value=1))
        with patch(
            "src.services.users.password_reset._get_redis_connection", return_value=fake_redis
        ), patch(
            "src.services.users.password_reset.get_member_link_base_url",
            new_callable=AsyncMock,
            return_value="https://platform.test",
        ) as base_mock, patch(
            "src.services.users.password_reset.send_password_reset_email_platform",
            return_value=True,
        ) as send_mock:
            await send_reset_password_code_platform(request, db, AnonymousUser(), "platform@test.com")
        base_mock.assert_called_once()
        assert send_mock.call_args.kwargs["base_url"] == "https://platform.test"
        assert fake_redis.incr.call_args.args[0].startswith("pwd_reset_ip:")

        fake_redis.incr.return_value = 11
        with patch(
            "src.services.users.password_reset._get_redis_connection", return_value=fake_redis
        ), pytest.raises(HTTPException) as exc:
            await send_reset_password_code_platform(request, db, AnonymousUser(), "platform@test.com")
        assert exc.value.status_code == 429

    def test_send_and_change_use_separate_rate_limit_keys(self):
        from src.services.security.rate_limiting import check_password_reset_rate_limit

        with patch(
            "src.services.security.rate_limiting.check_rate_limit", return_value=(True, 1, 300)
        ) as rl:
            check_password_reset_rate_limit("A@x.com", action="send")
            check_password_reset_rate_limit("A@x.com")
        keys = [c.kwargs["key"] for c in rl.call_args_list]
        assert keys == ["password_reset:send:a@x.com", "password_reset:change:a@x.com"]


# ── Link hosts and mail escaping ─────────────────────────────────────────────


class TestLinkHosts:
    async def test_non_hostname_slug_falls_back_to_platform(self):
        from types import SimpleNamespace

        from src.services.email.utils import get_org_signup_base_url

        cfg = SimpleNamespace(
            hosting_config=SimpleNamespace(
                tenancy="multi", ssl=True, domain="learnhouse.test", frontend_domain="app.learnhouse.test"
            )
        )
        with patch("src.services.email.utils.get_learnhouse_config", return_value=cfg), patch.dict(
            "os.environ", {"LEARNHOUSE_PLATFORM_URL": "https://platform.test"}
        ):
            assert await get_org_signup_base_url("acme") == "https://acme.learnhouse.test"
            assert await get_org_signup_base_url("evil.com/x") == "https://platform.test"
            assert await get_org_signup_base_url("Bad_Slug") == "https://platform.test"

    def test_reset_and_verification_hrefs_are_escaped(self):
        from src.db.users import UserRead
        from src.services.users import emails

        user = UserRead(
            id=1, username="u", first_name="", last_name="", email="u@test.com", user_uuid="user_1"
        )
        with patch("src.services.users.emails.send_email", return_value=True) as send_mock:
            emails.send_password_reset_email_platform(
                generated_reset_code="CODE", user=user, email="u@test.com",
                base_url='https://x.test/"><script>',
            )
            emails.send_email_verification_email(
                token="t", user=user, organization=None, email="u@test.com",
                base_url='https://x.test/"onmouseover="a',
            )
        for call in send_mock.call_args_list:
            body = call.kwargs["body"]
            assert '"><script>' not in body
            assert '"onmouseover="' not in body
            assert "&amp;" in body


class TestMagicLinkBranding:
    async def test_non_member_gets_platform_mail(self, db, org):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from src.routers.auth import get_db_session  # the router's own reference
        from src.routers.auth import router as auth_router

        await _make_user(db, 95, "outsider-magic@test.com")
        app = FastAPI()
        app.include_router(auth_router, prefix="/api/v1/auth")
        app.dependency_overrides[get_db_session] = lambda: db
        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch(
            "src.routers.auth.check_rate_limit", return_value=(True, 1, 900)
        ), patch(
            "src.services.auth.magic_login.issue_magic_login_token", return_value="tok"
        ) as issue_mock, patch(
            "src.services.auth.magic_login.send_magic_login_email"
        ) as send_mock, patch(
            "src.services.email.utils.get_member_link_base_url",
            new_callable=AsyncMock,
            return_value="https://platform.test",
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    "/api/v1/auth/magic-link/request",
                    json={"email": "outsider-magic@test.com", "org_slug": org.slug},
                )
        assert resp.status_code == 200
        assert issue_mock.call_args.args[1] is None
        assert send_mock.call_args.args[2] == "https://platform.test"
        assert "org_name" not in send_mock.call_args.kwargs


# ── Two-factor session revocation ────────────────────────────────────────────


class TestMfaSessionRevocation:
    def test_revocation_cuts_at_the_current_session(self):
        from src.routers.mfa import _revoke_older_sessions
        from src.security.auth import create_access_token

        token = create_access_token({"sub": "a@test.com"})
        request = Request({
            "type": "http", "method": "POST", "path": "/", "query_string": b"",
            "headers": [(b"authorization", f"Bearer {token}".encode())],
        })
        with patch("src.routers.mfa.revoke_user_sessions_before") as revoke_mock:
            _revoke_older_sessions(request, 7)
        user_id, cutoff = revoke_mock.call_args.args
        assert user_id == 7
        # The cutoff is this session's own issue time, so it survives.
        assert abs(cutoff.timestamp() - datetime.now(timezone.utc).timestamp()) < 5

    async def test_disable_burns_the_code_and_revokes(self, db, regular_user):
        import time

        import pyotp
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from src.routers.mfa import get_db_session  # the router's own reference
        from src.db.user_mfa import UserMFA
        from src.routers.mfa import router as mfa_router
        from src.security.auth import get_authenticated_user
        from src.services.auth.mfa import TOTP_PERIOD_SECONDS, encrypt_secret, generate_totp_secret

        secret = generate_totp_secret()
        now = str(datetime.now())
        db.add(UserMFA(
            user_id=regular_user.id, secret_encrypted=encrypt_secret(secret),
            confirmed_at=now, creation_date=now, update_date=now,
        ))
        await db.commit()
        code = pyotp.TOTP(secret, interval=TOTP_PERIOD_SECONDS).at(int(time.time()))

        app = FastAPI()
        app.include_router(mfa_router, prefix="/api/v1/auth")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_authenticated_user] = lambda: regular_user
        with patch("src.routers.mfa.check_rate_limit", return_value=(True, 0, None)), patch(
            "src.routers.mfa.security_verify_password", return_value=True
        ), patch("src.routers.mfa._revoke_older_sessions") as revoke_mock, patch(
            "src.routers.mfa.verify_and_consume_totp", new=AsyncMock(return_value=True)
        ) as consume_mock:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    "/api/v1/auth/mfa/disable", json={"password": "pw", "code": code}
                )
        assert resp.status_code == 200
        consume_mock.assert_awaited_once()
        revoke_mock.assert_called_once()

    async def test_org_reset_revokes_the_members_sessions(self, db, org, admin_user, regular_user):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from src.routers.mfa import get_db_session  # the router's own reference
        from src.routers.mfa import router as mfa_router
        from src.security.auth import get_authenticated_user

        app = FastAPI()
        app.include_router(mfa_router, prefix="/api/v1/auth")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_authenticated_user] = lambda: admin_user
        with patch("src.routers.mfa.revoke_user_sessions_before") as revoke_mock:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"/api/v1/auth/mfa/org-reset/{org.id}/{regular_user.id}")
        assert resp.status_code == 200
        revoke_mock.assert_called_once_with(regular_user.id)



# ── Member-aware credential link host ────────────────────────────────────────


class TestMemberLinkBaseUrl:
    """Org-less reset and magic links stay on the org host the request came
    from only when the user belongs to that org."""

    @staticmethod
    def _multi_tenant_config():
        from types import SimpleNamespace

        return SimpleNamespace(
            hosting_config=SimpleNamespace(
                tenancy="multi", domain="learnhouse.test", ssl=True, frontend_domain=""
            )
        )

    async def _resolve(self, db, user_id, origin):
        from src.services.email import utils

        request = Request({
            "type": "http", "method": "POST", "path": "/", "query_string": b"",
            "headers": [(b"origin", origin.encode())], "client": ("127.0.0.1", 0),
        })
        with patch.object(utils, "get_learnhouse_config", self._multi_tenant_config), patch.object(
            utils, "get_trusted_base_url_from_request", return_value=origin
        ), patch.object(utils, "get_platform_base_url", return_value="https://platform.test"):
            return await utils.get_member_link_base_url(request, db, user_id)

    async def test_member_keeps_their_org_host(self, db, org):
        await _make_user(db, 96, "member-link@test.com")
        await _join(db, 96, org.id)
        url = await self._resolve(db, 96, "https://test-org.learnhouse.test")
        assert url == "https://test-org.learnhouse.test"

    async def test_non_member_gets_platform_host(self, db, org):
        await _make_user(db, 97, "outsider-link@test.com")
        url = await self._resolve(db, 97, "https://test-org.learnhouse.test")
        assert url == "https://platform.test"

    async def test_unknown_host_gets_platform_host(self, db, org):
        await _make_user(db, 98, "elsewhere-link@test.com")
        await _join(db, 98, org.id)
        url = await self._resolve(db, 98, "https://unknown.example")
        assert url == "https://platform.test"

    async def test_member_keeps_their_verified_custom_domain(self, db, org):
        from src.db.custom_domains import CustomDomain
        from src.services.email import utils

        db.add(CustomDomain(
            domain_uuid="domain_link", domain="learn.example.com", org_id=org.id,
            status="verified", creation_date="now", update_date="now",
        ))
        await db.commit()
        await _make_user(db, 99, "custom-link@test.com")
        await _join(db, 99, org.id)
        with patch.object(
            utils, "get_org_signup_base_url", new=AsyncMock(return_value="https://learn.example.com")
        ) as org_url:
            url = await self._resolve(db, 99, "https://learn.example.com")
        assert url == "https://learn.example.com"
        assert org_url.await_args.args[0] == org.slug

    async def test_no_request_gets_platform_host(self, db):
        from src.services.email import utils

        with patch.object(utils, "get_platform_base_url", return_value="https://platform.test"):
            assert await utils.get_member_link_base_url(None, db, 1) == "https://platform.test"

    def test_unconfigured_platform_url_falls_back_to_the_request(self, monkeypatch):
        from src.services.email import utils

        monkeypatch.delenv("LEARNHOUSE_PLATFORM_URL", raising=False)
        cfg = self._multi_tenant_config()
        cfg.hosting_config.domain = ""
        request = Request({
            "type": "http", "method": "POST", "path": "/", "query_string": b"",
            "headers": [(b"host", b"localhost:3000")], "scheme": "http",
            "server": ("localhost", 3000),
        })
        with patch.object(utils, "get_learnhouse_config", return_value=cfg):
            assert utils.get_platform_base_url(None) == ""
            assert utils.get_platform_base_url(request) == "http://localhost:3000"
