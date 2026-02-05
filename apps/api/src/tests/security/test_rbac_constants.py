"""
Tests for RBAC Role Constants

This module tests the role constants and helper functions used throughout
the RBAC system to ensure consistency and correctness.
"""

import pytest
from src.security.rbac.constants import (
    ADMIN_ROLE_ID,
    MAINTAINER_ROLE_ID,
    ADMIN_ROLE_IDS,
    ADMIN_OR_MAINTAINER_ROLE_IDS,
    is_admin,
    is_admin_or_maintainer,
    has_elevated_privileges,
)


class TestRoleConstants:
    """Test cases for role ID constants."""

    def test_admin_role_id_value(self):
        """Test that ADMIN_ROLE_ID has the expected value."""
        assert ADMIN_ROLE_ID == 1

    def test_maintainer_role_id_value(self):
        """Test that MAINTAINER_ROLE_ID has the expected value."""
        assert MAINTAINER_ROLE_ID == 2

    def test_admin_role_ids_contains_admin(self):
        """Test that ADMIN_ROLE_IDS contains the admin role."""
        assert ADMIN_ROLE_ID in ADMIN_ROLE_IDS
        assert len(ADMIN_ROLE_IDS) == 1

    def test_admin_or_maintainer_role_ids_contains_both(self):
        """Test that ADMIN_OR_MAINTAINER_ROLE_IDS contains both roles."""
        assert ADMIN_ROLE_ID in ADMIN_OR_MAINTAINER_ROLE_IDS
        assert MAINTAINER_ROLE_ID in ADMIN_OR_MAINTAINER_ROLE_IDS
        assert len(ADMIN_OR_MAINTAINER_ROLE_IDS) == 2

    def test_role_id_sets_are_immutable(self):
        """Test that role ID sets are frozen (immutable)."""
        assert isinstance(ADMIN_ROLE_IDS, frozenset)
        assert isinstance(ADMIN_OR_MAINTAINER_ROLE_IDS, frozenset)


class TestRoleHelperFunctions:
    """Test cases for role helper functions."""

    def test_is_admin_with_admin_role(self):
        """Test is_admin returns True for admin role."""
        assert is_admin(ADMIN_ROLE_ID) is True

    def test_is_admin_with_maintainer_role(self):
        """Test is_admin returns False for maintainer role."""
        assert is_admin(MAINTAINER_ROLE_ID) is False

    def test_is_admin_with_member_role(self):
        """Test is_admin returns False for member roles."""
        assert is_admin(3) is False
        assert is_admin(4) is False
        assert is_admin(100) is False

    def test_is_admin_or_maintainer_with_admin_role(self):
        """Test is_admin_or_maintainer returns True for admin role."""
        assert is_admin_or_maintainer(ADMIN_ROLE_ID) is True

    def test_is_admin_or_maintainer_with_maintainer_role(self):
        """Test is_admin_or_maintainer returns True for maintainer role."""
        assert is_admin_or_maintainer(MAINTAINER_ROLE_ID) is True

    def test_is_admin_or_maintainer_with_member_role(self):
        """Test is_admin_or_maintainer returns False for member roles."""
        assert is_admin_or_maintainer(3) is False
        assert is_admin_or_maintainer(4) is False
        assert is_admin_or_maintainer(100) is False

    def test_has_elevated_privileges_with_admin_role(self):
        """Test has_elevated_privileges returns True for admin role."""
        assert has_elevated_privileges(ADMIN_ROLE_ID) is True

    def test_has_elevated_privileges_with_maintainer_role(self):
        """Test has_elevated_privileges returns True for maintainer role."""
        assert has_elevated_privileges(MAINTAINER_ROLE_ID) is True

    def test_has_elevated_privileges_with_member_role(self):
        """Test has_elevated_privileges returns False for member roles."""
        assert has_elevated_privileges(3) is False
        assert has_elevated_privileges(4) is False


class TestRoleConstantsIntegration:
    """Integration tests for role constants usage patterns."""

    def test_in_operator_with_role_ids_set(self):
        """Test using 'in' operator with role ID sets."""
        # Common pattern: checking if user is admin or maintainer
        user_role_id = 1
        assert user_role_id in ADMIN_OR_MAINTAINER_ROLE_IDS

        user_role_id = 2
        assert user_role_id in ADMIN_OR_MAINTAINER_ROLE_IDS

        user_role_id = 3
        assert user_role_id not in ADMIN_OR_MAINTAINER_ROLE_IDS

    def test_not_in_operator_with_role_ids_set(self):
        """Test using 'not in' operator with role ID sets."""
        # Common pattern: checking if user is NOT admin or maintainer
        user_role_id = 3
        assert user_role_id not in ADMIN_OR_MAINTAINER_ROLE_IDS

        user_role_id = 1
        assert not (user_role_id not in ADMIN_OR_MAINTAINER_ROLE_IDS)

    def test_role_hierarchy_ordering(self):
        """Test that role IDs maintain proper hierarchy ordering."""
        # Admin should have lower ID than maintainer (more permissions = lower ID)
        assert ADMIN_ROLE_ID < MAINTAINER_ROLE_ID

    def test_constants_match_helper_functions(self):
        """Test that constants and helper functions are consistent."""
        # is_admin should match ADMIN_ROLE_ID
        assert is_admin(ADMIN_ROLE_ID) is True
        for role_id in range(2, 10):
            assert is_admin(role_id) is False

        # is_admin_or_maintainer should match ADMIN_OR_MAINTAINER_ROLE_IDS
        for role_id in ADMIN_OR_MAINTAINER_ROLE_IDS:
            assert is_admin_or_maintainer(role_id) is True

        for role_id in range(3, 10):
            assert is_admin_or_maintainer(role_id) is False
