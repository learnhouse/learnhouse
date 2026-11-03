"""Tests for the MCP OAuth authorization server (src/services/mcp/oauth.py)."""

import base64
import hashlib
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from fastapi import HTTPException
from sqlmodel import select
from starlette.requests import Request

from src.db.mcp_oauth import MCPOAuthClient, MCPOAuthCode, MCPOAuthGrant, MCPOAuthToken
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.mcp import oauth

REDIRECT = "http://127.0.0.1:5555/callback"


def make_request(host="api.example.com", proto="https", path="/oauth/authorize", headers=None):
    raw = [(b"host", host.encode()), (b"x-forwarded-proto", proto.encode())]
    for k, v in (headers or {}).items():
        raw.append((k.lower().encode(), v.encode()))
    return Request({"type": "http", "method": "GET", "path": path, "headers": raw, "query_string": b""})


def pkce_pair():
    verifier = "v" * 64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


@pytest.fixture
def mcp_config():
    """Pin the MCP config so tests don't depend on the environment."""
    config = SimpleNamespace(enabled=True, public_url=None)
    with patch("src.services.mcp.oauth.get_learnhouse_config") as get_config:
        get_config.return_value.mcp_config = config
        get_config.return_value.hosting_config.ssl = True
        get_config.return_value.hosting_config.frontend_domain = "app.example.com"
        yield config


@pytest.fixture
def frontend():
    with patch(
        "src.services.email.utils._configured_frontend_base_url",
        return_value="https://app.example.com",
    ):
        yield


async def register(db, **extra):
    payload = {"client_name": "Claude", "redirect_uris": [REDIRECT], **extra}
    return await oauth.register_client(payload, db)


async def authorize(db, client_id, challenge, scope=None, **overrides):
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "st",
    }
    if scope:
        params["scope"] = scope
    params.update(overrides)
    target = await oauth.start_authorization(params, make_request(), db)
    return parse_qs(urlparse(target).query)["request"][0]


async def consent(db, user, org_id, request_token, scope=None):
    with patch("src.security.org_auth.enforce_org_mfa", new_callable=AsyncMock):
        redirect_to = await oauth.decide_authorization(request_token, user, org_id, True, scope, db)
    return parse_qs(urlparse(redirect_to).query)


async def full_tokens(db, user, org, scope=None, auth_method="none"):
    verifier, challenge = pkce_pair()
    extra = {"token_endpoint_auth_method": auth_method} if auth_method != "none" else {}
    client = await register(db, **extra)
    req = await authorize(db, client["client_id"], challenge, scope=scope)
    query = await consent(db, user, org.id, req)
    form = {
        "grant_type": "authorization_code",
        "client_id": client["client_id"],
        "code": query["code"][0],
        "redirect_uri": REDIRECT,
        "code_verifier": verifier,
    }
    if client.get("client_secret"):
        form["client_secret"] = client["client_secret"]
    tokens = await oauth.exchange_token(form, None, make_request(), db)
    return client, tokens


# ─── metadata ────────────────────────────────────────────────────────────────


def test_metadata_documents(mcp_config):
    req = make_request()
    assert oauth.mcp_resource_url(req) == "https://api.example.com/mcp"
    assert oauth.issuer_url(req) == "https://api.example.com"
    assert oauth.resource_metadata_url(req) == (
        "https://api.example.com/.well-known/oauth-protected-resource/mcp"
    )
    prm = oauth.protected_resource_metadata(req)
    assert prm["authorization_servers"] == ["https://api.example.com"]
    asm = oauth.authorization_server_metadata(req)
    assert asm["token_endpoint"] == "https://api.example.com/oauth/token"
    assert asm["code_challenge_methods_supported"] == ["S256"]


def test_resource_url_prefers_config(mcp_config):
    mcp_config.public_url = "https://mcp.example.org/mcp/"
    assert oauth.mcp_resource_url(make_request()) == "https://mcp.example.org/mcp"
    assert oauth.issuer_url(make_request()) == "https://mcp.example.org"


def test_request_origin_falls_back_to_ssl_flag(mcp_config):
    req = Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"host", b"h.test")], "query_string": b"", "scheme": "http", "server": ("h.test", 80)})
    assert oauth.mcp_resource_url(req) == "https://h.test/mcp"


def test_consent_page_url(mcp_config, frontend):
    assert oauth.consent_page_url(make_request()) == "https://app.example.com/oauth/consent"


def test_consent_page_url_without_configured_base(mcp_config):
    with patch("src.services.email.utils._configured_frontend_base_url", return_value=None):
        assert oauth.consent_page_url(make_request()) == "https://app.example.com/oauth/consent"


# ─── scopes and redirect URIs ────────────────────────────────────────────────


def test_parse_scope():
    assert oauth.parse_scope(None) == ["mcp:read", "mcp:write", "mcp:admin"]
    assert oauth.parse_scope("mcp:read") == ["mcp:read"]
    assert oauth.parse_scope("mcp:write openid") == ["mcp:read", "mcp:write"]
    assert oauth.parse_scope("mcp:admin") == ["mcp:read", "mcp:write", "mcp:admin"]
    with pytest.raises(oauth.OAuthError):
        oauth.parse_scope("openid profile")


@pytest.mark.parametrize(
    "uri",
    [
        "https://claude.ai/api/mcp/auth_callback",
        "http://localhost:3000/cb",
        "http://127.0.0.1:9/cb",
        "cursor://anysphere.cursor-retrieval/oauth/callback",
    ],
)
def test_redirect_uri_allowed(uri):
    assert oauth.validate_redirect_uri(uri) == uri


@pytest.mark.parametrize(
    "uri",
    [
        "",
        None,
        "javascript:alert(1)",
        "data:text/html,x",
        "http://evil.example.com/cb",
        "https://example.com/cb#frag",
        "https:///nohost",
        "noscheme",
        "https://x.test/" + "a" * 2100,
    ],
)
def test_redirect_uri_rejected(uri):
    with pytest.raises(oauth.OAuthError):
        oauth.validate_redirect_uri(uri)


def test_loopback_redirect_any_port():
    registered = ["http://127.0.0.1:5555/callback"]
    assert oauth._redirect_matches(registered, "http://127.0.0.1:7777/callback")
    assert not oauth._redirect_matches(registered, "http://127.0.0.1:7777/other")
    assert not oauth._redirect_matches(registered, "https://127.0.0.1:7777/callback")
    assert not oauth._redirect_matches(["https://a.test/cb"], "https://a.test/cb2")


# ─── registration ────────────────────────────────────────────────────────────


async def test_register_public_client(db):
    client = await register(db, client_uri="https://claude.ai", logo_uri="http://insecure/logo.png")
    assert client["client_id"].startswith("mcpc_")
    assert "client_secret" not in client
    assert client["client_uri"] == "https://claude.ai"
    assert "logo_uri" not in client  # not https: dropped
    stored = await oauth.get_client(client["client_id"], db)
    assert stored.redirect_uris == [REDIRECT]


async def test_register_confidential_client(db):
    client = await register(db, token_endpoint_auth_method="client_secret_basic")
    assert client["client_secret"]
    assert client["client_secret_expires_at"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {"redirect_uris": []},
        {"redirect_uris": [REDIRECT] * 11},
        {"redirect_uris": [REDIRECT], "grant_types": ["client_credentials"]},
        {"redirect_uris": [REDIRECT], "grant_types": ["authorization_code", "password"]},
        {"redirect_uris": [REDIRECT], "response_types": ["token"]},
        {"redirect_uris": [REDIRECT], "token_endpoint_auth_method": "private_key_jwt"},
    ],
)
async def test_register_rejects_bad_metadata(db, payload):
    with pytest.raises(oauth.OAuthError):
        await oauth.register_client(payload, db)


async def test_get_client_rejects_junk(db):
    assert await oauth.get_client(None, db) is None
    assert await oauth.get_client("x" * 300, db) is None


# ─── authorization request ───────────────────────────────────────────────────


async def test_start_authorization_signs_request(db, mcp_config, frontend):
    client = await register(db)
    _, challenge = pkce_pair()
    token = await authorize(db, client["client_id"], challenge, scope="mcp:read")
    data = oauth.read_authorization_request(token)
    assert data["client_id"] == client["client_id"]
    assert data["scope"] == "mcp:read"
    assert data["resource"] == "https://api.example.com/mcp"
    # A consent request never verifies as a session token.
    with pytest.raises(jwt.PyJWTError):
        jwt.decode(token, oauth.SECRET_KEY, algorithms=[oauth.ALGORITHM])


async def test_start_authorization_single_redirect_default(db, mcp_config, frontend):
    client = await register(db)
    _, challenge = pkce_pair()
    params = {"response_type": "code", "client_id": client["client_id"], "code_challenge": challenge, "code_challenge_method": "S256"}
    assert "/oauth/consent?request=" in await oauth.start_authorization(params, make_request(), db)


async def test_start_authorization_errors_without_redirect(db, mcp_config):
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.start_authorization({"client_id": "nope"}, make_request(), db)
    assert e.value.redirect_uri is None
    client = await register(db, redirect_uris=[REDIRECT, "https://b.test/cb"])
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.start_authorization({"client_id": client["client_id"]}, make_request(), db)
    assert e.value.error == "invalid_request" and e.value.redirect_uri is None
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.start_authorization(
            {"client_id": client["client_id"], "redirect_uri": "https://evil.test/cb"}, make_request(), db
        )
    assert e.value.redirect_uri is None


@pytest.mark.parametrize(
    "overrides,error",
    [
        ({"response_type": "token"}, "unsupported_response_type"),
        ({"code_challenge": "short"}, "invalid_request"),
        ({"code_challenge_method": "plain"}, "invalid_request"),
        ({"scope": "openid"}, "invalid_scope"),
        ({"resource": "https://other.test/mcp"}, "invalid_target"),
    ],
)
async def test_start_authorization_errors_are_never_redirected(db, mcp_config, overrides, error):
    # Registration is open, so before the member consents a redirect_uri is
    # just attacker input: errors are shown, not bounced to it.
    client = await register(db)
    _, challenge = pkce_pair()
    with pytest.raises(oauth.OAuthError) as e:
        await authorize(db, client["client_id"], challenge, **overrides)
    assert e.value.error == error
    assert e.value.redirect_uri is None


def test_error_redirect_carries_state():
    err = oauth.OAuthError("access_denied", "no", redirect_uri=REDIRECT, state="st")
    query = parse_qs(urlparse(oauth.error_redirect(err, "https://api.example.com")).query)
    assert query["error"] == ["access_denied"] and query["state"] == ["st"]


def test_read_authorization_request_rejects_bad_tokens():
    with pytest.raises(oauth.OAuthError):
        oauth.read_authorization_request(None)
    with pytest.raises(oauth.OAuthError):
        oauth.read_authorization_request("garbage")
    wrong_type = jwt.encode(
        {"typ": "other", "iat": int(time.time()), "exp": int(time.time()) + 60},
        oauth._request_signing_key(),
        algorithm=oauth.ALGORITHM,
    )
    with pytest.raises(oauth.OAuthError):
        oauth.read_authorization_request(wrong_type)
    expired = jwt.encode(
        {"typ": oauth._AUTH_REQUEST_TYPE, "iat": 1, "exp": 2},
        oauth._request_signing_key(),
        algorithm=oauth.ALGORITHM,
    )
    with pytest.raises(oauth.OAuthError):
        oauth.read_authorization_request(expired)


def test_redirect_with_existing_query():
    assert oauth.redirect_with("https://a.test/cb?x=1", {"code": "c", "state": None}) == "https://a.test/cb?x=1&code=c"


# ─── consent ─────────────────────────────────────────────────────────────────


async def test_describe_authorization(db, org, admin_user, mcp_config, frontend):
    client = await register(db)
    _, challenge = pkce_pair()
    token = await authorize(db, client["client_id"], challenge)
    info = await oauth.describe_authorization(token, admin_user, db)
    assert info["client"]["name"] == "Claude"
    assert info["client"]["redirect_host"] == "127.0.0.1:5555"
    assert [o["id"] for o in info["orgs"]] == [org.id]
    assert info["orgs"][0]["mcp_enabled"] is True


async def test_describe_authorization_unknown_client(db, admin_user, mcp_config, frontend):
    token = oauth.sign_authorization_request({"client_id": "gone", "redirect_uri": REDIRECT, "scope": "mcp:read"})
    with pytest.raises(oauth.OAuthError):
        await oauth.describe_authorization(token, admin_user, db)


async def test_decide_deny_redirects_with_access_denied(db, org, admin_user, mcp_config, frontend):
    client = await register(db)
    _, challenge = pkce_pair()
    token = await authorize(db, client["client_id"], challenge)
    location = await oauth.decide_authorization(token, admin_user, None, False, None, db)
    assert parse_qs(urlparse(location).query)["error"] == ["access_denied"]


async def test_decide_requires_membership(db, org, other_org, admin_user, mcp_config, frontend):
    client = await register(db)
    _, challenge = pkce_pair()
    token = await authorize(db, client["client_id"], challenge)
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.decide_authorization(token, admin_user, other_org.id, True, None, db)
    assert e.value.status_code == 403
    with pytest.raises(oauth.OAuthError):
        await oauth.decide_authorization(token, admin_user, None, True, None, db)


async def test_decide_refused_when_org_turned_mcp_off(db, org, admin_user, mcp_config, frontend):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}, creation_date="", update_date=""))
    await db.commit()
    client = await register(db)
    _, challenge = pkce_pair()
    token = await authorize(db, client["client_id"], challenge)
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.decide_authorization(token, admin_user, org.id, True, None, db)
    assert e.value.status_code == 403


async def test_decide_applies_org_policy(db, org, admin_user, mcp_config, frontend):
    client = await register(db)
    _, challenge = pkce_pair()
    token = await authorize(db, client["client_id"], challenge)
    with patch(
        "src.security.org_auth.enforce_org_mfa",
        new_callable=AsyncMock,
        side_effect=HTTPException(status_code=403, detail="2FA required"),
    ):
        with pytest.raises(HTTPException):
            await oauth.decide_authorization(token, admin_user, org.id, True, None, db)


async def test_decide_unknown_client(db, org, admin_user, mcp_config):
    token = oauth.sign_authorization_request({"client_id": "gone", "redirect_uri": REDIRECT, "scope": "mcp:read"})
    with pytest.raises(oauth.OAuthError):
        await oauth.decide_authorization(token, admin_user, org.id, True, None, db)


async def test_reconnecting_replaces_the_grant_and_its_tokens(db, org, admin_user, mcp_config, frontend):
    """A reconnect starts a new connection: tokens of the old one, which a
    password change or a narrower scope was meant to end, stay dead."""
    first_tokens = (await full_tokens(db, admin_user, org))[1]
    client_id = (await db.execute(select(MCPOAuthGrant.client_id))).scalars().first()
    _, challenge = pkce_pair()
    second = await authorize(db, client_id, challenge)
    query = await consent(db, admin_user, org.id, second, scope="mcp:read")
    assert query["iss"] == ["https://api.example.com"]
    grants = (await db.execute(select(MCPOAuthGrant).order_by(MCPOAuthGrant.id))).scalars().all()
    assert [g.revoked_at is not None for g in grants] == [True, False]
    assert grants[1].scope == "mcp:read"
    assert await oauth.verify_access_token(first_tokens["access_token"], "https://api.example.com/mcp", db) is None
    with pytest.raises(oauth.OAuthError):
        await oauth.exchange_token(
            {"grant_type": "refresh_token", "client_id": client_id, "refresh_token": first_tokens["refresh_token"]},
            None, make_request(), db,
        )


# ─── token endpoint ──────────────────────────────────────────────────────────


async def test_code_exchange_and_single_use(db, org, admin_user, mcp_config, frontend):
    verifier, challenge = pkce_pair()
    client = await register(db)
    query = await consent(db, admin_user, org.id, await authorize(db, client["client_id"], challenge))
    form = {"grant_type": "authorization_code", "client_id": client["client_id"], "code": query["code"][0], "redirect_uri": REDIRECT, "code_verifier": verifier, "resource": "https://api.example.com/mcp"}
    tokens = await oauth.exchange_token(form, None, make_request(), db)
    assert tokens["access_token"].startswith(oauth.ACCESS_TOKEN_PREFIX)
    assert tokens["refresh_token"].startswith(oauth.REFRESH_TOKEN_PREFIX)
    assert tokens["scope"] == "mcp:read mcp:write"
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token(form, None, make_request(), db)
    assert e.value.error == "invalid_grant"
    stored = (await db.execute(select(MCPOAuthToken))).scalars().all()
    assert all(len(t.token_hash) == 64 for t in stored)


async def _code(db, org, user, challenge, client):
    query = await consent(db, user, org.id, await authorize(db, client["client_id"], challenge))
    return query["code"][0]


@pytest.mark.parametrize(
    "mutate,error",
    [
        (lambda f: f.update(code_verifier="w" * 64), "invalid_grant"),
        (lambda f: f.pop("code_verifier"), "invalid_grant"),
        (lambda f: f.update(redirect_uri="http://127.0.0.1:5555/other"), "invalid_grant"),
        (lambda f: f.update(resource="https://other.test/mcp"), "invalid_target"),
        (lambda f: f.pop("code"), "invalid_request"),
        (lambda f: f.update(code="wrong"), "invalid_grant"),
    ],
)
async def test_code_exchange_failures(db, org, admin_user, mcp_config, frontend, mutate, error):
    verifier, challenge = pkce_pair()
    client = await register(db)
    form = {"grant_type": "authorization_code", "client_id": client["client_id"], "code": await _code(db, org, admin_user, challenge, client), "redirect_uri": REDIRECT, "code_verifier": verifier}
    mutate(form)
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token(form, None, make_request(), db)
    assert e.value.error == error


async def test_code_exchange_expired_and_wrong_client(db, org, admin_user, mcp_config, frontend):
    verifier, challenge = pkce_pair()
    client = await register(db)
    other = await register(db)
    code = await _code(db, org, admin_user, challenge, client)
    with pytest.raises(oauth.OAuthError):
        await oauth.exchange_token({"grant_type": "authorization_code", "client_id": other["client_id"], "code": code, "code_verifier": verifier}, None, make_request(), db)

    code = await _code(db, org, admin_user, challenge, client)
    row = (await db.execute(select(MCPOAuthCode))).scalars().first()
    row.expires_at = 1
    db.add(row)
    await db.commit()
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token({"grant_type": "authorization_code", "client_id": client["client_id"], "code": code, "code_verifier": verifier}, None, make_request(), db)
    assert "expired" in e.value.description


async def test_token_endpoint_client_errors(db, mcp_config):
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token({"grant_type": "authorization_code", "client_id": "nope"}, None, make_request(), db)
    assert e.value.status_code == 401
    client = await register(db)
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token({"grant_type": "password", "client_id": client["client_id"]}, None, make_request(), db)
    assert e.value.error == "unsupported_grant_type"


async def test_confidential_client_authentication(db, org, admin_user, mcp_config, frontend):
    client, tokens = await full_tokens(db, admin_user, org, auth_method="client_secret_post")
    secret = client["client_secret"]
    basic = "Basic " + base64.b64encode(f"{client['client_id']}:{secret}".encode()).decode()
    refreshed = await oauth.exchange_token({"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]}, basic, make_request(), db)
    assert refreshed["access_token"]
    bad_basic = "Basic " + base64.b64encode(f"{client['client_id']}:nope".encode()).decode()
    for auth, form in (
        (None, {"client_id": client["client_id"]}),
        (bad_basic, {}),
        ("Basic !!!", {"client_id": client["client_id"]}),
        ("Basic " + base64.b64encode(b"other:x").decode(), {"client_id": client["client_id"]}),
    ):
        with pytest.raises(oauth.OAuthError) as e:
            await oauth.exchange_token({"grant_type": "refresh_token", "refresh_token": refreshed["refresh_token"], **form}, auth, make_request(), db)
        assert e.value.error == "invalid_client"
    assert oauth._client_id_from_basic("Basic !!!") is None
    assert oauth._client_id_from_basic(None) is None


async def test_refresh_rotation_and_replay(db, org, admin_user, mcp_config, frontend):
    client, tokens = await full_tokens(db, admin_user, org)
    form = {"grant_type": "refresh_token", "client_id": client["client_id"], "refresh_token": tokens["refresh_token"]}
    rotated = await oauth.exchange_token(form, None, make_request(), db)
    assert rotated["refresh_token"] != tokens["refresh_token"]
    with pytest.raises(oauth.OAuthError):
        await oauth.exchange_token(form, None, make_request(), db)
    # The replay revoked the whole grant: the rotated token is dead too.
    with pytest.raises(oauth.OAuthError):
        await oauth.exchange_token({**form, "refresh_token": rotated["refresh_token"]}, None, make_request(), db)
    grant = (await db.execute(select(MCPOAuthGrant))).scalars().first()
    assert grant.revoked_at is not None
    assert await oauth.verify_access_token(rotated["access_token"], "https://api.example.com/mcp", db) is None


async def test_refresh_scope_narrowing(db, org, admin_user, mcp_config, frontend):
    client, tokens = await full_tokens(db, admin_user, org)
    narrowed = await oauth.exchange_token({"grant_type": "refresh_token", "client_id": client["client_id"], "refresh_token": tokens["refresh_token"], "scope": "mcp:read"}, None, make_request(), db)
    assert narrowed["scope"] == "mcp:read"
    _, ro = await full_tokens(db, admin_user, org, scope="mcp:read")
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token({"grant_type": "refresh_token", "client_id": _["client_id"], "refresh_token": ro["refresh_token"], "scope": "mcp:write"}, None, make_request(), db)
    assert e.value.error == "invalid_scope"


async def test_refresh_failures(db, org, admin_user, mcp_config, frontend):
    client, tokens = await full_tokens(db, admin_user, org)
    other = await register(db)
    for form in (
        {"client_id": client["client_id"], "refresh_token": "nope"},
        {"client_id": client["client_id"], "refresh_token": oauth.REFRESH_TOKEN_PREFIX + "unknown"},
        {"client_id": other["client_id"], "refresh_token": tokens["refresh_token"]},
    ):
        with pytest.raises(oauth.OAuthError):
            await oauth.exchange_token({"grant_type": "refresh_token", **form}, None, make_request(), db)

    token = (await db.execute(select(MCPOAuthToken).where(MCPOAuthToken.kind == "refresh"))).scalars().first()
    token.expires_at = 1
    db.add(token)
    await db.commit()
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token({"grant_type": "refresh_token", "client_id": client["client_id"], "refresh_token": tokens["refresh_token"]}, None, make_request(), db)
    assert "expired" in e.value.description


async def test_password_change_cuts_the_client_off(db, org, admin_user, mcp_config, frontend):
    client, tokens = await full_tokens(db, admin_user, org)
    user = await db.get(User, admin_user.id)
    user.password_changed_at = datetime.now(timezone.utc) + timedelta(seconds=5)
    db.add(user)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is None
    with pytest.raises(oauth.OAuthError):
        await oauth.exchange_token({"grant_type": "refresh_token", "client_id": client["client_id"], "refresh_token": tokens["refresh_token"]}, None, make_request(), db)


async def test_revoke_token(db, org, admin_user, mcp_config, frontend):
    client, tokens = await full_tokens(db, admin_user, org)
    with pytest.raises(oauth.OAuthError):
        await oauth.revoke_token({}, None, db)
    await oauth.revoke_token({"token": "unknown", "client_id": client["client_id"]}, None, db)
    other = await register(db)
    await oauth.revoke_token({"token": tokens["access_token"], "client_id": other["client_id"]}, None, db)
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is not None
    await oauth.revoke_token({"token": tokens["refresh_token"], "client_id": client["client_id"]}, None, db)
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is None


# ─── resource server ─────────────────────────────────────────────────────────


async def test_verify_access_token(db, org, admin_user, mcp_config, frontend):
    _, tokens = await full_tokens(db, admin_user, org, scope="mcp:read")
    principal = await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp/", db)
    assert principal.user.id == admin_user.id
    assert principal.org_id == org.id
    assert principal.scopes == ("mcp:read",)
    assert principal.client_name == "Claude"
    grant = (await db.execute(select(MCPOAuthGrant))).scalars().first()
    assert grant.last_used_at is not None

    assert await oauth.verify_access_token("lh_not_ours", "https://api.example.com/mcp", db) is None
    assert await oauth.verify_access_token(tokens["refresh_token"], "https://api.example.com/mcp", db) is None
    assert await oauth.verify_access_token(tokens["access_token"], "https://other.test/mcp", db) is None


async def test_verify_access_token_expired_or_grant_revoked(db, org, admin_user, mcp_config, frontend):
    _, tokens = await full_tokens(db, admin_user, org)
    access = (await db.execute(select(MCPOAuthToken).where(MCPOAuthToken.kind == "access"))).scalars().first()
    access.expires_at = 1
    db.add(access)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is None

    _, tokens = await full_tokens(db, admin_user, org)
    for grant in (await db.execute(select(MCPOAuthGrant))).scalars().all():
        grant.revoked_at = 5
        db.add(grant)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is None


async def test_grant_user_deleted(db, org, admin_user, mcp_config, frontend):
    grant = MCPOAuthGrant(grant_uuid="g", client_id="c", user_id=999, org_id=org.id, created_at=1)
    assert await oauth._grant_user_still_valid(grant, db) is False


# ─── connected apps ──────────────────────────────────────────────────────────


async def test_list_and_revoke_grants(db, org, admin_user, regular_user, mcp_config, frontend):
    await full_tokens(db, admin_user, org)
    await full_tokens(db, regular_user, org)
    everyone = await oauth.list_grants(org.id, db)
    assert {g["user"]["username"] for g in everyone} == {"admin", "regular"}
    mine = await oauth.list_grants(org.id, db, user_id=regular_user.id)
    assert len(mine) == 1 and mine[0]["scopes"] == ["mcp:read", "mcp:write"]

    admin_grant = next(g for g in everyone if g["user"]["username"] == "admin")
    assert await oauth.revoke_grant_by_uuid(admin_grant["grant_uuid"], org.id, db, user_id=regular_user.id) is False
    assert await oauth.revoke_grant_by_uuid(admin_grant["grant_uuid"], org.id, db) is True
    assert await oauth.revoke_grant_by_uuid(admin_grant["grant_uuid"], org.id, db) is False
    assert len(await oauth.list_grants(org.id, db)) == 1


async def test_grant_without_live_refresh_token_is_hidden(db, org, admin_user, mcp_config, frontend):
    client = await register(db)
    _, challenge = pkce_pair()
    await consent(db, admin_user, org.id, await authorize(db, client["client_id"], challenge))
    assert await oauth.list_grants(org.id, db) == []


async def test_prune_expired(db, org, admin_user, mcp_config, frontend):
    await full_tokens(db, admin_user, org)
    for token in (await db.execute(select(MCPOAuthToken))).scalars().all():
        token.expires_at = 1
        db.add(token)
    await db.commit()
    await oauth.prune_expired(db)
    assert (await db.execute(select(MCPOAuthToken))).scalars().all() == []


def test_oauth_error_dict():
    err = oauth.OAuthError("invalid_grant", "nope", 400)
    assert err.as_dict() == {"error": "invalid_grant", "error_description": "nope"}


async def test_registered_client_row(db):
    await register(db)
    assert len((await db.execute(select(MCPOAuthClient))).scalars().all()) == 1


async def test_prune_drops_abandoned_clients(db, org, admin_user, mcp_config, frontend):
    kept, _ = await full_tokens(db, admin_user, org)
    stale = await register(db)
    for row in (await db.execute(select(MCPOAuthClient))).scalars().all():
        row.created_at = 1
        db.add(row)
    await db.commit()
    await oauth.prune_expired(db)
    ids = {c.client_id for c in (await db.execute(select(MCPOAuthClient))).scalars().all()}
    assert ids == {kept["client_id"]}
    assert stale["client_id"] not in ids


async def test_maybe_prune_is_occasional(db):
    with patch.object(oauth.secrets, "randbelow", return_value=1), patch.object(oauth, "prune_expired", new_callable=AsyncMock) as prune:
        await oauth.maybe_prune(db)
    prune.assert_not_awaited()
    with patch.object(oauth.secrets, "randbelow", return_value=0), patch.object(oauth, "prune_expired", new_callable=AsyncMock) as prune:
        await oauth.maybe_prune(db)
    prune.assert_awaited_once()


# ─── admin scope, superadmins, connection lifetime ───────────────────────────


async def _open_grant(db, user_id):
    query = select(MCPOAuthGrant).where(MCPOAuthGrant.user_id == user_id, MCPOAuthGrant.revoked_at.is_(None))
    return (await db.execute(query.execution_options(populate_existing=True))).scalars().one()


async def test_admin_scope_needs_the_member_choice_and_role(db, org, admin_user, regular_user, mcp_config, frontend):
    _, challenge = pkce_pair()
    client = await register(db)
    # Nothing chosen: read and write, never admin.
    req = await authorize(db, client["client_id"], challenge)
    await consent(db, admin_user, org.id, req)
    grant = (await db.execute(select(MCPOAuthGrant).where(MCPOAuthGrant.user_id == admin_user.id))).scalars().first()
    assert grant.scope == "mcp:read mcp:write"
    # Chosen by an admin: granted.
    req = await authorize(db, client["client_id"], challenge)
    await consent(db, admin_user, org.id, req, scope="mcp:read mcp:write mcp:admin")
    grant = await _open_grant(db, admin_user.id)
    assert grant.scope == "mcp:read mcp:write mcp:admin"
    # Chosen by a learner: refused.
    req = await authorize(db, client["client_id"], challenge)
    with pytest.raises(oauth.OAuthError) as e:
        await consent(db, regular_user, org.id, req, scope="mcp:admin")
    assert e.value.error == "access_denied"
    # The app's request caps the choice.
    req = await authorize(db, client["client_id"], challenge, scope="mcp:read")
    await consent(db, admin_user, org.id, req, scope="mcp:read mcp:write mcp:admin")
    assert (await _open_grant(db, admin_user.id)).scope == "mcp:read"


@pytest.mark.parametrize(
    "uri",
    [
        "https://trusted.example@evil.test:8443/cb",
        # Browsers read the backslash as a slash and land on evil.test.
        "https://evil.test\\@trusted.example/cb",
        "http://evil.invalid\\@localhost/cb",
        "https://user:pass@trusted.example/cb",
        "https://trusted.example/c b",
        "https://trusted.example/\tcb",
        "https://trusted.example/cb\x00",
    ],
)
def test_redirect_uris_browsers_and_python_read_apart_are_refused(uri):
    with pytest.raises(oauth.OAuthError) as e:
        oauth.validate_redirect_uri(uri)
    assert e.value.error == "invalid_redirect_uri"


async def test_describe_marks_admin_orgs_and_shows_app_schemes(db, org, admin_user, regular_user, mcp_config, frontend):
    _, challenge = pkce_pair()
    client = await register(db, redirect_uris=["https://evil.test:8443/cb", "cursor://anysphere.cursor-mcp/cb"])
    params = {
        "response_type": "code", "client_id": client["client_id"],
        "redirect_uri": "https://evil.test:8443/cb",
        "code_challenge": challenge, "code_challenge_method": "S256",
    }
    target = await oauth.start_authorization(params, make_request(), db)
    token = parse_qs(urlparse(target).query)["request"][0]
    info = await oauth.describe_authorization(token, admin_user, db)
    assert info["client"]["redirect_host"] == "evil.test:8443"
    app = await oauth.start_authorization({**params, "redirect_uri": "cursor://anysphere.cursor-mcp/cb"}, make_request(), db)
    app_info = await oauth.describe_authorization(parse_qs(urlparse(app).query)["request"][0], admin_user, db)
    # An app scheme opens whatever program claims it: the member sees the scheme.
    assert app_info["client"]["redirect_host"] == "cursor://anysphere.cursor-mcp"
    assert info["orgs"][0]["can_admin"] is True
    learner = await oauth.describe_authorization(token, regular_user, db)
    assert learner["orgs"][0]["can_admin"] is False


async def test_superadmin_needs_real_membership_and_loses_the_flag(db, org, other_org, admin_user, mcp_config, frontend):
    row = await db.get(User, admin_user.id)
    row.is_superadmin = True
    db.add(row)
    await db.commit()
    admin_user = admin_user.model_copy(update={"is_superadmin": True})
    _, challenge = pkce_pair()
    client = await register(db)
    req = await authorize(db, client["client_id"], challenge)
    # Superadmins pass is_org_member everywhere, but consent wants a real row.
    with pytest.raises(oauth.OAuthError):
        await consent(db, admin_user, other_org.id, req)
    _, tokens = await full_tokens(db, admin_user, org)
    found = await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db)
    assert found is not None and found.user.is_superadmin is False


async def test_reconnecting_restarts_the_connection_clock(db, org, admin_user, mcp_config, frontend):
    _, tokens = await full_tokens(db, admin_user, org)
    grant = (await db.execute(select(MCPOAuthGrant).where(MCPOAuthGrant.user_id == admin_user.id))).scalars().first()
    grant.created_at -= oauth.MAX_GRANT_AGE + 10
    db.add(grant)
    await db.commit()
    # Too old: tokens stop working.
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is None
    # Reconnecting the same app reuses the grant and restarts its clock.
    _, fresh = await full_tokens(db, admin_user, org)
    assert await oauth.verify_access_token(fresh["access_token"], "https://api.example.com/mcp", db) is not None


async def test_leaving_the_org_cuts_the_connection(db, org, admin_user, mcp_config, frontend):
    _, tokens = await full_tokens(db, admin_user, org)
    row = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == admin_user.id))).scalars().first()
    await db.delete(row)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is None


async def test_revoke_member_grants(db, org, other_org, admin_user, mcp_config, frontend):
    await full_tokens(db, admin_user, org)
    assert await oauth.revoke_member_grants(db, admin_user.id, other_org.id) == 0
    assert await oauth.revoke_member_grants(db, admin_user.id, org.id) == 1
    await db.commit()
    assert await oauth.list_grants(org.id, db) == []
    assert await oauth.revoke_member_grants(db, admin_user.id) == 0


async def test_token_step_needs_redirect_uri_when_ambiguous(db, org, admin_user, mcp_config, frontend):
    verifier, challenge = pkce_pair()
    client = await register(db, redirect_uris=[REDIRECT, "http://127.0.0.1:5555/other"])
    req = await authorize(db, client["client_id"], challenge)
    query = await consent(db, admin_user, org.id, req)
    form = {"grant_type": "authorization_code", "client_id": client["client_id"], "code": query["code"][0], "code_verifier": verifier}
    with pytest.raises(oauth.OAuthError) as e:
        await oauth.exchange_token(form, None, make_request(), db)
    assert e.value.error == "invalid_request"


async def test_password_change_compares_in_utc(db, org, admin_user, mcp_config, frontend):
    from datetime import datetime, timedelta, timezone

    _, tokens = await full_tokens(db, admin_user, org)
    user = await db.get(User, admin_user.id)
    # Naive UTC a minute before consent: still valid whatever the local zone.
    user.password_changed_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).replace(tzinfo=None)
    db.add(user)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is not None
    user.password_changed_at = (datetime.now(timezone.utc) + timedelta(minutes=1)).replace(tzinfo=None)
    db.add(user)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], "https://api.example.com/mcp", db) is None
