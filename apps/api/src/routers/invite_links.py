"""Personal invitation links (the button in an admin's invitation email).

Public: the invitee may not have an account yet. The token travels in the
request body, never the path, so it stays out of access logs. Mounted with
``get_non_api_token_user`` (anonymous callers welcome, API tokens refused).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.services.onboarding import invite_links

logger = logging.getLogger(__name__)

router = APIRouter()

# (max requests, window seconds) per client IP.
LIMITS = {"peek": (60, 600), "signup": (10, 3600), "accept": (30, 3600)}


def _limit(request: Request, kind: str) -> None:
    """Fails open when Redis is unreachable; the token is the real guard."""
    from src.services.security.rate_limiting import check_rate_limit, get_client_ip

    max_attempts, window = LIMITS[kind]
    try:
        allowed, _count, retry_after = check_rate_limit(f"invite_link:{kind}:{get_client_ip(request)}", max_attempts, window)
    except Exception:
        logger.warning("Invite link rate limit unavailable (%s)", kind, exc_info=True)
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait a moment and try again.",
            headers={"Retry-After": str(retry_after)},
        )


@router.post(
    "/peek",
    summary="Read an invitation link",
    description="The organization and invited address behind a personal invitation link, and whether that address has an account.",
    responses={200: {"description": "Invitation."}, 404: {"description": "Link used, withdrawn or expired"}},
)
async def api_peek_invite_link(
    request: Request,
    body: invite_links.TokenBody,
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    _limit(request, "peek")
    return await invite_links.peek_invite_link(db_session, body.token)


@router.post(
    "/signup",
    summary="Create an account from an invitation link",
    description="Creates the invited address's account (verified, since the link was mailed to it) and makes it a member of the organization. Single use.",
    responses={
        200: {"description": "Account created and joined."},
        404: {"description": "Link used, withdrawn or expired"},
        409: {"description": "An account exists for this address, or the link is being redeemed"},
    },
)
async def api_signup_with_invite_link(
    request: Request,
    body: invite_links.InviteSignupBody,
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.routers.users import _enforce_signup_rate_limit

    _limit(request, "signup")
    _enforce_signup_rate_limit(request)
    return await invite_links.signup_with_invite_link(request, db_session, body)


@router.post(
    "/accept",
    summary="Accept an invitation link",
    description="Join the organization while signed in as the invited address. Single use.",
    responses={
        200: {"description": "Joined (or already a member)."},
        401: {"description": "Not signed in"},
        403: {"description": "Signed in as a different address"},
        404: {"description": "Link used, withdrawn or expired"},
    },
)
async def api_accept_invite_link(
    request: Request,
    body: invite_links.TokenBody,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.security.session_context import refuse_lms_session

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Sign in to accept the invitation.")
    # It verifies the address and joins an org: the person themselves only,
    # never an impersonation or an LMS/embed session.
    refuse_lms_session()
    _limit(request, "accept")
    return await invite_links.accept_invite_link(request, db_session, resolve_acting_user_id(current_user), body.token)
