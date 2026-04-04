"""
Admin API Router — Headless access to LearnHouse via API tokens.

All endpoints are scoped by org_slug and require API token authentication
(Bearer lh_...). The token's organization must match the org_slug in the URL.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.courses.courses import CourseRead, FullCourseRead
from src.db.trails import TrailRead
from src.db.users import APITokenUser, UserRead
from src.security.auth import get_current_user
from src.services.admin.admin import (
    _require_api_token,
    _resolve_org_slug,
    check_course_access,
    complete_activity,
    complete_course,
    enroll_user,
    get_activity,
    get_all_user_progress,
    get_chapter,
    get_chapter_activities,
    get_collection,
    get_course,
    get_course_structure,
    get_user,
    get_user_certificates,
    get_user_courses,
    get_user_enrollments,
    get_user_progress,
    issue_user_token,
    list_collections,
    list_courses,
    list_users,
    uncomplete_activity,
    unenroll_user,
)


router = APIRouter()


# ── Response models for OpenAPI documentation ────────────────────────────────


class TokenResponse(BaseModel):
    """JWT token issued on behalf of a user."""
    access_token: str = Field(description="JWT access token")
    token_type: str = Field(default="bearer", description="Token type (always 'bearer')")
    user_id: int = Field(description="ID of the user the token was issued for")
    user_uuid: str = Field(description="UUID of the user")


class CourseAccessResponse(BaseModel):
    """Whether a user can access a course."""
    has_access: bool = Field(description="True if the user can access the course (public or enrolled)")
    is_enrolled: bool = Field(description="True if the user is enrolled in the course")
    is_public: bool = Field(description="True if the course is public")
    is_published: bool = Field(description="True if the course is published")


class ProgressResponse(BaseModel):
    """User's progress in a specific course."""
    course_uuid: str
    user_id: int
    total_activities: int = Field(description="Total number of activities in the course")
    completed_activities: int = Field(description="Number of activities the user has completed")
    completion_percentage: float = Field(description="Completion percentage (0-100)")
    completed_activity_ids: List[int] = Field(description="IDs of completed activities")


class ProgressSummaryItem(BaseModel):
    """Progress summary for a single course enrollment."""
    course_uuid: str
    course_name: str
    status: str = Field(description="Enrollment status (STATUS_IN_PROGRESS, STATUS_COMPLETED, etc.)")
    total_activities: int
    completed_activities: int
    completion_percentage: float
    enrolled_at: str


class ActivityCompletionResponse(BaseModel):
    """Result of marking an activity as completed."""
    activity_uuid: str
    user_id: int
    completed: bool
    is_new_completion: bool = Field(description="True if this was a new completion (not already completed)")
    course_completed: bool = Field(description="True if this completion finished the entire course")


class ActivityUncompletionResponse(BaseModel):
    """Result of removing an activity completion."""
    activity_uuid: str
    user_id: int
    completed: bool = Field(default=False)


class CourseCompletionResponse(BaseModel):
    """Result of marking an entire course as completed."""
    course_uuid: str
    user_id: int
    completed_count: int = Field(description="Number of newly completed activities")
    already_completed_count: int = Field(description="Number of activities that were already completed")
    total_activities: int
    course_completed: bool
    certificate_awarded: bool = Field(description="True if a certificate was awarded as a result")


class UnenrollResponse(BaseModel):
    detail: str


class CertificateCourseInfo(BaseModel):
    id: Optional[int] = None
    course_uuid: str
    name: str
    description: Optional[str] = None
    thumbnail_image: Optional[str] = None


class CertificateItem(BaseModel):
    """A user's certificate with certification and course info."""
    certificate_user: dict
    certification: dict
    course: CertificateCourseInfo


class IssueTokenRequest(BaseModel):
    """Request body for issuing a user token."""
    user_id: int = Field(description="ID of the user to issue a token for")


# ── Auth endpoints ───────────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/auth/token",
    response_model=TokenResponse,
    summary="Issue a user token",
    description=(
        "Issue a JWT access token on behalf of a user. The user must belong to "
        "the organization matching the org_slug. Requires `users.action_read` permission."
    ),
    responses={
        403: {"description": "API token lacks permission, user not in org, or org_slug mismatch"},
        404: {"description": "User or organization not found"},
    },
)
async def api_admin_issue_token(
    org_slug: str,
    body: IssueTokenRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> TokenResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await issue_user_token(token_user, body.user_id, db_session)
    return TokenResponse(**result)


# ── User endpoints ───────────────────────────────────────────────────────────


@router.get(
    "/{org_slug}/users",
    response_model=List[UserRead],
    summary="List organization users",
    description=(
        "List all users in the organization with pagination. "
        "Requires `users.action_read` permission."
    ),
)
async def api_admin_list_users(
    org_slug: str,
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(25, ge=1, le=100, description="Items per page"),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[UserRead]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await list_users(token_user, db_session, page=page, limit=limit)


@router.get(
    "/{org_slug}/users/{user_id}",
    response_model=UserRead,
    summary="Get user profile",
    description=(
        "Get a user's profile by ID. The user must belong to the organization. "
        "Requires `users.action_read` permission."
    ),
    responses={404: {"description": "User not found"}},
)
async def api_admin_get_user(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_user(token_user, user_id, db_session)


@router.get(
    "/{org_slug}/users/{user_id}/courses",
    response_model=List[CourseRead],
    summary="Get user's enrolled courses",
    description=(
        "List all courses a user is enrolled in within the organization. "
        "Requires `courses.action_read` permission."
    ),
)
async def api_admin_get_user_courses(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[CourseRead]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_user_courses(token_user, user_id, db_session)


# ── Course endpoints (read-only) ─────────────────────────────────────────────


@router.get(
    "/{org_slug}/courses",
    response_model=List[CourseRead],
    summary="List courses",
    description=(
        "List courses in the organization. "
        "By default only published courses are returned. "
        "Requires `courses.action_read` permission."
    ),
)
async def api_admin_list_courses(
    request: Request,
    org_slug: str,
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(25, ge=1, le=100, description="Items per page"),
    published_only: bool = Query(True, description="Only return published courses"),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[CourseRead]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await list_courses(request, token_user, db_session, page=page, limit=limit, published_only=published_only)


@router.get(
    "/{org_slug}/courses/{course_uuid}",
    response_model=CourseRead,
    summary="Get course details",
    description=(
        "Get a single course by UUID. Returns course metadata, authors, and settings. "
        "Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Course not found or not in this organization"}},
)
async def api_admin_get_course(
    request: Request,
    org_slug: str,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CourseRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_course(request, token_user, course_uuid, db_session)


@router.get(
    "/{org_slug}/courses/{course_uuid}/structure",
    response_model=FullCourseRead,
    summary="Get course structure",
    description=(
        "Get a course with its full chapter and activity tree. "
        "Use `slim=true` to exclude heavy activity content (useful for navigation). "
        "Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Course not found"}},
)
async def api_admin_get_course_structure(
    request: Request,
    org_slug: str,
    course_uuid: str,
    slim: bool = Query(False, description="Exclude heavy activity content for lighter responses"),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> FullCourseRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_course_structure(request, token_user, course_uuid, db_session, slim=slim)


@router.get(
    "/{org_slug}/courses/{course_uuid}/access/{user_id}",
    response_model=CourseAccessResponse,
    summary="Check user course access",
    description=(
        "Check if a user can access a specific course. Returns enrollment status "
        "and whether the course is public. Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Course not found"}},
)
async def api_admin_check_course_access(
    org_slug: str,
    course_uuid: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CourseAccessResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await check_course_access(token_user, course_uuid, user_id, db_session)
    return CourseAccessResponse(**result)


# ── Collection endpoints (read-only) ─────────────────────────────────────────


@router.get(
    "/{org_slug}/collections",
    summary="List collections",
    description=(
        "List all course collections in the organization. "
        "Requires `collections.action_read` permission."
    ),
)
async def api_admin_list_collections(
    org_slug: str,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await list_collections(token_user, db_session, page=page, limit=limit)


@router.get(
    "/{org_slug}/collections/{collection_uuid}",
    summary="Get collection",
    description=(
        "Get a single collection with its courses. "
        "Requires `collections.action_read` permission."
    ),
    responses={404: {"description": "Collection not found"}},
)
async def api_admin_get_collection(
    org_slug: str,
    collection_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_collection(token_user, collection_uuid, db_session)


# ── Content endpoints (read-only) ────────────────────────────────────────────


@router.get(
    "/{org_slug}/chapters/{chapter_id}",
    summary="Get chapter",
    description=(
        "Get a chapter by ID with its activities. "
        "Requires `coursechapters.action_read` permission."
    ),
    responses={404: {"description": "Chapter not found"}},
)
async def api_admin_get_chapter(
    org_slug: str,
    chapter_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_chapter(token_user, chapter_id, db_session)


@router.get(
    "/{org_slug}/activities/{activity_uuid}",
    summary="Get activity",
    description=(
        "Get a single activity by UUID with its full content. "
        "Requires `activities.action_read` permission."
    ),
    responses={404: {"description": "Activity not found"}},
)
async def api_admin_get_activity(
    org_slug: str,
    activity_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_activity(token_user, activity_uuid, db_session)


@router.get(
    "/{org_slug}/chapters/{chapter_id}/activities",
    summary="List chapter activities",
    description=(
        "Get all published activities in a chapter, ordered by position. "
        "Requires `activities.action_read` permission."
    ),
    responses={404: {"description": "Chapter not found"}},
)
async def api_admin_get_chapter_activities(
    org_slug: str,
    chapter_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_chapter_activities(token_user, chapter_id, db_session)


# ── Enrollment endpoints ─────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/enrollments/{user_id}/{course_uuid}",
    response_model=TrailRead,
    summary="Enroll user in course",
    description=(
        "Enroll a user in a course on their behalf. Creates the learning trail "
        "and trail run. The user must belong to the organization. "
        "Requires `courses.action_read` permission."
    ),
    responses={
        400: {"description": "User is already enrolled"},
        404: {"description": "User or course not found"},
    },
)
async def api_admin_enroll_user(
    request: Request,
    org_slug: str,
    user_id: int,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> TrailRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await enroll_user(request, token_user, user_id, course_uuid, db_session)


@router.delete(
    "/{org_slug}/enrollments/{user_id}/{course_uuid}",
    response_model=UnenrollResponse,
    summary="Unenroll user from course",
    description=(
        "Unenroll a user from a course. Removes the enrollment and all associated "
        "progress (trail steps). Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Enrollment not found"}},
)
async def api_admin_unenroll_user(
    org_slug: str,
    user_id: int,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UnenrollResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await unenroll_user(token_user, user_id, course_uuid, db_session)
    return UnenrollResponse(**result)


@router.get(
    "/{org_slug}/enrollments/{user_id}",
    response_model=TrailRead,
    summary="Get user enrollments",
    description=(
        "Get all course enrollments for a user in the organization, "
        "including trail runs and steps. Requires `courses.action_read` permission."
    ),
)
async def api_admin_get_user_enrollments(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> TrailRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_user_enrollments(token_user, user_id, db_session)


# ── Progress endpoints ───────────────────────────────────────────────────────


@router.get(
    "/{org_slug}/progress/{user_id}/{course_uuid}",
    response_model=ProgressResponse,
    summary="Get user progress in course",
    description=(
        "Get a user's progress in a specific course including completion percentage "
        "and list of completed activity IDs. Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Course not found"}},
)
async def api_admin_get_user_progress(
    org_slug: str,
    user_id: int,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ProgressResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await get_user_progress(token_user, user_id, course_uuid, db_session)
    return ProgressResponse(**result)


@router.post(
    "/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete",
    response_model=ActivityCompletionResponse,
    summary="Mark activity as completed",
    description=(
        "Mark an activity as completed on behalf of a user. Automatically creates "
        "enrollment if needed. If this completes the entire course, a certificate "
        "is awarded (if configured). Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Activity not found"}},
)
async def api_admin_complete_activity(
    request: Request,
    org_slug: str,
    user_id: int,
    activity_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ActivityCompletionResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await complete_activity(request, token_user, user_id, activity_uuid, db_session)
    return ActivityCompletionResponse(**result)


@router.delete(
    "/{org_slug}/progress/{user_id}/activities/{activity_uuid}/complete",
    response_model=ActivityUncompletionResponse,
    summary="Undo activity completion",
    description=(
        "Remove a user's activity completion. Does not revoke certificates. "
        "Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Activity not found"}},
)
async def api_admin_uncomplete_activity(
    org_slug: str,
    user_id: int,
    activity_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ActivityUncompletionResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await uncomplete_activity(token_user, user_id, activity_uuid, db_session)
    return ActivityUncompletionResponse(**result)


@router.post(
    "/{org_slug}/progress/{user_id}/{course_uuid}/complete",
    response_model=CourseCompletionResponse,
    summary="Mark entire course as completed",
    description=(
        "Mark all activities in a course as completed for a user. Skips activities "
        "that are already completed. Awards a certificate if configured. "
        "Requires `courses.action_read` permission."
    ),
    responses={404: {"description": "Course not found"}},
)
async def api_admin_complete_course(
    request: Request,
    org_slug: str,
    user_id: int,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CourseCompletionResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await complete_course(request, token_user, user_id, course_uuid, db_session)
    return CourseCompletionResponse(**result)


@router.get(
    "/{org_slug}/progress/{user_id}",
    response_model=List[ProgressSummaryItem],
    summary="Get all user progress",
    description=(
        "Get a progress summary across all courses a user is enrolled in. "
        "Returns completion percentage and status for each enrollment. "
        "Requires `courses.action_read` permission."
    ),
)
async def api_admin_get_all_user_progress(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[ProgressSummaryItem]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    results = await get_all_user_progress(token_user, user_id, db_session)
    return [ProgressSummaryItem(**r) for r in results]


# ── Certification endpoints (read-only) ──────────────────────────────────────


@router.get(
    "/{org_slug}/certifications/{user_id}",
    response_model=List[CertificateItem],
    summary="Get user certificates",
    description=(
        "Get all certificates awarded to a user in the organization. "
        "Includes certification details and course information. "
        "Requires `certifications.action_read` permission."
    ),
)
async def api_admin_get_user_certificates(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[CertificateItem]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    results = await get_user_certificates(token_user, user_id, db_session)
    return [CertificateItem(**r) for r in results]
