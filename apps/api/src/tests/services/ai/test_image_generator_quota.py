"""Regression tests for LEARNHOUSE-API-8A / -8E.

A hard quota/billing 429 from Google is terminal. Before the fix, generator.py
retried it 3x (1.5s + 3.0s of sleep), so a single user click produced three
SDK-boundary Sentry captures plus an ERROR log that opened a fourth issue
titled just "ClientError".

These pin the split in both directions: a spent balance fails once at WARNING,
while a per-minute 429 — which Gemini reports with the *same* status and the
same "check your plan and billing details" sentence — still gets its retries, so
one user click does not fail on a limit that clears in half a minute.
"""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import src.services.ai.image.generator as gen
from src.services.ai.llm import AIQuotaExhaustedError

pytestmark = pytest.mark.asyncio

API_KEY = "AIzaSy-test-secret-key"


class _ClientError(Exception):
    """Shape of google.genai.errors.ClientError: numeric .code, body in str()."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _quota_error():
    # The production body from LEARNHOUSE-API-8A, plus the request URL the SDK
    # attaches — which is what makes logging str(exc) an API-key leak.
    return _ClientError(
        429,
        "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'Your "
        "prepayment credits are depleted. Please go to AI Studio at "
        "https://ai.studio/projects to manage your project and billing.', "
        f"'status': 'RESOURCE_EXHAUSTED', 'url': 'https://x/?key={API_KEY}'}}}}",
    )


def _rpm_error():
    """A real per-minute-limit 429 from Gemini: RESOURCE_EXHAUSTED, mentions
    "quota" and "billing", and is nonetheless retryable. Only the QuotaFailure
    violation tells it apart from _quota_error() above."""
    return _ClientError(
        429,
        "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'You exceeded "
        "your current quota, please check your plan and billing details.', "
        "'status': 'RESOURCE_EXHAUSTED', 'details': [{'@type': "
        "'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [{'quotaId': "
        "'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}]}, {'@type': "
        "'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '31s'}]}}",
    )


def _cfg():
    return SimpleNamespace(
        ai_config=SimpleNamespace(
            provider="google", api_key=API_KEY, gemini_api_key=None, image_model=None
        )
    )


def _client(side_effect):
    client = MagicMock()
    client.aio.models.generate_content = AsyncMock(side_effect=side_effect)
    return client


async def _run(client):
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), patch(
        "google.genai.Client", return_value=client
    ), patch("asyncio.sleep", new=AsyncMock()):
        return await gen.generate_image("a cat")


async def test_quota_429_is_not_retried(caplog):
    """One attempt, one WARNING, no ERROR — and a typed error for the router."""
    client = _client(_quota_error())
    with caplog.at_level(logging.DEBUG, logger="src.services.ai.image.generator"):
        with pytest.raises(AIQuotaExhaustedError):
            await _run(client)

    assert client.aio.models.generate_content.await_count == 1

    records = [r for r in caplog.records if r.name == "src.services.ai.image.generator"]
    assert [r.levelno for r in records] == [logging.WARNING]
    # ERROR is what LoggingIntegration turns into a Sentry issue; a known
    # billing state must not open one.
    assert not [r for r in records if r.levelno >= logging.ERROR]
    # The SDK error embeds the API key in the request URL — never log it.
    assert API_KEY not in caplog.text
    assert "prepayment" not in caplog.text


async def test_transient_5xx_is_still_retried_to_the_limit(caplog):
    client = _client(_ClientError(503, "503 UNAVAILABLE. overloaded"))
    with caplog.at_level(logging.DEBUG, logger="src.services.ai.image.generator"):
        with pytest.raises(RuntimeError) as excinfo:
            await _run(client)

    assert not isinstance(excinfo.value, AIQuotaExhaustedError)
    assert client.aio.models.generate_content.await_count == gen._MAX_ATTEMPTS

    errors = [
        r
        for r in caplog.records
        if r.name == "src.services.ai.image.generator" and r.levelno == logging.ERROR
    ]
    assert len(errors) == 1
    # The status discriminates the issue title instead of a bare "ClientError".
    assert "503" in errors[0].getMessage()
    assert API_KEY not in caplog.text


async def test_per_minute_429_stays_retryable(caplog):
    """Only a spent balance is terminal; a per-minute 429 is worth retrying.

    The previous version of this test used "429 TOO_MANY_REQUESTS. slow down",
    a body google-genai never emits — it matched no marker either way, so it
    passed whatever the classifier did. This one uses the body Gemini actually
    returns for an RPM limit, which the broad marker list read as terminal.
    """
    client = _client(_rpm_error())
    with caplog.at_level(logging.DEBUG, logger="src.services.ai.image.generator"):
        with pytest.raises(RuntimeError) as excinfo:
            await _run(client)

    assert not isinstance(excinfo.value, AIQuotaExhaustedError)
    assert client.aio.models.generate_content.await_count == gen._MAX_ATTEMPTS
    assert API_KEY not in caplog.text


async def test_is_retryable_rejects_the_typed_quota_error():
    assert gen._is_retryable(AIQuotaExhaustedError("x")) is False
    # The two 429s, straight from the classifier: status alone decides neither.
    assert gen._is_retryable(_quota_error()) is False
    assert gen._is_retryable(_rpm_error()) is True
    # A class name alone can no longer opt an error back into retrying.
    assert gen._is_retryable(type("ResourceExhausted", (Exception,), {})()) is False
    assert gen._is_retryable(type("ServerError", (Exception,), {})()) is True
