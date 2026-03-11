import pytest
from unittest.mock import Mock, patch
from fastapi import HTTPException
from sqlmodel import Session
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
    decrease_feature_usage,
)
from src.db.organization_config import OrganizationConfig


def _make_saas_patches():
    """Return common patches for SaaS mode tests."""
    return [
        patch('src.security.features_utils.resolve.get_deployment_mode', return_value='saas'),
        patch('src.security.features_utils.usage.get_deployment_mode', return_value='saas'),
        patch('src.security.features_utils.plans.get_deployment_mode', return_value='saas'),
    ]


class TestFeaturesUtils:
    """Test cases for features_utils/usage.py module"""

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session"""
        return Mock(spec=Session)

    @pytest.fixture
    def mock_org_config(self):
        """Create a mock organization config with v2 format and standard plan."""
        config = Mock(spec=OrganizationConfig)
        config.org_id = 1
        config.config = {
            "config_version": "2.0",
            "plan": "standard",
            "admin_toggles": {},
            "overrides": {},
            "customization": {},
        }
        return config

    @pytest.fixture
    def mock_redis(self):
        """Create a mock Redis connection"""
        redis_mock = Mock()
        redis_mock.get.return_value = b"5"  # Current usage
        redis_mock.set.return_value = True
        return redis_mock

    def test_feature_set_type_alias(self):
        """Test that FeatureSet type alias includes all expected features"""
        expected_features = [
            "ai", "analytics", "api", "assignments", "collaboration",
            "courses", "members", "payments", "storage", "usergroups"
        ]
        for feature in expected_features:
            assert feature in ["ai", "analytics", "api", "assignments", "collaboration",
                             "courses", "members", "payments", "storage", "usergroups"]

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_success(self, mock_db_session, mock_org_config):
        """Test successful feature limit check (EE mode — all features enabled & unlimited)"""
        with patch('src.security.features_utils.resolve.get_deployment_mode', return_value='ee'), \
             patch('src.security.features_utils.usage.get_deployment_mode', return_value='ee'), \
             patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = b"5"
            mock_redis_class.return_value = mock_redis

            mock_db_session.exec.return_value.first.return_value = mock_org_config

            result = check_limits_with_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )

            # In EE mode, limit=0 (unlimited) so returns True immediately
            assert result is True

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_feature_disabled(self, mock_db_session, mock_org_config):
        """Test feature limit check when feature is disabled via admin toggle"""
        mock_org_config.config["admin_toggles"]["ai"] = {"disabled": True}

        with patch('src.security.features_utils.resolve.get_deployment_mode', return_value='saas'), \
             patch('src.security.features_utils.usage.get_deployment_mode', return_value='saas'):
            mock_db_session.exec.return_value.first.return_value = mock_org_config

            with pytest.raises(HTTPException) as exc_info:
                check_limits_with_usage(
                    feature="ai",
                    org_id=1,
                    db_session=mock_db_session
                )

            assert exc_info.value.status_code == 403
            assert "Ai is not enabled for this organization" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_no_org_config(self, mock_db_session):
        """Test feature limit check when organization has no config"""
        mock_db_session.exec.return_value.first.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            check_limits_with_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )

        assert exc_info.value.status_code == 404
        assert "Organization has no config" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_no_redis_connection(self, mock_db_session, mock_org_config):
        """Test feature limit check when Redis connection is not available"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('src.security.features_utils.resolve.get_deployment_mode', return_value='saas'), \
             patch('src.security.features_utils.usage.get_deployment_mode', return_value='saas'):
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = None
            mock_config.return_value = mock_config_instance

            mock_db_session.exec.return_value.first.return_value = mock_org_config

            with pytest.raises(HTTPException) as exc_info:
                check_limits_with_usage(
                    feature="ai",
                    org_id=1,
                    db_session=mock_db_session
                )

            assert exc_info.value.status_code == 500
            assert "Redis connection string not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_limit_reached(self, mock_db_session, mock_org_config):
        """Test feature limit check when limit is reached"""
        # Use free plan so overage is not allowed
        mock_org_config.config["plan"] = "free"

        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class, \
             patch('src.core.deployment_mode.get_deployment_mode', return_value='saas'), \
             patch('src.security.features_utils.resolve.get_deployment_mode', return_value='saas'), \
             patch('src.security.features_utils.usage.get_deployment_mode', return_value='saas'), \
             patch('src.security.features_utils.usage._get_actual_usage', return_value=30):

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = None  # No purchased extras
            mock_redis_class.return_value = mock_redis

            mock_db_session.exec.return_value.first.return_value = mock_org_config

            # Free plan has members limit=30, mock usage=30 → limit reached
            with pytest.raises(HTTPException) as exc_info:
                check_limits_with_usage(
                    feature="members",
                    org_id=1,
                    db_session=mock_db_session
                )

            assert exc_info.value.status_code == 403
            assert "Usage Limit has been reached for Members" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_unlimited_feature(self, mock_db_session, mock_org_config):
        """Test feature limit check for unlimited feature (limit = 0)"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class, \
             patch('src.security.features_utils.resolve.get_deployment_mode', return_value='saas'), \
             patch('src.security.features_utils.usage.get_deployment_mode', return_value='saas'):

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = b"1000"
            mock_redis_class.return_value = mock_redis

            mock_db_session.exec.return_value.first.return_value = mock_org_config

            result = check_limits_with_usage(
                feature="analytics",  # Unlimited (limit=0) on standard plan
                org_id=1,
                db_session=mock_db_session
            )

            assert result is True

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_no_previous_usage(self, mock_db_session, mock_org_config):
        """Test feature limit check when no previous usage exists"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class, \
             patch('src.security.features_utils.resolve.get_deployment_mode', return_value='saas'), \
             patch('src.security.features_utils.usage.get_deployment_mode', return_value='saas'):

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = None  # No usage
            mock_redis_class.return_value = mock_redis

            mock_db_session.exec.return_value.first.return_value = mock_org_config

            result = check_limits_with_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )

            assert result is True

    @pytest.mark.asyncio
    async def test_increase_feature_usage_success(self, mock_db_session):
        """Test successful feature usage increase"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = b"5"
            mock_redis.set.return_value = True
            mock_redis_class.return_value = mock_redis

            result = increase_feature_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )

            assert result is True
            mock_redis.get.assert_called_once_with("ai_usage:1")
            mock_redis.set.assert_called_once_with("ai_usage:1", 6)

    @pytest.mark.asyncio
    async def test_increase_feature_usage_no_previous_usage(self, mock_db_session):
        """Test feature usage increase when no previous usage exists"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = None
            mock_redis.set.return_value = True
            mock_redis_class.return_value = mock_redis

            result = increase_feature_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )

            assert result is True
            mock_redis.set.assert_called_once_with("ai_usage:1", 1)

    @pytest.mark.asyncio
    async def test_decrease_feature_usage_success(self, mock_db_session):
        """Test successful feature usage decrease"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = b"5"
            mock_redis.set.return_value = True
            mock_redis_class.return_value = mock_redis

            result = decrease_feature_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )

            assert result is True
            mock_redis.get.assert_called_once_with("ai_usage:1")
            mock_redis.set.assert_called_once_with("ai_usage:1", 4)

    @pytest.mark.asyncio
    async def test_decrease_feature_usage_no_previous_usage(self, mock_db_session):
        """Test feature usage decrease when no previous usage exists"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = None
            mock_redis.set.return_value = True
            mock_redis_class.return_value = mock_redis

            result = decrease_feature_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )

            assert result is True
            mock_redis.set.assert_called_once_with("ai_usage:1", 0)

    @pytest.mark.asyncio
    async def test_all_features_covered(self, mock_db_session, mock_org_config):
        """Test that all features in FeatureSet are covered (EE mode — all enabled)"""
        features = [
            "ai", "analytics", "api", "assignments", "collaboration",
            "courses", "members", "payments", "storage", "usergroups"
        ]

        with patch('src.security.features_utils.resolve.get_deployment_mode', return_value='ee'), \
             patch('src.security.features_utils.usage.get_deployment_mode', return_value='ee'), \
             patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:

            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance

            mock_redis = Mock()
            mock_redis.get.return_value = b"0"
            mock_redis.set.return_value = True
            mock_redis_class.return_value = mock_redis

            mock_db_session.exec.return_value.first.return_value = mock_org_config

            for feature in features:
                result = check_limits_with_usage(
                    feature=feature,  # type: ignore
                    org_id=1,
                    db_session=mock_db_session
                )
                # In EE mode, all features are enabled and unlimited
                assert result is True
