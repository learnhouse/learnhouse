"""The square logo is stored on the org config next to the favicon, on both
config shapes, and falls back to nothing (the wide logo) when unset."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.organization_config import (
    GeneralCustomization,
    OrgGeneralConfig,
    OrganizationConfig,
)
from src.services.orgs.orgconfigs_migrations import _v2_migrate_config
from src.services.orgs.orgs import update_org_favicon, update_org_square_logo


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


def _patch_uploads():
    return (
        patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock, return_value=True),
        patch(
            "src.services.orgs.orgs.upload_org_square_logo",
            new_callable=AsyncMock,
            return_value="stored-square.png",
        ),
        patch(
            "src.services.orgs.orgs.upload_org_favicon",
            new_callable=AsyncMock,
            return_value="stored-favicon.png",
        ),
    )


def test_square_logo_defaults_empty_on_both_config_shapes():
    assert GeneralCustomization().square_logo_image == ""
    assert OrgGeneralConfig().square_logo_image == ""


def test_v1_to_v2_migration_carries_square_logo():
    migrated = _v2_migrate_config(
        {"general": {"enabled": True, "square_logo_image": "square.png"}}
    )
    assert migrated["customization"]["general"]["square_logo_image"] == "square.png"

    migrated = _v2_migrate_config({"general": {"enabled": True}})
    assert migrated["customization"]["general"]["square_logo_image"] == ""


@pytest.mark.asyncio
async def test_update_square_logo_writes_v2_config(db, org, admin_user, mock_request):
    row = await _make_org_config(
        db,
        org,
        {
            "config_version": "2.0",
            "plan": "pro",
            "customization": {"general": {"favicon_image": "favicon.png"}},
        },
    )

    rbac, upload_square, _ = _patch_uploads()
    with rbac, upload_square as mocked:
        result = await update_org_square_logo(
            mock_request, SimpleNamespace(filename="square.png"), org.id, admin_user, db
        )

    assert result == {"detail": "Square logo updated"}
    mocked.assert_awaited_once()
    assert mocked.await_args.args[1] == org.org_uuid

    await db.refresh(row)
    general = row.config["customization"]["general"]
    assert general["square_logo_image"] == "stored-square.png"
    # Sibling image keys survive the write.
    assert general["favicon_image"] == "favicon.png"


@pytest.mark.asyncio
async def test_update_square_logo_writes_v1_config(db, org, admin_user, mock_request):
    row = await _make_org_config(
        db,
        org,
        {"config_version": "1.4", "general": {"enabled": True, "favicon_image": "favicon.png"}},
    )

    rbac, upload_square, _ = _patch_uploads()
    with rbac, upload_square:
        await update_org_square_logo(
            mock_request, SimpleNamespace(filename="square.png"), org.id, admin_user, db
        )

    await db.refresh(row)
    assert row.config["general"]["square_logo_image"] == "stored-square.png"
    assert row.config["general"]["favicon_image"] == "favicon.png"


@pytest.mark.asyncio
async def test_update_square_logo_creates_general_section_on_bare_v1_config(
    db, org, admin_user, mock_request
):
    row = await _make_org_config(db, org, {"config_version": "1.4"})

    rbac, upload_square, _ = _patch_uploads()
    with rbac, upload_square:
        await update_org_square_logo(
            mock_request, SimpleNamespace(filename="square.png"), org.id, admin_user, db
        )

    await db.refresh(row)
    assert row.config["general"]["square_logo_image"] == "stored-square.png"
    assert row.config["general"]["favicon_image"] == ""


@pytest.mark.asyncio
async def test_square_logo_and_favicon_do_not_overwrite_each_other(
    db, org, admin_user, mock_request
):
    row = await _make_org_config(
        db, org, {"config_version": "2.0", "plan": "pro", "customization": {}}
    )

    rbac, upload_square, upload_favicon = _patch_uploads()
    with rbac, upload_square, upload_favicon:
        await update_org_square_logo(
            mock_request, SimpleNamespace(filename="square.png"), org.id, admin_user, db
        )
        await update_org_favicon(
            mock_request, SimpleNamespace(filename="favicon.png"), org.id, admin_user, db
        )

    await db.refresh(row)
    general = row.config["customization"]["general"]
    assert general["square_logo_image"] == "stored-square.png"
    assert general["favicon_image"] == "stored-favicon.png"


@pytest.mark.asyncio
async def test_update_square_logo_missing_org_is_404(db, admin_user, mock_request):
    rbac, upload_square, _ = _patch_uploads()
    with rbac, upload_square as mocked:
        with pytest.raises(HTTPException) as exc_info:
            await update_org_square_logo(
                mock_request, SimpleNamespace(filename="square.png"), 999_999, admin_user, db
            )

    assert exc_info.value.status_code == 404
    mocked.assert_not_awaited()
