"""
Embedding service for RAG.

Uses google-genai for embeddings (text-embedding-004) and
llama-index-core SentenceSplitter for chunking.
"""

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


def chunk_text(text: str) -> list[str]:
    """Split text into chunks using LlamaIndex SentenceSplitter."""
    from llama_index.core.node_parser import SentenceSplitter

    splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
    chunks = splitter.split_text(text)
    return chunks


def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using Gemini text-embedding-004.
    Processes in batches to respect rate limits.
    """
    client = get_gemini_client()
    all_embeddings = []

    for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[i:i + EMBEDDING_BATCH_SIZE]
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=batch,
            config={"output_dimensionality": EMBEDDING_DIMENSIONS},
        )
        # result.embeddings is a list of EmbeddingObject with .values
        for emb in result.embeddings:
            all_embeddings.append(list(emb.values))

        # Small delay between batches for rate limiting
        if i + EMBEDDING_BATCH_SIZE < len(texts):
            import time
            time.sleep(BATCH_DELAY_SECONDS)

    return all_embeddings


def embed_single_text(text: str) -> list[float]:
    """Generate embedding for a single text."""
    client = get_gemini_client()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=[text],
        config={"output_dimensionality": EMBEDDING_DIMENSIONS},
    )
    return list(result.embeddings[0].values)


def embed_course_content(
    course_id: int,
    org_id: int,
    db_session: Session,
) -> int:
    """
    Index all content from a course into embeddings.

    1. Delete existing embeddings for this course
    2. Extract all content
    3. Chunk each document
    4. Batch embed
    5. Insert CourseEmbedding records
    6. Return chunk count

    Returns the number of chunks indexed.
    """
    # Delete existing embeddings for this course
    existing = db_session.exec(
        select(CourseEmbedding).where(CourseEmbedding.course_id == course_id)
    ).all()
    for emb in existing:
        db_session.delete(emb)
    db_session.commit()

    # Extract all content
    content_items = extract_all_course_content(course_id, org_id, db_session)
    if not content_items:
        logger.info("No content to index for course %d", course_id)
        return 0

    # Chunk each content item and prepare for embedding
    chunks_to_embed = []  # (text, metadata)
    for item in content_items:
        text = item["text"]
        if not text.strip():
            continue
        chunks = chunk_text(text)
        for idx, chunk in enumerate(chunks):
            chunks_to_embed.append((chunk, {**item, "chunk_index": idx}))

    if not chunks_to_embed:
        logger.info("No chunks generated for course %d", course_id)
        return 0

    # Generate embeddings in batches
    texts = [c[0] for c in chunks_to_embed]
    embeddings = generate_embeddings(texts)

    # Insert CourseEmbedding records
    now = str(datetime.now())
    for (chunk_text_val, metadata), embedding in zip(chunks_to_embed, embeddings):
        record = CourseEmbedding(
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
        db_session.add(record)

    db_session.commit()

    logger.info(
        "Indexed %d chunks for course %d (org %d)",
        len(chunks_to_embed), course_id, org_id
    )
    return len(chunks_to_embed)
