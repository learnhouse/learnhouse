"""Onboarding: create an org in one step, its setup checklist, the plan picker,
the organizations hub and invitations waiting for the signed-in user.

Mounted with ``require_authenticated_user`` (a real session, no API tokens).
"""

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core import deployment_mode
from src.core.events.database import get_db_session
from src.db.organizations import OrganizationCreate
from src.db.users import PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.features_utils.resolve import _get_plan_from_config
from src.security.org_auth import require_org_admin
from src.security.session_context import refuse_lms_session
from src.services.onboarding import goals as goal_defs
from src.services.onboarding import hub as hub_service
from src.services.onboarding import invites as invite_service
from src.services.onboarding import plans as plan_service
from src.services.onboarding import slugs
from src.services.onboarding import starter as starter_service
from src.services.onboarding import state as state_service

logger = logging.getLogger(__name__)

router = APIRouter()

# (max requests, window seconds) per user.
LIMITS = {
    "create": (10, 3600),
    "slug": (90, 60),
    "starter": (10, 3600),
    "event": (120, 60),
    "write": (120, 60),
    "invite": (30, 3600),
}


def enforce_limit(kind: str, user_id: int) -> None:
    """Per-user rate limit. Fails open when Redis is unreachable: these guard
    against abuse, and every write behind them has its own checks."""
    from src.services.security.rate_limiting import check_rate_limit

    max_attempts, window = LIMITS[kind]
    try:
        allowed, _count, retry_after = check_rate_limit(f"onboarding:{kind}:{user_id}", max_attempts, window)
    except Exception:
        logger.warning("Onboarding rate limit unavailable (%s)", kind, exc_info=True)
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a moment and try again.",
            headers={"Retry-After": str(retry_after)},
        )


Goal = Literal["sell", "team", "school", "customers", "community"]


class CreateOrgBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    slug: Optional[str] = Field(default=None, max_length=63)
    goal: Optional[Goal] = None


class StarterBody(BaseModel):
    website: bool = True
    course: bool = True


class StateBody(BaseModel):
    goal: Optional[Goal] = None
    clear_goal: bool = False
    dismissed: Optional[bool] = None
    welcome_seen: Optional[bool] = None
    skip: Optional[str] = Field(default=None, max_length=40)
    unskip: Optional[str] = Field(default=None, max_length=40)
    celebrated: Optional[list[str]] = Field(default=None, max_length=20)


class EventBody(BaseModel):
    event: str = Field(min_length=1, max_length=40)


async def _admin_org(org_id: int, current_user: PublicUser, db_session: AsyncSession):
    user_id = resolve_acting_user_id(current_user)
    await require_org_admin(user_id, org_id, db_session)
    return user_id, await state_service.get_org(db_session, org_id)


@router.get(
    "/slug",
    summary="Check an organization address",
    description="Whether an address is free, derived from the name when no address is given, with the nearest free alternative.",
    responses={200: {"description": "Availability and a suggestion."}, 429: {"description": "Too many checks"}},
)
async def api_check_slug(
    name: str = Query(default="", max_length=100),
    slug: Optional[str] = Query(default=None, max_length=63),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    enforce_limit("slug", resolve_acting_user_id(current_user))
    return await slugs.check_slug(name, slug, db_session)


@router.post(
    "/orgs",
    summary="Create an organization in one step",
    description=(
        "Creates the organization on the free plan with an address derived from the name when none "
        "is given, and remembers the goal the admin picked (it orders the setup checklist and picks "
        "the starter template). Returns the organization and its checklist."
    ),
    responses={
        200: {"description": "Organization created."},
        400: {"description": "Invalid name or address"},
        403: {"description": "Free organization limit reached, or multi-org not enabled"},
        409: {"description": "Address taken or reserved (the response carries a free suggestion)"},
        429: {"description": "Too many organizations created recently"},
    },
)
async def api_create_org(
    request: Request,
    body: CreateOrgBody,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.services.orgs.orgs import create_org

    refuse_lms_session()
    user_id = resolve_acting_user_id(current_user)
    enforce_limit("create", user_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give your organization a name")
    if body.slug:
        check = await slugs.check_slug(name, body.slug, db_session)
        if not check["available"]:
            raise HTTPException(
                status_code=409 if check["reason"] in ("taken", "reserved") else 400,
                detail={"code": f"SLUG_{check['reason'].upper()}", "message": "This address is not available", "suggestion": check["suggestion"]},
            )
        slug = check["slug"]
    else:
        slug = await slugs.suggest_slug(name, db_session)

    org = await create_org(
        request,
        OrganizationCreate(name=name, slug=slug, email=current_user.email, description=None, logo_image=""),
        current_user,
        db_session,
    )
    org_row = await state_service.get_org(db_session, org.id)
    row = await state_service.get_or_create(db_session, org_row)
    row.goal = body.goal
    state_service.stamp(row, "org_created")
    if body.goal:
        state_service.stamp(row, "goal_selected")
    db_session.add(row)
    await db_session.commit()
    return {
        "org": org.model_dump(mode="json"),
        "onboarding": await state_service.build_state(db_session, org_row, user_id),
    }


@router.post(
    "/orgs/{org_id}/starter",
    summary="Start from a template",
    description="Publishes the goal's website template as the home page and adds a private starter course. Once per organization.",
    responses={
        200: {"description": "What was created."},
        403: {"description": "Not an administrator of the organization"},
        409: {"description": "Starter content was already applied"},
    },
)
async def api_apply_starter(
    org_id: int,
    body: StarterBody,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    user_id, org = await _admin_org(org_id, current_user, db_session)
    enforce_limit("starter", user_id)
    return await starter_service.apply_starter(db_session, org, current_user, user_id, website=body.website, course=body.course)


@router.get(
    "/orgs/{org_id}",
    summary="Get the setup checklist",
    description="The organization's goal and setup steps with their state (done from real data, skipped, locked by the plan), the next step, steps to celebrate and whether invitations are held for a new free org.",
    responses={200: {"description": "Checklist state."}, 403: {"description": "Not an administrator"}},
)
async def api_get_state(
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    user_id, org = await _admin_org(org_id, current_user, db_session)
    return await state_service.build_state(db_session, org, user_id)


@router.patch(
    "/orgs/{org_id}",
    summary="Update the setup checklist",
    description="Change the goal, put the checklist away or bring it back, skip or restore a step, mark steps as celebrated.",
    responses={200: {"description": "Checklist state."}, 400: {"description": "Unknown goal or step"}, 403: {"description": "Not an administrator"}},
)
async def api_update_state(
    org_id: int,
    body: StateBody,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    user_id, org = await _admin_org(org_id, current_user, db_session)
    enforce_limit("write", user_id)
    await state_service.update_state(
        db_session,
        org,
        goal=body.goal,
        clear_goal=body.clear_goal,
        dismissed=body.dismissed,
        welcome_seen=body.welcome_seen,
        skip=body.skip,
        unskip=body.unskip,
        celebrated=body.celebrated,
    )
    return await state_service.build_state(db_session, org, user_id)


@router.post(
    "/orgs/{org_id}/events",
    summary="Record an onboarding event",
    description="Stamps the first time a funnel event happened (plan picker seen, continued free, checkout started…). Click-only setup steps complete this way.",
    responses={200: {"description": "Whether this was the first time."}, 400: {"description": "Unknown event"}},
)
async def api_record_event(
    org_id: int,
    body: EventBody,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    user_id, org = await _admin_org(org_id, current_user, db_session)
    enforce_limit("event", user_id)
    return {"event": body.event, "first": await state_service.record_event(db_session, org, body.event)}


@router.get(
    "/orgs/{org_id}/plans",
    summary="Plan picker data",
    description="The plans an organization can pick, their limits and what each adds, the current plan and the one recommended for the goal. Prices come from billing.",
    responses={200: {"description": "Plans."}, 403: {"description": "Not an administrator"}},
)
async def api_plan_picker(
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    _user_id, org = await _admin_org(org_id, current_user, db_session)
    if deployment_mode.get_deployment_mode() != "saas":
        raise HTTPException(status_code=404, detail="Plans are only sold on LearnHouse Cloud")
    row = await state_service.get_or_create(db_session, org)
    config = await state_service._config(db_session, org.id)
    return plan_service.picker(_get_plan_from_config(config), row.goal)


@router.get(
    "/goals",
    summary="Onboarding goals",
    description="The goals an admin can pick, with the setup steps, website template and recommended plan of each.",
    responses={200: {"description": "Goals."}},
)
async def api_goals() -> dict:
    return {
        "goals": [
            {
                "id": g,
                "steps": goal_defs.steps_for(g),
                "template": goal_defs.template_for(g),
                "recommended_plan": goal_defs.recommended_plan(g),
            }
            for g in goal_defs.GOAL_IDS
        ]
    }


@router.get(
    "/hub",
    summary="Organizations hub summary",
    description="For each of the user's organizations: their role, the plan and its state, and setup progress in the orgs they run; plus invitations waiting for them.",
    responses={200: {"description": "Hub summary."}},
)
async def api_hub(
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await hub_service.hub_summary(db_session, resolve_acting_user_id(current_user))


@router.get(
    "/invites",
    summary="Invitations waiting for me",
    description="Pending email invitations addressed to the signed-in user's email.",
    responses={200: {"description": "Invitations."}},
)
async def api_list_invites(
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    return await invite_service.list_pending_invites(db_session, resolve_acting_user_id(current_user))


@router.post(
    "/invites/{org_uuid}/accept",
    summary="Accept an invitation",
    description="Join the organization that invited the signed-in user's verified email, as a member.",
    responses={
        200: {"description": "Joined."},
        403: {"description": "Email not verified, or the organization is full"},
        404: {"description": "No pending invitation"},
    },
)
async def api_accept_invite(
    request: Request,
    org_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    user_id = resolve_acting_user_id(current_user)
    enforce_limit("invite", user_id)
    return await invite_service.accept_invite(request, db_session, user_id, org_uuid)


@router.post(
    "/invites/{org_uuid}/decline",
    summary="Decline an invitation",
    description="Remove a pending invitation addressed to the signed-in user.",
    responses={200: {"description": "Declined."}, 404: {"description": "No pending invitation"}},
)
async def api_decline_invite(
    org_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    user_id = resolve_acting_user_id(current_user)
    enforce_limit("invite", user_id)
    return await invite_service.decline_invite(db_session, user_id, org_uuid)
