"""Tests for src/services/analytics/settings.py (retention and privacy settings)."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.analytics import AnalyticsSettings
from src.services.analytics import settings as analytics_settings


@pytest.fixture(autouse=True)
def _clear_cache():
    analytics_settings._cache.clear()
    yield
    analytics_settings._cache.clear()


def _plan(plan: str):
    return patch.object(analytics_settings, "get_org_plan", new=AsyncMock(return_value=plan))


class TestGetSettings:
    async def test_defaults_without_a_row(self, db, org):
        view = await analytics_settings.get_settings(org.id, db)
        assert view == analytics_settings.SettingsView()
        assert view.as_dict() == {
            "retention_days": 365,
            "track_anonymous": True,
            "collect_location": True,
            "exclude_staff": False,
        }

    async def test_reads_and_caches_the_row(self, db, org):
        db.add(AnalyticsSettings(org_id=org.id, retention_days=90, exclude_staff=True))
        await db.commit()
        view = await analytics_settings.get_settings(org.id, db)
        assert view.retention_days == 90 and view.exclude_staff is True
        with patch.object(db, "execute") as execute:
            assert await analytics_settings.get_settings(org.id, db) is view
        execute.assert_not_called()
        analytics_settings.invalidate(org.id)
        assert org.id not in analytics_settings._cache


class TestRetention:
    async def test_options_by_plan(self, db, org):
        with _plan("pro"), patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"):
            options = await analytics_settings.retention_options(org.id, db)
        assert options == {"standard": [90, 180, 365], "extended": [730, 1095, 1825, 2555], "extended_available": False}
        with _plan("enterprise"), patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"):
            assert (await analytics_settings.retention_options(org.id, db))["extended_available"] is True


class TestUpdateSettings:
    async def test_standard_change_creates_the_row(self, db, org):
        view = await analytics_settings.update_settings(
            org.id, {"retention_days": 180, "track_anonymous": False, "exclude_staff": None}, db
        )
        assert view.retention_days == 180 and view.track_anonymous is False and view.exclude_staff is False
        row = await db.get(AnalyticsSettings, org.id)
        assert row.retention_days == 180 and row.track_anonymous is False

    async def test_extended_retention_requires_enterprise(self, db, org):
        with patch.object(analytics_settings, "can_extend_retention", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc:
                await analytics_settings.update_settings(org.id, {"retention_days": 1825}, db)
        assert exc.value.status_code == 403

    async def test_extended_retention_with_enterprise_updates_existing_row(self, db, org):
        db.add(AnalyticsSettings(org_id=org.id, retention_days=90))
        await db.commit()
        with patch.object(analytics_settings, "can_extend_retention", new=AsyncMock(return_value=True)):
            view = await analytics_settings.update_settings(org.id, {"retention_days": 2555}, db)
        assert view.retention_days == 2555
        await db.refresh(await db.get(AnalyticsSettings, org.id))
        assert (await db.get(AnalyticsSettings, org.id)).retention_days == 2555

    async def test_unsupported_retention_is_rejected(self, db, org):
        with pytest.raises(HTTPException) as exc:
            await analytics_settings.update_settings(org.id, {"retention_days": 400}, db)
        assert exc.value.status_code == 400
