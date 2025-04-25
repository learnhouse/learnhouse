from fastapi import APIRouter, Depends, Request
from src.core.events.database import get_db_session
from src.db.trails import TrailCreate, TrailRead
from src.security.auth import get_current_user
from src.services.trail.trail import (
    Trail,
    add_activity_to_trail,
    add_course_to_trail,
    create_user_trail,
    get_user_trails,
    get_user_trail_with_orgid,
    remove_course_from_trail,
    remove_activity_from_trail,
)


router = APIRouter()


@router.post("/start")
async def api_start_trail(
    request: Request,
    trail_object: TrailCreate,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> Trail:
    """
    Start trail
    """
    return await create_user_trail(request, user, trail_object, db_session)


@router.get("/")
async def api_get_user_trail(
    request: Request,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Get a user trails
    """
    return await get_user_trails(request, user=user, db_session=db_session)


@router.get("/org/{org_id}/trail")
async def api_get_trail_by_org_id(
    request: Request,
    org_id: int,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Get a user trails using org slug
    """
    return await get_user_trail_with_orgid(
        request, user, org_id=org_id, db_session=db_session
    )


@router.post("/add_course/{course_uuid}")
async def api_add_course_to_trail(
    request: Request,
    course_uuid: str,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Add Course to trail
    """
    return await add_course_to_trail(request, user, course_uuid, db_session)


@router.delete("/remove_course/{course_uuid}")
async def api_remove_course_to_trail(
    request: Request,
    course_uuid: str,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Remove Course from trail
    """
    return await remove_course_from_trail(request, user, course_uuid, db_session)


@router.post("/add_activity/{activity_uuid}")
async def api_add_activity_to_trail(
    request: Request,
    activity_uuid: str,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Add Course to trail
    """
    return await add_activity_to_trail(
        request, user, activity_uuid, db_session
    )


@router.delete("/remove_activity/{activity_uuid}")
async def api_remove_activity_from_trail(
    request: Request,
    activity_uuid: str,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Remove Activity from trail
    """
    return await remove_activity_from_trail(request, user, activity_uuid, db_session)
