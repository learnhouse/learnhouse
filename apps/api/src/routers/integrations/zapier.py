"""
Zapier integration router.

These endpoints are called by the Zapier Platform (not the LearnHouse dashboard)
and MUST be authenticated via an API token (``Authorization: Bearer lh_...``).
The token carries the organization scope — no ``org_id`` appears in the URL.

Pattern: REST Hooks. When a Zap is enabled, Zapier calls ``POST /subscriptions``
with a target URL; we create a ``WebhookEndpoint`` tagged ``source="zapier"``.
The existing dispatcher delivers events to it just like any other webhook.
When the Zap is disabled, Zapier calls ``DELETE /subscriptions/{id}``.
"""

import secrets
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select, col

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.usergroups import UserGroup
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User
from src.db.webhooks import WebhookEndpoint
from src.security.auth import get_current_user
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.webhooks.crypto import encrypt_secret
from src.services.webhooks.events import WEBHOOK_EVENTS
# Reuse the same SSRF guard as the manual webhook create path so both code
# paths enforce identical validation. The leading underscore is conventional,
# not enforced — importing it here is deliberate to avoid duplicating the
# logic across files.
from src.services.webhooks.webhooks import _validate_webhook_url


router = APIRouter()


# ---------------------------------------------------------------------------
# Shared plumbing
# ---------------------------------------------------------------------------


def _require_api_token(current_user) -> APITokenUser:
    if not isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Zapier endpoints require an API token (Authorization: Bearer lh_...)",
        )
    return current_user


def _require_pro_plan(org_id: int, db_session: Session) -> None:
    current_plan = get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Zapier integration requires a Pro plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan."
            ),
        )


def _zapier_context(
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    api_user = _require_api_token(current_user)
    _require_pro_plan(api_user.org_id, db_session)
    return api_user, db_session


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class ZapierMeResponse(BaseModel):
    org_id: int
    org_name: str
    org_slug: str
    token_id: int
    token_name: str


class ZapierCourseItem(BaseModel):
    id: int
    course_uuid: str
    name: str


class ZapierUserItem(BaseModel):
    id: int
    user_uuid: str
    email: str
    username: str
    first_name: str
    last_name: str


class ZapierUserGroupItem(BaseModel):
    id: int
    usergroup_uuid: str
    name: str
    description: str


class ZapierSubscriptionCreate(BaseModel):
    target_url: str = Field(..., description="Zapier's REST Hook callback URL")
    event: str = Field(..., description="A single event name from /events")
    zap_id: Optional[str] = Field(None, description="Zapier's internal Zap identifier")
    zap_name: Optional[str] = Field(None, description="Human-readable Zap name")


class ZapierSubscriptionResponse(BaseModel):
    id: int
    webhook_uuid: str
    target_url: str
    event: str
    zap_id: Optional[str] = None
    zap_name: Optional[str] = None
    is_active: bool


def _validate_event(event: str) -> None:
    if event not in WEBHOOK_EVENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown event: {event}",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/me", response_model=ZapierMeResponse)
async def zapier_me(ctx=Depends(_zapier_context)) -> ZapierMeResponse:
    api_user, db_session = ctx
    org_query = select(Organization).where(Organization.id == api_user.org_id)
    org = db_session.scalars(org_query).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found for this token",
        )
    return ZapierMeResponse(
        org_id=api_user.org_id,
        org_name=org.name,
        org_slug=org.slug,
        token_id=api_user.id,
        token_name=api_user.token_name,
    )


@router.get("/events")
async def zapier_list_events(ctx=Depends(_zapier_context)) -> dict:
    return {"events": WEBHOOK_EVENTS}


@router.get("/courses", response_model=List[ZapierCourseItem])
async def zapier_list_courses(
    limit: int = 100,
    ctx=Depends(_zapier_context),
) -> List[ZapierCourseItem]:
    api_user, db_session = ctx
    query = (
        select(Course)
        .where(Course.org_id == api_user.org_id)
        .order_by(col(Course.creation_date).desc())
        .limit(min(limit, 500))
    )
    courses = db_session.scalars(query).all()
    return [
        ZapierCourseItem(id=c.id or 0, course_uuid=c.course_uuid, name=c.name)
        for c in courses
    ]


@router.get("/users", response_model=List[ZapierUserItem])
async def zapier_list_users(
    limit: int = 100,
    ctx=Depends(_zapier_context),
) -> List[ZapierUserItem]:
    api_user, db_session = ctx
    query = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore
        .where(UserOrganization.org_id == api_user.org_id)
        .limit(min(limit, 500))
    )
    users = db_session.scalars(query).all()
    return [
        ZapierUserItem(
            id=u.id or 0,
            user_uuid=u.user_uuid,
            email=u.email or "",
            username=u.username or "",
            first_name=u.first_name or "",
            last_name=u.last_name or "",
        )
        for u in users
    ]


@router.get("/usergroups", response_model=List[ZapierUserGroupItem])
async def zapier_list_usergroups(
    limit: int = 100,
    ctx=Depends(_zapier_context),
) -> List[ZapierUserGroupItem]:
    api_user, db_session = ctx
    query = (
        select(UserGroup)
        .where(UserGroup.org_id == api_user.org_id)
        .limit(min(limit, 500))
    )
    groups = db_session.scalars(query).all()
    return [
        ZapierUserGroupItem(
            id=g.id or 0,
            usergroup_uuid=g.usergroup_uuid,
            name=g.name,
            description=g.description or "",
        )
        for g in groups
    ]


@router.post("/subscriptions", response_model=ZapierSubscriptionResponse, status_code=201)
async def zapier_create_subscription(
    request: Request,
    payload: ZapierSubscriptionCreate,
    ctx=Depends(_zapier_context),
) -> ZapierSubscriptionResponse:
    api_user, db_session = ctx
    _validate_event(payload.event)
    _validate_webhook_url(payload.target_url)

    now = str(datetime.now())
    description = f"Zapier: {payload.zap_name}" if payload.zap_name else "Zapier integration"

    # The signing secret is never returned to Zapier — Zapier's Catch Hook
    # authenticates its own inbound URL, so signatures are unused here. We
    # still persist one so the dispatcher can sign the payload exactly like
    # any other webhook (defence in depth).
    plaintext_secret = f"whsec_{secrets.token_urlsafe(32)}"

    endpoint = WebhookEndpoint(
        webhook_uuid=f"webhook_{uuid4()}",
        org_id=api_user.org_id,
        url=payload.target_url,
        secret_encrypted=encrypt_secret(plaintext_secret),
        description=description,
        events=[payload.event],
        is_active=True,
        source="zapier",
        zap_name=payload.zap_name,
        zap_id=payload.zap_id,
        # Attribute the row to whoever originally created the API token that
        # Zapier is using. webhook_endpoint.created_by_user_id has a NOT NULL
        # FK to user.id, so we cannot leave this as 0 or None.
        created_by_user_id=api_user.created_by_user_id,
        creation_date=now,
        update_date=now,
    )

    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    return ZapierSubscriptionResponse(
        id=endpoint.id or 0,
        webhook_uuid=endpoint.webhook_uuid,
        target_url=endpoint.url,
        event=payload.event,
        zap_id=endpoint.zap_id,
        zap_name=endpoint.zap_name,
        is_active=endpoint.is_active,
    )


@router.get("/subscriptions", response_model=List[ZapierSubscriptionResponse])
async def zapier_list_subscriptions(
    ctx=Depends(_zapier_context),
) -> List[ZapierSubscriptionResponse]:
    api_user, db_session = ctx
    query = select(WebhookEndpoint).where(
        WebhookEndpoint.org_id == api_user.org_id,
        WebhookEndpoint.source == "zapier",
    )
    endpoints = db_session.scalars(query).all()
    return [
        ZapierSubscriptionResponse(
            id=ep.id or 0,
            webhook_uuid=ep.webhook_uuid,
            target_url=ep.url,
            event=ep.events[0] if ep.events else "",
            zap_id=ep.zap_id,
            zap_name=ep.zap_name,
            is_active=ep.is_active,
        )
        for ep in endpoints
    ]


@router.delete("/subscriptions/{subscription_id}")
async def zapier_delete_subscription(
    subscription_id: int,
    ctx=Depends(_zapier_context),
) -> dict:
    api_user, db_session = ctx
    query = select(WebhookEndpoint).where(
        WebhookEndpoint.id == subscription_id,
        WebhookEndpoint.org_id == api_user.org_id,
        WebhookEndpoint.source == "zapier",
    )
    endpoint = db_session.scalars(query).first()
    if not endpoint:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found",
        )

    db_session.delete(endpoint)
    db_session.commit()
    return {"detail": "Subscription deleted"}
