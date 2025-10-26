from typing import Optional, Dict, Any
from uuid import uuid4
import redis
import json
from openai import OpenAI

from config.config import get_learnhouse_config

LH_CONFIG = get_learnhouse_config()

def get_openai_client() -> OpenAI:
    """Get OpenAI client instance"""
    api_key = getattr(LH_CONFIG.ai_config, 'openai_api_key', None)
    if not api_key:
        raise Exception("OpenAI API key not configured")
    return OpenAI(api_key=api_key)

def ask_ai(
    question: str,
    message_history: Any,
    text_reference: str,
    message_for_the_prompt: str,
    openai_model_name: str,
) -> Dict[str, Any]:
    """
    Process an AI query using OpenAI SDK directly with course content as context
    """
    try:
        client = get_openai_client()
        
        # Build conversation history
        messages = []
        
        # Add system message with context
        system_content = f"{message_for_the_prompt}\n\nCourse Content Context:\n{text_reference}"
        messages.append({"role": "system", "content": system_content})
        
        # Add message history if available
        if hasattr(message_history, 'messages'):
            for msg in message_history.messages:
                if hasattr(msg, 'type') and hasattr(msg, 'content'):
                    role = "user" if msg.type == "human" else "assistant"
                    messages.append({"role": role, "content": msg.content})
        elif isinstance(message_history, list):
            # Handle simple list format
            for i, msg in enumerate(message_history):
                role = "user" if i % 2 == 0 else "assistant"
                if isinstance(msg, dict) and 'content' in msg:
                    messages.append({"role": role, "content": msg['content']})
                elif isinstance(msg, str):
                    messages.append({"role": role, "content": msg})
        
        # Add current question
        messages.append({"role": "user", "content": question})
        
        # Make API call to OpenAI
        response = client.chat.completions.create(
            model=openai_model_name,
            messages=messages,
            temperature=0.7,
            max_tokens=1000
        )
        
        return {
            "output": response.choices[0].message.content,
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
        history.append({"role": "assistant", "content": ai_response})
        
        # Keep only last 20 messages to prevent unlimited growth
        if len(history) > 20:
            history = history[-20:]
        
        # Save back to Redis with TTL of 25 days
        r.setex(f"chat_history:{aichat_uuid}", 2160000, json.dumps(history))
        
    except Exception as e:
        print(f"Failed to save message to Redis: {e}")