"""Router tests for the MCP OAuth endpoints (src/routers/mcp_oauth.py)."""

import base64
import hashlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.users import AnonymousUser, APITokenUser
from src.routers import mcp_oauth
from src.security.auth import get_current_user

REDIRECT = "http://127.0.0.1:5555/callback"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(mcp_oauth.public_router)
    app.include_router(mcp_oauth.router, prefix="/api/v1/mcp")
    app.dependency_overrides[get_db_session] = lambda: db
    with patch("src.services.mcp.oauth.get_learnhouse_config") as get_config, patch(
        "src.services.email.utils._configured_frontend_base_url", return_value="https://app.test"
    ), patch.object(mcp_oauth, "check_rate_limit", return_value=(True, 1, 60)), patch(
        "src.security.org_auth.enforce_org_mfa", new_callable=AsyncMock
    ):
        get_config.return_value.mcp_config = SimpleNamespace(enabled=True, public_url=None)
        get_config.return_value.hosting_config.ssl = False
        yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://api.test") as c:
        yield c


def as_user(app, user):
    app.dependency_overrides[get_current_user] = lambda: user


async def register(client):
    resp = await client.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": [REDIRECT]})
    assert resp.status_code == 201
    return resp.json()["client_id"]


async def start(client, client_id, **extra):
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT, "code_challenge": CHALLENGE, "code_challenge_method": "S256", "state": "s", **extra}
    return await client.get("/oauth/authorize", params=params)


async def test_discovery(client):
    prm = (await client.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert prm["resource"] == "http://api.test/mcp"
    assert (await client.get("/.well-known/oauth-protected-resource")).json() == prm
    asm = (await client.get("/.well-known/oauth-authorization-server")).json()
    assert asm["issuer"] == "http://api.test"
    assert (await client.get("/.well-known/openid-configuration")).json() == asm


async def test_register_errors_and_rate_limit(app, client):
    resp = await client.post("/oauth/register", content=b"not json", headers={"content-type": "application/json"})
    assert resp.status_code == 400 and resp.json()["error"] == "invalid_client_metadata"
    with patch.object(mcp_oauth, "check_rate_limit", return_value=(False, 99, 60)):
        assert (await client.post("/oauth/register", json={})).status_code == 429
    with patch.object(mcp_oauth, "check_rate_limit", side_effect=RuntimeError("redis down")):
        assert (await client.post("/oauth/register", json={"redirect_uris": [REDIRECT]})).status_code == 201


async def test_authorize_redirects_to_consent_or_reports(client):
    client_id = await register(client)
    resp = await start(client, client_id)
    assert resp.status_code == 302
    assert resp.headers["location"].startswith("https://app.test/oauth/consent?request=")
    bad = await start(client, client_id, response_type="token")
    assert bad.status_code == 400 and "text/html" in bad.headers["content-type"]
    unknown = await start(client, "nope")
    assert unknown.status_code == 400 and "text/html" in unknown.headers["content-type"]


async def _consent_token(client, client_id):
    resp = await start(client, client_id)
    return parse_qs(urlparse(resp.headers["location"]).query)["request"][0]


async def test_full_flow(app, client, org, admin_user):
    client_id = await register(client)
    token = await _consent_token(client, client_id)

    as_user(app, AnonymousUser())
    assert (await client.get("/api/v1/mcp/oauth/authorize", params={"request": token})).status_code == 401
    as_user(app, APITokenUser(org_id=org.id))
    assert (await client.post("/api/v1/mcp/oauth/authorize", json={"request": token, "approve": True})).status_code == 401

    as_user(app, admin_user)
    info = (await client.get("/api/v1/mcp/oauth/authorize", params={"request": token})).json()
    assert info["orgs"][0]["id"] == org.id
    assert (await client.get("/api/v1/mcp/oauth/authorize", params={"request": "junk"})).status_code == 400
    assert (await client.post("/api/v1/mcp/oauth/authorize", json={"request": token, "approve": True})).status_code == 403

    resp = await client.post("/api/v1/mcp/oauth/authorize", json={"request": token, "approve": True, "org_id": org.id})
    code = parse_qs(urlparse(resp.json()["redirect_to"]).query)["code"][0]

    resp = await client.post("/oauth/token", data={"grant_type": "authorization_code", "client_id": client_id, "code": code, "code_verifier": VERIFIER, "redirect_uri": REDIRECT})
    assert resp.status_code == 200 and resp.headers["cache-control"] == "no-store"
    tokens = resp.json()

    resp = await client.post("/oauth/token", json={"grant_type": "refresh_token", "client_id": client_id, "refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 200
    replay = await client.post("/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id, "refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 400

    unknown = await client.post("/oauth/token", data={"grant_type": "authorization_code", "client_id": "nope"})
    assert unknown.status_code == 401 and "Basic" in unknown.headers["www-authenticate"]
    with patch.object(mcp_oauth, "check_rate_limit", return_value=(False, 99, 60)):
        assert (await client.post("/oauth/token", data={})).status_code == 429

    assert (await client.post("/oauth/revoke", data={"token": "x"})).status_code == 200
    assert (await client.post("/oauth/revoke", data={})).status_code == 400
    assert (await client.post("/oauth/token", content=b"{bad", headers={"content-type": "application/json"})).status_code == 401
    assert (await client.post("/oauth/token", json=[1, 2])).status_code == 401


async def test_deny(app, client, org, admin_user):
    as_user(app, admin_user)
    token = await _consent_token(client, await register(client))
    resp = await client.post("/api/v1/mcp/oauth/authorize", json={"request": token, "approve": False})
    assert "error=access_denied" in resp.json()["redirect_to"]


async def test_connections_and_settings(app, client, db, org, admin_user, regular_user, other_org):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0"}, creation_date="", update_date=""))
    await db.commit()

    as_user(app, regular_user)
    assert (await client.get(f"/api/v1/mcp/orgs/{org.id}/connections")).json() == []
    assert (await client.get(f"/api/v1/mcp/orgs/{org.id}/connections", params={"scope": "org"})).status_code == 403
    assert (await client.get(f"/api/v1/mcp/orgs/{other_org.id}/connections")).status_code == 403
    assert (await client.get("/api/v1/mcp/orgs/999/connections")).status_code == 404
    assert (await client.delete(f"/api/v1/mcp/orgs/{org.id}/connections/nope")).status_code == 404
    assert (await client.delete(f"/api/v1/mcp/orgs/{other_org.id}/connections/nope")).status_code == 403
    settings = (await client.get(f"/api/v1/mcp/orgs/{org.id}/settings")).json()
    assert settings["enabled"] is True and settings["mcp_url"] == "http://api.test/mcp"
    assert (await client.get(f"/api/v1/mcp/orgs/{other_org.id}/settings")).status_code == 403
    assert (await client.put(f"/api/v1/mcp/orgs/{org.id}/settings", json={"enabled": False})).status_code == 403

    as_user(app, admin_user)
    assert (await client.get(f"/api/v1/mcp/orgs/{org.id}/connections", params={"scope": "org"})).json() == []
    resp = await client.put(f"/api/v1/mcp/orgs/{org.id}/settings", json={"enabled": False})
    assert resp.json() == {"enabled": False}
    assert (await client.get(f"/api/v1/mcp/orgs/{org.id}/settings")).json()["enabled"] is False

    with patch.object(mcp_oauth.oauth, "revoke_grant_by_uuid", new_callable=AsyncMock, return_value=True):
        assert (await client.delete(f"/api/v1/mcp/orgs/{org.id}/connections/g")).status_code == 200


async def test_consent_error_status_passthrough(app, client, org, admin_user):
    as_user(app, admin_user)
    token = await _consent_token(client, await register(client))
    with patch.object(mcp_oauth.oauth, "decide_authorization", new_callable=AsyncMock, side_effect=mcp_oauth.oauth.OAuthError("access_denied", "nope", 403)):
        resp = await client.post("/api/v1/mcp/oauth/authorize", json={"request": token, "approve": True, "org_id": org.id})
    assert resp.status_code == 403 and resp.json()["detail"] == "nope"


async def test_settings_put_applies_org_policy(app, client, org, admin_user):
    as_user(app, admin_user)
    with patch("src.security.org_auth.enforce_org_mfa", new_callable=AsyncMock, side_effect=HTTPException(status_code=403, detail="2FA")):
        assert (await client.put(f"/api/v1/mcp/orgs/{org.id}/settings", json={"enabled": True})).status_code == 403


# ─── approvals ───────────────────────────────────────────────────────────────


@pytest.fixture
def fake_redis():
    from src.services.mcp import approvals
    from src.tests.services.test_mcp_approvals import FakeRedis

    fake = FakeRedis()
    with patch.object(approvals, "get_redis_client", return_value=fake):
        yield approvals


async def test_approval_endpoints(app, client, org, other_org, admin_user, regular_user, fake_redis):
    approvals = fake_redis
    made = approvals.create(
        grant="mcpgrant_1", user_id=admin_user.id, org_id=org.id, tool="delete_course",
        arguments={"course_uuid": "course_1"}, summary="Delete course \"Intro\"", client_name="Claude",
        target={"kind": "course", "name": "Intro"},
    )
    path = f"/api/v1/mcp/approvals/{made.id}"

    as_user(app, AnonymousUser())
    assert (await client.get(path)).status_code == 401
    # Someone else's request looks missing, and they cannot answer it.
    as_user(app, regular_user)
    assert (await client.get(path)).status_code == 404
    assert (await client.post(path, json={"approve": True})).status_code == 404

    as_user(app, admin_user)
    shown = (await client.get(path)).json()
    assert shown["summary"] == 'Delete course "Intro"' and shown["org"]["id"] == org.id and shown["status"] == "pending"
    assert "digest" not in shown and "grant" not in shown
    assert (await client.post(path, json={"approve": True})).json() == {"status": "approved"}
    assert (await client.post(path, json={"approve": False})).status_code == 409
    assert (await client.get("/api/v1/mcp/approvals/apr_nope")).status_code == 404


async def test_approval_needs_current_membership(app, client, org, other_org, admin_user, fake_redis):
    approvals = fake_redis
    made = approvals.create(grant="g", user_id=admin_user.id, org_id=other_org.id, tool="t", arguments={}, summary="s")
    as_user(app, admin_user)
    assert (await client.get(f"/api/v1/mcp/approvals/{made.id}")).status_code == 404


async def test_approval_store_down(app, client, admin_user):
    from src.services.mcp import approvals

    as_user(app, admin_user)
    with patch.object(approvals, "get_redis_client", return_value=None):
        assert (await client.get("/api/v1/mcp/approvals/apr_x")).status_code == 503
