"""Provider-agnostic LLM layer (Pydantic AI).

The single entry point for AI text generation across the backend. Business code calls
``generate`` / ``generate_stream`` with a resolved model name; the active provider is chosen
entirely by configuration (``ai_config.provider`` + ``api_key``). Embeddings are out of scope
here and stay on Gemini (see ``src/services/ai/rag/embedding_service.py``).
"""

from src.services.ai.llm.client import (
    attachments_to_parts,
    generate,
    generate_stream,
    to_message_history,
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
    "AINotConfiguredError",
    "model_for_tier",
    "resolve_model_for_org",
]
