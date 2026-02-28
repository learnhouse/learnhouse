from fastapi import HTTPException
from sqlmodel import Session, select
import stripe
import logging

from ee.db.payments.payments_offers import PaymentsOffer
from src.db.users import User
from ee.db.payments.payments import PaymentsConfig

logger = logging.getLogger(__name__)

async def get_user_from_customer(customer_id: str, db_session: Session) -> User:
    """Helper function to get user from Stripe customer ID"""
    try:
        customer = stripe.Customer.retrieve(customer_id)
        statement = select(User).where(User.email == customer.email)
        user = db_session.exec(statement).first()
        if not user:
            raise HTTPException(
                status_code=404, detail=f"User not found for customer {customer_id}"
            )
        return user
    except stripe.StripeError as e:
        logger.error(f"Stripe error retrieving customer {customer_id}: {str(e)}")
        raise HTTPException(
            status_code=400, detail="Error retrieving customer information"
        )


async def get_offer_from_stripe_id(
    product_id: str, db_session: Session
) -> PaymentsOffer | None:
    """Helper function to get offer from Stripe product ID (new architecture)"""
    statement = select(PaymentsOffer).where(
        PaymentsOffer.provider_product_id == product_id
    )
    return db_session.exec(statement).first()


async def get_org_id_from_stripe_account(
    stripe_account_id: str,
    db_session: Session,
) -> int:
    """Get organization ID from Stripe account ID"""
    statement = select(PaymentsConfig).where(
        PaymentsConfig.provider_specific_id == stripe_account_id
    )
    config = db_session.exec(statement).first()

    if not config:
        raise HTTPException(
            status_code=404,
            detail=f"No organization found for Stripe account {stripe_account_id}",
        )

    return config.org_id
