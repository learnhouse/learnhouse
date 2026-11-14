"""Member side panel on the dashboard Users page (see services/orgs/member_panel.py)."""

from fastapi import APIRouter, Depends, Query
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user, get_current_user
from src.services.orgs.member_enrollments import MemberUnenrollmentResult, unenroll_org_member
from src.services.orgs.member_panel import (
    get_member_activity,
    get_member_assignments,
    get_member_summary,
)

router = APIRouter()

_ERRORS = {
    401: {"description": "Not authenticated"},
    403: {"description": "Caller is not an admin or maintainer of this organization"},
    404: {"description": "User is not a member of this organization"},
}


@router.get(
    "/{org_id}/users/{user_id}/summary",
    summary="A member at a glance",
    description=(
        "Everything the member panel shows first, in one call: the member, role, groups, "
        "two-factor state, learning numbers, enrolled courses with progress, certificates, "
        "a 30-day activity strip and the latest learning events. Scoped to this organization. "
        "Admins and maintainers only."
    ),
    responses={200: {"description": "The member summary."}, **_ERRORS},
)
async def api_get_member_summary(
    org_id: int,
    user_id: int,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await get_member_summary(org_id, user_id, current_user, db_session)


@router.get(
    "/{org_id}/users/{user_id}/assignments",
    summary="A member's assignment submissions",
    description=(
        "The member's submissions in this organization, newest first (up to 100), with "
        "status, grade and any AI grade draft. Admins and maintainers only."
    ),
    responses={200: {"description": "Submissions."}, **_ERRORS},
)
async def api_get_member_assignments(
    org_id: int,
    user_id: int,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await get_member_assignments(org_id, user_id, current_user, db_session)


@router.get(
    "/{org_id}/users/{user_id}/activity",
    summary="A member's learning activity",
    description=(
        "The member's learning events in this organization (enrollments, completions, "
        "submissions, grades, certificates), newest first. Admins and maintainers only."
    ),
    responses={200: {"description": "A page of events."}, **_ERRORS},
)
async def api_get_member_activity(
    org_id: int,
    user_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=50),
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    return await get_member_activity(org_id, user_id, current_user, db_session, offset, limit)


@router.delete(
    "/{org_id}/users/{user_id}/enrollments/{course_uuid}",
    response_model=MemberUnenrollmentResult,
    summary="Unenroll a member from a course",
    description=(
        "Take a member out of one of the organization's courses from a signed-in admin or "
        "maintainer session. The enrollment and the member's progress in the course are removed."
    ),
    responses={
        200: {"description": "Member unenrolled.", "model": MemberUnenrollmentResult},
        **_ERRORS,
    },
)
async def api_unenroll_org_member(
    org_id: int,
    user_id: int,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> MemberUnenrollmentResult:
    return await unenroll_org_member(org_id, user_id, course_uuid, current_user, db_session)
