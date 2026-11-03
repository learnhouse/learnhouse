"""Telling AI provider quota errors apart from real failures.

When the provider refuses a request because a rate limit, quota, spending cap
or prepaid credit balance is exhausted, nothing in LearnHouse is broken: the
deployment has to wait or top up. Callers log these as warnings, tell the user
AI is unavailable, and keep them out of error reporting.
"""

from __future__ import annotations

import logging
from typing import Iterator, Optional

from pydantic_ai.exceptions import ModelQuotaExceededError, ModelRateLimitError
from starlette.exceptions import HTTPException

AI_QUOTA_MESSAGE = "AI is temporarily unavailable: the AI usage limit has been reached. Please try again later."

# How providers word a limit that waiting will not lift (Gemini's spending cap
# and prepaid credits, OpenAI's insufficient_quota).
_SPEND_CAP_MARKERS = ("spending cap", "spend cap", "credits are depleted", "insufficient_quota")


def _chain(exc: Optional[BaseException]) -> Iterator[BaseException]:
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        yield exc
        exc = exc.__cause__ or exc.__context__


def _is_429(exc: BaseException) -> bool:
    if isinstance(exc, (ModelRateLimitError, ModelQuotaExceededError)):
        return True
    if isinstance(exc, HTTPException):
        # Our own per-user rate limiting, not the provider's.
        return False
    # google.genai errors carry the status as `code`, SDK HTTP errors as `status_code`.
    return 429 in (getattr(exc, "status_code", None), getattr(exc, "code", None))


def is_quota_error(exc: Optional[BaseException]) -> bool:
    """True if ``exc``, or any exception it was raised from, is a provider 429."""
    return any(_is_429(e) for e in _chain(exc))


def is_spend_cap_error(exc: Optional[BaseException]) -> bool:
    """True for a quota error that retrying will not fix."""
    for e in _chain(exc):
        if isinstance(e, ModelQuotaExceededError):
            return True
        if _is_429(e) and any(marker in str(e).lower() for marker in _SPEND_CAP_MARKERS):
            return True
    return False


def log_ai_failure(log: logging.Logger, exc: BaseException, message: str, *args) -> None:
    """Log a failed AI call: a warning for a provider quota error, an error with
    its traceback for anything else."""
    if is_quota_error(exc):
        log.warning(message + " (AI provider quota reached): %s", *args, exc)
    else:
        log.error(message, *args, exc_info=exc)


def ai_error_message(exc: BaseException, default: str) -> str:
    """The message to show the user for a failed AI call."""
    return AI_QUOTA_MESSAGE if is_quota_error(exc) else default
