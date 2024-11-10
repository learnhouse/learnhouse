from fastapi import HTTPException
from sqlmodel import Session, select
import stripe
import logging

from src.db.payments.payments_products import PaymentsProduct
from src.db.users import User
from src.db.payments.payments import PaymentsConfig

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


async def get_product_from_stripe_id(
    product_id: str, db_session: Session
) -> PaymentsProduct:
    """Helper function to get product from Stripe product ID"""
    statement = select(PaymentsProduct).where(
        PaymentsProduct.provider_product_id == product_id
    )
    product = db_session.exec(statement).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product not found: {product_id}")
    return product


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
