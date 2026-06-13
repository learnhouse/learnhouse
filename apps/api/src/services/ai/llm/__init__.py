"""Provider-agnostic LLM layer (Pydantic AI).

The single entry point for AI across the backend. Business code calls ``generate`` /
``generate_stream`` for text and ``embed_documents`` / ``embed_query`` for embeddings; the
active provider is chosen entirely by configuration (``ai_config.provider`` + ``api_key``).
Embeddings follow the same provider where supported (see ``embeddings.py``).
"""

from src.services.ai.llm.client import (
    attachments_to_parts,
    generate,
    generate_stream,
    to_message_history,
)
from src.services.ai.llm.embeddings import (
    build_embedding_model,
    embed_documents,
    embed_query,
    embedding_dimensions,
)
from src.services.ai.llm.provider import AINotConfiguredError, build_model
from src.services.ai.llm.tiers import (
    model_for_tier,
    resolve_model_for_org,
)

__all__ = [
    "generate",
    "generate_stream",
    "to_message_history",
    "attachments_to_parts",
    "build_model",
    "build_embedding_model",
    "embed_documents",
    "embed_query",
    "embedding_dimensions",
    "AINotConfiguredError",
    "model_for_tier",
    "resolve_model_for_org",
]
