from typing import Optional
from openai import OpenAI
from config.config import get_learnhouse_config

def get_openai_client() -> Optional[OpenAI]:
    """Get OpenAI client instance"""
    LH_CONFIG = get_learnhouse_config()
    api_key = getattr(LH_CONFIG.ai_config, 'openai_api_key', None)
    
    if not api_key:
        return None
        
    return OpenAI(api_key=api_key)