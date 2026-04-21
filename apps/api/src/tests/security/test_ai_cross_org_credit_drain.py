"""
Regression tests for F-5: cross-org credit drain in RAG and Boards Playground.

Before the fix, ``api_rag_chat`` and the Boards Playground start/iterate
handlers resolved the target org from client-supplied ``org_slug`` /
``course_uuid`` / ``board_uuid`` and then called ``reserve_ai_credit`` on
that org with no membership check. An authenticated user in org A could
drain org B's AI credit bucket and run RAG against org B's indexed content
simply by knowing an org B slug or a board/course UUID from org B.

These tests assert that each entry point now rejects the call with 403
when the authenticated user is not a member of the resolved org, while
keeping the legitimate same-org path working.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

from src.db.boards import Board


# ---------------------------------------------------------------------------
# RAG chat
# ---------------------------------------------------------------------------


def _mk_board(db, *, org_id: int, uid: int, uuid: str) -> Board:
    b = Board(
        id=uid,
        org_id=org_id,
        board_uuid=uuid,
        name="Test Board",
        description="x",
        public=False,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@pytest.mark.asyncio
async def test_rag_chat_rejects_cross_org_slug(db, org, other_org, regular_user, mock_request):
    """User in org A using another org's slug → 403, no credit touched."""
    from src.routers.ai.rag import api_rag_chat, RAGChatRequest

    chat_request = RAGChatRequest(
        message="hi",
        org_slug=other_org.slug,  # user is NOT a member of other_org
        mode="general",
    )

    reserve_spy = Mock()
    with patch("src.routers.ai.rag.reserve_ai_credit", reserve_spy):
        with pytest.raises(HTTPException) as exc_info:
            await api_rag_chat(
                request=mock_request,
                chat_request=chat_request,
                current_user=regular_user,
                db_session=db,
            )
    assert exc_info.value.status_code == 403
    reserve_spy.assert_not_called()


@pytest.mark.asyncio
async def test_rag_chat_rejects_cross_org_course_uuid(db, org, other_org, regular_user, mock_request):
    """User in org A supplying a course_uuid from org B → 403."""
    from src.db.courses.courses import Course
    from src.routers.ai.rag import api_rag_chat, RAGChatRequest

    other_course = Course(
        id=500,
        name="Other Course",
        description="x",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=other_org.id,
        course_uuid="course_other_for_rag",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(other_course)
    db.commit()
    db.refresh(other_course)

    chat_request = RAGChatRequest(
        message="hi",
        course_uuid=other_course.course_uuid,
        mode="course_only",
    )

    reserve_spy = Mock()
    with patch("src.routers.ai.rag.reserve_ai_credit", reserve_spy):
        with pytest.raises(HTTPException) as exc_info:
            await api_rag_chat(
                request=mock_request,
                chat_request=chat_request,
                current_user=regular_user,
                db_session=db,
            )
    assert exc_info.value.status_code == 403
    reserve_spy.assert_not_called()


@pytest.mark.asyncio
async def test_rag_chat_same_org_passes_membership_gate(db, org, regular_user, mock_request):
    """Legitimate same-org call passes the F-5 gate (later stages mocked)."""
    from src.routers.ai.rag import api_rag_chat, RAGChatRequest

    chat_request = RAGChatRequest(
        message="hi",
        org_slug=org.slug,
        mode="general",
    )

    # Mock the downstream side-effects so we only validate the membership gate.
    with patch("src.routers.ai.rag.reserve_ai_credit"):
        with patch("src.routers.ai.rag.query_course_rag_stream", new=AsyncMock(return_value=(iter([]), []))):
            with patch("src.routers.ai.rag.get_chat_session_history", return_value={"message_history": [], "aichat_uuid": "aichat_x"}):
                # Should not raise at the membership gate.
                response = await api_rag_chat(
                    request=mock_request,
                    chat_request=chat_request,
                    current_user=regular_user,
                    db_session=db,
                )
                assert response is not None


# ---------------------------------------------------------------------------
# Boards Playground
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_boards_playground_start_rejects_cross_org(db, org, other_org, regular_user, mock_request):
    """User in org A posting a board from org B → 403, no credit touched."""
    from src.routers.boards.boards_playground import start_boards_playground_session
    from src.services.boards.schemas.boards_playground import StartBoardsPlaygroundSession

    other_board = _mk_board(db, org_id=other_org.id, uid=501, uuid="board_other_1")

    from src.services.boards.schemas.boards_playground import BoardsPlaygroundContext
    session_request = StartBoardsPlaygroundSession(
        board_uuid=other_board.board_uuid,
        block_uuid="block_x",
        prompt="make me a game",
        context=BoardsPlaygroundContext(board_name="x", board_description="y"),
    )

    reserve_spy = Mock()
    with patch("src.routers.boards.boards_playground.reserve_ai_credit", reserve_spy):
        with pytest.raises(HTTPException) as exc_info:
            await start_boards_playground_session(
                request=mock_request,
                session_request=session_request,
                current_user=regular_user,
                db_session=db,
            )
    assert exc_info.value.status_code == 403
    reserve_spy.assert_not_called()


@pytest.mark.asyncio
async def test_boards_playground_iterate_rejects_cross_org(db, org, other_org, regular_user, mock_request):
    """Iterate endpoint must also reject cross-org board access."""
    from src.routers.boards.boards_playground import iterate_boards_playground_session
    from src.services.boards.schemas.boards_playground import SendBoardsPlaygroundMessage

    other_board = _mk_board(db, org_id=other_org.id, uid=601, uuid="board_other_iter")

    message_request = SendBoardsPlaygroundMessage(
        session_uuid="sess_x",
        board_uuid=other_board.board_uuid,
        block_uuid="block_x",
        message="tweak this",
    )

    # Pre-session lookup must succeed so we reach the org-gate. Fake the
    # session to match the uuid + iteration count semantics.
    fake_session = SimpleNamespace(
        session_uuid="sess_x",
        board_uuid=other_board.board_uuid,
        block_uuid="block_x",
        iteration_count=0,
        max_iterations=3,
        current_html="<div/>",
        message_history=[],
    )

    reserve_spy = Mock()
    with patch(
        "src.routers.boards.boards_playground.get_boards_playground_session",
        return_value=fake_session,
    ):
        with patch("src.routers.boards.boards_playground.reserve_ai_credit", reserve_spy):
            with pytest.raises(HTTPException) as exc_info:
                await iterate_boards_playground_session(
                    request=mock_request,
                    message_request=message_request,
                    current_user=regular_user,
                    db_session=db,
                )
    assert exc_info.value.status_code == 403
    reserve_spy.assert_not_called()


@pytest.mark.asyncio
async def test_boards_playground_same_org_passes_membership_gate(db, org, regular_user, mock_request):
    """Legitimate same-org call passes the F-5 gate."""
    from src.routers.boards.boards_playground import start_boards_playground_session
    from src.services.boards.schemas.boards_playground import StartBoardsPlaygroundSession

    own_board = _mk_board(db, org_id=org.id, uid=701, uuid="board_own_1")

    from src.services.boards.schemas.boards_playground import BoardsPlaygroundContext
    session_request = StartBoardsPlaygroundSession(
        board_uuid=own_board.board_uuid,
        block_uuid="block_x",
        prompt="make me a game",
        context=BoardsPlaygroundContext(board_name="x", board_description="y"),
    )

    with patch("src.routers.boards.boards_playground.reserve_ai_credit"):
        with patch(
            "src.routers.boards.boards_playground.create_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="sess_ok", iteration_count=0, max_iterations=3,
                current_html="<div/>", message_history=[],
            ),
        ):
            with patch(
                "src.routers.boards.boards_playground.generate_boards_playground_stream",
                return_value=iter([]),
            ):
                response = await start_boards_playground_session(
                    request=mock_request,
                    session_request=session_request,
                    current_user=regular_user,
                    db_session=db,
                )
                assert response is not None
