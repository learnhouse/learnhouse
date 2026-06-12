"""Behavioral tests for src/routers/ai/ai.py.

Covers:
- The two non-streaming endpoints that `return await <service>(...)` (lines 58, 83).
- The editor_chat_event_generator refund-in-finally path (lines 303, 408-421).

External I/O is fully mocked. Handler functions are called directly with an
AsyncMock db_session and a fake current_user. No network, no app spin-up.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.routers.ai import ai as ai_router
from src.services.ai.schemas.ai import (
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)


# ---------------------------------------------------------------------------
# Non-streaming endpoints: return await <service>(...)  (lines 58, 83)
# ---------------------------------------------------------------------------


class TestNonStreamingEndpoints:
    async def test_start_activity_chat_session_returns_awaited_result(self):
        request = MagicMock()
        db_session = AsyncMock()
        current_user = MagicMock()
        chat_obj = StartActivityAIChatSession(activity_uuid="act_1", message="hi")

        sentinel = object()
        with patch.object(
            ai_router,
            "ai_start_activity_chat_session",
            new_callable=AsyncMock,
            return_value=sentinel,
        ) as svc:
            result = await ai_router.api_ai_start_activity_chat_session(
                request, chat_obj, current_user, db_session
            )

        assert result is sentinel
        svc.assert_awaited_once_with(request, chat_obj, current_user, db_session)

    async def test_send_activity_chat_message_returns_awaited_result(self):
        request = MagicMock()
        db_session = AsyncMock()
        current_user = MagicMock()
        chat_obj = SendActivityAIChatMessage(
            aichat_uuid="chat_1", activity_uuid="act_1", message="hi"
        )

        sentinel = object()
        with patch.object(
            ai_router,
            "ai_send_activity_chat_message",
            new_callable=AsyncMock,
            return_value=sentinel,
        ) as svc:
            result = await ai_router.api_ai_send_activity_chat_message(
                request, chat_obj, current_user, db_session
            )

        assert result is sentinel
        svc.assert_awaited_once_with(request, chat_obj, current_user, db_session)


# ---------------------------------------------------------------------------
# editor_chat_event_generator refund-in-finally  (lines 303, 408-421)
# ---------------------------------------------------------------------------


async def _drain(gen):
    return [chunk async for chunk in gen]


class TestEditorChatEventGeneratorRefund:
    async def test_refund_called_when_stream_raises(self):
        """Upstream stream raises -> error event emitted and refund issued."""

        async def failing_stream():
            if False:
                yield ""  # pragma: no cover - make this an async generator
            raise RuntimeError("model exploded")

        with patch.object(
            ai_router, "refund_ai_credit"
        ) as refund, patch.object(
            ai_router, "save_message_to_history"
        ), patch.object(
            ai_router,
            "generate_follow_up_suggestions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            events = await _drain(
                ai_router.editor_chat_event_generator(
                    failing_stream(),
                    aichat_uuid="chat_1",
                    activity_uuid="act_1",
                    user_message="hi",
                    ai_friendly_text="ctx",
                    ai_model="gemini-2.5-flash",
                    org_id=42,
                )
            )

        # error event emitted (lines 412-415)
        assert any('"type": "error"' in e for e in events)
        # refund issued in finally (line 417-419)
        refund.assert_called_once_with(42, 1)

    async def test_refund_called_on_empty_response(self):
        """Stream produces nothing -> refund because full_response is empty."""

        async def empty_stream():
            if False:
                yield ""  # pragma: no cover
            return

        with patch.object(
            ai_router, "refund_ai_credit"
        ) as refund, patch.object(
            ai_router, "save_message_to_history"
        ), patch.object(
            ai_router,
            "generate_follow_up_suggestions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            await _drain(
                ai_router.editor_chat_event_generator(
                    empty_stream(),
                    aichat_uuid="chat_1",
                    activity_uuid="act_1",
                    user_message="hi",
                    ai_friendly_text="ctx",
                    ai_model="gemini-2.5-flash",
                    org_id=7,
                )
            )

        refund.assert_called_once_with(7, 1)

    async def test_no_refund_on_successful_nonempty_stream(self):
        """Stream produced content and succeeded -> no refund."""

        async def good_stream():
            yield "Hello "
            yield "world"

        with patch.object(
            ai_router, "refund_ai_credit"
        ) as refund, patch.object(
            ai_router, "save_message_to_history"
        ), patch.object(
            ai_router,
            "generate_follow_up_suggestions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            events = await _drain(
                ai_router.editor_chat_event_generator(
                    good_stream(),
                    aichat_uuid="chat_1",
                    activity_uuid="act_1",
                    user_message="hi",
                    ai_friendly_text="ctx",
                    ai_model="gemini-2.5-flash",
                    org_id=99,
                )
            )

        refund.assert_not_called()
        assert any('"type": "done"' in e for e in events)

    async def test_cancelled_error_refunds_and_reraises(self):
        """CancelledError path (lines 407-411) refunds then re-raises."""
        import asyncio

        async def cancelling_stream():
            if False:
                yield ""  # pragma: no cover
            raise asyncio.CancelledError()

        with patch.object(
            ai_router, "refund_ai_credit"
        ) as refund, patch.object(
            ai_router, "save_message_to_history"
        ), patch.object(
            ai_router,
            "generate_follow_up_suggestions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            with pytest.raises(asyncio.CancelledError):
                await _drain(
                    ai_router.editor_chat_event_generator(
                        cancelling_stream(),
                        aichat_uuid="chat_1",
                        activity_uuid="act_1",
                        user_message="hi",
                        ai_friendly_text="ctx",
                        ai_model="gemini-2.5-flash",
                        org_id=5,
                    )
                )

        refund.assert_called_once_with(5, 1)

    async def test_no_refund_when_org_id_none(self):
        """org_id None -> finally block must not attempt refund (line 417 guard)."""

        async def failing_stream():
            if False:
                yield ""  # pragma: no cover
            raise RuntimeError("boom")

        with patch.object(
            ai_router, "refund_ai_credit"
        ) as refund, patch.object(
            ai_router, "save_message_to_history"
        ), patch.object(
            ai_router,
            "generate_follow_up_suggestions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            await _drain(
                ai_router.editor_chat_event_generator(
                    failing_stream(),
                    aichat_uuid="chat_1",
                    activity_uuid="act_1",
                    user_message="hi",
                    ai_friendly_text="ctx",
                    ai_model="gemini-2.5-flash",
                    org_id=None,
                )
            )

        refund.assert_not_called()

    async def test_refund_failure_swallowed(self):
        """A failing refund (lines 420-421) must not break the generator."""

        async def failing_stream():
            if False:
                yield ""  # pragma: no cover
            raise RuntimeError("boom")

        with patch.object(
            ai_router,
            "refund_ai_credit",
            side_effect=RuntimeError("refund down"),
        ), patch.object(
            ai_router, "save_message_to_history"
        ), patch.object(
            ai_router,
            "generate_follow_up_suggestions",
            new_callable=AsyncMock,
            return_value=[],
        ):
            # should not raise despite refund failing
            events = await _drain(
                ai_router.editor_chat_event_generator(
                    failing_stream(),
                    aichat_uuid="chat_1",
                    activity_uuid="act_1",
                    user_message="hi",
                    ai_friendly_text="ctx",
                    ai_model="gemini-2.5-flash",
                    org_id=11,
                )
            )

        assert any('"type": "error"' in e for e in events)
