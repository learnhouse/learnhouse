"""Tests for src/services/playgrounds/playgrounds_generator.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from src.services.playgrounds.playgrounds_generator import (
    build_playground_system_prompt,
    create_playground_session,
    extract_html_from_response,
    generate_playground_stream,
    get_playground_session,
    get_redis_connection,
    save_playground_session,
)
from src.services.playgrounds.schemas.playgrounds_generator import (
    PlaygroundContext,
    PlaygroundMessage,
    PlaygroundSessionData,
)


class _Chunk:
    def __init__(self, text):
        self.text = text


class TestPlaygroundsGeneratorService:
    def test_redis_helpers_and_session_roundtrip(self):
        context = PlaygroundContext(
            playground_name="Quiz",
            playground_description="Quiz Desc",
        )
        session = PlaygroundSessionData(
            session_uuid="pg_test",
            playground_uuid="playground_1",
            iteration_count=0,
            max_iterations=10,
            message_history=[],
            current_html=None,
            context=context,
        )
        fake_redis = Mock()
        fake_redis.get.return_value = session.model_dump_json()

        with patch(
            "src.services.playgrounds.playgrounds_generator.redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.playgrounds.playgrounds_generator.LH_CONFIG",
            SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ):
            assert get_redis_connection() is fake_redis
            assert save_playground_session(session) is True
            restored = get_playground_session("pg_test")

        assert restored is not None
        assert restored.playground_uuid == "playground_1"
        fake_redis.setex.assert_called_once()

    def test_create_session_prompt_and_extract_html(self):
        context = PlaygroundContext(
            playground_name="Quiz",
            playground_description="Quiz Desc",
            course_name="Physics 101",
        )
        with patch(
            "src.services.playgrounds.playgrounds_generator.save_playground_session"
        ) as save_session:
            session = create_playground_session("playground_1", context)

        prompt = build_playground_system_prompt(context, "Gravity notes")

        assert session.playground_uuid == "playground_1"
        assert "Physics 101" in prompt
        assert "Gravity notes" in prompt
        assert extract_html_from_response("```\n<div>demo</div>\n```") == "<div>demo</div>"
        save_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_generate_stream_success_and_error(self):
        context = PlaygroundContext(
            playground_name="Quiz",
            playground_description="Quiz Desc",
        )
        session = PlaygroundSessionData(
            session_uuid="pg_test",
            playground_uuid="playground_1",
            iteration_count=0,
            max_iterations=10,
            message_history=[PlaygroundMessage(role="user", content="Earlier")],
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
            "src.services.playgrounds.playgrounds_generator.get_gemini_client",
            return_value=fake_client,
        ), patch(
            "src.services.playgrounds.playgrounds_generator.save_playground_session"
        ) as save_session:
            chunks = [
                chunk
                async for chunk in generate_playground_stream(
                    "Build it", session, course_context="Gravity notes"
                )
            ]

        assert "".join(chunks) == "<!DOCTYPE html><html>ok</html>"
        assert session.iteration_count == 1
        assert session.current_html == "<!DOCTYPE html><html>ok</html>"
        save_session.assert_called_once()

        with patch(
            "src.services.playgrounds.playgrounds_generator.get_gemini_client",
            side_effect=RuntimeError("boom"),
        ):
            error_chunks = [
                chunk
                async for chunk in generate_playground_stream("Build it", session)
            ]

        assert error_chunks == ["Error: boom"]
