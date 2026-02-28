import logging
from datetime import datetime
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from ee.db.payments.payments import PaymentsConfig
from ee.db.payments.payments_enrollments import PaymentsEnrollment
from ee.db.payments.payments_offers import PaymentsOffer, OfferTypeEnum
from src.services.orgs.orgs import rbac_check
from src.services.users.users import read_user_by_id

logger = logging.getLogger(__name__)


def _fetch_stripe_data(stripe_customer_id: str, offer_type: str, stripe_acc_id: str) -> dict:
    """
    Fetch live Stripe data for a customer:
    - Default payment method (brand + last4)
    - Last successful charge (date + amount)
    - For subscriptions: next billing date, cancel_at_period_end
    """
    import stripe

    result: dict = {
        "payment_method": None,
        "last_charge_date": None,
        "last_charge_amount": None,
        "next_billing_date": None,
        "cancel_at_period_end": None,
        "stripe_customer_url": f"https://dashboard.stripe.com/customers/{stripe_customer_id}",
    }

    try:
        customer = stripe.Customer.retrieve(
            stripe_customer_id,
            expand=["invoice_settings.default_payment_method"],
            stripe_account=stripe_acc_id,
        )

        # Payment method
        pm = customer.get("invoice_settings", {}).get("default_payment_method")
        if pm and isinstance(pm, dict) and pm.get("card"):
            result["payment_method"] = {
                "brand": pm["card"].get("brand"),
                "last4": pm["card"].get("last4"),
                "exp_month": pm["card"].get("exp_month"),
                "exp_year": pm["card"].get("exp_year"),
            }

        # Last successful charge
        charges = stripe.Charge.list(
            customer=stripe_customer_id,
            limit=1,
            stripe_account=stripe_acc_id,
        )
        if charges.data:
            charge = charges.data[0]
            if charge.get("paid"):
                result["last_charge_date"] = datetime.fromtimestamp(charge["created"]).isoformat()
                result["last_charge_amount"] = charge.get("amount_captured", 0) / 100

        # Subscription-specific fields
        if offer_type == OfferTypeEnum.SUBSCRIPTION:
            subs = stripe.Subscription.list(
                customer=stripe_customer_id,
                limit=1,
                status="active",
                stripe_account=stripe_acc_id,
            )
            if subs.data:
                sub = subs.data[0]
                result["next_billing_date"] = datetime.fromtimestamp(
                    sub["current_period_end"]
                ).isoformat()
                result["cancel_at_period_end"] = sub.get("cancel_at_period_end", False)

    except Exception as e:
        logger.warning(f"Failed to fetch Stripe data for customer {stripe_customer_id}: {e}")

    return result


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

    # Resolve Stripe connected account ID for this org
    stripe_acc_id: str | None = None
    stripe_api_key: str | None = None
    try:
        import stripe as stripe_mod
        from config.config import get_learnhouse_config
        config = db_session.exec(select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)).first()
        if config and config.provider_specific_id and config.active:
            stripe_acc_id = config.provider_specific_id
            lh_cfg = get_learnhouse_config()
            stripe_api_key = lh_cfg.payments_config.stripe.stripe_secret_key
            stripe_mod.api_key = stripe_api_key
    except Exception as e:
        logger.warning(f"Could not initialize Stripe for org {org_id}: {e}")

    customers_data = []

    stmt = (
        select(PaymentsEnrollment, PaymentsOffer)
        .join(PaymentsOffer, PaymentsEnrollment.offer_id == PaymentsOffer.id)  # type: ignore
        .where(PaymentsEnrollment.org_id == org_id)
    )
    enrollment_rows = db_session.exec(stmt).all()

    for enrollment, offer in enrollment_rows:
        user = await read_user_by_id(request, db_session, current_user, enrollment.user_id)

        stripe_customer_id: str | None = (
            enrollment.provider_specific_data.get("stripe_customer")
            if enrollment.provider_specific_data
            else None
        )

        stripe_data = None
        if stripe_acc_id and stripe_customer_id:
            stripe_data = _fetch_stripe_data(stripe_customer_id, offer.offer_type, stripe_acc_id)

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
            "stripe_customer_id": stripe_customer_id,
            "stripe": stripe_data,
        })

    return customers_data
