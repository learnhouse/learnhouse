"""Regression tests for the authentication core hardening.

Four defects, all in the sign-in path:

* the Google OAuth audience check was skipped whenever no client_id was
  configured — which was the default state — so any Google access token was
  accepted as proof of identity;
* Google sign-in minted a session directly and therefore walked past an
  enrolled TOTP factor;
* logging in as an account with no local password hash raised out of pwdlib and
  surfaced as a 500, an oracle for "this address has an SSO account";
* a refresh JWT presented as a bearer token authenticated a full session.

The compatibility direction matters as much as the attack direction here: every
test that pins a rejection has a sibling pinning that the legitimate sign-in
still works.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import jwt
import pytest
from fastapi import HTTPException, Response, status
from sqlmodel import select

from src.db.user_mfa import UserMFA
from src.db.users import AnonymousUser, User, UserUpdatePassword
from src.routers.auth import login, third_party_login
from src.security.auth import (
    JWT_COOKIE_NAME,
    authenticate_user,
    create_refresh_token,
    get_current_user,
)
from src.security.security import ALGORITHM, SECRET_KEY, security_hash_password
from src.services.auth import utils as auth_utils
from src.services.auth.session import (
    decode_mfa_pending_provenance,
    decode_mfa_pending_token,
    mint_session_tokens,
)
from src.services.users.users import update_user_password

GOOGLE_ENV_VARS = (
    "LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID",
    "LEARNHOUSE_GOOGLE_CLIENT_ID",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncClient:
    """Stand-in for ``httpx.AsyncClient``. Doubles as its own class: calling it
    returns the same instance, so ``httpx.AsyncClient(timeout=5)`` works."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, **kwargs):
        self.calls.append(url)
        return self._responses.pop(0)


def _request(*, auth: str = "", cookies: dict | None = None) -> Mock:
    req = Mock()
    req.headers = {"Authorization": auth}
    req.cookies = cookies or {}
    req.state = SimpleNamespace()
    return req


async def _enroll_confirmed_factor(db, user_id: int) -> None:
    now = str(datetime.now())
    db.add(
        UserMFA(
            user_id=user_id,
            secret_encrypted="ciphertext",
            confirmed_at=now,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()


@pytest.fixture
def no_google_client_id(monkeypatch):
    """Neither spelling set — the default state of a stock deployment."""
    for name in GOOGLE_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    # The "not configured" log line is emitted once per process; reset it so the
    # branch is exercised regardless of suite ordering.
    monkeypatch.setattr(auth_utils, "_LOGGED_MISSING_GOOGLE_CLIENT_ID", False)


# ---------------------------------------------------------------------------
# F3 / F12 — Google OAuth audience verification
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGoogleAudienceFailsClosed:
    async def test_unconfigured_client_id_is_rejected(self, no_google_client_id):
        """The attack this closes: the victim signs in on the attacker's site
        under the attacker's own Google OAuth client, and the attacker replays
        that access token here. It used to be accepted."""
        fake = _FakeAsyncClient([])

        with patch("src.services.auth.utils.httpx.AsyncClient", fake):
            with pytest.raises(HTTPException) as exc_info:
                await auth_utils._verify_google_token_audience("attacker-token")

        assert exc_info.value.status_code == 401
        # Fails before talking to Google at all.
        assert fake.calls == []

    async def test_get_google_user_info_refuses_when_unconfigured(
        self, no_google_client_id
    ):
        """The guard is wired into the only path that reads the Google profile,
        so userinfo is never consulted for an unverifiable token."""
        fake = _FakeAsyncClient([])

        with patch("src.services.auth.utils.httpx.AsyncClient", fake):
            with pytest.raises(HTTPException) as exc_info:
                await auth_utils.get_google_user_info("attacker-token")

        assert exc_info.value.status_code == 401
        assert fake.calls == []

    async def test_blank_client_id_counts_as_unset(self, monkeypatch):
        monkeypatch.setattr(auth_utils, "_LOGGED_MISSING_GOOGLE_CLIENT_ID", False)
        monkeypatch.setenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", "   ")
        monkeypatch.delenv("LEARNHOUSE_GOOGLE_CLIENT_ID", raising=False)

        with pytest.raises(HTTPException) as exc_info:
            await auth_utils._verify_google_token_audience("tok")

        assert exc_info.value.status_code == 401

    @pytest.mark.parametrize("env_var", GOOGLE_ENV_VARS)
    async def test_matching_audience_passes_for_either_spelling(
        self, monkeypatch, env_var
    ):
        """Deployments that followed the CLI template set
        LEARNHOUSE_GOOGLE_CLIENT_ID; the API originally read only the _OAUTH_
        name. Both must enable the check, or fail-closed locks those operators
        out of their own Google button."""
        for name in GOOGLE_ENV_VARS:
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv(env_var, "client-123.apps.googleusercontent.com")

        fake = _FakeAsyncClient(
            [_FakeResponse(200, {"aud": "client-123.apps.googleusercontent.com"})]
        )
        with patch("src.services.auth.utils.httpx.AsyncClient", fake):
            assert await auth_utils._verify_google_token_audience("tok") is None

        assert fake.calls == ["https://oauth2.googleapis.com/tokeninfo"]

    async def test_mismatched_audience_is_rejected(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", "ours")
        monkeypatch.delenv("LEARNHOUSE_GOOGLE_CLIENT_ID", raising=False)

        fake = _FakeAsyncClient([_FakeResponse(200, {"aud": "attacker-app"})])
        with patch("src.services.auth.utils.httpx.AsyncClient", fake):
            with pytest.raises(HTTPException) as exc_info:
                await auth_utils._verify_google_token_audience("tok")

        assert exc_info.value.status_code == 401

    async def test_expected_client_id_prefers_the_oauth_spelling(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", "primary")
        monkeypatch.setenv("LEARNHOUSE_GOOGLE_CLIENT_ID", "secondary")
        assert auth_utils.get_expected_google_client_id() == "primary"

        monkeypatch.delenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID")
        assert auth_utils.get_expected_google_client_id() == "secondary"


# ---------------------------------------------------------------------------
# F18 — Google sign-in must honour an enrolled second factor
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGoogleSignInHonoursSecondFactor:
    async def test_enrolled_totp_gets_a_challenge_not_a_session(self, db, regular_user):
        """Google sign-in used to mint cookies directly, so a confirmed TOTP
        factor was simply not asked for — and the org-wide require_2fa policy
        reports the account as compliant because the factor exists."""
        await _enroll_confirmed_factor(db, regular_user.id)
        signed_in = SimpleNamespace(id=regular_user.id, email=regular_user.email)

        with patch(
            "src.routers.auth.signWithGoogle", AsyncMock(return_value=signed_in)
        ), patch("src.routers.auth.set_auth_cookies") as set_cookies:
            result = await third_party_login(
                request=SimpleNamespace(),
                response=Response(),
                body=SimpleNamespace(
                    email=regular_user.email, provider="google", access_token="tok"
                ),
                org_id=None,
                current_user=AnonymousUser(),
                db_session=db,
            )

        assert result["mfa_required"] is True
        assert result["mfa_token"]
        # Same response shape /auth/login returns; the web client already reads it.
        assert set(result) == {"mfa_required", "mfa_token"}
        set_cookies.assert_not_called()
        # The pending token is inert against every authenticated endpoint and
        # carries the provenance so /auth/login/mfa mints a google session.
        assert decode_mfa_pending_token(result["mfa_token"]) == regular_user.email
        assert decode_mfa_pending_provenance(result["mfa_token"]) == ("google", None)

    async def test_account_without_a_factor_still_gets_a_session(self, db, regular_user):
        signed_in = SimpleNamespace(id=regular_user.id, email=regular_user.email)

        with patch(
            "src.routers.auth.signWithGoogle", AsyncMock(return_value=signed_in)
        ), patch("src.routers.auth.set_auth_cookies") as set_cookies, patch(
            "src.routers.auth.UserRead"
        ) as user_read:
            user_read.model_validate.side_effect = lambda u: u
            result = await third_party_login(
                request=SimpleNamespace(),
                response=Response(),
                body=SimpleNamespace(
                    email=regular_user.email, provider="google", access_token="tok"
                ),
                org_id=None,
                current_user=AnonymousUser(),
                db_session=db,
            )

        # The session branch omits the key entirely; only the challenge sets it.
        assert result.get("mfa_required") is not True
        assert result["tokens"]["access_token"]
        assert result["tokens"]["refresh_token"]
        set_cookies.assert_called_once()
        # Provenance survives the move to the session chokepoint.
        payload = jwt.decode(
            result["tokens"]["access_token"], SECRET_KEY, algorithms=[ALGORITHM]
        )
        assert payload["amr"] == "google"


# ---------------------------------------------------------------------------
# F22 — accounts with no local password hash
# ---------------------------------------------------------------------------


async def _add_user(db, *, email: str, password: str, user_id: int) -> User:
    u = User(
        id=user_id,
        username=f"user{user_id}",
        first_name="No",
        last_name="Password",
        email=email,
        password=password,
        user_uuid=f"user_{user_id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest.mark.asyncio
class TestEmptyPasswordHashLogin:
    async def test_authenticate_user_returns_false_instead_of_raising(self, db):
        """Every Google signup, admin-provisioned and anonymized account stores
        an empty sentinel. pwdlib raises UnknownHashError on it, which escaped as
        a 500 — a reliable oracle separating "SSO account" from "no such user"."""
        await _add_user(db, email="sso@example.com", password="", user_id=901)

        result = await authenticate_user(
            SimpleNamespace(), "sso@example.com", "anything", db
        )

        assert result is False

    async def test_login_answers_401_not_500(self, db):
        await _add_user(db, email="sso2@example.com", password="", user_id=902)

        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, 0)
        ), patch("src.routers.auth.get_client_ip", return_value="203.0.113.5"), patch(
            "src.routers.auth.record_failed_login", AsyncMock()
        ):
            with pytest.raises(HTTPException) as exc_info:
                await login(
                    request=SimpleNamespace(),
                    response=Response(),
                    username="sso2@example.com",
                    password="anything",
                    org_slug=None,
                    db_session=db,
                )

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
        # Byte-identical to the unknown-email answer: no oracle.
        assert exc_info.value.detail["code"] == "INVALID_CREDENTIALS"

    async def test_real_password_still_authenticates(self, db):
        await _add_user(
            db,
            email="local@example.com",
            password=security_hash_password("Str0ng-Passw0rd!42"),
            user_id=903,
        )

        ok = await authenticate_user(
            SimpleNamespace(), "local@example.com", "Str0ng-Passw0rd!42", db
        )
        assert ok is not False
        assert ok.email == "local@example.com"

        assert (
            await authenticate_user(
                SimpleNamespace(), "local@example.com", "wrong-password", db
            )
            is False
        )

    async def test_update_password_answers_401_for_an_sso_account(self, db):
        user = await _add_user(db, email="sso3@example.com", password="", user_id=904)
        current_user = SimpleNamespace(id=user.id)

        with pytest.raises(HTTPException) as exc_info:
            await update_user_password(
                SimpleNamespace(),
                db,
                current_user,
                user.id,
                UserUpdatePassword(
                    old_password="anything", new_password="Str0ng-Passw0rd!42"
                ),
            )

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_update_password_still_works_with_a_real_hash(self, db):
        user = await _add_user(
            db,
            email="local2@example.com",
            password=security_hash_password("Old-Passw0rd!42"),
            user_id=905,
        )
        current_user = SimpleNamespace(id=user.id)

        result = await update_user_password(
            SimpleNamespace(),
            db,
            current_user,
            user.id,
            UserUpdatePassword(
                old_password="Old-Passw0rd!42", new_password="New-Passw0rd!42"
            ),
        )

        assert result.id == user.id
        stored = (
            await db.execute(select(User).where(User.id == user.id))
        ).scalars().first()
        assert stored.password != ""


# ---------------------------------------------------------------------------
# F27 — a refresh JWT is not a session token
# ---------------------------------------------------------------------------


def _legacy_access_token(email: str) -> str:
    """An access token minted before the ``type`` claim existed. Tokens of this
    shape are sitting in live browsers, so they must keep working."""
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": email,
            "purpose": "session",
            "iat": now,
            "exp": now + timedelta(hours=8),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


@pytest.mark.asyncio
class TestRefreshTokenIsNotASession:
    async def test_refresh_jwt_as_bearer_is_rejected(self, db, regular_user):
        """A refresh token carries sub/exp/iat and — via mint_session_tokens —
        purpose "session" too, so the purpose gate alone let it authenticate a
        full session for ~30 days, bypassing rotation and replay detection."""
        refresh = create_refresh_token({"sub": regular_user.email, "purpose": "session"})
        req = _request(auth=f"Bearer {refresh}")

        with patch("src.security.auth._record_activity_from_request"):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(req, db)

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_refresh_jwt_in_the_access_cookie_is_rejected(self, db, regular_user):
        refresh = create_refresh_token({"sub": regular_user.email, "purpose": "session"})
        req = _request(cookies={JWT_COOKIE_NAME: refresh})

        with patch("src.security.auth._record_activity_from_request"):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(req, db)

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_access_token_still_authenticates(self, db, regular_user):
        tokens = mint_session_tokens(regular_user.email, amr="password", org_id=1)
        req = _request(cookies={JWT_COOKIE_NAME: tokens.access_token})

        with patch("src.security.auth._record_activity_from_request"):
            result = await get_current_user(req, db)

        assert result.email == regular_user.email
        # The claim is stamped on newly minted access tokens.
        payload = jwt.decode(tokens.access_token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["type"] == "access"

    async def test_legacy_access_token_without_the_claim_still_authenticates(
        self, db, regular_user
    ):
        """The compatibility case: requiring type == "access" outright would sign
        out every user holding a token minted before this change."""
        req = _request(cookies={JWT_COOKIE_NAME: _legacy_access_token(regular_user.email)})

        with patch("src.security.auth._record_activity_from_request"):
            result = await get_current_user(req, db)

        assert result.email == regular_user.email
