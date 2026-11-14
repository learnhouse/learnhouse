"""Where core reaches boards (an EE feature) through ``get_ee_module``.

Core never imports boards directly: the RBAC uuid lookups, folders, user
group links, offboarding and the demo ask
``src.core.ee_hooks.get_ee_module`` and carry on without boards when it
answers None (community installs; this suite pins EE off). These tests cover
both answers, the "with EE" one through stand-in models
(src/tests/core/board_standins.py); the real board models, services, routers
and tools are exercised in ee/tests/test_board*.py.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from src.core import ee_hooks
from src.tests.core.board_standins import BOARDS, StandInBoard, StandInBoardMember
from src.tests.services.test_demo_drift import (  # noqa: F401  (fixtures)
    demo_org,
    no_uploads,
    synced,
    visitor,
)

EPOCH_DAY = date(2026, 8, 9)


def _with_ee(**modules):
    """Patch get_ee_module to answer with the given stand-ins by name."""
    table = {"ee.db.boards": BOARDS, **modules}
    return patch.object(ee_hooks, "get_ee_module", side_effect=lambda name: table.get(name))


async def _board(db, org, uuid="board_1", public=False, **kw):
    board = StandInBoard(org_id=org.id, board_uuid=uuid, name=uuid, public=public, **kw)
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return board


def test_without_ee_there_are_no_boards():
    assert ee_hooks.get_ee_module("ee.db.boards") is None


# ─── RBAC ────────────────────────────────────────────────────────────────────


async def test_rbac_org_of_a_board(db, org):
    from src.security.rbac.utils import get_element_organization_id

    await _board(db, org)
    assert await get_element_organization_id("board_1", db) is None
    with _with_ee():
        assert await get_element_organization_id("board_1", db) == org.id


def test_rbac_resource_model_with_ee():
    from src.security.rbac.resource_access import _resource_model

    assert _resource_model("boards") is None
    with _with_ee():
        assert _resource_model("boards") == (StandInBoard, "board_uuid")


# ─── user groups ─────────────────────────────────────────────────────────────


async def test_usergroup_access_describes_boards_only_with_ee(db, org):
    from src.services.usergroups.access import _model, describe_resources

    await _board(db, org, uuid="board_desc")
    assert _model("board") is None
    assert await describe_resources(db, org.id, ["board_desc"]) == {}
    with _with_ee():
        assert _model("board")[0] is StandInBoard
        described = await describe_resources(db, org.id, ["board_desc"])
    assert described["board_desc"]["kind"] == "board" and described["board_desc"]["name"] == "board_desc"


async def test_linking_a_board_to_a_group_needs_ee(db, org):
    from src.services.users.usergroups import _validate_resource_exists_and_belongs_to_org

    await _board(db, org, uuid="board_link")
    with pytest.raises(HTTPException) as exc:
        await _validate_resource_exists_and_belongs_to_org("board_link", org.id, db)
    assert exc.value.status_code == 404
    with _with_ee():
        assert await _validate_resource_exists_and_belongs_to_org("board_link", org.id, db) is True


# ─── offboarding ─────────────────────────────────────────────────────────────


async def test_offboarding_drops_board_membership_with_ee(db, org, other_org, regular_user):
    from src.services.orgs.users import _revoke_org_grants

    mine = await _board(db, org, uuid="board_mine")
    theirs = await _board(db, other_org, uuid="board_theirs")
    db.add_all([
        StandInBoardMember(board_id=mine.id, user_id=regular_user.id),
        StandInBoardMember(board_id=theirs.id, user_id=regular_user.id),
    ])
    await db.commit()

    # Without EE there are no board members to drop.
    await _revoke_org_grants(db, org, [regular_user.id])
    await db.commit()
    assert len((await db.execute(select(StandInBoardMember))).scalars().all()) == 2

    with _with_ee():
        await _revoke_org_grants(db, org, [regular_user.id])
    await db.commit()
    left = (await db.execute(select(StandInBoardMember.board_id))).scalars().all()
    assert left == [theirs.id]


# ─── folders ─────────────────────────────────────────────────────────────────


def test_folder_registry_with_and_without_ee():
    from src.services.folders.folders import _resource_registry

    assert "board_" not in _resource_registry()
    with _with_ee():
        assert _resource_registry()["board_"] == ("boards", StandInBoard, "board_uuid")


async def test_board_dump_leaves_the_document_out(db, org):
    from src.services.folders.folders import _public_resource_dump

    board = await _board(db, org, uuid="board_dump", ydoc_state=b"secret")
    with _with_ee():
        dumped = _public_resource_dump(board)
    assert dumped["board_uuid"] == "board_dump" and "ydoc_state" not in dumped


async def test_folder_listing_asks_the_ee_boards_service(db, org, regular_user, mock_request):
    from src.services.folders.folders import _can_read_item

    board = await _board(db, org, uuid="board_read")
    service = SimpleNamespace(_check_board_read=AsyncMock(return_value=True))
    with _with_ee(**{"ee.services.boards.boards": service}):
        assert await _can_read_item(mock_request, regular_user, db, "boards", board, "board_read") is True
        service._check_board_read.side_effect = HTTPException(status_code=403, detail="2FA required")
        assert await _can_read_item(mock_request, regular_user, db, "boards", board, "board_read") is False
    assert service._check_board_read.await_args.kwargs == {"raise_on_deny": False}


async def test_library_root_and_search_gate_boards_through_ee(db, org, regular_user, mock_request):
    from src.db.folders.folder_content import FolderContent
    from src.services.folders.folders import get_org_root_items, search_library

    await _board(db, org, uuid="board_lib", ydoc_state=b"secret")
    db.add(FolderContent(folder_id=None, resource_uuid="board_lib", org_id=org.id, position=0))
    await db.commit()
    org_id = str(org.id)

    # Without EE a board_ uuid resolves to nothing.
    assert await get_org_root_items(mock_request, org_id, regular_user, db) == []

    hidden = SimpleNamespace(_check_board_read=AsyncMock(return_value=False))
    with _with_ee(**{"ee.services.boards.boards": hidden}):
        assert await get_org_root_items(mock_request, org_id, regular_user, db) == []
        assert (await search_library(mock_request, org_id, "board_", regular_user, db))["items"] == []

    shown = SimpleNamespace(_check_board_read=AsyncMock(return_value=True))
    with _with_ee(**{"ee.services.boards.boards": shown}):
        items = await get_org_root_items(mock_request, org_id, regular_user, db)
        found = await search_library(mock_request, org_id, "board_", regular_user, db)
    assert [i.resource_uuid for i in items] == ["board_lib"] and "ydoc_state" not in items[0].resource
    assert [i["resource_uuid"] for i in found["items"]] == ["board_lib"]


# ─── demo ────────────────────────────────────────────────────────────────────


async def test_demo_without_ee_seeds_no_boards(db, demo_org):  # noqa: F811 (imported fixtures)
    assert (await db.execute(select(func.count()).select_from(StandInBoard))).scalar_one() == 0


async def test_demo_with_ee_seeds_restores_and_sweeps_boards(db, no_uploads, monkeypatch):  # noqa: F811
    from src.db.organizations import Organization
    from src.services.demo import sync as sync_module

    monkeypatch.setattr(sync_module, "_board_models", lambda: BOARDS)
    await sync_module.sync_demo(db, today=EPOCH_DAY)
    org = (await db.execute(select(Organization).where(Organization.is_demo.is_(True)))).scalars().first()
    boards = (await db.execute(select(StandInBoard).where(StandInBoard.org_id == org.id))).scalars().all()
    assert boards, "the bundle's boards are seeded with EE"
    seeded = boards[0]
    name = seeded.name

    # A visitor's rename is reverted and their own board removed.
    seeded.name = "Renamed"
    db.add(seeded)
    db.add(StandInBoard(org_id=org.id, name="Visitor's", board_uuid="board_visitor"))
    await db.commit()
    stats = await sync_module.sync_demo(db, today=EPOCH_DAY)

    await db.refresh(seeded)
    assert seeded.name == name
    uuids = {b.board_uuid for b in (await db.execute(select(StandInBoard))).scalars().all()}
    assert "board_visitor" not in uuids
    assert stats.drift_deleted >= 1


def test_demo_board_models_come_from_ee():
    from src.services.demo import sync as sync_module

    assert sync_module._board_models() is None
    with _with_ee():
        assert sync_module._board_models() is BOARDS


@pytest.fixture(autouse=True)
def _ee_stays_off(monkeypatch):
    # Belt and braces: whatever another test did, these run as a community install.
    monkeypatch.setenv("LEARNHOUSE_DISABLE_EE", "1")
