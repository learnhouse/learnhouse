"""Router + service tests for the user interface preferences
(/users/me/preferences, src/services/users/preferences.py)."""

from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.users import APITokenUser, PublicUser, User, UserRead
from src.routers.users import router as users_router
from src.security.auth import get_authenticated_user, get_current_user
from src.services.users.preferences import preferences_from

URL = "/api/v1/users/me/preferences"


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _stored(db, user_id):
    db.expire_all()
    user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    return user.ui_preferences


class TestPreferences:
    async def test_unset_by_default(self, client):
        res = await client.get(URL)
        assert res.status_code == 200
        assert res.json() == {"theme": None}

    async def test_set_theme_round_trip_and_invalidates_session(self, client, db, admin_user):
        with patch("src.routers.users._invalidate_session_cache") as invalidate:
            res = await client.put(URL, json={"theme": "dark"})
        assert res.status_code == 200
        assert res.json() == {"theme": "dark"}
        invalidate.assert_called_once_with(admin_user.id)
        assert (await client.get(URL)).json() == {"theme": "dark"}
        assert await _stored(db, admin_user.id) == {"theme": "dark"}

        # Back to light.
        res = await client.put(URL, json={"theme": "light"})
        assert res.json() == {"theme": "light"}

    async def test_partial_update_keeps_other_keys(self, client, db, admin_user):
        user = (await db.execute(select(User).where(User.id == admin_user.id))).scalars().first()
        user.ui_preferences = {"theme": "dark", "future": 1}
        db.add(user)
        await db.commit()
        # An empty body changes nothing.
        res = await client.put(URL, json={})
        assert res.json() == {"theme": "dark"}
        assert await _stored(db, admin_user.id) == {"theme": "dark", "future": 1}

    async def test_rejects_unknown_theme(self, client):
        res = await client.put(URL, json={"theme": "system"})
        assert res.status_code == 422

    async def test_api_tokens_have_no_preferences(self, app, client):
        token = APITokenUser(org_id=1, created_by_user_id=1)
        app.dependency_overrides[get_authenticated_user] = lambda: token
        assert (await client.get(URL)).status_code == 403
        assert (await client.put(URL, json={"theme": "dark"})).status_code == 403

    async def test_missing_user_is_404(self, app, client):
        ghost = PublicUser(
            id=999, username="ghost", first_name="G", last_name="H",
            email="ghost@test.com", user_uuid="user_ghost",
        )
        app.dependency_overrides[get_authenticated_user] = lambda: ghost
        assert (await client.get(URL)).status_code == 404
        assert (await client.put(URL, json={"theme": "dark"})).status_code == 404

    async def test_session_user_carries_preferences(self, client, db, admin_user):
        await client.put(URL, json={"theme": "dark"})
        db.expire_all()
        user = (await db.execute(select(User).where(User.id == admin_user.id))).scalars().first()
        assert UserRead.model_validate(user).ui_preferences == {"theme": "dark"}


class TestPreferencesFrom:
    def test_invalid_blobs_read_as_unset(self):
        assert preferences_from(None).theme is None
        assert preferences_from("dark").theme is None
        assert preferences_from({"theme": "neon"}).theme is None
        assert preferences_from({"theme": "dark"}).theme == "dark"
