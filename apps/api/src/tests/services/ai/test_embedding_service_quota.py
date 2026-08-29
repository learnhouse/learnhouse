"""Regression tests for LEARNHOUSE-API-8C / -8D.

The RAG embedding path retried *every* exception MAX_RETRIES times with no
classification, so a terminal quota 429 produced three SDK-boundary Sentry
captures per activity save (plus ~3s of wasted upstream work), and the terminal
log interpolated the provider's JSON body straight into the Sentry issue title.

The opposite mistake is worse here than anywhere else in the app, which is what
``test_per_minute_429_still_rides_out_the_backoff`` guards: this loop embeds a
course 100 chunks at a time, and ``embed_course_content`` generates *every*
vector before it touches the DB. Classifying a per-minute 429 as terminal aborts
the whole re-index, and the course silently keeps serving stale embeddings.
"""

import logging
from unittest.mock import AsyncMock, patch

import pytest

import src.services.ai.rag.embedding_service as svc
from src.services.ai.llm import AIQuotaExhaustedError
from src.services.ai.llm.provider import translate_provider_errors

pytestmark = pytest.mark.asyncio

LOGGER = "src.services.ai.rag.embedding_service"

# Verbatim from LEARNHOUSE-API-8C/-8A in production (google-genai renders
# APIError as "{code} {status}. {response_json}"), so the marker below is
# matched against the string Google really sends, not a paraphrase of it.
_QUOTA_BODY = (
    "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'Your "
    "prepayment credits are depleted. Please go to AI Studio at "
    "https://ai.studio/projects to manage your project and billing.', "
    "'status': 'RESOURCE_EXHAUSTED'}}"
)


class _ClientError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


# The body Gemini really returns when the per-minute request limit is hit. It is
# RESOURCE_EXHAUSTED and it mentions both "quota" and "billing", exactly like the
# depleted-balance one — only the QuotaFailure violation differs.
_RPM_BODY = (
    "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'You exceeded your "
    "current quota, please check your plan and billing details.', 'status': "
    "'RESOURCE_EXHAUSTED', 'details': [{'@type': "
    "'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [{'quotaId': "
    "'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}]}, {'@type': "
    "'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '31s'}]}}"
)


async def _raise_through_translation(*_args, **_kwargs):
    """Fail the way production does: inside ``translate_provider_errors``.

    ``embed_documents`` wraps its provider call in that context manager, so what
    this retry loop sees is whatever the classifier decided — which is the thing
    under test. Raising a bare exception here instead would bypass the classifier
    and pin nothing.
    """
    with translate_provider_errors():
        raise _ClientError(429, _RPM_BODY)


def _records(caplog):
    return [r for r in caplog.records if r.name == LOGGER]


class TestGenerateEmbeddings:
    async def test_quota_error_fails_once_at_warning(self, caplog):
        mock = AsyncMock(side_effect=AIQuotaExhaustedError("AI provider quota exhausted"))
        with caplog.at_level(logging.DEBUG, logger=LOGGER), patch.object(
            svc, "embed_documents", mock
        ), patch.object(svc.asyncio, "sleep", new=AsyncMock()) as sleep:
            with pytest.raises(AIQuotaExhaustedError):
                await svc.generate_embeddings(["a"])

        assert mock.await_count == 1  # was 3 — one click, three Sentry events
        sleep.assert_not_awaited()  # ...and ~3s of backoff for a call that can't succeed
        levels = [r.levelno for r in _records(caplog)]
        assert levels == [logging.WARNING]

    async def test_transient_error_still_retries_and_logs_a_stable_title(self, caplog):
        mock = AsyncMock(side_effect=_ClientError(503, "503 UNAVAILABLE. overloaded"))
        with caplog.at_level(logging.DEBUG, logger=LOGGER), patch.object(
            svc, "embed_documents", mock
        ), patch.object(svc.asyncio, "sleep", new=AsyncMock()):
            with pytest.raises(_ClientError):
                await svc.generate_embeddings(["a"])

        assert mock.await_count == svc.MAX_RETRIES
        errors = [r for r in _records(caplog) if r.levelno == logging.ERROR]
        assert len(errors) == 1
        # Class + status only. The provider body used to be interpolated here,
        # which re-fingerprinted the Sentry issue on every distinct message.
        assert "_ClientError(503)" in errors[0].getMessage()

    async def test_per_minute_429_still_rides_out_the_backoff(self, caplog):
        """An RPM 429 must keep retrying — it clears in seconds.

        Terminal-on-any-429 turned this into a single raise, which aborts
        embed_course_content before it writes anything and leaves the course on
        its old vectors with only a log line to show for it.
        """
        mock = AsyncMock(side_effect=_raise_through_translation)
        with caplog.at_level(logging.DEBUG, logger=LOGGER), patch.object(
            svc, "embed_documents", mock
        ), patch.object(svc.asyncio, "sleep", new=AsyncMock()) as sleep:
            with pytest.raises(_ClientError):
                await svc.generate_embeddings(["a"])

        assert mock.await_count == svc.MAX_RETRIES
        assert sleep.await_count == svc.MAX_RETRIES - 1  # 1s then 2s
        # Not AIQuotaExhaustedError: the caller must not be told to give up.
        errors = [r for r in _records(caplog) if r.levelno == logging.ERROR]
        assert len(errors) == 1
        assert "_ClientError(429)" in errors[0].getMessage()
        # ...and the exhausted-retry log still never carries the provider body.
        assert "RESOURCE_EXHAUSTED" not in caplog.text

    async def test_terminal_log_never_carries_the_provider_body(self, caplog):
        mock = AsyncMock(side_effect=_ClientError(500, _QUOTA_BODY))
        with caplog.at_level(logging.DEBUG, logger=LOGGER), patch.object(
            svc, "embed_documents", mock
        ), patch.object(svc.asyncio, "sleep", new=AsyncMock()):
            with pytest.raises(_ClientError):
                await svc.generate_embeddings(["a"])

        assert "prepayment" not in caplog.text
        assert "RESOURCE_EXHAUSTED" not in caplog.text


class TestEmbedSingleText:
    async def test_quota_error_fails_once(self, caplog):
        mock = AsyncMock(side_effect=AIQuotaExhaustedError("AI provider quota exhausted"))
        with caplog.at_level(logging.DEBUG, logger=LOGGER), patch.object(
            svc, "embed_query", mock
        ), patch.object(svc.asyncio, "sleep", new=AsyncMock()) as sleep:
            with pytest.raises(AIQuotaExhaustedError):
                await svc.embed_single_text("question")

        # Interactive RAG path: blind retries here are user-visible latency on a
        # request that cannot succeed.
        assert mock.await_count == 1
        sleep.assert_not_awaited()
        assert [r.levelno for r in _records(caplog)] == [logging.WARNING]

    async def test_transient_error_still_retries(self, caplog):
        mock = AsyncMock(side_effect=_ClientError(503, "503 UNAVAILABLE. overloaded"))
        with caplog.at_level(logging.DEBUG, logger=LOGGER), patch.object(
            svc, "embed_query", mock
        ), patch.object(svc.asyncio, "sleep", new=AsyncMock()):
            with pytest.raises(_ClientError):
                await svc.embed_single_text("question")

        assert mock.await_count == svc.MAX_RETRIES
        errors = [r for r in _records(caplog) if r.levelno == logging.ERROR]
        assert len(errors) == 1
        assert "_ClientError(503)" in errors[0].getMessage()
