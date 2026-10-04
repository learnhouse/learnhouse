import re
import json
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple, Any, Dict
from urllib.parse import parse_qs, urlparse
from fastapi import HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.communities.communities import Community, DEFAULT_MODERATION_SETTINGS
from src.db.communities.discussions import Discussion
from src.db.users import User


URL_PATTERN = re.compile(
    r"(?:https?://|www\.)[^\s<>\"']+",
    re.IGNORECASE,
)


# Rich content (embeds) in discussions is opt-in per community. Only the node
# types below are ever accepted from the client; "youtube" additionally
# requires ``allow_rich_content`` to be enabled on the community.
BASE_NODE_TYPES = frozenset(
    {
        "doc",
        "paragraph",
        "text",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "codeBlock",
        "blockquote",
        "hardBreak",
        "horizontalRule",
    }
)
RICH_NODE_TYPES = frozenset({"youtube"})
ALLOWED_MARK_TYPES = frozenset({"bold", "italic", "strike", "code", "link", "underline"})
ALLOWED_LINK_SCHEMES = frozenset({"http", "https", "mailto"})
YOUTUBE_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
        "youtu.be",
        "www.youtu.be",
    }
)
YOUTUBE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_youtube_video_id(url: str) -> Optional[str]:
    """
    Return the 11-character video id when ``url`` is a YouTube watch, share,
    shorts or embed link on a known YouTube host, otherwise ``None``.
    """
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        return None

    candidate: Optional[str] = None
    path_parts = [part for part in parsed.path.split("/") if part]
    if host.endswith("youtu.be"):
        candidate = path_parts[0] if path_parts else None
    elif path_parts and path_parts[0] in ("embed", "shorts", "live", "v") and len(path_parts) > 1:
        candidate = path_parts[1]
    else:
        candidate = (parse_qs(parsed.query).get("v") or [None])[0]

    if candidate and YOUTUBE_ID_PATTERN.match(candidate):
        return candidate
    return None


def _rich_content_error(message: str, code: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"message": message, "code": code},
    )


def _walk_content_node(node: Any, allow_rich: bool, content_type: str) -> None:
    if not isinstance(node, dict):
        raise _rich_content_error(
            f"Your {content_type} contains content that is not supported.",
            "MODERATION_UNSUPPORTED_CONTENT",
        )

    node_type = node.get("type")
    if node_type in RICH_NODE_TYPES:
        if not allow_rich:
            raise _rich_content_error(
                f"Embedded media is not allowed in {content_type}s in this community.",
                "MODERATION_RICH_CONTENT_DISABLED",
            )
        if node_type == "youtube":
            src = (node.get("attrs") or {}).get("src")
            if not extract_youtube_video_id(src):
                raise _rich_content_error(
                    "Only YouTube video links can be embedded.",
                    "MODERATION_EMBED_NOT_ALLOWED",
                )
    elif node_type not in BASE_NODE_TYPES:
        raise _rich_content_error(
            f"Your {content_type} contains content that is not supported.",
            "MODERATION_UNSUPPORTED_CONTENT",
        )

    for mark in node.get("marks") or []:
        mark_type = mark.get("type") if isinstance(mark, dict) else None
        if mark_type not in ALLOWED_MARK_TYPES:
            raise _rich_content_error(
                f"Your {content_type} contains formatting that is not supported.",
                "MODERATION_UNSUPPORTED_CONTENT",
            )
        if mark_type == "link":
            href = (mark.get("attrs") or {}).get("href") or ""
            scheme = urlparse(str(href).strip()).scheme.lower()
            if scheme and scheme not in ALLOWED_LINK_SCHEMES:
                raise _rich_content_error(
                    f"Your {content_type} contains a link that is not allowed.",
                    "MODERATION_LINK_NOT_ALLOWED",
                )

    children = node.get("content")
    if children is None:
        return
    if not isinstance(children, list):
        raise _rich_content_error(
            f"Your {content_type} contains content that is not supported.",
            "MODERATION_UNSUPPORTED_CONTENT",
        )
    for child in children:
        _walk_content_node(child, allow_rich, content_type)


def validate_rich_content(
    content: Optional[str],
    settings: Dict[str, Any],
    content_type: str = "discussion",
) -> None:
    """
    Validate the structure of tiptap JSON content: only known node and mark
    types are accepted, and embeds are only accepted when the community has
    ``allow_rich_content`` enabled (and then only YouTube video links).

    Plain-text content (anything that is not a tiptap ``doc``) passes through.
    """
    if not content:
        return
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return
    if not isinstance(parsed, dict) or parsed.get("type") != "doc":
        return

    allow_rich = bool(settings.get("allow_rich_content", False))
    _walk_content_node(parsed, allow_rich, content_type)


def get_community_settings(community: Optional[Community]) -> Dict[str, Any]:
    """Return moderation settings for a community, falling back to defaults."""
    stored = (community.moderation_settings if community else None) or {}
    merged = dict(DEFAULT_MODERATION_SETTINGS)
    merged.update({k: v for k, v in stored.items() if v is not None})
    return merged


def content_has_link(text: str) -> bool:
    if not text:
        return False
    return bool(URL_PATTERN.search(text))


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (ValueError, AttributeError):
        return None


async def enforce_posting_limits(
    user_id: int,
    community: Optional[Community],
    db_session: AsyncSession,
) -> None:
    """
    Apply posting-level moderation (slow mode, per-day caps, account age, email
    verification) before a discussion is created. Raises HTTPException on block.
    """
    if not community:
        return

    settings = get_community_settings(community)
    slow_mode_seconds = int(settings.get("slow_mode_seconds", 0) or 0)
    max_posts_per_day = int(settings.get("max_posts_per_day", 0) or 0)
    min_account_age_days = int(settings.get("min_account_age_days", 0) or 0)
    require_email_verified = bool(settings.get("require_email_verified", False))

    user = None
    if min_account_age_days > 0 or require_email_verified:
        user = (await db_session.execute(select(User).where(User.id == user_id))).scalars().first()

    if require_email_verified and user is not None and not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "You must verify your email before posting in this community.",
                "code": "MODERATION_EMAIL_UNVERIFIED",
            },
        )

    if min_account_age_days > 0 and user is not None:
        created = _parse_iso_datetime(user.creation_date)
        if created is not None:
            age = datetime.now(timezone.utc) - created
            if age < timedelta(days=min_account_age_days):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "message": f"Your account must be at least {min_account_age_days} day(s) old to post here.",
                        "code": "MODERATION_ACCOUNT_TOO_NEW",
                    },
                )

    if slow_mode_seconds <= 0 and max_posts_per_day <= 0:
        return

    recent_query = select(Discussion).where(
        Discussion.community_id == community.id,
        Discussion.author_id == user_id,
    ).order_by(Discussion.creation_date.desc())  # type: ignore
    recent_discussions = list((await db_session.execute(recent_query.limit(max(50, max_posts_per_day + 5)))).scalars().all())

    if slow_mode_seconds > 0 and recent_discussions:
        last_created = _parse_iso_datetime(recent_discussions[0].creation_date)
        if last_created is not None:
            elapsed = (datetime.now(timezone.utc) - last_created).total_seconds()
            if elapsed < slow_mode_seconds:
                wait = int(slow_mode_seconds - elapsed)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "message": f"Slow mode is on. Try again in {wait} second(s).",
                        "code": "MODERATION_SLOW_MODE",
                        "wait_seconds": wait,
                    },
                )

    if max_posts_per_day > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=1)
        count = 0
        for d in recent_discussions:
            created = _parse_iso_datetime(d.creation_date)
            if created is None:
                continue
            if created >= cutoff:
                count += 1
        if count >= max_posts_per_day:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": f"You've reached the daily limit of {max_posts_per_day} post(s) in this community.",
                    "code": "MODERATION_DAILY_LIMIT",
                },
            )


async def enforce_auto_lock(
    discussion: Discussion,
    community: Optional[Community],
    db_session: AsyncSession,
) -> None:
    """
    Lazily lock a discussion if it has been inactive longer than
    ``auto_lock_days``. Mutates and commits the discussion in place.
    """
    if discussion.is_locked or not community:
        return
    settings = get_community_settings(community)
    auto_lock_days = int(settings.get("auto_lock_days", 0) or 0)
    if auto_lock_days <= 0:
        return
    reference = _parse_iso_datetime(discussion.update_date) or _parse_iso_datetime(discussion.creation_date)
    if reference is None:
        return
    if datetime.now(timezone.utc) - reference >= timedelta(days=auto_lock_days):
        discussion.is_locked = True
        db_session.add(discussion)
        await db_session.commit()
        await db_session.refresh(discussion)


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
    db_session: AsyncSession,
    content_type: str = "content",
    *,
    max_length: int = 0,
    min_length: int = 0,
    block_links: bool = False,
) -> None:
    """
    Validate content against community moderation rules.
    Raises HTTPException if content is blocked.
    """
    statement = select(Community).where(Community.id == community_id)
    community = (await db_session.execute(statement)).scalars().first()

    if not community:
        return

    text_content = parse_content_for_moderation(content)

    if min_length and len(text_content.strip()) < min_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": f"Your {content_type} is too short (minimum {min_length} characters).",
                "code": "MODERATION_TOO_SHORT",
            },
        )

    if max_length and len(text_content) > max_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": f"Your {content_type} is too long (maximum {max_length} characters).",
                "code": "MODERATION_TOO_LONG",
            },
        )

    if block_links and content_has_link(text_content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": f"Links are not allowed in {content_type} in this community.",
                "code": "MODERATION_LINKS_BLOCKED",
            },
        )

    moderation_words = community.moderation_words or []
    if moderation_words:
        is_clean, _matched_word = check_content_moderation(text_content, moderation_words)
        if not is_clean:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "message": f"Your {content_type} contains content that is not allowed in this community.",
                    "code": "MODERATION_BLOCKED",
                },
            )


async def validate_discussion_content(
    title: str,
    content: str,
    community_id: int,
    db_session: AsyncSession,
) -> None:
    """
    Validate both title and content of a discussion.
    """
    statement = select(Community).where(Community.id == community_id)
    community = (await db_session.execute(statement)).scalars().first()
    settings = get_community_settings(community)
    block_links = bool(settings.get("block_links", False))
    min_post = int(settings.get("min_post_length", 0) or 0)
    max_post = int(settings.get("max_post_length", 0) or 0)

    await validate_content_for_community(
        title, community_id, db_session, content_type="discussion title",
        block_links=block_links,
    )

    if content:
        validate_rich_content(content, settings, content_type="discussion")
        await validate_content_for_community(
            content, community_id, db_session, content_type="discussion",
            min_length=min_post,
            max_length=max_post,
            block_links=block_links,
        )


async def validate_comment_content(
    content: str,
    community_id: int,
    db_session: AsyncSession,
) -> None:
    """
    Validate comment/reply content.
    """
    statement = select(Community).where(Community.id == community_id)
    community = (await db_session.execute(statement)).scalars().first()
    settings = get_community_settings(community)

    await validate_content_for_community(
        content, community_id, db_session, content_type="reply",
        max_length=int(settings.get("max_comment_length", 0) or 0),
        block_links=bool(settings.get("block_links", False)),
    )
