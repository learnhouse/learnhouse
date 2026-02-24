import pytest
from pydantic import ValidationError
from src.db.roles import (
    Rights,
    Permission,
    PermissionsWithOwn,
    DashboardPermission,
)


class TestRightsModel:
    """Test cases for the Rights Pydantic model validation"""

    def get_valid_permission(self) -> Permission:
        """Helper to create a valid Permission object"""
        return Permission(
            action_create=True,
            action_read=True,
            action_update=True,
            action_delete=True,
        )

    def get_valid_permission_with_own(self) -> PermissionsWithOwn:
        """Helper to create a valid PermissionsWithOwn object"""
        return PermissionsWithOwn(
            action_create=True,
            action_read=True,
            action_read_own=True,
            action_update=True,
            action_update_own=True,
            action_delete=True,
            action_delete_own=True,
        )

    def get_valid_dashboard_permission(self) -> DashboardPermission:
        """Helper to create a valid DashboardPermission object"""
        return DashboardPermission(action_access=True)

    def get_all_required_rights_fields(self) -> dict:
        """Helper to get all required fields for Rights model"""
        return {
            "courses": self.get_valid_permission_with_own(),
            "users": self.get_valid_permission(),
            "usergroups": self.get_valid_permission(),
            "collections": self.get_valid_permission(),
            "organizations": self.get_valid_permission(),
            "coursechapters": self.get_valid_permission(),
            "activities": self.get_valid_permission(),
            "roles": self.get_valid_permission(),
            "dashboard": self.get_valid_dashboard_permission(),
            "communities": self.get_valid_permission(),
            "discussions": self.get_valid_permission_with_own(),
            "podcasts": self.get_valid_permission_with_own(),
            "docspaces": self.get_valid_permission_with_own(),
            "boards": self.get_valid_permission_with_own(),
            "playgrounds": self.get_valid_permission_with_own(),
        }

    def test_rights_model_with_all_fields(self):
        """Test that Rights model can be created with all required fields"""
        rights = Rights(**self.get_all_required_rights_fields())

        assert rights.courses is not None
        assert rights.users is not None
        assert rights.usergroups is not None
        assert rights.collections is not None
        assert rights.organizations is not None
        assert rights.coursechapters is not None
        assert rights.activities is not None
        assert rights.roles is not None
        assert rights.dashboard is not None
        assert rights.communities is not None
        assert rights.discussions is not None
        assert rights.podcasts is not None

    def test_rights_model_missing_communities(self):
        """Test that Rights model fails validation when communities is missing"""
        fields = self.get_all_required_rights_fields()
        del fields["communities"]

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("communities",)
        assert errors[0]["type"] == "missing"

    def test_rights_model_missing_discussions(self):
        """Test that Rights model fails validation when discussions is missing"""
        fields = self.get_all_required_rights_fields()
        del fields["discussions"]

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("discussions",)
        assert errors[0]["type"] == "missing"

    def test_rights_model_missing_podcasts(self):
        """Test that Rights model fails validation when podcasts is missing"""
        fields = self.get_all_required_rights_fields()
        del fields["podcasts"]

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("podcasts",)
        assert errors[0]["type"] == "missing"

    def test_rights_model_missing_multiple_fields(self):
        """Test that Rights model fails with multiple missing fields"""
        fields = self.get_all_required_rights_fields()
        del fields["communities"]
        del fields["discussions"]

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert len(errors) == 2
        error_locs = {error["loc"][0] for error in errors}
        assert "communities" in error_locs
        assert "discussions" in error_locs

    def test_rights_model_missing_courses(self):
        """Test that Rights model fails when courses is missing"""
        fields = self.get_all_required_rights_fields()
        del fields["courses"]

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("courses",)

    def test_rights_model_missing_dashboard(self):
        """Test that Rights model fails when dashboard is missing"""
        fields = self.get_all_required_rights_fields()
        del fields["dashboard"]

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert len(errors) == 1
        assert errors[0]["loc"] == ("dashboard",)

    def test_rights_model_wrong_type_for_courses(self):
        """Test that Rights model fails when courses has wrong type"""
        fields = self.get_all_required_rights_fields()
        fields["courses"] = self.get_valid_permission()  # Should be PermissionsWithOwn

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert any("courses" in str(error["loc"]) for error in errors)

    def test_rights_model_wrong_type_for_discussions(self):
        """Test that Rights model fails when discussions has wrong type"""
        fields = self.get_all_required_rights_fields()
        fields["discussions"] = self.get_valid_permission()  # Should be PermissionsWithOwn

        with pytest.raises(ValidationError) as exc_info:
            Rights(**fields)

        errors = exc_info.value.errors()
        assert any("discussions" in str(error["loc"]) for error in errors)

    def test_rights_model_getitem(self):
        """Test that Rights model supports indexing via __getitem__"""
        rights = Rights(**self.get_all_required_rights_fields())

        assert rights["courses"] == rights.courses
        assert rights["communities"] == rights.communities
        assert rights["discussions"] == rights.discussions

    def test_rights_model_dump(self):
        """Test that Rights model can be serialized to dict"""
        rights = Rights(**self.get_all_required_rights_fields())
        dumped = rights.model_dump()

        assert "courses" in dumped
        assert "communities" in dumped
        assert "discussions" in dumped
        assert "podcasts" in dumped
        assert len(dumped) == 15  # All 15 fields


class TestPermissionModels:
    """Test cases for Permission and PermissionsWithOwn models"""

    def test_permission_requires_all_fields(self):
        """Test that Permission model requires all action fields"""
        with pytest.raises(ValidationError):
            Permission(action_create=True)  # Missing other fields

    def test_permission_with_own_requires_all_fields(self):
        """Test that PermissionsWithOwn model requires all action fields"""
        with pytest.raises(ValidationError):
            PermissionsWithOwn(action_create=True, action_read=True)  # Missing other fields

    def test_dashboard_permission_requires_action_access(self):
        """Test that DashboardPermission requires action_access"""
        with pytest.raises(ValidationError):
            DashboardPermission()  # Missing action_access

    def test_permission_getitem(self):
        """Test that Permission supports indexing"""
        perm = Permission(
            action_create=True,
            action_read=False,
            action_update=True,
            action_delete=False,
        )
        assert perm["action_create"] is True
        assert perm["action_read"] is False

    def test_permissions_with_own_getitem(self):
        """Test that PermissionsWithOwn supports indexing"""
        perm = PermissionsWithOwn(
            action_create=True,
            action_read=True,
            action_read_own=True,
            action_update=False,
            action_update_own=True,
            action_delete=False,
            action_delete_own=True,
        )
        assert perm["action_read_own"] is True
        assert perm["action_update"] is False


class TestDefaultRolesValidation:
    """Test cases to validate that default roles are properly configured"""

    # List of all required fields in the Rights model
    REQUIRED_RIGHTS_FIELDS = [
        "courses",
        "users",
        "usergroups",
        "collections",
        "organizations",
        "coursechapters",
        "activities",
        "roles",
        "dashboard",
        "communities",
        "discussions",
        "podcasts",
        "docspaces",
        "boards",
        "playgrounds",
    ]

    def test_rights_model_has_expected_fields(self):
        """Ensure Rights model has all expected fields defined"""
        from src.db.roles import Rights

        model_fields = set(Rights.model_fields.keys())
        expected_fields = set(self.REQUIRED_RIGHTS_FIELDS)

        assert model_fields == expected_fields, (
            f"Rights model fields mismatch. "
            f"Missing: {expected_fields - model_fields}, "
            f"Extra: {model_fields - expected_fields}"
        )

    def test_default_admin_role_has_all_rights(self):
        """Test that admin role definition includes all required rights fields"""
        # This simulates what install_default_elements does for admin role
        admin_rights = Rights(
            courses=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
            users=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            usergroups=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            collections=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            organizations=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            coursechapters=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            activities=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            roles=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            dashboard=DashboardPermission(
                action_access=True,
            ),
            communities=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            discussions=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
            podcasts=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
        )

        # Verify all fields are present and accessible
        for field in self.REQUIRED_RIGHTS_FIELDS:
            assert hasattr(admin_rights, field), f"Missing field: {field}"
            assert admin_rights[field] is not None, f"Field {field} is None"

    def test_default_user_role_has_all_rights(self):
        """Test that user role definition includes all required rights fields"""
        # This simulates what install_default_elements does for user role
        user_rights = Rights(
            courses=PermissionsWithOwn(
                action_create=False,
                action_read=True,
                action_read_own=True,
                action_update=False,
                action_update_own=False,
                action_delete=True,
                action_delete_own=True,
            ),
            users=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            usergroups=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            collections=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            organizations=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            coursechapters=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            activities=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            roles=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            dashboard=DashboardPermission(
                action_access=False,
            ),
            communities=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            discussions=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=False,
                action_update_own=True,
                action_delete=False,
                action_delete_own=True,
            ),
            podcasts=PermissionsWithOwn(
                action_create=False,
                action_read=True,
                action_read_own=True,
                action_update=False,
                action_update_own=False,
                action_delete=False,
                action_delete_own=False,
            ),
        )

        # Verify all fields are present
        for field in self.REQUIRED_RIGHTS_FIELDS:
            assert hasattr(user_rights, field), f"Missing field: {field}"

    def test_rights_can_be_serialized_to_json(self):
        """Test that Rights can be serialized to JSON for database storage"""
        rights = Rights(
            courses=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
            users=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            usergroups=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            collections=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            organizations=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            coursechapters=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            activities=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            roles=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            dashboard=DashboardPermission(
                action_access=True,
            ),
            communities=Permission(
                action_create=True,
                action_read=True,
                action_update=True,
                action_delete=True,
            ),
            discussions=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
            podcasts=PermissionsWithOwn(
                action_create=True,
                action_read=True,
                action_read_own=True,
                action_update=True,
                action_update_own=True,
                action_delete=True,
                action_delete_own=True,
            ),
        )

        # Simulate what setup.py does
        serialized = rights.model_dump()

        assert isinstance(serialized, dict)
        assert all(field in serialized for field in self.REQUIRED_RIGHTS_FIELDS)


class TestRightsFieldConsistency:
    """Tests to ensure Rights fields stay in sync with setup.py usage"""

    def test_all_rights_fields_are_documented(self):
        """Ensure we can programmatically check all Rights fields"""
        from src.db.roles import Rights

        # Get all fields from the model
        fields = Rights.model_fields

        # These are the fields that MUST exist (update this list when adding new fields)
        required_fields = {
            "courses",
            "users",
            "usergroups",
            "collections",
            "organizations",
            "coursechapters",
            "activities",
            "roles",
            "dashboard",
            "communities",
            "discussions",
            "podcasts",
            "docspaces",
            "boards",
            "playgrounds",
        }

        actual_fields = set(fields.keys())

        # Check for missing fields
        missing = required_fields - actual_fields
        assert not missing, f"Rights model is missing required fields: {missing}"

        # Check for extra fields (might indicate setup.py needs updating)
        extra = actual_fields - required_fields
        if extra:
            pytest.fail(
                f"Rights model has new fields that may need to be added to "
                f"install_default_elements in setup.py: {extra}"
            )
