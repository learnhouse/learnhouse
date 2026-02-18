"""
Content extraction for RAG indexing.

Extracts text from all course content types:
- Dynamic pages (ProseMirror/TipTap JSON)
- PDF blocks and document activities
- Image blocks (metadata)
- Audio blocks (metadata)
- Quiz blocks (questions + answers)
- Custom blocks (text content)
"""

import logging
from typing import Optional

from sqlmodel import Session, select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.courses.chapter_activities import ChapterActivity
from src.services.courses.transfer.storage_utils import read_file_content

logger = logging.getLogger(__name__)

MAX_PDF_CHARS = 100_000


def extract_text_from_prosemirror(content: dict) -> str:
    """
    Recursively walk a TipTap/ProseMirror JSON tree and extract all text.
    Preserves heading hierarchy via # markers.
    """
    if not content or not isinstance(content, dict):
        return ""

    parts = []
    _walk_prosemirror_node(content, parts)
    return "\n".join(parts).strip()


def _walk_prosemirror_node(node: dict, parts: list[str]) -> None:
    """Recursively extract text from a ProseMirror node."""
    node_type = node.get("type", "")

    # Handle text nodes directly
    if node_type == "text":
        text = node.get("text", "")
        if text:
            parts.append(text)
        return

    # Add heading markers
    if node_type == "heading":
        level = node.get("attrs", {}).get("level", 1)
        prefix = "#" * level + " "
        texts = _collect_inline_text(node)
        if texts:
            parts.append(prefix + texts)
        return

    # Handle paragraph
    if node_type == "paragraph":
        texts = _collect_inline_text(node)
        if texts:
            parts.append(texts)
        # Recurse into children that are not inline
        return

    # Handle list items
    if node_type in ("bulletList", "orderedList"):
        for child in node.get("content", []):
            _walk_prosemirror_node(child, parts)
        return

    if node_type == "listItem":
        texts = []
        for child in node.get("content", []):
            if child.get("type") == "paragraph":
                t = _collect_inline_text(child)
                if t:
                    texts.append(t)
            else:
                _walk_prosemirror_node(child, parts)
        if texts:
            parts.append("- " + " ".join(texts))
        return

    # Handle blockquote
    if node_type == "blockquote":
        for child in node.get("content", []):
            sub_parts = []
            _walk_prosemirror_node(child, sub_parts)
            for p in sub_parts:
                parts.append("> " + p)
        return

    # Handle code blocks
    if node_type == "codeBlock":
        texts = _collect_inline_text(node)
        if texts:
            parts.append(f"```\n{texts}\n```")
        return

    # Handle callouts
    if node_type in ("calloutInfo", "calloutWarning", "calloutDanger", "calloutSuccess"):
        texts = _collect_inline_text(node)
        if texts:
            parts.append(f"[{node_type}] {texts}")
        return

    # Handle table
    if node_type == "table":
        for row in node.get("content", []):
            cells = []
            for cell in row.get("content", []):
                cell_text = _collect_inline_text(cell)
                if cell_text:
                    cells.append(cell_text)
            if cells:
                parts.append(" | ".join(cells))
        return

    # Default: recurse into children
    for child in node.get("content", []):
        if isinstance(child, dict):
            _walk_prosemirror_node(child, parts)


def _collect_inline_text(node: dict) -> str:
    """Collect all inline text from a node's content."""
    texts = []
    for child in node.get("content", []):
        if isinstance(child, dict):
            if child.get("type") == "text":
                texts.append(child.get("text", ""))
            elif child.get("type") == "hardBreak":
                texts.append("\n")
            else:
                # Recurse for nested inline elements (marks, etc.)
                texts.append(_collect_inline_text(child))
    return "".join(texts)


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes using pypdf. Cap at MAX_PDF_CHARS."""
    try:
        from pypdf import PdfReader
        from io import BytesIO

        reader = PdfReader(BytesIO(pdf_bytes))
        texts = []
        total_chars = 0
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if total_chars + len(page_text) > MAX_PDF_CHARS:
                texts.append(page_text[:MAX_PDF_CHARS - total_chars])
                break
            texts.append(page_text)
            total_chars += len(page_text)
        return "\n".join(texts).strip()
    except Exception as e:
        logger.warning("Failed to extract PDF text: %s", e)
        return ""


def _extract_block_content(block: Block, activity_name: str) -> Optional[dict]:
    """
    Extract text content from a block based on its type.
    Returns dict with {text, source_type} or None if no content.
    """
    block_type = block.block_type
    content = block.content or {}

    if block_type == BlockTypeEnum.BLOCK_VIDEO:
        # Skip video blocks — too heavy, no text
        return None

    if block_type == BlockTypeEnum.BLOCK_DOCUMENT_PDF:
        # Read PDF file and extract text
        file_path = content.get("file_id") or content.get("uri") or content.get("file_path", "")
        if not file_path:
            return None
        pdf_bytes = read_file_content(file_path)
        if not pdf_bytes:
            return None
        text = extract_text_from_pdf(pdf_bytes)
        if not text:
            return None
        return {"text": text, "source_type": "pdf_block"}

    if block_type == BlockTypeEnum.BLOCK_IMAGE:
        # Extract image metadata
        file_name = content.get("file_name", "") or content.get("file_id", "")
        alt_text = content.get("alt", "") or content.get("caption", "")
        meta_parts = [f"Image in activity '{activity_name}'"]
        if file_name:
            meta_parts.append(f"File: {file_name}")
        if alt_text:
            meta_parts.append(f"Description: {alt_text}")
        text = ". ".join(meta_parts)
        return {"text": text, "source_type": "image_block"}

    if block_type == BlockTypeEnum.BLOCK_AUDIO:
        # Extract audio metadata
        file_name = content.get("file_name", "") or content.get("file_id", "")
        meta_parts = [f"Audio in activity '{activity_name}'"]
        if file_name:
            meta_parts.append(f"File: {file_name}")
        text = ". ".join(meta_parts)
        return {"text": text, "source_type": "audio_block"}

    if block_type == BlockTypeEnum.BLOCK_QUIZ:
        # Extract quiz questions and answers
        questions = content.get("questions", [])
        if not questions:
            return None
        quiz_parts = []
        for q in questions:
            q_text = q.get("question", "") or q.get("text", "")
            if q_text:
                quiz_parts.append(f"Q: {q_text}")
            answers = q.get("answers", []) or q.get("options", [])
            for a in answers:
                a_text = a.get("answer", "") or a.get("text", "") if isinstance(a, dict) else str(a)
                if a_text:
                    quiz_parts.append(f"  A: {a_text}")
        if not quiz_parts:
            return None
        return {"text": "\n".join(quiz_parts), "source_type": "quiz_block"}

    if block_type == BlockTypeEnum.BLOCK_CUSTOM:
        # Try to extract any text from custom block content
        text_parts = []
        if isinstance(content, dict):
            for key, value in content.items():
                if isinstance(value, str) and value.strip():
                    text_parts.append(value.strip())
        if not text_parts:
            return None
        return {"text": "\n".join(text_parts), "source_type": "custom_block"}

    return None


def extract_all_course_content(
    course_id: int,
    org_id: int,
    db_session: Session,
) -> list[dict]:
    """
    Extract all indexable content from a course.

    Returns a list of dicts with:
    {text, activity_id, activity_uuid, activity_name, chapter_name, course_name, source_type, block_uuid}
    """
    # Get the course
    course = db_session.exec(
        select(Course).where(Course.id == course_id)
    ).first()
    if not course:
        logger.warning("Course %d not found for extraction", course_id)
        return []

    course_name = course.name

    # Get all activities for this course with their chapter info
    results = []

    # Get chapters for this course
    chapters = db_session.exec(
        select(Chapter).where(Chapter.course_id == course_id)
    ).all()
    chapter_map = {ch.id: ch.name for ch in chapters}

    # Get all activities for this course
    activities = db_session.exec(
        select(Activity).where(Activity.course_id == course_id)
    ).all()

    for activity in activities:
        # Find chapter name via chapter_activities join
        chapter_activity = db_session.exec(
            select(ChapterActivity).where(ChapterActivity.activity_id == activity.id)
        ).first()
        chapter_name = chapter_map.get(chapter_activity.chapter_id, "") if chapter_activity else ""

        activity_name = activity.name
        activity_id = activity.id
        activity_uuid = activity.activity_uuid

        # Handle Dynamic Page activities
        if activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC:
            # Extract text from ProseMirror content
            content = activity.content
            if content and isinstance(content, dict):
                text = extract_text_from_prosemirror(content)
                if text:
                    results.append({
                        "text": text,
                        "activity_id": activity_id,
                        "activity_uuid": activity_uuid,
                        "activity_name": activity_name,
                        "chapter_name": chapter_name,
                        "course_name": course_name,
                        "source_type": "dynamic_page",
                        "block_uuid": None,
                    })

            # Extract from blocks attached to this activity
            blocks = db_session.exec(
                select(Block).where(Block.activity_id == activity_id)
            ).all()
            for block in blocks:
                block_content = _extract_block_content(block, activity_name)
                if block_content:
                    results.append({
                        "text": block_content["text"],
                        "activity_id": activity_id,
                        "activity_uuid": activity_uuid,
                        "activity_name": activity_name,
                        "chapter_name": chapter_name,
                        "course_name": course_name,
                        "source_type": block_content["source_type"],
                        "block_uuid": block.block_uuid,
                    })

        # Handle Document activities (PDF)
        elif activity.activity_type == ActivityTypeEnum.TYPE_DOCUMENT:
            content = activity.content
            if content and isinstance(content, dict):
                file_path = content.get("file_id") or content.get("uri") or content.get("file_path", "")
                if file_path:
                    pdf_bytes = read_file_content(file_path)
                    if pdf_bytes:
                        text = extract_text_from_pdf(pdf_bytes)
                        if text:
                            results.append({
                                "text": text,
                                "activity_id": activity_id,
                                "activity_uuid": activity_uuid,
                                "activity_name": activity_name,
                                "chapter_name": chapter_name,
                                "course_name": course_name,
                                "source_type": "document_activity",
                                "block_uuid": None,
                            })

    logger.info(
        "Extracted %d content chunks from course %d (%s)",
        len(results), course_id, course_name
    )
    return results
