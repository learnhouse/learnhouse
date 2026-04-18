"""
Tests for src/services/courses/locks.py

Covers all three public functions:
- is_org_admin
- batch_accessible_restricted_uuids
- is_locked_for_user

Missing coverage lines targeted:
  44     - batch_accessible_restricted_uuids: UGRs query returns empty → return set()
  55-64  - membership lookup logic (user in group / not in group)
  87-109 - is_locked_for_user complex logic paths
"""

from datetime import datetime

from src.db.usergroups import UserGroup
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.services.courses.locks import (
    batch_accessible_restricted_uuids,
    is_locked_for_user,
    is_org_admin,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_usergroup(db, org, *, id, name="Test Group", usergroup_uuid=None):
    ug = UserGroup(
        id=id,
        name=name,
        description="A test usergroup",
        org_id=org.id,
        usergroup_uuid=usergroup_uuid or f"ug_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ug)
    db.commit()
    db.refresh(ug)
    return ug


def _make_ugr(db, org, *, usergroup_id, resource_uuid):
    ugr = UserGroupResource(
        usergroup_id=usergroup_id,
        resource_uuid=resource_uuid,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ugr)
    db.commit()
    db.refresh(ugr)
    return ugr


def _make_ugu(db, org, *, usergroup_id, user_id):
    ugu = UserGroupUser(
        usergroup_id=usergroup_id,
        user_id=user_id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ugu)
    db.commit()
    db.refresh(ugu)
    return ugu


# ---------------------------------------------------------------------------
# Tests: is_org_admin
# ---------------------------------------------------------------------------

class TestIsOrgAdmin:
    def test_admin_user_returns_true(self, db, org, admin_user):
        # admin_user has role_id=1, which is in ADMIN_OR_MAINTAINER_ROLE_IDS
        assert is_org_admin(admin_user.id, org.id, db) is True

    def test_regular_user_returns_false(self, db, org, regular_user):
        # regular_user has role_id=4, not an admin/maintainer
        assert is_org_admin(regular_user.id, org.id, db) is False

    def test_user_not_in_org_returns_false(self, db, org):
        # User ID 999 has no UserOrganization row for this org
        assert is_org_admin(999, org.id, db) is False

    def test_maintainer_role_returns_true(self, db, org):
        # role_id=2 is MAINTAINER_ROLE_ID — create a user+UO with that role
        from src.db.users import User
        from src.db.user_organizations import UserOrganization

        u = User(
            id=10,
            username="maintainer",
            first_name="Maint",
            last_name="User",
            email="maint@test.com",
            password="hashed_password",
            user_uuid="user_maint",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(u)
        db.commit()

        uo = UserOrganization(
            user_id=u.id,
            org_id=org.id,
            role_id=2,  # MAINTAINER_ROLE_ID
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(uo)
        db.commit()

        assert is_org_admin(u.id, org.id, db) is True


# ---------------------------------------------------------------------------
# Tests: batch_accessible_restricted_uuids
# ---------------------------------------------------------------------------

class TestBatchAccessibleRestrictedUuids:
    def test_empty_input_returns_empty_set(self, db, regular_user):
        result = batch_accessible_restricted_uuids(regular_user.id, [], db)
        assert result == set()

    def test_all_empty_string_uuids_returns_empty_set(self, db, regular_user):
        # All uuids filtered out by the `if u` guard
        result = batch_accessible_restricted_uuids(regular_user.id, ["", "", ""], db)
        assert result == set()

    def test_resource_with_no_ugrs_returns_empty_set(self, db, org, regular_user):
        # Line 44: UGRs query comes back empty for a uuid that has no UGR rows
        result = batch_accessible_restricted_uuids(
            regular_user.id, ["chapter_no_group"], db
        )
        assert result == set()

    def test_user_in_group_returns_uuid(self, db, org, regular_user):
        # Lines 55-64: user is a member of the group assigned to the resource
        ug = _make_usergroup(db, org, id=1)
        _make_ugr(db, org, usergroup_id=ug.id, resource_uuid="chapter_locked")
        _make_ugu(db, org, usergroup_id=ug.id, user_id=regular_user.id)

        result = batch_accessible_restricted_uuids(
            regular_user.id, ["chapter_locked"], db
        )
        assert result == {"chapter_locked"}

    def test_user_not_in_group_returns_empty(self, db, org, regular_user, admin_user):
        # Lines 55-64: UGR exists but user is NOT a member of the group
        ug = _make_usergroup(db, org, id=2, name="Exclusive Group")
        _make_ugr(db, org, usergroup_id=ug.id, resource_uuid="chapter_exclusive")
        # admin_user is added to the group, regular_user is not
        _make_ugu(db, org, usergroup_id=ug.id, user_id=admin_user.id)

        result = batch_accessible_restricted_uuids(
            regular_user.id, ["chapter_exclusive"], db
        )
        assert result == set()

    def test_multiple_uuids_partial_access(self, db, org, regular_user):
        # User has access to one resource but not the other
        ug = _make_usergroup(db, org, id=3, name="Partial Group")
        _make_ugr(db, org, usergroup_id=ug.id, resource_uuid="chapter_a")
        # chapter_b has no UGR at all
        _make_ugu(db, org, usergroup_id=ug.id, user_id=regular_user.id)

        result = batch_accessible_restricted_uuids(
            regular_user.id, ["chapter_a", "chapter_b"], db
        )
        assert result == {"chapter_a"}

    def test_user_in_one_of_two_groups_for_resource(self, db, org, regular_user):
        # Resource assigned to two groups; user is in only one
        ug1 = _make_usergroup(db, org, id=4, name="Group Alpha")
        ug2 = _make_usergroup(db, org, id=5, name="Group Beta")
        _make_ugr(db, org, usergroup_id=ug1.id, resource_uuid="chapter_multi")
        _make_ugr(db, org, usergroup_id=ug2.id, resource_uuid="chapter_multi")
        _make_ugu(db, org, usergroup_id=ug2.id, user_id=regular_user.id)

        result = batch_accessible_restricted_uuids(
            regular_user.id, ["chapter_multi"], db
        )
        assert result == {"chapter_multi"}


# ---------------------------------------------------------------------------
# Tests: is_locked_for_user
# ---------------------------------------------------------------------------

class TestIsLockedForUser:

    # --- public lock ---

    def test_public_lock_not_locked_for_anyone(self, db, org, anonymous_user):
        assert is_locked_for_user("public", "res_uuid", org.id, anonymous_user, db) is False

    def test_public_lock_not_locked_for_logged_in(self, db, org, regular_user):
        assert is_locked_for_user("public", "res_uuid", org.id, regular_user, db) is False

    def test_none_lock_treated_as_public(self, db, org, anonymous_user):
        # None is normalised to "public"
        assert is_locked_for_user(None, "res_uuid", org.id, anonymous_user, db) is False

    def test_empty_string_lock_treated_as_public(self, db, org, regular_user):
        assert is_locked_for_user("", "res_uuid", org.id, regular_user, db) is False

    # --- authenticated lock ---

    def test_authenticated_lock_not_locked_for_logged_in_user(self, db, org, regular_user):
        # Line 88-89: PublicUser → not anonymous → not locked
        assert is_locked_for_user("authenticated", "res_uuid", org.id, regular_user, db) is False

    def test_authenticated_lock_locked_for_anonymous(self, db, org, anonymous_user):
        # Line 88-89: AnonymousUser → is_anon True → locked
        assert is_locked_for_user("authenticated", "res_uuid", org.id, anonymous_user, db) is True

    # --- unknown lock type ---

    def test_unknown_lock_type_fails_safe_returns_false(self, db, org, regular_user):
        # Line 91-94: unknown lock value fails safe (treat as public, not locked)
        assert is_locked_for_user("premium", "res_uuid", org.id, regular_user, db) is False

    def test_unknown_lock_type_anonymous_also_fails_safe(self, db, org, anonymous_user):
        assert is_locked_for_user("vip_only", "res_uuid", org.id, anonymous_user, db) is False

    # --- restricted lock: anonymous ---

    def test_restricted_lock_always_locked_for_anonymous(self, db, org, anonymous_user):
        # Line 96-97: anonymous user is always locked out of restricted content
        assert is_locked_for_user("restricted", "res_uuid", org.id, anonymous_user, db) is True

    # --- restricted lock: admin bypass ---

    def test_restricted_lock_not_locked_for_admin(self, db, org, admin_user):
        # Lines 99-101: admin bypasses the restricted check entirely
        assert is_locked_for_user("restricted", "any_uuid", org.id, admin_user, db) is False

    def test_restricted_lock_precomputed_is_admin_true_bypasses(self, db, org, regular_user):
        # Lines 99-101: caller pre-computed is_admin=True — skips DB lookup
        result = is_locked_for_user(
            "restricted", "any_uuid", org.id, regular_user, db, is_admin=True
        )
        assert result is False

    def test_restricted_lock_precomputed_is_admin_false_falls_through(self, db, org, regular_user):
        # is_admin=False passed explicitly — skips DB lookup, goes on to check groups
        # No UGR rows exist, so user has no access → locked
        result = is_locked_for_user(
            "restricted", "no_group_uuid", org.id, regular_user, db, is_admin=False
        )
        assert result is True

    # --- restricted lock: precomputed accessible set ---

    def test_restricted_precomputed_set_uuid_present_not_locked(self, db, org, regular_user):
        # Lines 103-104: uuid is in the precomputed accessible set → not locked
        result = is_locked_for_user(
            "restricted",
            "chapter_x",
            org.id,
            regular_user,
            db,
            accessible_restricted_uuids={"chapter_x", "chapter_y"},
        )
        assert result is False

    def test_restricted_precomputed_set_uuid_absent_locked(self, db, org, regular_user):
        # Lines 103-104: uuid is NOT in the precomputed accessible set → locked
        result = is_locked_for_user(
            "restricted",
            "chapter_z",
            org.id,
            regular_user,
            db,
            accessible_restricted_uuids={"chapter_x", "chapter_y"},
        )
        assert result is True

    def test_restricted_empty_precomputed_set_locked(self, db, org, regular_user):
        # Precomputed set is explicitly provided but empty → locked
        result = is_locked_for_user(
            "restricted",
            "chapter_z",
            org.id,
            regular_user,
            db,
            accessible_restricted_uuids=set(),
        )
        assert result is True

    # --- restricted lock: no precomputed set — queries DB (lines 106-109) ---

    def test_restricted_no_precomputed_user_in_group_not_locked(self, db, org, regular_user):
        # Lines 106-109: no precomputed set; user IS in a group that has this resource
        ug = _make_usergroup(db, org, id=10, name="Live Group")
        _make_ugr(db, org, usergroup_id=ug.id, resource_uuid="chapter_live")
        _make_ugu(db, org, usergroup_id=ug.id, user_id=regular_user.id)

        result = is_locked_for_user(
            "restricted", "chapter_live", org.id, regular_user, db
        )
        assert result is False

    def test_restricted_no_precomputed_user_not_in_group_locked(self, db, org, regular_user):
        # Lines 106-109: no precomputed set; user is NOT in a group that has this resource
        ug = _make_usergroup(db, org, id=11, name="Private Group")
        _make_ugr(db, org, usergroup_id=ug.id, resource_uuid="chapter_private")
        # user is not added to the group

        result = is_locked_for_user(
            "restricted", "chapter_private", org.id, regular_user, db
        )
        assert result is True

    def test_restricted_no_precomputed_no_ugr_at_all_locked(self, db, org, regular_user):
        # Lines 106-109: resource has no UGR row at all → nobody can access → locked
        result = is_locked_for_user(
            "restricted", "chapter_orphan", org.id, regular_user, db
        )
        assert result is True

    # --- case-insensitivity ---

    def test_lock_type_is_case_insensitive(self, db, org, anonymous_user):
        # lock_type is lowercased before comparison
        assert is_locked_for_user("PUBLIC", "res_uuid", org.id, anonymous_user, db) is False
        assert is_locked_for_user("Authenticated", "res_uuid", org.id, anonymous_user, db) is True
        assert is_locked_for_user("RESTRICTED", "res_uuid", org.id, anonymous_user, db) is True
