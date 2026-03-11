"""
Unit tests for CSRF Protection Middleware.

Tests cover:
- Origin header validation
- Referer fallback when Origin is missing
- Rejection when both Origin and Referer are missing
- API token (lh_*) exemption
- Regular Bearer JWT NOT exempt (cookie fallback vulnerability)
- Stripe webhook exemption
- Safe methods (GET, HEAD, OPTIONS) bypass
- Development mode localhost allowance
- Regex-based origin matching
"""

from unittest.mock import MagicMock, patch


# Mock config before importing the middleware
def _make_mock_config(
    allowed_origins=None,
    allowed_regexp=None,
    development_mode=False,
):
    config = MagicMock()
    config.hosting_config.allowed_origins = allowed_origins or []
    config.hosting_config.allowed_regexp = allowed_regexp or ""
    config.general_config.development_mode = development_mode
    return config


def _make_request(method="POST", headers=None):
    """Create a mock Starlette Request."""
    req = MagicMock()
    req.method = method
    req.headers = headers or {}
    return req


class TestCSRFOriginValidation:
    """Test origin checking logic."""

    def test_allowed_origin_exact_match(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=["https://example.com", "https://app.example.com"]
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            assert mw.is_allowed_origin("https://example.com") is True
            assert mw.is_allowed_origin("https://app.example.com") is True

    def test_disallowed_origin(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=["https://example.com"]
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            assert mw.is_allowed_origin("https://evil.com") is False

    def test_no_origin_no_referer_rejected(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=["https://example.com"]
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            assert mw.is_allowed_origin(None, None) is False

    def test_referer_fallback(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=["https://example.com"]
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            # No Origin, but Referer matches
            assert mw.is_allowed_origin(None, "https://example.com/some/page") is True

    def test_referer_fallback_disallowed(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=["https://example.com"]
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            assert mw.is_allowed_origin(None, "https://evil.com/page") is False

    def test_regex_origin_match(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=[],
            allowed_regexp=r"https://.*\.example\.com"
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            assert mw.is_allowed_origin("https://sub.example.com") is True
            assert mw.is_allowed_origin("https://evil.com") is False

    def test_development_mode_localhost(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=[],
            development_mode=True
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            assert mw.is_allowed_origin("http://localhost:3000") is True
            assert mw.is_allowed_origin("http://127.0.0.1:8000") is True

    def test_production_mode_no_localhost(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=[],
            development_mode=False
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            mw = CSRFProtectionMiddleware(MagicMock())
            assert mw.is_allowed_origin("http://localhost:3000") is False


class TestCSRFExemptions:
    """Test CSRF exemption logic."""

    def _make_middleware(self):
        with patch("src.security.csrf.get_learnhouse_config", return_value=_make_mock_config(
            allowed_origins=["https://example.com"]
        )):
            from src.security.csrf import CSRFProtectionMiddleware
            return CSRFProtectionMiddleware(MagicMock())

    def test_api_token_exempt(self):
        """Bearer lh_* API tokens should bypass CSRF (never fall back to cookies)."""
        mw = self._make_middleware()
        req = _make_request(headers={"authorization": "Bearer lh_abc123_secret"})
        assert mw._is_csrf_exempt(req) is True

    def test_api_token_case_insensitive(self):
        mw = self._make_middleware()
        req = _make_request(headers={"authorization": "BEARER LH_abc123"})
        assert mw._is_csrf_exempt(req) is True

    def test_regular_bearer_jwt_not_exempt(self):
        """Regular Bearer JWT should NOT be exempt — get_current_user falls back to cookies."""
        mw = self._make_middleware()
        req = _make_request(headers={"authorization": "Bearer eyJ0eXAiOiJKV1Q..."})
        assert mw._is_csrf_exempt(req) is False

    def test_fake_bearer_not_exempt(self):
        """Attacker could send 'Bearer fake' to try to bypass CSRF."""
        mw = self._make_middleware()
        req = _make_request(headers={"authorization": "Bearer fake"})
        assert mw._is_csrf_exempt(req) is False

    def test_empty_bearer_not_exempt(self):
        mw = self._make_middleware()
        req = _make_request(headers={"authorization": "Bearer "})
        assert mw._is_csrf_exempt(req) is False

    def test_stripe_webhook_exempt(self):
        """Stripe webhooks use HMAC signature, no cookies involved."""
        mw = self._make_middleware()
        req = _make_request(headers={"stripe-signature": "t=123,v1=abc"})
        assert mw._is_csrf_exempt(req) is True

    def test_internal_key_exempt(self):
        """Internal service-to-service calls (collab server) use a shared key, not cookies."""
        mw = self._make_middleware()
        req = _make_request(headers={"x-internal-key": "some_secret_key"})
        assert mw._is_csrf_exempt(req) is True

    def test_platform_key_exempt(self):
        """Platform service-to-service calls use a shared key, not cookies."""
        mw = self._make_middleware()
        req = _make_request(headers={"x-platform-key": "some_platform_key"})
        assert mw._is_csrf_exempt(req) is True

    def test_no_auth_not_exempt(self):
        middleware = self._make_middleware()
        req = _make_request(headers={})
        assert middleware._is_csrf_exempt(req) is False

    def test_get_request_bypasses_csrf(self):
        """GET requests should not be checked for CSRF."""
        req = _make_request(method="GET")
        # GET is not in STATE_CHANGING_METHODS
        from src.security.csrf import STATE_CHANGING_METHODS
        assert req.method not in STATE_CHANGING_METHODS

    def test_state_changing_methods(self):
        from src.security.csrf import STATE_CHANGING_METHODS
        assert "POST" in STATE_CHANGING_METHODS
        assert "PUT" in STATE_CHANGING_METHODS
        assert "DELETE" in STATE_CHANGING_METHODS
        assert "PATCH" in STATE_CHANGING_METHODS
        assert "GET" not in STATE_CHANGING_METHODS
        assert "HEAD" not in STATE_CHANGING_METHODS
        assert "OPTIONS" not in STATE_CHANGING_METHODS
