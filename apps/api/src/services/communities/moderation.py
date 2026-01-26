import re
import json
from typing import List, Optional, Tuple, Any
from fastapi import HTTPException, status
from sqlmodel import Session, select

from src.db.communities.communities import Community


def extract_text_from_tiptap(node: Any) -> str:
    """
    Recursively extract plain text from tiptap JSON content.
    """
    if not node:
        return ""

    if isinstance(node, str):
        return node

    if isinstance(node, dict):
        if node.get("type") == "text":
            return node.get("text", "")

        # Recursively process content array
        content = node.get("content", [])
        if isinstance(content, list):
            return " ".join(extract_text_from_tiptap(child) for child in content)

    return ""


def parse_content_for_moderation(content: str) -> str:
    """
    Parse content and extract text for moderation.
    Handles both plain text and tiptap JSON format.
    """
    if not content:
        return ""

    # Try to parse as JSON (tiptap format)
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict) and parsed.get("type") == "doc":
            return extract_text_from_tiptap(parsed)
    except (json.JSONDecodeError, TypeError):
        pass

    # Return as-is for plain text
    return content


def check_content_moderation(
    content: str,
    moderation_words: List[str],
) -> Tuple[bool, Optional[str]]:
    """
    Check if content contains any moderation words.

    Returns:
        Tuple of (is_clean, matched_word)
        - is_clean: True if content passes moderation, False if blocked
        - matched_word: The word that was matched (if blocked), None otherwise
    """
    if not moderation_words or not content:
        return True, None

    # Normalize content for checking (lowercase)
    content_lower = content.lower()

    for word in moderation_words:
        if not word:
            continue

        word_lower = word.lower().strip()

        # Check for word boundary matches to avoid false positives
        # This will match the word as a standalone word or part of a larger word
        pattern = re.compile(re.escape(word_lower), re.IGNORECASE)
        if pattern.search(content_lower):
            return False, word

    return True, None


async def validate_content_for_community(
    content: str,
    community_id: int,
    db_session: Session,
    content_type: str = "content",
) -> None:
    """
    Validate content against community moderation rules.
    Raises HTTPException if content contains banned words.

    Args:
        content: The text content to check
        community_id: The community ID to get moderation rules from
        db_session: Database session
        content_type: Type of content for error message (e.g., "discussion", "reply")
    """
    # Get community
    statement = select(Community).where(Community.id == community_id)
    community = db_session.exec(statement).first()

    if not community:
        return  # No community found, skip validation

    moderation_words = community.moderation_words or []

    if not moderation_words:
        return  # No moderation words configured

    # Parse content to extract text (handles both plain text and JSON)
    text_content = parse_content_for_moderation(content)
    is_clean, matched_word = check_content_moderation(text_content, moderation_words)

    if not is_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": f"Your {content_type} contains content that is not allowed in this community.",
                "code": "MODERATION_BLOCKED",
            }
        )


async def validate_discussion_content(
    title: str,
    content: str,
    community_id: int,
    db_session: Session,
) -> None:
    """
    Validate both title and content of a discussion.
    """
    # Check title
    await validate_content_for_community(
        title, community_id, db_session, content_type="discussion title"
    )

    # Check content if provided
    if content:
        await validate_content_for_community(
            content, community_id, db_session, content_type="discussion"
        )


async def validate_comment_content(
    content: str,
    community_id: int,
    db_session: Session,
) -> None:
    """
    Validate comment/reply content.
    """
    await validate_content_for_community(
        content, community_id, db_session, content_type="reply"
    )
