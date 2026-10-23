"""
Course-purchase flow over the ZarinPal payment gateway (REST API v4).

Module-level ``async def`` functions following the IranKish service conventions:
each takes ``(request, db_session, ..., current_user)``, enforces authorization,
mutates through the session, and returns a Pydantic read schema. Remote calls go
through ``client``; its three exception classes are translated to HTTPExceptions.

Pricing model
-------------
Since the full offers/enrollments subsystem is an Enterprise-Edition feature not
present in this edition, a course's IRR price is stored on the course itself, in
``course.extra_metadata['zarinpal_price_irr']`` (a positive integer in Rial). A
course with no price set is not purchasable through this gateway. An org admin
sets the price with ``set_course_price``.

Granting access
----------------
On a verified payment the buyer is granted access the same way the rest of the
platform grants course access: a dedicated per-course "purchasers" ``UserGroup``
holds the course as a ``UserGroupResource`` and each buyer as a ``UserGroupUser``.
The course-visibility query already treats UserGroup membership as access.

Flow
----
``create_checkout`` requests a payment from ZarinPal, persists a PENDING row
keyed by the returned ``authority``, and returns the StartPay redirect URL. The
buyer's browser is sent to ZarinPal, pays, and is redirected back to our
``/callback`` with ``Authority`` and ``Status`` query params. ``handle_callback``
locates the PENDING row by authority, and on ``Status=OK`` calls the verify
service; a 100/101 verify flips the row to COMPLETED and grants access.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.db.zarinpal import (
    ZarinPalPayment,
    ZarinPalPaymentRead,
    ZarinPalPaymentStatusEnum,
)
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import require_org_role_permission
from src.security.rbac.rbac import authorization_verify_if_user_is_anon
from src.services.payments.zarinpal import client as zarinpal_client
from src.services.payments.zarinpal.client import (
    ZarinPalError,
    ZarinPalNotConfigured,
    ZarinPalTransportError,
)

logger = logging.getLogger(__name__)

# Key under which a course stores its IRR price for this gateway.
PRICE_METADATA_KEY = "zarinpal_price_irr"
# The value ZarinPal sends in the callback ``Status`` param on a paid return.
STATUS_OK = "OK"


# ---------------------------------------------------------------------------
# Error translation
# ---------------------------------------------------------------------------


def _translate_zarinpal_error(exc: Exception) -> HTTPException:
    """Map a ZarinPal client exception to an HTTPException."""
    if isinstance(exc, ZarinPalNotConfigured):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ZarinPal payment gateway is not configured for this instance.",
        )
    if isinstance(exc, ZarinPalTransportError):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach the ZarinPal payment gateway. Please try again later.",
        )
    if isinstance(exc, ZarinPalError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Payment gateway rejected the request (code {exc.code}).",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Unexpected error talking to the ZarinPal payment gateway.",
    )


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------


async def _get_org_or_404(db_session: AsyncSession, org_id: int) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def _get_course_or_404(
    db_session: AsyncSession, org_id: int, course_id: int
) -> Course:
    course = (
        await db_session.execute(
            select(Course).where(Course.id == course_id, Course.org_id == org_id)
        )
    ).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _course_price(course: Course) -> Optional[int]:
    """Return the course's IRR price, or None if it is not set for sale."""
    meta = course.extra_metadata or {}
    raw = meta.get(PRICE_METADATA_KEY)
    if raw is None:
        return None
    try:
        price = int(raw)
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


async def _is_org_member(db_session: AsyncSession, user_id: int, org_id: int) -> bool:
    row = (
        await db_session.execute(
            select(UserOrganization.id).where(
                UserOrganization.user_id == user_id,
                UserOrganization.org_id == org_id,
            )
        )
    ).scalars().first()
    return row is not None


# ---------------------------------------------------------------------------
# Pricing admin
# ---------------------------------------------------------------------------


async def set_course_price(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    course_id: int,
    price_irr: Optional[int],
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> dict:
    """Set (or clear, with ``None``) a course's ZarinPal price, admin-only.

    A non-positive price is rejected; passing ``None`` removes the price and
    makes the course no longer purchasable through this gateway.
    """
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await _get_org_or_404(db_session, org_id)
    await require_org_role_permission(
        acting_user_id, org_id, db_session, "courses", "action_update"
    )

    if price_irr is not None and price_irr <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="price_irr must be a positive integer (amount in Rial).",
        )

    course = await _get_course_or_404(db_session, org_id, course_id)
    meta = dict(course.extra_metadata or {})
    if price_irr is None:
        meta.pop(PRICE_METADATA_KEY, None)
    else:
        meta[PRICE_METADATA_KEY] = int(price_irr)
    course.extra_metadata = meta
    course.update_date = str(datetime.now())
    db_session.add(course)
    await db_session.commit()
    return {"course_id": course_id, "price_irr": price_irr}


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------


async def create_checkout(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    course_id: int,
    callback_url: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> dict:
    """Start a purchase: request a payment and return the redirect URL.

    ``callback_url`` is the absolute URL ZarinPal redirects the buyer's browser
    back to after payment (our callback). The caller (router) supplies it so the
    backend host is not hard-coded here.
    """
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await _get_org_or_404(db_session, org_id)

    # A buyer must belong to the org whose course they are buying; access is
    # granted inside that org, so a non-member could never use what they bought.
    if not await _is_org_member(db_session, acting_user_id, org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a member of this organization to buy its courses.",
        )

    cfg = get_learnhouse_config().zarinpal_config
    if cfg is None:
        raise _translate_zarinpal_error(ZarinPalNotConfigured())

    course = await _get_course_or_404(db_session, org_id, course_id)
    price = _course_price(course)
    if price is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This course is not available for purchase.",
        )

    # Short-circuit if the buyer already has access (already purchased).
    if await _user_has_course_access(db_session, acting_user_id, course):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have access to this course.",
        )

    # Persist a PENDING row before calling the gateway so a successful request
    # whose response is lost can still be reconciled. The authority is filled in
    # once ZarinPal returns it.
    now = str(datetime.now())
    payment = ZarinPalPayment(
        payment_uuid=f"zppay_{uuid4()}",
        org_id=org_id,
        user_id=acting_user_id,
        course_id=course_id,
        amount=price,
        status=ZarinPalPaymentStatusEnum.PENDING,
        creation_date=now,
        update_date=now,
    )
    db_session.add(payment)
    await db_session.commit()
    await db_session.refresh(payment)

    description = f"Course purchase: {course.name}"[:255]
    try:
        authority = await zarinpal_client.request_payment(
            amount=price,
            callback_url=callback_url,
            description=description,
        )
    except Exception as exc:  # noqa: BLE001 - translated below
        # Mark the attempt failed so it is not left dangling as PENDING.
        payment.status = ZarinPalPaymentStatusEnum.FAILED
        payment.update_date = str(datetime.now())
        db_session.add(payment)
        await db_session.commit()
        raise _translate_zarinpal_error(exc)

    payment.authority = authority
    payment.update_date = str(datetime.now())
    db_session.add(payment)
    await db_session.commit()
    await db_session.refresh(payment)

    return {
        "payment_uuid": payment.payment_uuid,
        "payment_url": zarinpal_client.get_start_pay_url(authority),
        "authority": authority,
        "amount": price,
    }


# ---------------------------------------------------------------------------
# Callback / verification
# ---------------------------------------------------------------------------


async def handle_callback(
    request: Request,
    db_session: AsyncSession,
    authority: Optional[str],
    status_param: Optional[str],
) -> ZarinPalPayment:
    """Process the buyer's return from ZarinPal to our callback URL.

    The caller is anonymous (the buyer's browser, redirected by ZarinPal, not an
    authenticated API client), so this does NOT take a ``current_user``. The
    payment is located by its ``authority``; the buyer recorded on the PENDING
    row is the one granted access, so a forged callback cannot grant access to a
    different user.

    On ``Status=OK`` we call verify; only a 100/101 verify flips the payment to
    COMPLETED and grants access. The amount verified is the amount stored on the
    row (set at checkout), so a tampered callback cannot change what was paid.
    """
    if not authority:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing payment authority in callback.",
        )

    payment = (
        await db_session.execute(
            select(ZarinPalPayment).where(ZarinPalPayment.authority == authority)
        )
    ).scalars().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Idempotency: a repeated callback for an already-completed payment is a
    # no-op success (the buyer may refresh the return page).
    if payment.status == ZarinPalPaymentStatusEnum.COMPLETED:
        return payment

    # A non-OK status means the buyer cancelled or the card was declined.
    if (status_param or "").upper() != STATUS_OK:
        payment.status = ZarinPalPaymentStatusEnum.FAILED
        payment.update_date = str(datetime.now())
        db_session.add(payment)
        await db_session.commit()
        await db_session.refresh(payment)
        return payment

    cfg = get_learnhouse_config().zarinpal_config
    if cfg is None:
        raise _translate_zarinpal_error(ZarinPalNotConfigured())

    try:
        result = await zarinpal_client.verify(
            amount=payment.amount, authority=authority
        )
    except Exception as exc:  # noqa: BLE001 - translated below
        # Record the failure code when available, mark FAILED, and surface it.
        if isinstance(exc, ZarinPalError):
            try:
                payment.code = int(exc.code)
            except (TypeError, ValueError):
                payment.code = None
        payment.status = ZarinPalPaymentStatusEnum.FAILED
        payment.update_date = str(datetime.now())
        db_session.add(payment)
        await db_session.commit()
        logger.warning(
            "ZarinPal verify failed for payment %s: %s", payment.payment_uuid, exc
        )
        raise _translate_zarinpal_error(exc)

    # Verified and settled: record receipt fields, grant access, mark completed.
    payment.code = result.get("code")
    ref_id = result.get("ref_id")
    if ref_id is not None:
        payment.ref_id = str(ref_id)
    card_pan = result.get("card_pan")
    if card_pan:
        payment.card_pan = str(card_pan)

    await _grant_course_access(db_session, payment)
    payment.status = ZarinPalPaymentStatusEnum.COMPLETED
    payment.update_date = str(datetime.now())
    db_session.add(payment)
    await db_session.commit()
    await db_session.refresh(payment)
    return payment


# ---------------------------------------------------------------------------
# Access granting via UserGroup membership
# ---------------------------------------------------------------------------


def _purchasers_group_name(course: Course) -> str:
    return f"ZarinPal purchasers: {course.name}"[:255]


async def _get_or_create_purchasers_group(
    db_session: AsyncSession, course: Course
) -> UserGroup:
    """Return the per-course purchasers UserGroup, creating + linking it once.

    The group is identified by the course it holds as a resource, so repeated
    purchases of the same course reuse the same group.
    """
    linked = (
        await db_session.execute(
            select(UserGroup)
            .join(UserGroupResource, UserGroupResource.usergroup_id == UserGroup.id)
            .where(
                UserGroupResource.resource_uuid == course.course_uuid,
                UserGroup.org_id == course.org_id,
                UserGroup.name == _purchasers_group_name(course),
            )
        )
    ).scalars().first()
    if linked:
        return linked

    now = str(datetime.now())
    group = UserGroup(
        name=_purchasers_group_name(course),
        description="Auto-created: users who purchased this course via ZarinPal.",
        org_id=course.org_id,
        usergroup_uuid=f"usergroup_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db_session.add(group)
    await db_session.flush()  # assign group.id

    # Link the course to the group so group membership grants course access.
    db_session.add(
        UserGroupResource(
            usergroup_id=group.id,  # type: ignore[arg-type]
            resource_uuid=course.course_uuid,
            org_id=course.org_id,
            creation_date=now,
            update_date=now,
        )
    )
    await db_session.flush()
    return group


async def _user_has_course_access(
    db_session: AsyncSession, user_id: int, course: Course
) -> bool:
    """Whether the user is already a member of a group that holds this course."""
    row = (
        await db_session.execute(
            select(UserGroupUser.id)
            .join(
                UserGroupResource,
                UserGroupResource.usergroup_id == UserGroupUser.usergroup_id,
            )
            .where(
                UserGroupResource.resource_uuid == course.course_uuid,
                UserGroupUser.user_id == user_id,
            )
        )
    ).scalars().first()
    return row is not None


async def _grant_course_access(
    db_session: AsyncSession, payment: ZarinPalPayment
) -> None:
    """Add the buyer to the course's purchasers UserGroup (idempotent)."""
    course = (
        await db_session.execute(
            select(Course).where(Course.id == payment.course_id)
        )
    ).scalars().first()
    if not course:
        logger.error(
            "Cannot grant access: course %s for payment %s is gone",
            payment.course_id,
            payment.payment_uuid,
        )
        return

    group = await _get_or_create_purchasers_group(db_session, course)

    existing = (
        await db_session.execute(
            select(UserGroupUser.id).where(
                UserGroupUser.usergroup_id == group.id,
                UserGroupUser.user_id == payment.user_id,
            )
        )
    ).scalars().first()
    if existing:
        return

    now = str(datetime.now())
    db_session.add(
        UserGroupUser(
            usergroup_id=group.id,  # type: ignore[arg-type]
            user_id=payment.user_id,
            org_id=payment.org_id,
            creation_date=now,
            update_date=now,
        )
    )
    await db_session.flush()


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def to_read(payment: ZarinPalPayment) -> ZarinPalPaymentRead:
    return ZarinPalPaymentRead(
        id=payment.id,  # type: ignore[arg-type]
        payment_uuid=payment.payment_uuid,
        org_id=payment.org_id,
        user_id=payment.user_id,
        course_id=payment.course_id,
        amount=payment.amount,
        authority=payment.authority,
        ref_id=payment.ref_id,
        card_pan=payment.card_pan,
        code=payment.code,
        status=payment.status,
        creation_date=payment.creation_date,
        update_date=payment.update_date,
    )


async def get_payment(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    payment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> ZarinPalPaymentRead:
    """Fetch a payment. The owning buyer or an org admin may read it."""
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await _get_org_or_404(db_session, org_id)

    payment = (
        await db_session.execute(
            select(ZarinPalPayment).where(
                ZarinPalPayment.payment_uuid == payment_uuid,
                ZarinPalPayment.org_id == org_id,
            )
        )
    ).scalars().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    if payment.user_id != acting_user_id:
        # Not the buyer: require org admin rights to view someone else's payment.
        await require_org_role_permission(
            acting_user_id, org_id, db_session, "organizations", "action_read"
        )

    return to_read(payment)
