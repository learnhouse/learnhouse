"""
Admin API Router — Headless access to LearnHouse via API tokens.

All endpoints are scoped by org_slug and require API token authentication
(Bearer lh_...). The token's organization must match the org_slug in the URL.
"""

import os
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.trails import TrailRead
from src.db.users import UserRead
from src.routers.auth import set_auth_cookies
from src.security.auth import get_current_user
from src.services.admin.admin import (
    _require_api_token,
    _resolve_org_slug,
    add_course_to_usergroup,
    add_usergroup_member,
    anonymize_user,
    award_certificate,
    bulk_enroll_users,
    bulk_unenroll_users,
    change_user_role,
    check_course_access,
    complete_activity,
    complete_course,
    consume_magic_link_token,
    create_usergroup,
    delete_usergroup,
    enroll_user,
    export_user_data,
    get_all_user_progress,
    get_course_analytics,
    get_user_by_email,
    get_user_certificates,
    get_user_enrollments,
    get_user_groups,
    get_user_progress,
    issue_magic_link,
    issue_user_token,
    list_course_enrollments,
    list_usergroup_members,
    provision_user,
    remove_course_from_usergroup,
    remove_usergroup_member,
    remove_user_from_org_admin,
    reset_user_progress,
    revoke_certificate,
    uncomplete_activity,
    unenroll_user,
    update_user_profile,
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


class ProvisionUserRequest(BaseModel):
    """Request body for provisioning a new user."""
    email: EmailStr
    username: str = Field(min_length=1)
    first_name: str = ""
    last_name: str = ""
    password: Optional[str] = Field(default=None, description="Optional — if omitted, treated as SSO user with empty password")
    role_id: int = Field(default=4, description="Role id for the org membership (default 4 = student)")


class RemoveUserResponse(BaseModel):
    detail: str


class MagicLinkRequest(BaseModel):
    """Request body for issuing a magic sign-in link."""
    user_id: int
    redirect_to: Optional[str] = Field(default=None, description="Path to redirect to after the user lands on the consume endpoint")
    ttl_seconds: int = Field(default=300, ge=60, le=900, description="Token lifetime in seconds (60–900)")


class MagicLinkResponse(BaseModel):
    url: str = Field(description="Clickable URL to deliver to the user")
    token: str = Field(description="Raw JWT (for integrations that prefer to build their own URL)")
    expires_at: str = Field(description="ISO8601 timestamp when the token expires")


class BulkEnrollRequest(BaseModel):
    """Request body for bulk enrolling users into a course."""
    course_uuid: str
    user_ids: List[int] = Field(max_length=500, description="List of user ids to enroll (max 500)")


class BulkEnrollResponse(BaseModel):
    enrolled: List[int] = Field(description="User ids that were newly enrolled")
    already_enrolled: List[int] = Field(description="User ids that already had an enrollment")
    skipped: List[int] = Field(description="User ids that were not members of the org")


class CourseEnrollmentItem(BaseModel):
    """A single row in a course enrollment listing."""
    user: Dict[str, Any]
    enrolled_at: str
    status: str


class ResetProgressResponse(BaseModel):
    course_uuid: str
    user_id: int
    steps_deleted: int


class AwardCertificateResponse(BaseModel):
    user_certification_uuid: str
    user_id: int
    course_uuid: str


class RevokeCertificateResponse(BaseModel):
    detail: str
    user_certification_uuid: str


class UserGroupMemberResponse(BaseModel):
    detail: str
    usergroup_uuid: str
    user_id: int


class UpdateUserRequest(BaseModel):
    """Fields that can be updated via the admin profile PATCH."""
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    avatar_image: Optional[str] = None
    bio: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    profile: Optional[Dict[str, Any]] = None


class ChangeRoleRequest(BaseModel):
    role_id: int = Field(description="Target role id")


class ChangeRoleResponse(BaseModel):
    user_id: int
    role_id: int


class CreateUserGroupRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class DeleteUserGroupResponse(BaseModel):
    detail: str
    usergroup_uuid: str


class UserGroupMemberListItem(BaseModel):
    user: Dict[str, Any]
    added_at: str


class UserUserGroupItem(BaseModel):
    usergroup: Dict[str, Any]
    added_at: str


class UserGroupCourseResponse(BaseModel):
    detail: str
    usergroup_uuid: str
    course_uuid: str


class BulkUnenrollRequest(BaseModel):
    course_uuid: str
    user_ids: List[int] = Field(max_length=500)


class BulkUnenrollResponse(BaseModel):
    unenrolled: List[int]
    not_enrolled: List[int]


class AnonymizeUserResponse(BaseModel):
    detail: str
    user_id: int
    anonymized_email: str
    api_tokens_revoked: int


class CourseAnalyticsResponse(BaseModel):
    course_uuid: str
    enrollment_count: int
    completed_count: int
    in_progress_count: int
    total_activities: int
    average_completion_percentage: float
    certificate_count: int


class UserGroupResponse(BaseModel):
    """A user group / cohort."""
    id: int
    org_id: int
    usergroup_uuid: str
    name: str
    description: str
    creation_date: str
    update_date: str


class UserDataExportResponse(BaseModel):
    """Full GDPR data export bundle."""
    profile: Dict[str, Any] = Field(description="The user's profile (scrubbed of sensitive fields)")
    memberships: List[Dict[str, Any]] = Field(description="Org memberships scoped to the caller's org")
    trails: List[Dict[str, Any]] = Field(description="Learning trails in the caller's org")
    trail_runs: List[Dict[str, Any]] = Field(description="Course enrollments / trail runs")
    trail_steps: List[Dict[str, Any]] = Field(description="Activity completions")
    certificates: List[Dict[str, Any]] = Field(description="Certificates awarded in the caller's org")
    user_groups: List[Dict[str, Any]] = Field(description="Cohort memberships in the caller's org")
    exported_at: str = Field(description="ISO8601 timestamp when the export was generated")


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
        200: {"description": "Access token minted on behalf of the target user.", "model": TokenResponse},
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


# ── Course access ────────────────────────────────────────────────────────────


@router.get(
    "/{org_slug}/courses/{course_uuid}/access/{user_id}",
    response_model=CourseAccessResponse,
    summary="Check user course access",
    description=(
        "Check if a user can access a specific course. Returns enrollment status "
        "and whether the course is public. Requires `courses.action_read` permission."
    ),
    responses={
        200: {"description": "Access check result — whether the user can view the course.", "model": CourseAccessResponse},
        404: {"description": "Course not found"},
    },
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
        200: {"description": "User enrolled — returns the user's updated trail with all runs.", "model": TrailRead},
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
    responses={
        200: {"description": "User unenrolled — trail steps for this course are deleted.", "model": UnenrollResponse},
        404: {"description": "Enrollment not found"},
    },
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
    responses={
        200: {"description": "The user's trail with every course enrollment and step.", "model": TrailRead},
    },
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
    responses={
        200: {"description": "Progress summary (completion percentage + completed activity ids).", "model": ProgressResponse},
        404: {"description": "Course not found"},
    },
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
    responses={
        200: {"description": "Activity marked complete; includes whether this completed the course.", "model": ActivityCompletionResponse},
        404: {"description": "Activity not found"},
    },
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
    responses={
        200: {"description": "Activity completion removed.", "model": ActivityUncompletionResponse},
        404: {"description": "Activity not found"},
    },
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
    responses={
        200: {"description": "All activities marked complete; indicates whether a certificate was awarded.", "model": CourseCompletionResponse},
        404: {"description": "Course not found"},
    },
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
    responses={
        200: {"description": "One row per course enrollment with completion percentage and status."},
    },
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
    responses={
        200: {"description": "All certificates awarded to the user in this org."},
    },
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


# ── User provisioning ────────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/users",
    response_model=UserRead,
    summary="Provision a user",
    description=(
        "Create a user and attach them to the organization in one call. Designed "
        "for SSO/JIT provisioning — the user's email is auto-verified and the "
        "normal email-verification flow is skipped."
    ),
    responses={
        200: {"description": "User created and attached to the org. Returns the provisioned user.", "model": UserRead},
        400: {"description": "Duplicate email/username or weak password"},
        403: {"description": "Member limit reached or feature disabled"},
    },
)
async def api_admin_provision_user(
    request: Request,
    org_slug: str,
    body: ProvisionUserRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await provision_user(
        token_user=token_user,
        email=body.email,
        username=body.username,
        first_name=body.first_name,
        last_name=body.last_name,
        password=body.password,
        role_id=body.role_id,
        request=request,
        db_session=db_session,
    )


@router.delete(
    "/{org_slug}/users/{user_id}",
    response_model=RemoveUserResponse,
    summary="Remove a user from the organization",
    description=(
        "Remove a user's organization membership. The user account itself is "
        "preserved (it may belong to other orgs). Blocks removing the last admin."
    ),
    responses={
        200: {"description": "Membership removed. The user account is preserved.", "model": RemoveUserResponse},
        400: {"description": "User is the last admin"},
        404: {"description": "User not in org"},
    },
)
async def api_admin_remove_user(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> RemoveUserResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await remove_user_from_org_admin(token_user, user_id, db_session)
    return RemoveUserResponse(**result)


@router.get(
    "/{org_slug}/users/by-email/{email}",
    response_model=UserRead,
    summary="Look up a user by email",
    description=(
        "Find a user by email within the organization. Returns 404 if the user "
        "does not exist or is not a member of this org."
    ),
    responses={
        200: {"description": "The user matching the given email within this org.", "model": UserRead},
        404: {"description": "User not found in this organization"},
    },
)
async def api_admin_get_user_by_email(
    org_slug: str,
    email: str = Path(description="URL-encoded email address"),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    return await get_user_by_email(token_user, email, db_session)


# ── Magic link ───────────────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/auth/magic-link",
    response_model=MagicLinkResponse,
    summary="Issue a magic sign-in link",
    description=(
        "Generate a short-lived URL that, when opened in a browser, will log "
        "the target user in and optionally redirect them to a specific path. "
        "Token lifetime is clamped to 60–900 seconds."
    ),
    responses={
        200: {"description": "Magic sign-in URL and underlying JWT. Token lifetime is already clamped.", "model": MagicLinkResponse},
        400: {"description": "redirect_to is not a same-origin path"},
        403: {"description": "User not in this org"},
        404: {"description": "User not found"},
    },
)
async def api_admin_issue_magic_link(
    request: Request,
    org_slug: str,
    body: MagicLinkRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> MagicLinkResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await issue_magic_link(
        token_user=token_user,
        user_id=body.user_id,
        redirect_to=body.redirect_to,
        ttl_seconds=body.ttl_seconds,
        org_slug=org_slug,
        request=request,
        db_session=db_session,
    )
    return MagicLinkResponse(**result)


def _support_url() -> str:
    """Return the LearnHouse support page URL (platform URL, not org-specific)."""
    platform = os.environ.get("LEARNHOUSE_PLATFORM_URL", "https://www.learnhouse.app").rstrip("/")
    return f"{platform}/dashboard/support"


def _render_magic_link_error(title: str, message: str) -> HTMLResponse:
    """Render a friendly HTML error page when a magic link fails."""
    support = _support_url()
    # Plain HTML — no templating dependency. Values are hardcoded/escaped.
    # title/message come from our own HTTPExceptions, not user input.
    safe_title = title.replace("<", "&lt;").replace(">", "&gt;")
    safe_message = message.replace("<", "&lt;").replace(">", "&gt;")
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign-in link — LearnHouse</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #f6f7f9; color: #111827; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }}
  .card {{ background: #fff; border-radius: 14px; padding: 40px 36px; max-width: 440px;
           box-shadow: 0 10px 30px rgba(17,24,39,0.08); text-align: center; }}
  h1 {{ font-size: 22px; margin: 0 0 12px; color: #111827; }}
  p  {{ font-size: 15px; line-height: 1.55; color: #4b5563; margin: 0 0 24px; }}
  .support {{ display: inline-block; background: #111827; color: #fff !important;
              text-decoration: none; padding: 11px 20px; border-radius: 999px;
              font-weight: 500; font-size: 14px; }}
  .support:hover {{ background: #1f2937; }}
  .hint {{ font-size: 13px; color: #9ca3af; margin-top: 20px; }}
</style>
</head>
<body>
  <div class="card">
    <h1>{safe_title}</h1>
    <p>{safe_message}</p>
    <a class="support" href="{support}">Something not working as expected?</a>
    <p class="hint">Our team can re-issue your sign-in link or help you access your account.</p>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=410)


@router.get(
    "/{org_slug}/auth/magic-consume",
    summary="Consume a magic sign-in link (browser-facing)",
    description=(
        "Public endpoint — no API token required. Validates the magic-link "
        "JWT from the query string, sets authentication cookies, and redirects "
        "to the target path. On error, renders a friendly HTML page with a "
        "support link instead of a raw JSON error."
    ),
    responses={
        302: {"description": "Success — cookies set and redirect to target"},
        410: {"description": "Token invalid, expired, or user no longer a member (HTML page)"},
    },
)
async def api_admin_magic_consume(
    request: Request,
    response: Response,
    org_slug: str,
    token: str = Query(..., description="Magic-link JWT"),
    db_session: Session = Depends(get_db_session),
):
    try:
        _user, access_token, refresh_token, redirect_to = await consume_magic_link_token(
            token=token,
            db_session=db_session,
        )
    except HTTPException as exc:
        return _render_magic_link_error(
            title="This sign-in link can't be used",
            message=str(exc.detail) if exc.detail else "The link may have expired or already been used.",
        )

    target = redirect_to or "/"
    redirect = RedirectResponse(url=target, status_code=302)
    set_auth_cookies(redirect, access_token, refresh_token, request)
    return redirect


# ── Bulk enrollment ──────────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/enrollments/bulk",
    response_model=BulkEnrollResponse,
    summary="Bulk enroll users in a course",
    description=(
        "Enroll a batch of users into a single course. Users who are already "
        "enrolled are reported in `already_enrolled`. Users who are not members "
        "of the org are reported in `skipped`."
    ),
    responses={
        200: {"description": "Per-user enrollment summary: enrolled, already_enrolled, skipped.", "model": BulkEnrollResponse},
        404: {"description": "Course not found"},
    },
)
async def api_admin_bulk_enroll(
    request: Request,
    org_slug: str,
    body: BulkEnrollRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> BulkEnrollResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await bulk_enroll_users(
        token_user=token_user,
        course_uuid=body.course_uuid,
        user_ids=body.user_ids,
        request=request,
        db_session=db_session,
    )
    return BulkEnrollResponse(**result)


@router.get(
    "/{org_slug}/courses/{course_uuid}/enrollments",
    response_model=List[CourseEnrollmentItem],
    summary="List users enrolled in a course",
    description=(
        "Reverse lookup: get all users currently enrolled in a course, with "
        "pagination. Returns enrollment status and enrolled_at per user."
    ),
    responses={
        200: {"description": "One row per enrolled user in this course, with status and enrolled_at."},
        404: {"description": "Course not found"},
    },
)
async def api_admin_list_course_enrollments(
    org_slug: str,
    course_uuid: str,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[CourseEnrollmentItem]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    results = await list_course_enrollments(
        token_user, course_uuid, db_session, page=page, limit=limit
    )
    return [CourseEnrollmentItem(**r) for r in results]


# ── Progress reset ───────────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/progress/{user_id}/{course_uuid}/reset",
    response_model=ResetProgressResponse,
    summary="Reset a user's progress in a course",
    description=(
        "Delete all of a user's trail steps for a course, keeping the "
        "enrollment intact. The user can retake the course from scratch."
    ),
    responses={
        200: {"description": "Returns the number of trail steps deleted for this user/course.", "model": ResetProgressResponse},
        404: {"description": "User or course not found"},
    },
)
async def api_admin_reset_user_progress(
    org_slug: str,
    user_id: int,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ResetProgressResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await reset_user_progress(token_user, user_id, course_uuid, db_session)
    return ResetProgressResponse(**result)


# ── Certificate award / revoke ───────────────────────────────────────────────


@router.post(
    "/{org_slug}/certifications/{user_id}/{course_uuid}/award",
    response_model=AwardCertificateResponse,
    summary="Manually award a certificate",
    description=(
        "Award a certificate to a user bypassing the normal completion gate. "
        "Useful for migrations and manual overrides. The course must have a "
        "certification configured."
    ),
    responses={
        200: {"description": "Certificate awarded; returns the new user_certification_uuid.", "model": AwardCertificateResponse},
        400: {"description": "User already has a certificate for this course"},
        404: {"description": "Course or certification not found"},
    },
)
async def api_admin_award_certificate(
    request: Request,
    org_slug: str,
    user_id: int,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> AwardCertificateResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await award_certificate(
        token_user, user_id, course_uuid, request, db_session
    )
    return AwardCertificateResponse(**result)


@router.delete(
    "/{org_slug}/certifications/{user_id}/{user_certification_uuid}",
    response_model=RevokeCertificateResponse,
    summary="Revoke a user's certificate",
    description="Delete a certificate row. Does not affect course enrollment or progress.",
    responses={
        200: {"description": "Certificate revoked. The cert row is hard-deleted.", "model": RevokeCertificateResponse},
        404: {"description": "Certificate not found"},
    },
)
async def api_admin_revoke_certificate(
    org_slug: str,
    user_id: int,
    user_certification_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> RevokeCertificateResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await revoke_certificate(
        token_user, user_id, user_certification_uuid, db_session
    )
    return RevokeCertificateResponse(**result)


# ── User group membership ────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}",
    response_model=UserGroupMemberResponse,
    summary="Add a user to a user group",
    description="Add a user to a cohort/group. Both must belong to the token's org.",
    responses={
        200: {"description": "User added to the cohort.", "model": UserGroupMemberResponse},
        400: {"description": "User is already in this group"},
        404: {"description": "User or group not found"},
    },
)
async def api_admin_add_usergroup_member(
    org_slug: str,
    usergroup_uuid: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserGroupMemberResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await add_usergroup_member(
        token_user, usergroup_uuid, user_id, db_session
    )
    return UserGroupMemberResponse(**result)


@router.delete(
    "/{org_slug}/usergroups/{usergroup_uuid}/members/{user_id}",
    response_model=UserGroupMemberResponse,
    summary="Remove a user from a user group",
    responses={
        200: {"description": "User removed from the cohort.", "model": UserGroupMemberResponse},
        404: {"description": "User, group, or membership not found"},
    },
)
async def api_admin_remove_usergroup_member(
    org_slug: str,
    usergroup_uuid: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserGroupMemberResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await remove_usergroup_member(
        token_user, usergroup_uuid, user_id, db_session
    )
    return UserGroupMemberResponse(**result)


# ── User profile and role updates ────────────────────────────────────────────


@router.patch(
    "/{org_slug}/users/{user_id}",
    response_model=UserRead,
    summary="Update a user's profile",
    description=(
        "Update profile fields of an org member. Supports partial updates — "
        "only fields present in the request body are changed. Duplicate "
        "email/username is rejected."
    ),
    responses={
        200: {"description": "Updated user profile.", "model": UserRead},
        400: {"description": "Duplicate email or username"},
        404: {"description": "User not in org"},
    },
)
async def api_admin_update_user_profile(
    org_slug: str,
    user_id: int,
    body: UpdateUserRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserRead:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    updates = body.model_dump(exclude_unset=True)
    return await update_user_profile(token_user, user_id, updates, db_session)


@router.patch(
    "/{org_slug}/users/{user_id}/role",
    response_model=ChangeRoleResponse,
    summary="Change a user's org role",
    description=(
        "Change the user's role within the organization. Blocks demoting the "
        "last admin. The target role must belong to this org or be a global role."
    ),
    responses={
        200: {"description": "User role updated.", "model": ChangeRoleResponse},
        400: {"description": "Cannot demote the last admin"},
        403: {"description": "Role does not belong to this organization"},
        404: {"description": "User or role not found"},
    },
)
async def api_admin_change_user_role(
    org_slug: str,
    user_id: int,
    body: ChangeRoleRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ChangeRoleResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await change_user_role(token_user, user_id, body.role_id, db_session)
    return ChangeRoleResponse(**result)


# ── User group CRUD ──────────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/usergroups",
    response_model=UserGroupResponse,
    summary="Create a user group",
    description="Create a cohort/user group owned by the organization.",
    responses={
        200: {"description": "The newly created cohort.", "model": UserGroupResponse},
    },
)
async def api_admin_create_usergroup(
    org_slug: str,
    body: CreateUserGroupRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserGroupResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    group = await create_usergroup(token_user, body.name, body.description, db_session)
    return UserGroupResponse(**group.model_dump())


@router.delete(
    "/{org_slug}/usergroups/{usergroup_uuid}",
    response_model=DeleteUserGroupResponse,
    summary="Delete a user group",
    description=(
        "Delete a user group and all its memberships and course links. "
        "The underlying users and courses are untouched."
    ),
    responses={
        200: {"description": "Cohort and all its memberships/course links deleted.", "model": DeleteUserGroupResponse},
        404: {"description": "UserGroup not found"},
    },
)
async def api_admin_delete_usergroup(
    org_slug: str,
    usergroup_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DeleteUserGroupResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await delete_usergroup(token_user, usergroup_uuid, db_session)
    return DeleteUserGroupResponse(**result)


@router.get(
    "/{org_slug}/usergroups/{usergroup_uuid}/members",
    response_model=List[UserGroupMemberListItem],
    summary="List members of a user group",
    description="Reverse lookup: list users belonging to a cohort, with pagination.",
    responses={
        200: {"description": "Members of the cohort, paginated."},
        404: {"description": "UserGroup not found"},
    },
)
async def api_admin_list_usergroup_members(
    org_slug: str,
    usergroup_uuid: str,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[UserGroupMemberListItem]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    results = await list_usergroup_members(
        token_user, usergroup_uuid, db_session, page=page, limit=limit
    )
    return [UserGroupMemberListItem(**r) for r in results]


@router.get(
    "/{org_slug}/users/{user_id}/groups",
    response_model=List[UserUserGroupItem],
    summary="List user groups a user belongs to",
    description="Reverse lookup: which cohorts is this user a member of?",
    responses={
        200: {"description": "Cohorts the user belongs to within this org."},
        404: {"description": "User not in org"},
    },
)
async def api_admin_get_user_groups(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[UserUserGroupItem]:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    results = await get_user_groups(token_user, user_id, db_session)
    return [UserUserGroupItem(**r) for r in results]


# ── Cohort → course access ───────────────────────────────────────────────────


@router.post(
    "/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}",
    response_model=UserGroupCourseResponse,
    summary="Grant a cohort access to a course",
    description=(
        "Link a course to a user group — all members of the group gain the "
        "access rights configured for that group."
    ),
    responses={
        200: {"description": "Course linked to the cohort.", "model": UserGroupCourseResponse},
        400: {"description": "Course already linked to this group"},
        404: {"description": "Group or course not found"},
    },
)
async def api_admin_add_course_to_usergroup(
    org_slug: str,
    usergroup_uuid: str,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserGroupCourseResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await add_course_to_usergroup(
        token_user, usergroup_uuid, course_uuid, db_session
    )
    return UserGroupCourseResponse(**result)


@router.delete(
    "/{org_slug}/usergroups/{usergroup_uuid}/courses/{course_uuid}",
    response_model=UserGroupCourseResponse,
    summary="Revoke a cohort's access to a course",
    responses={
        200: {"description": "Course unlinked from the cohort.", "model": UserGroupCourseResponse},
        404: {"description": "Group or link not found"},
    },
)
async def api_admin_remove_course_from_usergroup(
    org_slug: str,
    usergroup_uuid: str,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserGroupCourseResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await remove_course_from_usergroup(
        token_user, usergroup_uuid, course_uuid, db_session
    )
    return UserGroupCourseResponse(**result)


# ── Bulk unenroll ────────────────────────────────────────────────────────────


@router.post(
    "/{org_slug}/enrollments/bulk/unenroll",
    response_model=BulkUnenrollResponse,
    summary="Bulk unenroll users from a course",
    description="Mirror of bulk enroll. Users not currently enrolled are reported in `not_enrolled`.",
    responses={
        200: {"description": "Per-user unenroll summary: unenrolled, not_enrolled.", "model": BulkUnenrollResponse},
        404: {"description": "Course not found"},
    },
)
async def api_admin_bulk_unenroll(
    org_slug: str,
    body: BulkUnenrollRequest,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> BulkUnenrollResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await bulk_unenroll_users(
        token_user=token_user,
        course_uuid=body.course_uuid,
        user_ids=body.user_ids,
        db_session=db_session,
    )
    return BulkUnenrollResponse(**result)


# ── GDPR export / anonymize ──────────────────────────────────────────────────


@router.get(
    "/{org_slug}/users/{user_id}/export",
    response_model=UserDataExportResponse,
    summary="Full GDPR data export for a user",
    description=(
        "Return a JSON bundle containing the user's profile, org memberships, "
        "trails, runs, steps, certificates, and cohort memberships. Intended "
        "for GDPR Article 15 (Right of Access) compliance. All sub-collections "
        "are scoped to the caller's org."
    ),
    responses={
        200: {"description": "Bundle of all user data scoped to this org.", "model": UserDataExportResponse},
        404: {"description": "User not in org"},
    },
)
async def api_admin_export_user_data(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> UserDataExportResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    bundle = await export_user_data(token_user, user_id, db_session)
    return UserDataExportResponse(**bundle)


@router.post(
    "/{org_slug}/users/{user_id}/anonymize",
    response_model=AnonymizeUserResponse,
    summary="GDPR right-to-be-forgotten",
    description=(
        "Scrub a user's PII (email, name, avatar, bio, details, profile, "
        "password). Delete API tokens the user created. Keeps trails and "
        "certificates so course analytics remain accurate. Invalidates "
        "session cache."
    ),
    responses={
        200: {"description": "User PII scrubbed; reports how many API tokens were revoked.", "model": AnonymizeUserResponse},
        404: {"description": "User not in org"},
    },
)
async def api_admin_anonymize_user(
    org_slug: str,
    user_id: int,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> AnonymizeUserResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await anonymize_user(token_user, user_id, db_session)
    return AnonymizeUserResponse(**result)


# ── Course analytics ─────────────────────────────────────────────────────────


@router.get(
    "/{org_slug}/courses/{course_uuid}/analytics",
    response_model=CourseAnalyticsResponse,
    summary="Aggregate stats for a course",
    description=(
        "Returns enrollment/completion counts, average completion percentage "
        "across all enrollees, and total certificates awarded."
    ),
    responses={
        200: {"description": "Aggregate course stats: enrollment, completion, certificates, etc.", "model": CourseAnalyticsResponse},
        404: {"description": "Course not found"},
    },
)
async def api_admin_get_course_analytics(
    org_slug: str,
    course_uuid: str,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CourseAnalyticsResponse:
    token_user = _require_api_token(current_user)
    _resolve_org_slug(org_slug, token_user, db_session)
    result = await get_course_analytics(token_user, course_uuid, db_session)
    return CourseAnalyticsResponse(**result)
