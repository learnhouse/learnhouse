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

    def test_redis_and_session_error_paths(self):
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

        with patch(
            "src.services.boards.boards_playground.LH_CONFIG",
            SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="")
            ),
        ):
            assert get_redis_connection() is None

        with patch(
            "src.services.boards.boards_playground.redis.from_url",
            side_effect=RuntimeError("boom"),
        ), patch(
            "src.services.boards.boards_playground.LH_CONFIG",
            SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ):
            assert get_redis_connection() is None

        with patch(
            "src.services.boards.boards_playground.get_redis_connection",
            return_value=None,
        ):
            assert get_boards_playground_session("pg_test") is None
            assert save_boards_playground_session(session) is False

        fake_redis = Mock()
        fake_redis.get.return_value = "not-json"
        fake_redis.setex.side_effect = RuntimeError("boom")

        with patch(
            "src.services.boards.boards_playground.get_redis_connection",
            return_value=fake_redis,
        ):
            assert get_boards_playground_session("pg_test") is None
            assert save_boards_playground_session(session) is False

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
        assert (
            extract_html_from_response("```\n<div>plain</div>\n```")
            == "<div>plain</div>"
        )
        assert extract_html_from_response("  <div>raw</div>  ") == "<div>raw</div>"
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

    @pytest.mark.asyncio
    async def test_generate_stream_iteration_branch_and_trim_history(self):
        context = BoardsPlaygroundContext(
            board_name="Math Board", board_description="Fractions"
        )
        session = BoardsPlaygroundSessionData(
            session_uuid="pg_test",
            block_uuid="block_1",
            board_uuid="board_1",
            iteration_count=1,
            max_iterations=6,
            message_history=[
                BoardsPlaygroundMessage(role="user", content=f"msg-{index}")
                for index in range(13)
            ],
            current_html="<html>current</html>",
            context=context,
        )
        generate_mock = Mock(
            return_value=iter([_Chunk("<!DOCTYPE html>"), _Chunk("<html>updated</html>")])
        )
        fake_client = SimpleNamespace(
            models=SimpleNamespace(generate_content_stream=generate_mock)
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
                    "Update it", session, current_html="<html>current</html>"
                )
            ]

        assert "".join(chunks) == "<!DOCTYPE html><html>updated</html>"
        assert session.iteration_count == 2
        assert session.current_html == "<!DOCTYPE html><html>updated</html>"
        assert len(session.message_history) == 12
        assert any(msg.content == "msg-12" for msg in session.message_history)
        call_kwargs = generate_mock.call_args.kwargs
        assert call_kwargs["model"] == "gemini-2.0-flash"
        iteration_prompt = call_kwargs["contents"][-1]["parts"][0]["text"]
        assert "CURRENT HTML CODE" in iteration_prompt
        assert "Update it" in iteration_prompt
        save_session.assert_called_once()
