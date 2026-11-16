"""AI provider quota errors are an operational state, not a bug.

A provider refusing work over a rate limit, quota or spending cap must log a
warning (not an error Sentry turns into an issue), must not be retried when
waiting cannot help, and must reach the user as a clear "AI is unavailable"
message. Real failures keep their error logging and generic messages.
"""

import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from google.genai.errors import ClientError
from pydantic_ai.exceptions import (
    ModelHTTPError,
    ModelQuotaExceededError,
    ModelRateLimitError,
)

from src.services.ai.llm import errors
from src.services.ai.llm.errors import (
    AI_QUOTA_MESSAGE,
    ai_error_message,
    is_quota_error,
    is_spend_cap_error,
    log_ai_failure,
)
from src.services.ai.rag import embedding_service, pipeline, queue
from src.services.ai.rag.types import ContentRef

SPEND_CAP = "Your project has exceeded its monthly spending cap. Please go to AI Studio."
RATE_LIMIT = "Resource has been exhausted (e.g. check quota)."


def _spend_cap():
    return ModelHTTPError(429, "gemini-embedding-001", {"error": {"code": 429, "message": SPEND_CAP}})


def _rate_limited():
    return ModelHTTPError(429, "gemini-embedding-001", {"error": {"code": 429, "message": RATE_LIMIT}})


def _wrapped(inner: BaseException) -> RuntimeError:
    """``inner`` re-raised the way our services wrap provider errors."""
    try:
        try:
            raise inner
        except BaseException:
            raise RuntimeError("Course planning error")
    except RuntimeError as e:
        return e


async def _collect(gen):
    return [chunk async for chunk in gen]


async def _failing_stream(exc):
    raise exc
    yield  # pragma: no cover - makes this an async generator


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


class TestClassification:
    def test_http_429_is_quota(self):
        assert is_quota_error(_rate_limited())
        assert not is_spend_cap_error(_rate_limited())

    def test_spend_cap_is_quota_and_not_retryable(self):
        assert is_quota_error(_spend_cap())
        assert is_spend_cap_error(_spend_cap())

    def test_google_sdk_error_carries_status_as_code(self):
        exc = ClientError(429, {"error": {"code": 429, "message": SPEND_CAP, "status": "RESOURCE_EXHAUSTED"}})
        assert is_quota_error(exc)
        assert is_spend_cap_error(exc)

    def test_pydantic_ai_categories(self):
        assert is_quota_error(ModelRateLimitError("gemini", "slow down"))
        assert not is_spend_cap_error(ModelRateLimitError("gemini", "slow down"))
        assert is_quota_error(ModelQuotaExceededError("gpt", "billing"))
        assert is_spend_cap_error(ModelQuotaExceededError("gpt", "billing"))

    def test_found_through_wrapping_exceptions(self):
        assert is_quota_error(_wrapped(_rate_limited()))
        assert is_spend_cap_error(_wrapped(_spend_cap()))

    def test_our_own_rate_limit_is_not_the_providers(self):
        assert not is_quota_error(HTTPException(status_code=429, detail="Too many requests"))

    def test_other_failures_are_not_quota(self):
        assert not is_quota_error(None)
        assert not is_quota_error(ValueError("boom"))
        assert not is_quota_error(ModelHTTPError(500, "gemini", "oops"))
        assert not is_spend_cap_error(ValueError("exceeded its monthly spending cap"))

    def test_cyclic_chain_terminates(self):
        exc = ValueError("loop")
        exc.__cause__ = exc
        assert not is_quota_error(exc)

    def test_user_message(self):
        assert ai_error_message(_wrapped(_spend_cap()), "default") == AI_QUOTA_MESSAGE
        assert ai_error_message(ValueError("x"), "default") == "default"


class TestLogAIFailure:
    def test_quota_logs_a_warning_without_traceback(self, caplog):
        log = logging.getLogger("test.quota")
        with caplog.at_level(logging.WARNING, logger="test.quota"):
            log_ai_failure(log, _spend_cap(), "Generation failed for %s", "s1")
        (record,) = caplog.records
        assert record.levelno == logging.WARNING
        assert record.exc_info is None
        assert "Generation failed for s1 (AI provider quota reached)" in record.getMessage()

    def test_other_failures_log_an_error_with_traceback(self, caplog):
        log = logging.getLogger("test.quota")
        with caplog.at_level(logging.WARNING, logger="test.quota"):
            log_ai_failure(log, ValueError("boom"), "Generation failed for %s", "s1")
        (record,) = caplog.records
        assert record.levelno == logging.ERROR
        assert record.exc_info[1].args == ("boom",)
        assert record.getMessage() == "Generation failed for s1"


# ---------------------------------------------------------------------------
# Embeddings: no retry on a spent budget, and warnings rather than errors
# ---------------------------------------------------------------------------


class TestEmbeddingRetries:
    @pytest.fixture(autouse=True)
    def _no_sleep(self):
        with patch.object(embedding_service.asyncio, "sleep", new=AsyncMock()) as sleep:
            yield sleep

    async def test_spend_cap_fails_fast_with_a_warning(self, caplog):
        embed = AsyncMock(side_effect=_spend_cap())
        with patch.object(embedding_service, "embed_documents", embed), caplog.at_level(logging.WARNING):
            with pytest.raises(ModelHTTPError):
                await embedding_service.generate_embeddings(["a"])
        assert embed.await_count == 1
        assert [r.levelno for r in caplog.records] == [logging.WARNING]
        assert "after 1 attempts" in caplog.records[0].getMessage()

    async def test_rate_limit_is_retried_then_warns(self, caplog):
        embed = AsyncMock(side_effect=_rate_limited())
        with patch.object(embedding_service, "embed_documents", embed), caplog.at_level(logging.WARNING):
            with pytest.raises(ModelHTTPError):
                await embedding_service.generate_embeddings(["a"])
        assert embed.await_count == embedding_service.MAX_RETRIES
        assert all(r.levelno == logging.WARNING for r in caplog.records)

    async def test_other_failures_still_log_an_error(self, caplog):
        embed = AsyncMock(side_effect=ValueError("bad input"))
        with patch.object(embedding_service, "embed_documents", embed), caplog.at_level(logging.WARNING):
            with pytest.raises(ValueError):
                await embedding_service.generate_embeddings(["a"])
        assert embed.await_count == embedding_service.MAX_RETRIES
        assert caplog.records[-1].levelno == logging.ERROR

    async def test_single_spend_cap_fails_fast_with_a_warning(self, caplog):
        embed = AsyncMock(side_effect=_spend_cap())
        with patch.object(embedding_service, "embed_query", embed), caplog.at_level(logging.WARNING):
            with pytest.raises(ModelHTTPError):
                await embedding_service.embed_single_text("q")
        assert embed.await_count == 1
        assert [r.levelno for r in caplog.records] == [logging.WARNING]

    async def test_single_other_failure_logs_an_error(self, caplog):
        embed = AsyncMock(side_effect=ValueError("bad input"))
        with patch.object(embedding_service, "embed_query", embed), caplog.at_level(logging.WARNING):
            with pytest.raises(ValueError):
                await embedding_service.embed_single_text("q")
        assert embed.await_count == embedding_service.MAX_RETRIES
        assert [r.levelno for r in caplog.records] == [logging.ERROR]


# ---------------------------------------------------------------------------
# RAG indexing
# ---------------------------------------------------------------------------


class TestIndexing:
    async def test_quota_failure_warns(self, caplog):
        run = AsyncMock(side_effect=_spend_cap())
        with patch.object(pipeline, "run", run), caplog.at_level(logging.WARNING):
            await queue._run(ContentRef.activity(7))
        (record,) = caplog.records
        assert record.levelno == logging.WARNING
        assert "activity:7" in record.getMessage()

    async def test_other_failure_logs_an_error(self, caplog):
        run = AsyncMock(side_effect=ValueError("bad row"))
        with patch.object(pipeline, "run", run), caplog.at_level(logging.WARNING):
            await queue._run(ContentRef.activity(7))
        (record,) = caplog.records
        assert record.levelno == logging.ERROR
        assert record.exc_info is not None

    def test_nul_bytes_are_stripped_before_storage(self):
        """Postgres text rejects 0x00, which PDF extraction can produce."""
        extraction = SimpleNamespace(segments=[SimpleNamespace(text="Page\x00 one\x00")])
        chunks = pipeline._chunks(extraction)
        assert [text for text, _, _ in chunks] == ["Page one"]


# ---------------------------------------------------------------------------
# Sentry backstop
# ---------------------------------------------------------------------------


class TestBeforeSend:
    def test_quota_events_are_dropped(self):
        import app

        exc = _wrapped(_spend_cap())
        assert app._before_send({"transaction": "/x"}, {"exc_info": (type(exc), exc, None)}) is None

    def test_other_events_are_kept(self):
        import app

        exc = ValueError("boom")
        event = {"transaction": "/x"}
        assert app._before_send(event, {"exc_info": (type(exc), exc, None)}) is event
        assert app._before_send(event, {}) is event


# ---------------------------------------------------------------------------
# Image generation
# ---------------------------------------------------------------------------


class TestImageGeneration:
    async def _generate(self, side_effect):
        import src.services.ai.image.generator as gen

        cfg = SimpleNamespace(ai_config=SimpleNamespace(provider="google", api_key="k", gemini_api_key=None, image_model=None))
        client = MagicMock()
        client.aio.models.generate_content = AsyncMock(side_effect=side_effect)
        with patch.object(gen, "get_learnhouse_config", return_value=cfg), patch(
            "google.genai.Client", return_value=client
        ), patch("asyncio.sleep", new=AsyncMock()):
            with pytest.raises(RuntimeError):
                await gen.generate_image("a cat")
        return client.aio.models.generate_content.await_count

    async def test_spend_cap_is_not_retried_and_warns(self, caplog):
        exc = ClientError(429, {"error": {"code": 429, "message": SPEND_CAP, "status": "RESOURCE_EXHAUSTED"}})
        with caplog.at_level(logging.WARNING):
            assert await self._generate(exc) == 1
        assert [r.levelno for r in caplog.records] == [logging.WARNING]

    async def test_other_failures_log_an_error(self, caplog):
        with caplog.at_level(logging.WARNING):
            assert await self._generate(ValueError("boom")) == 1
        assert [r.levelno for r in caplog.records] == [logging.ERROR]


# ---------------------------------------------------------------------------
# Streaming endpoints: the user sees a quota message, the logs a warning
# ---------------------------------------------------------------------------


def _error_event(chunks):
    events = [json.loads(c.removeprefix("data: ")) for c in chunks]
    return next(e for e in events if e["type"] == "error")


class TestStreamingEndpoints:
    @pytest.fixture(autouse=True)
    def _no_side_effects(self):
        with patch("src.security.features_utils.usage.refund_ai_credit"), patch("src.security.features_utils.usage.refund_ai_credit"
        ), patch("src.routers.ai.ai.save_message_to_history"):
            yield

    async def _check(self, make_gen, caplog):
        with caplog.at_level(logging.WARNING):
            quota = _error_event(await _collect(make_gen(_failing_stream(_wrapped(_spend_cap())))))
        assert quota["message"] == AI_QUOTA_MESSAGE
        assert all(r.levelno == logging.WARNING for r in caplog.records)
        caplog.clear()
        with caplog.at_level(logging.WARNING):
            other = _error_event(await _collect(make_gen(_failing_stream(ValueError("boom")))))
        assert other["message"] != AI_QUOTA_MESSAGE
        assert any(r.levelno == logging.ERROR for r in caplog.records)

    async def test_course_planning(self, caplog):
        from src.routers.ai import courseplanning

        await self._check(lambda s: courseplanning.event_generator(s, "cp_1"), caplog)

    async def test_activity_content_generation(self, caplog):
        from src.routers.ai import courseplanning

        await self._check(lambda s: courseplanning.event_generator_with_save(s, "cp_1", "act_1"), caplog)

    async def test_magicblocks(self, caplog):
        from src.routers.ai import magicblocks

        await self._check(lambda s: magicblocks.event_generator(s, "mb_1"), caplog)

    async def test_activity_chat(self, caplog):
        from src.routers.ai import ai

        await self._check(
            lambda s: ai.activity_chat_event_generator(s, "c1", "act_1", "hi", "text", "gemini"),
            caplog,
        )

    async def test_editor_chat(self, caplog):
        from src.routers.ai import ai

        await self._check(
            lambda s: ai.editor_chat_event_generator(s, "c1", "act_1", "hi", "text", "gemini"),
            caplog,
        )

    async def test_ask_ai_stream_logs_and_reraises(self, caplog):
        from src.services.ai import base

        with patch.object(base, "generate_stream", lambda **kw: _failing_stream(_spend_cap())), caplog.at_level(logging.WARNING):
            with pytest.raises(ModelHTTPError):
                await _collect(base.ask_ai_stream("q", [], "", "sys", "gemini"))
        assert [r.levelno for r in caplog.records] == [logging.WARNING]


def test_module_exports_quota_message():
    assert errors.AI_QUOTA_MESSAGE == AI_QUOTA_MESSAGE


@pytest.fixture(autouse=True)
def _ai_credit_store(ai_credit_spy):
    """Fake credit store + usage ledger for metered AI charges (conftest)."""
    yield ai_credit_spy
