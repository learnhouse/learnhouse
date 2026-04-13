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
        fake_redis.get.side_effect = [
            session.model_dump_json(),
            session.model_dump_json().encode("utf-8"),
        ]

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
            restored_bytes = get_playground_session("pg_test")

        assert restored is not None
        assert restored.playground_uuid == "playground_1"
        assert restored_bytes is not None
        assert restored_bytes.playground_uuid == "playground_1"
        fake_redis.setex.assert_called_once()

    def test_redis_helpers_fallbacks_and_errors(self):
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
        bad_redis = Mock()
        bad_redis.get.side_effect = RuntimeError("boom")
        bad_redis.setex.side_effect = RuntimeError("boom")

        with patch(
            "src.services.playgrounds.playgrounds_generator.redis.from_url",
            side_effect=RuntimeError("connect fail"),
        ), patch(
            "src.services.playgrounds.playgrounds_generator.LH_CONFIG",
            SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ):
            assert get_redis_connection() is None

        with patch(
            "src.services.playgrounds.playgrounds_generator.LH_CONFIG",
            SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string=""))
        ):
            assert get_redis_connection() is None
            assert get_playground_session("pg_test") is None
            assert save_playground_session(session) is False

        with patch(
            "src.services.playgrounds.playgrounds_generator.redis.from_url",
            return_value=bad_redis,
        ), patch(
            "src.services.playgrounds.playgrounds_generator.LH_CONFIG",
            SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ):
            assert get_playground_session("pg_test") is None
            assert save_playground_session(session) is False

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
        assert (
            extract_html_from_response("```html\n<section>demo</section>\n```")
            == "<section>demo</section>"
        )
        assert extract_html_from_response("plain html") == "plain html"
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

        current_html_session = PlaygroundSessionData(
            session_uuid="pg_existing",
            playground_uuid="playground_1",
            iteration_count=0,
            max_iterations=10,
            message_history=[
                PlaygroundMessage(role="user", content=f"msg{i}") for i in range(13)
            ],
            current_html="<div>old</div>",
            context=context,
        )
        captured_contents = {}

        def _generate_content_stream(*, model, contents):
            captured_contents["model"] = model
            captured_contents["contents"] = contents
            return iter([_Chunk(""), _Chunk("```html\n<div>updated</div>\n```")])

        fake_iteration_client = SimpleNamespace(
            models=SimpleNamespace(generate_content_stream=_generate_content_stream)
        )

        with patch(
            "src.services.playgrounds.playgrounds_generator.get_gemini_client",
            return_value=fake_iteration_client,
        ), patch(
            "src.services.playgrounds.playgrounds_generator.save_playground_session"
        ) as save_session:
            iteration_chunks = [
                chunk
                async for chunk in generate_playground_stream(
                    "Make it brighter",
                    current_html_session,
                    current_html="<div>old</div>",
                )
            ]

        assert "".join(iteration_chunks) == "```html\n<div>updated</div>\n```"
        assert current_html_session.iteration_count == 1
        assert current_html_session.current_html == "<div>updated</div>"
        assert len(current_html_session.message_history) == 12
        assert current_html_session.message_history[-2].content == "Make it brighter"
        assert current_html_session.message_history[-1].content == (
            "```html\n<div>updated</div>\n```"
        )
        assert captured_contents["model"] == "gemini-2.0-flash"
        assert "CURRENT HTML CODE:" in captured_contents["contents"][-1]["parts"][0][
            "text"
        ]
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
