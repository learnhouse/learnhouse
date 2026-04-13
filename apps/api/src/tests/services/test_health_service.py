import pytest
from unittest.mock import Mock
from fastapi import HTTPException

from src.services.health.health import check_health, check_database_health


class TestHealthService:
    """Tests for src/services/health/health.py"""

    @pytest.mark.asyncio
    async def test_check_health_returns_true(self, db):
        result = await check_health(db)
        assert result is True

    @pytest.mark.asyncio
    async def test_check_database_health_returns_true(self, db):
        result = await check_database_health(db)
        assert result is True

    @pytest.mark.asyncio
    async def test_check_health_raises_on_unhealthy_db(self):
        mock_session = Mock()
        mock_session.exec.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            await check_health(mock_session)

        assert exc_info.value.status_code == 503
        assert "Database is not healthy" in exc_info.value.detail
