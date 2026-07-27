"""Signup-path behaviour for org-defined custom fields.

The signup endpoints are public, so these tests pin the security boundary: a
caller may not write `extra_metadata` directly, and only keys the org declared
end up stored.
"""

from contextlib import ExitStack
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.users import User, UserCreate
from src.services.users.users import create_user, create_user_without_org


def _signup_patches():
    """Silence the side effects of signup (email, analytics, quota, webhooks)."""
    stack = ExitStack()
    for target, kwargs in [
        ("src.services.users.users.validate_password_complexity", {"return_value": Mock(is_valid=True)}),
        ("src.services.users.users.check_limits_with_usage", {}),
        ("src.services.users.users.increase_feature_usage", {}),
        ("src.services.users.users.track", {"new_callable": AsyncMock}),
        ("src.services.users.users.dispatch_webhooks", {"new_callable": AsyncMock}),
        ("src.services.users.users.send_account_creation_email", {}),
        ("src.services.users.email_verification.send_verification_email", {"new_callable": AsyncMock}),
        ("src.services.users.users.get_deployment_mode", {"return_value": "oss"}),
        ("src.services.users.users.authorization_verify_based_on_roles_and_authorship", {"new_callable": AsyncMock}),
    ]:
        stack.enter_context(patch(target, **kwargs))
    return stack


async def _set_signup_fields(db, org, fields, config_version="2.0"):
    """Point the org's config at the given signup field definitions.

    The `org` fixture creates no config row, so make one when it is missing.
    """
    org_config = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()
    if org_config is None:
        org_config = OrganizationConfig(
            org_id=org.id, config={"config_version": config_version}
        )

    config = dict(org_config.config or {})
    if str(config.get("config_version", "1.0")).startswith("2"):
        config.setdefault("customization", {})
        config["customization"]["signup_fields"] = {"fields": fields}
    else:
        config.setdefault("general", {"enabled": True})
        config["general"]["signup_fields"] = {"fields": fields}

    org_config.config = config
    db.add(org_config)
    await db.commit()
    await db.refresh(org_config)


async def _fetch(db, user_id):
    return (await db.execute(select(User).where(User.id == user_id))).scalars().first()


class TestSignupCustomFields:
    @pytest.mark.asyncio
    async def test_declared_fields_are_stored_on_extra_metadata(
        self, mock_request, db, admin_user, org
    ):
        await _set_signup_fields(
            db,
            org,
            [
                {"key": "company", "label": "Company", "type": "text", "required": True},
                {"key": "cohort", "label": "Cohort", "type": "select", "options": ["A", "B"]},
            ],
        )

        with _signup_patches():
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="cf_user",
                    first_name="Custom",
                    last_name="Fields",
                    email="cf_user@test.com",
                    password="Password123!",
                    custom_fields={"company": "Acme", "cohort": "B"},
                ),
                org.id,
            )

        row = await _fetch(db, created.id)
        assert row.extra_metadata == {"company": "Acme", "cohort": "B"}

    @pytest.mark.asyncio
    async def test_submitted_extra_metadata_blob_is_ignored(
        self, mock_request, db, admin_user, org
    ):
        """Regression: UserCreate inherits extra_metadata from UserBase, so a
        public signup could previously persist an arbitrary blob."""
        await _set_signup_fields(
            db, org, [{"key": "company", "label": "Company", "type": "text"}]
        )

        with _signup_patches():
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="blob_user",
                    first_name="Blob",
                    last_name="User",
                    email="blob_user@test.com",
                    password="Password123!",
                    extra_metadata={"injected": "value", "is_superadmin": True},
                    custom_fields={"company": "Acme"},
                ),
                org.id,
            )

        row = await _fetch(db, created.id)
        assert row.extra_metadata == {"company": "Acme"}
        assert row.is_superadmin is False

    @pytest.mark.asyncio
    async def test_undeclared_custom_field_keys_are_dropped(
        self, mock_request, db, admin_user, org
    ):
        await _set_signup_fields(
            db, org, [{"key": "company", "label": "Company", "type": "text"}]
        )

        with _signup_patches():
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="drop_user",
                    first_name="Drop",
                    last_name="User",
                    email="drop_user@test.com",
                    password="Password123!",
                    custom_fields={"company": "Acme", "sneaky": "nope"},
                ),
                org.id,
            )

        row = await _fetch(db, created.id)
        assert row.extra_metadata == {"company": "Acme"}

    @pytest.mark.asyncio
    async def test_missing_required_field_blocks_signup(
        self, mock_request, db, admin_user, org
    ):
        await _set_signup_fields(
            db,
            org,
            [{"key": "company", "label": "Company", "type": "text", "required": True}],
        )

        with _signup_patches():
            with pytest.raises(HTTPException) as exc:
                await create_user(
                    mock_request,
                    db,
                    admin_user,
                    UserCreate(
                        username="req_user",
                        first_name="Req",
                        last_name="User",
                        email="req_user@test.com",
                        password="Password123!",
                        custom_fields={},
                    ),
                    org.id,
                )
        assert exc.value.status_code == 400
        assert exc.value.detail["code"] == "SIGNUP_FIELD_INVALID"

    @pytest.mark.asyncio
    async def test_org_without_declared_fields_stores_nothing(
        self, mock_request, db, admin_user, org
    ):
        await _set_signup_fields(db, org, [])

        with _signup_patches():
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="plain_user",
                    first_name="Plain",
                    last_name="User",
                    email="plain_user@test.com",
                    password="Password123!",
                    custom_fields={"company": "Acme"},
                ),
                org.id,
            )

        row = await _fetch(db, created.id)
        assert row.extra_metadata is None

    @pytest.mark.asyncio
    async def test_oauth_signup_is_not_blocked_by_required_fields(
        self, mock_request, db, admin_user, org
    ):
        """Google sign-in never renders the signup form, so enforcing required
        fields there would make an org with one unable to use OAuth at all.
        Those users are asked to complete their profile after landing."""
        await _set_signup_fields(
            db,
            org,
            [{"key": "company", "label": "Company", "type": "text", "required": True}],
        )

        with _signup_patches():
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="oauth_user",
                    first_name="OAuth",
                    last_name="User",
                    email="oauth_user@test.com",
                    password="",
                ),
                org.id,
                is_oauth=True,
                signup_provider="google",
            )

        row = await _fetch(db, created.id)
        assert row is not None

        # ...and the completion step then reports exactly what is outstanding.
        from src.services.orgs.signup_fields import (
            get_org_signup_fields,
            missing_required_fields,
        )

        fields = await get_org_signup_fields(org.id, db)
        missing = missing_required_fields(fields, row.extra_metadata)
        assert [f.key for f in missing] == ["company"]

    @pytest.mark.asyncio
    async def test_completion_endpoint_stores_and_merges_answers(
        self, mock_request, db, admin_user, org
    ):
        await _set_signup_fields(
            db,
            org,
            [
                {"key": "company", "label": "Company", "type": "text", "required": True},
                {"key": "cohort", "label": "Cohort", "type": "select", "options": ["A"]},
            ],
        )

        with _signup_patches():
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="merge_user",
                    first_name="Merge",
                    last_name="User",
                    email="merge_user@test.com",
                    password="Password123!",
                    custom_fields={"company": "Acme"},
                ),
                org.id,
            )

        from src.services.orgs.signup_fields import complete_signup_fields_for_user

        merged = await complete_signup_fields_for_user(
            org.id, created.id, {"company": "Acme", "cohort": "A"}, db
        )
        assert merged == {"company": "Acme", "cohort": "A"}

        row = await _fetch(db, created.id)
        assert row.extra_metadata == {"company": "Acme", "cohort": "A"}

    @pytest.mark.asyncio
    async def test_completion_endpoint_still_validates(
        self, mock_request, db, admin_user, org
    ):
        """The completion step is not a way around signup validation."""
        await _set_signup_fields(
            db,
            org,
            [{"key": "cohort", "label": "Cohort", "type": "select", "options": ["A"]}],
        )

        with _signup_patches():
            created = await create_user(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="valid_user",
                    first_name="Valid",
                    last_name="User",
                    email="valid_user@test.com",
                    password="Password123!",
                ),
                org.id,
            )

        from src.services.orgs.signup_fields import complete_signup_fields_for_user

        with pytest.raises(HTTPException):
            await complete_signup_fields_for_user(
                org.id, created.id, {"cohort": "NOT_AN_OPTION"}, db
            )

    @pytest.mark.asyncio
    async def test_org_less_signup_never_stores_custom_fields(
        self, mock_request, db, admin_user
    ):
        """There is no org, so there are no declared fields to validate
        against — nothing may be persisted."""
        with _signup_patches():
            created = await create_user_without_org(
                mock_request,
                db,
                admin_user,
                UserCreate(
                    username="noorg_user",
                    first_name="NoOrg",
                    last_name="User",
                    email="noorg_user@test.com",
                    password="Password123!",
                    extra_metadata={"injected": "value"},
                    custom_fields={"company": "Acme"},
                ),
            )

        row = await _fetch(db, created.id)
        assert row.extra_metadata is None


class TestCompletionEdgeCases:
    @pytest.mark.asyncio
    async def test_org_without_fields_stores_nothing_on_completion(self, db, org):
        """Nothing declared means nothing to collect, so the call is a no-op
        rather than an error."""
        await _set_signup_fields(db, org, [])

        from src.services.orgs.signup_fields import complete_signup_fields_for_user

        assert await complete_signup_fields_for_user(org.id, 12345, {"a": "b"}, db) == {}

    @pytest.mark.asyncio
    async def test_completion_for_unknown_user_is_404(self, db, org):
        await _set_signup_fields(
            db, org, [{"key": "company", "label": "Company", "type": "text"}]
        )

        from src.services.orgs.signup_fields import complete_signup_fields_for_user

        with pytest.raises(HTTPException) as exc:
            await complete_signup_fields_for_user(
                org.id, 999_999, {"company": "Acme"}, db
            )
        assert exc.value.status_code == 404
