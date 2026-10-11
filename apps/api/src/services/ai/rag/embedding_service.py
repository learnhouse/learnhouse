"""
Embedding primitives for RAG (chunking and provider calls). Indexing itself
lives in ``pipeline``.

Embeddings are provider-agnostic: they follow the configured AI provider through the shared
``src.services.ai.llm.embeddings`` layer (Google, OpenAI family incl. Ollama; other providers
fall back to Google). Output is pinned to 768 dims to match the Vector(768) pgvector column.
Uses local sentence-aware token chunking without downloading language models.
"""

import asyncio
import logging

from src.services.ai.llm.embeddings import (
    DEFAULT_EMBEDDING_DIMENSIONS,
    embed_documents,
    embed_query,
)
from src.services.ai.rag.text_chunking import split_text

logger = logging.getLogger(__name__)

CHUNK_SIZE = 512
CHUNK_OVERLAP = 50
EMBEDDING_DIMENSIONS = DEFAULT_EMBEDDING_DIMENSIONS  # Must match Vector(768) in CourseEmbedding
EMBEDDING_BATCH_SIZE = 100
BATCH_DELAY_SECONDS = 0.5
MAX_RETRIES = 3


def chunk_text(text: str) -> list[str]:
    """Split source text into bounded chunks for new embedding ingestions."""
    return split_text(text, CHUNK_SIZE, CHUNK_OVERLAP)


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of texts via the configured provider.
    Batches inputs and retries transient failures with exponential backoff.
    """
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[i:i + EMBEDDING_BATCH_SIZE]

        for attempt in range(MAX_RETRIES):
            try:
                all_embeddings.extend(await embed_documents(batch))
                break
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    logger.error("Embedding failed after %d attempts: %s", MAX_RETRIES, e)
                    raise
                wait = 2 ** attempt
                logger.warning(
                    "Embedding attempt %d/%d failed, retrying in %ds: %s",
                    attempt + 1, MAX_RETRIES, wait, e,
                )
                await asyncio.sleep(wait)

        if i + EMBEDDING_BATCH_SIZE < len(texts):
            await asyncio.sleep(BATCH_DELAY_SECONDS)

    return all_embeddings


async def embed_single_text(text: str) -> list[float]:
    """Generate embedding for a single text (query), with retry."""
    for attempt in range(MAX_RETRIES):
        try:
            return await embed_query(text)
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                logger.error("Single embedding failed after %d attempts: %s", MAX_RETRIES, e)
                raise
            await asyncio.sleep(2 ** attempt)
    raise RuntimeError("unreachable")
