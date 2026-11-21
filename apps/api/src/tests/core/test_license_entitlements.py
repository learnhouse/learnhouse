"""Self-hosted EE license entitlements and lock (licensing v3), OSS side.

The EE hooks module is stubbed: these tests pin how OSS reacts to what EE
reports, not how EE decides it.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core import deployment_mode
from src.core.deployment_mode import is_ee_feature_licensed
from src.core.ee_hooks import is_multi_org_allowed
from src.core.middleware.license_lock import LicenseLockMiddleware, license_lock_state
from src.security.features_utils import plan_check, plans, resolve


def _hooks(**kw):
    return SimpleNamespace(**kw)


# ── deployment_mode.is_ee_feature_licensed ──────────────────────────────────


class TestIsEeFeatureLicensed:
    def test_non_ee_modes_defer_to_their_own_rules(self):
        for mode in ("saas", "oss"):
            with patch.object(deployment_mode, "get_deployment_mode", return_value=mode):
                assert is_ee_feature_licensed("sso") is True

    def test_ee_asks_the_license(self):
        hooks = _hooks(is_feature_licensed=lambda f: f == "sso")
        with patch.object(deployment_mode, "get_deployment_mode", return_value="ee"), patch.object(
            deployment_mode, "get_ee_hooks", return_value=hooks
        ):
            assert is_ee_feature_licensed("sso") is True
            assert is_ee_feature_licensed("scorm") is False

    def test_older_ee_without_entitlements_allows_everything(self):
        with patch.object(deployment_mode, "get_deployment_mode", return_value="ee"), patch.object(
            deployment_mode, "get_ee_hooks", return_value=_hooks()
        ):
            assert is_ee_feature_licensed("scorm") is True
        with patch.object(deployment_mode, "get_deployment_mode", return_value="ee"), patch.object(
            deployment_mode, "get_ee_hooks", return_value=None
        ):
            assert is_ee_feature_licensed("scorm") is True

    def test_checker_error_fails_open(self):
        def boom(_):
            raise RuntimeError("x")

        with patch.object(deployment_mode, "get_deployment_mode", return_value="ee"), patch.object(
            deployment_mode, "get_ee_hooks", return_value=_hooks(is_feature_licensed=boom)
        ):
            assert is_ee_feature_licensed("scorm") is True


# ── Feature gates in ee mode ────────────────────────────────────────────────


class TestEeModeGates:
    def test_plan_dependency_refuses_unlicensed_ee_feature(self):
        with patch.object(plan_check, "get_deployment_mode", return_value="ee"), patch.object(
            plan_check, "is_ee_feature_licensed", return_value=False
        ):
            with pytest.raises(HTTPException) as exc:
                plan_check._check_mode_bypass("Audit Logs")
        assert exc.value.status_code == 403
        assert "not included in your LearnHouse license" in exc.value.detail

    def test_plan_dependency_allows_licensed_or_core_features(self):
        with patch.object(plan_check, "get_deployment_mode", return_value="ee"), patch.object(
            plan_check, "is_ee_feature_licensed", return_value=True
        ):
            assert plan_check._check_mode_bypass("sso") is True
        with patch.object(plan_check, "get_deployment_mode", return_value="ee"), patch.object(
            plan_check, "is_ee_feature_licensed", return_value=False
        ):
            # Not an EE-only feature: the license never takes it away.
            assert plan_check._check_mode_bypass("courses") is True

    def test_resolve_marks_unlicensed_feature_unavailable(self):
        with patch.object(resolve, "get_deployment_mode", return_value="ee"), patch.object(
            resolve, "is_ee_feature_licensed", side_effect=lambda f: f != "scorm"
        ):
            off = resolve.resolve_feature("scorm", {})
            assert off["available"] is False and off["enabled"] is False
            on = resolve.resolve_feature("sso", {})
            assert on["available"] is True

    def test_is_feature_enabled_for_plan_in_ee(self):
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"), patch(
            "src.core.deployment_mode.is_ee_feature_licensed", side_effect=lambda f: f == "sso"
        ):
            assert plans.is_feature_enabled_for_plan("free", "sso") is True
            assert plans.is_feature_enabled_for_plan("free", "scorm") is False
            assert plans.is_feature_enabled_for_plan("free", "courses") is True

    def test_multi_org_needs_the_license_in_ee(self):
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"), patch(
            "src.core.deployment_mode.is_ee_feature_licensed", side_effect=lambda f: f != "multi_org"
        ):
            assert is_multi_org_allowed() is False
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"), patch(
            "src.core.deployment_mode.is_ee_feature_licensed", return_value=True
        ):
            assert is_multi_org_allowed() is True
        for mode, expected in (("saas", True), ("oss", False)):
            with patch("src.core.deployment_mode.get_deployment_mode", return_value=mode):
                assert is_multi_org_allowed() is expected


# ── Lock middleware ─────────────────────────────────────────────────────────


class TestLicenseLockState:
    def test_no_ee(self):
        with patch("src.core.middleware.license_lock.get_ee_hooks", return_value=None):
            assert license_lock_state() == (False, None)
        with patch("src.core.middleware.license_lock.get_ee_hooks", return_value=_hooks()):
            assert license_lock_state() == (False, None)

    def test_unlocked(self):
        hooks = _hooks(is_license_locked=lambda: False)
        with patch("src.core.middleware.license_lock.get_ee_hooks", return_value=hooks):
            assert license_lock_state() == (False, None)

    def test_locked_with_and_without_reason(self):
        hooks = _hooks(is_license_locked=lambda: True, license_lock_reason=lambda: "payment_overdue")
        with patch("src.core.middleware.license_lock.get_ee_hooks", return_value=hooks):
            assert license_lock_state() == (True, "payment_overdue")
        hooks = _hooks(is_license_locked=lambda: True)
        with patch("src.core.middleware.license_lock.get_ee_hooks", return_value=hooks):
            assert license_lock_state() == (True, None)

    def test_errors_never_lock(self):
        def boom():
            raise RuntimeError("x")

        with patch("src.core.middleware.license_lock.get_ee_hooks", return_value=_hooks(is_license_locked=boom)):
            assert license_lock_state() == (False, None)


def _locked_app():
    app = FastAPI()

    @app.get("/api/v1/courses")
    async def courses():
        return {"ok": True}

    @app.get("/api/v1/instance/info")
    async def info():
        return {"ok": True}

    @app.get("/content/x")
    async def content():
        return {"ok": True}

    @app.get("/")
    async def root():
        return {"ok": True}

    app.add_middleware(LicenseLockMiddleware)
    return app


class TestLicenseLockMiddleware:
    async def _get(self, path, locked, method="GET"):
        state = (True, "expired") if locked else (False, None)
        with patch("src.core.middleware.license_lock.license_lock_state", return_value=state):
            async with AsyncClient(transport=ASGITransport(app=_locked_app()), base_url="http://t") as c:
                return await c.request(method, path)

    async def test_locked_blocks_api_and_content(self):
        r = await self._get("/api/v1/courses", True)
        assert r.status_code == 423
        assert r.json()["error"] == "license_locked"
        assert r.json()["reason"] == "expired"
        assert (await self._get("/content/x", True)).status_code == 423

    async def test_locked_keeps_the_lock_screen_endpoints(self):
        assert (await self._get("/api/v1/instance/info", True)).status_code == 200
        assert (await self._get("/", True)).status_code == 200

    async def test_preflight_passes(self):
        r = await self._get("/api/v1/courses", True, method="OPTIONS")
        assert r.status_code != 423

    async def test_unlocked_passes(self):
        assert (await self._get("/api/v1/courses", False)).status_code == 200

    async def test_non_http_scope_passes(self):
        seen = []

        async def inner(scope, receive, send):
            seen.append(scope["type"])

        mw = LicenseLockMiddleware(inner)
        await mw({"type": "lifespan"}, None, None)
        assert seen == ["lifespan"]
