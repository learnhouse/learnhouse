"""Tests for src/services/api_tokens/api_tokens.py."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.api_tokens import APIToken, APITokenCreate, APITokenUpdate
from src.db.roles import Rights
from src.services.api_tokens.api_tokens import (
    generate_api_token,
    get_api_token,
    hash_token,
    list_api_tokens,
    regenerate_api_token,
    revoke_api_token,
    update_api_token,
    validate_api_token_for_auth,
    validate_rights_structure,
    verify_token,
    create_api_token,
)


def _token_rights(*, grant_create: bool = False) -> dict:
    """Build a token-rights payload that satisfies the API-token validator."""
    courses = {
        "action_create": grant_create,
        "action_read": False,
        "action_read_own": False,
        "action_update": False,
        "action_update_own": False,
        "action_delete": False,
        "action_delete_own": False,
    }
    empty = {"action_create": False, "action_read": False, "action_update": False, "action_delete": False}
    return {
        "courses": courses,
        "activities": dict(empty),
        "coursechapters": dict(empty),
        "collections": dict(empty),
        "certifications": dict(empty),
        "usergroups": dict(empty),
        "payments": dict(empty),
        "search": dict(empty),
    }


def _make_token(db, org, **overrides):
    token = APIToken(
        id=overrides.pop("id", None),
        token_uuid=overrides.pop("token_uuid", "apitoken_test"),
        name=overrides.pop("name", "Test Token"),
        description=overrides.pop("description", "desc"),
        token_prefix=overrides.pop("token_prefix", "lh_test"),
        token_hash=overrides.pop("token_hash", "token_hash"),
        org_id=overrides.pop("org_id", org.id),
        created_by_user_id=overrides.pop("created_by_user_id", 1),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
        last_used_at=overrides.pop("last_used_at", None),
        expires_at=overrides.pop("expires_at", None),
        is_active=overrides.pop("is_active", True),
        rights=overrides.pop("rights", None),
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token


class TestTokenHelpersAndValidation:
    def test_generate_hash_and_verify_token(self):
        with patch("src.services.api_tokens.api_tokens.secrets.token_urlsafe", return_value="abc123"):
            full_token, prefix, token_hash = generate_api_token()

        assert full_token == "lh_abc123"
        assert prefix == "lh_abc123"
        assert token_hash == hash_token(full_token)
        assert verify_token(full_token, token_hash) is True
        assert verify_token("lh_other", token_hash) is False

    @pytest.mark.asyncio
    async def test_validate_rights_structure_paths(self):
        valid_rights = _token_rights()
        escalated_rights = _token_rights(grant_create=True)
        user_rights = _token_rights(grant_create=False)

        await validate_rights_structure(None, None)
        await validate_rights_structure(valid_rights, None)

        with pytest.raises(HTTPException) as missing_exc:
            await validate_rights_structure(
                {key: value for key, value in valid_rights.items() if key != "search"},
                None,
            )

        with pytest.raises(HTTPException) as type_exc:
            await validate_rights_structure(
                {
                    **valid_rights,
                    "search": [],
                },
                None,
            )

        with pytest.raises(HTTPException) as escalated_exc:
            await validate_rights_structure(escalated_rights, user_rights)

        assert missing_exc.value.status_code == 400
        assert "Missing required right: search" in missing_exc.value.detail
        assert type_exc.value.status_code == 400
        assert "must be a JSON object" in type_exc.value.detail
        assert escalated_exc.value.status_code == 403


class TestApiTokenLifecycle:
    @pytest.mark.asyncio
    async def test_create_list_get_update_revoke_and_regenerate(self, mock_request, db, org, admin_user, admin_role):
        user_rights = dict(admin_role.rights)
        rights_payload = _token_rights()

        with patch(
            "src.services.api_tokens.api_tokens.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.api_tokens.api_tokens.require_org_role_permission"
        ), patch(
            "src.services.api_tokens.api_tokens.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.api_tokens.api_tokens.generate_api_token",
            side_effect=[
                ("lh_created_one", "lh_created_o", "hash_created_one"),
                ("lh_created_two", "lh_created_t", "hash_created_two"),
                ("lh_regenerated", "lh_regenera", "hash_regenerated"),
            ],
        ), patch(
            "src.services.api_tokens.api_tokens.validate_rights_structure",
            new_callable=AsyncMock,
        ):
            created = await create_api_token(
                mock_request,
                db,
                APITokenCreate(
                    name="  Primary Token  ",
                    description="primary",
                    rights=rights_payload,
                    expires_at="2025-12-31T23:59:59Z",
                ),
                org.id,
                admin_user,
            )

            second = await create_api_token(
                mock_request,
                db,
                APITokenCreate(
                    name="Second Token",
                    description="secondary",
                    rights=rights_payload,
                ),
                org.id,
                admin_user,
            )

            manual_token = _make_token(
                db,
                org,
                token_uuid="apitoken_manual",
                name="Manual Token",
                token_prefix="lh_manual",
                token_hash="hash_manual",
                creation_date=str(datetime.now() + timedelta(minutes=1)),
                update_date=str(datetime.now() + timedelta(minutes=1)),
            )

            listed = await list_api_tokens(mock_request, db, org.id, admin_user)
            fetched = await get_api_token(mock_request, db, org.id, created.token_uuid, admin_user)
            updated = await update_api_token(
                mock_request,
                db,
                org.id,
                created.token_uuid,
                APITokenUpdate(
                    name="Updated Token",
                    description="updated",
                    rights=Rights(**user_rights),
                ),
                admin_user,
            )
            revoked = await revoke_api_token(
                mock_request,
                db,
                org.id,
                created.token_uuid,
                admin_user,
            )
            regenerated = await regenerate_api_token(
                mock_request,
                db,
                org.id,
                manual_token.token_uuid,
                admin_user,
            )

            with pytest.raises(HTTPException) as revoked_exc:
                await regenerate_api_token(
                    mock_request,
                    db,
                    org.id,
                    created.token_uuid,
                    admin_user,
                )

        assert created.token == "lh_created_one"
        assert created.name == "Primary Token"
        assert second.token == "lh_created_two"
        assert listed[0].token_uuid == manual_token.token_uuid
        assert {listed[1].token_uuid, listed[2].token_uuid} == {
            created.token_uuid,
            second.token_uuid,
        }
        assert fetched.token_uuid == created.token_uuid
        assert updated.name == "Updated Token"
        assert updated.rights["courses"]["action_create"] is True
        assert revoked == {"message": "API token revoked successfully"}
        assert regenerated.token == "lh_regenerated"
        assert revoked_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_create_validation_and_not_found_paths(self, mock_request, db, org, admin_user, admin_role):
        _make_token(
            db,
            org,
            name="Existing Token",
            token_uuid="apitoken_existing",
            token_prefix="lh_exist",
            token_hash="hash_existing",
        )

        with patch(
            "src.services.api_tokens.api_tokens.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.api_tokens.api_tokens.require_org_role_permission"
        ):
            with pytest.raises(HTTPException) as empty_exc:
                await create_api_token(
                    mock_request,
                    db,
                    APITokenCreate(name="   "),
                    org.id,
                    admin_user,
                )

            with pytest.raises(HTTPException) as long_exc:
                await create_api_token(
                    mock_request,
                    db,
                    APITokenCreate(name="x" * 101),
                    org.id,
                    admin_user,
                )

            with pytest.raises(HTTPException) as duplicate_exc:
                await create_api_token(
                    mock_request,
                    db,
                    APITokenCreate(name="Existing Token"),
                    org.id,
                    admin_user,
                )

            with pytest.raises(HTTPException) as missing_org_exc:
                await create_api_token(
                    mock_request,
                    db,
                    APITokenCreate(name="Missing Org"),
                    999,
                    admin_user,
                )

            with pytest.raises(HTTPException) as list_missing_org_exc:
                await list_api_tokens(mock_request, db, 999, admin_user)

            with pytest.raises(HTTPException) as get_missing_exc:
                await get_api_token(
                    mock_request,
                    db,
                    org.id,
                    "apitoken_missing",
                    admin_user,
                )

            with pytest.raises(HTTPException) as update_missing_exc:
                await update_api_token(
                    mock_request,
                    db,
                    org.id,
                    "apitoken_missing",
                    APITokenUpdate(name="Update"),
                    admin_user,
                )

            with pytest.raises(HTTPException) as revoke_missing_exc:
                await revoke_api_token(
                    mock_request,
                    db,
                    org.id,
                    "apitoken_missing",
                    admin_user,
                )

        assert empty_exc.value.status_code == 400
        assert long_exc.value.status_code == 400
        assert duplicate_exc.value.status_code == 409
        assert missing_org_exc.value.status_code == 404
        assert list_missing_org_exc.value.status_code == 404
        assert get_missing_exc.value.status_code == 404
        assert update_missing_exc.value.status_code == 404
        assert revoke_missing_exc.value.status_code == 404


class TestValidateApiTokenForAuth:
    @pytest.mark.asyncio
    async def test_validate_api_token_for_auth_success_and_edge_paths(self, db, org):
        valid_token = "lh_valid_token"
        valid_hash = hash_token(valid_token)
        valid = _make_token(
            db,
            org,
            token_uuid="apitoken_valid",
            token_hash=valid_hash,
            token_prefix="lh_valid",
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        )
        _inactive = _make_token(
            db,
            org,
            token_uuid="apitoken_inactive",
            token_hash=hash_token("lh_inactive"),
            token_prefix="lh_inactive",
            is_active=False,
        )
        _expired = _make_token(
            db,
            org,
            token_uuid="apitoken_expired",
            token_hash=hash_token("lh_expired"),
            token_prefix="lh_expired",
            expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        )
        malformed = _make_token(
            db,
            org,
            token_uuid="apitoken_malformed",
            token_hash=hash_token("lh_malformed"),
            token_prefix="lh_malformed",
            expires_at="not-a-date",
        )

        assert await validate_api_token_for_auth("bad_prefix", db) is None
        assert await validate_api_token_for_auth("lh_missing", db) is None
        assert await validate_api_token_for_auth("lh_inactive", db) is None
        assert await validate_api_token_for_auth("lh_expired", db) is None

        with patch.object(db, "commit", side_effect=Exception("commit failed")):
            malformed_result = await validate_api_token_for_auth("lh_malformed", db)

        valid_result = await validate_api_token_for_auth(valid_token, db)

        assert malformed_result is malformed
        assert valid_result is valid
        assert valid_result.last_used_at is not None
