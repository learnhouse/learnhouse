"""Router tests for src/routers/instance.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.instance import router as instance_router


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(instance_router, prefix="/api/v1/instance")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestInstanceRouter:
    async def test_get_instance_info_from_cache(self, client):
        """The cache serves the DB lookup; it must not serve `mode`.

        `mode` and `multi_org_enabled` are recomputed per request now. A stale
        `mode` in the cached blob used to survive for the full 600s TTL, so an
        operator who fixed a bad license key saw mode "oss" for ten minutes
        after the heartbeat had already recovered, and concluded otherwise.
        """
        with patch(
            "src.routers.instance.get_cached_instance_info",
            return_value={"default_org_slug": "cached-org", "tenancy": "single", "mode": "ee"},
        ):
            with patch("src.routers.instance.get_deployment_mode", return_value="oss"):
                response = await client.get("/api/v1/instance/info")

        assert response.status_code == 200
        body = response.json()
        assert body["default_org_slug"] == "cached-org"  # cached
        assert body["mode"] == "oss"  # live, overrides the stale cached value
        assert body["multi_org_enabled"] is False

    async def test_license_derived_fields_are_never_cached(self, client, db, org):
        """What gets written to Redis must not carry `mode`.

        Deploys are rolling and the cache is shared, so any pod running older
        code will return a cached blob verbatim. If these fields are ever put
        back into the stored payload, that pod serves a stale `mode`, and if
        they are stored under a key an older build also reads, it serves a
        response missing `mode` entirely.
        """
        stored = {}

        config = SimpleNamespace(
            hosting_config=SimpleNamespace(frontend_domain="localhost:3000", tenancy="multi")
        )
        with patch("src.routers.instance.get_cached_instance_info", return_value=None), patch(
            "src.routers.instance.set_cached_instance_info", side_effect=lambda d: stored.update(d)
        ), patch("src.routers.instance.get_learnhouse_config", return_value=config), patch(
            "src.routers.instance.get_deployment_mode", return_value="saas"
        ):
            response = await client.get("/api/v1/instance/info")

        assert response.status_code == 200
        assert "mode" not in stored
        assert "multi_org_enabled" not in stored
        # ...but the response the client actually receives still has both.
        assert response.json()["mode"] == "saas"
        assert response.json()["multi_org_enabled"] is True

    async def test_instance_info_cache_key_is_versioned(self):
        """The key must not collide with the pre-change payload shape."""
        from src.services.orgs.cache import _INSTANCE_INFO_KEY

        assert _INSTANCE_INFO_KEY.endswith(":v2"), (
            "bump the key version whenever the cached instance-info shape changes, "
            "or a rolling deploy will have two builds reading one payload"
        )

    async def test_get_instance_info_builds_response(self, client, db, org):
        config = SimpleNamespace(
            hosting_config=SimpleNamespace(
                frontend_domain="localhost:3000",
                tenancy="multi",
            )
        )
        with patch(
            "src.routers.instance.get_cached_instance_info",
            return_value=None,
        ), patch(
            "src.routers.instance.get_learnhouse_config",
            return_value=config,
        ), patch(
            "src.routers.instance.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.routers.instance.set_cached_instance_info",
        ) as mock_set_cache:
            response = await client.get("/api/v1/instance/info")

        assert response.status_code == 200
        body = response.json()
        assert body["default_org_slug"] == org.slug
        assert body["frontend_domain"] == "localhost:3000"
        assert body["top_domain"] == "localhost"
        assert body["tenancy"] == "multi"
        assert body["multi_org_enabled"] is True
        mock_set_cache.assert_called_once()

    async def test_get_instance_info_single_tenancy(self, client, db, org):
        # In single tenancy, multi_org_enabled (deprecated alias) must be
        # False even if EE/SaaS would otherwise allow it.
        config = SimpleNamespace(
            hosting_config=SimpleNamespace(
                frontend_domain="learn.example.org",
                tenancy="single",
            )
        )
        with patch(
            "src.routers.instance.get_cached_instance_info",
            return_value=None,
        ), patch(
            "src.routers.instance.get_learnhouse_config",
            return_value=config,
        ), patch(
            "src.routers.instance.get_deployment_mode",
            return_value="ee",
        ), patch(
            "src.routers.instance.set_cached_instance_info",
        ):
            response = await client.get("/api/v1/instance/info")

        assert response.status_code == 200
        body = response.json()
        assert body["tenancy"] == "single"
        assert body["multi_org_enabled"] is False

    async def test_get_instance_info_falls_back_when_db_lookup_fails(self, client):
        config = SimpleNamespace(
            hosting_config=SimpleNamespace(
                frontend_domain="learnhouse.ai",
                tenancy="single",
            )
        )
        bad_session = Mock()
        bad_session.exec.side_effect = RuntimeError("db error")

        app = FastAPI()
        app.include_router(instance_router, prefix="/api/v1/instance")
        app.dependency_overrides[get_db_session] = lambda: bad_session

        try:
            with patch(
                "src.routers.instance.get_cached_instance_info",
                return_value=None,
            ), patch(
                "src.routers.instance.get_learnhouse_config",
                return_value=config,
            ), patch(
                "src.routers.instance.get_deployment_mode",
                return_value="oss",
            ), patch(
                "src.routers.instance.set_cached_instance_info",
            ):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as local_client:
                    response = await local_client.get("/api/v1/instance/info")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert response.json()["default_org_slug"] == "default"


# ── Licensing v3: lock flag and /instance/license ────────────────────────────

from src.security.auth import get_authenticated_user  # noqa: E402

_FULL = {"status": "active", "notices": [{"code": "poc_ends"}], "license_id": "lic_1", "lock_reason": None}


class TestInstanceLicense:
    async def test_info_reports_lock_flag(self, client):
        with patch(
            "src.routers.instance.get_cached_instance_info",
            return_value={"default_org_slug": "d", "tenancy": "single"},
        ), patch("src.routers.instance.get_deployment_mode", return_value="ee"), patch(
            "src.routers.instance.license_lock_state", return_value=(True, "expired")
        ):
            r = await client.get("/api/v1/instance/info")
        assert r.json()["license_locked"] is True

    async def _license(self, app, client, user, mode="ee", hooks=None, lock=(False, None)):
        app.dependency_overrides[get_authenticated_user] = lambda: user
        hooks = hooks if hooks is not None else SimpleNamespace(get_license_status=lambda: dict(_FULL))
        with patch("src.routers.instance.get_deployment_mode", return_value=mode), patch(
            "src.routers.instance.get_ee_hooks", return_value=hooks
        ), patch("src.routers.instance.license_lock_state", return_value=lock):
            return (await client.get("/api/v1/instance/license")).json()

    async def test_admin_gets_full_status(self, app, client, admin_user):
        body = await self._license(app, client, admin_user)
        assert body["license_id"] == "lic_1"
        assert body["notices"] == [{"code": "poc_ends"}]
        assert body["mode"] == "ee" and body["locked"] is False

    async def test_member_gets_minimal_status(self, app, client, regular_user):
        body = await self._license(app, client, regular_user, lock=(True, "expired"))
        assert body == {"mode": "ee", "status": "active", "locked": True}

    async def test_backoffice_staff_gets_full_status(self, app, client, regular_user):
        with patch("src.routers.instance.is_user_backoffice_staff", return_value=True):
            body = await self._license(app, client, regular_user)
        assert body["license_id"] == "lic_1"

    async def test_token_user_without_id_is_not_admin(self, app, client):
        body = await self._license(app, client, SimpleNamespace(id=None))
        assert set(body) == {"mode", "status", "locked"}

    async def test_saas_and_no_ee(self, app, client, admin_user):
        assert (await self._license(app, client, admin_user, mode="saas"))["status"] == "unlicensed"
        body = await self._license(app, client, admin_user, hooks=SimpleNamespace())
        assert body == {"mode": "ee", "status": "unlicensed", "locked": False, "notices": []}

    async def test_status_error_is_reported_not_raised(self, app, client, admin_user):
        def boom():
            raise RuntimeError("x")

        body = await self._license(app, client, admin_user, hooks=SimpleNamespace(get_license_status=boom))
        assert body["status"] == "inactive" and body["reason"] == "status_unavailable"
