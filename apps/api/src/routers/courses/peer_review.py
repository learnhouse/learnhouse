"""Peer review on assignments, mounted under ``/assignments``.

Every path has at least three segments with a literal ``peer-review`` in it,
so none of them collides with the single-segment ``/{assignment_uuid}`` routes
of the assignments router.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from src.core.events.database import get_db_session
from src.db.courses.peer_reviews import (
    PeerCalibrationBody,
    PeerDiscardBody,
    PeerFlagBody,
    PeerRateBody,
    PeerReflectionBody,
    PeerReviewSaveBody,
    PeerReviewSettingsUpdate,
    PeerSelfReviewBody,
)
from src.db.users import PublicUser
from src.routers.content_files import _get_mime_type, _security_headers
from src.security.auth import get_current_user
from src.services.courses.activities import peer_review as svc

router = APIRouter()

_ERRORS = {
    401: {"description": "Authentication required"},
    403: {"description": "Not allowed, or the organization's plan does not include peer review"},
    404: {"description": "Assignment, review or peer review settings not found"},
}


# ---------------------------------------------------------------- reviews by uuid
# Registered first: these start with the literal "peer-review" segment.


@router.get(
    "/peer-review/reviews/{review_uuid}",
    summary="Read a review I was assigned",
    description="The review plus the reviewee's submission (answer keys stripped, file names replaced by review file URLs). Reviewee identity follows the anonymity setting. Reviewer only.",
    responses=_ERRORS,
)
async def api_get_review(
    request: Request, review_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.get_review(request, db_session, current_user, review_uuid)


@router.put(
    "/peer-review/reviews/{review_uuid}",
    summary="Save or submit a peer review",
    description="Saves a draft. With `submit: true`, every criterion must be scored and each prompt meet its minimum length; the reviewee is notified.",
    responses={**_ERRORS, 409: {"description": "Already submitted, withdrawn, or the reviewee started a new attempt"}, 422: {"description": "Invalid scores or comments"}},
)
async def api_save_review(
    request: Request, review_uuid: str, body: PeerReviewSaveBody,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.save_review(request, db_session, current_user, review_uuid, body)


@router.get(
    "/peer-review/reviews/{review_uuid}/files/{task_uuid}",
    summary="Download the reviewee's file for a task",
    description="Streams the uploaded file under a neutral name. Only for the assigned reviewer and course instructors.",
    responses=_ERRORS,
)
async def api_get_review_file(
    request: Request, review_uuid: str, task_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    content, filename = await svc.get_review_file(request, db_session, current_user, review_uuid, task_uuid)
    mime = _get_mime_type(filename)
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        **_security_headers(mime),
    }
    return Response(content=content, media_type=mime, headers=headers)


@router.post(
    "/peer-review/reviews/{review_uuid}/rate",
    summary="Rate how helpful a review was",
    responses={**_ERRORS, 409: {"description": "The review is not submitted"}},
)
async def api_rate_review(
    request: Request, review_uuid: str, body: PeerRateBody,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.rate_review(request, db_session, current_user, review_uuid, body)


@router.post(
    "/peer-review/reviews/{review_uuid}/flag",
    summary="Flag a review I received",
    description="Marks the review for the instructors and notifies them.",
    responses={**_ERRORS, 409: {"description": "The review is not submitted"}},
)
async def api_flag_review(
    request: Request, review_uuid: str, body: PeerFlagBody,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.flag_review(request, db_session, current_user, review_uuid, body)


# ---------------------------------------------------------------- per assignment


@router.get(
    "/{assignment_uuid}/peer-review/settings",
    summary="Read peer review settings",
    description="Defaults when none are saved. Practice-sample answers are stripped for learners.",
    responses=_ERRORS,
)
async def api_get_settings(
    request: Request, assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.get_settings(request, db_session, current_user, assignment_uuid)


@router.put(
    "/{assignment_uuid}/peer-review/settings",
    summary="Save peer review settings",
    description="Upsert (instructors). Turning peer review on needs a 1-10 criteria rubric and the peer_review plan feature.",
    responses={**_ERRORS, 422: {"description": "Invalid settings"}},
)
async def api_update_settings(
    request: Request, assignment_uuid: str, body: PeerReviewSettingsUpdate,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.update_settings(request, db_session, current_user, assignment_uuid, body)


@router.get(
    "/{assignment_uuid}/peer-review/overview",
    summary="Peer review dashboard",
    responses=_ERRORS,
)
async def api_get_overview(
    request: Request, assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.get_overview(request, db_session, current_user, assignment_uuid)


@router.get(
    "/{assignment_uuid}/peer-review/submissions/{user_id}",
    summary="Every review of one learner's current attempt",
    responses=_ERRORS,
)
async def api_get_submission(
    request: Request, assignment_uuid: str, user_id: int,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.get_submission_detail(request, db_session, current_user, assignment_uuid, user_id)


@router.post(
    "/{assignment_uuid}/peer-review/reviews/{review_uuid}/discard",
    summary="Discard a peer review",
    responses=_ERRORS,
)
async def api_discard_review(
    request: Request, assignment_uuid: str, review_uuid: str, body: PeerDiscardBody,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.discard_review(request, db_session, current_user, assignment_uuid, review_uuid, body)


@router.post(
    "/{assignment_uuid}/peer-review/reviews/{review_uuid}/restore",
    summary="Restore a discarded peer review",
    responses={**_ERRORS, 409: {"description": "The review is not discarded"}},
)
async def api_restore_review(
    request: Request, assignment_uuid: str, review_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.restore_review(request, db_session, current_user, assignment_uuid, review_uuid)


@router.get(
    "/{assignment_uuid}/peer-review/me",
    summary="My peer review state",
    description="404 when peer review is off for the assignment, 403 when the org's plan lost it.",
    responses=_ERRORS,
)
async def api_get_me(
    request: Request, assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.get_learner_state(request, db_session, current_user, assignment_uuid)


@router.post(
    "/{assignment_uuid}/peer-review/me/next",
    summary="Get my next review to write",
    description="My open review if any, else a fresh pick (fewest reviews first), else `{review: null, reason: \"none_available\"}`.",
    responses={**_ERRORS, 409: {"description": "Practice round not finished"}},
)
async def api_next_review(
    request: Request, assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.next_review(request, db_session, current_user, assignment_uuid)


@router.post(
    "/{assignment_uuid}/peer-review/me/self",
    summary="Submit my self-review",
    responses={**_ERRORS, 422: {"description": "Invalid scores or comments"}},
)
async def api_self_review(
    request: Request, assignment_uuid: str, body: PeerSelfReviewBody,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.submit_self_review(request, db_session, current_user, assignment_uuid, body)


@router.get(
    "/{assignment_uuid}/peer-review/me/calibration",
    summary="Practice samples",
    responses=_ERRORS,
)
async def api_list_calibration(
    request: Request, assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.list_calibration(request, db_session, current_user, assignment_uuid)


@router.post(
    "/{assignment_uuid}/peer-review/me/calibration/{sample_id}",
    summary="Score a practice sample",
    description="Stores my levels and returns them next to the instructor's, with the explanation.",
    responses={**_ERRORS, 409: {"description": "Already scored"}},
)
async def api_submit_calibration(
    request: Request, assignment_uuid: str, sample_id: str, body: PeerCalibrationBody,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.submit_calibration(request, db_session, current_user, assignment_uuid, sample_id, body)


@router.put(
    "/{assignment_uuid}/peer-review/me/reflection",
    summary="Save my revision plan",
    responses=_ERRORS,
)
async def api_save_reflection(
    request: Request, assignment_uuid: str, body: PeerReflectionBody,
    current_user: PublicUser = Depends(get_current_user), db_session=Depends(get_db_session),
):
    return await svc.save_reflection(request, db_session, current_user, assignment_uuid, body)
