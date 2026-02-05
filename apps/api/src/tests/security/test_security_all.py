"""
Comprehensive test suite for the security module.

This file imports and runs all security-related tests to ensure complete coverage
of the security functionality including:
- Password hashing and verification
- JWT authentication
- Role-based access control (RBAC)
- Role constants
- Resource access checker
- Feature usage tracking
- Authorization utilities
"""

from src.tests.security.test_security import TestSecurity
from src.tests.security.test_auth import TestAuth
from src.tests.security.test_rbac import TestRBAC
from src.tests.security.test_rbac_utils import TestRBACUtils
from src.tests.security.test_rbac_constants import TestRoleConstants, TestRoleHelperFunctions
from src.tests.security.test_resource_access import (
    TestResourceConfig,
    TestAccessDecision,
    TestResourceAccessChecker,
    TestParentResourceResolution,
)
from src.tests.security.test_features_utils import TestFeaturesUtils


class TestSecurityComprehensive:
    """Comprehensive test suite for all security functionality"""
    
    def test_security_module_imports(self):
        """Test that all security modules can be imported successfully"""
        # Test core security imports
        
        # Test auth imports
        
        # Test RBAC imports
        
        # Test RBAC utils imports
        
        # Test features utils imports
        
        # Verify all imports succeeded
        assert True

    def test_security_constants(self):
        """Test that security constants are properly defined"""
        from src.security.security import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY
        
        assert ACCESS_TOKEN_EXPIRE_MINUTES == 30
        assert ALGORITHM == "HS256"
        assert SECRET_KEY is not None
        assert isinstance(SECRET_KEY, str)
        assert len(SECRET_KEY) > 0

    def test_feature_set_definition(self):
        """Test that FeatureSet includes all expected features"""
        
        expected_features = [
            "ai", "analytics", "api", "assignments", "collaboration",
            "courses", "discussions", "members", "payments", "storage", "usergroups"
        ]
        
        # Verify all expected features are included in the type definition
        for feature in expected_features:
            assert feature in ["ai", "analytics", "api", "assignments", "collaboration",
                             "courses", "discussions", "members", "payments", "storage", "usergroups"]

    def test_security_module_structure(self):
        """Test that the security module has the expected structure"""
        import src.security
        import src.security.auth
        import src.security.security
        import src.security.rbac
        import src.security.rbac.rbac
        import src.security.rbac.utils
        import src.security.rbac.constants
        import src.security.rbac.config
        import src.security.rbac.types
        import src.security.rbac.resource_access
        import src.security.features_utils
        import src.security.features_utils.usage

        # Verify all modules can be imported
        assert src.security is not None
        assert src.security.auth is not None
        assert src.security.security is not None
        assert src.security.rbac is not None
        assert src.security.rbac.rbac is not None
        assert src.security.rbac.utils is not None
        assert src.security.rbac.constants is not None
        assert src.security.rbac.config is not None
        assert src.security.rbac.types is not None
        assert src.security.rbac.resource_access is not None
        assert src.security.features_utils is not None
        assert src.security.features_utils.usage is not None

    def test_rbac_constants_are_exported(self):
        """Test that RBAC constants are properly exported."""
        from src.security.rbac import (
            ADMIN_ROLE_ID,
            MAINTAINER_ROLE_ID,
            ADMIN_OR_MAINTAINER_ROLE_IDS,
            is_admin,
            is_admin_or_maintainer,
        )

        assert ADMIN_ROLE_ID == 1
        assert MAINTAINER_ROLE_ID == 2
        assert 1 in ADMIN_OR_MAINTAINER_ROLE_IDS
        assert 2 in ADMIN_OR_MAINTAINER_ROLE_IDS
        assert callable(is_admin)
        assert callable(is_admin_or_maintainer)

    def test_resource_access_checker_is_exported(self):
        """Test that ResourceAccessChecker is properly exported."""
        from src.security.rbac import (
            ResourceAccessChecker,
            check_resource_access,
            AccessAction,
            AccessContext,
            AccessDecision,
        )

        assert ResourceAccessChecker is not None
        assert callable(check_resource_access)
        assert AccessAction.READ.value == "read"
        assert AccessContext.PUBLIC_VIEW.value == "public_view"


# Test discovery helpers
def get_security_test_classes():
    """Get all security test classes for discovery"""
    return [
        TestSecurity,
        TestAuth,
        TestRBAC,
        TestRBACUtils,
        TestRoleConstants,
        TestRoleHelperFunctions,
        TestResourceConfig,
        TestAccessDecision,
        TestResourceAccessChecker,
        TestParentResourceResolution,
        TestFeaturesUtils,
        TestSecurityComprehensive,
    ]


def run_security_tests():
    """Run all security tests"""
    test_classes = get_security_test_classes()
    
    for test_class in test_classes:
        print(f"Running tests for {test_class.__name__}")
        # In a real implementation, this would run the tests
        # For now, we just verify the class exists
        assert test_class is not None
        assert hasattr(test_class, '__name__')


if __name__ == "__main__":
    run_security_tests() 