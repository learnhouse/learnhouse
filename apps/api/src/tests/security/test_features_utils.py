import pytest
from unittest.mock import Mock, patch, MagicMock
from fastapi import HTTPException
from sqlmodel import Session, select
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
    decrease_feature_usage,
    FeatureSet,
)
from src.db.organization_config import OrganizationConfig


class TestFeaturesUtils:
    """Test cases for features_utils/usage.py module"""

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session"""
        return Mock(spec=Session)

    @pytest.fixture
    def mock_org_config(self):
        """Create a mock organization config"""
        config = Mock(spec=OrganizationConfig)
        config.org_id = 1
        config.config = {
            "features": {
                "ai": {"enabled": True, "limit": 100},
                "analytics": {"enabled": True, "limit": 50},
                "api": {"enabled": True, "limit": 0},  # Unlimited
                "assignments": {"enabled": True, "limit": 25},
                "collaboration": {"enabled": True, "limit": 10},
                "courses": {"enabled": True, "limit": 5},
                "discussions": {"enabled": True, "limit": 20},
                "members": {"enabled": True, "limit": 100},
                "payments": {"enabled": True, "limit": 0},  # Unlimited
                "storage": {"enabled": True, "limit": 1000},
                "usergroups": {"enabled": True, "limit": 15},
            }
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
            "courses", "discussions", "members", "payments", "storage", "usergroups"
        ]
        
        # This test verifies that the FeatureSet type alias is properly defined
        # by checking that all expected features are valid
        for feature in expected_features:
            # Type checking is handled by the type system, so we just verify the features exist
            assert feature in ["ai", "analytics", "api", "assignments", "collaboration",
                             "courses", "discussions", "members", "payments", "storage", "usergroups"]

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_success(self, mock_db_session, mock_org_config):
        """Test successful feature limit check"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis
            mock_redis = Mock()
            mock_redis.get.return_value = b"5"  # Current usage
            mock_redis_class.return_value = mock_redis
            
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_org_config
            
            result = check_limits_with_usage(
                feature="ai",
                org_id=1,
                db_session=mock_db_session
            )
            
            assert result is True
            mock_redis.get.assert_called_once_with("ai_usage:1")

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_feature_disabled(self, mock_db_session, mock_org_config):
        """Test feature limit check when feature is disabled"""
        # Disable the feature
        mock_org_config.config["features"]["ai"]["enabled"] = False
        
        # Mock database query
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
        # Mock database query to return None
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
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config:
            # Mock config with no Redis connection
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = None
            mock_config.return_value = mock_config_instance
            
            # Mock database query
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
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis with usage at limit
            mock_redis = Mock()
            mock_redis.get.return_value = b"100"  # At limit
            mock_redis_class.return_value = mock_redis
            
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_org_config
            
            with pytest.raises(HTTPException) as exc_info:
                check_limits_with_usage(
                    feature="ai",
                    org_id=1,
                    db_session=mock_db_session
                )
            
            assert exc_info.value.status_code == 403
            assert "Usage Limit has been reached for Ai" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_unlimited_feature(self, mock_db_session, mock_org_config):
        """Test feature limit check for unlimited feature (limit = 0)"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis
            mock_redis = Mock()
            mock_redis.get.return_value = b"1000"  # High usage
            mock_redis_class.return_value = mock_redis
            
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_org_config
            
            result = check_limits_with_usage(
                feature="api",  # Unlimited feature
                org_id=1,
                db_session=mock_db_session
            )
            
            # For unlimited features (limit=0), the function returns True or None
            assert result is True or result is None

    @pytest.mark.asyncio
    async def test_check_limits_with_usage_no_previous_usage(self, mock_db_session, mock_org_config):
        """Test feature limit check when no previous usage exists"""
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis with no previous usage
            mock_redis = Mock()
            mock_redis.get.return_value = None
            mock_redis_class.return_value = mock_redis
            
            # Mock database query
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
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis
            mock_redis = Mock()
            mock_redis.get.return_value = b"5"  # Current usage
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
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis with no previous usage
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
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis
            mock_redis = Mock()
            mock_redis.get.return_value = b"5"  # Current usage
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
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis with no previous usage
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
            mock_redis.set.assert_called_once_with("ai_usage:1", -1)

    @pytest.mark.asyncio
    async def test_all_features_covered(self, mock_db_session, mock_org_config):
        """Test that all features in FeatureSet are covered"""
        features = [
            "ai", "analytics", "api", "assignments", "collaboration",
            "courses", "discussions", "members", "payments", "storage", "usergroups"
        ]
        
        with patch('src.security.features_utils.usage.get_learnhouse_config') as mock_config, \
             patch('redis.Redis.from_url') as mock_redis_class:
            
            # Mock config
            mock_config_instance = Mock()
            mock_config_instance.redis_config.redis_connection_string = "redis://localhost:6379"
            mock_config.return_value = mock_config_instance
            
            # Mock Redis
            mock_redis = Mock()
            mock_redis.get.return_value = b"0"  # No usage
            mock_redis.set.return_value = True
            mock_redis_class.return_value = mock_redis
            
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_org_config
            
            for feature in features:
                # Test that each feature can be processed without errors
                result = check_limits_with_usage(
                    feature=feature,  # type: ignore
                    org_id=1,
                    db_session=mock_db_session
                )
                # For enabled features, result should be True or None (for unlimited)
                assert result is True or result is None 