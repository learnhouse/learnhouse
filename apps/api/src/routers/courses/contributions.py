"""Course contributions: ``/api/v1/contributions``.

Suggested edits and feedback from the learner page, the review queue, and
credit. Permissions live in the service
(``src/services/courses/contributions/service.py``).
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.contributions import (
    ActivityContributionContext,
    ContributionSummary,
    ContributorList,
    ContributorRead,
    ContributorUpdate,
    FeedbackCreate,
    FeedbackList,
    FeedbackRead,
    FeedbackReply,
    FeedbackStatus,
    SettingsRead,
    SettingsUpdate,
    SuggestionAccept,
    SuggestionCreate,
    SuggestionDecision,
    SuggestionList,
    SuggestionRead,
    SuggestionRevise,
    UserContributions,
)
from src.security.auth import get_current_user
from src.services.courses.contributions import service as svc

router = APIRouter()

SuggestionFilter = Literal["open", "pending", "accepted", "rejected", "changes_requested", "withdrawn"]


# ─── course settings, queue, contributors ────────────────────────────────────


@router.get("/courses/{course_uuid}/settings", response_model=SettingsRead)
async def api_get_settings(
    request: Request, course_uuid: str,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """The course's contribution settings (people who may edit the course)."""
    return await svc.get_settings(request, course_uuid, current_user, db_session)


@router.put("/courses/{course_uuid}/settings", response_model=SettingsRead)
async def api_update_settings(
    request: Request, course_uuid: str, payload: SettingsUpdate,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Turn contributions on or off and pick who may contribute (course owners and admins)."""
    return await svc.update_settings(request, course_uuid, payload, current_user, db_session)


@router.get("/courses/{course_uuid}/summary", response_model=ContributionSummary)
async def api_summary(
    request: Request, course_uuid: str,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Counts for the review queue: pending suggestions, open feedback, contributors."""
    return await svc.get_summary(request, course_uuid, current_user, db_session)


@router.get("/courses/{course_uuid}/suggestions", response_model=SuggestionList)
async def api_course_suggestions(
    request: Request, course_uuid: str,
    status: Optional[SuggestionFilter] = Query(default=None),
    page: int = Query(default=1, ge=1, le=10_000),
    limit: int = Query(default=20, ge=1, le=100),
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """The review queue, newest first, with where each open suggestion lands on the page now."""
    return await svc.list_course_suggestions(request, course_uuid, current_user, db_session, status, page, limit)


@router.get("/courses/{course_uuid}/feedback", response_model=FeedbackList)
async def api_course_feedback(
    request: Request, course_uuid: str,
    status: Optional[Literal["open", "resolved"]] = Query(default=None),
    page: int = Query(default=1, ge=1, le=10_000),
    limit: int = Query(default=20, ge=1, le=100),
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Feedback left on the course's pages."""
    return await svc.list_course_feedback(request, course_uuid, current_user, db_session, status, page, limit)


@router.get("/courses/{course_uuid}/contributors", response_model=ContributorList)
async def api_course_contributors(
    request: Request, course_uuid: str,
    manage: bool = Query(default=False),
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """People credited on the course. ``manage=true`` (reviewers) includes trusted and blocked flags."""
    return await svc.list_contributors(request, course_uuid, current_user, db_session, manage=manage)


@router.put("/courses/{course_uuid}/contributors/{user_id}", response_model=ContributorRead)
async def api_update_contributor(
    request: Request, course_uuid: str, user_id: int, payload: ContributorUpdate,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Mark a contributor trusted (publishes without review) or blocked."""
    return await svc.update_contributor(request, course_uuid, user_id, payload, current_user, db_session)


# ─── the learner page ────────────────────────────────────────────────────────


@router.get("/activities/{activity_uuid}/context", response_model=ActivityContributionContext)
async def api_activity_context(
    request: Request, activity_uuid: str,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Whether the viewer may suggest or give feedback here, and who helped write each block."""
    return await svc.get_activity_context(request, activity_uuid, current_user, db_session)


@router.post("/activities/{activity_uuid}/suggestions", response_model=SuggestionRead)
async def api_create_suggestion(
    request: Request, activity_uuid: str, payload: SuggestionCreate,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Suggest replacing, adding or removing blocks of the page."""
    return await svc.create_suggestion(request, activity_uuid, payload, current_user, db_session)


@router.post("/activities/{activity_uuid}/feedback", response_model=FeedbackRead)
async def api_create_feedback(
    request: Request, activity_uuid: str, payload: FeedbackCreate,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Leave feedback on a passage or block (typo, unclear, outdated, wrong, suggestion)."""
    return await svc.create_feedback(request, activity_uuid, payload, current_user, db_session)


@router.get("/activities/{activity_uuid}/feedback/mine", response_model=FeedbackList)
async def api_my_feedback(
    request: Request, activity_uuid: str,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """My feedback on this page and the team's replies."""
    return await svc.list_my_feedback(request, activity_uuid, current_user, db_session)


@router.get("/suggestions/mine", response_model=SuggestionList)
async def api_my_suggestions(
    request: Request,
    activity_uuid: Optional[str] = Query(default=None, max_length=100),
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """My suggestions, optionally on one page."""
    return await svc.list_my_suggestions(request, current_user, db_session, activity_uuid)


# ─── one suggestion ──────────────────────────────────────────────────────────


@router.get("/suggestions/{suggestion_uuid}", response_model=SuggestionRead)
async def api_get_suggestion(
    request: Request, suggestion_uuid: str,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    return await svc.get_suggestion(request, suggestion_uuid, current_user, db_session)


@router.put("/suggestions/{suggestion_uuid}", response_model=SuggestionRead)
async def api_revise_suggestion(
    request: Request, suggestion_uuid: str, payload: SuggestionRevise,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """The author's revised version; goes back to review."""
    return await svc.revise_suggestion(request, suggestion_uuid, payload, current_user, db_session)


@router.post("/suggestions/{suggestion_uuid}/accept", response_model=SuggestionRead)
async def api_accept_suggestion(
    request: Request, suggestion_uuid: str, payload: SuggestionAccept,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Apply the suggestion (optionally edited) as a new page version."""
    return await svc.accept_suggestion(request, suggestion_uuid, payload, current_user, db_session)


@router.post("/suggestions/{suggestion_uuid}/reject", response_model=SuggestionRead)
async def api_reject_suggestion(
    request: Request, suggestion_uuid: str, payload: SuggestionDecision,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    return await svc.reject_suggestion(request, suggestion_uuid, payload, current_user, db_session)


@router.post("/suggestions/{suggestion_uuid}/request-changes", response_model=SuggestionRead)
async def api_request_changes(
    request: Request, suggestion_uuid: str, payload: SuggestionDecision,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    return await svc.request_changes(request, suggestion_uuid, payload, current_user, db_session)


@router.post("/suggestions/{suggestion_uuid}/withdraw", response_model=SuggestionRead)
async def api_withdraw_suggestion(
    request: Request, suggestion_uuid: str,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    return await svc.withdraw_suggestion(request, suggestion_uuid, current_user, db_session)


# ─── feedback threads ────────────────────────────────────────────────────────


@router.post("/feedback/{thread_uuid}/replies", response_model=FeedbackRead)
async def api_reply_feedback(
    request: Request, thread_uuid: str, payload: FeedbackReply,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    return await svc.reply_feedback(request, thread_uuid, payload, current_user, db_session)


@router.put("/feedback/{thread_uuid}/status", response_model=FeedbackRead)
async def api_feedback_status(
    request: Request, thread_uuid: str, payload: FeedbackStatus,
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    return await svc.set_feedback_status(request, thread_uuid, payload, current_user, db_session)


# ─── profiles ────────────────────────────────────────────────────────────────


@router.get("/users/{user_uuid}/contributions", response_model=UserContributions)
async def api_user_contributions(
    request: Request, user_uuid: str,
    org_id: int = Query(ge=1),
    current_user=Depends(get_current_user), db_session: AsyncSession = Depends(get_db_session),
):
    """Courses a person improved in this org (only those the viewer can open)."""
    return await svc.get_user_contributions(request, user_uuid, org_id, current_user, db_session)
