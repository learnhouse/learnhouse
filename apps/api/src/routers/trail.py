from fastapi import APIRouter, Depends, Request
from src.core.events.database import get_db_session
from src.db.trails import TrailCreate, TrailRead
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
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


router = APIRouter(dependencies=[Depends(require_courses_feature)])


@router.post(
    "/start",
    response_model=Trail,
    summary="Start a trail",
    description="Create a new learning trail for the current user within an organization.",
    responses={
        200: {"description": "Trail created successfully.", "model": Trail},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have permission to create a trail"},
        404: {"description": "Organization not found"},
    },
)
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


@router.get(
    "/",
    response_model=TrailRead,
    summary="Get current user's trails",
    description="Retrieve the learning trails associated with the currently authenticated user.",
    responses={
        200: {"description": "User trails retrieved.", "model": TrailRead},
        401: {"description": "Authentication required"},
        404: {"description": "Trail not found for user"},
    },
)
async def api_get_user_trail(
    request: Request,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Get a user trails
    """
    return await get_user_trails(request, user=user, db_session=db_session)


@router.get(
    "/org/{org_id}/trail",
    response_model=TrailRead,
    summary="Get user trail by organization",
    description="Retrieve the current user's learning trail scoped to a specific organization.",
    responses={
        200: {"description": "User trail for the organization.", "model": TrailRead},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have access to this organization's trail"},
        404: {"description": "Trail or organization not found"},
    },
)
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


@router.post(
    "/add_course/{course_uuid}",
    response_model=TrailRead,
    summary="Add course to trail",
    description="Attach a course to the current user's learning trail.",
    responses={
        200: {"description": "Course added to trail.", "model": TrailRead},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have access to this course"},
        404: {"description": "Course or trail not found"},
    },
)
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


@router.delete(
    "/remove_course/{course_uuid}",
    response_model=TrailRead,
    summary="Remove course from trail",
    description="Detach a course from the current user's learning trail.",
    responses={
        200: {"description": "Course removed from trail.", "model": TrailRead},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have permission to modify this trail"},
        404: {"description": "Course or trail not found"},
    },
)
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


@router.post(
    "/add_activity/{activity_uuid}",
    response_model=TrailRead,
    summary="Add activity to trail",
    description="Attach an activity to the current user's learning trail, marking it as started.",
    responses={
        200: {"description": "Activity added to trail.", "model": TrailRead},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have access to this activity"},
        404: {"description": "Activity or trail not found"},
    },
)
async def api_add_activity_to_trail(
    request: Request,
    activity_uuid: str,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> TrailRead:
    """
    Add Activity to trail
    """
    return await add_activity_to_trail(
        request, user, activity_uuid, db_session
    )


@router.delete(
    "/remove_activity/{activity_uuid}",
    response_model=TrailRead,
    summary="Remove activity from trail",
    description="Detach an activity from the current user's learning trail.",
    responses={
        200: {"description": "Activity removed from trail.", "model": TrailRead},
        401: {"description": "Authentication required"},
        403: {"description": "User does not have permission to modify this trail"},
        404: {"description": "Activity or trail not found"},
    },
)
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
