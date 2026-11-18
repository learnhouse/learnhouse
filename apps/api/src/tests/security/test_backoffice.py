"""
Direct unit tests for src/security/backoffice.py.

Tests cover is_user_backoffice_staff (cache miss/hit, backoffice/non-backoffice staff member) and
require_backoffice (anonymous 401, non-backoffice staff member 403, backoffice passthrough).
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.users import AnonymousUser, PublicUser, User
from src.security.backoffice import is_user_backoffice_staff, require_backoffice


# ---------------------------------------------------------------------------
# is_user_backoffice_staff
# ---------------------------------------------------------------------------

class TestIsUserBackoffice:
    async def test_cache_miss_queries_db_and_caches_result(self, db):
        user = User(
            id=20,
            username="superuser",
            first_name="Super",
            last_name="User",
            email="superuser@test.com",
            password="hashed",
            user_uuid="user_super20",
            is_backoffice_staff=True,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user)
        await db.commit()

        result = await is_user_backoffice_staff(20, db)

        assert result is True
        assert db._backoffice_cache[20] is True

    async def test_cache_miss_non_backoffice_user(self, db):
        user = User(
            id=21,
            username="normaluser",
            first_name="Normal",
            last_name="User",
            email="normal21@test.com",
            password="hashed",
            user_uuid="user_normal21",
            is_backoffice_staff=False,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user)
        await db.commit()

        result = await is_user_backoffice_staff(21, db)

        assert result is False
        assert db._backoffice_cache[21] is False

    async def test_cache_hit_returns_cached_value_without_db(self, db):
        # Pre-seed the cache; no matching row needed in the DB
        db._backoffice_cache = {99: True}

        result = await is_user_backoffice_staff(99, db)

        assert result is True

    async def test_initialises_cache_dict_when_absent(self, db):
        # Ensure the session doesn't start with a cache attr
        if hasattr(db, '_backoffice_cache'):
            del db._backoffice_cache

        user = User(
            id=22,
            username="user22",
            first_name="U",
            last_name="22",
            email="u22@test.com",
            password="hashed",
            user_uuid="user22",
            is_backoffice_staff=False,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user)
        await db.commit()

        await is_user_backoffice_staff(22, db)
        assert hasattr(db, '_backoffice_cache')


# ---------------------------------------------------------------------------
# require_backoffice
# ---------------------------------------------------------------------------

class TestRequireBackoffice:
    async def test_anonymous_user_raises_401(self, db):
        anon = AnonymousUser()
        with pytest.raises(HTTPException) as exc_info:
            await require_backoffice(current_user=anon, db_session=db)
        assert exc_info.value.status_code == 401
        assert "Authentication" in exc_info.value.detail

    async def test_non_backoffice_raises_403(self, db):
        public_user = PublicUser(
            id=30,
            username="plain",
            first_name="Plain",
            last_name="User",
            email="plain@test.com",
            user_uuid="user_plain30",
        )
        # 'ee' is the self-hosted-EE baseline: the suite pins 'oss' globally
        # (see conftest), which would trip the EE gate before this assertion.
        with patch(
            "src.core.deployment_mode.get_deployment_mode", return_value="ee"
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff",
            new=AsyncMock(return_value=False),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await require_backoffice(current_user=public_user, db_session=db)
        assert exc_info.value.status_code == 403
        assert "Backoffice" in exc_info.value.detail

    async def test_backoffice_returns_current_user(self, db):
        public_user = PublicUser(
            id=31,
            username="sueradm",
            first_name="Super",
            last_name="Admin",
            email="sadmin@test.com",
            user_uuid="user_sadmin31",
        )
        with patch(
            "src.core.deployment_mode.get_deployment_mode", return_value="ee"
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff",
            new=AsyncMock(return_value=True),
        ):
            result = await require_backoffice(current_user=public_user, db_session=db)
        assert result is public_user


# ---------------------------------------------------------------------------
# _get_current_user_lazy (the FastAPI Depends wrapper)
# ---------------------------------------------------------------------------

class TestGetCurrentUserLazy:
    async def test_delegates_to_get_current_user(self, db, mock_request):
        from src.db.users import PublicUser
        from src.security.backoffice import _get_current_user_lazy

        fake_user = PublicUser(
            id=50,
            username="lazyuser",
            first_name="Lazy",
            last_name="User",
            email="lazy@test.com",
            user_uuid="user_lazy50",
        )
        with patch("src.security.auth.get_current_user", new=AsyncMock(return_value=fake_user)):
            result = await _get_current_user_lazy(mock_request, db)
        assert result is fake_user
