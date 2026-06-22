"""Tests for src/services/folders/folders.py."""

from unittest.mock import AsyncMock, patch

import pytest

from src.db.folders.folders import FolderCreate
from src.services.folders.folders import (
    add_folder_content,
    create_folder,
    delete_folder,
    get_folder,
    remove_folder_content,
)


def _bypass():
    """Patch RBAC + webhook side effects for the folders service."""
    return (
        patch(
            "src.services.folders.folders.check_resource_access",
            new_callable=AsyncMock,
        ),
        patch(
            "src.services.folders.folders.dispatch_webhooks",
            new_callable=AsyncMock,
        ),
    )


class TestFoldersService:
    @pytest.mark.asyncio
    async def test_create_root_and_nested_folder(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            root = await create_folder(
                mock_request,
                FolderCreate(name="Root", org_id=org.id),
                admin_user,
                db,
            )
            nested = await create_folder(
                mock_request,
                FolderCreate(
                    name="Child", org_id=org.id, parent_folder_uuid=root.folder_uuid
                ),
                admin_user,
                db,
            )

        assert root.name == "Root"
        assert root.folder_uuid.startswith("folder_")
        assert root.parent_folder_id is None
        assert nested.parent_folder_id == root.id

    @pytest.mark.asyncio
    async def test_get_folder_returns_subfolders_and_breadcrumbs(
        self, db, org, admin_user, mock_request
    ):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            root = await create_folder(
                mock_request,
                FolderCreate(name="Root", org_id=org.id),
                admin_user,
                db,
            )
            child = await create_folder(
                mock_request,
                FolderCreate(
                    name="Child", org_id=org.id, parent_folder_uuid=root.folder_uuid
                ),
                admin_user,
                db,
            )

            fetched_root = await get_folder(
                mock_request, root.folder_uuid, admin_user, db
            )
            fetched_child = await get_folder(
                mock_request, child.folder_uuid, admin_user, db
            )

        # Root shows its child as a subfolder and itself as the only breadcrumb.
        assert [s.folder_uuid for s in fetched_root.subfolders] == [child.folder_uuid]
        assert [b.folder_uuid for b in fetched_root.breadcrumbs] == [root.folder_uuid]

        # Child breadcrumbs walk up to the root: [root, child].
        assert [b.folder_uuid for b in fetched_child.breadcrumbs] == [
            root.folder_uuid,
            child.folder_uuid,
        ]

    @pytest.mark.asyncio
    async def test_add_and_remove_folder_content(
        self, db, org, course, admin_user, mock_request
    ):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            folder = await create_folder(
                mock_request,
                FolderCreate(name="Holder", org_id=org.id),
                admin_user,
                db,
            )

            with_item = await add_folder_content(
                mock_request,
                folder.folder_uuid,
                course.course_uuid,
                admin_user,
                db,
            )

            fetched = await get_folder(mock_request, folder.folder_uuid, admin_user, db)

            after_remove = await remove_folder_content(
                mock_request,
                folder.folder_uuid,
                course.course_uuid,
                admin_user,
                db,
            )

        item_uuids = [i.resource_uuid for i in with_item.items]
        assert course.course_uuid in item_uuids
        assert course.course_uuid in [i.resource_uuid for i in fetched.items]
        assert after_remove.items == []

    @pytest.mark.asyncio
    async def test_delete_folder(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            folder = await create_folder(
                mock_request,
                FolderCreate(name="Temp", org_id=org.id),
                admin_user,
                db,
            )
            result = await delete_folder(
                mock_request, folder.folder_uuid, admin_user, db
            )

            from fastapi import HTTPException

            with pytest.raises(HTTPException) as exc_info:
                await get_folder(mock_request, folder.folder_uuid, admin_user, db)

        assert result == {"detail": "Folder deleted"}
        assert exc_info.value.status_code == 404
