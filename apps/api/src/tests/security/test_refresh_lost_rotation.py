"""
Lost-rotation recovery for refresh tokens.

A refresh rotates the token; if the response carrying the rotated cookie never
reaches the browser (tab closed mid-request, laptop asleep, dropped
connection), the browser keeps presenting the consumed token. Past the short
grace window that used to count as theft and revoke every session on every
device. These tests drive the real endpoint and the real redis helpers (with an
in-memory redis) through that scenario and the genuine-theft one.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.auth import JWT_REFRESH_COOKIE_NAME, router as auth_router
from src.security import auth as auth_mod
from src.security.auth import (
    create_refresh_token,
    get_current_user,
    refresh_token_jti,
)


class _FakeRedis:
    """In-memory stand-in covering the calls the refresh helpers make."""

    def __init__(self):
        self.store: dict[str, object] = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def setex(self, key, _ttl, value):
        self.store[key] = value

    def get(self, key):
        return self.store.get(key)

    def expire_grace(self):
        """Simulate the grace window lapsing."""
        for key in [k for k in self.store if k.startswith("refresh_grace:")]:
            del self.store[key]


class _BrokenRedis:
    def setex(self, *_a, **_k):
        raise RuntimeError("down")

    def get(self, *_a, **_k):
        raise RuntimeError("down")


USER = SimpleNamespace(id=7, email="learner@test.com", password_changed_at=None)


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def redis():
    fake = _FakeRedis()
    with patch("src.security.auth._get_revocation_redis_client", return_value=fake), \
         patch("src.routers.auth.check_refresh_rate_limit", return_value=(True, None)), \
         patch("src.routers.auth.security_get_user", new_callable=AsyncMock, return_value=USER), \
         patch("src.routers.auth._is_token_revoked_for_user", return_value=False), \
         patch("src.routers.auth.get_cookie_domain_for_request", return_value=None), \
         patch("src.routers.auth.is_request_secure", return_value=False), \
         patch("asyncio.sleep", new_callable=AsyncMock):
        yield fake


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _refresh(client, token):
    client.cookies.clear()
    return await client.get("/api/v1/auth/refresh", cookies={JWT_REFRESH_COOKIE_NAME: token})


def _rotated(response) -> str:
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{JWT_REFRESH_COOKIE_NAME}="):
            return header.split(";", 1)[0].split("=", 1)[1]
    raise AssertionError("no rotated refresh cookie")


@pytest.mark.asyncio
async def test_lost_rotation_is_recovered_not_revoked(client, redis):
    original = create_refresh_token({"sub": USER.email})
    first = await _refresh(client, original)
    assert first.status_code == 200
    # The browser never stores this rotated token; time passes.
    redis.expire_grace()

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        again = await _refresh(client, original)

    assert again.status_code == 200
    revoke.assert_not_called()
    recovered = _rotated(again)
    assert recovered not in (original, _rotated(first))
    # The recovered token keeps working like any other.
    assert (await _refresh(client, recovered)).status_code == 200


@pytest.mark.asyncio
async def test_replay_after_successor_was_used_still_revokes(client, redis):
    original = create_refresh_token({"sub": USER.email})
    first = await _refresh(client, original)
    # The chain moved on: the rotated token was presented.
    assert (await _refresh(client, _rotated(first))).status_code == 200
    redis.expire_grace()

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        replay = await _refresh(client, original)

    assert replay.status_code == 401
    revoke.assert_called_once_with(USER.id)


@pytest.mark.asyncio
async def test_lost_successor_presented_after_recovery_is_theft(client, redis):
    original = create_refresh_token({"sub": USER.email})
    lost = _rotated(await _refresh(client, original))
    redis.expire_grace()
    assert (await _refresh(client, original)).status_code == 200
    redis.expire_grace()

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        late = await _refresh(client, lost)

    # The successor a recovery superseded is dead: presenting it is a replay.
    assert late.status_code == 401
    revoke.assert_called_once_with(USER.id)


@pytest.mark.asyncio
async def test_a_token_is_recovered_at_most_once(client, redis):
    original = create_refresh_token({"sub": USER.email})
    await _refresh(client, original)
    redis.expire_grace()
    recovered = _rotated(await _refresh(client, original))
    redis.expire_grace()

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        second = await _refresh(client, original)

    # Even though the recovered token is still unused, a second recovery of
    # the same token is refused, so two holders can't ping-pong a chain.
    assert second.status_code == 401
    revoke.assert_called_once_with(USER.id)
    assert recovered


@pytest.mark.asyncio
async def test_concurrent_recovery_loser_reuses_the_winners_pair(client, redis):
    original = create_refresh_token({"sub": USER.email})
    successor = refresh_token_jti(_rotated(await _refresh(client, original)))
    redis.expire_grace()
    original_jti = refresh_token_jti(original)
    # Another request already claimed the successor and cached its pair.
    redis.set(f"refresh_used:{USER.id}:{successor}", "1")
    auth_mod._store_refresh_grace(USER.id, original_jti, "winner-access", "winner-refresh")

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        response = await _refresh(client, original)

    assert response.status_code == 200
    assert response.json()["access_token"] == "winner-access"
    assert _rotated(response) == "winner-refresh"
    revoke.assert_not_called()


@pytest.mark.asyncio
async def test_rotation_records_the_successor(client, redis):
    original = create_refresh_token({"sub": USER.email})
    rotated = _rotated(await _refresh(client, original))
    assert auth_mod._get_refresh_successor(USER.id, refresh_token_jti(original)) == refresh_token_jti(rotated)


def test_successor_helpers_without_redis():
    with patch("src.security.auth._get_revocation_redis_client", return_value=None):
        auth_mod._record_refresh_successor(1, "a", "b")
        assert auth_mod._get_refresh_successor(1, "a") is None
        # No redis, no recovery bookkeeping: recovery is refused (fail closed).
        assert auth_mod._mark_refresh_recovered(1, "a") is False


def test_successor_helpers_survive_redis_errors():
    with patch("src.security.auth._get_revocation_redis_client", return_value=_BrokenRedis()):
        auth_mod._record_refresh_successor(1, "a", "b")
        assert auth_mod._get_refresh_successor(1, "a") is None
        assert auth_mod._mark_refresh_recovered(1, "a") is False


def test_successor_lookup_decodes_bytes():
    fake = _FakeRedis()
    fake.store["refresh_successor:1:a"] = b"next"
    with patch("src.security.auth._get_revocation_redis_client", return_value=fake):
        assert auth_mod._get_refresh_successor(1, "a") == "next"


def test_refresh_token_jti_rejects_garbage():
    assert refresh_token_jti("not-a-token") is None


@pytest.mark.asyncio
async def test_concurrent_recovery_loser_waits_for_the_winners_pair(client, redis):
    original = create_refresh_token({"sub": USER.email})
    successor = refresh_token_jti(_rotated(await _refresh(client, original)))
    redis.expire_grace()
    redis.set(f"refresh_used:{USER.id}:{successor}", "1")
    original_jti = refresh_token_jti(original)
    real_get = auth_mod._get_refresh_grace
    calls = {"n": 0}

    def slow_winner(user_id, jti):
        # The winner writes its pair while the loser is already polling.
        calls["n"] += 1
        if calls["n"] == 17:
            auth_mod._store_refresh_grace(USER.id, original_jti, "late-access", "late-refresh")
        return real_get(user_id, jti)

    with patch("src.routers.auth._get_refresh_grace", side_effect=slow_winner), \
         patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        response = await _refresh(client, original)

    assert response.status_code == 200
    assert response.json()["access_token"] == "late-access"
    revoke.assert_not_called()


@pytest.mark.asyncio
async def test_claimed_successor_without_a_pair_is_treated_as_theft(client, redis):
    original = create_refresh_token({"sub": USER.email})
    successor = refresh_token_jti(_rotated(await _refresh(client, original)))
    redis.expire_grace()
    redis.set(f"refresh_used:{USER.id}:{successor}", "1")

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        response = await _refresh(client, original)

    assert response.status_code == 401
    revoke.assert_called_once_with(USER.id)


def test_successor_lookup_unknown_jti():
    with patch("src.security.auth._get_revocation_redis_client", return_value=_FakeRedis()):
        assert auth_mod._get_refresh_successor(1, "never-rotated") is None
