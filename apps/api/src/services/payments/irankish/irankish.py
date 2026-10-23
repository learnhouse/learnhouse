"""
Course-purchase flow over the IranKish (Shaparak) IPG.

Module-level ``async def`` functions following the Skyroom service conventions:
each takes ``(request, db_session, ..., current_user)``, enforces authorization,
mutates through the session, and returns a Pydantic read schema. Remote calls go
through ``client``; its three exception classes are translated to HTTPExceptions.

Pricing model
-------------
Since the full offers/enrollments subsystem is an Enterprise-Edition feature not
present in this edition, a course's IRR price is stored on the course itself, in
``course.extra_metadata['irankish_price_irr']`` (a positive integer in Rial). A
course with no price set is not purchasable through this gateway. An org admin
sets the price with ``set_course_price``.

Granting access
----------------
On a confirmed payment the buyer is granted access the same way the rest of the
platform grants course access: a dedicated per-course "purchasers" ``UserGroup``
holds the course as a ``UserGroupResource`` and each buyer as a ``UserGroupUser``.
The course-visibility query already treats UserGroup membership as access.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.irankish import (
    IranKishPayment,
    IranKishPaymentRead,
    IranKishPaymentStatusEnum,
)
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import require_org_role_permission
from src.security.rbac.rbac import authorization_verify_if_user_is_anon
from src.services.payments.irankish import client as irankish_client
from src.services.payments.irankish.client import (
    IranKishError,
    IranKishNotConfigured,
    IranKishTransportError,
)
from src.services.payments.irankish.crypto import (
    EnvelopeError,
    make_authentication_envelope,
)

logger = logging.getLogger(__name__)

# Key under which a course stores its IRR price for this gateway.
PRICE_METADATA_KEY = "irankish_price_irr"
# ISO-8583 success code echoed by the gateway in callback / confirmation.
SUCCESS_CODE = irankish_client.RESPONSE_CODE_SUCCESS


# ---------------------------------------------------------------------------
# Error translation
# ---------------------------------------------------------------------------


def _translate_irankish_error(exc: Exception) -> HTTPException:
    """Map an IranKish client/crypto exception to an HTTPException."""
    if isinstance(exc, IranKishNotConfigured):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="IranKish payment gateway is not configured for this instance.",
        )
    if isinstance(exc, IranKishTransportError):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach the IranKish payment gateway. Please try again later.",
        )
    if isinstance(exc, EnvelopeError):
        # A bad amount or misconfigured key is our problem, not the user's card.
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not build the payment request. Please contact support.",
        )
    if isinstance(exc, IranKishError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Payment gateway rejected the request (code {exc.response_code}).",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Unexpected error talking to the IranKish payment gateway.",
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


async def _is_org_member(
    db_session: AsyncSession, user_id: int, org_id: int
) -> bool:
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
    """Set (or clear, with ``None``) a course's IranKish price, admin-only.

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
    revert_uri: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> dict:
    """Start a purchase: obtain a gateway token and return redirect form data.

    ``revert_uri`` is the absolute URL the gateway POSTs the payment result to
    (our callback). The caller (router) supplies it so the backend host is not
    hard-coded here.
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

    cfg = irankish_client.get_learnhouse_config().irankish_config
    if cfg is None:
        raise _translate_irankish_error(IranKishNotConfigured())

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

    # A unique, <=20-char request id; the gateway only requires uniqueness.
    request_id = uuid4().hex[:20]

    # Build the digital envelope and the token request body.
    try:
        envelope = make_authentication_envelope(
            terminal_id=cfg.terminal_id,  # type: ignore[arg-type]
            pass_phrase=cfg.pass_phrase,  # type: ignore[arg-type]
            amount=price,
            public_key_pem=cfg.public_key,  # type: ignore[arg-type]
        )
    except Exception as exc:  # noqa: BLE001 - translated below
        logger.exception("Failed to build IranKish digital envelope")
        raise _translate_irankish_error(exc)

    request_body = {
        "transactionType": "Purchase",
        "terminalId": cfg.terminal_id,
        "acceptorId": cfg.acceptor_id,
        "amount": price,
        "revertUri": revert_uri,
        "requestId": request_id,
        "requestTimestamp": int(datetime.now().timestamp()),
        "billInfo": None,
        "multiplexParameters": None,
        "paymentId": None,
    }

    # Persist a PENDING row before redirecting so the callback can find it even
    # if the token call succeeds but the response is lost in transit.
    now = str(datetime.now())
    payment = IranKishPayment(
        payment_uuid=f"ikpay_{uuid4()}",
        org_id=org_id,
        user_id=acting_user_id,
        course_id=course_id,
        amount=price,
        request_id=request_id,
        status=IranKishPaymentStatusEnum.PENDING,
        creation_date=now,
        update_date=now,
    )
    db_session.add(payment)
    await db_session.commit()
    await db_session.refresh(payment)

    try:
        token = await irankish_client.make_token(request_body, envelope.to_request())
    except Exception as exc:  # noqa: BLE001 - translated below
        # Mark the attempt failed so it is not left dangling as PENDING.
        payment.status = IranKishPaymentStatusEnum.FAILED
        payment.update_date = str(datetime.now())
        db_session.add(payment)
        await db_session.commit()
        raise _translate_irankish_error(exc)

    payment.token = token
    payment.update_date = str(datetime.now())
    db_session.add(payment)
    await db_session.commit()
    await db_session.refresh(payment)

    return {
        "payment_uuid": payment.payment_uuid,
        "payment_url": irankish_client.get_payment_page_url(),
        "form_fields": {"tokenIdentity": token},
        "amount": price,
    }


# ---------------------------------------------------------------------------
# Callback / verification
# ---------------------------------------------------------------------------


async def handle_callback(
    request: Request,
    db_session: AsyncSession,
    callback: dict,
) -> IranKishPayment:
    """Process the gateway's result POST to our revert URI.

    The caller is anonymous (the gateway, not a logged-in user), so this does
    NOT take a ``current_user``. The payment is located by its ``token``; the
    buyer recorded on the PENDING row is the one granted access, so a forged
    callback cannot grant access to a different user.

    On a successful result we call the confirmation service; only a "00"
    confirmation flips the payment to COMPLETED and grants access.
    """
    token = callback.get("token") or callback.get("tokenIdentity")
    response_code = str(callback.get("responseCode", ""))

    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing payment token in callback.",
        )

    payment = (
        await db_session.execute(
            select(IranKishPayment).where(IranKishPayment.token == token)
        )
    ).scalars().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Idempotency: a repeated callback for an already-completed payment is a
    # no-op success (the gateway may retry).
    if payment.status == IranKishPaymentStatusEnum.COMPLETED:
        return payment

    # Record callback fields regardless of outcome, for audit / confirmation.
    payment.response_code = response_code or payment.response_code
    rrn = callback.get("retrievalReferenceNumber")
    stan = callback.get("systemTraceAuditNumber")
    if rrn:
        payment.retrieval_reference_number = str(rrn)
    if stan:
        payment.system_trace_audit_number = str(stan)
    masked = callback.get("maskedPan")
    if masked:
        payment.masked_pan = str(masked)

    # A non-success response code means the card was not charged / user aborted.
    if response_code != SUCCESS_CODE:
        payment.status = IranKishPaymentStatusEnum.FAILED
        payment.update_date = str(datetime.now())
        db_session.add(payment)
        await db_session.commit()
        await db_session.refresh(payment)
        return payment

    # Card charged. Mark PAID, then confirm so the gateway settles to us. If we
    # never confirm within ~20 min the gateway auto-reverses the charge.
    payment.status = IranKishPaymentStatusEnum.PAID
    payment.update_date = str(datetime.now())
    db_session.add(payment)
    await db_session.commit()

    cfg = irankish_client.get_learnhouse_config().irankish_config
    if cfg is None:
        raise _translate_irankish_error(IranKishNotConfigured())

    try:
        await irankish_client.confirm(
            terminal_id=cfg.terminal_id,  # type: ignore[arg-type]
            retrieval_reference_number=payment.retrieval_reference_number or "",
            system_trace_audit_number=payment.system_trace_audit_number or "",
            token_identity=token,
            invoice_id=payment.request_id,
            amount=payment.amount,
        )
    except Exception as exc:  # noqa: BLE001 - translated below
        # Leave the row PAID so an operator can reconcile; surface the error.
        logger.warning(
            "IranKish confirmation failed for payment %s: %s",
            payment.payment_uuid,
            exc,
        )
        raise _translate_irankish_error(exc)

    # Confirmed and settled: grant access and mark completed.
    await _grant_course_access(db_session, payment)
    payment.status = IranKishPaymentStatusEnum.COMPLETED
    payment.update_date = str(datetime.now())
    db_session.add(payment)
    await db_session.commit()
    await db_session.refresh(payment)
    return payment


# ---------------------------------------------------------------------------
# Access granting via UserGroup membership
# ---------------------------------------------------------------------------


def _purchasers_group_name(course: Course) -> str:
    return f"IranKish purchasers: {course.name}"[:255]


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
        description="Auto-created: users who purchased this course via IranKish.",
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
    db_session: AsyncSession, payment: IranKishPayment
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


def to_read(payment: IranKishPayment) -> IranKishPaymentRead:
    return IranKishPaymentRead(
        id=payment.id,  # type: ignore[arg-type]
        payment_uuid=payment.payment_uuid,
        org_id=payment.org_id,
        user_id=payment.user_id,
        course_id=payment.course_id,
        amount=payment.amount,
        request_id=payment.request_id,
        token=payment.token,
        retrieval_reference_number=payment.retrieval_reference_number,
        system_trace_audit_number=payment.system_trace_audit_number,
        masked_pan=payment.masked_pan,
        response_code=payment.response_code,
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
) -> IranKishPaymentRead:
    """Fetch a payment. The owning buyer or an org admin may read it."""
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await _get_org_or_404(db_session, org_id)

    payment = (
        await db_session.execute(
            select(IranKishPayment).where(
                IranKishPayment.payment_uuid == payment_uuid,
                IranKishPayment.org_id == org_id,
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
