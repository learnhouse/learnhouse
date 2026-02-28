from sqlmodel import Session, select
from src.security.rbac.rbac import authorization_verify_if_user_is_author
from src.db.users import PublicUser, AnonymousUser
from ee.db.payments.payments_groups import PaymentsGroupResource, PaymentsOfferResource
from ee.db.payments.payments_enrollments import PaymentsEnrollment, EnrollmentStatusEnum
from ee.db.payments.payments_offers import PaymentsOffer
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from fastapi import HTTPException, Request


PAID_STATUSES = {EnrollmentStatusEnum.ACTIVE, EnrollmentStatusEnum.COMPLETED}


async def check_enrollment_access(resource_uuid: str, user_id: int, db_session: Session) -> bool:
    """
    Returns True if the user has an ACTIVE or COMPLETED enrollment for any offer
    that grants access to this resource. This is an enrollment-based access check
    that is independent of UserGroup membership — used as a parallel RBAC path.
    """
    # Path 1: direct offer → resource link
    direct_rows = db_session.exec(
        select(PaymentsOfferResource).where(
            PaymentsOfferResource.resource_uuid == resource_uuid
        )
    ).all()
    direct_offer_ids = [r.offer_id for r in direct_rows]

    # Path 2: offer → group → resource link
    group_resource_rows = db_session.exec(
        select(PaymentsGroupResource).where(
            PaymentsGroupResource.resource_uuid == resource_uuid
        )
    ).all()
    group_ids = [r.payments_group_id for r in group_resource_rows]

    grouped_offer_ids: list[int] = []
    if group_ids:
        grouped_offers = db_session.exec(
            select(PaymentsOffer).where(
                PaymentsOffer.payments_group_id.in_(group_ids)  # type: ignore
            )
        ).all()
        grouped_offer_ids = [o.id for o in grouped_offers]

    all_offer_ids = list(set(direct_offer_ids + grouped_offer_ids))
    if not all_offer_ids:
        return False  # resource is not behind any offer

    enrollment = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.offer_id.in_(all_offer_ids),  # type: ignore
            PaymentsEnrollment.user_id == user_id,
            PaymentsEnrollment.status.in_(list(PAID_STATUSES)),  # type: ignore
        )
    ).first()

    return enrollment is not None


async def check_activity_paid_access(
    request: Request,
    activity_id: int,
    user: PublicUser | AnonymousUser,
    db_session: Session,
) -> bool:
    """
    Check if a user has access to a specific activity.
    Returns True if:
    - User is an author of the course
    - Course is not linked to any paid offer (free course)
    - User has an active enrollment for an offer granting access to this course
    """

    # Get activity and associated course
    activity = db_session.exec(select(Activity).where(Activity.id == activity_id)).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    course = db_session.exec(select(Course).where(Course.id == activity.course_id)).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Authors always have access
    is_course_author = await authorization_verify_if_user_is_author(
        request, user.id, "update", course.course_uuid, db_session
    )
    if is_course_author:
        return True

    # Collect all offer IDs that grant access to this course
    offer_ids: set[int] = set()

    # Path 1: course linked directly to an offer via PaymentsOfferResource
    direct_resources = db_session.exec(
        select(PaymentsOfferResource).where(
            PaymentsOfferResource.resource_uuid == course.course_uuid
        )
    ).all()
    for r in direct_resources:
        offer_ids.add(r.offer_id)

    # Path 2: course linked via a PaymentsGroup → find all offers in that group
    group_resources = db_session.exec(
        select(PaymentsGroupResource).where(
            PaymentsGroupResource.resource_uuid == course.course_uuid
        )
    ).all()
    if group_resources:
        group_ids = [gr.payments_group_id for gr in group_resources]
        group_offers = db_session.exec(
            select(PaymentsOffer).where(
                PaymentsOffer.payments_group_id.in_(group_ids)  # type: ignore
            )
        ).all()
        for o in group_offers:
            offer_ids.add(o.id)

    # Course is not behind any paid offer — free access
    if not offer_ids:
        return True

    # Paid course — anonymous users have no access
    if isinstance(user, AnonymousUser):
        return False

    # Check for an active enrollment in any of the relevant offers
    enrollment = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.offer_id.in_(list(offer_ids)),  # type: ignore
            PaymentsEnrollment.user_id == user.id,
            PaymentsEnrollment.status.in_(  # type: ignore
                [EnrollmentStatusEnum.ACTIVE, EnrollmentStatusEnum.COMPLETED]
            ),
        )
    ).first()
    return bool(enrollment)


async def check_course_paid_access(
    course_id: int,
    user: PublicUser | AnonymousUser,
    db_session: Session,
) -> bool:
    """
    Check if a user has paid access to a specific course.
    Returns True if:
    - Course is free (not linked to any paid offer)
    - User has an active enrollment for an offer granting access
    """
    course = db_session.exec(select(Course).where(Course.id == course_id)).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    offer_ids: set[int] = set()

    direct_resources = db_session.exec(
        select(PaymentsOfferResource).where(
            PaymentsOfferResource.resource_uuid == course.course_uuid
        )
    ).all()
    for r in direct_resources:
        offer_ids.add(r.offer_id)

    group_resources = db_session.exec(
        select(PaymentsGroupResource).where(
            PaymentsGroupResource.resource_uuid == course.course_uuid
        )
    ).all()
    if group_resources:
        group_ids = [gr.payments_group_id for gr in group_resources]
        group_offers = db_session.exec(
            select(PaymentsOffer).where(
                PaymentsOffer.payments_group_id.in_(group_ids)  # type: ignore
            )
        ).all()
        for o in group_offers:
            offer_ids.add(o.id)

    if not offer_ids:
        return True

    if isinstance(user, AnonymousUser):
        return False

    enrollment = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.offer_id.in_(list(offer_ids)),  # type: ignore
            PaymentsEnrollment.user_id == user.id,
            PaymentsEnrollment.status.in_(  # type: ignore
                [EnrollmentStatusEnum.ACTIVE, EnrollmentStatusEnum.COMPLETED]
            ),
        )
    ).first()
    return bool(enrollment)
