"""
RAG query service.

Handles vector similarity search and streaming LLM responses
grounded in course content.
"""

import json
import logging
from typing import AsyncGenerator

from sqlalchemy import bindparam, text
from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.ai.rag.access import RagAccessScope, filter_readable_chunks
from src.services.ai.rag.embedding_service import embed_single_text
from src.services.ai.rag.types import Source, SourceType
from src.services.ai.base import ask_ai_stream
from src.services.ai.llm import model_for_tier

logger = logging.getLogger(__name__)

TOP_K = 5
OVERFETCH_FACTOR = 4
SNIPPET_CHARS = 280

_KIND_LABELS = {
    SourceType.COURSE.value: "Course",
    SourceType.CHAPTER.value: "Chapter",
    SourceType.PAGE.value: "Page",
    SourceType.DOCUMENT.value: "PDF",
    SourceType.PDF_BLOCK.value: "PDF",
    SourceType.IMAGE_BLOCK.value: "Image",
    SourceType.AUDIO_BLOCK.value: "Audio",
    SourceType.VIDEO_BLOCK.value: "Video",
    SourceType.VIDEO.value: "Video",
    SourceType.ASSIGNMENT.value: "Assignment",
    SourceType.SCORM.value: "SCORM module",
    SourceType.CUSTOM.value: "Activity",
    SourceType.CUSTOM_BLOCK.value: "Activity",
    SourceType.ACTIVITY.value: "Activity",
}


async def search_course_content(
    question: str,
    org_id: int,
    db_session: AsyncSession,
    scope: RagAccessScope,
    top_k: int = TOP_K,
) -> list:
    """Rows most similar to the question that the caller may read, best first."""
    if not scope.course_ids:
        return []

    query_embedding = await embed_single_text(question)
    embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

    # Course-level access is enforced in SQL. Activity-level rules (drafts,
    # locks, paid access) are applied to the rows afterwards, so over-fetch to
    # keep top_k results when some of them get filtered out.
    sql = text("""
        SELECT ce.id, ce.chunk_text, ce.activity_id, ce.activity_uuid, ce.activity_name,
               ce.chapter_name, ce.course_name, ce.source_type, ce.block_uuid, ce.locator,
               ce.course_id, c.course_uuid,
               ce.embedding <=> :query_embedding AS distance
        FROM course_embedding ce
        JOIN course c ON c.id = ce.course_id
        WHERE ce.org_id = :org_id AND ce.course_id IN :course_ids
        ORDER BY ce.embedding <=> :query_embedding
        LIMIT :limit
    """).bindparams(bindparam("course_ids", expanding=True))
    params = {
        "query_embedding": embedding_str,
        "org_id": org_id,
        "course_ids": scope.course_ids,
        "limit": top_k * OVERFETCH_FACTOR,
    }

    rows = (await db_session.execute(sql, params)).fetchall()
    return (await filter_readable_chunks(rows, scope, db_session))[:top_k]


def source_from_row(row) -> Source:
    locator = row.locator
    if isinstance(locator, str):  # JSON columns come back as text on some drivers
        locator = json.loads(locator)
    return Source(
        source_type=row.source_type,
        course_uuid=row.course_uuid,
        course_name=row.course_name,
        chapter_name=row.chapter_name or "",
        activity_uuid=row.activity_uuid or None,
        activity_name=row.activity_name or "",
        block_uuid=row.block_uuid,
        locator=locator or None,
        title=row.activity_name or row.chapter_name or row.course_name,
        snippet=(row.chunk_text or "")[:SNIPPET_CHARS],
        similarity=round(1 - float(row.distance), 4) if row.distance is not None else None,
    )


def format_timestamp(seconds: float) -> str:
    """192 -> "03:12", 3725 -> "1:02:05"."""
    total = int(seconds)
    hours, minutes, secs = total // 3600, total % 3600 // 60, total % 60
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def source_label(source: Source) -> str:
    """Short description of where a source points, for the model's context."""
    label = f'{_KIND_LABELS.get(source.source_type, "Content")} "{source.title}"'
    locator = source.locator or {}
    if "start" in locator:
        return f"{label} at {format_timestamp(locator['start'])}"
    if "page" in locator:
        return f"{label}, page {locator['page']}"
    return label


async def query_course_rag(
    question: str,
    org_id: int,
    db_session: AsyncSession,
    scope: RagAccessScope,
    top_k: int = TOP_K,
) -> dict:
    """
    Retrieve relevant course content via vector similarity search.

    Returns ``{context, sources}``: the numbered context for the model and the
    deduplicated sources (as dicts) its [N] citations refer to.
    """
    rows = await search_course_content(question, org_id, db_session, scope, top_k)

    context_parts = []
    sources: list[Source] = []
    numbers: dict[tuple, int] = {}
    for row in rows:
        # One number per place (course, activity, block); the best-ranked chunk wins
        # the locator, so the citation opens at the most relevant moment.
        source = source_from_row(row)
        key = (row.course_uuid, row.activity_uuid, row.source_type, row.block_uuid)
        if key not in numbers:
            sources.append(source)
            numbers[key] = len(sources)
        context_parts.append(f"[Source {numbers[key]}] {source_label(source)}\n{row.chunk_text}")

    return {
        "context": "\n\n---\n\n".join(context_parts),
        "sources": [source.to_dict() for source in sources],
    }


async def query_course_rag_stream(
    question: str,
    org_id: int,
    db_session: AsyncSession,
    message_history: list,
    scope: RagAccessScope,
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
        scope=scope,
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

    # The copilot renders answers with remark-math + KaTeX, which reads $...$ and
    # $$...$$ only. A bare $ in front of a number would start a math run and swallow
    # the rest of the sentence, so ask for it escaped.
    math_instructions = (
        "MATH: Write any mathematical expression as LaTeX between dollar signs: $x^2$ inline, "
        "$$...$$ on its own lines for display equations. Escape a literal dollar sign as \\$ "
        "(for example \\$5)."
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
            f"{math_instructions}\n\n"
            f"Course Content:\n{context}"
        )
    elif context:
        # course_only mode (default)
        system_prompt = (
            "You are a helpful educational assistant. Answer the student's question "
            "based on the course content provided below.\n\n"
            f"{citation_instructions}\n\n"
            "SUPPLEMENTARY KNOWLEDGE: When you add any information that is NOT directly from the "
            "provided course content (even small additions, clarifications, or general context), "
            "you MUST wrap that part in a blockquote using the > prefix. Always do this, even for "
            "brief supplementary notes. Example:\n"
            "> This is additional context from general knowledge.\n\n"
            f"{math_instructions}\n\n"
            f"Course Content:\n{context}"
        )
    elif mode == "general":
        system_prompt = (
            "You are a helpful, knowledgeable educational assistant. No specific course content "
            "was found for this question, but that's fine: answer the student's question using "
            "your general knowledge. Be thorough and helpful.\n\n"
            f"{math_instructions}"
        )
    else:
        system_prompt = (
            "You are a helpful educational assistant. The student asked a question but "
            "no relevant course content was found. Let them know you couldn't find "
            "specific course material related to their question, but offer to help "
            "with what you know.\n\n"
            f"{math_instructions}"
        )

    # Create the streaming generator
    stream = ask_ai_stream(
        question=question,
        message_history=message_history,
        text_reference=context,
        message_for_the_prompt=system_prompt,
        model_name=model_for_tier("standard"),
    )

    return stream, sources
