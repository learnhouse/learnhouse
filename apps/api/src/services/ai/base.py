from typing import Optional, Dict, Any, AsyncGenerator
from uuid import uuid4
import redis
import json
import asyncio
from google import genai

from config.config import get_learnhouse_config

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
            print(f"Failed to connect to Redis: {e}, using empty history")
            message_history = []
    else:
        print("Redis connection string not found, using empty history")
        message_history = []

    return {
        "message_history": message_history,
        "aichat_uuid": session_id
    }

def save_message_to_history(aichat_uuid: str, user_message: str, ai_response: str):
    """Save a message exchange to Redis history"""
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string
    
    if not redis_conn_string:
        return
    
    try:
        r = redis.from_url(redis_conn_string)
        
        # Get existing history
        history_data = r.get(f"chat_history:{aichat_uuid}")
        if history_data:
            if isinstance(history_data, bytes):
                history = json.loads(history_data.decode('utf-8'))
            elif isinstance(history_data, str):
                history = json.loads(history_data)
            else:
                history = []
        else:
            history = []
        
        # Add new messages
        history.append({"role": "user", "content": user_message})
        history.append({"role": "model", "content": ai_response})
        
        # Keep only last 20 messages to prevent unlimited growth
        if len(history) > 20:
            history = history[-20:]
        
        # Save back to Redis with TTL of 25 days
        r.setex(f"chat_history:{aichat_uuid}", 2160000, json.dumps(history))
        
    except Exception as e:
        print(f"Failed to save message to Redis: {e}")


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
        print(f"Failed to generate follow-up suggestions: {e}")
        return []