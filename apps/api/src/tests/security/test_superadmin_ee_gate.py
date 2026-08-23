"""
Tests for the Enterprise Edition gate on the superadmin surface.

The contract these pin down:
  - OSS deployments get 403 with a machine-readable `ee_required` detail that
    the web client matches on.
  - SaaS and EE are completely unaffected. Those two cases are the SEV guard —
    a gate written as `!= 'ee'` instead of `== 'oss'` would 403 live SaaS.
  - Anonymous callers still get 401, not 403, so the gate never becomes an
    authentication oracle.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.users import AnonymousUser, PublicUser
from src.security.superadmin import (
    EE_SUPERADMIN_REQUIRED_DETAIL,
    ensure_ee_superadmin_surface,
    require_superadmin,
)


def _mode(value):
    return patch("src.core.deployment_mode.get_deployment_mode", return_value=value)


def _superadmin_user():
    return PublicUser(
        id=90,
        username="sadmin",
        first_name="Super",
        last_name="Admin",
        email="sadmin90@test.com",
        user_uuid="user_sadmin90",
    )


class TestEnsureEESuperadminSurface:
    def test_oss_raises_403_with_ee_required_detail(self):
        with _mode("oss"):
            with pytest.raises(HTTPException) as exc_info:
                ensure_ee_superadmin_surface()
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["error"] == "ee_required"
        assert exc_info.value.detail["feature"] == "superadmin"

    @pytest.mark.parametrize("mode", ["saas", "ee"])
    def test_saas_and_ee_pass_through(self, mode):
        with _mode(mode):
            assert ensure_ee_superadmin_surface() is None

    def test_detail_is_not_the_503_license_shape(self):
        # The web client keys two different banners off these two shapes.
        # Unifying them would silently break isEERequiredError.
        assert EE_SUPERADMIN_REQUIRED_DETAIL["error"] != "ee_license_inactive"

    def test_raised_detail_is_a_copy(self):
        # A handler mutating exc.detail must not poison the module constant.
        with _mode("oss"):
            with pytest.raises(HTTPException) as exc_info:
                ensure_ee_superadmin_surface()
        exc_info.value.detail["error"] = "mutated"
        assert EE_SUPERADMIN_REQUIRED_DETAIL["error"] == "ee_required"


class TestRequireSuperadminEEGate:
    async def test_oss_blocks_superadmin(self, db):
        with _mode("oss"), patch(
            "src.security.superadmin.is_user_superadmin",
            new=AsyncMock(return_value=True),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await require_superadmin(current_user=_superadmin_user(), db_session=db)
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["error"] == "ee_required"

    @pytest.mark.parametrize("mode", ["saas", "ee"])
    async def test_saas_and_ee_unaffected(self, db, mode):
        user = _superadmin_user()
        with _mode(mode), patch(
            "src.security.superadmin.is_user_superadmin",
            new=AsyncMock(return_value=True),
        ):
            result = await require_superadmin(current_user=user, db_session=db)
        assert result is user

    async def test_anonymous_still_401_in_oss(self, db):
        # Ordering regression test: the gate sits after the 401 branch.
        with _mode("oss"):
            with pytest.raises(HTTPException) as exc_info:
                await require_superadmin(current_user=AnonymousUser(), db_session=db)
        assert exc_info.value.status_code == 401

    async def test_oss_blocks_before_touching_the_database(self, db):
        checker = AsyncMock(return_value=True)
        with _mode("oss"), patch(
            "src.security.superadmin.is_user_superadmin", new=checker
        ):
            with pytest.raises(HTTPException):
                await require_superadmin(current_user=_superadmin_user(), db_session=db)
        checker.assert_not_awaited()
