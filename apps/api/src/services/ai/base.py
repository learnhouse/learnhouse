from typing import Optional, Dict, Any, AsyncGenerator
from uuid import uuid4
from datetime import datetime, timezone
import logging
import redis
import json
import asyncio
from google import genai

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

LH_CONFIG = get_learnhouse_config()

def get_gemini_client():
    """Get Gemini client instance"""
    api_key = getattr(LH_CONFIG.ai_config, 'gemini_api_key', None)
    if not api_key:
        raise Exception("Gemini API key not configured")
    return genai.Client(api_key=api_key)


def ask_ai(
    question: str,
    message_history: Any,
    text_reference: str,
    message_for_the_prompt: str,
    gemini_model_name: str,
) -> Dict[str, Any]:
    """
    Process an AI query using Google Gen AI SDK with course content as context
    """
    try:
        # Use Gemini 2.0 Flash as default if no model specified or if OpenAI model
        if not gemini_model_name or gemini_model_name.startswith("gpt-"):
            gemini_model_name = "gemini-2.5-flash"

        client = get_gemini_client()

        # Build conversation contents
        contents = []

        # Add system instruction as the first message
        system_instruction = f"{message_for_the_prompt}\n\nCourse Content Context:\n{text_reference}"
        contents.append({"role": "user", "parts": [{"text": system_instruction}]})
        contents.append({"role": "model", "parts": [{"text": "I understand. I'm ready to help with questions about this course content."}]})

        # Add message history if available
        if hasattr(message_history, 'messages'):
            for msg in message_history.messages:
                if hasattr(msg, 'type') and hasattr(msg, 'content'):
                    role = "user" if msg.type == "human" else "model"
                    contents.append({"role": role, "parts": [{"text": msg.content}]})
        elif isinstance(message_history, list):
            # Handle simple list format
            for msg in message_history:
                if isinstance(msg, dict) and 'role' in msg and 'content' in msg:
                    contents.append({"role": msg['role'], "parts": [{"text": msg['content']}]})

        # Add current question
        contents.append({"role": "user", "parts": [{"text": question}]})

        # Generate response
        response = client.models.generate_content(
            model=gemini_model_name,
            contents=contents
        )

        return {
            "output": response.text,
            "intermediate_steps": []
        }

    except Exception as e:
        raise Exception(f"Error processing AI request: {str(e)}")

def get_chat_session_history(aichat_uuid: Optional[str] = None) -> Dict[str, Any]:
    """Get or create a new chat session history using Redis"""
    session_id = aichat_uuid if aichat_uuid else f"aichat_{uuid4()}"
    
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    message_history = []
    
    if redis_conn_string:
        try:
            # Connect to Redis and get message history
            r = redis.from_url(redis_conn_string)
            history_data = r.get(f"chat_history:{session_id}")
            if history_data:
                if isinstance(history_data, bytes):
                    message_history = json.loads(history_data.decode('utf-8'))
                elif isinstance(history_data, str):
                    message_history = json.loads(history_data)
                else:
                    message_history = []
        except Exception as e:
            logger.error("Failed to connect to Redis: %s, using empty history", e, exc_info=True)
            message_history = []
    else:
        logger.warning("Redis connection string not found, using empty history")
        message_history = []

    return {
        "message_history": message_history,
        "aichat_uuid": session_id
    }

def save_message_to_history(aichat_uuid: str, user_message: str, ai_response: str, user_id: Optional[int] = None, course_uuid: Optional[str] = None, sources: Optional[list] = None, mode: str = "course_only", org_id: Optional[int] = None):
    """Save a message exchange to Redis history. Auto-creates session metadata on first message."""
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        return

    try:
        r = redis.from_url(redis_conn_string)

        # Get existing history
        history_key = f"chat_history:{aichat_uuid}"
        history_data = r.get(history_key)
        if history_data:
            if isinstance(history_data, bytes):
                history = json.loads(history_data.decode('utf-8'))
            elif isinstance(history_data, str):
                history = json.loads(history_data)
            else:
                history = []
        else:
            history = []

        # Auto-create session metadata on first message pair
        is_first_message = len(history) == 0

        # Add new messages
        history.append({"role": "user", "content": user_message})
        model_msg = {"role": "model", "content": ai_response}
        if sources:
            model_msg["sources"] = sources
        history.append(model_msg)

        # Keep only last 20 messages to prevent unlimited growth
        if len(history) > 20:
            history = history[-20:]

        # Save back to Redis with TTL of 25 days
        r.setex(history_key, 2160000, json.dumps(history))

        # Create session metadata on first message
        if is_first_message and user_id is not None:
            title = user_message[:50].strip()
            if len(user_message) > 50:
                title += "..."
            save_chat_session_meta(aichat_uuid, user_id, title, course_uuid, mode=mode, org_id=org_id)

    except Exception as e:
        logger.error("Failed to save message to Redis: %s", e, exc_info=True)


CHAT_TTL = 2160000  # 25 days in seconds


def _get_redis():
    """Get a Redis connection."""
    LH_CONFIG = get_learnhouse_config()
    conn = LH_CONFIG.redis_config.redis_connection_string
    if not conn:
        return None
    return redis.from_url(conn)


def save_chat_session_meta(aichat_uuid: str, user_id: int, title: str, course_uuid: Optional[str] = None, mode: str = "course_only", org_id: Optional[int] = None):
    """Store session metadata and add to user's session index."""
    r = _get_redis()
    if not r:
        return
    try:
        now = datetime.now(timezone.utc)
        meta = {
            "aichat_uuid": aichat_uuid,
            "user_id": user_id,
            "org_id": org_id,
            "title": title,
            "course_uuid": course_uuid,
            "created_at": now.isoformat(),
            "favorite": False,
            "mode": mode,
        }
        r.setex(f"chat_meta:{aichat_uuid}", CHAT_TTL, json.dumps(meta))
        r.zadd(f"user_chats:{user_id}", {aichat_uuid: now.timestamp()})
        r.expire(f"user_chats:{user_id}", CHAT_TTL)
    except Exception as e:
        logger.error("Failed to save chat session meta: %s", e, exc_info=True)


def update_chat_session_meta(aichat_uuid: str, user_id: int, title: Optional[str] = None, favorite: Optional[bool] = None) -> Optional[dict]:
    """Update title and/or favorite flag on a session. Returns updated meta or None."""
    r = _get_redis()
    if not r:
        return None
    try:
        meta_key = f"chat_meta:{aichat_uuid}"
        meta_data = r.get(meta_key)
        if not meta_data:
            return None
        meta = json.loads(meta_data.decode("utf-8") if isinstance(meta_data, bytes) else meta_data)
        if meta.get("user_id") != user_id:
            return None

        if title is not None:
            meta["title"] = title
        if favorite is not None:
            meta["favorite"] = favorite

        ttl = r.ttl(meta_key)
        if ttl and ttl > 0:
            r.setex(meta_key, ttl, json.dumps(meta))
        else:
            r.setex(meta_key, CHAT_TTL, json.dumps(meta))

        return meta
    except Exception as e:
        logger.error("Failed to update chat session meta: %s", e, exc_info=True)
        return None


def get_user_chat_sessions(user_id: int, org_id: Optional[int] = None) -> list[dict]:
    """Return all chat sessions for a user, newest first. Optionally filter by org_id."""
    r = _get_redis()
    if not r:
        return []
    try:
        # Get all session UUIDs from sorted set, newest first
        members = r.zrevrange(f"user_chats:{user_id}", 0, -1)
        if not members:
            return []

        # Decode all UUIDs upfront
        uuid_strs = [
            m.decode("utf-8") if isinstance(m, bytes) else m for m in members
        ]

        # Batch-fetch all metadata in a single MGET call (avoids N+1 round-trips)
        meta_keys = [f"chat_meta:{u}" for u in uuid_strs]
        meta_values = r.mget(meta_keys)

        sessions = []
        expired_uuids = []
        for uuid_str, meta_data in zip(uuid_strs, meta_values):
            if not meta_data:
                expired_uuids.append(uuid_str)
                continue
            meta = json.loads(meta_data.decode("utf-8") if isinstance(meta_data, bytes) else meta_data)
            # Filter by org_id if provided
            if org_id is not None and meta.get("org_id") != org_id:
                continue
            sessions.append(meta)

        # Clean up expired entries from the sorted set
        if expired_uuids:
            r.zrem(f"user_chats:{user_id}", *expired_uuids)

        return sessions
    except Exception as e:
        logger.error("Failed to get user chat sessions: %s", e, exc_info=True)
        return []


def get_chat_messages(aichat_uuid: str, user_id: int) -> Optional[list[dict]]:
    """Get messages for a chat session, validating ownership. Returns None if not owned."""
    r = _get_redis()
    if not r:
        return None
    try:
        # Validate ownership
        meta_data = r.get(f"chat_meta:{aichat_uuid}")
        if not meta_data:
            return None
        meta = json.loads(meta_data.decode("utf-8") if isinstance(meta_data, bytes) else meta_data)
        if meta.get("user_id") != user_id:
            return None

        # Get messages
        history_data = r.get(f"chat_history:{aichat_uuid}")
        if not history_data:
            return []
        return json.loads(history_data.decode("utf-8") if isinstance(history_data, bytes) else history_data)
    except Exception as e:
        logger.error("Failed to get chat messages: %s", e, exc_info=True)
        return None


def delete_chat_session(aichat_uuid: str, user_id: int) -> bool:
    """Delete a chat session and its metadata. Returns True if deleted."""
    r = _get_redis()
    if not r:
        return False
    try:
        # Validate ownership
        meta_data = r.get(f"chat_meta:{aichat_uuid}")
        if not meta_data:
            return False
        meta = json.loads(meta_data.decode("utf-8") if isinstance(meta_data, bytes) else meta_data)
        if meta.get("user_id") != user_id:
            return False

        r.delete(f"chat_history:{aichat_uuid}", f"chat_meta:{aichat_uuid}")
        r.zrem(f"user_chats:{user_id}", aichat_uuid)
        return True
    except Exception as e:
        logger.error("Failed to delete chat session: %s", e, exc_info=True)
        return False


def generate_chat_title(user_message: str, ai_response: str) -> str:
    """Generate a short summarized title for a chat session using a lightweight model."""
    try:
        client = get_gemini_client()
        prompt = (
            "Summarize this conversation into a very short title (max 6 words). "
            "Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\n"
            f"User: {user_message[:300]}\n"
            f"Assistant: {ai_response[:300]}"
        )
        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=[{"role": "user", "parts": [{"text": prompt}]}],
            config={"max_output_tokens": 30, "temperature": 0.3},
        )
        if response.text:
            title = response.text.strip().strip('"\'').strip()
            if title:
                return title[:60]
    except Exception as e:
        logger.error("Failed to generate chat title: %s", e, exc_info=True)
    # Fallback to truncated message
    fallback = user_message[:50].strip()
    if len(user_message) > 50:
        fallback += "..."
    return fallback


async def ask_ai_stream(
    question: str,
    message_history: Any,
    text_reference: str,
    message_for_the_prompt: str,
    gemini_model_name: str,
) -> AsyncGenerator[str, None]:
    """
    Process an AI query using Google Gen AI SDK with streaming response.
    Yields chunks of the response as they arrive.
    """
    try:
        # Use Gemini 2.0 Flash as default if no model specified or if OpenAI model
        if not gemini_model_name or gemini_model_name.startswith("gpt-"):
            gemini_model_name = "gemini-2.5-flash"

        client = get_gemini_client()

        # Build conversation contents
        contents = []

        # Add system instruction as the first message
        system_instruction = f"{message_for_the_prompt}\n\nCourse Content Context:\n{text_reference}"
        contents.append({"role": "user", "parts": [{"text": system_instruction}]})
        contents.append({"role": "model", "parts": [{"text": "I understand. I'm ready to help with questions about this course content."}]})

        # Add message history if available
        if hasattr(message_history, 'messages'):
            for msg in message_history.messages:
                if hasattr(msg, 'type') and hasattr(msg, 'content'):
                    role = "user" if msg.type == "human" else "model"
                    contents.append({"role": role, "parts": [{"text": msg.content}]})
        elif isinstance(message_history, list):
            # Handle simple list format
            for msg in message_history:
                if isinstance(msg, dict) and 'role' in msg and 'content' in msg:
                    contents.append({"role": msg['role'], "parts": [{"text": msg['content']}]})

        # Add current question
        contents.append({"role": "user", "parts": [{"text": question}]})

        # Generate response with streaming
        response = client.models.generate_content_stream(
            model=gemini_model_name,
            contents=contents
        )

        for chunk in response:
            if chunk.text:
                yield chunk.text
                await asyncio.sleep(0.01)

    except Exception as e:
        yield f"Error: {str(e)}"


async def generate_follow_up_suggestions(
    ai_response: str,
    context: str,
    gemini_model_name: str,
    user_message: str = "",
) -> list[str]:
    """
    Generate 3 contextual follow-up questions based on the AI response.
    Returns a list of suggested follow-up questions.
    Uses a fast model with minimal prompt for quick generation.
    Questions are generated in the same language as the user's message.
    """
    try:
        client = get_gemini_client()

        # Use only a small snippet of the response for speed
        response_snippet = ai_response[:500] if len(ai_response) > 500 else ai_response

        # Short, direct prompt for fast generation - respond in same language as user
        prompt = f"""Given this educational response, suggest 3 brief follow-up questions a student might ask. Output only the questions, one per line. IMPORTANT: Write the questions in the same language as the user's question.

User's question: {user_message[:200]}
Response: {response_snippet}

Questions:"""

        contents = [{"role": "user", "parts": [{"text": prompt}]}]

        # Use flash model with limited output for speed
        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=contents,
            config={
                "max_output_tokens": 150,
                "temperature": 0.7,
            }
        )

        # Parse the response into a list of questions
        if response.text:
            questions = [q.strip().lstrip('0123456789.-) ') for q in response.text.strip().split('\n') if q.strip() and '?' in q]
            return questions[:3]

        return []

    except Exception as e:
        logger.error("Failed to generate follow-up suggestions: %s", e, exc_info=True)
        return []
