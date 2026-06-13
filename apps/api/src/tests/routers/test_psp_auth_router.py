import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.routers import psp_auth


class FakeRedis:
    def __init__(self):
        self.store = {}

    def setex(self, key, ttl, value):
        self.store[key] = value

    def getdel(self, key):
        return self.store.pop(key, None)


@pytest.fixture
def client(monkeypatch):
    fake = FakeRedis()

    async def _noop_ensure(_email):
        return None

    monkeypatch.setattr(psp_auth, "get_redis_client", lambda: fake)
    monkeypatch.setattr(psp_auth, "validate_shell_token", lambda t: "user@opengov.com")
    monkeypatch.setattr(psp_auth, "_ensure_lh_user", _noop_ensure)
    monkeypatch.setattr(psp_auth, "create_access_token", lambda data: "ACCESS")
    monkeypatch.setattr(psp_auth, "create_refresh_token", lambda data: "REFRESH")
    monkeypatch.setenv("NEXT_PUBLIC_LEARNHOUSE_URL", "https://lms.example.com")

    app = FastAPI()
    app.include_router(psp_auth.psp_router, prefix="/api/v1/psp")
    app.include_router(psp_auth.platform_router)
    return TestClient(app), fake


def test_token_exchange_issues_code(client):
    c, fake = client
    res = c.post("/api/v1/psp/token-exchange", headers={"Authorization": "Bearer shelltok"})
    assert res.status_code == 200
    body = res.json()
    assert body["learnhouse_url"] == "https://lms.example.com"
    code = body["code"]
    assert fake.store[f"psp_code:{code}"]


def test_exchange_code_is_single_use(client):
    c, fake = client
    code = c.post("/api/v1/psp/token-exchange", headers={"Authorization": "Bearer t"}).json()["code"]

    first = c.get(f"/api/auth/exchange-code?code={code}")
    assert first.status_code == 200
    assert first.json() == {"access_token": "ACCESS", "refresh_token": "REFRESH"}

    second = c.get(f"/api/auth/exchange-code?code={code}")
    assert second.status_code == 404


def test_token_exchange_rejects_bad_shell_token(client, monkeypatch):
    c, _ = client

    def boom(_t):
        raise psp_auth.ShellTokenError("nope")

    monkeypatch.setattr(psp_auth, "validate_shell_token", boom)
    res = c.post("/api/v1/psp/token-exchange", headers={"Authorization": "Bearer bad"})
    assert res.status_code == 401
