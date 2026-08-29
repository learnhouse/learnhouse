"""Provider-agnostic model factory built on Pydantic AI.

`build_model()` reads the global AI config (provider + api_key + base_url) and returns a
configured Pydantic AI ``Model``. Switching providers is a config change only — no business
logic touches a vendor SDK. Embeddings are handled provider-agnostically in ``embeddings.py``.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Optional

from pydantic_ai.models import Model

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

# When no provider is configured we default to Google so existing Gemini-only
# deployments keep working with no config change.
DEFAULT_PROVIDER = "google"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1"

_GOOGLE_ALIASES = {"google", "google-gla", "gemini"}
# Providers that speak the OpenAI Chat Completions API (incl. local/compatible servers).
# `openrouter` has its own branch (it auto-configures its base URL), so it's not listed here.
_OPENAI_ALIASES = {"openai", "openai-compatible", "azure", "together"}


class AINotConfiguredError(Exception):
    """Raised when the configured AI provider is missing its API key."""


class AIQuotaExhaustedError(Exception):
    """Raised when the provider refused the call for quota/billing reasons.

    Terminal, unlike the transient 429 a burst limiter returns: a depleted
    prepay balance or an exhausted daily quota cannot succeed on retry, only
    an admin topping the account up fixes it. Every retry loop must treat this
    as a stop signal, and routers should surface it as an actionable 429 rather
    than a "the server is broken" 5xx.
    """


# The one user-facing explanation of AIQuotaExhaustedError, kept next to the
# exception so every surface (SSE error frame, HTTP detail) says the same thing
# and none of them leak the provider's own message.
AI_QUOTA_USER_MESSAGE = (
    "AI generation is temporarily unavailable: the AI provider quota is "
    "exhausted. Please contact your administrator."
)

# A 429 is NOT enough to call a refusal terminal, and neither is the word
# "quota": providers return 429 for two states that need opposite handling.
#
#   * a burst / per-minute rate limit — clears in seconds, must be retried
#   * a spent balance or an exhausted per-day cap — no retry can fix it,
#     only an admin topping the account up
#
# Google returns ``429 RESOURCE_EXHAUSTED`` for BOTH, with the same sentence in
# the body ("You exceeded your current quota, please check your plan and
# billing details"), so neither the status, nor "resource_exhausted", nor a
# bare "quota"/"billing" substring can separate them — matching on those makes
# every RPM blip terminal and silently kills retry across the whole app.
# What does separate them is the QuotaFailure violation Google attaches
# (``quotaId: ...PerDayPerProject...`` vs ``...PerMinutePerProject...``) and
# the explicit balance wording other providers use.
#
# So the markers are the *balance* wording and nothing else. A cap on a longer
# window (a free-tier per-day quota) is deliberately left out: it is not a spent
# balance, and the cost of getting it "wrong" is bounded — three attempts and
# then an ordinary provider error at ERROR, which still reaches Sentry.
#
# Price that cost honestly, because it is not only log lines. Every retried
# attempt raises out of the google-genai SDK, and the Sentry google_genai
# integration captures at that boundary, before any handler of ours runs. So a
# 429 that carries no balance wording (a bare RESOURCE_EXHAUSTED, a per-minute
# limiter, a per-day cap) still costs one unhandled Sentry event per attempt —
# three per image request, three per embedding batch — and app.py's before_send
# will not throttle them, since its depletion rule matches the markers above.
# That is unchanged from before this narrowing (both loops already retried 429),
# and it is bounded, but it means the depletion issues stay open: this file only
# makes the *depleted-balance* case quiet, it does not stop 429s from paging.
#
# app.py's `_QUOTA_DEPLETED_MARKERS` (the before_send rule that rate-limits
# depletion captures) is the same list by design: if one file called a body
# depletion and the other did not, an error the app handled cleanly would still
# open an issue, or a real outage would be dropped. Keep the two in step —
# app.py can import this tuple.
QUOTA_DEPLETION_MARKERS = (
    "credits are depleted",   # Gemini prepay balance spent (LEARNHOUSE-API-8A/8C)
    "insufficient_quota",     # OpenAI
    "insufficient quota",
    "billing account",        # GCP: "billing account ... is disabled/closed"
    "billing limit",          # OpenRouter/Anthropic-style spend caps
)


def provider_status_code(exc: BaseException) -> Optional[int]:
    """HTTP status carried by a provider exception, whatever the SDK named it.

    ``google.genai`` errors expose ``code``; pydantic-ai's ``ModelHTTPError``
    exposes ``status_code``. Duck-typing both keeps this usable without
    importing (and hard-depending on) either SDK.
    """
    for attr in ("status_code", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    return None


def provider_error_label(exc: BaseException) -> str:
    """Short, stable, secret-free description of a provider failure.

    Used in log messages instead of ``str(exc)``: the provider's message embeds
    its JSON body (and the traceback can embed the request URL, hence the API
    key), and interpolating it makes the Sentry issue title change on every
    distinct body — which fragments grouping.
    """
    code = provider_status_code(exc)
    return f"{type(exc).__name__}({code})" if code is not None else type(exc).__name__


def is_quota_exhausted(exc: BaseException) -> bool:
    """True only for a *terminal* refusal: the balance or the daily cap is spent.

    Requires a 429 **and** an explicit depletion marker (see
    ``QUOTA_DEPLETION_MARKERS``). A 429 whose body says nothing about a spent
    balance — a bare ``RESOURCE_EXHAUSTED``, a per-minute rate limit, a per-day
    cap — is deliberately *not* terminal, so the callers' retry loops keep
    riding those out.
    """
    if isinstance(exc, AIQuotaExhaustedError):
        return True
    if provider_status_code(exc) != 429:
        return False
    text = str(exc).lower()
    return any(marker in text for marker in QUOTA_DEPLETION_MARKERS)


def is_rate_limited(exc: BaseException) -> bool:
    """True for a 429 that is worth retrying (burst / per-minute limit).

    The complement of :func:`is_quota_exhausted` within the 429 status, spelled
    out so callers do not re-derive "429 but not terminal" each time.
    """
    return provider_status_code(exc) == 429 and not is_quota_exhausted(exc)


@contextmanager
def translate_provider_errors():
    """Lift a terminal provider quota refusal into ``AIQuotaExhaustedError``.

    Wrap every outbound provider call in this so retry loops and routers can
    classify on an exception *type* instead of each re-sniffing SDK internals.
    The provider's own message is deliberately dropped: it can embed the
    request URL, and therefore the API key.
    """
    try:
        yield
    except AIQuotaExhaustedError:
        raise
    except Exception as exc:  # noqa: BLE001 — re-raised unless it is a quota refusal
        if is_quota_exhausted(exc):
            raise AIQuotaExhaustedError("AI provider quota exhausted") from exc
        raise


def build_model(model_name: str) -> Model:
    """Build a Pydantic AI ``Model`` for ``model_name`` using the global AI config.

    Provider SDKs are imported lazily so an unused/uninstalled provider never breaks import.
    """
    lh_config = get_learnhouse_config()
    cfg = lh_config.ai_config
    # Treat None / empty / whitespace-only as "unset" and fall back to the default provider.
    provider_id = (getattr(cfg, "provider", None) or "").strip().lower() or DEFAULT_PROVIDER
    api_key = getattr(cfg, "api_key", None)
    base_url = getattr(cfg, "base_url", None) or None  # treat "" as unset

    # Ollama (and other local OpenAI-compatible servers) need no real key.
    if provider_id == "ollama":
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.ollama import OllamaProvider

        return OpenAIChatModel(
            model_name,
            provider=OllamaProvider(base_url=base_url or DEFAULT_OLLAMA_BASE_URL),
        )

    # AWS Bedrock: credentials come from the standard AWS chain (env vars, IAM role, or
    # `~/.aws` profile) + AWS_REGION, so no LEARNHOUSE_AI_API_KEY is required. If one is set
    # it is passed through as a Bedrock API key. Model names are Bedrock model IDs, e.g.
    # "anthropic.claude-sonnet-4-5-20250929-v1:0" or "us.anthropic.claude-...".
    if provider_id == "bedrock":
        from pydantic_ai.models.bedrock import BedrockConverseModel
        from pydantic_ai.providers.bedrock import BedrockProvider

        provider_kwargs = {}
        if api_key:
            provider_kwargs["api_key"] = api_key
        return BedrockConverseModel(model_name, provider=BedrockProvider(**provider_kwargs))

    # The google provider falls back to the legacy gemini_api_key so upgrades are seamless.
    if provider_id in _GOOGLE_ALIASES and not api_key:
        api_key = getattr(cfg, "gemini_api_key", None)

    if not api_key:
        raise AINotConfiguredError(
            "AI provider API key not configured (set LEARNHOUSE_AI_API_KEY)"
        )

    if provider_id in _GOOGLE_ALIASES:
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        return GoogleModel(model_name, provider=GoogleProvider(api_key=api_key))

    # OpenRouter: an OpenAI-compatible gateway to many models. Its provider auto-configures
    # the base URL, so users only set provider + api_key + a model slug (e.g.
    # "anthropic/claude-sonnet-4-5", "openai/gpt-4o-mini"). app_title gives dashboard attribution.
    if provider_id == "openrouter":
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openrouter import OpenRouterProvider

        return OpenAIChatModel(
            model_name,
            provider=OpenRouterProvider(
                api_key=api_key,
                app_title=getattr(lh_config, "site_name", None) or "LearnHouse",
            ),
        )

    if provider_id in _OPENAI_ALIASES:
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        return OpenAIChatModel(
            model_name, provider=OpenAIProvider(api_key=api_key, base_url=base_url)
        )

    if provider_id == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(model_name, provider=AnthropicProvider(api_key=api_key))

    # DeepSeek (Chinese) — OpenAI-compatible; provider auto-configures api.deepseek.com.
    if provider_id == "deepseek":
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.deepseek import DeepSeekProvider

        return OpenAIChatModel(model_name, provider=DeepSeekProvider(api_key=api_key))

    # Moonshot AI / Kimi (Chinese) — OpenAI-compatible; auto-configures api.moonshot.ai.
    if provider_id in ("moonshot", "moonshotai", "kimi"):
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.moonshotai import MoonshotAIProvider

        return OpenAIChatModel(model_name, provider=MoonshotAIProvider(api_key=api_key))

    if provider_id == "mistral":
        from pydantic_ai.models.mistral import MistralModel
        from pydantic_ai.providers.mistral import MistralProvider

        return MistralModel(model_name, provider=MistralProvider(api_key=api_key))

    raise AINotConfiguredError(f"Unsupported AI provider '{provider_id}'")
