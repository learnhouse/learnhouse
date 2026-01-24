from typing import Optional
from google import genai
from config.config import get_learnhouse_config

def get_gemini_client() -> Optional[genai.Client]:
    """Get Gemini client instance"""
    LH_CONFIG = get_learnhouse_config()
    api_key = getattr(LH_CONFIG.ai_config, 'gemini_api_key', None)

    if not api_key:
        return None

    return genai.Client(api_key=api_key)