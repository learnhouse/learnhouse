"""Regression tests for LEARNHOUSE-API-8F / -8B / -8G.

One provider outage used to fan out into three things the on-call had to look
at and the user could not act on:

- ``/ai/images/generate`` answered 502 ("upstream is broken, retry"), which the
  Sentry Starlette integration captures as an error event.
- The playgrounds and course-planning SSE streams reserved credits up front,
  never refunded them, and told the user "an internal error occurred".

These pin the client-facing contract: an actionable status/code, and the
reserved credits handed back when the stream produced nothing.

The refund half only works if a failing stream actually *fails*. The playground
service used to catch every non-quota exception and yield the string "Error: An
internal error occurred..." as a chunk, so the router below saw a productive
stream and kept the org's 3 credits for a 5xx, a timeout, a safety refusal or a
parse error. TestPlaygroundStreamCredits therefore drives the real service
generator rather than a hand-rolled one — a generator that raises straight into
event_generator is a shape production never produced, and passes either way.
"""

import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import courseplanning as cp
from src.routers.ai import images as img
from src.routers.playgrounds import playgrounds_generator as pg
from src.services.ai.llm import AIQuotaExhaustedError
from src.services.ai.schemas.image import GenerateImageRequest
from src.services.playgrounds import playgrounds_generator as pg_service
from src.services.playgrounds.schemas.playgrounds_generator import (
    PlaygroundContext,
    PlaygroundSessionData,
)

pytestmark = pytest.mark.asyncio


def _frames(events):
    return [json.loads(e.removeprefix("data: ").strip()) for e in events]


async def _stream_raising(exc):
    if False:  # pragma: no cover - makes this an async generator
        yield ""
    raise exc


async def _stream_of(*chunks):
    for chunk in chunks:
        yield chunk


def _session():
    return PlaygroundSessionData(
        session_uuid="pg_1",
        playground_uuid="play_1",
        iteration_count=0,
        max_iterations=10,
        message_history=[],
        current_html=None,
        context=PlaygroundContext(
            playground_name="Fractions", playground_description="A widget"
        ),
    )


async def _provider_boom(**_kwargs):
    """Stand-in for llm.generate_stream dying mid-call (5xx, timeout, refusal)."""
    if False:  # pragma: no cover - makes this an async generator
        yield ""
    raise RuntimeError("upstream 503 deadline exceeded")


def _real_playground_stream():
    """The production generator, with only the provider call swapped out."""
    return pg_service.generate_playground_stream(
        prompt="build a fractions quiz",
        session=_session(),
        model_name="test-model",
    )


# --------------------------------------------------------------------------
# LEARNHOUSE-API-8F — /ai/images/generate
# --------------------------------------------------------------------------


def _result(value):
    scalars = MagicMock()
    scalars.first.return_value = value
    res = MagicMock()
    res.scalars.return_value = scalars
    return res


def _db_returning(*values):
    db = AsyncMock()
    db.execute.side_effect = [_result(v) for v in values]
    return db


class TestImageRouterQuota:
    async def test_quota_answers_429_and_refunds(self):
        body = GenerateImageRequest(org_id=5, prompt="a cat")
        with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(img, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(img, "enforce_ai_rate_limit"), \
             patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
             patch.object(img, "refund_ai_credit") as refund, \
             patch.object(
                 img,
                 "generate_image",
                 new=AsyncMock(side_effect=AIQuotaExhaustedError("AI provider quota exhausted")),
             ):
            with pytest.raises(HTTPException) as exc:
                await img.api_generate_image(
                    body, SimpleNamespace(id=1), _db_returning(SimpleNamespace(id=5, org_uuid="org_x"))
                )

        # 429, not 502: a 5xx is captured by the Sentry Starlette integration and
        # tells the client to retry something that cannot succeed.
        assert exc.value.status_code == 429
        assert "quota" in exc.value.detail.lower()
        # The provider's own body never reaches the client.
        assert "prepayment" not in exc.value.detail
        assert exc.value.headers == {"Retry-After": "3600"}
        # The new early-return branch is exactly where a refund is easy to forget.
        refund.assert_called_once_with(5, img.IMAGE_CREDIT_COST)

    async def test_other_failures_still_answer_502(self):
        body = GenerateImageRequest(org_id=5, prompt="a cat")
        with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(img, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(img, "enforce_ai_rate_limit"), \
             patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
             patch.object(img, "refund_ai_credit") as refund, \
             patch.object(img, "generate_image", new=AsyncMock(side_effect=RuntimeError("boom"))):
            with pytest.raises(HTTPException) as exc:
                await img.api_generate_image(
                    body, SimpleNamespace(id=1), _db_returning(SimpleNamespace(id=5, org_uuid="org_x"))
                )

        assert exc.value.status_code == 502
        refund.assert_called_once_with(5, img.IMAGE_CREDIT_COST)


# --------------------------------------------------------------------------
# LEARNHOUSE-API-8B — playgrounds SSE stream
# --------------------------------------------------------------------------


class TestPlaygroundStreamCredits:
    async def test_quota_emits_typed_error_and_refunds(self, caplog):
        with caplog.at_level(logging.DEBUG), patch.object(pg, "refund_ai_credit") as refund:
            events = [
                e
                async for e in pg.event_generator(
                    _stream_raising(AIQuotaExhaustedError("AI provider quota exhausted")),
                    "pg_1",
                    org_id=7,
                )
            ]

        frames = _frames(events)
        assert frames[-1]["type"] == "error"
        assert frames[-1]["code"] == "ai_quota_exhausted"
        assert "prepayment" not in json.dumps(frames)
        refund.assert_called_once_with(7, pg.GENERATION_CREDIT_COST)
        # A known billing state must not open a Sentry issue.
        assert not [
            r
            for r in caplog.records
            if r.levelno >= logging.ERROR and "playground" in r.getMessage().lower()
        ]

    async def test_service_reraises_instead_of_yielding_an_error_string(self):
        """A failed generation must not look like content to its consumer."""
        with patch.object(pg_service, "generate_stream", _provider_boom):
            with pytest.raises(RuntimeError):
                [chunk async for chunk in _real_playground_stream()]

    async def test_generic_provider_failure_refunds_end_to_end(self, caplog):
        """The credit leak: any non-quota fault used to bill 3 credits for nothing.

        Driven through the real service generator, because the leak lived in the
        seam between the two — the service swallowed the exception and yielded a
        string, and the router counted that string as output.
        """
        with caplog.at_level(logging.DEBUG), \
             patch.object(pg_service, "generate_stream", _provider_boom), \
             patch.object(pg, "refund_ai_credit") as refund:
            events = [
                e
                async for e in pg.event_generator(
                    _real_playground_stream(), "pg_1", org_id=7
                )
            ]

        frames = _frames(events)
        # No chunk and no done frame: the client is told it failed, once.
        assert [f["type"] for f in frames] == ["error"]
        # ...and never with the provider's own words.
        assert "deadline exceeded" not in json.dumps(frames)
        refund.assert_called_once_with(7, pg.GENERATION_CREDIT_COST)
        # A genuine fault still has to reach Sentry, i.e. be logged at ERROR.
        assert [r for r in caplog.records if r.levelno >= logging.ERROR]

    async def test_successful_stream_is_not_refunded(self):
        with patch.object(pg, "refund_ai_credit") as refund:
            events = [
                e
                async for e in pg.event_generator(_stream_of("<html>"), "pg_1", org_id=7)
            ]
        frames = _frames(events)
        assert frames[0] == {"type": "chunk", "content": "<html>"}
        assert frames[-1]["type"] == "done"
        refund.assert_not_called()


# --------------------------------------------------------------------------
# LEARNHOUSE-API-8G — course-planning SSE streams
# --------------------------------------------------------------------------


class TestCoursePlanningStreamCredits:
    async def test_quota_emits_typed_error_and_refunds_the_reserved_amount(self, caplog):
        with caplog.at_level(logging.DEBUG), patch.object(cp, "refund_ai_credit") as refund:
            events = [
                e
                async for e in cp.event_generator(
                    _stream_raising(AIQuotaExhaustedError("AI provider quota exhausted")),
                    "cp_1",
                    org_id=9,
                    credit_cost=3,
                )
            ]

        frames = _frames(events)
        assert frames[-1]["code"] == "ai_quota_exhausted"
        assert "prepayment" not in json.dumps(frames)
        # Must match the amount reserve_ai_credit took, not a hardcoded 1.
        refund.assert_called_once_with(9, 3)
        assert not [
            r
            for r in caplog.records
            if r.levelno >= logging.ERROR and r.name == "src.routers.ai.courseplanning"
        ]

    async def test_activity_content_stream_refunds_too(self):
        with patch.object(cp, "refund_ai_credit") as refund:
            events = [
                e
                async for e in cp.event_generator_with_save(
                    _stream_raising(AIQuotaExhaustedError("AI provider quota exhausted")),
                    "cp_1",
                    "act_1",
                    org_id=9,
                    credit_cost=3,
                )
            ]
        assert _frames(events)[-1]["code"] == "ai_quota_exhausted"
        refund.assert_called_once_with(9, 3)

    async def test_successful_stream_is_not_refunded(self):
        with patch.object(cp, "refund_ai_credit") as refund:
            events = [
                e
                async for e in cp.event_generator(
                    _stream_of("{"), "cp_1", org_id=9, credit_cost=3
                )
            ]
        assert _frames(events)[-1]["type"] == "done"
        refund.assert_not_called()

    async def test_refund_failure_never_breaks_the_stream(self):
        """Redis being down must not turn a handled AI error into a 500."""
        with patch.object(cp, "refund_ai_credit", side_effect=RuntimeError("redis down")):
            events = [
                e
                async for e in cp.event_generator(
                    _stream_raising(RuntimeError("boom")), "cp_1", org_id=9, credit_cost=3
                )
            ]
        assert _frames(events)[-1]["type"] == "error"
