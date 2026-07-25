"""User-facing passwordless magic-login token: shape, single-use, purpose."""

from unittest.mock import Mock, patch

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


class _FakeRedis:
    """Minimal SETNX-capable stand-in for the single-use marker store."""

    def __init__(self):
        self.store = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True


@pytest.fixture
def fake_redis():
    r = _FakeRedis()
    with patch.object(ml, "_redis", return_value=r):
        yield r


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


class TestConsume:
    def test_valid_token_returns_email_and_org(self, fake_redis):
        token = issue_magic_login_token("a@b.co", org_id=9)
        assert consume_magic_login_token(token) == ("a@b.co", 9)

    def test_single_use(self, fake_redis):
        token = issue_magic_login_token("a@b.co", org_id=None)
        assert consume_magic_login_token(token) == ("a@b.co", None)
        with pytest.raises(HTTPException) as exc:
            consume_magic_login_token(token)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_USED"

    def test_wrong_purpose_rejected(self, fake_redis):
        # A real session token must never be spendable as a login link.
        session = mint_session_tokens("a@b.co", amr="password", org_id=1)
        with pytest.raises(HTTPException) as exc:
            consume_magic_login_token(session.access_token)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    def test_garbage_token_rejected(self, fake_redis):
        # decode_jwt returns None (not a raise) for an unparseable token, so this
        # lands on the wrong-purpose branch.
        with pytest.raises(HTTPException) as exc:
            consume_magic_login_token("not-a-jwt")
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    def test_fails_closed_without_redis(self):
        # If the single-use store is unavailable the link must be refused, not
        # allowed to replay.
        token = issue_magic_login_token("a@b.co", org_id=None)
        with patch.object(ml, "_redis", return_value=None):
            with pytest.raises(HTTPException) as exc:
                consume_magic_login_token(token)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_USED"

    def test_fails_closed_when_redis_errors(self):
        # A Redis that is reachable but throws on SET must also fail closed.
        token = issue_magic_login_token("a@b.co", org_id=None)
        boom = Mock()
        boom.set.side_effect = RuntimeError("connection reset")
        with patch.object(ml, "_redis", return_value=boom):
            with pytest.raises(HTTPException) as exc:
                consume_magic_login_token(token)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_USED"

    def test_undecodable_token_raises_401(self, fake_redis):
        # decode_jwt raising (rather than returning None) lands on the 401 path.
        with patch.object(ml, "decode_jwt", side_effect=ValueError("bad")):
            with pytest.raises(HTTPException) as exc:
                consume_magic_login_token("whatever")
        assert exc.value.status_code == 401
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    def test_token_without_subject_raises_401(self, fake_redis):
        token = create_access_token(
            data={"sub": "", "purpose": MAGIC_LOGIN_PURPOSE, "jti": "abc"}
        )
        with pytest.raises(HTTPException) as exc:
            consume_magic_login_token(token)
        assert exc.value.status_code == 401
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    def test_non_integer_org_id_falls_back_to_none(self, fake_redis):
        token = create_access_token(
            data={
                "sub": "a@b.co",
                "purpose": MAGIC_LOGIN_PURPOSE,
                "jti": "xyz",
                "org_id": "not-a-number",
            }
        )
        assert consume_magic_login_token(token) == ("a@b.co", None)


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
