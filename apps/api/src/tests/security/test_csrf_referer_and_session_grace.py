"""Two small request-security knobs.

* CSRF: a cookie-authenticated state-changing request with no Origin and a
  Referer that has no scheme/host cannot be attributed to any origin, so it is
  rejected rather than waved through as a server-to-server call.
* Session provenance: the legacy-session grace period is configurable in days
  through ``LEARNHOUSE_AUTH_LEGACY_SESSION_GRACE_DAYS``; negative values clamp
  to zero and junk falls back to the 30-day default.
"""

import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.responses import JSONResponse

from src.security.auth import JWT_COOKIE_NAME
from src.security.session_context import _legacy_session_grace


def _middleware():
    config = MagicMock()
    config.hosting_config.allowed_origins = ["https://example.com"]
    config.hosting_config.allowed_regexp = ""
    config.general_config.development_mode = False
    with patch("src.security.csrf.get_learnhouse_config", return_value=config):
        from src.security.csrf import CSRFProtectionMiddleware

        return CSRFProtectionMiddleware(MagicMock())


class TestUnparseableReferer:
    def test_cookie_request_with_junk_referer_is_rejected(self):
        req = MagicMock()
        req.method = "POST"
        req.url.path = "/api/v1/courses/"
        req.headers = {"referer": "not a url at all"}
        req.cookies = {JWT_COOKIE_NAME: "session-jwt"}
        call_next = AsyncMock(return_value="ok")

        result = asyncio.run(_middleware().dispatch(req, call_next))

        assert isinstance(result, JSONResponse)
        assert result.status_code == 403
        call_next.assert_not_awaited()


class TestLegacySessionGraceEnv:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            (None, timedelta(days=30)),
            ("7", timedelta(days=7)),
            ("-3", timedelta(days=0)),
            ("a week", timedelta(days=30)),
        ],
    )
    def test_env_value(self, monkeypatch, raw, expected):
        if raw is None:
            monkeypatch.delenv("LEARNHOUSE_AUTH_LEGACY_SESSION_GRACE_DAYS", raising=False)
        else:
            monkeypatch.setenv("LEARNHOUSE_AUTH_LEGACY_SESSION_GRACE_DAYS", raw)

        assert _legacy_session_grace() == expected
