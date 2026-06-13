"""Provider-agnostic model factory built on Pydantic AI.

`build_model()` reads the global AI config (provider + api_key + base_url) and returns a
configured Pydantic AI ``Model``. Switching providers is a config change only — no business
logic touches a vendor SDK. Embeddings are handled provider-agnostically in ``embeddings.py``.
"""

from __future__ import annotations

import logging

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
