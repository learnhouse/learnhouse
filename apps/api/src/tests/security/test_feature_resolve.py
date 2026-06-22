from unittest.mock import Mock, patch

from src.security.features_utils.resolve import (
    _fetch_purchased_extras,
    _get_admin_toggle,
    _get_overrides,
    _get_plan_from_config,
    _get_purchased_extra,
    resolve_all_features,
    resolve_feature,
)


class TestFeatureResolve:
    def test_config_extractors_cover_v1_v2_shapes(self):
        v2_config = {
            "config_version": "2.0",
            "plan": "pro",
            "admin_toggles": {
                "boards": {"disabled": True},
            },
            "overrides": {
                "members": {"extra_limit": 7},
            },
        }
        v1_config = {
            "cloud": {"plan": "standard"},
            "features": {
                "boards": {
                    "enabled": False,
                    "copilot_enabled": True,
                    "signup_mode": "invite",
                }
            },
        }

        assert _get_plan_from_config(v2_config) == "pro"
        assert _get_plan_from_config(v1_config) == "standard"
        assert _get_admin_toggle(v2_config, "boards") == {"disabled": True}
        assert _get_admin_toggle(v1_config, "boards") == {
            "disabled": True,
            "copilot_enabled": True,
            "signup_mode": "invite",
        }
        assert _get_overrides(v2_config, "members") == {"extra_limit": 7}
        assert _get_overrides(v1_config, "members") == {}

    def test_purchased_extra_branches(self):
        redis_client = Mock()
        redis_client.get.side_effect = [b"9", b"4", None]

        with patch(
            "src.core.redis.get_redis_client",
            return_value=redis_client,
        ):
            assert _get_purchased_extra(1, "ai") == 9
            assert _get_purchased_extra(2, "members") == 4
            assert _get_purchased_extra(3, "unknown") == 0

        with patch(
            "src.core.redis.get_redis_client",
            side_effect=RuntimeError("boom"),
        ):
            assert _get_purchased_extra(4, "ai") == 0

    def test_always_on_features_and_mode_shortcuts(self):
        with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="oss"):
            assert resolve_feature("usergroups", {}, 0) == {
                "enabled": True,
                "limit": 0,
                "required_plan": "standard",
            }

        for mode in ("ee", "oss"):
            with patch(
                "src.security.features_utils.resolve.get_deployment_mode",
                return_value=mode,
            ):
                assert resolve_feature("courses", {}, 0) == {
                    "enabled": True,
                    "limit": 0,
                    "required_plan": None,
                }

    def test_saas_resolution_covers_overrides_limits_and_admin_toggles(self):
        config = {
            "config_version": "2.0",
            "plan": "free",
            "admin_toggles": {
                "members": {"disabled": False},
                "boards": {"disabled": True},
            },
            "overrides": {
                "members": {"extra_limit": 3},
                "analytics": {"force_enabled": True},
            },
        }

        with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.resolve._get_purchased_extra",
            return_value=4,
        ):
            members = resolve_feature("members", config, org_id=12)
            analytics = resolve_feature("analytics", config, org_id=12)
            boards = resolve_feature("boards", config, org_id=12)
            ai = resolve_feature("ai", {"config_version": "2.0", "plan": "free"}, org_id=0)

        assert members == {
            "enabled": True,
            "limit": 17,
            "required_plan": None,
        }
        assert analytics == {
            "enabled": True,
            "limit": 0,
            "required_plan": "standard",
        }
        assert boards == {
            "enabled": False,
            "limit": 0,
            "required_plan": "personal",
        }
        assert ai == {
            "enabled": False,
            "limit": 0,
            "required_plan": "standard",
        }

    def test_courses_saas_limit_resolution_uses_plan_overrides_and_purchased_extra(self):
        config = {"config_version": "2.0", "plan": "standard"}

        with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.resolve.get_plan_feature_config",
            side_effect=[{"limit": 0}, {"limit": 5}],
        ), patch(
            "src.security.features_utils.resolve._get_overrides",
            return_value={"extra_limit": 2},
        ), patch(
            "src.security.features_utils.resolve._get_purchased_extra",
            return_value=4,
        ):
            unlimited = resolve_feature("courses", config, org_id=12)
            limited = resolve_feature("courses", config, org_id=12)

        assert unlimited == {
            "enabled": True,
            "limit": 0,
            "required_plan": None,
        }
        assert limited == {
            "enabled": True,
            "limit": 11,
            "required_plan": None,
        }

    def test_ee_and_oss_mode_shortcuts_cover_admin_toggle_and_ee_only_blocks(self):
        config = {
            "config_version": "2.0",
            "admin_toggles": {
                "analytics": {"disabled": True},
                "boards": {"disabled": False},
            },
        }
        config_allowed = {
            "config_version": "2.0",
            "admin_toggles": {
                "analytics": {"disabled": False},
            },
        }

        with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="ee"):
            ee_disabled = resolve_feature("analytics", config, org_id=0)

        with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="oss"):
            oss_blocked = resolve_feature("sso", config, org_id=0)
            oss_allowed = resolve_feature("analytics", config_allowed, org_id=0)

        assert ee_disabled == {
            "enabled": False,
            "limit": 0,
            "required_plan": "standard",
        }
        assert oss_blocked == {
            "enabled": False,
            "limit": 0,
            "required_plan": "enterprise",
        }
        assert oss_allowed == {
            "enabled": True,
            "limit": 0,
            "required_plan": "standard",
        }

    def test_fetch_purchased_extras_returns_defaults_when_org_id_zero(self):
        result = _fetch_purchased_extras(0)
        assert result == {"ai": 0, "members": 0, "admin_seats": 0}

    def test_fetch_purchased_extras_returns_defaults_when_redis_unavailable(self):
        with patch("src.core.redis.get_redis_client", return_value=None):
            result = _fetch_purchased_extras(5)
        assert result == {"ai": 0, "members": 0, "admin_seats": 0}

    def test_fetch_purchased_extras_returns_values_from_redis(self):
        redis_client = Mock()
        redis_client.mget.return_value = [b"100", b"50"]
        with patch("src.core.redis.get_redis_client", return_value=redis_client):
            result = _fetch_purchased_extras(7)
        assert result == {"ai": 100, "members": 50, "admin_seats": 50}
        redis_client.mget.assert_called_once_with(
            ["ai_credits_purchased:7", "member_seats_purchased:7"]
        )

    def test_fetch_purchased_extras_handles_none_redis_values(self):
        redis_client = Mock()
        redis_client.mget.return_value = [None, None]
        with patch("src.core.redis.get_redis_client", return_value=redis_client):
            result = _fetch_purchased_extras(8)
        assert result == {"ai": 0, "members": 0, "admin_seats": 0}

    def test_fetch_purchased_extras_returns_defaults_on_exception(self):
        with patch("src.core.redis.get_redis_client", side_effect=RuntimeError("redis down")):
            result = _fetch_purchased_extras(9)
        assert result == {"ai": 0, "members": 0, "admin_seats": 0}

    def test_get_purchased_extra_uses_pre_fetched_extras(self):
        extras = {"ai": 42, "members": 10, "admin_seats": 10}
        # No redis call should happen when _extras is provided
        with patch("src.core.redis.get_redis_client") as mock_redis:
            assert _get_purchased_extra(5, "ai", _extras=extras) == 42
            assert _get_purchased_extra(5, "members", _extras=extras) == 10
            assert _get_purchased_extra(5, "unknown_feature", _extras=extras) == 0
            mock_redis.assert_not_called()

    def test_get_purchased_extra_returns_zero_when_org_id_is_zero(self):
        assert _get_purchased_extra(0, "ai") == 0

    def test_get_purchased_extra_returns_zero_when_redis_unavailable(self):
        with patch("src.core.redis.get_redis_client", return_value=None):
            assert _get_purchased_extra(10, "ai") == 0

    def test_resolve_all_features_skips_fetch_when_org_id_zero(self):
        with patch(
            "src.security.features_utils.resolve._fetch_purchased_extras"
        ) as mock_fetch, patch(
            "src.security.features_utils.resolve.resolve_feature",
            return_value={"enabled": True, "limit": 0, "required_plan": None},
        ):
            result = resolve_all_features({"config_version": "2.0"}, org_id=0)
        mock_fetch.assert_not_called()
        assert len(result) == 19

    def test_resolve_all_features_uses_resolve_feature_for_every_entry(self):
        calls = []

        def _fake_resolve(feature: str, config: dict, org_id: int = 0, _extras=None):
            calls.append((feature, config, org_id))
            return {"enabled": True, "limit": 1, "required_plan": None}

        with patch("src.security.features_utils.resolve.resolve_feature", side_effect=_fake_resolve):
            result = resolve_all_features({"config_version": "2.0"}, org_id=9)

        assert list(result) == [
            "ai",
            "analytics",
            "api",
            "assignments",
            "audit_logs",
            "boards",
            "collaboration",
            "folders",
            "communities",
            "courses",
            "members",
            "payments",
            "playgrounds",
            "podcasts",
            "roles",
            "scorm",
            "sso",
            "usergroups",
            "versioning",
        ]
        assert len(calls) == 19
        assert calls[0] == ("ai", {"config_version": "2.0"}, 9)
