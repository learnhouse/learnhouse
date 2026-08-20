"""Coverage-focused tests for the folder-ordering code in
src/services/folders/folders.py.

Targets the newly-added ordering surface:
  - reorder_folders(...) : admin gate, org/parent scope validation, and the
    reindex-by-array-position write (service lines ~490-552).
  - _get_folders_sort_mode / _apply_folder_sort : the five sort modes read from
    organization_config general.folders.sort_mode (service lines ~38-76), as
    applied inside get_folders(...) and the subfolder query in _folder_to_read.
  - _sort_items : the same five modes applied to a folder's CONTENT items, via
    get_folder(...) and the org-library-root listing get_org_root_items(...).

The reorder admin gate (rbac_check) is exercised both for the pass path
(patched no-op) and the 403 reject path (patched to raise), mirroring how the
existing folders tests stub out RBAC side effects. The sort-mode branches run
against the real organization_config table with no patching.
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.folders.folders import (
    Folder,
    FolderOrder,
    FolderUpdateOrder,
)
from src.db.courses.courses import Course
from src.db.folders.folder_content import FolderContent
from src.db.organization_config import OrganizationConfig
from src.services.folders.folders import (
    get_folder,
    get_folders,
    get_org_root_items,
    reorder_folders,
    reorder_folder_content,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _mk_folder(
    db,
    org,
    name="F",
    public=True,
    parent_folder_id=None,
    creation_date=None,
    order=0,
):
    f = Folder(
        name=name,
        public=public,
        org_id=org.id,
        parent_folder_id=parent_folder_id,
        order=order,
        folder_uuid=f"folder_{name}_{datetime.now().timestamp()}",
        creation_date=creation_date or str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


async def _set_sort_mode(db, org, mode):
    """Write general.folders.sort_mode into organization_config for the org."""
    existing = (
        await db.execute(
            __import__("sqlmodel").select(OrganizationConfig).where(
                OrganizationConfig.org_id == org.id
            )
        )
    ).scalars().first()
    config = {"general": {"folders": {"sort_mode": mode}}}
    if existing:
        existing.config = config
        db.add(existing)
    else:
        db.add(
            OrganizationConfig(
                org_id=org.id,
                config=config,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
    await db.commit()


def _rbac_pass():
    """Patch reorder's admin gate to a no-op (simulates an admin caller)."""
    return patch(
        "src.services.orgs.orgs.rbac_check",
        new_callable=AsyncMock,
    )


def _rbac_reject():
    """Patch reorder's admin gate to raise 403 (simulates a non-admin caller)."""
    return patch(
        "src.services.orgs.orgs.rbac_check",
        new_callable=AsyncMock,
        side_effect=HTTPException(status_code=403, detail="not admin"),
    )


class TestReorderFolders:
    @pytest.mark.asyncio
    async def test_reorder_root_folders_success_and_manual_order(
        self, db, org, admin_user, mock_request
    ):
        # Three root folders created in A, B, C order.
        a = await _mk_folder(db, org, "Aaa")
        b = await _mk_folder(db, org, "Bbb")
        c = await _mk_folder(db, org, "Ccc")

        # Request a shuffled order: C, A, B.
        order = FolderUpdateOrder(
            folder_order_by_ids=[
                FolderOrder(folder_id=c.id),
                FolderOrder(folder_id=a.id),
                FolderOrder(folder_id=b.id),
            ]
        )

        with _rbac_pass():
            result = await reorder_folders(
                mock_request, org.id, order, admin_user, db
            )

        assert result == {"detail": "Folder order updated"}

        # Each Folder.order == its index in the request array.
        await db.refresh(a)
        await db.refresh(b)
        await db.refresh(c)
        assert c.order == 0
        assert a.order == 1
        assert b.order == 2

        # In manual mode, get_folders returns them in the persisted order.
        await _set_sort_mode(db, org, "manual")
        with patch(
            "src.services.folders.folders.check_resource_access",
            new_callable=AsyncMock,
        ):
            listed = await get_folders(mock_request, str(org.id), admin_user, db)
        assert [f.folder_uuid for f in listed] == [
            c.folder_uuid,
            a.folder_uuid,
            b.folder_uuid,
        ]

    @pytest.mark.asyncio
    async def test_reorder_rejects_folder_out_of_scope(
        self, db, org, other_org, admin_user, mock_request
    ):
        a = await _mk_folder(db, org, "Aaa")
        # A folder that belongs to a different org -> not in this scope.
        foreign = await _mk_folder(db, other_org, "Foreign")

        order = FolderUpdateOrder(
            folder_order_by_ids=[
                FolderOrder(folder_id=a.id),
                FolderOrder(folder_id=foreign.id),
            ]
        )

        with _rbac_pass():
            with pytest.raises(HTTPException) as exc:
                await reorder_folders(mock_request, org.id, order, admin_user, db)

        assert exc.value.status_code == 400
        assert "not in this organization/parent scope" in exc.value.detail

    @pytest.mark.asyncio
    async def test_reorder_admin_gate_rejects_non_admin(
        self, db, org, regular_user, mock_request
    ):
        a = await _mk_folder(db, org, "Aaa")
        order = FolderUpdateOrder(
            folder_order_by_ids=[FolderOrder(folder_id=a.id)]
        )

        with _rbac_reject():
            with pytest.raises(HTTPException) as exc:
                await reorder_folders(mock_request, org.id, order, regular_user, db)

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_reorder_org_not_found(self, db, org, admin_user, mock_request):
        order = FolderUpdateOrder(folder_order_by_ids=[])
        with _rbac_pass():
            with pytest.raises(HTTPException) as exc:
                await reorder_folders(mock_request, 999999, order, admin_user, db)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_reorder_parent_not_found(self, db, org, admin_user, mock_request):
        order = FolderUpdateOrder(folder_order_by_ids=[])
        with _rbac_pass():
            with pytest.raises(HTTPException) as exc:
                await reorder_folders(
                    mock_request,
                    org.id,
                    order,
                    admin_user,
                    db,
                    parent_folder_uuid="folder_missing",
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Parent folder not found"

    @pytest.mark.asyncio
    async def test_reorder_scoped_to_parent_only(
        self, db, org, admin_user, mock_request
    ):
        parent = await _mk_folder(db, org, "Parent")
        # Two children under parent.
        child1 = await _mk_folder(db, org, "Child1", parent_folder_id=parent.id)
        child2 = await _mk_folder(db, org, "Child2", parent_folder_id=parent.id)
        # A root folder in the same org that must NOT be touched.
        root_other = await _mk_folder(db, org, "RootOther", order=7)

        # Reorder parent's children as [child2, child1].
        order = FolderUpdateOrder(
            folder_order_by_ids=[
                FolderOrder(folder_id=child2.id),
                FolderOrder(folder_id=child1.id),
            ]
        )
        with _rbac_pass():
            await reorder_folders(
                mock_request,
                org.id,
                order,
                admin_user,
                db,
                parent_folder_uuid=parent.folder_uuid,
            )

        await db.refresh(child1)
        await db.refresh(child2)
        await db.refresh(root_other)
        assert child2.order == 0
        assert child1.order == 1
        # Root sibling outside the scope is untouched.
        assert root_other.order == 7

        # A root folder cannot be reordered inside a parent scope -> 400.
        bad = FolderUpdateOrder(
            folder_order_by_ids=[FolderOrder(folder_id=root_other.id)]
        )
        with _rbac_pass():
            with pytest.raises(HTTPException) as exc:
                await reorder_folders(
                    mock_request,
                    org.id,
                    bad,
                    admin_user,
                    db,
                    parent_folder_uuid=parent.folder_uuid,
                )
        assert exc.value.status_code == 400


class TestGetFoldersSortModes:
    """Seed folders with distinct names + creation dates and assert each org
    sort_mode yields the expected order out of get_folders(...)."""

    async def _seed(self, db, org):
        base = datetime(2020, 1, 1, 12, 0, 0)
        # Names deliberately NOT in creation order so name vs date sorts differ.
        # Creation order (oldest->newest): Zeta, Alpha, Mango
        zeta = await _mk_folder(
            db, org, "Zeta", creation_date=str(base), order=2
        )
        alpha = await _mk_folder(
            db, org, "Alpha", creation_date=str(base + timedelta(days=1)), order=0
        )
        mango = await _mk_folder(
            db, org, "Mango", creation_date=str(base + timedelta(days=2)), order=1
        )
        return zeta, alpha, mango

    async def _list_names(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.folders.folders.check_resource_access",
            new_callable=AsyncMock,
        ):
            listed = await get_folders(mock_request, str(org.id), admin_user, db)
        return [f.name for f in listed]

    @pytest.mark.asyncio
    async def test_sort_name_asc(self, db, org, admin_user, mock_request):
        await self._seed(db, org)
        await _set_sort_mode(db, org, "name_asc")
        names = await self._list_names(db, org, admin_user, mock_request)
        assert names == ["Alpha", "Mango", "Zeta"]

    @pytest.mark.asyncio
    async def test_sort_name_desc(self, db, org, admin_user, mock_request):
        await self._seed(db, org)
        await _set_sort_mode(db, org, "name_desc")
        names = await self._list_names(db, org, admin_user, mock_request)
        assert names == ["Zeta", "Mango", "Alpha"]

    @pytest.mark.asyncio
    async def test_sort_newest(self, db, org, admin_user, mock_request):
        await self._seed(db, org)
        await _set_sort_mode(db, org, "newest")
        names = await self._list_names(db, org, admin_user, mock_request)
        # newest creation first: Mango, Alpha, Zeta
        assert names == ["Mango", "Alpha", "Zeta"]

    @pytest.mark.asyncio
    async def test_sort_oldest(self, db, org, admin_user, mock_request):
        await self._seed(db, org)
        await _set_sort_mode(db, org, "oldest")
        names = await self._list_names(db, org, admin_user, mock_request)
        # oldest creation first: Zeta, Alpha, Mango
        assert names == ["Zeta", "Alpha", "Mango"]

    @pytest.mark.asyncio
    async def test_sort_manual_uses_order_column(
        self, db, org, admin_user, mock_request
    ):
        await self._seed(db, org)  # order values: Zeta=2, Alpha=0, Mango=1
        await _set_sort_mode(db, org, "manual")
        names = await self._list_names(db, org, admin_user, mock_request)
        # ordered by Folder.order asc: Alpha(0), Mango(1), Zeta(2)
        assert names == ["Alpha", "Mango", "Zeta"]

    @pytest.mark.asyncio
    async def test_no_config_defaults_to_name_asc(
        self, db, org, admin_user, mock_request
    ):
        await self._seed(db, org)
        # No organization_config row at all -> default name_asc.
        names = await self._list_names(db, org, admin_user, mock_request)
        assert names == ["Alpha", "Mango", "Zeta"]

    @pytest.mark.asyncio
    async def test_invalid_mode_falls_back_to_name_asc(
        self, db, org, admin_user, mock_request
    ):
        await self._seed(db, org)
        await _set_sort_mode(db, org, "bogus_mode")
        names = await self._list_names(db, org, admin_user, mock_request)
        assert names == ["Alpha", "Mango", "Zeta"]


# ---------------------------------------------------------------------------
# reorder_folder_content — manual (admin drag) ordering of a folder's items
# ---------------------------------------------------------------------------


async def _mk_content(db, org, folder, resource_uuid, position=0):
    """Link a resource into a folder — pass folder=None for the library root."""
    row = FolderContent(
        folder_id=folder.id if folder is not None else None,
        resource_uuid=resource_uuid,
        org_id=org.id,
        position=position,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


class TestReorderFolderContent:
    @pytest.mark.asyncio
    async def test_reorder_content_success(self, db, org, admin_user, mock_request):
        folder = await _mk_folder(db, org, "Docs")
        a = await _mk_content(db, org, folder, "course_a", 0)
        b = await _mk_content(db, org, folder, "course_b", 1)
        c = await _mk_content(db, org, folder, "media_c", 2)

        with _rbac_pass():
            result = await reorder_folder_content(
                mock_request, folder.folder_uuid,
                ["media_c", "course_a", "course_b"], admin_user, db,
            )

        assert result == {"detail": "Folder content order updated"}
        for row in (a, b, c):
            await db.refresh(row)
        assert c.position == 0
        assert a.position == 1
        assert b.position == 2

    @pytest.mark.asyncio
    async def test_reorder_content_rejects_foreign_resource(
        self, db, org, admin_user, mock_request
    ):
        folder = await _mk_folder(db, org, "Docs")
        await _mk_content(db, org, folder, "course_a", 0)
        with _rbac_pass():
            with pytest.raises(HTTPException) as exc:
                await reorder_folder_content(
                    mock_request, folder.folder_uuid,
                    ["course_a", "course_not_here"], admin_user, db,
                )
        assert exc.value.status_code == 400
        assert "not in this folder" in exc.value.detail

    @pytest.mark.asyncio
    async def test_reorder_content_admin_gate_rejects_non_admin(
        self, db, org, regular_user, mock_request
    ):
        folder = await _mk_folder(db, org, "Docs")
        await _mk_content(db, org, folder, "course_a", 0)
        with _rbac_reject():
            with pytest.raises(HTTPException) as exc:
                await reorder_folder_content(
                    mock_request, folder.folder_uuid, ["course_a"], regular_user, db,
                )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_reorder_content_folder_not_found(
        self, db, org, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc:
            await reorder_folder_content(
                mock_request, "folder_missing", [], admin_user, db,
            )
        assert exc.value.status_code == 404


class TestSortModeFeaturesFallback:
    @pytest.mark.asyncio
    async def test_sort_mode_read_from_features_when_general_absent(
        self, db, org, admin_user, mock_request
    ):
        """When general.folders.sort_mode is absent, the mode falls back to
        features.folders.sort_mode (covers the fallback branch)."""
        a = await _mk_folder(db, org, "Aaa")
        z = await _mk_folder(db, org, "Zzz")
        # No general.* key — only the features.* fallback location is set.
        db.add(
            OrganizationConfig(
                org_id=org.id,
                config={"features": {"folders": {"sort_mode": "name_desc"}}},
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()
        with patch(
            "src.services.folders.folders.check_resource_access",
            new_callable=AsyncMock,
        ):
            listed = await get_folders(mock_request, str(org.id), admin_user, db)
        names = [f.name for f in listed if f.name in ("Aaa", "Zzz")]
        assert names == ["Zzz", "Aaa"]
        assert a.name == "Aaa" and z.name == "Zzz"


class TestReorderFolderContentOrgMissing:
    @pytest.mark.asyncio
    async def test_reorder_content_org_not_found(
        self, db, org, admin_user, mock_request
    ):
        """A folder whose org no longer resolves -> 404 (covers the org guard in
        reorder_folder_content, reached before the admin check)."""
        orphan = Folder(
            name="Orphan",
            public=True,
            org_id=999999,  # no such organization
            parent_folder_id=None,
            order=0,
            folder_uuid=f"folder_orphan_{datetime.now().timestamp()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(orphan)
        await db.commit()
        await db.refresh(orphan)
        with pytest.raises(HTTPException) as exc:
            await reorder_folder_content(
                mock_request, orphan.folder_uuid, [], admin_user, db,
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"


class TestFolderRouterDelegation:
    """Directly exercise the route bodies so their delegation lines are covered
    without a full HTTP client. The underlying services are unit-tested above."""

    @pytest.mark.asyncio
    async def test_api_reorder_folders_delegates(self, mock_request, admin_user):
        from src.routers.folders import folders as folders_router
        order = FolderUpdateOrder(folder_order_by_ids=[])
        with patch.object(
            folders_router, "reorder_folders",
            new_callable=AsyncMock, return_value={"detail": "Folder order updated"},
        ) as svc:
            result = await folders_router.api_reorder_folders(
                mock_request, 1, order, None, admin_user, "db",
            )
        assert result == {"detail": "Folder order updated"}
        svc.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_api_reorder_folder_content_delegates(self, mock_request, admin_user):
        from src.routers.folders import folders as folders_router
        from src.db.folders.folders import FolderContentUpdateOrder
        order = FolderContentUpdateOrder(resource_uuids=["course_a", "media_b"])
        with patch.object(
            folders_router, "reorder_folder_content",
            new_callable=AsyncMock, return_value={"detail": "Folder content order updated"},
        ) as svc:
            result = await folders_router.api_reorder_folder_content(
                mock_request, "folder_x", order, admin_user, "db",
            )
        assert result == {"detail": "Folder content order updated"}
        svc.assert_awaited_once()
        # Delegation passes the unwrapped resource_uuids list.
        assert svc.await_args.args[2] == ["course_a", "media_b"]


# ---------------------------------------------------------------------------
# Folder CONTENT ordering — items follow the org sort_mode, not just position
# ---------------------------------------------------------------------------


async def _mk_course(db, org, name, creation_date=None, public=True, update_date=None):
    c = Course(
        name=name,
        description="",
        public=public,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=f"course_{name.replace(' ', '_')}",
        creation_date=creation_date or str(datetime.now()),
        update_date=update_date or str(datetime.now()),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


class TestFolderContentSortModes:
    """A folder's items (courses/media) must come back in the same order the
    org's sort_mode gives its folders — the dashboard and the public library
    both render the API order, so this is the single source of truth."""

    async def _seed(self, db, org):
        """Names, creation dates and drag positions deliberately disagree so
        every mode yields a distinct order."""
        base = datetime(2020, 1, 1, 12, 0, 0)
        folder = await _mk_folder(db, org, "Content")
        # Creation order (oldest -> newest): Zeta, Alpha, Mango
        await _mk_course(db, org, "Zeta", creation_date=str(base))
        await _mk_course(db, org, "Alpha", creation_date=str(base + timedelta(days=1)))
        await _mk_course(db, org, "Mango", creation_date=str(base + timedelta(days=2)))
        # Drag order: Mango, Zeta, Alpha
        await _mk_content(db, org, folder, "course_Mango", 0)
        await _mk_content(db, org, folder, "course_Zeta", 1)
        await _mk_content(db, org, folder, "course_Alpha", 2)
        return folder

    async def _item_names(self, db, folder, admin_user, mock_request):
        with patch(
            "src.services.folders.folders.check_resource_access",
            new_callable=AsyncMock,
        ):
            read = await get_folder(mock_request, folder.folder_uuid, admin_user, db)
        return [i.resource["name"] for i in read.items]

    @pytest.mark.asyncio
    async def test_items_sorted_name_asc(self, db, org, admin_user, mock_request):
        folder = await self._seed(db, org)
        await _set_sort_mode(db, org, "name_asc")
        names = await self._item_names(db, folder, admin_user, mock_request)
        assert names == ["Alpha", "Mango", "Zeta"]

    @pytest.mark.asyncio
    async def test_items_sorted_name_desc(self, db, org, admin_user, mock_request):
        folder = await self._seed(db, org)
        await _set_sort_mode(db, org, "name_desc")
        names = await self._item_names(db, folder, admin_user, mock_request)
        assert names == ["Zeta", "Mango", "Alpha"]

    @pytest.mark.asyncio
    async def test_items_sorted_newest(self, db, org, admin_user, mock_request):
        folder = await self._seed(db, org)
        await _set_sort_mode(db, org, "newest")
        names = await self._item_names(db, folder, admin_user, mock_request)
        assert names == ["Mango", "Alpha", "Zeta"]

    @pytest.mark.asyncio
    async def test_items_sorted_oldest(self, db, org, admin_user, mock_request):
        folder = await self._seed(db, org)
        await _set_sort_mode(db, org, "oldest")
        names = await self._item_names(db, folder, admin_user, mock_request)
        assert names == ["Zeta", "Alpha", "Mango"]

    @pytest.mark.asyncio
    async def test_items_manual_keeps_drag_positions(
        self, db, org, admin_user, mock_request
    ):
        folder = await self._seed(db, org)
        await _set_sort_mode(db, org, "manual")
        names = await self._item_names(db, folder, admin_user, mock_request)
        # FolderContent.position order: Mango(0), Zeta(1), Alpha(2)
        assert names == ["Mango", "Zeta", "Alpha"]

    @pytest.mark.asyncio
    async def test_items_default_to_name_asc_without_config(
        self, db, org, admin_user, mock_request
    ):
        """The regression this guards: with no config row and every position
        still 0, items came back in arbitrary DB row order."""
        folder = await _mk_folder(db, org, "Content")
        await _mk_course(db, org, "Zeta")
        await _mk_course(db, org, "Alpha")
        await _mk_course(db, org, "Mango")
        for uuid in ("course_Zeta", "course_Alpha", "course_Mango"):
            await _mk_content(db, org, folder, uuid, 0)
        names = await self._item_names(db, folder, admin_user, mock_request)
        assert names == ["Alpha", "Mango", "Zeta"]

    @pytest.mark.asyncio
    async def test_date_modes_use_creation_date_not_update_date(
        self, db, org, admin_user, mock_request
    ):
        """'newest'/'oldest' mean CREATION date on both sides of the wire.

        Every course row carries a non-empty update_date and editing a course
        bumps only that field, so seeding the two in opposite orders is the
        normal case — if the service ever preferred update_date it would order
        every edited library differently than the client comparator
        (apps/web/lib/library/sort.ts::_dateOf) re-renders it.
        """
        base = datetime(2020, 1, 1, 12, 0, 0)
        folder = await _mk_folder(db, org, "Content")
        # Creation order (oldest -> newest): Zeta, Alpha, Mango
        # Update order is the exact reverse: Mango, Alpha, Zeta
        await _mk_course(
            db, org, "Zeta",
            creation_date=str(base),
            update_date=str(base + timedelta(days=30)),
        )
        await _mk_course(
            db, org, "Alpha",
            creation_date=str(base + timedelta(days=1)),
            update_date=str(base + timedelta(days=20)),
        )
        await _mk_course(
            db, org, "Mango",
            creation_date=str(base + timedelta(days=2)),
            update_date=str(base + timedelta(days=10)),
        )
        for uuid in ("course_Mango", "course_Zeta", "course_Alpha"):
            await _mk_content(db, org, folder, uuid, 0)

        await _set_sort_mode(db, org, "newest")
        assert await self._item_names(db, folder, admin_user, mock_request) == [
            "Mango", "Alpha", "Zeta",
        ]

        await _set_sort_mode(db, org, "oldest")
        assert await self._item_names(db, folder, admin_user, mock_request) == [
            "Zeta", "Alpha", "Mango",
        ]

    @pytest.mark.asyncio
    async def test_date_ties_break_by_name_like_the_client(
        self, db, org, admin_user, mock_request
    ):
        """Same creation date -> name decides, matching the client's
        `_dateOf(b) - _dateOf(a) || byName(a, b)`."""
        same = str(datetime(2020, 1, 1, 12, 0, 0))
        folder = await _mk_folder(db, org, "Content")
        await _mk_course(db, org, "Zeta", creation_date=same)
        await _mk_course(db, org, "Alpha", creation_date=same)
        # Drag order puts Zeta first, so a position tiebreak would keep it there.
        await _mk_content(db, org, folder, "course_Zeta", 0)
        await _mk_content(db, org, folder, "course_Alpha", 1)

        await _set_sort_mode(db, org, "newest")
        assert await self._item_names(db, folder, admin_user, mock_request) == [
            "Alpha", "Zeta",
        ]

    @pytest.mark.asyncio
    async def test_position_breaks_ties_between_equal_names(
        self, db, org, admin_user, mock_request
    ):
        """Same display name -> the admin's drag order still decides."""
        folder = await _mk_folder(db, org, "Content")
        for uuid in ("course_same_1", "course_same_2"):
            db.add(
                Course(
                    name="Same",
                    description="",
                    public=True,
                    published=True,
                    open_to_contributors=False,
                    org_id=org.id,
                    course_uuid=uuid,
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                )
            )
        await db.commit()
        await _mk_content(db, org, folder, "course_same_2", 0)
        await _mk_content(db, org, folder, "course_same_1", 1)
        await _set_sort_mode(db, org, "name_asc")
        with patch(
            "src.services.folders.folders.check_resource_access",
            new_callable=AsyncMock,
        ):
            read = await get_folder(mock_request, folder.folder_uuid, admin_user, db)
        assert [i.resource_uuid for i in read.items] == [
            "course_same_2",
            "course_same_1",
        ]


class TestOrgRootItemsSortModes:
    """The library-root listing had no sort-mode lookup at all — it must order
    its items by the same mode as everything else."""

    async def _seed_root(self, db, org):
        base = datetime(2020, 1, 1, 12, 0, 0)
        await _mk_course(db, org, "Zeta", creation_date=str(base))
        await _mk_course(db, org, "Alpha", creation_date=str(base + timedelta(days=1)))
        await _mk_course(db, org, "Mango", creation_date=str(base + timedelta(days=2)))
        # Drag order at the root: Mango, Zeta, Alpha
        await _mk_content(db, org, None, "course_Mango", 0)
        await _mk_content(db, org, None, "course_Zeta", 1)
        await _mk_content(db, org, None, "course_Alpha", 2)

    async def _root_names(self, db, org, admin_user, mock_request):
        items = await get_org_root_items(mock_request, str(org.id), admin_user, db)
        return [i.resource["name"] for i in items]

    @pytest.mark.asyncio
    async def test_root_items_sorted_name_asc(self, db, org, admin_user, mock_request):
        await self._seed_root(db, org)
        await _set_sort_mode(db, org, "name_asc")
        names = await self._root_names(db, org, admin_user, mock_request)
        assert names == ["Alpha", "Mango", "Zeta"]

    @pytest.mark.asyncio
    async def test_root_items_sorted_newest(self, db, org, admin_user, mock_request):
        await self._seed_root(db, org)
        await _set_sort_mode(db, org, "newest")
        names = await self._root_names(db, org, admin_user, mock_request)
        assert names == ["Mango", "Alpha", "Zeta"]

    @pytest.mark.asyncio
    async def test_root_items_manual_keeps_drag_positions(
        self, db, org, admin_user, mock_request
    ):
        await self._seed_root(db, org)
        await _set_sort_mode(db, org, "manual")
        names = await self._root_names(db, org, admin_user, mock_request)
        assert names == ["Mango", "Zeta", "Alpha"]
