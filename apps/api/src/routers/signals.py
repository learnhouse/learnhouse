"""Analytics collection and settings endpoints.

``POST /signals/batch`` is the browser beacon. The path is deliberately
neutral: the old ``/analytics/events`` matches EasyPrivacy's
``/analytics/event`` rule, so every visitor running uBlock Origin, Brave or
AdGuard silently dropped out of an org's analytics. The old endpoint stays,
on the same pipeline, for clients built before the move.

The beacon always answers 202 with the number of events kept. Rejected events
(bots, unknown names, anonymous visitors on an org that opted out...) are
dropped quietly; telling a client why only invites it to retry.
"""

import csv
import io
import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.core.events.database import get_db_session
from src.db.analytics import AnalyticsEvent
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.services.analytics import settings as analytics_settings
from src.services.analytics.analytics import enqueue
from src.services.analytics.collect import MAX_EVENTS_PER_BATCH, BeaconContext, build_web_rows
from src.services.orgs.users import _csv_safe
from src.services.security.rate_limiting import check_rate_limit, get_client_ip

logger = logging.getLogger(__name__)

router = APIRouter()
legacy_router = APIRouter()
settings_router = APIRouter()

# Batches per IP per minute. A busy tab sends a handful; this only stops floods.
RATE_LIMIT_PER_MINUTE = 120
EXPORT_PAGE_SIZE = 5000


class SignalEvent(BaseModel):
    name: str = Field(max_length=64)
    props: dict = Field(default_factory=dict)


class SignalBatch(BaseModel):
    org_id: int
    session_id: str = Field(default="", max_length=64)
    events: list[SignalEvent] = Field(default_factory=list, max_length=MAX_EVENTS_PER_BATCH)


class LegacyEvent(BaseModel):
    event_name: str
    org_id: int
    session_id: str = ""
    properties: dict = Field(default_factory=dict)


def _within_rate_limit(ip: str) -> bool:
    try:
        allowed, _, _ = check_rate_limit(f"signals:{ip}", RATE_LIMIT_PER_MINUTE, 60)
        return allowed
    except Exception:
        # No Redis: don't lose analytics over it.
        return True


async def _ingest(
    request: Request,
    current_user,
    org_id: int,
    session_id: str,
    events: list[tuple[str, dict]],
    db_session: AsyncSession,
) -> int:
    ip = get_client_ip(request)
    if not _within_rate_limit(ip):
        return 0
    user_id = 0 if isinstance(current_user, AnonymousUser) else resolve_acting_user_id(current_user)
    ctx = BeaconContext(
        org_id=org_id,
        user_id=user_id or 0,
        session_id=session_id,
        ip=ip,
        user_agent=request.headers.get("user-agent", ""),
        headers=request.headers,
        secret=get_learnhouse_config().security_config.auth_jwt_secret_key,
    )
    rows = await build_web_rows(ctx, events, db_session)
    if rows:
        enqueue(rows)
    return len(rows)


@router.post(
    "/batch",
    status_code=202,
    summary="Record analytics events from the browser",
    description="Accepts up to 25 catalogued analytics events for one organization. Works for anonymous visitors (public events only). Bots, unknown events and disallowed properties are dropped.",
    responses={202: {"description": "Number of events kept"}},
)
async def ingest_batch(
    batch: SignalBatch,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    events = [(event.name, event.props) for event in batch.events]
    accepted = await _ingest(request, current_user, batch.org_id, batch.session_id, events, db_session)
    return {"accepted": accepted}


@legacy_router.post(
    "/events",
    status_code=202,
    summary="Record one analytics event (deprecated)",
    description="Deprecated: use POST /signals/batch. Kept for clients built before the move; same validation.",
    responses={202: {"description": "Number of events kept"}},
    deprecated=True,
)
async def ingest_legacy_event(
    body: LegacyEvent,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    accepted = await _ingest(
        request, current_user, body.org_id, body.session_id,
        [(body.event_name, body.properties)], db_session,
    )
    return {"accepted": accepted}


# -------------------------------------------------------------------
# Settings (org admins)
# -------------------------------------------------------------------
class SettingsUpdate(BaseModel):
    retention_days: int | None = None
    track_anonymous: bool | None = None
    collect_location: bool | None = None
    exclude_staff: bool | None = None


async def _require_admin(current_user, org_id: int, db_session: AsyncSession) -> int:
    from src.routers.analytics import _verify_org_admin, _verify_org_membership

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    acting = resolve_acting_user_id(current_user)
    await _verify_org_membership(acting, org_id, db_session)
    await _verify_org_admin(acting, org_id, db_session)
    return acting


async def _settings_payload(org_id: int, db_session: AsyncSession) -> dict:
    view = await analytics_settings.get_settings(org_id, db_session)
    return {
        **view.as_dict(),
        "retention_options": await analytics_settings.retention_options(org_id, db_session),
    }


@settings_router.get(
    "/settings",
    summary="Get analytics settings",
    description="Retention and privacy settings for an organization's analytics, with the retention periods its plan allows. Org admins only.",
    responses={200: {"description": "Current settings"}, 401: {"description": "Authentication required"}, 403: {"description": "Not an org admin"}},
)
async def get_analytics_settings(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)
    return await _settings_payload(org_id, db_session)


@settings_router.put(
    "/settings",
    summary="Update analytics settings",
    description="Change retention and privacy settings. Retention over 365 days requires the Enterprise plan. Shortening retention deletes older data at the next nightly cleanup. Org admins only.",
    responses={
        200: {"description": "Updated settings"},
        400: {"description": "Unsupported retention period"},
        401: {"description": "Authentication required"},
        403: {"description": "Not an org admin, or extended retention without Enterprise"},
    },
)
async def update_analytics_settings(
    org_id: int,
    body: SettingsUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)
    await analytics_settings.update_settings(org_id, body.model_dump(), db_session)
    return await _settings_payload(org_id, db_session)


_EXPORT_COLUMNS = (
    "ts", "event_name", "source", "user_id", "actor_key", "session_id", "course_uuid",
    "activity_uuid", "path", "country", "device", "referrer_domain", "seconds_spent", "properties",
)


def _export_cell(event: AnalyticsEvent, column: str):
    value = getattr(event, column)
    if column == "ts":
        return value.isoformat()
    if column == "properties":
        return _csv_safe(json.dumps(value or {}, sort_keys=True))
    return _csv_safe(value)


@settings_router.get(
    "/export/events",
    summary="Export raw analytics events (CSV)",
    description="Streams every stored analytics event for the organization over the last N days as CSV. Enterprise plan, org admins only.",
    responses={
        200: {"description": "CSV stream"},
        401: {"description": "Authentication required"},
        403: {"description": "Not an org admin, or not on the Enterprise plan"},
    },
)
async def export_raw_events(
    org_id: int,
    days: int = 30,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _require_admin(current_user, org_id, db_session)
    if not await analytics_settings.can_extend_retention(org_id, db_session):
        raise HTTPException(status_code=403, detail="Raw event export requires the Enterprise plan.")
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 2555)))

    async def rows():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(_EXPORT_COLUMNS)
        last_id = 0
        while True:
            page = (
                await db_session.execute(
                    select(AnalyticsEvent)
                    .where(AnalyticsEvent.org_id == org_id, AnalyticsEvent.ts >= since, AnalyticsEvent.id > last_id)
                    .order_by(AnalyticsEvent.id)
                    .limit(EXPORT_PAGE_SIZE)
                )
            ).scalars().all()
            for event in page:
                writer.writerow([_export_cell(event, column) for column in _EXPORT_COLUMNS])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()
            if len(page) < EXPORT_PAGE_SIZE:
                return
            last_id = page[-1].id

    filename = f"analytics-events-org{org_id}-{datetime.now(timezone.utc):%Y%m%d}.csv"
    return StreamingResponse(
        rows(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
