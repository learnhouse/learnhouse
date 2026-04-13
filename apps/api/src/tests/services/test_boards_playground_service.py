"""Tests for src/services/boards/boards_playground.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from src.services.boards.boards_playground import (
    build_boards_playground_system_prompt,
    create_boards_playground_session,
    extract_html_from_response,
    generate_boards_playground_stream,
    get_boards_playground_session,
    get_redis_connection,
    save_boards_playground_session,
)
from src.services.boards.schemas.boards_playground import (
    BoardsPlaygroundContext,
    BoardsPlaygroundMessage,
    BoardsPlaygroundSessionData,
)


class _Chunk:
    def __init__(self, text):
        self.text = text


class TestBoardsPlaygroundService:
    def test_redis_helpers_and_session_roundtrip(self):
        context = BoardsPlaygroundContext(
            board_name="Board Name", board_description="Board Description"
        )
        session = BoardsPlaygroundSessionData(
            session_uuid="pg_test",
            block_uuid="block_1",
            board_uuid="board_1",
            iteration_count=0,
            max_iterations=6,
            message_history=[],
            current_html=None,
            context=context,
        )
        fake_redis = Mock()
        fake_redis.get.return_value = session.model_dump_json().encode("utf-8")

        with patch(
            "src.services.boards.boards_playground.redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.boards.boards_playground.LH_CONFIG",
            SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ):
            assert get_redis_connection() is fake_redis
            assert save_boards_playground_session(session) is True
            restored = get_boards_playground_session("pg_test")

        assert restored is not None
        assert restored.session_uuid == "pg_test"
        fake_redis.setex.assert_called_once()

    def test_create_session_prompt_and_extract_html(self):
        context = BoardsPlaygroundContext(
            board_name="Physics Board", board_description="Motion demos"
        )
        with patch(
            "src.services.boards.boards_playground.save_boards_playground_session"
        ) as save_session:
            session = create_boards_playground_session("block_x", "board_x", context)

        prompt = build_boards_playground_system_prompt(context)

        assert session.board_uuid == "board_x"
        assert "Physics Board" in prompt
        assert "Tailwind CSS" in prompt
        assert (
            extract_html_from_response("```html\n<div>demo</div>\n```")
            == "<div>demo</div>"
        )
        save_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_generate_stream_success_and_error(self):
        context = BoardsPlaygroundContext(
            board_name="Math Board", board_description="Fractions"
        )
        session = BoardsPlaygroundSessionData(
            session_uuid="pg_test",
            block_uuid="block_1",
            board_uuid="board_1",
            iteration_count=0,
            max_iterations=6,
            message_history=[BoardsPlaygroundMessage(role="user", content="Earlier")],
            current_html=None,
            context=context,
        )
        fake_client = SimpleNamespace(
            models=SimpleNamespace(
                generate_content_stream=lambda **_: iter(
                    [_Chunk("<!DOCTYPE html>"), _Chunk("<html>ok</html>")]
                )
            )
        )

        with patch(
            "src.services.boards.boards_playground.get_gemini_client",
            return_value=fake_client,
        ), patch(
            "src.services.boards.boards_playground.save_boards_playground_session"
        ) as save_session:
            chunks = [
                chunk
                async for chunk in generate_boards_playground_stream(
                    "Build it", session
                )
            ]

        assert "".join(chunks) == "<!DOCTYPE html><html>ok</html>"
        assert session.iteration_count == 1
        assert session.current_html == "<!DOCTYPE html><html>ok</html>"
        save_session.assert_called_once()

        with patch(
            "src.services.boards.boards_playground.get_gemini_client",
            side_effect=RuntimeError("boom"),
        ):
            error_chunks = [
                chunk
                async for chunk in generate_boards_playground_stream(
                    "Build it", session
                )
            ]

        assert error_chunks == ["Error: boom"]
