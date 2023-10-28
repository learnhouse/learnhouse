from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session

from src.rewrite.services.db.users import UserCreate, UserRead
from src.rewrite.services.users.users import create_user


router = APIRouter()


@router.post("/", response_model=UserRead, tags=["users"])
async def api_create_user(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    user_object: UserCreate,
    org_slug: str
):
    """
    Create new user
    """
    return await create_user(request, db_session, None, user_object, org_slug)
