"""
Tests for the `extra_metadata` JSONB field on the User model.

Covers:
- provision_user (admin service) persists extra_metadata on new users.
- provision_user does NOT overwrite extra_metadata when attaching an
  existing user (documents current behavior).
- update_user (user service) persists extra_metadata - verifies the field
  is not part of `_PROTECTED_FIELDS`.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User, UserUpdate
from src.services.admin.admin import provision_user
from src.services.users.users import update_user


# Fixtures


@pytest.fixture
def token_user(org, admin_user):
    """API token bound to the test org, created by admin_user."""
    return APITokenUser(
        id=1,
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org.id,
        token_name="Test Token",
        created_by_user_id=admin_user.id,
    )


@pytest.fixture
def mock_admin_side_effects():
    """Bypass webhooks, analytics, usage limits, and rate limiting."""
    patches = [
        patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock),
        patch("src.services.admin.admin.track", new_callable=AsyncMock),
        patch("src.services.admin.admin.check_limits_with_usage", return_value=True),
        patch("src.services.admin.admin.increase_feature_usage", return_value=True),
        patch(
            "src.services.security.rate_limiting.check_admin_user_provision_rate_limit",
            return_value=(True, 0),
        ),
    ]
    started = [p.start() for p in patches]
    yield started
    for p in patches:
        p.stop()


# Tests


class TestProvisionUserExtraMetadata:

    @pytest.mark.asyncio
    async def test_provision_user_persists_extra_metadata(
        self,
        token_user,
        user_role,
        mock_request,
        db,
        mock_admin_side_effects,
    ):
        metadata = {"external_id": "abc-123", "team": "ops"}

        result = await provision_user(
            token_user=token_user,
            email="meta@example.com",
            username="metauser",
            first_name="Meta",
            last_name="User",
            password=None,
            role_id=user_role.id,
            request=mock_request,
            db_session=db,
            extra_metadata=metadata,
        )

        # Sanity-check the response carries it too.
        assert result.extra_metadata == metadata

        # Reload from DB to confirm persistence.
        row = (await db.execute(select(User).where(User.id == result.id))).scalars().first()
        assert row is not None
        assert row.extra_metadata == {"external_id": "abc-123", "team": "ops"}

        # Membership row was created.
        membership = (await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == result.id,
                UserOrganization.org_id == token_user.org_id,
            )
        )).scalars().first()
        assert membership is not None

    @pytest.mark.asyncio
    async def test_provision_user_attach_existing_user_does_not_overwrite_metadata(
        self,
        token_user,
        other_org,
        user_role,
        mock_request,
        db,
        mock_admin_side_effects,
    ):
        # Pre-create a user who lives only in another org so the attach path
        # is taken (not the duplicate-in-this-org rejection).
        existing = User(
            id=42,
            username="existing",
            first_name="Ex",
            last_name="Isting",
            email="existing@example.com",
            password="hashed",
            user_uuid="user_existing",
            extra_metadata={"keep": True},
        )
        db.add(existing)
        await db.commit()
        db.add(
            UserOrganization(
                user_id=existing.id,
                org_id=other_org.id,
                role_id=user_role.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        # Call provision_user with a *different* extra_metadata payload.
        result = await provision_user(
            token_user=token_user,
            email="existing@example.com",
            username="ignored",
            first_name="ignored",
            last_name="ignored",
            password=None,
            role_id=user_role.id,
            request=mock_request,
            db_session=db,
            extra_metadata={"new": "value"},
        )

        # documents current behavior: attach path leaves existing metadata intact.
        await db.refresh(existing)
        assert existing.extra_metadata == {"keep": True}
        assert result.id == existing.id
        assert result.extra_metadata == {"keep": True}

    @pytest.mark.asyncio
    async def test_update_user_persists_extra_metadata(
        self,
        regular_user,
        mock_request,
        db,
    ):
        # regular_user is a PublicUser; update_user looks up the DB row by id.
        update_payload = UserUpdate(
            username="regular",
            first_name="Regular",
            last_name="User",
            email="regular@test.com",
            extra_metadata={"locale": "en-GB", "tier": "gold"},
        )

        with patch(
            "src.services.users.users.rbac_check",
            new_callable=AsyncMock,
        ):
            result = await update_user(
                request=mock_request,
                db_session=db,
                user_id=regular_user.id,
                current_user=regular_user,
                user_object=update_payload,
            )

        # Response carries the new metadata.
        assert result.extra_metadata == {"locale": "en-GB", "tier": "gold"}

        # Persisted in the DB - proves extra_metadata is NOT in _PROTECTED_FIELDS.
        row = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        assert row is not None
        assert row.extra_metadata == {"locale": "en-GB", "tier": "gold"}
