import os
from fastapi import APIRouter, Depends
from src.custom.ai.custom_ai import ask_custom_ai
from src.security.auth import get_current_user
from src.db.users import PublicUser

router = APIRouter(prefix="/api/v1/custom-ai", tags=["Custom AI"])

@router.post("/chat")
async def custom_ai_chat(
    message: str,
    context: str | None = None,
    current_user: PublicUser = Depends(get_current_user),
):
    industry = os.getenv("LEARNHOUSE_INDUSTRY", "generic")
    return ask_custom_ai(message=message, industry=industry, context=context)
