"""Wave 3 org service coverage for src/services/orgs/orgs.py."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import (
    AuthBrandingConfig,
    OrganizationConfig,
    OrganizationConfigV2Base,
    SeoOrgConfig,
)
from src.db.organizations import (
    Organization,
    OrganizationCreate,
    OrganizationRead,
    OrganizationUpdate,
)
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, InternalUser
from src.services.orgs.orgs import (
    _update_feature_toggle,
    create_org,
    create_org_with_config,
    delete_org,
    get_org_join_mechanism,
    get_orgs_by_user,
    get_orgs_by_user_admin,
    rbac_check,
    update_org_boards_config,
    update_org_ai_config,
    update_org_auth_branding_config,
    update_org_color_config,
    update_org_collections_config,
    update_org_communities_config,
    update_org_courses_config,
    update_org_favicon,
    update_org_footer_text_config,
    update_org_font_config,
    update_org_landing,
    update_org_logo,
    update_org_payments_config,
    update_org_playgrounds_config,
    update_org_podcasts_config,
    update_org_preview,
    update_org_seo_config,
    update_org_signup_mechanism,
    update_org,
    update_org_thumbnail,
    update_org_watermark_config,
    update_org_with_config_no_auth,
    upload_org_auth_background_service,
    upload_org_landing_content_service,
    upload_org_og_image_service,
    upload_org_preview_service,
)


def _make_org_config(db, org, config):
    row = OrganizationConfig(
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _attach_user_to_org(db, user_id, org_id, role_id):
    row = UserOrganization(
        user_id=user_id,
        org_id=org_id,
        role_id=role_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class TestOrgCreationAndListingWave3:
    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    @patch("src.routers.users._invalidate_session_cache")
    async def test_create_org_with_config_persists_v2_config(
        self,
        mock_invalidate,
        mock_multi_org,
        mock_request,
        db,
        admin_user,
    ):
        new_org = OrganizationCreate(
            name="Wave3 Org",
            slug="wave3-org",
            email="wave3@org.com",
        )

        created = await create_org_with_config(
            mock_request,
            new_org,
            admin_user,
            db,
            OrganizationConfigV2Base(
                plan="pro",
                customization={"landing": {"hero": "created"}},
            ),
        )

        assert isinstance(created, OrganizationRead)
        assert created.slug == "wave3-org"
        assert created.config.config["config_version"] == "2.0"

        stored = db.exec(
            select(OrganizationConfig).where(OrganizationConfig.org_id == created.id)
        ).first()
        assert stored is not None
        assert stored.config["plan"] == "pro"

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    @patch("src.routers.users._invalidate_session_cache")
    async def test_update_org_with_config_no_auth_updates_existing_config(
        self,
        mock_invalidate,
        mock_multi_org,
        mock_request,
        db,
        admin_user,
    ):
        new_org = OrganizationCreate(
            name="Wave3 Org",
            slug="wave3-org",
            email="wave3@org.com",
        )

        created = await create_org_with_config(
            mock_request,
            new_org,
            admin_user,
            db,
            OrganizationConfigV2Base(
                plan="pro",
                customization={"landing": {"hero": "created"}},
            ),
        )

        updated = await update_org_with_config_no_auth(
            mock_request,
            OrganizationConfigV2Base(
                plan="enterprise",
                customization={"landing": {"hero": "updated"}},
            ),
            created.id,
            db,
        )

        assert updated == {"detail": "Organization updated"}
        stored = db.exec(
            select(OrganizationConfig).where(OrganizationConfig.org_id == created.id)
        ).first()
        assert stored.config["plan"] == "enterprise"
        assert stored.config["customization"]["landing"]["hero"] == "updated"
        mock_invalidate.assert_called_once_with(admin_user.id)

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    @patch("src.routers.users._invalidate_session_cache")
    async def test_create_org_skips_missing_config_logging(
        self,
        mock_invalidate,
        mock_multi_org,
        mock_request,
        db,
        admin_user,
    ):
        original_exec = db.exec

        def exec_side_effect(statement):
            if "organizationconfig" in str(statement).lower():
                return SimpleNamespace(first=lambda: None)
            return original_exec(statement)

        with patch.object(db, "exec", side_effect=exec_side_effect), patch(
            "src.services.orgs.orgs.OrganizationConfig.model_validate",
            return_value=OrganizationConfig(
                org_id=0,
                config={},
                creation_date="",
                update_date="",
            ),
        ):
            created = await create_org(
                mock_request,
                OrganizationCreate(
                    name="No Config Org",
                    slug="no-config-org",
                    email="noconfig@org.com",
                ),
                admin_user,
                db,
            )

        assert created.slug == "no-config-org"
        assert mock_invalidate.call_count == 1

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    @patch("src.routers.users._invalidate_session_cache")
    async def test_create_org_with_config_skips_missing_config_logging(
        self,
        mock_invalidate,
        mock_multi_org,
        mock_request,
        db,
        admin_user,
    ):
        original_exec = db.exec

        def exec_side_effect(statement):
            if "organizationconfig" in str(statement).lower():
                return SimpleNamespace(first=lambda: None)
            return original_exec(statement)

        with patch.object(db, "exec", side_effect=exec_side_effect), patch(
            "src.services.orgs.orgs.OrganizationConfig.model_validate",
            return_value=OrganizationConfig(
                org_id=0,
                config={},
                creation_date="",
                update_date="",
            ),
        ):
            created = await create_org_with_config(
                mock_request,
                OrganizationCreate(
                    name="No Config Org 2",
                    slug="no-config-org-2",
                    email="noconfig2@org.com",
                ),
                admin_user,
                db,
                {"config_version": "2.0", "plan": "free"},
            )

        assert created.slug == "no-config-org-2"
        assert mock_invalidate.call_count == 1

    @pytest.mark.asyncio
    @patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True)
    async def test_create_org_with_config_failure_branches(
        self,
        mock_multi_org,
        mock_request,
        db,
        org,
        admin_user,
        anonymous_user,
    ):
        duplicate = OrganizationCreate(
            name="Duplicate Config Org",
            slug="test-org",
            email="dup-config@org.com",
        )

        with pytest.raises(HTTPException) as duplicate_exc:
            await create_org_with_config(
                mock_request,
                duplicate,
                admin_user,
                db,
                {"config_version": "2.0", "plan": "free"},
            )
        assert duplicate_exc.value.status_code == 409

        unique = OrganizationCreate(
            name="Anon Config Org",
            slug="anon-config-org",
            email="anon-config@org.com",
        )
        with pytest.raises(HTTPException) as anon_exc:
            await create_org_with_config(
                mock_request,
                unique,
                anonymous_user,
                db,
                {"config_version": "2.0", "plan": "free"},
            )
        assert anon_exc.value.status_code == 409

        with patch(
            "src.services.orgs.orgs.is_multi_org_allowed",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as ee_exc:
                await create_org_with_config(
                    mock_request,
                    OrganizationCreate(
                        name="Blocked Config Org",
                        slug="blocked-config-org",
                        email="blocked-config@org.com",
                    ),
                    admin_user,
                    db,
                    {"config_version": "2.0", "plan": "free"},
                )
        assert ee_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_get_org_listing_filters_orgs_by_membership(
        self,
        mock_request,
        db,
        org,
        other_org,
        admin_user,
        regular_user,
    ):
        _make_org_config(
            db,
            org,
            {
                "config_version": "2.0",
                "plan": "free",
                "admin_toggles": {"members": {"signup_mode": "open"}},
                "customization": {},
            },
        )
        _make_org_config(
            db,
            other_org,
            {
                "config_version": "1.4",
                "cloud": {"plan": "pro"},
                "features": {"members": {"signup_mode": "open"}},
            },
        )
        _attach_user_to_org(db, admin_user.id, other_org.id, 1)

        admin_orgs = await get_orgs_by_user_admin(
            mock_request, db, str(admin_user.id), page=1, limit=10
        )
        assert {item.slug for item in admin_orgs} == {"test-org", "other-org"}

        regular_orgs = await get_orgs_by_user(
            mock_request, db, str(regular_user.id), page=1, limit=10
        )
        assert {item.slug for item in regular_orgs} == {"test-org"}

    @pytest.mark.asyncio
    async def test_get_org_join_mechanism_missing_config_404(
        self,
        mock_request,
        db,
        admin_user,
    ):
        missing_org = Organization(
            id=99,
            name="Missing Config Org",
            slug="missing-config-org",
            email="missing@org.com",
            org_uuid="org_missing_config",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(missing_org)
        db.commit()

        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc_info:
                await get_org_join_mechanism(
                    mock_request,
                    missing_org.id,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "func,args",
        [
            (update_org, (OrganizationUpdate(name="Missing", slug="missing"),)),
            (update_org_logo, (SimpleNamespace(filename="logo.png"),)),
            (update_org_favicon, (SimpleNamespace(filename="favicon.png"),)),
            (update_org_thumbnail, (SimpleNamespace(filename="thumbnail.png"),)),
            (update_org_preview, (SimpleNamespace(filename="preview.png"),)),
            (delete_org, tuple()),
            (update_org_signup_mechanism, ("inviteOnly",)),
            (update_org_ai_config, (True,)),
            (update_org_communities_config, (True,)),
            (update_org_collections_config, (True,)),
            (update_org_courses_config, (True,)),
            (update_org_podcasts_config, (True,)),
            (update_org_boards_config, (True,)),
            (update_org_playgrounds_config, (True,)),
            (update_org_color_config, ("#123456",)),
            (update_org_footer_text_config, ("Footer",)),
            (update_org_font_config, ("Inter",)),
            (update_org_watermark_config, (True,)),
            (update_org_auth_branding_config, (
                AuthBrandingConfig(
                    welcome_message="Hi",
                    background_type="gradient",
                    background_image="",
                    text_color="light",
                ),
            )),
            (upload_org_auth_background_service, (SimpleNamespace(filename="bg.png"),)),
            (update_org_landing, ({"headline": "Hi"},)),
            (upload_org_landing_content_service, (SimpleNamespace(filename="landing.txt"),)),
            (update_org_seo_config, (
                SeoOrgConfig(
                    default_meta_title_suffix="S",
                    default_meta_description="D",
                ),
            )),
            (upload_org_og_image_service, (SimpleNamespace(filename="og.png"),)),
        ],
    )
    async def test_missing_org_branches_across_org_settings(
        self,
        mock_request,
        db,
        admin_user,
        func,
        args,
    ):
        missing_id = 99999

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await func(mock_request, *args, missing_id, admin_user, db)
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_config_branches_raise_404(
        self,
        mock_request,
        db,
        org,
        admin_user,
    ):
        _make_org_config(
            db,
            org,
            {
                "config_version": "2.0",
                "plan": "free",
                "admin_toggles": {"members": {"signup_mode": "open"}},
                "customization": {},
            },
        )
        config_row = db.exec(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        ).first()
        assert config_row is not None
        db.delete(config_row)
        db.commit()

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.orgs.orgs.upload_org_favicon",
            new_callable=AsyncMock,
            return_value="stored-favicon.png",
        ):
            missing_config_calls = [
                (update_org_favicon, (SimpleNamespace(filename="favicon.png"),)),
                (update_org_signup_mechanism, ("inviteOnly",)),
                (update_org_ai_config, (True,)),
                (update_org_communities_config, (True,)),
                (update_org_collections_config, (True,)),
                (update_org_boards_config, (True,)),
                (update_org_color_config, ("#abcdef",)),
                (update_org_footer_text_config, ("Footer",)),
                (update_org_font_config, ("Manrope",)),
                (update_org_watermark_config, (True,)),
                (update_org_auth_branding_config, (
                    AuthBrandingConfig(
                        welcome_message="Welcome",
                        background_type="custom",
                        background_image="bg.png",
                        text_color="dark",
                    ),
                )),
                (update_org_landing, ({"headline": "Hello"},)),
                (update_org_seo_config, (
                    SeoOrgConfig(
                        default_meta_title_suffix="Suffix",
                        default_meta_description="SEO",
                    ),
                )),
            ]

            for func, args in missing_config_calls:
                with pytest.raises(HTTPException) as exc_info:
                    await func(mock_request, *args, org.id, admin_user, db)
                assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_api_token_dict_rights_update_allowed_and_denied(
        self,
        mock_request,
        db,
        org,
    ):
        dict_rights = APITokenUser(
            org_id=org.id,
            rights={"organizations": {"action_update": True}},
            token_name="dict-update",
            created_by_user_id=1,
        )
        assert await rbac_check(mock_request, org.org_uuid, dict_rights, "update", db)

        dict_rights_denied = APITokenUser(
            org_id=org.id,
            rights={"organizations": {"action_update": False}},
            token_name="dict-denied",
            created_by_user_id=1,
        )
        with pytest.raises(HTTPException) as denied_exc:
            await rbac_check(mock_request, org.org_uuid, dict_rights_denied, "update", db)
        assert denied_exc.value.status_code == 403


class TestOrgUploadAndDeleteWave3:
    @pytest.mark.asyncio
    async def test_upload_helpers_and_delete_org(
        self,
        mock_request,
        db,
        org,
        admin_user,
    ):
        _make_org_config(
            db,
            org,
            {
                "config_version": "1.4",
                "cloud": {"plan": "pro"},
            },
        )

        logo_file = SimpleNamespace(filename="logo.png")
        favicon_file = SimpleNamespace(filename="favicon.png")
        thumbnail_file = SimpleNamespace(filename="thumbnail.png")
        preview_file = SimpleNamespace(filename="preview.png")
        background_file = SimpleNamespace(filename="background.png")
        landing_content_file = SimpleNamespace(filename="landing.txt")
        og_image_file = SimpleNamespace(filename="og.png")

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.orgs.orgs.upload_org_logo",
            new_callable=AsyncMock,
            return_value="stored-logo.png",
        ), patch(
            "src.services.orgs.orgs.upload_org_favicon",
            new_callable=AsyncMock,
            return_value="stored-favicon.png",
        ), patch(
            "src.services.orgs.orgs.upload_org_thumbnail",
            new_callable=AsyncMock,
            return_value="stored-thumbnail.png",
        ), patch(
            "src.services.orgs.orgs.upload_org_preview",
            new_callable=AsyncMock,
            side_effect=["stored-preview.png", "service-preview.png"],
        ), patch(
            "src.services.orgs.orgs.upload_org_auth_background",
            new_callable=AsyncMock,
            return_value="stored-background.png",
        ), patch(
            "src.services.orgs.orgs.upload_org_landing_content",
            new_callable=AsyncMock,
            return_value="stored-landing-content.txt",
        ), patch(
            "src.services.orgs.orgs.upload_org_og_image",
            new_callable=AsyncMock,
            return_value="stored-og.png",
        ), patch(
            "src.routers.users._invalidate_session_cache",
        ) as mock_invalidate:
            favicon_result = await update_org_favicon(
                mock_request, favicon_file, org.id, admin_user, db
            )
            logo_result = await update_org_logo(
                mock_request, logo_file, org.id, admin_user, db
            )
            thumbnail_result = await update_org_thumbnail(
                mock_request, thumbnail_file, org.id, admin_user, db
            )
            preview_result = await update_org_preview(
                mock_request, preview_file, org.id, admin_user, db
            )
            preview_service_result = await upload_org_preview_service(
                preview_file,
                org.org_uuid,
            )
            auth_background_result = await upload_org_auth_background_service(
                mock_request,
                background_file,
                org.id,
                admin_user,
                db,
            )
            landing_content_result = await upload_org_landing_content_service(
                mock_request,
                landing_content_file,
                org.id,
                admin_user,
                db,
            )
            og_image_result = await upload_org_og_image_service(
                mock_request,
                og_image_file,
                org.id,
                admin_user,
                db,
            )
            delete_result = await delete_org(
                mock_request,
                org.id,
                admin_user,
                db,
            )

        assert favicon_result == {"detail": "Favicon updated"}
        assert logo_result == {"detail": "Logo updated"}
        assert thumbnail_result == {"detail": "Thumbnail updated"}
        assert preview_result == {"name_in_disk": "stored-preview.png"}
        assert preview_service_result == {
            "detail": "Preview uploaded successfully",
            "filename": "service-preview.png",
        }
        assert auth_background_result == {
            "detail": "Auth background uploaded successfully",
            "filename": "stored-background.png",
        }
        assert landing_content_result == {
            "detail": "Landing content uploaded successfully",
            "filename": "stored-landing-content.txt",
        }
        assert og_image_result == {
            "detail": "OG image uploaded successfully",
            "filename": "stored-og.png",
        }
        assert delete_result["detail"] == "Organization deleted"
        assert db.exec(select(Organization).where(Organization.id == org.id)).first() is None
        mock_invalidate.assert_called_once_with(admin_user.id)


class TestOrgConfigBranchesWave3:
    @pytest.mark.asyncio
    async def test_v1_general_and_feature_toggle_branches(
        self,
        mock_request,
        db,
        org,
        admin_user,
    ):
        _make_org_config(
            db,
            org,
            {
                "config_version": "1.4",
                "cloud": {"plan": "pro"},
                "features": {
                    "members": {
                        "enabled": True,
                        "signup_mode": "open",
                        "admin_limit": 1,
                        "limit": 10,
                    },
                    "ai": {
                        "enabled": True,
                        "limit": 10,
                        "model": "gpt-4",
                    },
                },
            },
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.orgs.orgs.upload_org_favicon",
            new_callable=AsyncMock,
            return_value="stored-favicon.png",
        ), patch(
            "src.services.orgs.orgs.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            await update_org_favicon(
                mock_request,
                SimpleNamespace(filename="favicon-v1.png"),
                org.id,
                admin_user,
                db,
            )
            await update_org_color_config(
                mock_request,
                "#123456",
                org.id,
                admin_user,
                db,
            )
            await update_org_footer_text_config(
                mock_request,
                "Footer text",
                org.id,
                admin_user,
                db,
            )
            await update_org_font_config(
                mock_request,
                "Inter",
                org.id,
                admin_user,
                db,
            )
            await update_org_watermark_config(
                mock_request,
                False,
                org.id,
                admin_user,
                db,
            )
            await update_org_auth_branding_config(
                mock_request,
                AuthBrandingConfig(
                    welcome_message="Welcome",
                    background_type="custom",
                    background_image="bg.png",
                    text_color="dark",
                ),
                org.id,
                admin_user,
                db,
            )
            await update_org_landing(
                mock_request,
                {"hero": "Hello"},
                org.id,
                admin_user,
                db,
            )
            await update_org_seo_config(
                mock_request,
                SeoOrgConfig(
                    default_meta_title_suffix="Suffix",
                    default_meta_description="SEO desc",
                    default_og_image="og-v1.png",
                ),
                org.id,
                admin_user,
                db,
            )
            await update_org_signup_mechanism(
                mock_request,
                "inviteOnly",
                org.id,
                admin_user,
                db,
            )
            await update_org_ai_config(
                mock_request,
                False,
                org.id,
                admin_user,
                db,
                copilot_enabled=True,
            )
            await update_org_communities_config(
                mock_request,
                False,
                org.id,
                admin_user,
                db,
            )
            await update_org_payments_config(
                mock_request,
                True,
                org.id,
                admin_user,
                db,
            )
            await update_org_courses_config(
                mock_request,
                False,
                org.id,
                admin_user,
                db,
            )
            await update_org_podcasts_config(
                mock_request,
                True,
                org.id,
                admin_user,
                db,
            )
            await update_org_playgrounds_config(
                mock_request,
                False,
                org.id,
                admin_user,
                db,
            )

        stored = db.exec(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        ).first()
        assert stored.config["general"]["favicon_image"] == "stored-favicon.png"
        assert stored.config["general"]["color"] == "#123456"
        assert stored.config["general"]["footer_text"] == "Footer text"
        assert stored.config["general"]["font"] == "Inter"
        assert stored.config["general"]["watermark"] is False
        assert stored.config["general"]["auth_branding"]["welcome_message"] == "Welcome"
        assert stored.config["landing"] == {"hero": "Hello"}
        assert stored.config["seo"]["default_meta_description"] == "SEO desc"
        assert stored.config["features"]["members"]["signup_mode"] == "inviteOnly"
        assert "model" not in stored.config["features"]["ai"]
        assert stored.config["features"]["ai"]["enabled"] is False
        assert stored.config["features"]["communities"]["enabled"] is False
        assert stored.config["features"]["payments"]["enabled"] is True
        assert stored.config["features"]["courses"]["enabled"] is False
        assert stored.config["features"]["podcasts"]["enabled"] is True
        assert stored.config["features"]["playgrounds"]["enabled"] is False
        assert mock_webhooks.await_count >= 2

    @pytest.mark.asyncio
    async def test_v2_general_and_feature_toggle_branches(
        self,
        mock_request,
        db,
        other_org,
        admin_user,
    ):
        _make_org_config(
            db,
            other_org,
            {
                "config_version": "2.0",
                "plan": "free",
                "admin_toggles": {
                    "members": {"signup_mode": "open"},
                    "ai": {"disabled": False, "copilot_enabled": True},
                },
                "customization": {},
            },
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.orgs.orgs.upload_org_favicon",
            new_callable=AsyncMock,
            return_value="stored-favicon.png",
        ), patch(
            "src.services.orgs.orgs.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            await update_org_favicon(
                mock_request,
                SimpleNamespace(filename="favicon-v2.png"),
                other_org.id,
                admin_user,
                db,
            )
            await update_org_color_config(
                mock_request,
                "#abcdef",
                other_org.id,
                admin_user,
                db,
            )
            await update_org_footer_text_config(
                mock_request,
                "Footer v2",
                other_org.id,
                admin_user,
                db,
            )
            await update_org_font_config(
                mock_request,
                "Manrope",
                other_org.id,
                admin_user,
                db,
            )

            with pytest.raises(HTTPException) as exc_info:
                await update_org_watermark_config(
                    mock_request,
                    False,
                    other_org.id,
                    admin_user,
                    db,
                )
            assert exc_info.value.status_code == 403

            await update_org_watermark_config(
                mock_request,
                True,
                other_org.id,
                admin_user,
                db,
            )
            await update_org_auth_branding_config(
                mock_request,
                AuthBrandingConfig(
                    welcome_message="Welcome v2",
                    background_type="gradient",
                    background_image="",
                    text_color="light",
                ),
                other_org.id,
                admin_user,
                db,
            )
            await update_org_landing(
                mock_request,
                {"headline": "Hello v2"},
                other_org.id,
                admin_user,
                db,
            )
            await update_org_seo_config(
                mock_request,
                SeoOrgConfig(
                    default_meta_title_suffix="V2",
                    default_meta_description="SEO v2",
                    google_site_verification="site-v2",
                ),
                other_org.id,
                admin_user,
                db,
            )
            await update_org_signup_mechanism(
                mock_request,
                "inviteOnly",
                other_org.id,
                admin_user,
                db,
            )
            await update_org_ai_config(
                mock_request,
                True,
                other_org.id,
                admin_user,
                db,
                copilot_enabled=False,
            )
            await update_org_communities_config(
                mock_request,
                True,
                other_org.id,
                admin_user,
                db,
            )
            await update_org_payments_config(
                mock_request,
                False,
                other_org.id,
                admin_user,
                db,
            )

        stored = db.exec(
            select(OrganizationConfig).where(OrganizationConfig.org_id == other_org.id)
        ).first()
        assert stored.config["customization"]["general"]["favicon_image"] == "stored-favicon.png"
        assert stored.config["customization"]["general"]["color"] == "#abcdef"
        assert stored.config["customization"]["general"]["footer_text"] == "Footer v2"
        assert stored.config["customization"]["general"]["font"] == "Manrope"
        assert stored.config["customization"]["general"]["watermark"] is True
        assert stored.config["customization"]["auth_branding"]["welcome_message"] == "Welcome v2"
        assert stored.config["customization"]["landing"] == {"headline": "Hello v2"}
        assert stored.config["customization"]["seo"]["default_meta_description"] == "SEO v2"
        assert stored.config["admin_toggles"]["members"]["signup_mode"] == "inviteOnly"
        assert stored.config["admin_toggles"]["ai"]["disabled"] is False
        assert stored.config["admin_toggles"]["ai"]["copilot_enabled"] is False
        assert stored.config["admin_toggles"]["communities"]["disabled"] is False
        assert stored.config["admin_toggles"]["payments"]["disabled"] is True


class TestOrgRbacWave3:
    @pytest.mark.asyncio
    async def test_rbac_check_internal_and_api_token_paths(self, mock_request, db, org):
        internal = InternalUser()
        assert await rbac_check(mock_request, org.org_uuid, internal, "update", db)

        token_delete = APITokenUser(
            org_id=org.id,
            rights={"organizations": {"action_delete": True}},
            token_name="delete",
            created_by_user_id=1,
        )
        with pytest.raises(HTTPException) as delete_exc:
            await rbac_check(mock_request, org.org_uuid, token_delete, "delete", db)
        assert delete_exc.value.status_code == 403

        token_wrong_org = APITokenUser(
            org_id=999,
            rights={"organizations": {"action_update": True}},
            token_name="wrong",
            created_by_user_id=1,
        )
        with pytest.raises(HTTPException) as org_exc:
            await rbac_check(mock_request, org.org_uuid, token_wrong_org, "update", db)
        assert org_exc.value.status_code == 403

        token_no_rights = APITokenUser(
            org_id=org.id,
            rights=None,
            token_name="empty",
            created_by_user_id=1,
        )
        with pytest.raises(HTTPException) as rights_exc:
            await rbac_check(mock_request, org.org_uuid, token_no_rights, "update", db)
        assert rights_exc.value.status_code == 403

        token_object_rights = APITokenUser(
            org_id=org.id,
            token_name="object",
            created_by_user_id=1,
        )
        token_object_rights.rights = SimpleNamespace(
            organizations=SimpleNamespace(action_update=True)
        )
        assert await rbac_check(
            mock_request,
            org.org_uuid,
            token_object_rights,
            "update",
            db,
        )

    @pytest.mark.asyncio
    async def test_rbac_check_regular_user_branches(
        self,
        mock_request,
        db,
        org,
        admin_user,
        regular_user,
    ):
        with patch(
            "src.services.orgs.orgs.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.orgs.orgs.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as anon_exc:
                await rbac_check(mock_request, org.org_uuid, admin_user, "update", db)
        assert anon_exc.value.status_code == 401

        with patch(
            "src.services.orgs.orgs.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.orgs.orgs.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as forbidden_exc:
                await rbac_check(
                    mock_request,
                    org.org_uuid,
                    regular_user,
                    "update",
                    db,
                )
        assert forbidden_exc.value.status_code == 403

        with patch(
            "src.services.orgs.orgs.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.orgs.orgs.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=True,
        ):
            assert await rbac_check(
                mock_request,
                org.org_uuid,
                admin_user,
                "update",
                db,
            ) is None

    @pytest.mark.asyncio
    async def test_update_feature_toggle_helper_v2_branch(self, mock_request, db, org, admin_user):
        _make_org_config(
            db,
            org,
            {"config_version": "2.0", "customization": {}},
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ):
            result = await _update_feature_toggle(
                mock_request,
                "analytics",
                True,
                org.id,
                admin_user,
                db,
                v1_default={"enabled": True},
            )

        stored = db.exec(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        ).first()
        assert result == {"detail": "Analytics configuration updated"}
        assert stored.config["admin_toggles"]["analytics"]["disabled"] is False
