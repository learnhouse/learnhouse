"""
F-07: Google OAuth access-token audience verification.

When ``LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID`` is set, tokens minted for a
different OAuth client (``aud`` mismatch) must be rejected with 401 —
blocks the classic OAuth confused-deputy attack.

When neither ``LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID`` nor its
``LEARNHOUSE_GOOGLE_CLIENT_ID`` alias is set we cannot check ``aud`` at
all, so sign-in is refused rather than accepted unverified — falling
through would leave the confused-deputy attack open by default.
"""

from unittest.mock import patch

import httpx
import pytest
from fastapi import HTTPException

from src.services.auth import utils as auth_utils
from src.services.auth.utils import _verify_google_token_audience


@pytest.fixture(autouse=True)
def _reset_warning_flag():
    """Reset the one-shot warning flag between tests."""
    auth_utils._LOGGED_MISSING_GOOGLE_CLIENT_ID = False
    yield
    auth_utils._LOGGED_MISSING_GOOGLE_CLIENT_ID = False


def _tokeninfo_response(aud):
    class _R:
        status_code = 200

        def json(self_inner):
            return {"aud": aud}

    return _R()


@pytest.mark.asyncio
async def test_rejects_token_minted_for_different_oauth_client(monkeypatch):
    """
    F-07: token whose ``aud`` does not equal our client_id is rejected.
    This is the confused-deputy attack: attacker's Google app gets a valid
    access token for the victim, attacker posts it to /auth/oauth.
    """
    monkeypatch.setenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", "our-client-id")

    class _FakeClient:
        async def __aenter__(self_inner):
            return self_inner

        async def __aexit__(self_inner, *exc):
            return False

        async def get(self_inner, url, params=None):
            return _tokeninfo_response(aud="attacker-client-id")

    with patch.object(httpx, "AsyncClient", return_value=_FakeClient()):
        with pytest.raises(HTTPException) as exc:
            await _verify_google_token_audience("stolen-but-valid-for-attacker-app")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_accepts_token_minted_for_our_client(monkeypatch):
    """Happy path: token aud matches our client_id → no exception."""
    monkeypatch.setenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", "our-client-id")

    class _FakeClient:
        async def __aenter__(self_inner):
            return self_inner

        async def __aexit__(self_inner, *exc):
            return False

        async def get(self_inner, url, params=None):
            return _tokeninfo_response(aud="our-client-id")

    with patch.object(httpx, "AsyncClient", return_value=_FakeClient()):
        # Should not raise.
        await _verify_google_token_audience("legitimate-token")


@pytest.mark.asyncio
async def test_refuses_when_no_client_id_is_configured(monkeypatch):
    """
    Neither env spelling set — refuse rather than accept an unverifiable
    token. Both names must be cleared: either one alone is enough to
    configure the check.
    """
    monkeypatch.delenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("LEARNHOUSE_GOOGLE_CLIENT_ID", raising=False)

    with pytest.raises(HTTPException) as exc:
        await _verify_google_token_audience("unverifiable-token")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_accepts_token_when_only_the_alias_env_var_is_set(monkeypatch):
    """The CLI env template emits LEARNHOUSE_GOOGLE_CLIENT_ID; honour it."""
    monkeypatch.delenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.setenv("LEARNHOUSE_GOOGLE_CLIENT_ID", "our-client-id")

    class _FakeClient:
        async def __aenter__(self_inner):
            return self_inner

        async def __aexit__(self_inner, *exc):
            return False

        async def get(self_inner, url, params=None):
            return _tokeninfo_response(aud="our-client-id")

    with patch.object(httpx, "AsyncClient", return_value=_FakeClient()):
        # Should not raise.
        await _verify_google_token_audience("legitimate-token")


@pytest.mark.asyncio
async def test_rejects_when_tokeninfo_endpoint_returns_non_200(monkeypatch):
    """Expired/revoked tokens produce non-200 from tokeninfo → 401 from us."""
    monkeypatch.setenv("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID", "our-client-id")

    class _BadResp:
        status_code = 400

        def json(self_inner):
            return {}

    class _FakeClient:
        async def __aenter__(self_inner):
            return self_inner

        async def __aexit__(self_inner, *exc):
            return False

        async def get(self_inner, url, params=None):
            return _BadResp()

    with patch.object(httpx, "AsyncClient", return_value=_FakeClient()):
        with pytest.raises(HTTPException) as exc:
            await _verify_google_token_audience("revoked-token")
    assert exc.value.status_code == 401
