from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from ee.db.payments.payments_enrollments import PaymentsEnrollment
from ee.db.payments.payments_offers import PaymentsOffer
from src.services.orgs.orgs import rbac_check
from src.services.users.users import read_user_by_id


async def get_customers(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    customers_data = []

    # --- New architecture: enrollment-based ---
    stmt = (
        select(PaymentsEnrollment, PaymentsOffer)
        .join(PaymentsOffer, PaymentsEnrollment.offer_id == PaymentsOffer.id)  # type: ignore
        .where(PaymentsEnrollment.org_id == org_id)
    )
    enrollment_rows = db_session.exec(stmt).all()

    for enrollment, offer in enrollment_rows:
        user = await read_user_by_id(request, db_session, current_user, enrollment.user_id)
        customers_data.append({
            "enrollment_id": enrollment.id,
            "user": user if user else None,
            "offer": {
                "id": offer.id,
                "name": offer.name,
                "description": offer.description,
                "offer_type": offer.offer_type,
                "amount": offer.amount,
                "currency": offer.currency,
            },
            "status": enrollment.status,
            "creation_date": enrollment.creation_date,
            "update_date": enrollment.update_date,
        })

    return customers_data
