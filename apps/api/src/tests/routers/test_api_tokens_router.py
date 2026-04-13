"""Router tests for src/routers/api_tokens.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.api_tokens import APITokenCreatedResponse, APITokenRead
from src.routers.api_tokens import router as api_tokens_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(api_tokens_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _mock_token_read(**overrides) -> APITokenRead:
    data = dict(
        id=1,
        token_uuid="apitoken_test",
        name="Test Token",
        description="desc",
        token_prefix="lh_test",
        org_id=1,
        rights=None,
        created_by_user_id=1,
        creation_date="2024-01-01",
        update_date="2024-01-01",
        last_used_at=None,
        expires_at=None,
        is_active=True,
    )
    data.update(overrides)
    return APITokenRead(**data)


def _mock_token_created(**overrides) -> APITokenCreatedResponse:
    data = dict(
        token="lh_secret_token",
        token_uuid="apitoken_test",
        name="Test Token",
        description="desc",
        token_prefix="lh_test",
        org_id=1,
        rights=None,
        created_by_user_id=1,
        creation_date="2024-01-01",
        expires_at=None,
    )
    data.update(overrides)
    return APITokenCreatedResponse(**data)


class TestApiTokensRouter:
    async def test_create_api_token(self, client):
        with patch(
            "src.routers.api_tokens.check_api_token_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.api_tokens.create_api_token",
            new_callable=AsyncMock,
            return_value=_mock_token_created(),
        ):
            response = await client.post(
                "/api/v1/orgs/1/api-tokens",
                json={"name": "Test Token"},
            )

        assert response.status_code == 200
        assert response.json()["token_uuid"] == "apitoken_test"

    async def test_create_api_token_rate_limited(self, client):
        with patch(
            "src.routers.api_tokens.check_api_token_rate_limit",
            return_value=(False, 30),
        ):
            response = await client.post(
                "/api/v1/orgs/1/api-tokens",
                json={"name": "Test Token"},
            )

        assert response.status_code == 429
        assert response.headers["retry-after"] == "30"

    async def test_list_api_tokens(self, client):
        with patch(
            "src.routers.api_tokens.list_api_tokens",
            new_callable=AsyncMock,
            return_value=[_mock_token_read()],
        ):
            response = await client.get("/api/v1/orgs/1/api-tokens")

        assert response.status_code == 200
        assert response.json()[0]["token_uuid"] == "apitoken_test"

    async def test_get_api_token(self, client):
        with patch(
            "src.routers.api_tokens.get_api_token",
            new_callable=AsyncMock,
            return_value=_mock_token_read(),
        ):
            response = await client.get("/api/v1/orgs/1/api-tokens/apitoken_test")

        assert response.status_code == 200
        assert response.json()["name"] == "Test Token"

    async def test_update_api_token(self, client):
        with patch(
            "src.routers.api_tokens.update_api_token",
            new_callable=AsyncMock,
            return_value=_mock_token_read(name="Updated Token"),
        ):
            response = await client.put(
                "/api/v1/orgs/1/api-tokens/apitoken_test",
                json={"name": "Updated Token"},
            )

        assert response.status_code == 200
        assert response.json()["name"] == "Updated Token"

    async def test_revoke_api_token(self, client):
        with patch(
            "src.routers.api_tokens.revoke_api_token",
            new_callable=AsyncMock,
            return_value={"detail": "revoked"},
        ):
            response = await client.delete("/api/v1/orgs/1/api-tokens/apitoken_test")

        assert response.status_code == 200
        assert response.json()["detail"] == "revoked"

    async def test_regenerate_api_token(self, client):
        with patch(
            "src.routers.api_tokens.check_api_token_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.api_tokens.regenerate_api_token",
            new_callable=AsyncMock,
            return_value=_mock_token_created(token="lh_new_token"),
        ):
            response = await client.post(
                "/api/v1/orgs/1/api-tokens/apitoken_test/regenerate"
            )

        assert response.status_code == 200
        assert response.json()["token"] == "lh_new_token"

    async def test_regenerate_api_token_rate_limited(self, client):
        with patch(
            "src.routers.api_tokens.check_api_token_rate_limit",
            return_value=(False, 45),
        ):
            response = await client.post(
                "/api/v1/orgs/1/api-tokens/apitoken_test/regenerate"
            )

        assert response.status_code == 429
        assert response.headers["retry-after"] == "45"
