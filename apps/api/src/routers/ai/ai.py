from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.services.ai.ai import ai_start_activity_chat_session
from src.services.ai.schemas.ai import StartActivityAIChatSession
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user


router = APIRouter()


@router.post("/start/activity_chat_session")
async def api_ai_start_activity_chat_session(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Start a new AI Chat session with a Course Activity
    """
    return ai_start_activity_chat_session(
        request, chat_session_object, current_user, db_session
    )
