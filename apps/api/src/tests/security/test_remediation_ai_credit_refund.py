"""
F-11: AI credits are refunded if the streaming generator aborts before
producing any model output.

These unit-test the SSE generator directly — the router wiring that injects
``org_id`` is covered by the existing F-9 rate-limit tests.
"""

import asyncio
from unittest.mock import patch

import pytest


async def _collect(gen):
    chunks = []
    async for c in gen:
        chunks.append(c)
    return chunks


async def _empty_stream():
    """A stream that yields nothing (e.g. upstream model refused)."""
    if False:
        yield ""  # pragma: no cover — never runs, makes this an async gen


async def _raising_stream():
    """Stream that raises before producing any chunk."""
    raise RuntimeError("upstream provider 500")
    yield  # pragma: no cover


async def _cancelled_stream():
    """Stream that gets cancelled (client disconnect) before yielding."""
    raise asyncio.CancelledError()
    yield  # pragma: no cover


@pytest.mark.asyncio
async def test_activity_chat_refunds_credit_on_upstream_exception():
    """F-11: model error → credit refund, org quota preserved."""
    from src.routers.ai.ai import activity_chat_event_generator

    refunded = []
    with patch(
        "src.security.features_utils.usage.refund_ai_credit",
        side_effect=lambda org_id, amount=1: refunded.append((org_id, amount)),
    ), patch(
        "src.routers.ai.ai.save_message_to_history",
    ):
        chunks = await _collect(
            activity_chat_event_generator(
                _raising_stream(),
                "chat_uuid",
                "activity_uuid",
                "hello",
                "ai text",
                "gemini",
                org_id=77,
            )
        )

    # Should have emitted start + error events.
    assert any("error" in c for c in chunks), chunks
    assert refunded == [(77, 1)]


@pytest.mark.asyncio
async def test_activity_chat_refunds_credit_on_empty_stream():
    """F-11: stream produces nothing → credit refunded."""
    from src.routers.ai.ai import activity_chat_event_generator

    refunded = []

    async def _fake_follow_ups(*args, **kwargs):
        return []

    with patch(
        "src.security.features_utils.usage.refund_ai_credit",
        side_effect=lambda org_id, amount=1: refunded.append((org_id, amount)),
    ), patch(
        "src.routers.ai.ai.save_message_to_history",
    ), patch(
        "src.routers.ai.ai.generate_follow_up_suggestions",
        side_effect=_fake_follow_ups,
    ):
        await _collect(
            activity_chat_event_generator(
                _empty_stream(),
                "chat_uuid",
                "activity_uuid",
                "hello",
                "ai text",
                "gemini",
                org_id=77,
            )
        )

    # Empty stream → stream_failed is False but full_response is "" → refund fires.
    assert refunded == [(77, 1)]


@pytest.mark.asyncio
async def test_activity_chat_does_not_refund_on_successful_stream():
    """Sanity: real model output means no refund."""
    from src.routers.ai.ai import activity_chat_event_generator

    async def _good_stream():
        yield "hello"
        yield " world"

    refunded = []

    async def _fake_follow_ups(*args, **kwargs):
        return []

    with patch(
        "src.security.features_utils.usage.refund_ai_credit",
        side_effect=lambda org_id, amount=1: refunded.append((org_id, amount)),
    ), patch(
        "src.routers.ai.ai.save_message_to_history",
    ), patch(
        "src.routers.ai.ai.generate_follow_up_suggestions",
        side_effect=_fake_follow_ups,
    ):
        await _collect(
            activity_chat_event_generator(
                _good_stream(),
                "chat_uuid",
                "activity_uuid",
                "hello",
                "ai text",
                "gemini",
                org_id=77,
            )
        )

    # Stream succeeded with content → no refund.
    assert refunded == []


@pytest.mark.asyncio
async def test_activity_chat_refunds_on_client_disconnect():
    """F-11: CancelledError (client disconnect) → refund + re-raise."""
    from src.routers.ai.ai import activity_chat_event_generator

    refunded = []
    with patch(
        "src.security.features_utils.usage.refund_ai_credit",
        side_effect=lambda org_id, amount=1: refunded.append((org_id, amount)),
    ), patch(
        "src.routers.ai.ai.save_message_to_history",
    ):
        gen = activity_chat_event_generator(
            _cancelled_stream(),
            "chat_uuid",
            "activity_uuid",
            "hello",
            "ai text",
            "gemini",
            org_id=77,
        )

        with pytest.raises(asyncio.CancelledError):
            async for _ in gen:
                pass

    assert refunded == [(77, 1)]
