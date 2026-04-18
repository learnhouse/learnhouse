"""
Embedding service for RAG.

Uses google-genai for embeddings (text-embedding-004) and
llama-index-core SentenceSplitter for chunking.
"""

import asyncio
import logging
from datetime import datetime

from sqlmodel import Session, select

from src.db.course_embeddings import CourseEmbedding
from src.services.ai.base import get_gemini_client
from src.services.ai.rag.content_extraction import extract_all_course_content

logger = logging.getLogger(__name__)

CHUNK_SIZE = 512
CHUNK_OVERLAP = 50
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768  # Must match Vector(768) in CourseEmbedding model
EMBEDDING_BATCH_SIZE = 100
BATCH_DELAY_SECONDS = 0.5
MAX_RETRIES = 3


def chunk_text(text: str) -> list[str]:
    """Split text into chunks using LlamaIndex SentenceSplitter."""
    from llama_index.core.node_parser import SentenceSplitter

    splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
    chunks = splitter.split_text(text)
    return chunks


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using Gemini.
    Runs blocking Gemini calls off the event loop via asyncio.to_thread
    and retries transient failures with exponential backoff.
    """
    client = get_gemini_client()
    all_embeddings = []

    for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[i:i + EMBEDDING_BATCH_SIZE]

        for attempt in range(MAX_RETRIES):
            try:
                result = await asyncio.to_thread(
                    client.models.embed_content,
                    model=EMBEDDING_MODEL,
                    contents=batch,
                    config={"output_dimensionality": EMBEDDING_DIMENSIONS},
                )
                for emb in result.embeddings:
                    all_embeddings.append(list(emb.values))
                break
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    logger.error("Gemini embedding failed after %d attempts: %s", MAX_RETRIES, e)
                    raise
                wait = 2 ** attempt
                logger.warning(
                    "Gemini embedding attempt %d/%d failed, retrying in %ds: %s",
                    attempt + 1, MAX_RETRIES, wait, e,
                )
                await asyncio.sleep(wait)

        if i + EMBEDDING_BATCH_SIZE < len(texts):
            await asyncio.sleep(BATCH_DELAY_SECONDS)

    return all_embeddings


async def embed_single_text(text: str) -> list[float]:
    """Generate embedding for a single text, with retry."""
    client = get_gemini_client()
    for attempt in range(MAX_RETRIES):
        try:
            result = await asyncio.to_thread(
                client.models.embed_content,
                model=EMBEDDING_MODEL,
                contents=[text],
                config={"output_dimensionality": EMBEDDING_DIMENSIONS},
            )
            return list(result.embeddings[0].values)
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                logger.error("Gemini single embedding failed after %d attempts: %s", MAX_RETRIES, e)
                raise
            await asyncio.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


async def embed_course_content(
    course_id: int,
    org_id: int,
    db_session: Session,
) -> int:
    """
    Index all content from a course into embeddings.

    Generates new embeddings first, then atomically replaces old ones so a
    Gemini failure never leaves the course with zero searchable content.

    Returns the number of chunks indexed.
    """
    content_items = extract_all_course_content(course_id, org_id, db_session)
    if not content_items:
        logger.info("No content to index for course %d", course_id)
        return 0

    chunks_to_embed: list[tuple[str, dict]] = []
    for item in content_items:
        text = item["text"]
        if not text.strip():
            continue
        for idx, chunk in enumerate(chunk_text(text)):
            chunks_to_embed.append((chunk, {**item, "chunk_index": idx}))

    if not chunks_to_embed:
        logger.info("No chunks generated for course %d", course_id)
        return 0

    texts = [c[0] for c in chunks_to_embed]
    # Generate all embeddings before touching the DB — a Gemini failure here
    # leaves the existing embeddings intact rather than wiping them first.
    embeddings = await generate_embeddings(texts)

    now = str(datetime.now())
    new_records = [
        CourseEmbedding(
            org_id=org_id,
            course_id=course_id,
            activity_id=metadata.get("activity_id"),
            activity_uuid=metadata.get("activity_uuid", ""),
            block_uuid=metadata.get("block_uuid"),
            source_type=metadata.get("source_type", ""),
            chunk_text=chunk_text_val,
            chunk_index=metadata.get("chunk_index", 0),
            activity_name=metadata.get("activity_name", ""),
            chapter_name=metadata.get("chapter_name", ""),
            course_name=metadata.get("course_name", ""),
            embedding=embedding,
            creation_date=now,
            update_date=now,
        )
        for (chunk_text_val, metadata), embedding in zip(chunks_to_embed, embeddings)
    ]

    # Atomically swap old embeddings for new ones in a single commit.
    existing = db_session.exec(
        select(CourseEmbedding).where(CourseEmbedding.course_id == course_id)
    ).all()
    for emb in existing:
        db_session.delete(emb)
    for record in new_records:
        db_session.add(record)
    db_session.commit()

    logger.info(
        "Indexed %d chunks for course %d (org %d)",
        len(chunks_to_embed), course_id, org_id
    )
    return len(chunks_to_embed)
