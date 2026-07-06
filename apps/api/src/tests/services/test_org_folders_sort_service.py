"""
Tests for update_org_folders_sort_config in src/services/orgs/orgs.py

Covers the library folders sort-mode config writer: each valid mode persists to
config["general"]["folders"]["sort_mode"], an invalid mode raises 422, and a
non-admin caller is rejected by the (real) rbac gate with 403.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organizations import OrganizationConfig
from src.services.orgs.orgs import (
    FOLDERS_SORT_MODES,
    update_org_folders_sort_config,
)


async def _load_config(db, org_id):
    return (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()


async def _make_config(db, org, config):
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


class TestFoldersSortModesConstant:
    def test_expected_modes(self):
        assert FOLDERS_SORT_MODES == ("name_asc", "name_desc", "newest", "oldest", "manual")


class TestUpdateOrgFoldersSortConfig:
    @pytest.fixture(autouse=True)
    def _bypass_rbac(self):
        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock, return_value=True):
            yield

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sort_mode", list(FOLDERS_SORT_MODES))
    async def test_valid_mode_persists(self, sort_mode, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "general": {}})

        with patch("src.services.orgs.cache.invalidate_org_config_cache") as mock_invalidate:
            result = await update_org_folders_sort_config(
                mock_request, sort_mode, org.id, admin_user, db
            )

        assert result == {"detail": "Folders sort mode updated"}
        mock_invalidate.assert_called_once_with(org.id)

        row = await _load_config(db, org.id)
        assert row.config["general"]["folders"]["sort_mode"] == sort_mode

    @pytest.mark.asyncio
    async def test_invalid_mode_422(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "general": {}})

        with pytest.raises(HTTPException) as exc:
            await update_org_folders_sort_config(
                mock_request, "not_a_mode", org.id, admin_user, db
            )

        assert exc.value.status_code == 422
        assert "Invalid sort_mode" in exc.value.detail

    @pytest.mark.asyncio
    async def test_missing_org_404(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_folders_sort_config(
                mock_request, "name_asc", 999999, admin_user, db
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_config_404(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_folders_sort_config(
                mock_request, "name_asc", org.id, admin_user, db
            )
        assert exc.value.status_code == 404


class TestFoldersSortRbacGate:
    @pytest.mark.asyncio
    async def test_non_admin_rejected_403(self, db, org, regular_user, mock_request):
        # No rbac bypass here: exercise the real admin gate with a non-admin member.
        await _make_config(db, org, {"config_version": "2.0", "general": {}})

        with pytest.raises(HTTPException) as exc:
            await update_org_folders_sort_config(
                mock_request, "name_asc", org.id, regular_user, db
            )

        assert exc.value.status_code == 403


class TestFoldersSortRouterDelegation:
    @pytest.mark.asyncio
    async def test_api_update_org_folders_sort_config_delegates(
        self, mock_request, admin_user
    ):
        """Directly exercise the route body so its delegation line is covered."""
        from src.routers.orgs import orgs as orgs_router
        with patch.object(
            orgs_router, "update_org_folders_sort_config",
            new_callable=AsyncMock, return_value={"detail": "Folders sort mode updated"},
        ) as svc:
            result = await orgs_router.api_update_org_folders_sort_config(
                mock_request, 1, "name_asc", admin_user, "db",
            )
        assert result == {"detail": "Folders sort mode updated"}
        svc.assert_awaited_once()
        # Delegation reorders args to (request, sort_mode, org_id, user, db).
        assert svc.await_args.args[1] == "name_asc"
        assert svc.await_args.args[2] == 1
