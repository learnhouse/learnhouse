"""
Direct unit tests for src/security/superadmin.py.

Tests cover is_user_superadmin (cache miss/hit, superadmin/non-superadmin) and
require_superadmin (anonymous 401, non-superadmin 403, superadmin passthrough).
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.users import AnonymousUser, PublicUser, User
from src.security.superadmin import is_user_superadmin, require_superadmin


# ---------------------------------------------------------------------------
# is_user_superadmin
# ---------------------------------------------------------------------------

class TestIsUserSuperadmin:
    async def test_cache_miss_queries_db_and_caches_result(self, db):
        user = User(
            id=20,
            username="superuser",
            first_name="Super",
            last_name="User",
            email="superuser@test.com",
            password="hashed",
            user_uuid="user_super20",
            is_superadmin=True,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user)
        await db.commit()

        result = await is_user_superadmin(20, db)

        assert result is True
        assert db._superadmin_cache[20] is True

    async def test_cache_miss_non_superadmin_user(self, db):
        user = User(
            id=21,
            username="normaluser",
            first_name="Normal",
            last_name="User",
            email="normal21@test.com",
            password="hashed",
            user_uuid="user_normal21",
            is_superadmin=False,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user)
        await db.commit()

        result = await is_user_superadmin(21, db)

        assert result is False
        assert db._superadmin_cache[21] is False

    async def test_cache_hit_returns_cached_value_without_db(self, db):
        # Pre-seed the cache — no matching row needed in the DB
        db._superadmin_cache = {99: True}

        result = await is_user_superadmin(99, db)

        assert result is True

    async def test_initialises_cache_dict_when_absent(self, db):
        # Ensure the session doesn't start with a cache attr
        if hasattr(db, '_superadmin_cache'):
            del db._superadmin_cache

        user = User(
            id=22,
            username="user22",
            first_name="U",
            last_name="22",
            email="u22@test.com",
            password="hashed",
            user_uuid="user22",
            is_superadmin=False,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user)
        await db.commit()

        await is_user_superadmin(22, db)
        assert hasattr(db, '_superadmin_cache')


# ---------------------------------------------------------------------------
# require_superadmin
# ---------------------------------------------------------------------------

class TestRequireSuperadmin:
    async def test_anonymous_user_raises_401(self, db):
        anon = AnonymousUser()
        with pytest.raises(HTTPException) as exc_info:
            await require_superadmin(current_user=anon, db_session=db)
        assert exc_info.value.status_code == 401
        assert "Authentication" in exc_info.value.detail

    async def test_non_superadmin_raises_403(self, db):
        public_user = PublicUser(
            id=30,
            username="plain",
            first_name="Plain",
            last_name="User",
            email="plain@test.com",
            user_uuid="user_plain30",
        )
        with patch(
            "src.security.superadmin.is_user_superadmin",
            new=AsyncMock(return_value=False),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await require_superadmin(current_user=public_user, db_session=db)
        assert exc_info.value.status_code == 403
        assert "Superadmin" in exc_info.value.detail

    async def test_superadmin_returns_current_user(self, db):
        public_user = PublicUser(
            id=31,
            username="sueradm",
            first_name="Super",
            last_name="Admin",
            email="sadmin@test.com",
            user_uuid="user_sadmin31",
        )
        with patch(
            "src.security.superadmin.is_user_superadmin",
            new=AsyncMock(return_value=True),
        ):
            result = await require_superadmin(current_user=public_user, db_session=db)
        assert result is public_user


# ---------------------------------------------------------------------------
# _get_current_user_lazy (the FastAPI Depends wrapper)
# ---------------------------------------------------------------------------

class TestGetCurrentUserLazy:
    async def test_delegates_to_get_current_user(self, db, mock_request):
        from src.db.users import PublicUser
        from src.security.superadmin import _get_current_user_lazy

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
