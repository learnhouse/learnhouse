"""Tests for src/services/orgs/orgs.py — org CRUD functions."""

from datetime import datetime
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import OrganizationConfig, SeoOrgConfig
from src.db.organizations import Organization, OrganizationCreate, OrganizationRead, OrganizationUpdate
from src.services.orgs.orgs import (
    _build_org_read_with_resolved,
    _get_org_config_cached,
    create_org,
    create_org_with_config,
    get_organization_by_slug,
    get_organization_by_uuid,
    get_org_join_mechanism,
    update_org,
    update_org_ai_config,
    update_org_landing,
    update_org_seo_config,
    update_org_signup_mechanism,
    update_org_with_config_no_auth,
)


async def _make_org_config(db, org, config):
    org_config = OrganizationConfig(
        id=None,
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org_config)
    await db.commit()
    await db.refresh(org_config)
    return org_config


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
        row = (await db.execute(
            select(Organization).where(Organization.slug == "new-org")
        )).scalars().first()
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

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    @patch("src.routers.users._invalidate_session_cache")
    async def test_create_org_with_config_success(
        self, mock_cache, mock_multi_org, mock_request, db, admin_user
    ):
        new_org = OrganizationCreate(
            name="Configured Org",
            slug="configured-org",
            email="configured@org.com",
        )
        submitted_config = {"config_version": "2.0", "plan": "free", "admin_toggles": {}}

        result = await create_org_with_config(
            mock_request, new_org, admin_user, db, submitted_config
        )

        assert isinstance(result, OrganizationRead)
        assert result.slug == "configured-org"
        stored_config = (await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == result.id)
        )).scalars().first()
        assert stored_config.config["config_version"] == "2.0"


class TestUpdateOrg:
    @pytest.mark.asyncio
    async def test_update_org_and_no_auth_config_update(
        self, mock_request, db, org, admin_user
    ):
        await _make_org_config(db, org, {"config_version": "2.0", "plan": "free"})

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
        ):
            updated = await update_org(
                mock_request,
                OrganizationUpdate(name="Updated Org", slug="updated-org"),
                org.id,
                admin_user,
                db,
            )
            config_result = await update_org_with_config_no_auth(
                mock_request,
                {"config_version": "2.0", "plan": "pro"},
                org.id,
                db,
            )

        assert updated.name == "Updated Org"
        assert updated.slug == "updated-org"
        assert config_result == {"detail": "Organization updated"}
        stored = (await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )).scalars().first()
        assert stored.config["plan"] == "pro"

    @pytest.mark.asyncio
    async def test_update_org_duplicate_slug_and_missing_config(
        self, mock_request, db, org, other_org, admin_user
    ):
        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as slug_exc:
                await update_org(
                    mock_request,
                    OrganizationUpdate(slug=other_org.slug),
                    org.id,
                    admin_user,
                    db,
                )
        assert slug_exc.value.status_code == 409

        with pytest.raises(HTTPException) as config_exc:
            await update_org_with_config_no_auth(
                mock_request,
                {"config_version": "2.0"},
                org.id,
                db,
            )
        assert config_exc.value.status_code == 404


class TestOrgConfigUpdates:
    @pytest.mark.asyncio
    async def test_signup_mechanism_ai_landing_seo_and_join_mechanism_v2(
        self, mock_request, db, org, admin_user
    ):
        await _make_org_config(
            db,
            org,
            {
                "config_version": "2.0",
                "plan": "free",
                "admin_toggles": {"members": {"signup_mode": "open"}},
                "customization": {},
            },
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            signup = await update_org_signup_mechanism(
                mock_request, "inviteOnly", org.id, admin_user, db
            )
            ai = await update_org_ai_config(
                mock_request, True, org.id, admin_user, db, copilot_enabled=False
            )
            landing = await update_org_landing(
                mock_request, {"hero": "Hello"}, org.id, admin_user, db
            )
            seo = await update_org_seo_config(
                mock_request,
                SeoOrgConfig(default_meta_description="SEO desc"),
                org.id,
                admin_user,
                db,
            )
            join_mechanism = await get_org_join_mechanism(
                mock_request, org.id, admin_user, db
            )

        stored = (await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )).scalars().first()
        assert signup == {"detail": "Signup mechanism updated"}
        assert ai == {"detail": "AI configuration updated"}
        assert landing == {"detail": "Landing object updated"}
        assert seo == {"detail": "SEO configuration updated"}
        assert join_mechanism == "inviteOnly"
        assert stored.config["customization"]["landing"] == {"hero": "Hello"}
        assert (
            stored.config["customization"]["seo"]["default_meta_description"]
            == "SEO desc"
        )
        assert stored.config["admin_toggles"]["ai"]["disabled"] is False

    @pytest.mark.asyncio
    async def test_join_mechanism_v1_and_missing_org(self, mock_request, db, org, admin_user):
        await _make_org_config(
            db,
            org,
            {
                "config_version": "1.4",
                "features": {"members": {"signup_mode": "inviteOnly"}},
            },
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
        ):
            join_mechanism = await get_org_join_mechanism(
                mock_request, org.id, admin_user, db
            )
        assert join_mechanism == "inviteOnly"

        with pytest.raises(HTTPException) as missing_exc:
            await get_org_join_mechanism(mock_request, 999, admin_user, db)
        assert missing_exc.value.status_code == 404


class TestGetOrgConfigCached:
    """Cover _get_org_config_cached cache-hit and exception-swallow paths."""

    @pytest.mark.asyncio
    async def test_returns_cached_org_config_on_cache_hit(self, db, org):
        cached_data = {"org_id": org.id, "config": {"plan": "pro"}}
        with patch("src.services.orgs.cache.get_cached_org_config", return_value=cached_data):
            result = await _get_org_config_cached(org.id, db)
        assert isinstance(result, OrganizationConfig)

    @pytest.mark.asyncio
    async def test_invalid_cache_data_falls_back_to_db(self, db, org):
        org_config = OrganizationConfig(
            org_id=org.id,
            config={"plan": "free"},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(org_config)
        await db.commit()

        with patch("src.services.orgs.cache.get_cached_org_config", return_value={"not_a_valid": "config"}), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            result = await _get_org_config_cached(org.id, db)
        assert result is not None

    @pytest.mark.asyncio
    async def test_set_cached_exception_is_swallowed(self, db, org):
        org_config = OrganizationConfig(
            org_id=org.id,
            config={"plan": "free"},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(org_config)
        await db.commit()

        with patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config", side_effect=RuntimeError("redis")):
            result = await _get_org_config_cached(org.id, db)
        assert result is not None

    @pytest.mark.asyncio
    async def test_invalid_cached_data_exception_falls_back_to_db(self, db, org):
        org_config = OrganizationConfig(
            org_id=org.id,
            config={"plan": "free"},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(org_config)
        await db.commit()

        # Dict with integer key causes TypeError on ** unpacking, exercising the except branch
        with patch("src.services.orgs.cache.get_cached_org_config", return_value={1: "bad-key"}), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            result = await _get_org_config_cached(org.id, db)
        assert result is not None


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
