"""Coverage for src/services/orgs/{usage,cache,uploads}.py."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

from src.db.organization_config import OrganizationConfig
from src.services.orgs import cache as org_cache
from src.services.orgs import uploads as org_uploads
from src.services.orgs import usage as org_usage


def _make_org_config(db, org_id: int, config: dict) -> OrganizationConfig:
    row = OrganizationConfig(
        org_id=org_id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class TestOrgCacheHelpers:
    def test_cache_client_and_round_trip_paths(self):
        redis_client = Mock()
        redis_client.get.side_effect = [
            b'{"slug":"cached-org"}',
            b'{"instance":"cached"}',
        ]

        with patch(
            "src.services.orgs.cache.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://cache")
            ),
        ), patch(
            "src.services.orgs.cache.redis.Redis.from_url",
            return_value=redis_client,
        ) as from_url:
            assert org_cache._get_redis_client() is redis_client
            assert org_cache.get_cached_org_by_slug("cached-org") == {
                "slug": "cached-org"
            }
            org_cache.set_cached_org_by_slug("cached-org", {"slug": "cached-org"})
            org_cache.invalidate_org_cache("cached-org")
            assert org_cache.get_cached_instance_info() == {"instance": "cached"}
            org_cache.set_cached_instance_info({"instance": "cached"})

        assert from_url.call_count == 6
        from_url.assert_called_with("redis://cache", socket_connect_timeout=2)
        redis_client.get.assert_any_call("org_cache:slug:cached-org")
        redis_client.get.assert_any_call("org_cache:instance_info")
        redis_client.setex.assert_any_call(
            "org_cache:slug:cached-org",
            org_cache.CACHE_TTL_ORG_SLUG,
            '{"slug": "cached-org"}',
        )
        redis_client.setex.assert_any_call(
            "org_cache:instance_info",
            org_cache.CACHE_TTL_INSTANCE_INFO,
            '{"instance": "cached"}',
        )
        redis_client.delete.assert_called_once_with("org_cache:slug:cached-org")

    def test_cache_helpers_handle_missing_client_and_redis_errors(self):
        with patch("src.services.orgs.cache._get_redis_client", return_value=None):
            assert org_cache.get_cached_org_by_slug("missing") is None
            org_cache.set_cached_org_by_slug("missing", {"slug": "missing"})
            org_cache.invalidate_org_cache("missing")
            assert org_cache.get_cached_instance_info() is None
            org_cache.set_cached_instance_info({"instance": "missing"})

        redis_client = Mock()
        redis_client.get.side_effect = RuntimeError("boom")
        redis_client.setex.side_effect = RuntimeError("boom")
        redis_client.delete.side_effect = RuntimeError("boom")

        with patch("src.services.orgs.cache._get_redis_client", return_value=redis_client):
            assert org_cache.get_cached_org_by_slug("broken") is None
            org_cache.set_cached_org_by_slug("broken", {"slug": "broken"})
            org_cache.invalidate_org_cache("broken")
            assert org_cache.get_cached_instance_info() is None
            org_cache.set_cached_instance_info({"instance": "broken"})

        assert redis_client.get.call_count == 2
        assert redis_client.setex.call_count == 2
        assert redis_client.delete.call_count == 1

    def test_get_redis_client_handles_missing_and_error_paths(self):
        with patch(
            "src.services.orgs.cache.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="")
            ),
        ):
            assert org_cache._get_redis_client() is None

        with patch(
            "src.services.orgs.cache.get_learnhouse_config",
            side_effect=RuntimeError("boom"),
        ):
            assert org_cache._get_redis_client() is None


class TestOrgUsageHelpers:
    def test_usage_cache_helpers_round_trip(self):
        redis_client = Mock()
        redis_client.get.return_value = b'{"usage": 3}'

        with patch(
            "src.services.orgs.usage._get_redis_client",
            return_value=redis_client,
        ):
            assert org_usage._get_cache_key(7) == "org_usage:7"
            assert org_usage._get_cached_usage(7) == {"usage": 3}
            org_usage.invalidate_usage_cache(7)
            org_usage._set_cached_usage(7, {"usage": 4})

        redis_client.get.assert_called_once_with("org_usage:7")
        redis_client.delete.assert_called_once_with("org_usage:7")
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == "org_usage:7"
        assert redis_client.setex.call_args.args[1] == org_usage.USAGE_CACHE_TTL

    def test_usage_cache_helpers_swallow_redis_errors(self):
        redis_client = Mock()
        redis_client.get.side_effect = RuntimeError("boom")
        redis_client.setex.side_effect = RuntimeError("boom")
        redis_client.delete.side_effect = RuntimeError("boom")

        with patch(
            "src.services.orgs.usage._get_redis_client",
            return_value=redis_client,
        ):
            assert org_usage._get_cached_usage(7) is None
            org_usage.invalidate_usage_cache(7)
            org_usage._set_cached_usage(7, {"usage": 4})

    def test_usage_cache_helpers_handle_client_construction_error(self):
        with patch(
            "src.services.orgs.usage._get_redis_client",
            side_effect=RuntimeError("boom"),
        ):
            assert org_usage._get_cached_usage(7) is None
            org_usage.invalidate_usage_cache(7)
            org_usage._set_cached_usage(7, {"usage": 4})

    @pytest.mark.asyncio
    async def test_get_org_usage_and_limits_returns_cached_result(
        self,
        admin_user,
    ):
        cached = {"org_id": 10, "features": {"courses": {"usage": 1}}}

        with patch(
            "src.services.orgs.usage.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as auth_check, patch(
            "src.services.orgs.usage._get_cached_usage",
            return_value=cached,
        ) as get_cached, patch(
            "src.services.orgs.usage._set_cached_usage",
        ) as set_cached:
            result = await org_usage.get_org_usage_and_limits(
                Mock(),
                10,
                admin_user,
                Mock(),
            )

        assert result is cached
        auth_check.assert_awaited_once_with(admin_user.id)
        get_cached.assert_called_once_with(10)
        set_cached.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_org_usage_and_limits_missing_org_config(
        self,
        admin_user,
    ):
        db_session = Mock()
        db_session.exec.return_value.first.return_value = None

        with patch(
            "src.services.orgs.usage.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.usage._get_cached_usage",
            return_value=None,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_usage.get_org_usage_and_limits(
                    Mock(),
                    10,
                    admin_user,
                    db_session,
                )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_org_usage_and_limits_saas_mode_builds_response(
        self,
        db,
        org,
        admin_user,
    ):
        _make_org_config(
            db,
            org.id,
            {
                "config_version": "2.0",
                "plan": "pro",
                "admin_toggles": {},
            },
        )

        with patch(
            "src.services.orgs.usage.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.usage._get_cached_usage",
            return_value=None,
        ), patch(
            "src.services.orgs.usage.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.services.orgs.usage._get_actual_usage",
            side_effect=[3, 1],
        ), patch(
            "src.services.orgs.usage._get_actual_admin_seat_count",
            return_value=2,
        ), patch(
            "src.services.orgs.usage.get_plan_limit",
            side_effect=[4, 2],
        ) as get_plan_limit, patch(
            "src.services.orgs.usage.get_purchased_member_seats",
            return_value=5,
        ) as purchased, patch(
            "src.security.features_utils.resolve.resolve_feature",
            side_effect=[
                {"enabled": True, "limit": 0},
                {"enabled": True, "limit": 6},
            ],
        ) as resolve_feature, patch(
            "src.services.orgs.usage._set_cached_usage",
        ) as set_cached:
            result = await org_usage.get_org_usage_and_limits(
                Mock(),
                org.id,
                admin_user,
                db,
            )

        assert result["org_id"] == org.id
        assert result["plan"] == "pro"
        assert result["mode"] == "saas"
        assert result["features"]["courses"]["limit"] == "unlimited"
        assert result["features"]["courses"]["remaining"] == "unlimited"
        assert result["features"]["courses"]["limit_reached"] is False
        assert result["features"]["members"]["limit"] == 6
        assert result["features"]["members"]["plan_limit"] == 4
        assert result["features"]["members"]["purchased"] == 5
        assert result["features"]["members"]["remaining"] == 5
        assert result["features"]["members"]["limit_reached"] is False
        assert result["features"]["admin_seats"]["limit"] == 2
        assert result["features"]["admin_seats"]["remaining"] == 0
        assert result["features"]["admin_seats"]["limit_reached"] is True
        resolve_feature.assert_any_call("courses", {"config_version": "2.0", "plan": "pro", "admin_toggles": {}}, org.id)
        resolve_feature.assert_any_call("members", {"config_version": "2.0", "plan": "pro", "admin_toggles": {}}, org.id)
        get_plan_limit.assert_any_call("pro", "members")
        get_plan_limit.assert_any_call("pro", "admin_seats")
        purchased.assert_called_once_with(org.id)
        set_cached.assert_called_once_with(org.id, result)

    @pytest.mark.asyncio
    async def test_get_org_usage_and_limits_non_saas_mode_uses_unlimited_plans(
        self,
        db,
        org,
        admin_user,
    ):
        _make_org_config(
            db,
            org.id,
            {
                "config_version": "2.0",
                "plan": "standard",
                "admin_toggles": {},
            },
        )

        with patch(
            "src.services.orgs.usage.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.usage._get_cached_usage",
            return_value=None,
        ), patch(
            "src.services.orgs.usage.get_deployment_mode",
            return_value="oss",
        ), patch(
            "src.services.orgs.usage._get_actual_usage",
            side_effect=[2, 1],
        ), patch(
            "src.services.orgs.usage._get_actual_admin_seat_count",
            return_value=0,
        ), patch(
            "src.services.orgs.usage.get_plan_limit",
        ) as get_plan_limit, patch(
            "src.services.orgs.usage.get_purchased_member_seats",
        ) as purchased, patch(
            "src.security.features_utils.resolve.resolve_feature",
            side_effect=[
                {"enabled": True, "limit": 3},
                {"enabled": True, "limit": 4},
            ],
        ), patch(
            "src.services.orgs.usage._set_cached_usage",
        ):
            result = await org_usage.get_org_usage_and_limits(
                Mock(),
                org.id,
                admin_user,
                db,
            )

        assert result["mode"] == "oss"
        assert result["features"]["courses"]["limit"] == 3
        assert result["features"]["members"]["limit"] == 4
        assert result["features"]["members"]["plan_limit"] == "unlimited"
        assert result["features"]["members"]["purchased"] == 0
        assert result["features"]["admin_seats"]["limit"] == "unlimited"
        get_plan_limit.assert_not_called()
        purchased.assert_not_called()


class TestOrgUploadWrappers:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "wrapper, file_name, expected_kwargs",
        [
            (
                org_uploads.upload_org_logo,
                "logo.png",
                {
                    "directory": "logos",
                    "type_of_dir": "orgs",
                    "allowed_types": ["image"],
                    "filename_prefix": "logo",
                },
            ),
            (
                org_uploads.upload_org_thumbnail,
                "thumb.png",
                {
                    "directory": "thumbnails",
                    "type_of_dir": "orgs",
                    "allowed_types": ["image"],
                    "filename_prefix": "thumbnail",
                },
            ),
            (
                org_uploads.upload_org_preview,
                "preview.png",
                {
                    "directory": "previews",
                    "type_of_dir": "orgs",
                    "allowed_types": ["image"],
                    "filename_prefix": "preview",
                },
            ),
            (
                org_uploads.upload_org_landing_content,
                "landing.html",
                {
                    "directory": "landing",
                    "type_of_dir": "orgs",
                    "allowed_types": ["image", "video", "document"],
                    "filename_prefix": "landing",
                },
            ),
            (
                org_uploads.upload_org_auth_background,
                "background.png",
                {
                    "directory": "auth_backgrounds",
                    "type_of_dir": "orgs",
                    "allowed_types": ["image"],
                    "filename_prefix": "auth_bg",
                },
            ),
            (
                org_uploads.upload_org_og_image,
                "og.png",
                {
                    "directory": "og_images",
                    "type_of_dir": "orgs",
                    "allowed_types": ["image"],
                    "filename_prefix": "og",
                },
            ),
            (
                org_uploads.upload_org_favicon,
                "favicon.ico",
                {
                    "directory": "favicons",
                    "type_of_dir": "orgs",
                    "allowed_types": ["image"],
                    "filename_prefix": "favicon",
                },
            ),
        ],
    )
    async def test_upload_wrappers_delegate_to_upload_file(
        self,
        wrapper,
        file_name,
        expected_kwargs,
    ):
        upload_file = AsyncMock(return_value="saved-name")
        fake_file = Mock()
        fake_file.filename = file_name

        with patch("src.services.orgs.uploads.upload_file", upload_file):
            result = await wrapper(fake_file, "org-uuid")

        assert result == "saved-name"
        upload_file.assert_awaited_once()
        assert upload_file.await_args.kwargs["file"] is fake_file
        assert upload_file.await_args.kwargs["uuid"] == "org-uuid"
        for key, value in expected_kwargs.items():
            assert upload_file.await_args.kwargs[key] == value
