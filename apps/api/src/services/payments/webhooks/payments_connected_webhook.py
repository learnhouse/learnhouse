from fastapi import HTTPException, Request
from sqlmodel import Session, select
import stripe
import logging

from src.db.payments.payments_users import PaymentStatusEnum
from src.db.payments.payments_products import PaymentsProduct
from src.db.users import InternalUser, User
from src.services.payments.payments_users import update_payment_user_status
from src.services.payments.payments_stripe import get_stripe_credentials

logger = logging.getLogger(__name__)

async def get_user_from_customer(customer_id: str, db_session: Session) -> User:
    """Helper function to get user from Stripe customer ID"""
    try:
        customer = stripe.Customer.retrieve(customer_id)
        statement = select(User).where(User.email == customer.email)
        user = db_session.exec(statement).first()
        if not user:
            raise HTTPException(status_code=404, detail=f"User not found for customer {customer_id}")
        return user
    except stripe.StripeError as e:
        logger.error(f"Stripe error retrieving customer {customer_id}: {str(e)}")
        raise HTTPException(status_code=400, detail="Error retrieving customer information")

async def get_product_from_stripe_id(product_id: str, db_session: Session) -> PaymentsProduct:
    """Helper function to get product from Stripe product ID"""
    statement = select(PaymentsProduct).where(PaymentsProduct.provider_product_id == product_id)
    product = db_session.exec(statement).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product not found: {product_id}")
    return product

async def handle_stripe_webhook(
    request: Request,
    org_id: int,
    db_session: Session,
) -> dict:
    # Get Stripe credentials for the organization
    creds = await get_stripe_credentials(request, org_id, InternalUser(), db_session)
    
    # Get the webhook secret and API key from credentials
    webhook_secret = creds.get('stripe_webhook_secret')
    stripe.api_key = creds.get('stripe_secret_key')  # Set API key globally
    
    if not webhook_secret:
        raise HTTPException(status_code=400, detail="Stripe webhook secret not configured")

    # Get the raw request body
    payload = await request.body()
    sig_header = request.headers.get('stripe-signature')

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, webhook_secret
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    # Handle the event
    if event.type == 'checkout.session.completed':
        session = event.data.object
        payment_user_id = int(session.get('metadata', {}).get('payment_user_id'))
        
        if session.get('mode') == 'subscription':
            # Handle subscription payment
            if session.get('subscription'):
                await update_payment_user_status(
                    request=request,
                    org_id=org_id,
                    payment_user_id=payment_user_id,
                    status=PaymentStatusEnum.ACTIVE,
                    current_user=InternalUser(),
                    db_session=db_session
                )
        else:
            # Handle one-time payment
            if session.get('payment_status') == 'paid':
                await update_payment_user_status(
                    request=request,
                    org_id=org_id,
                    payment_user_id=payment_user_id,
                    status=PaymentStatusEnum.COMPLETED,
                    current_user=InternalUser(),
                    db_session=db_session
                )

    elif event.type == 'customer.subscription.deleted':
        subscription = event.data.object
        payment_user_id = int(subscription.get('metadata', {}).get('payment_user_id'))
        
        await update_payment_user_status(
            request=request,
            org_id=org_id,
            payment_user_id=payment_user_id,
            status=PaymentStatusEnum.CANCELLED,
            current_user=InternalUser(),
            db_session=db_session
        )

    elif event.type == 'payment_intent.payment_failed':
        payment_intent = event.data.object
        payment_user_id = int(payment_intent.get('metadata', {}).get('payment_user_id'))
        
        await update_payment_user_status(
            request=request,
            org_id=org_id,
            payment_user_id=payment_user_id,
            status=PaymentStatusEnum.FAILED,
            current_user=InternalUser(),
            db_session=db_session
        )

    return {"status": "success"}


        
       