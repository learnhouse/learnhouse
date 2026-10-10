"""Visibility gates of the folder library for org members.

Being a member of the org unlocks private folders and resources, but not those
restricted to a UserGroup the viewer isn't in, nor drafts. These run against the
real RBAC checker (no check_resource_access stub).
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.boards import Board
from src.db.courses.courses import Course
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.services.folders.folders import (
    get_folders,
    get_org_root_items,
    move_folder_content,
    search_library,
)


def _now():
    return str(datetime.now())


async def _restrict_to_group(db, org, resource_uuid):
    group = (await db.execute(UserGroup.__table__.select())).first()
    if group is None:
        db.add(UserGroup(id=1, name="Staff", description="", org_id=org.id, usergroup_uuid="usergroup_staff"))
        await db.commit()
    db.add(UserGroupResource(usergroup_id=1, resource_uuid=resource_uuid, org_id=org.id))
    await db.commit()


def _folder(id_, uuid, org, public=False):
    return Folder(
        id=id_, name=uuid, public=public, org_id=org.id, folder_uuid=uuid,
        creation_date=_now(), update_date=_now(),
    )


@pytest.mark.asyncio
async def test_get_folders_hides_usergroup_restricted_folders(
    db, org, admin_user, regular_user, mock_request
):
    db.add(_folder(10, "folder_open", org))
    db.add(_folder(11, "folder_staff", org))
    await db.commit()
    await _restrict_to_group(db, org, "folder_staff")

    member_view = await get_folders(mock_request, str(org.id), regular_user, db)
    admin_view = await get_folders(mock_request, str(org.id), admin_user, db)

    assert [f.folder_uuid for f in member_view] == ["folder_open"]
    assert {f.folder_uuid for f in admin_view} == {"folder_open", "folder_staff"}


@pytest.mark.asyncio
async def test_root_items_gate_boards_and_strip_ydoc(
    db, org, admin_user, regular_user, mock_request
):
    for id_, uuid in ((1, "board_open"), (2, "board_staff")):
        db.add(Board(
            id=id_, name=uuid, public=False, org_id=org.id, board_uuid=uuid,
            created_by=admin_user.id, ydoc_state=b"secret", creation_date=_now(), update_date=_now(),
        ))
        db.add(FolderContent(folder_id=None, resource_uuid=uuid, org_id=org.id, position=id_))
    await db.commit()
    await _restrict_to_group(db, org, "board_staff")

    member_items = await get_org_root_items(mock_request, str(org.id), regular_user, db)
    admin_items = await get_org_root_items(mock_request, str(org.id), admin_user, db)

    assert [i.resource_uuid for i in member_items] == ["board_open"]
    assert {i.resource_uuid for i in admin_items} == {"board_open", "board_staff"}
    assert "ydoc_state" not in member_items[0].resource


@pytest.mark.asyncio
async def test_search_library_hides_drafts_from_members(
    db, org, admin_user, regular_user, mock_request
):
    db.add(Course(
        id=5, name="Draft lesson", description="", public=False, published=False, open_to_contributors=False,
        org_id=org.id, course_uuid="course_draft", creation_date=_now(), update_date=_now(),
    ))
    db.add(FolderContent(folder_id=None, resource_uuid="course_draft", org_id=org.id, position=0))
    await db.commit()

    member = await search_library(mock_request, str(org.id), "draft", regular_user, db)
    admin = await search_library(mock_request, str(org.id), "draft", admin_user, db)

    assert member["items"] == []
    assert [i["resource_uuid"] for i in admin["items"]] == ["course_draft"]


@pytest.mark.asyncio
async def test_move_folder_content_rejects_cross_org_target(
    db, org, other_org, admin_user, mock_request
):
    db.add(_folder(20, "folder_src", org))
    db.add(_folder(21, "folder_foreign", other_org))
    db.add(FolderContent(folder_id=20, resource_uuid="course_test", org_id=org.id, position=0))
    await db.commit()

    with patch("src.services.folders.folders.check_resource_access", new_callable=AsyncMock):
        with pytest.raises(HTTPException) as exc:
            await move_folder_content(
                mock_request, "folder_src", "folder_foreign", "course_test", admin_user, db
            )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_get_folder_hides_usergroup_restricted_subfolders(
    db, org, admin_user, regular_user, mock_request
):
    from src.services.folders.folders import get_folder

    db.add(_folder(30, "folder_parent", org))
    for id_, uuid in ((31, "folder_child_open"), (32, "folder_child_staff")):
        child = _folder(id_, uuid, org)
        child.parent_folder_id = 30
        db.add(child)
    await db.commit()
    await _restrict_to_group(db, org, "folder_child_staff")

    member_view = await get_folder(mock_request, "folder_parent", regular_user, db)
    admin_view = await get_folder(mock_request, "folder_parent", admin_user, db)

    assert [f.folder_uuid for f in member_view.subfolders] == ["folder_child_open"]
    assert {f.folder_uuid for f in admin_view.subfolders} == {
        "folder_child_open", "folder_child_staff",
    }


@pytest.mark.asyncio
async def test_search_library_hides_restricted_folders_and_boards(
    db, org, admin_user, regular_user, mock_request
):
    db.add(_folder(40, "folder_secret_plans", org))
    db.add(Board(
        id=7, name="secret board", public=False, org_id=org.id, board_uuid="board_secret",
        created_by=admin_user.id, creation_date=_now(), update_date=_now(),
    ))
    db.add(FolderContent(folder_id=None, resource_uuid="board_secret", org_id=org.id, position=0))
    await db.commit()
    await _restrict_to_group(db, org, "folder_secret_plans")
    await _restrict_to_group(db, org, "board_secret")

    member = await search_library(mock_request, str(org.id), "secret", regular_user, db)
    admin = await search_library(mock_request, str(org.id), "secret", admin_user, db)

    assert member == {"folders": [], "items": []}
    assert [f["folder_uuid"] for f in admin["folders"]] == ["folder_secret_plans"]
    assert [i["resource_uuid"] for i in admin["items"]] == ["board_secret"]


@pytest.mark.asyncio
async def test_listing_treats_a_raising_access_check_as_hidden(db, admin_user, mock_request):
    # Org two-factor policies raise even with raise_on_deny=False.
    from src.services.folders.folders import _can_read

    with patch(
        "src.services.folders.folders.check_resource_access",
        new=AsyncMock(side_effect=HTTPException(status_code=403, detail="2FA required")),
    ):
        assert await _can_read(mock_request, admin_user, db, "folder_x") is False
