"""Tests for src/services/orgs/orgs.py — org CRUD functions."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organizations import Organization, OrganizationCreate, OrganizationRead
from src.services.orgs.orgs import (
    create_org,
    get_organization_by_slug,
    get_organization_by_uuid,
)


# ---------------------------------------------------------------------------
# get_organization_by_slug
# ---------------------------------------------------------------------------


class TestGetOrgBySlug:
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
