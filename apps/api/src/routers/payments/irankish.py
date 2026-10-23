"""
REST endpoints for the IranKish (Shaparak) course-payment integration.

Mounted in ``src/router.py`` under the prefix ``/payments/irankish`` so the full
paths are ``/api/v1/payments/irankish/...``.

Endpoints:
  GET  /status                                  public probe (is it configured?)
  POST /{org_id}/courses/{course_id}/price      admin: set / clear a course price
  POST /{org_id}/courses/{course_id}/checkout   buyer: start a purchase
  POST /callback                                public: gateway result POST
  GET  /{org_id}/payments/{payment_uuid}        buyer / admin: read a payment

The callback is public and form-encoded because it is driven by the gateway /
the cardholder's browser, not an authenticated API client.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.irankish import (
    IranKishCheckoutCreate,
    IranKishCheckoutResponse,
    IranKishPaymentRead,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.payments.irankish.client import is_irankish_enabled
from src.services.payments.irankish.irankish import (
    create_checkout,
    get_payment,
    handle_callback,
    set_course_price,
    to_read,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class SetCoursePriceRequest(BaseModel):
    # Price in Iranian Rial. Pass null to remove the price (unlist the course).
    price_irr: Optional[int] = None


@router.get(
    "/status",
    summary="Whether the IranKish payment gateway is configured",
    description="Returns whether this instance has IranKish terminal credentials. Does not reveal them.",
)
async def api_irankish_status() -> dict:
    return {"enabled": is_irankish_enabled()}


@router.post(
    "/{org_id}/courses/{course_id}/price",
    summary="Set or clear a course's IranKish price",
    description="Org admins set the IRR price a course sells for, or clear it (null) to unlist it.",
    responses={
        200: {"description": "Price updated"},
        400: {"description": "Invalid price"},
        403: {"description": "Admin rights required"},
        404: {"description": "Organization or course not found"},
    },
)
async def api_set_course_price(
    request: Request,
    org_id: int,
    course_id: int,
    body: SetCoursePriceRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await set_course_price(
        request, db_session, org_id, course_id, body.price_irr, current_user
    )


@router.post(
    "/{org_id}/courses/{course_id}/checkout",
    response_model=IranKishCheckoutResponse,
    summary="Start an IranKish purchase for a course",
    description=(
        "Obtains a payment token from IranKish and returns the data the browser "
        "must POST to the gateway's payment page to redirect the buyer."
    ),
    responses={
        200: {"description": "Checkout started", "model": IranKishCheckoutResponse},
        400: {"description": "Course not purchasable / invalid"},
        403: {"description": "Not an organization member"},
        404: {"description": "Organization or course not found"},
        409: {"description": "Buyer already has access to the course"},
        502: {"description": "Could not reach the gateway"},
        503: {"description": "IranKish not configured"},
    },
)
async def api_create_checkout(
    request: Request,
    org_id: int,
    course_id: int,
    _body: IranKishCheckoutCreate | None = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> IranKishCheckoutResponse:
    # The gateway POSTs its result to this absolute URL. Build it from the
    # incoming request so the backend host is not hard-coded.
    revert_uri = str(request.url_for("api_irankish_callback"))
    result = await create_checkout(
        request, db_session, org_id, course_id, revert_uri, current_user
    )
    return IranKishCheckoutResponse(**result)


@router.post(
    "/callback",
    name="api_irankish_callback",
    summary="IranKish payment result callback (gateway -> us)",
    description=(
        "Public endpoint the gateway POSTs the payment result to. Verifies and "
        "confirms the payment, grants course access, then redirects the "
        "cardholder's browser back to the course page."
    ),
    responses={
        302: {"description": "Redirect to the course page with a status flag"},
        400: {"description": "Malformed callback"},
        404: {"description": "Payment not found"},
    },
)
async def api_irankish_callback(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
) -> RedirectResponse:
    # The gateway sends application/x-www-form-urlencoded; tolerate JSON too.
    try:
        form = await request.form()
        callback = {k: v for k, v in form.items()}
    except Exception:  # noqa: BLE001 - fall back to JSON body
        callback = {}
    if not callback:
        try:
            body = await request.json()
            if isinstance(body, dict):
                callback = {k: str(v) for k, v in body.items()}
        except Exception:  # noqa: BLE001
            callback = {}

    payment = await handle_callback(request, db_session, callback)

    # Redirect the browser back to the course page with a result flag so the
    # frontend can show a success / failure message.
    from src.services.nudges.links import org_base_url, public_course_url
    from src.db.organizations import Organization
    from sqlmodel import select
    from src.db.courses.courses import Course

    org = (
        await db_session.execute(
            select(Organization).where(Organization.id == payment.org_id)
        )
    ).scalars().first()
    course = (
        await db_session.execute(
            select(Course).where(Course.id == payment.course_id)
        )
    ).scalars().first()

    from src.services.email.utils import get_base_url_from_request

    status_flag = payment.status.value.lower()
    if org and course:
        base = await org_base_url(org.slug, db_session=db_session, org_id=org.id)
        # In local/dev the configured frontend base can be empty (the localhost
        # guard rejects it), which would yield a hostless relative redirect the
        # browser resolves against the API origin -> a 500. Fall back to the
        # request-derived frontend origin so the browser lands on the app.
        if not base:
            base = get_base_url_from_request(request)
        target = f"{public_course_url(base, course.course_uuid)}?payment={status_flag}"
    else:  # pragma: no cover - org/course deletion race
        base = get_base_url_from_request(request)
        target = f"{base}/?payment={status_flag}"

    return RedirectResponse(url=target, status_code=302)


@router.get(
    "/{org_id}/payments/{payment_uuid}",
    response_model=IranKishPaymentRead,
    summary="Read an IranKish payment",
    description="The buyer who owns the payment, or an org admin, may read its status.",
    responses={
        200: {"description": "Payment details", "model": IranKishPaymentRead},
        403: {"description": "Not permitted"},
        404: {"description": "Payment not found"},
    },
)
async def api_get_payment(
    request: Request,
    org_id: int,
    payment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> IranKishPaymentRead:
    return await get_payment(request, db_session, org_id, payment_uuid, current_user)
