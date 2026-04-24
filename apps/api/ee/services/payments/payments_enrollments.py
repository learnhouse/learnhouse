import logging
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from datetime import datetime

from ee.db.payments.payments_enrollments import (
    EnrollmentStatusEnum,
    PaymentsEnrollment,
    PaymentsEnrollmentRead,
)
from ee.db.payments.payments_offers import PaymentsOffer
from ee.db.payments.payments_groups import PaymentsGroupSync, PaymentsGroupResource
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser, InternalUser, PublicUser, User
from src.services.orgs.orgs import rbac_check
from src.services.users.usergroups import add_users_to_usergroup, remove_users_from_usergroup
from src.services.users.emails import send_purchase_welcome_email
from src.services.email.utils import get_base_url_from_request

_enrollment_logger = logging.getLogger(__name__)


async def create_enrollment(
    request: Request,
    org_id: int,
    offer_id: int,
    user_id: int,
    status: EnrollmentStatusEnum,
    provider_data: dict,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> PaymentsEnrollment:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "create", db_session)

    offer = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.id == offer_id, PaymentsOffer.org_id == org_id)
    ).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")

    existing = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.user_id == user_id,
            PaymentsEnrollment.offer_id == offer_id,
            PaymentsEnrollment.org_id == org_id,
        )
    ).first()
    if existing:
        if existing.status in [EnrollmentStatusEnum.PENDING, EnrollmentStatusEnum.CANCELLED, EnrollmentStatusEnum.FAILED]:
            db_session.delete(existing)
            db_session.commit()
        else:
            raise HTTPException(status_code=400, detail="User already has an active enrollment for this offer")

    enrollment = PaymentsEnrollment(
        offer_id=offer_id,
        user_id=user_id,
        org_id=org_id,
        status=status,
        provider_specific_data=provider_data or {},
        creation_date=datetime.now(),
        update_date=datetime.now(),
    )
    db_session.add(enrollment)
    db_session.commit()
    db_session.refresh(enrollment)
    return enrollment


async def update_enrollment_status(
    request: Request,
    org_id: int,
    enrollment_id: int,
    status: EnrollmentStatusEnum,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> PaymentsEnrollment:
    """
    Central side-effect function for all enrollment status changes.

    ACTIVE/COMPLETED → add user to all UserGroups synced via the offer's PaymentsGroup
    CANCELLED/REFUNDED → remove user from those same UserGroups

    All webhooks and admin overrides must flow through this function.
    """
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    enrollment = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.id == enrollment_id,
            PaymentsEnrollment.org_id == org_id,
        )
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    offer = db_session.exec(select(PaymentsOffer).where(PaymentsOffer.id == enrollment.offer_id)).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")

    old_status = enrollment.status
    enrollment.status = status
    enrollment.update_date = datetime.now()
    db_session.add(enrollment)
    db_session.commit()
    db_session.refresh(enrollment)

    # Determine synced UserGroups via the offer's PaymentsGroup
    synced_usergroup_ids: list[int] = []
    if offer.payments_group_id is not None:
        sync_rows = db_session.exec(
            select(PaymentsGroupSync).where(
                PaymentsGroupSync.payments_group_id == offer.payments_group_id
            )
        ).all()
        synced_usergroup_ids = [row.usergroup_id for row in sync_rows]

    active_statuses = {EnrollmentStatusEnum.ACTIVE, EnrollmentStatusEnum.COMPLETED}
    inactive_statuses = {EnrollmentStatusEnum.CANCELLED, EnrollmentStatusEnum.REFUNDED}

    for ug_id in synced_usergroup_ids:
        if status in active_statuses and old_status not in active_statuses:
            await add_users_to_usergroup(
                request=request,
                db_session=db_session,
                current_user=InternalUser(),
                usergroup_id=ug_id,
                user_ids=str(enrollment.user_id),
            )
        elif status in inactive_statuses and old_status in active_statuses:
            await remove_users_from_usergroup(
                request=request,
                db_session=db_session,
                current_user=InternalUser(),
                usergroup_id=ug_id,
                user_ids=str(enrollment.user_id),
            )

    # On first activation, send a welcome-to-premium email. Failures are
    # swallowed so a transient email provider outage never breaks a paid
    # webhook (the enrollment status change itself is the source of truth).
    if status in active_statuses and old_status not in active_statuses:
        try:
            user_row = db_session.exec(select(User).where(User.id == enrollment.user_id)).first()
            course_row = None
            if offer.payments_group_id is not None:
                group_resource = db_session.exec(
                    select(PaymentsGroupResource).where(
                        PaymentsGroupResource.payments_group_id == offer.payments_group_id
                    )
                ).first()
                if group_resource and group_resource.resource_uuid.startswith("course_"):
                    course_row = db_session.exec(
                        select(Course).where(Course.course_uuid == group_resource.resource_uuid)
                    ).first()

            if user_row and user_row.email:
                base_url = get_base_url_from_request(request)
                course_name = course_row.name if course_row else offer.name
                course_url = (
                    f"{base_url}/course/{course_row.course_uuid}" if course_row else base_url
                )
                send_purchase_welcome_email(
                    email=user_row.email,
                    username=user_row.username or user_row.first_name or "",
                    course_name=course_name,
                    course_url=course_url,
                    offer_name=offer.name,
                )
        except Exception:
            _enrollment_logger.exception(
                "Failed to send purchase welcome email for enrollment %s", enrollment.id
            )

    return enrollment


async def get_enrollment(
    request: Request,
    org_id: int,
    enrollment_id: int,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> PaymentsEnrollmentRead:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    enrollment = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.id == enrollment_id,
            PaymentsEnrollment.org_id == org_id,
        )
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    return PaymentsEnrollmentRead.model_validate(enrollment)


async def list_enrollments(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> list[PaymentsEnrollmentRead]:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    enrollments = db_session.exec(
        select(PaymentsEnrollment)
        .where(PaymentsEnrollment.org_id == org_id)
        .order_by(PaymentsEnrollment.id.desc())  # type: ignore
    ).all()
    return [PaymentsEnrollmentRead.model_validate(e) for e in enrollments]


async def get_user_enrollments(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> list[dict]:
    if isinstance(current_user, AnonymousUser):
        return []

    results = db_session.exec(
        select(PaymentsEnrollment, PaymentsOffer)
        .join(PaymentsOffer, PaymentsEnrollment.offer_id == PaymentsOffer.id)  # type: ignore
        .where(
            PaymentsEnrollment.user_id == current_user.id,
            PaymentsEnrollment.org_id == org_id,
            PaymentsEnrollment.status.in_([EnrollmentStatusEnum.ACTIVE, EnrollmentStatusEnum.COMPLETED]),  # type: ignore
        )
    ).all()

    return [
        {
            "enrollment_id": enrollment.id,
            "offer_id": offer.id,
            "offer_name": offer.name,
            "offer_type": offer.offer_type,
            "amount": offer.amount,
            "currency": offer.currency,
            "payments_group_id": offer.payments_group_id,
            "status": enrollment.status,
            "creation_date": enrollment.creation_date,
        }
        for enrollment, offer in results
    ]


async def delete_enrollment(
    request: Request,
    org_id: int,
    enrollment_id: int,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> None:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    enrollment = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.id == enrollment_id,
            PaymentsEnrollment.org_id == org_id,
        )
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    db_session.delete(enrollment)
    db_session.commit()
