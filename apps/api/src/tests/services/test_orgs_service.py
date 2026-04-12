"""Tests for src/services/orgs/orgs.py — org CRUD functions."""

from datetime import datetime
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization, OrganizationCreate, OrganizationRead
from src.services.orgs.orgs import (
    _build_org_read_with_resolved,
    create_org,
    get_organization_by_slug,
    get_organization_by_uuid,
)


# ---------------------------------------------------------------------------
# get_organization_by_slug
# ---------------------------------------------------------------------------


class TestGetOrgBySlug:
    @pytest.mark.asyncio
    async def test_get_org_by_slug_uses_cache(self, mock_request, admin_user):
        cached = {
            "id": 1,
            "name": "Cached Org",
            "slug": "cached-org",
            "email": "cached@org.com",
            "org_uuid": "org_cached",
            "creation_date": "2024-01-01",
            "update_date": "2024-01-01",
            "config": {},
        }

        with patch(
            "src.services.orgs.cache.get_cached_org_by_slug",
            return_value=cached,
        ), patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
        ) as mock_rbac:
            result = await get_organization_by_slug(
                mock_request, "cached-org", Mock(), admin_user
            )

        assert isinstance(result, OrganizationRead)
        assert result.slug == "cached-org"
        mock_rbac.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_org_by_slug_found(self, mock_request, db, org, admin_user):
        result = await get_organization_by_slug(
            mock_request, "test-org", db, admin_user
        )

        assert isinstance(result, OrganizationRead)
        assert result.name == "Test Org"
        assert result.slug == "test-org"
        assert result.org_uuid == "org_test"

    @pytest.mark.asyncio
    async def test_get_org_by_slug_not_found(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await get_organization_by_slug(
                mock_request, "nonexistent", db, admin_user
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_org_by_slug_ignores_cache_set_failures(
        self, mock_request, db, org, admin_user
    ):
        with patch(
            "src.services.orgs.cache.get_cached_org_by_slug",
            return_value=None,
        ), patch(
            "src.services.orgs.cache.set_cached_org_by_slug",
            side_effect=RuntimeError("redis unavailable"),
        ), patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
        ):
            result = await get_organization_by_slug(
                mock_request, "test-org", db, admin_user
            )

        assert result.slug == "test-org"


# ---------------------------------------------------------------------------
# get_organization_by_uuid
# ---------------------------------------------------------------------------


class TestGetOrgByUuid:
    @pytest.mark.asyncio
    async def test_get_org_by_uuid_found(self, mock_request, db, org, admin_user):
        result = await get_organization_by_uuid(
            mock_request, "org_test", db, admin_user
        )

        assert isinstance(result, OrganizationRead)
        assert result.name == "Test Org"
        assert result.org_uuid == "org_test"

    @pytest.mark.asyncio
    async def test_get_org_by_uuid_not_found(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await get_organization_by_uuid(
                mock_request, "nonexistent", db, admin_user
            )

        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# create_org
# ---------------------------------------------------------------------------


class TestCreateOrg:
    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    @patch("src.routers.users._invalidate_session_cache")
    async def test_create_org_success(
        self, mock_cache, mock_multi_org, mock_request, db, admin_user
    ):
        new_org = OrganizationCreate(
            name="New Org",
            slug="new-org",
            email="new@org.com",
        )

        result = await create_org(mock_request, new_org, admin_user, db)

        assert isinstance(result, OrganizationRead)
        assert result.name == "New Org"
        assert result.slug == "new-org"

        # Verify row exists in DB
        row = db.exec(
            select(Organization).where(Organization.slug == "new-org")
        ).first()
        assert row is not None
        assert row.name == "New Org"

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    async def test_create_org_duplicate_slug(
        self, mock_multi_org, mock_request, db, org, admin_user
    ):
        duplicate = OrganizationCreate(
            name="Duplicate",
            slug="test-org",
            email="dup@org.com",
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_org(mock_request, duplicate, admin_user, db)

        assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    async def test_create_org_anonymous_rejected(
        self, mock_multi_org, mock_request, db, anonymous_user
    ):
        new_org = OrganizationCreate(
            name="Anon Org",
            slug="anon-org",
            email="anon@org.com",
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_org(mock_request, new_org, anonymous_user, db)

        assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=False)
    async def test_create_org_requires_enterprise_for_second_org(
        self, mock_multi_org, mock_request, db, org, admin_user
    ):
        new_org = OrganizationCreate(
            name="Blocked Org",
            slug="blocked-org",
            email="blocked@org.com",
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_org(mock_request, new_org, admin_user, db)

        assert exc_info.value.status_code == 403
        assert "Enterprise Edition" in exc_info.value.detail


class TestBuildOrgReadWithResolved:
    def test_build_org_read_with_resolved_features(self, org):
        org_config = OrganizationConfig(
            id=1,
            org_id=org.id,
            config={"plan": "free"},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        with patch(
            "src.security.features_utils.resolve.resolve_all_features",
            return_value={"courses": {"enabled": True}},
        ):
            result = _build_org_read_with_resolved(org, org_config)

        assert result.org_uuid == org.org_uuid
        assert result.config.config["resolved_features"] == {
            "courses": {"enabled": True}
        }
