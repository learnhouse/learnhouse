"""Tests for the shared provider-error classifier in src/services/ai/llm/provider.py.

This is the choke point every AI path leans on to tell a *terminal* provider
refusal (balance or per-day cap spent) from a transient one. Getting it wrong in
either direction is expensive:

- too narrow and a depleted account is retried 3x per call on every endpoint,
  which is what LEARNHOUSE-API-8A/8C did in production;
- too broad and a per-minute rate limit becomes terminal, which kills retry
  everywhere — one RPM 429 would then abort a whole course re-index
  (rag/embedding_service.generate_embeddings) and fail a user's image click that
  a 1.5s backoff used to clear.

The bodies below are the shapes google-genai stringifies into the exception
message. Gemini answers 429 RESOURCE_EXHAUSTED with the *same* "check your plan
and billing details" sentence for a per-minute limit and for a spent balance, so
only the QuotaFailure violation (PerMinute... vs PerDay...) or explicit balance
wording can separate them.
"""

import asyncio

import pytest

from src.services.ai.llm.provider import (
    AIQuotaExhaustedError,
    is_quota_exhausted,
    is_rate_limited,
    provider_error_label,
    provider_status_code,
    translate_provider_errors,
)


class _GenAIError(Exception):
    """Shape of google.genai.errors.APIError: numeric ``code`` + body in str()."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class _ModelHTTPError(Exception):
    """Shape of pydantic_ai.exceptions.ModelHTTPError: ``status_code`` + body."""

    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


# Verbatim from LEARNHOUSE-API-8C/-8A in production (google-genai renders
# APIError as "{code} {status}. {response_json}"), so the marker below is
# matched against the string Google really sends, not a paraphrase of it.
_QUOTA_BODY = (
    "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'Your "
    "prepayment credits are depleted. Please go to AI Studio at "
    "https://ai.studio/projects to manage your project and billing.', "
    "'status': 'RESOURCE_EXHAUSTED'}}"
)


def _gemini_429(quota_id: str) -> str:
    """A real google-genai 429 body, parameterised by the violated quota."""
    return (
        "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'You exceeded "
        "your current quota, please check your plan and billing details. For more "
        "information on this error, head to: "
        "https://ai.google.dev/gemini-api/docs/rate-limits.', 'status': "
        "'RESOURCE_EXHAUSTED', 'details': [{'@type': "
        "'type.googleapis.com/google.rpc.QuotaFailure', 'violations': "
        "[{'quotaMetric': "
        "'generativelanguage.googleapis.com/generate_content_free_tier_requests', "
        "'quotaId': '" + quota_id + "', 'quotaValue': '15'}]}, {'@type': "
        "'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '31s'}]}}"
    )


# The two quotas Gemini reports through the identical status and sentence.
_RPM_BODY = _gemini_429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")
_RPD_BODY = _gemini_429("GenerateRequestsPerDayPerProjectPerModel-FreeTier")


# --- provider_status_code ---

def test_status_code_reads_both_sdk_spellings():
    assert provider_status_code(_GenAIError(429, "x")) == 429
    assert provider_status_code(_ModelHTTPError(503, "x")) == 503
    assert provider_status_code(RuntimeError("x")) is None


def test_status_code_ignores_non_int_codes():
    exc = RuntimeError("x")
    exc.code = "RESOURCE_EXHAUSTED"  # some SDKs put the *status string* in .code
    assert provider_status_code(exc) is None


# --- is_quota_exhausted ---

def test_quota_429_with_billing_body_is_terminal():
    assert is_quota_exhausted(_GenAIError(429, _QUOTA_BODY)) is True
    assert is_quota_exhausted(_ModelHTTPError(429, _QUOTA_BODY)) is True


def test_gemini_per_minute_429_is_retryable_not_terminal():
    """The regression that matters: an RPM 429 must not stop the retry loops.

    This is the body Gemini really sends for a per-minute limit — note it says
    "quota", says "billing details" and is RESOURCE_EXHAUSTED, so any of those
    three used as a marker makes every burst limit terminal.
    """
    exc = _GenAIError(429, _RPM_BODY)
    assert is_quota_exhausted(exc) is False
    assert is_rate_limited(exc) is True


def test_gemini_per_day_429_is_not_treated_as_depletion():
    """A daily cap is a longer window, not a spent balance.

    Deliberate: "terminal" is defined by the balance wording alone, and by the
    same list app.py's before_send uses to rate-limit depletion captures. Left
    in, the two rules would disagree about this body. The cost of retrying it is
    bounded — MAX_RETRIES attempts, then an ordinary ERROR that reaches Sentry.
    """
    exc = _GenAIError(429, _RPD_BODY)
    assert is_quota_exhausted(exc) is False
    assert is_rate_limited(exc) is True


def test_bare_resource_exhausted_is_retryable():
    """No depletion evidence in the body => retryable. Undecidable != terminal."""
    assert is_quota_exhausted(_GenAIError(429, "429 RESOURCE_EXHAUSTED.")) is False
    assert is_quota_exhausted(_ModelHTTPError(429, "rate limit exceeded")) is False


def test_openai_style_depletion_is_terminal():
    exc = _ModelHTTPError(
        429,
        "{'error': {'code': 'insufficient_quota', 'message': 'You exceeded your "
        "current quota.'}}",
    )
    assert is_quota_exhausted(exc) is True


def test_5xx_is_not_terminal():
    assert is_quota_exhausted(_GenAIError(503, "503 UNAVAILABLE. overloaded")) is False
    # ...even when the body happens to mention quota — the status decides first.
    assert is_quota_exhausted(_GenAIError(500, "quota subsystem error")) is False


def test_already_typed_error_stays_terminal():
    assert is_quota_exhausted(AIQuotaExhaustedError("x")) is True


# --- provider_error_label ---

def test_label_is_stable_and_leaks_nothing():
    label = provider_error_label(_GenAIError(429, _QUOTA_BODY))
    assert label == "_GenAIError(429)"
    # The provider body is what made the Sentry title churn; it must not appear.
    assert "prepayment" not in label
    assert provider_error_label(RuntimeError("boom")) == "RuntimeError"


# --- translate_provider_errors ---

def test_translate_lifts_quota_refusal():
    with pytest.raises(AIQuotaExhaustedError) as excinfo:
        with translate_provider_errors():
            raise _GenAIError(429, _QUOTA_BODY)
    # The provider's own text is dropped: it can embed the request URL/API key.
    assert str(excinfo.value) == "AI provider quota exhausted"
    assert isinstance(excinfo.value.__cause__, _GenAIError)


def test_translate_passes_everything_else_through_untouched():
    # The RPM 429 is the load-bearing member of this list: lifted to
    # AIQuotaExhaustedError, every caller's retry loop would treat a limit that
    # clears in 31 seconds as permanent.
    for exc in (
        _GenAIError(429, _RPM_BODY),
        _GenAIError(503, "overloaded"),
        ValueError("nope"),
    ):
        with pytest.raises(type(exc)):
            with translate_provider_errors():
                raise exc


def test_translate_is_idempotent():
    with pytest.raises(AIQuotaExhaustedError):
        with translate_provider_errors():
            with translate_provider_errors():
                raise _GenAIError(429, _QUOTA_BODY)


# --- streaming: generate_stream yields from inside the context manager, so the
# client-disconnect paths must pass straight through it. ---


async def _guarded_stream():
    with translate_provider_errors():
        for i in range(100):
            yield i


@pytest.mark.asyncio
async def test_abandoned_stream_closes_cleanly():
    stream = _guarded_stream()
    assert await stream.__anext__() == 0
    await stream.aclose()  # GeneratorExit must not be swallowed or re-raised


@pytest.mark.asyncio
async def test_cancellation_propagates():
    stream = _guarded_stream()
    await stream.__anext__()

    async def drain():
        async for _ in stream:
            await asyncio.sleep(1)

    task = asyncio.create_task(drain())
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
