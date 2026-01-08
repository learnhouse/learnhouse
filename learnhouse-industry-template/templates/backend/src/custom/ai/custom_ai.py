from src.custom.ai.prompts import get_industry_prompt
from src.custom.ai.models import get_industry_model
from src.services.ai.base import ask_ai

def ask_custom_ai(message: str, industry: str, context: str | None = None):
    prompt = get_industry_prompt(industry)
    model = get_industry_model(industry)
    return ask_ai(
        question=message,
        message_history=[],
        text_reference=context or "",
        message_for_the_prompt=prompt,
        openai_model_name=model,
    )
