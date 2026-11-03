from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.services.calendar.calendar import get_calendar_events
from src.services.calendar.types import CalendarEvent

router = APIRouter()


@router.get(
    "/org/{org_id}/events",
    response_model=list[CalendarEvent],
    summary="The caller's calendar",
    description=(
        "Dated things the signed-in user can act on in this organization "
        "(assignment due dates, and live sessions on EE), between `start` "
        "(inclusive) and `end` (exclusive). All-day events carry a bare date."
    ),
    responses={
        400: {"description": "Invalid or too long range"},
        401: {"description": "Authentication required"},
        404: {"description": "Organization not found"},
    },
)
async def api_get_calendar_events(
    request: Request,
    org_id: int,
    start: datetime = Query(..., description="ISO 8601 start of the window"),
    end: datetime = Query(..., description="ISO 8601 end of the window (exclusive)"),
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> list[CalendarEvent]:
    return await get_calendar_events(request, org_id, start, end, current_user, db_session)
