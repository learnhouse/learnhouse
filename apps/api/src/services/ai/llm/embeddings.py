"""Provider-agnostic embeddings (Pydantic AI).

Embeddings follow the configured AI provider wherever that provider exposes an embeddings API
— Google and the OpenAI family (OpenAI, Azure, Together, and local Ollama). Fireworks AI
embeddings are opt-in only: they are used when the *embedding* provider is explicitly set to
``fireworks`` (``LEARNHOUSE_AI_EMBEDDING_PROVIDER``) together with an explicit embedding model
(no default). Providers without an embeddings API (Anthropic, DeepSeek, Moonshot, Mistral,
OpenRouter, Bedrock, and Fireworks when only the main ``provider`` is Fireworks) transparently
fall back to Google embeddings when ``gemini_api_key`` is set, otherwise a clear error is raised.

The output dimensionality is pinned (default 768) to match the ``Vector(768)`` pgvector column
in ``CourseEmbedding``. Changing ``embedding_dimensions`` requires migrating that column and
re-indexing existing courses. Switching the embedding provider or model also requires
re-indexing every course, since vectors from different models are not comparable.
"""

from __future__ import annotations

import logging

from pydantic_ai.embeddings import Embedder, EmbeddingModel, EmbeddingSettings

from config.config import get_learnhouse_config
from src.services.ai.llm.provider import (
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_PROVIDER,
    AINotConfiguredError,
    _GOOGLE_ALIASES,
    _OPENAI_ALIASES,
)

logger = logging.getLogger(__name__)

# Default dimensionality — matches Vector(768) in src/db/course_embeddings.py.
DEFAULT_EMBEDDING_DIMENSIONS = 768

# Per-provider default embedding model. All chosen to produce 768-dim vectors so the existing
# vector store keeps working out of the box.
_DEFAULT_EMBEDDING_MODEL = {
    "google": "gemini-embedding-001",
    "openai": "text-embedding-3-small",
    "ollama": "nomic-embed-text",
}


def embedding_dimensions() -> int:
    cfg = get_learnhouse_config().ai_config
    return getattr(cfg, "embedding_dimensions", None) or DEFAULT_EMBEDDING_DIMENSIONS


def _resolve_embedding_provider(cfg) -> str:
    """Embeddings follow `embedding_provider`, else the main `provider`, else the default."""
    explicit = (getattr(cfg, "embedding_provider", None) or "").strip().lower()
    if explicit:
        return explicit
    return (getattr(cfg, "provider", None) or "").strip().lower() or DEFAULT_PROVIDER


def build_embedding_model() -> EmbeddingModel:
    """Build a Pydantic AI ``EmbeddingModel`` for the configured (embedding) provider."""
    cfg = get_learnhouse_config().ai_config
    prov = _resolve_embedding_provider(cfg)
    main_provider = (getattr(cfg, "provider", None) or "").strip().lower() or DEFAULT_PROVIDER
    api_key = getattr(cfg, "api_key", None)
    base_url = getattr(cfg, "base_url", None) or None
    model_name = getattr(cfg, "embedding_model", None)
    settings = EmbeddingSettings(dimensions=embedding_dimensions())

    if prov in _GOOGLE_ALIASES:
        from pydantic_ai.embeddings.google import GoogleEmbeddingModel
        from pydantic_ai.providers.google import GoogleProvider

        # Use the main api_key only when the main provider is also Google; otherwise the
        # dedicated gemini_api_key carries the Google credentials.
        key = getattr(cfg, "gemini_api_key", None) or (api_key if main_provider in _GOOGLE_ALIASES else None)
        if not key:
            raise AINotConfiguredError(
                "Google embeddings require an API key (set LEARNHOUSE_GEMINI_API_KEY)."
            )
        return GoogleEmbeddingModel(
            model_name or _DEFAULT_EMBEDDING_MODEL["google"],
            provider=GoogleProvider(api_key=key),
            settings=settings,
        )

    # Fireworks embeddings are opt-in: only when the embedding provider is explicitly
    # "fireworks" (not merely inherited from a Fireworks main provider), and the model must be
    # chosen explicitly.
    if (getattr(cfg, "embedding_provider", None) or "").strip().lower() == "fireworks":
        from pydantic_ai.embeddings.openai import OpenAIEmbeddingModel
        from pydantic_ai.providers.fireworks import FireworksProvider

        if not model_name:
            raise AINotConfiguredError(
                "Fireworks embeddings require an explicit model (set LEARNHOUSE_AI_EMBEDDING_MODEL, "
                "e.g. 'accounts/fireworks/models/qwen3-embedding-8b')."
            )
        if not api_key:
            raise AINotConfiguredError(
                "Fireworks embeddings require an API key (set LEARNHOUSE_AI_API_KEY)."
            )
        return OpenAIEmbeddingModel(
            model_name,
            provider=FireworksProvider(api_key=api_key),
            settings=settings,
        )

    if prov == "ollama":
        from pydantic_ai.embeddings.openai import OpenAIEmbeddingModel
        from pydantic_ai.providers.ollama import OllamaProvider

        return OpenAIEmbeddingModel(
            model_name or _DEFAULT_EMBEDDING_MODEL["ollama"],
            provider=OllamaProvider(base_url=base_url or DEFAULT_OLLAMA_BASE_URL),
            settings=settings,
        )

    if prov in _OPENAI_ALIASES:
        from pydantic_ai.embeddings.openai import OpenAIEmbeddingModel
        from pydantic_ai.providers.openai import OpenAIProvider

        if not api_key:
            raise AINotConfiguredError(
                "OpenAI embeddings require an API key (set LEARNHOUSE_AI_API_KEY)."
            )
        return OpenAIEmbeddingModel(
            model_name or _DEFAULT_EMBEDDING_MODEL["openai"],
            provider=OpenAIProvider(api_key=api_key, base_url=base_url),
            settings=settings,
        )

    # Providers without an embeddings API (anthropic, deepseek, moonshot, mistral, openrouter,
    # bedrock, and fireworks unless it is the explicit embedding provider): fall back to Google embeddings when a Gemini key is available.
    gemini_key = getattr(cfg, "gemini_api_key", None)
    if gemini_key:
        from pydantic_ai.embeddings.google import GoogleEmbeddingModel
        from pydantic_ai.providers.google import GoogleProvider

        logger.info(
            "Provider '%s' has no embeddings API; using Google embeddings for RAG.", prov
        )
        return GoogleEmbeddingModel(
            model_name or _DEFAULT_EMBEDDING_MODEL["google"],
            provider=GoogleProvider(api_key=gemini_key),
            settings=settings,
        )

    raise AINotConfiguredError(
        f"Provider '{prov}' has no embeddings API. Set LEARNHOUSE_AI_EMBEDDING_PROVIDER to "
        "'google', 'openai', or 'ollama' (with its credentials), or set LEARNHOUSE_GEMINI_API_KEY "
        "to use Google embeddings for RAG."
    )


def _embedder() -> Embedder:
    return Embedder(build_embedding_model())


def _check_dimensions(vectors: list[list[float]]) -> list[list[float]]:
    """Ensure every vector matches the pinned pgvector column size before it is stored/queried."""
    expected = embedding_dimensions()
    for vec in vectors:
        if len(vec) != expected:
            cfg = get_learnhouse_config().ai_config
            raise AINotConfiguredError(
                f"Embedding dimension mismatch: expected {expected}, got {len(vec)} "
                f"(provider={_resolve_embedding_provider(cfg)!r}, "
                f"model={getattr(cfg, 'embedding_model', None) or 'default'!r}). The "
                "course_embedding column is pinned to 768 dimensions; use a model that supports "
                "a configurable output size and set LEARNHOUSE_AI_EMBEDDING_DIMENSIONS to match."
            )
    return vectors


async def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a batch of documents; returns one vector per input."""
    result = await _embedder().embed(texts, input_type="document")
    return _check_dimensions([list(v) for v in result.embeddings])


async def embed_query(text: str) -> list[float]:
    """Embed a single query string."""
    result = await _embedder().embed(text, input_type="query")
    return _check_dimensions([list(result.embeddings[0])])[0]
