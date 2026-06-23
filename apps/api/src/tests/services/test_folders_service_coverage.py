"""Coverage-focused tests for src/services/folders/folders.py.

Targets specific branches: orphan/skip continues in item resolution, the
breadcrumb cycle-guard break, parent-not-found / cross-org / missing-folder
404s and 400s, anonymous public-only filtering, content move/remove edge
cases, search_library empty-query and orphan-skip paths, the folder_path
cache, and the _would_create_cycle 'seen' guard.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.folders.folders import Folder, FolderCreate, FolderUpdate
from src.db.folders.folder_content import FolderContent
from src.services.folders.folders import (
    _build_breadcrumbs,
    _would_create_cycle,
    add_folder_content,
    create_folder,
    get_folder,
    get_folders,
    move_folder_content,
    remove_folder_content,
    search_library,
    update_folder,
    upload_folder_thumbnail,
)


def _bypass():
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


async def _mk_folder(db, org, name="F", public=True, parent_folder_id=None):
    f = Folder(
        name=name,
        public=public,
        org_id=org.id,
        parent_folder_id=parent_folder_id,
        folder_uuid=f"folder_{name}_{datetime.now().timestamp()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


async def _add_content(db, org, folder_id, resource_uuid, position=0):
    c = FolderContent(
        folder_id=folder_id,
        resource_uuid=resource_uuid,
        org_id=org.id,
        position=position,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    await db.commit()
    return c


class TestFoldersServiceCoverage:
    # --- line 78: include_private skip + orphan resource not resolved ---
    @pytest.mark.asyncio
    async def test_orphan_and_private_item_skipped(self, db, org, mock_request):
        from src.db.courses.courses import Course

        # A private course (public=False) -> triggers the include_private continue (78)
        priv = Course(
            name="Private Course",
            description="",
            public=False,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_private",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(priv)
        await db.commit()

        folder = await _mk_folder(db, org, "Holder")
        # orphan: resource_uuid points to a non-existent course
        await _add_content(db, org, folder.id, "course_deadbeef")
        await _add_content(db, org, folder.id, "course_private")

        rbac, webhooks = _bypass()
        with rbac, webhooks:
            fetched = await get_folder(mock_request, folder.folder_uuid, AnonymousLike(), db)

        uuids = [i.resource_uuid for i in fetched.items]
        assert "course_deadbeef" not in uuids  # orphan filtered
        assert "course_private" not in uuids    # private skipped (line 78)

    # --- line 100: breadcrumb cycle-guard break ---
    @pytest.mark.asyncio
    async def test_build_breadcrumbs_cycle_guard_break(self, db, org):
        a = await _mk_folder(db, org, "A")
        b = await _mk_folder(db, org, "B", parent_folder_id=a.id)
        # introduce a cycle: A's parent points to B
        a.parent_folder_id = b.id
        db.add(a)
        await db.commit()
        await db.refresh(a)

        crumbs = await _build_breadcrumbs(db, a)
        # walk terminates due to 'seen' guard (break at line 100); no infinite loop
        ids = {c.folder_uuid for c in crumbs}
        assert a.folder_uuid in ids
        assert b.folder_uuid in ids

    # --- line 149: subfolder private-skip continue ---
    @pytest.mark.asyncio
    async def test_get_folders_excludes_private_subfolder_for_anonymous(
        self, db, org, mock_request
    ):
        root = await _mk_folder(db, org, "Root", public=True)
        await _mk_folder(db, org, "PubChild", public=True, parent_folder_id=root.id)
        await _mk_folder(db, org, "PrivChild", public=False, parent_folder_id=root.id)

        rbac, webhooks = _bypass()
        with rbac, webhooks:
            # anonymous fetch of root -> subfolders filtered to public only (line 149)
            result = await get_folders(
                mock_request, str(org.id), AnonymousLike(), db
            )

        root_read = next(r for r in result if r.folder_uuid == root.folder_uuid)
        sub_names = [s.name for s in root_read.subfolders]
        assert "PubChild" in sub_names
        assert "PrivChild" not in sub_names

    # --- line 210: create_folder parent not found ---
    @pytest.mark.asyncio
    async def test_create_folder_parent_not_found(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await create_folder(
                    mock_request,
                    FolderCreate(name="X", org_id=org.id, parent_folder_uuid="folder_missing"),
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Parent folder not found"

    # --- line 212: create_folder parent in another org ---
    @pytest.mark.asyncio
    async def test_create_folder_parent_other_org(
        self, db, org, other_org, admin_user, mock_request
    ):
        other_parent = await _mk_folder(db, other_org, "OtherParent")
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await create_folder(
                    mock_request,
                    FolderCreate(
                        name="X",
                        org_id=org.id,
                        parent_folder_uuid=other_parent.folder_uuid,
                    ),
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 400
        assert exc.value.detail == "Parent folder is in another organization"

    # --- line 278: update_folder missing folder ---
    @pytest.mark.asyncio
    async def test_update_folder_missing(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await update_folder(
                    mock_request,
                    FolderUpdate(name="New"),
                    "folder_missing",
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Folder does not exist"

    # --- line 336: upload_folder_thumbnail missing folder ---
    @pytest.mark.asyncio
    async def test_upload_thumbnail_missing_folder(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks, patch(
            "src.services.utils.upload_content.upload_file",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await upload_folder_thumbnail(
                    mock_request,
                    "folder_missing",
                    object(),
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    # --- line 372 (read code): get_folder missing folder -> 404 "Folder does not exist" ---
    @pytest.mark.asyncio
    async def test_get_folder_missing(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await get_folder(mock_request, "folder_missing", admin_user, db)
        assert exc.value.status_code == 404

    # --- line 419: get_folders parent not found ---
    @pytest.mark.asyncio
    async def test_get_folders_parent_not_found(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await get_folders(
                    mock_request,
                    str(org.id),
                    admin_user,
                    db,
                    parent_folder_uuid="folder_missing",
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Parent folder not found"

    # --- line 427: get_folders anonymous filters to public folders only ---
    @pytest.mark.asyncio
    async def test_get_folders_anonymous_public_only(self, db, org, mock_request):
        await _mk_folder(db, org, "PublicRoot", public=True)
        await _mk_folder(db, org, "PrivateRoot", public=False)

        rbac, webhooks = _bypass()
        with rbac, webhooks:
            result = await get_folders(mock_request, str(org.id), AnonymousLike(), db)

        names = [r.name for r in result]
        assert "PublicRoot" in names
        assert "PrivateRoot" not in names

    # --- line 454: add_folder_content missing folder ---
    @pytest.mark.asyncio
    async def test_add_folder_content_missing_folder(
        self, db, org, course, admin_user, mock_request
    ):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await add_folder_content(
                    mock_request,
                    "folder_missing",
                    course.course_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Folder not found"

    # --- line 499: remove_folder_content missing folder ---
    @pytest.mark.asyncio
    async def test_remove_folder_content_missing_folder(
        self, db, org, course, admin_user, mock_request
    ):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await remove_folder_content(
                    mock_request,
                    "folder_missing",
                    course.course_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Folder not found"

    # --- line 536: move_folder_content missing source/target ---
    @pytest.mark.asyncio
    async def test_move_folder_content_missing_folder(
        self, db, org, course, admin_user, mock_request
    ):
        source = await _mk_folder(db, org, "Src")
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await move_folder_content(
                    mock_request,
                    source.folder_uuid,
                    "folder_missing_target",
                    course.course_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Folder not found"

    # --- line 554: move_folder_content item not in source ---
    @pytest.mark.asyncio
    async def test_move_folder_content_item_not_in_source(
        self, db, org, course, admin_user, mock_request
    ):
        source = await _mk_folder(db, org, "Src")
        target = await _mk_folder(db, org, "Tgt")
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            with pytest.raises(HTTPException) as exc:
                await move_folder_content(
                    mock_request,
                    source.folder_uuid,
                    target.folder_uuid,
                    course.course_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Item not found in source folder"

    # --- line 565: move_folder_content delete-row path (dup exists in target) ---
    @pytest.mark.asyncio
    async def test_move_folder_content_dedup_delete(
        self, db, org, course, admin_user, mock_request
    ):
        source = await _mk_folder(db, org, "Src")
        target = await _mk_folder(db, org, "Tgt")
        # item exists in BOTH source and target -> moving deletes the source row (565)
        await _add_content(db, org, source.id, course.course_uuid)
        await _add_content(db, org, target.id, course.course_uuid)

        rbac, webhooks = _bypass()
        with rbac, webhooks:
            result = await move_folder_content(
                mock_request,
                source.folder_uuid,
                target.folder_uuid,
                course.course_uuid,
                admin_user,
                db,
            )

        # target still has exactly one row for the resource
        rows = (
            await db.execute(
                __import__("sqlmodel").select(FolderContent).where(
                    FolderContent.resource_uuid == course.course_uuid
                )
            )
        ).scalars().all()
        assert len(rows) == 1
        assert result.folder_uuid == target.folder_uuid

    # --- line 590: search_library empty query ---
    @pytest.mark.asyncio
    async def test_search_library_empty_query(self, db, org, admin_user, mock_request):
        rbac, webhooks = _bypass()
        with rbac, webhooks:
            result = await search_library(mock_request, str(org.id), "   ", admin_user, db)
        assert result == {"folders": [], "items": []}

    # --- lines 600,602: folder_path cache hit + None branch ---
    # --- lines 659,662,664,667: orphan/private/non-match continues ---
    @pytest.mark.asyncio
    async def test_search_library_paths_and_skips(
        self, db, org, course, admin_user, mock_request
    ):
        from src.db.courses.courses import Course

        # Nested A>B so breadcrumbs walk and path cache exercise
        a = await _mk_folder(db, org, "Alpha")
        b = await _mk_folder(db, org, "Beta", parent_folder_id=a.id)

        # Two matching courses in the SAME folder b -> second hit uses path cache (602)
        c1 = Course(
            name="Findme One",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_findme1",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        c2 = Course(
            name="Findme Two",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_findme2",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        # a non-matching course name -> query-not-in-name continue (667)
        c3 = Course(
            name="Unrelated",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_unrelated",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        # a private matching course -> anonymous skip (664) when anonymous;
        # for admin it is included. We test the 664 path separately below.
        # a root-only matcher (folder_id None) -> folder_path None branch (600)
        c4 = Course(
            name="Findme Root",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_findmeroot",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add_all([c1, c2, c3, c4])
        await db.commit()

        # content rows: two matchers in folder b (root None path also covered),
        # one orphan (662), one non-match (667), plus a duplicate resource (658)
        await _add_content(db, org, b.id, "course_findme1")
        await _add_content(db, org, b.id, "course_findme2")
        await _add_content(db, org, b.id, "course_orphan_xxx")  # orphan -> 662
        await _add_content(db, org, b.id, "course_unrelated")   # non-match -> 667
        # duplicate row for findme1 in a DIFFERENT folder -> seen continue (658->659)
        await _add_content(db, org, a.id, "course_findme1", position=5)
        # a root-level (folder_id None) matcher -> folder_path None branch (600)
        await _add_content(db, org, None, "course_findmeroot")

        rbac, webhooks = _bypass()
        with rbac, webhooks:
            result = await search_library(
                mock_request, str(org.id), "findme", admin_user, db
            )

        item_uuids = {i["resource_uuid"] for i in result["items"]}
        assert "course_findme1" in item_uuids
        assert "course_findme2" in item_uuids
        assert "course_findmeroot" in item_uuids  # root-level (path None)
        assert "course_orphan_xxx" not in item_uuids
        assert "course_unrelated" not in item_uuids
        # findme1 appears only once despite duplicate row
        assert sum(1 for i in result["items"] if i["resource_uuid"] == "course_findme1") == 1

    # --- line 617 + 664: search_library anonymous public-only + private skip ---
    @pytest.mark.asyncio
    async def test_search_library_anonymous_filters(self, db, org, mock_request):
        from src.db.courses.courses import Course

        pub = Course(
            name="SearchPub",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_searchpub",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        priv = Course(
            name="SearchPriv",
            description="",
            public=False,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_searchpriv",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add_all([pub, priv])
        await db.commit()

        pub_folder = await _mk_folder(db, org, "SearchPublic", public=True)
        await _mk_folder(db, org, "SearchPrivate", public=False)
        await _add_content(db, org, pub_folder.id, "course_searchpub")
        await _add_content(db, org, pub_folder.id, "course_searchpriv")

        rbac, webhooks = _bypass()
        with rbac, webhooks:
            result = await search_library(
                mock_request, str(org.id), "search", AnonymousLike(), db
            )

        # Folder results: anonymous filter (617) -> only public folder
        folder_names = {f["name"] for f in result["folders"]}
        assert "SearchPublic" in folder_names
        assert "SearchPrivate" not in folder_names
        # Item results: private course skipped (664)
        item_uuids = {i["resource_uuid"] for i in result["items"]}
        assert "course_searchpub" in item_uuids
        assert "course_searchpriv" not in item_uuids

    # --- line 782: _would_create_cycle returns False via 'seen' guard ---
    @pytest.mark.asyncio
    async def test_would_create_cycle_seen_guard(self, db, org):
        # Build a pre-existing cycle X<->Y that does NOT involve folder_id Z.
        x = await _mk_folder(db, org, "X")
        y = await _mk_folder(db, org, "Y", parent_folder_id=x.id)
        x.parent_folder_id = y.id
        db.add(x)
        await db.commit()
        z = await _mk_folder(db, org, "Z")

        # Walking from x's chain never reaches z.id, and the X<->Y cycle trips
        # the 'seen' guard -> returns False (line 782).
        result = await _would_create_cycle(db, z.id, x.id)
        assert result is False


class AnonymousLike:
    """A lightweight anonymous user: resolve_acting_user_id -> 0."""

    def __init__(self):
        self.id = 0
