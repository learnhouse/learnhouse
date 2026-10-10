"""CSRF rule: enforce only for cookie-authenticated requests that name a
foreign (or "null") Origin. Header-less server-to-server calls pass."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.responses import JSONResponse


def _config(allowed_origins=None, tenancy=None, domain=""):
    config = MagicMock()
    config.hosting_config.allowed_origins = allowed_origins or ["https://app.example.com"]
    config.hosting_config.allowed_regexp = ""
    config.hosting_config.tenancy = tenancy
    config.hosting_config.domain = domain
    config.hosting_config.frontend_domain = domain
    config.general_config.development_mode = False
    return config


def _middleware(**kwargs):
    with patch("src.security.csrf.get_learnhouse_config", return_value=_config(**kwargs)):
        from src.security.csrf import CSRFProtectionMiddleware

        return CSRFProtectionMiddleware(MagicMock())


def _request(headers=None, cookies=None, method="POST"):
    req = MagicMock()
    req.method = method
    req.headers = headers or {}
    req.cookies = cookies or {}
    return req


def _run(mw, req):
    call_next = AsyncMock(return_value="ok")
    result = asyncio.run(mw.dispatch(req, call_next))
    return result, call_next


def _session_factory(row):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = row
    session.execute = AsyncMock(return_value=result)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=session)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


COOKIE = {"LH_access": "token"}


def _assert_rejected(result, call_next):
    assert isinstance(result, JSONResponse)
    assert result.status_code == 403
    call_next.assert_not_awaited()


def test_allowed_origin_with_cookie_passes():
    result, _ = _run(_middleware(), _request({"origin": "https://app.example.com"}, COOKIE))
    assert result == "ok"


def test_foreign_origin_with_cookie_rejected():
    from src.security.csrf import _CUSTOM_DOMAIN_CACHE

    _CUSTOM_DOMAIN_CACHE.clear()
    with patch("src.core.events.database._async_session_factory", _session_factory(None)):
        result, call_next = _run(_middleware(), _request({"origin": "https://evil.test"}, COOKIE))
    _assert_rejected(result, call_next)


def test_foreign_origin_with_refresh_cookie_only_rejected():
    from src.security.csrf import _CUSTOM_DOMAIN_CACHE

    _CUSTOM_DOMAIN_CACHE.clear()
    with patch("src.core.events.database._async_session_factory", _session_factory(None)):
        result, call_next = _run(
            _middleware(), _request({"origin": "https://evil.test"}, {"LH_refresh": "r"})
        )
    _assert_rejected(result, call_next)


def test_foreign_origin_without_cookies_passes():
    result, _ = _run(_middleware(), _request({"origin": "https://evil.test"}))
    assert result == "ok"


def test_unrelated_cookie_does_not_trigger_check():
    result, _ = _run(_middleware(), _request({"origin": "https://evil.test"}, {"LH_session": "1"}))
    assert result == "ok"


def test_no_origin_no_referer_with_cookie_passes():
    result, _ = _run(_middleware(), _request({}, COOKIE))
    assert result == "ok"


def test_foreign_referer_with_cookie_rejected():
    from src.security.csrf import _CUSTOM_DOMAIN_CACHE

    _CUSTOM_DOMAIN_CACHE.clear()
    with patch("src.core.events.database._async_session_factory", _session_factory(None)):
        result, call_next = _run(
            _middleware(), _request({"referer": "https://evil.test/page"}, COOKIE)
        )
    _assert_rejected(result, call_next)


def test_allowed_referer_with_cookie_passes():
    result, _ = _run(
        _middleware(), _request({"referer": "https://app.example.com/dash"}, COOKIE)
    )
    assert result == "ok"


def test_null_origin_with_cookie_rejected():
    result, call_next = _run(_middleware(), _request({"origin": "null"}, COOKIE))
    _assert_rejected(result, call_next)


def test_null_origin_does_not_fall_back_to_referer():
    result, call_next = _run(
        _middleware(),
        _request({"origin": "null", "referer": "https://app.example.com/x"}, COOKIE),
    )
    _assert_rejected(result, call_next)


def test_custom_domain_origin_with_cookie_passes():
    from src.security.csrf import _CUSTOM_DOMAIN_CACHE

    _CUSTOM_DOMAIN_CACHE.clear()
    with patch("src.core.events.database._async_session_factory", _session_factory(object())):
        result, _ = _run(_middleware(), _request({"origin": "https://learn.school.test"}, COOKIE))
    assert result == "ok"


def test_api_token_exemption_kept():
    result, _ = _run(
        _middleware(),
        _request({"origin": "https://evil.test", "authorization": "Bearer lh_x"}, COOKIE),
    )
    assert result == "ok"


def test_get_not_checked():
    result, _ = _run(_middleware(), _request({"origin": "https://evil.test"}, COOKIE, method="GET"))
    assert result == "ok"


def test_multi_tenancy_subdomains_allowed_without_regexp():
    # The allowlist mirrors CORS: with LEARNHOUSE_ALLOWED_REGEXP unset, the
    # platform's own org subdomains must still pass.
    mw = _middleware(allowed_origins=["https://unused.test"], tenancy="multi", domain="example.com")
    result, _ = _run(mw, _request({"origin": "https://org1.example.com"}, COOKIE))
    assert result == "ok"
    assert mw._is_origin_allowed("https://example.com.evil.test") is False


def test_single_tenancy_frontend_domain_allowed():
    mw = _middleware(allowed_origins=["https://unused.test"], tenancy="single", domain="lms.example.org")
    assert mw._is_origin_allowed("https://lms.example.org") is True
    assert mw._is_origin_allowed("https://evil.test") is False


def test_middleware_is_mounted_inside_cors():
    from fastapi.middleware.cors import CORSMiddleware

    from app import app
    from src.security.csrf import CSRFProtectionMiddleware

    classes = [m.cls for m in app.user_middleware]
    assert CSRFProtectionMiddleware in classes
    # user_middleware is outermost-first: CORS must wrap CSRF.
    assert classes.index(CORSMiddleware) < classes.index(CSRFProtectionMiddleware)
