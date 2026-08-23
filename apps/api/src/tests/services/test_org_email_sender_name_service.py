"""Per-organization email sender display name (services + router wrapper).

Only the display NAME is per-org. The From address stays the platform's
verified system address, so these tests never assert anything about an
org-supplied address — there is none.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.routers.orgs.orgs import api_update_org_email_sender_name_config
from src.services.email.sender import MAX_SENDER_NAME_LENGTH
from src.services.orgs.orgs import (
    resolve_org_sender_name,
    update_org_email_sender_name_config,
)


async def _make_org_config(db, org, config):
    row = OrganizationConfig(
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


class TestUpdateOrgEmailSenderNameConfig:
    @pytest.mark.asyncio
    async def test_updates_v2_customization_general(
        self, mock_request, db, other_org, admin_user
    ):
        await _make_org_config(
            db,
            other_org,
            {
                "config_version": "2.0",
                "plan": "free",
                "customization": {"general": {"color": "#000"}},
            },
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ):
            result = await update_org_email_sender_name_config(
                mock_request, "Acme Academy", other_org.id, admin_user, db
            )

        assert result == {"detail": "Email sender name updated"}

        stmt = select(OrganizationConfig).where(
            OrganizationConfig.org_id == other_org.id
        )
        stored = (await db.execute(stmt)).scalars().first()
        assert (
            stored.config["customization"]["general"]["email_sender_name"]
            == "Acme Academy"
        )
        # Pre-existing customization keys are preserved.
        assert stored.config["customization"]["general"]["color"] == "#000"

    @pytest.mark.asyncio
    async def test_updates_v1_general_branch(self, mock_request, db, org, admin_user):
        await _make_org_config(
            db,
            org,
            {
                "config_version": "1.4",
                "general": {"enabled": True, "color": ""},
                "features": {},
                "cloud": {"plan": "free"},
            },
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await update_org_email_sender_name_config(
                mock_request, "Acme Academy", org.id, admin_user, db
            )

        stmt = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        stored = (await db.execute(stmt)).scalars().first()
        assert stored.config["general"]["email_sender_name"] == "Acme Academy"

    @pytest.mark.asyncio
    async def test_stores_the_sanitized_value_not_the_raw_one(
        self, mock_request, db, other_org, admin_user
    ):
        """What is stored is what will be sent, so it is cleaned on write too —
        never trusting that the read side is the only guard."""
        await _make_org_config(
            db,
            other_org,
            {"config_version": "2.0", "customization": {"general": {}}},
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await update_org_email_sender_name_config(
                mock_request,
                "  Acme\r\nBcc: attacker@example.com  ",
                other_org.id,
                admin_user,
                db,
            )

        stmt = select(OrganizationConfig).where(
            OrganizationConfig.org_id == other_org.id
        )
        stored = (await db.execute(stmt)).scalars().first()
        saved = stored.config["customization"]["general"]["email_sender_name"]
        assert "\r" not in saved and "\n" not in saved
        assert saved == "AcmeBcc: attacker@example.com"

    @pytest.mark.asyncio
    async def test_rejects_a_name_that_sanitizes_to_empty(
        self, mock_request, db, org, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await update_org_email_sender_name_config(
                mock_request, "\r\n\x00", org.id, admin_user, db
            )
        assert exc.value.status_code == 400
        assert "no usable characters" in exc.value.detail

    @pytest.mark.asyncio
    async def test_rejects_an_over_length_name(
        self, mock_request, db, org, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await update_org_email_sender_name_config(
                mock_request,
                "a" * (MAX_SENDER_NAME_LENGTH + 1),
                org.id,
                admin_user,
                db,
            )
        assert exc.value.status_code == 400
        assert str(MAX_SENDER_NAME_LENGTH) in exc.value.detail

    @pytest.mark.asyncio
    async def test_empty_value_clears_the_override(
        self, mock_request, db, other_org, admin_user
    ):
        await _make_org_config(
            db,
            other_org,
            {
                "config_version": "2.0",
                "customization": {"general": {"email_sender_name": "Acme Academy"}},
            },
        )

        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await update_org_email_sender_name_config(
                mock_request, "", other_org.id, admin_user, db
            )

        stmt = select(OrganizationConfig).where(
            OrganizationConfig.org_id == other_org.id
        )
        stored = (await db.execute(stmt)).scalars().first()
        assert stored.config["customization"]["general"]["email_sender_name"] == ""

    @pytest.mark.asyncio
    async def test_raises_404_when_org_missing(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc:
            await update_org_email_sender_name_config(
                mock_request, "Acme", 99999, admin_user, db
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_raises_404_when_config_missing(
        self, mock_request, db, org, admin_user
    ):
        with patch(
            "src.services.orgs.orgs.rbac_check",
            new_callable=AsyncMock,
            return_value=True,
        ):
            with pytest.raises(HTTPException) as exc:
                await update_org_email_sender_name_config(
                    mock_request, "Acme", org.id, admin_user, db
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization config not found"


class TestResolveOrgSenderName:
    @pytest.mark.asyncio
    async def test_returns_v2_value_when_present(self, db, org):
        row = await _make_org_config(
            db,
            org,
            {
                "config_version": "2.0",
                "customization": {"general": {"email_sender_name": "Acme Academy"}},
                "general": {"email_sender_name": "Stale v1 Name"},
            },
        )
        assert resolve_org_sender_name(row) == "Acme Academy"

    @pytest.mark.asyncio
    async def test_falls_back_to_v1_general_branch(self, db, org):
        row = await _make_org_config(
            db,
            org,
            {"config_version": "1.4", "general": {"email_sender_name": "Acme Legacy"}},
        )
        assert resolve_org_sender_name(row) == "Acme Legacy"

    @pytest.mark.asyncio
    async def test_returns_empty_when_key_absent(self, db, org):
        row = await _make_org_config(
            db, org, {"config_version": "2.0", "customization": {"general": {}}}
        )
        # "" is the signal to fall back to the platform default.
        assert resolve_org_sender_name(row) == ""

    def test_returns_empty_when_org_config_is_none(self):
        assert resolve_org_sender_name(None) == ""

    @pytest.mark.asyncio
    async def test_returns_empty_when_config_is_empty(self, db, org):
        row = await _make_org_config(db, org, {})
        assert resolve_org_sender_name(row) == ""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "config",
        [
            {"config_version": "2.0", "customization": None},
            {"config_version": "2.0", "customization": {"general": None}},
            {"config_version": "1.4", "general": None},
        ],
        ids=["customization-null", "general-null-v2", "general-null-v1"],
    )
    async def test_returns_empty_when_a_config_section_is_null(self, db, org, config):
        """A blob can carry an explicit ``null`` for a section it never
        populated. Every org-scoped email reads this resolver, so a null
        section has to mean "no name configured" rather than blowing up the
        send with an AttributeError."""
        row = await _make_org_config(db, org, config)
        assert resolve_org_sender_name(row) == ""

    @pytest.mark.asyncio
    async def test_sanitizes_a_value_written_before_validation_existed(self, db, org):
        """A row edited directly in the database, or stored by an older build,
        must not put a raw newline into a header."""
        row = await _make_org_config(
            db,
            org,
            {
                "config_version": "2.0",
                "customization": {
                    "general": {"email_sender_name": "Acme\r\nBcc: x@example.com"}
                },
            },
        )
        resolved = resolve_org_sender_name(row)
        assert "\r" not in resolved and "\n" not in resolved


class TestApiUpdateOrgEmailSenderNameRouterWrapper:
    """Cover the thin router handler that just delegates to the service."""

    @pytest.mark.asyncio
    async def test_delegates_to_service(self, mock_request, db, org, admin_user):
        with patch(
            "src.routers.orgs.orgs.update_org_email_sender_name_config",
            new_callable=AsyncMock,
            return_value={"detail": "Email sender name updated"},
        ) as mocked:
            result = await api_update_org_email_sender_name_config(
                mock_request,
                org.id,
                "Acme Academy",
                admin_user,
                db,
            )

        mocked.assert_awaited_once_with(
            mock_request, "Acme Academy", org.id, admin_user, db
        )
        assert result == {"detail": "Email sender name updated"}
