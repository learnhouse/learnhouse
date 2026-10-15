"""User-facing passwordless magic-login token: shape, single-use, purpose."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.db.users import UserRead
from src.security.auth import create_access_token, decode_jwt
from src.services.auth import magic_login as ml
from src.services.auth.magic_login import (
    MAGIC_LOGIN_PURPOSE,
    consume_magic_login_token,
    issue_magic_login_token,
    resolve_org,
    send_magic_login_email,
)
from src.services.auth.session import mint_session_tokens


class TestIssue:
    def test_token_shape(self):
        token = issue_magic_login_token("a@b.co", org_id=5)
        payload = decode_jwt(token)
        assert payload["purpose"] == MAGIC_LOGIN_PURPOSE
        assert payload["sub"] == "a@b.co"
        assert payload["org_id"] == 5
        assert payload.get("jti")

    def test_token_without_org(self):
        payload = decode_jwt(issue_magic_login_token("a@b.co", org_id=None))
        assert "org_id" not in payload


@pytest.mark.asyncio
class TestConsume:
    async def test_valid_token_returns_email_and_org(self, db):
        token = issue_magic_login_token("a@b.co", org_id=9)
        assert await consume_magic_login_token(token, db) == ("a@b.co", 9)

    async def test_single_use(self, db):
        token = issue_magic_login_token("a@b.co", org_id=None)
        assert await consume_magic_login_token(token, db) == ("a@b.co", None)
        with pytest.raises(HTTPException) as exc:
            await consume_magic_login_token(token, db)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_USED"

    async def test_wrong_purpose_rejected(self, db):
        # A real session token must never be spendable as a login link.
        session = mint_session_tokens("a@b.co", amr="password", org_id=1)
        with pytest.raises(HTTPException) as exc:
            await consume_magic_login_token(session.access_token, db)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_garbage_token_rejected(self, db):
        # decode_jwt returns None (not a raise) for an unparseable token, so this
        # lands on the wrong-purpose branch.
        with pytest.raises(HTTPException) as exc:
            await consume_magic_login_token("not-a-jwt", db)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_token_without_jti_rejected(self, db):
        token = create_access_token(data={"sub": "a@b.co", "purpose": MAGIC_LOGIN_PURPOSE})
        with pytest.raises(HTTPException) as exc:
            await consume_magic_login_token(token, db)
        assert exc.value.status_code == 410

    async def test_fails_closed_when_the_record_cannot_be_written(self, db):
        # If the use cannot be recorded the link must be refused, not let
        # through unrecorded where it could be replayed.
        token = issue_magic_login_token("a@b.co", org_id=None)
        with patch.object(db, "commit", side_effect=RuntimeError("db down")):
            with pytest.raises(HTTPException) as exc:
                await consume_magic_login_token(token, db)
        assert exc.value.status_code == 503

    async def test_refresh_typed_token_rejected(self, db):
        token = create_access_token(
            data={"sub": "a@b.co", "purpose": MAGIC_LOGIN_PURPOSE, "jti": "t", "type": "refresh"}
        )
        with pytest.raises(HTTPException) as exc:
            await consume_magic_login_token(token, db)
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_token_without_jti_is_invalid_not_used(self, db):
        token = create_access_token(data={"sub": "a@b.co", "purpose": MAGIC_LOGIN_PURPOSE})
        with pytest.raises(HTTPException) as exc:
            await consume_magic_login_token(token, db)
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_malformed_link_is_not_spent(self, db):
        # Refused before redemption, so nothing is recorded against its jti.
        from sqlmodel import select

        from src.db.used_link_tokens import UsedLinkToken

        token = create_access_token(data={"sub": "", "purpose": MAGIC_LOGIN_PURPOSE, "jti": "keep"})
        with pytest.raises(HTTPException):
            await consume_magic_login_token(token, db)
        assert (await db.execute(select(UsedLinkToken))).scalars().first() is None

    async def test_undecodable_token_raises_401(self, db):
        # decode_jwt raising (rather than returning None) lands on the 401 path.
        with patch.object(ml, "decode_jwt", side_effect=ValueError("bad")):
            with pytest.raises(HTTPException) as exc:
                await consume_magic_login_token("whatever", db)
        assert exc.value.status_code == 401
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_token_without_subject_raises_401(self, db):
        token = create_access_token(
            data={"sub": "", "purpose": MAGIC_LOGIN_PURPOSE, "jti": "abc"}
        )
        with pytest.raises(HTTPException) as exc:
            await consume_magic_login_token(token, db)
        assert exc.value.status_code == 401
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_non_integer_org_id_falls_back_to_none(self, db):
        token = create_access_token(
            data={
                "sub": "a@b.co",
                "purpose": MAGIC_LOGIN_PURPOSE,
                "jti": "xyz",
                "org_id": "not-a-number",
            }
        )
        assert await consume_magic_login_token(token, db) == ("a@b.co", None)


@pytest.mark.asyncio
class TestResolveOrg:
    async def test_none_slug_returns_none(self, db):
        assert await resolve_org(None, db) is None

    async def test_unknown_slug_returns_none(self, db, org):
        assert await resolve_org("does-not-exist", db) is None

    async def test_matching_slug_returns_org(self, db, org):
        resolved = await resolve_org(org.slug, db)
        assert resolved is not None
        assert resolved.id == org.id


def _fake_user_read() -> UserRead:
    return UserRead(
        id=1,
        username="learner",
        first_name="Learn",
        last_name="Er",
        email="learner@example.com",
        user_uuid="user_learner",
    )


class TestSendMagicLoginEmail:
    def test_builds_consume_url_and_delegates_to_send_email(self):
        # The clickable link must point at the frontend consume page with the
        # (url-encoded) token, and must be handed to the shared mailer.
        with patch.object(ml, "send_email", return_value=True) as send_mock:
            result = send_magic_login_email(
                _fake_user_read(),
                "learner@example.com",
                "https://academy.example.com/",
                "raw.jwt.token",
            )
        assert result is True
        send_mock.assert_called_once()
        body = send_mock.call_args.kwargs["body"]
        assert "https://academy.example.com/auth/magic?token=raw.jwt.token" in body
        assert send_mock.call_args.kwargs["to"] == "learner@example.com"

    def test_platform_mail_is_learnhouse_branded(self):
        with patch.object(ml, "send_email", return_value=True) as send_mock:
            send_magic_login_email(
                _fake_user_read(), "learner@example.com", "https://app.test", "tok"
            )
        call = send_mock.call_args.kwargs
        assert call["subject"] == "Your LearnHouse login link"
        assert "Sign in to LearnHouse" in call["body"]
        assert "<svg" in call["body"]
        assert "Powered by LearnHouse" not in call["body"]
        assert call["sender_name"] is None

    def test_org_mail_is_the_orgs_own(self):
        with patch.object(ml, "send_email", return_value=True) as send_mock:
            send_magic_login_email(
                _fake_user_read(),
                "learner@example.com",
                "https://academy.example.com",
                "tok",
                lang="fr",
                org_name="Acme & Co",
                sender_name="Acme Academy",
                logo_url="https://api.test/content/orgs/o/logos/l.png",
                brand_color="#1d4ed8",
                powered_by=False,
            )
        call = send_mock.call_args.kwargs
        # Plain-text subject carries the raw org name; the HTML body escapes it.
        assert call["subject"] == "Votre lien de connexion Acme & Co"
        assert "Connectez-vous à Acme &amp; Co" in call["body"]
        assert '<img src="https://api.test/content/orgs/o/logos/l.png"' in call["body"]
        assert "background-color: #1d4ed8;" in call["body"]
        assert "LearnHouse" not in call["body"]
        assert "<svg" not in call["body"]
        assert call["sender_name"] == "Acme Academy"
        assert "https://academy.example.com/auth/magic?token=tok" in call["body"]

    def test_token_is_url_encoded_in_link(self):
        with patch.object(ml, "send_email", return_value=True) as send_mock:
            send_magic_login_email(
                _fake_user_read(),
                "learner@example.com",
                "https://academy.example.com",
                "a b/c+d",
            )
        body = send_mock.call_args.kwargs["body"]
        assert "/auth/magic?token=a%20b%2Fc%2Bd" in body
