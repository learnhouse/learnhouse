"""
App-session primitives: scope→rights mapping, mint-time rights intersection,
and the HMAC-signed asset prefix.
"""

import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.security.rbac.constants import ADMIN_ROLE_ID, MAINTAINER_ROLE_ID
from src.services.apps.manifest import (
    APP_SCOPE_BUCKETS,
    scopes_to_rights,
    validate_scopes,
)
from src.services.apps.sessions import (
    intersect_rights,
    make_asset_signature,
    verify_asset_signature,
)


class TestScopesToRights:
    def test_read_scope_grants_only_read(self):
        rights = scopes_to_rights(["courses:read"])
        assert rights["courses"] == {
            "action_create": False,
            "action_read": True,
            "action_update": False,
            "action_delete": False,
        }

    def test_write_scope_does_not_imply_read(self):
        rights = scopes_to_rights(["media:write"])
        assert rights["media"]["action_create"] is True
        assert rights["media"]["action_update"] is True
        assert rights["media"]["action_delete"] is True
        assert rights["media"]["action_read"] is False

    def test_all_buckets_present_and_default_false(self):
        rights = scopes_to_rights([])
        assert set(rights.keys()) == set(APP_SCOPE_BUCKETS)
        assert all(not any(actions.values()) for actions in rights.values())

    @pytest.mark.parametrize("scope", ["users:read", "roles:write", "courses:admin", "courses"])
    def test_invalid_scopes_rejected(self, scope):
        with pytest.raises(HTTPException):
            validate_scopes([scope])


class TestIntersectRights:
    def test_intersection_caps_by_user_rights(self):
        app_rights = scopes_to_rights(["courses:read", "courses:write", "media:read"])
        user_role = SimpleNamespace(
            id=99,
            rights={
                "courses": {"action_read": True, "action_create": False,
                            "action_update": False, "action_delete": False},
                # No media bucket at all.
            },
        )
        effective = intersect_rights(app_rights, user_role)
        assert effective["courses"]["action_read"] is True
        assert effective["courses"]["action_create"] is False
        assert effective["courses"]["action_update"] is False
        assert effective["media"]["action_read"] is False

    @pytest.mark.parametrize("role_id", [ADMIN_ROLE_ID, MAINTAINER_ROLE_ID])
    def test_admin_or_maintainer_without_rights_dict_gets_approved_scopes(self, role_id):
        app_rights = scopes_to_rights(["courses:read"])
        user_role = SimpleNamespace(id=role_id, rights=None)
        assert intersect_rights(app_rights, user_role) == app_rights

    def test_custom_role_without_rights_dict_gets_nothing(self):
        app_rights = scopes_to_rights(["courses:read"])
        user_role = SimpleNamespace(id=42, rights=None)
        effective = intersect_rights(app_rights, user_role)
        assert effective["courses"]["action_read"] is False

    def test_no_role_gets_nothing(self):
        app_rights = scopes_to_rights(["courses:read"])
        effective = intersect_rights(app_rights, None)
        assert effective["courses"]["action_read"] is False


class TestAssetSignature:
    def test_roundtrip(self):
        exp = int(time.time()) + 3600
        sig = make_asset_signature("orgapp_x", "1.0.0", exp)
        assert verify_asset_signature("orgapp_x", "1.0.0", sig)

    def test_tampered_signature_rejected(self):
        exp = int(time.time()) + 3600
        sig = make_asset_signature("orgapp_x", "1.0.0", exp)
        tampered = sig[:-2] + ("AA" if not sig.endswith("AA") else "BB")
        assert not verify_asset_signature("orgapp_x", "1.0.0", tampered)

    def test_wrong_app_or_version_rejected(self):
        exp = int(time.time()) + 3600
        sig = make_asset_signature("orgapp_x", "1.0.0", exp)
        assert not verify_asset_signature("orgapp_y", "1.0.0", sig)
        assert not verify_asset_signature("orgapp_x", "1.0.1", sig)

    def test_expired_signature_rejected(self):
        exp = int(time.time()) - 10
        sig = make_asset_signature("orgapp_x", "1.0.0", exp)
        assert not verify_asset_signature("orgapp_x", "1.0.0", sig)

    def test_extended_expiry_invalidates_mac(self):
        # An attacker cannot extend the TTL by editing the exp part: the MAC
        # binds it.
        exp = int(time.time()) + 60
        sig = make_asset_signature("orgapp_x", "1.0.0", exp)
        mac = sig.split(".", 1)[1]
        forged = f"{exp + 999999}.{mac}"
        assert not verify_asset_signature("orgapp_x", "1.0.0", forged)

    def test_garbage_rejected(self):
        assert not verify_asset_signature("orgapp_x", "1.0.0", "garbage")
        assert not verify_asset_signature("orgapp_x", "1.0.0", "")
