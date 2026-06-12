"""Provider-agnostic model factory built on Pydantic AI.

`build_model()` reads the global AI config (provider + api_key + base_url) and returns a
configured Pydantic AI ``Model``. Switching providers is a config change only — no business
logic touches a vendor SDK. Embeddings are intentionally NOT handled here: they stay on
Gemini (see ``src/services/ai/rag/embedding_service.py``).
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
_OPENAI_ALIASES = {"openai", "openai-compatible", "azure", "openrouter", "together"}


class AINotConfiguredError(Exception):
    """Raised when the configured AI provider is missing its API key."""


def build_model(model_name: str) -> Model:
    """Build a Pydantic AI ``Model`` for ``model_name`` using the global AI config.

    Provider SDKs are imported lazily so an unused/uninstalled provider never breaks import.
    """
    cfg = get_learnhouse_config().ai_config
    provider_id = (getattr(cfg, "provider", None) or DEFAULT_PROVIDER).strip().lower()
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

    if provider_id == "groq":
        from pydantic_ai.models.groq import GroqModel
        from pydantic_ai.providers.groq import GroqProvider

        return GroqModel(model_name, provider=GroqProvider(api_key=api_key))

    if provider_id == "mistral":
        from pydantic_ai.models.mistral import MistralModel
        from pydantic_ai.providers.mistral import MistralProvider

        return MistralModel(model_name, provider=MistralProvider(api_key=api_key))

    raise AINotConfiguredError(f"Unsupported AI provider '{provider_id}'")
