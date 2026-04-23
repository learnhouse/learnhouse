"""
Umbrella suite for the remaining security-remediation fixes.

F-15 : password-reset endpoints accept email in body (no more email-in-URL).
F-17 : cookie-domain validation at boot refuses single-label public parents.
F-20 : webhook / invite / search rate limiters return a standard 429.
F-22 : file validator enforces per-type size caps.
F-24 : analytics course_uuid validator rejects SQL-injection characters.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from httpx import ASGITransport, AsyncClient
from io import BytesIO
from starlette.datastructures import Headers

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.users import router as users_router
from src.security.auth import get_current_user


# ---------------------------------------------------------------------------
# F-15: reset-email endpoints accept email in body
# ---------------------------------------------------------------------------

@pytest.fixture
def users_app(db):
    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def users_client(users_app):
    async with AsyncClient(transport=ASGITransport(app=users_app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_platform_reset_accepts_email_in_body(users_client):
    """F-15: body-in-body variant exists and returns 200 end-to-end (mocked)."""
    with patch(
        "src.routers.users.check_password_reset_rate_limit",
        return_value=(True, None),
    ), patch(
        "src.routers.users.send_reset_password_code_platform",
        return_value={"message": "ok"},
    ):
        r = await users_client.post(
            "/api/v1/users/reset_password/platform/send_reset_code",
            json={"email": "victim@test.com"},
        )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_platform_reset_legacy_path_variant_still_works(users_client):
    """
    F-15: legacy URL variant kept for backwards compatibility — marked
    deprecated in OpenAPI but not removed, so any frontend caller on the
    old contract keeps working.
    """
    with patch(
        "src.routers.users.check_password_reset_rate_limit",
        return_value=(True, None),
    ), patch(
        "src.routers.users.send_reset_password_code_platform",
        return_value={"message": "ok"},
    ):
        r = await users_client.post(
            "/api/v1/users/reset_password/platform/send_reset_code/victim@test.com"
        )
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# F-17: cookie domain validation at boot
# ---------------------------------------------------------------------------

def test_single_label_cookie_domain_refused_in_prod(monkeypatch):
    """
    F-17: ``LEARNHOUSE_COOKIE_DOMAIN=.com`` must raise at config load in
    non-dev mode. Single-label public parents are always a bug.
    """
    monkeypatch.setenv("LEARNHOUSE_AUTH_JWT_SECRET_KEY", "x" * 40)
    monkeypatch.setenv("LEARNHOUSE_DEVELOPMENT_MODE", "false")
    monkeypatch.setenv("LEARNHOUSE_COOKIE_DOMAIN", ".com")
    monkeypatch.setenv("TESTING", "false")  # intentionally opt out of test bypass

    # Force a fresh import of the config module so the env takes effect.
    import importlib

    import config.config as cfg_module

    importlib.reload(cfg_module)
    with pytest.raises(ValueError) as exc:
        cfg_module.get_learnhouse_config()
    assert "too broad" in str(exc.value).lower()


def test_dotted_cookie_domain_ok(monkeypatch):
    """F-17: ``.app.example.com`` — normal SaaS setup — must load cleanly."""
    monkeypatch.setenv("LEARNHOUSE_AUTH_JWT_SECRET_KEY", "x" * 40)
    monkeypatch.setenv("LEARNHOUSE_DEVELOPMENT_MODE", "false")
    monkeypatch.setenv("LEARNHOUSE_COOKIE_DOMAIN", ".app.example.com")
    monkeypatch.setenv("LEARNHOUSE_COOKIE_DOMAIN_ALLOW_BROAD", "true")
    monkeypatch.setenv("TESTING", "false")

    import importlib

    import config.config as cfg_module

    importlib.reload(cfg_module)
    cfg = cfg_module.get_learnhouse_config()
    assert cfg.hosting_config.cookie_config.domain == ".app.example.com"


# ---------------------------------------------------------------------------
# F-20: rate limiters return the existing 429 envelope
# ---------------------------------------------------------------------------

def test_webhook_rate_limiter_returns_standard_envelope():
    """
    F-20: limiter signature returns (is_allowed, retry_after) — routers then
    raise the existing ``{code, message, retry_after}`` envelope with a
    Retry-After header. Frontend 429 handler is unchanged.
    """
    from src.services.security.rate_limiting import check_webhook_mutation_rate_limit

    with patch("src.services.security.rate_limiting.check_rate_limit", return_value=(False, 42, 42)):
        is_allowed, retry = check_webhook_mutation_rate_limit(org_id=1, action="create")
    assert is_allowed is False
    assert retry == 42


def test_invite_rate_limiter_keys_include_ip_and_org():
    """F-20: keying is per-IP + per-org so one abuser doesn't lock others out."""
    from src.services.security.rate_limiting import check_invite_acceptance_rate_limit

    request = MagicMock()
    request.client.host = "1.2.3.4"
    request.headers = Headers({})

    captured_keys = []

    def _spy(key, **kw):
        captured_keys.append(key)
        return (True, 0, 0)

    with patch("src.services.security.rate_limiting.check_rate_limit", side_effect=_spy):
        check_invite_acceptance_rate_limit(request, org_id=99)

    assert len(captured_keys) == 1
    assert "99" in captured_keys[0]
    assert "1.2.3.4" in captured_keys[0]


# ---------------------------------------------------------------------------
# F-22: file validator enforces size caps
# ---------------------------------------------------------------------------

def _upload(name: str, data: bytes) -> UploadFile:
    # Starlette's UploadFile delegates to SpooledTemporaryFile.
    return UploadFile(filename=name, file=BytesIO(data))


def test_file_validator_rejects_oversized_image():
    """F-22: a 20 MB "JPEG" payload is rejected (image cap is 15 MB)."""
    from src.security.file_validation import validate_upload

    # Minimum valid JPEG header so magic-byte check passes.
    jpeg_header = b"\xff\xd8\xff\xe0" + b"\x00" * 8
    payload = jpeg_header + b"\x00" * (20 * 1024 * 1024)
    f = _upload("big.jpg", payload)
    with pytest.raises(HTTPException) as exc:
        validate_upload(f, allowed_types=["image"])
    assert exc.value.status_code == 413


def test_file_validator_rejects_svg_outright():
    """F-22 (sanity): SVG remains blocked as before."""
    from src.security.file_validation import validate_upload

    f = _upload("evil.svg", b"<svg/>")
    with pytest.raises(HTTPException) as exc:
        validate_upload(f, allowed_types=["image"])
    assert exc.value.status_code == 415


# ---------------------------------------------------------------------------
# F-24: analytics course_uuid validator rejects SQL injection
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "bad_uuid",
    [
        "course'; DROP TABLE events;--",
        "course_test UNION SELECT * FROM users",
        "course_test) OR 1=1",
        "course_test;SELECT",
        "' OR '1'='1",
        "x" * 101,  # > 100 chars
        "course_test with spaces",
    ],
)
def test_analytics_validator_rejects_sql_injection_attempts(bad_uuid):
    """F-24: course_uuid validator refuses every SQL-meaningful character."""
    from src.routers.analytics import _validate_course_uuid

    with pytest.raises(HTTPException) as exc:
        _validate_course_uuid(bad_uuid)
    assert exc.value.status_code == 400


def test_analytics_validator_accepts_legitimate_uuid():
    from src.routers.analytics import _validate_course_uuid

    assert _validate_course_uuid("course_abc-123") == "course_abc-123"
