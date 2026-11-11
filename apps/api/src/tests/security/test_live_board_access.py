"""Boards opened from a live session: people in the room get in for the
class (org members edit, guests watch), and the EE hook behind it fails
closed."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.core import ee_hooks
from src.db.boards import BoardMemberRole
from src.services.boards.boards import check_board_membership, get_board
from src.tests.security.test_hardening_round7_boards import _board, _req, _user

LIVE = "src.services.boards.boards.check_ee_live_board_access"


async def test_people_in_the_room_join_a_private_board(db, org, admin_user, regular_user):
    board = await _board(db, org, admin_user, uuid="board_live")
    outsider = await _user(db, 50)

    with patch(LIVE, new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException):
            await check_board_membership(_req(), board.board_uuid, regular_user, db)

    with patch(LIVE, new=AsyncMock(return_value=True)):
        member = await check_board_membership(_req(), board.board_uuid, regular_user, db)
        guest = await check_board_membership(_req(), board.board_uuid, outsider, db)
        # Reading the board goes through the same rule.
        assert (await get_board(_req(), board.board_uuid, outsider, db)).board_uuid == "board_live"
    assert member.role == BoardMemberRole.EDITOR
    assert guest.role == BoardMemberRole.VIEWER


async def test_the_class_does_not_unlock_a_paid_board(db, org, admin_user, regular_user):
    board = await _board(db, org, admin_user, uuid="board_paid")
    with patch(LIVE, new=AsyncMock(return_value=True)), patch(
        "src.services.boards.boards._passes_board_paywall",
        new=AsyncMock(side_effect=HTTPException(status_code=402, detail="Buy it")),
    ):
        with pytest.raises(HTTPException) as e:
            await check_board_membership(_req(), board.board_uuid, regular_user, db)
    assert e.value.status_code == 402


async def test_live_board_hook():
    with patch.object(ee_hooks, "get_ee_hooks", return_value=None):
        assert await ee_hooks.check_ee_live_board_access(1, 2, None) is False

    hooks = SimpleNamespace(has_live_board_access=AsyncMock(return_value=True))
    with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
        assert await ee_hooks.check_ee_live_board_access(1, 2, None) is True
    hooks.has_live_board_access.assert_awaited_once_with(1, 2, None)

    broken = SimpleNamespace(has_live_board_access=AsyncMock(side_effect=RuntimeError("db down")))
    with patch.object(ee_hooks, "get_ee_hooks", return_value=broken):
        assert await ee_hooks.check_ee_live_board_access(1, 2, None) is False


async def test_live_session_uuids_map_to_their_resource_type():
    from src.security.rbac.utils import check_element_type

    assert await check_element_type("livesession_abc") == "live_sessions"


def test_ee_calendar_sources_hook():
    hooks = SimpleNamespace(register_calendar_sources=lambda: None)
    with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
        ee_hooks.register_ee_calendar_sources()

    def boom():
        raise RuntimeError("bad source")

    with patch.object(ee_hooks, "get_ee_hooks", return_value=SimpleNamespace(register_calendar_sources=boom)):
        ee_hooks.register_ee_calendar_sources()  # logged, not raised
