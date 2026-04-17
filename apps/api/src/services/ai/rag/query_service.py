"""
RAG query service.

Handles vector similarity search and streaming LLM responses
grounded in course content.
"""

import logging
from typing import AsyncGenerator, Optional

from sqlalchemy import text
from sqlmodel import Session

from src.services.ai.rag.embedding_service import embed_single_text
from src.services.ai.base import ask_ai_stream

logger = logging.getLogger(__name__)

TOP_K = 5
GEMINI_MODEL = "gemini-2.5-flash"


async def query_course_rag(
    question: str,
    org_id: int,
    db_session: Session,
    course_id: Optional[int] = None,
    top_k: int = TOP_K,
) -> dict:
    """
    Retrieve relevant course content via vector similarity search.

    Args:
        question: The user's question
        org_id: Organization ID to scope the search
        course_id: Optional course ID to scope to a single course (None = all courses)
        db_session: Database session
        top_k: Number of results to return

    Returns:
        {context: str, sources: list[dict]}
    """
    # Embed the question
    query_embedding = await embed_single_text(question)

    # Build the similarity search query
    embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

    if course_id is not None:
        sql = text("""
            SELECT ce.id, ce.chunk_text, ce.activity_uuid, ce.activity_name,
                   ce.chapter_name, ce.course_name, ce.source_type, ce.block_uuid,
                   c.course_uuid,
                   ce.embedding <=> :query_embedding AS distance
            FROM course_embedding ce
            JOIN course c ON c.id = ce.course_id
            WHERE ce.org_id = :org_id AND ce.course_id = :course_id
            ORDER BY ce.embedding <=> :query_embedding
            LIMIT :top_k
        """)
        params = {
            "query_embedding": embedding_str,
            "org_id": org_id,
            "course_id": course_id,
            "top_k": top_k,
        }
    else:
        sql = text("""
            SELECT ce.id, ce.chunk_text, ce.activity_uuid, ce.activity_name,
                   ce.chapter_name, ce.course_name, ce.source_type, ce.block_uuid,
                   c.course_uuid,
                   ce.embedding <=> :query_embedding AS distance
            FROM course_embedding ce
            JOIN course c ON c.id = ce.course_id
            WHERE ce.org_id = :org_id
            ORDER BY ce.embedding <=> :query_embedding
            LIMIT :top_k
        """)
        params = {
            "query_embedding": embedding_str,
            "org_id": org_id,
            "top_k": top_k,
        }

    results = db_session.execute(sql, params).fetchall()

    if not results:
        return {"context": "", "sources": []}

    # Build numbered context and deduplicated source list
    context_parts = []
    sources = []
    seen_sources = {}  # source_key -> source index (1-based)
    source_index = 0

    for row in results:
        chunk_text = row.chunk_text
        activity_name = row.activity_name
        chapter_name = row.chapter_name
        course_name = row.course_name
        source_type = row.source_type

        # Deduplicate sources and assign a stable number
        source_key = (row.activity_uuid, row.source_type, row.block_uuid)
        if source_key not in seen_sources:
            source_index += 1
            seen_sources[source_key] = source_index
            sources.append({
                "activity_uuid": row.activity_uuid,
                "activity_name": activity_name,
                "chapter_name": chapter_name,
                "course_name": course_name,
                "course_uuid": row.course_uuid,
                "source_type": source_type,
            })

        ref_num = seen_sources[source_key]
        context_parts.append(f"[Source {ref_num}]\n{chunk_text}")

    context = "\n\n---\n\n".join(context_parts)
    return {"context": context, "sources": sources}


async def query_course_rag_stream(
    question: str,
    org_id: int,
    db_session: Session,
    message_history: list,
    course_id: Optional[int] = None,
    mode: str = "course_only",
) -> tuple[AsyncGenerator[str, None], list[dict]]:
    """
    Perform RAG retrieval and return a streaming LLM response.

    Returns:
        Tuple of (stream_generator, sources)
    """
    # Retrieve relevant context
    rag_result = await query_course_rag(
        question=question,
        org_id=org_id,
        db_session=db_session,
        course_id=course_id,
    )

    context = rag_result["context"]
    sources = rag_result["sources"]

    # Build the grounding prompt based on mode
    citation_instructions = (
        "IMPORTANT: When referencing information from the provided sources, use numbered citations "
        "like [1], [2], etc. matching the source numbers. Do NOT write out full source names, "
        "paths, locations, or verbose references like '(From: Course > Chapter > Activity)'. "
        "Just use the short [1] notation inline. Example: 'The building has 5 floors [2].'"
    )

    if context and mode == "general":
        system_prompt = (
            "You are a helpful, knowledgeable educational assistant. Answer the student's question "
            "thoroughly using both the course content provided below AND your own general knowledge. "
            "Treat the course content as your primary reference, but freely expand with additional "
            "context, explanations, examples, and insights from your training data. "
            "When you add information beyond the course material, wrap that part in a blockquote "
            "using the > prefix.\n\n"
            f"{citation_instructions}\n\n"
            f"Course Content:\n{context}"
        )
    elif context:
        # course_only mode (default)
        system_prompt = (
            "You are a helpful educational assistant. Answer the student's question "
            "based on the course content provided below.\n\n"
            f"{citation_instructions}\n\n"
            "SUPPLEMENTARY KNOWLEDGE: When you add any information that is NOT directly from the "
            "provided course content — even small additions, clarifications, or general context — "
            "you MUST wrap that part in a blockquote using the > prefix. Always do this, even for "
            "brief supplementary notes. Example:\n"
            "> This is additional context from general knowledge.\n\n"
            f"Course Content:\n{context}"
        )
    elif mode == "general":
        system_prompt = (
            "You are a helpful, knowledgeable educational assistant. No specific course content "
            "was found for this question, but that's fine — answer the student's question using "
            "your general knowledge. Be thorough and helpful."
        )
    else:
        system_prompt = (
            "You are a helpful educational assistant. The student asked a question but "
            "no relevant course content was found. Let them know you couldn't find "
            "specific course material related to their question, but offer to help "
            "with what you know."
        )

    # Create the streaming generator
    stream = ask_ai_stream(
        question=question,
        message_history=message_history,
        text_reference=context,
        message_for_the_prompt=system_prompt,
        gemini_model_name=GEMINI_MODEL,
    )

    return stream, sources
