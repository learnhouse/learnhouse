from fastapi import HTTPException, Request
from sqlmodel import Session, select
import stripe
from datetime import datetime
from typing import Callable, Dict
import logging

from src.db.payments.payments_users import PaymentStatusEnum, PaymentsUser
from src.db.payments.payments_products import PaymentsProduct
from src.db.users import InternalUser, User
from src.services.payments.payments_users import create_payment_user, update_payment_user_status
from src.services.payments.stripe import get_stripe_credentials

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
        # Verify webhook signature and construct event
        event = stripe.Webhook.construct_event(
            payload, sig_header, webhook_secret
        )
        
        # Get the appropriate handler
        handler = STRIPE_EVENT_HANDLERS.get(event.type)
        if handler:
            await handler(request, event.data.object, org_id, db_session)
            return {"status": "success", "event": event.type}
        else:
            logger.info(f"Unhandled event type: {event.type}")
            return {"status": "ignored", "event": event.type}

    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing webhook: {str(e)}")

async def handle_checkout_session_completed(request: Request, session, org_id: int, db_session: Session):
    # Get the customer and product details from the session
    customer_email = session.customer_details.email
    product_id = session.line_items.data[0].price.product

    # Use helper functions
    user = await get_user_from_customer(session.customer, db_session)
    product = await get_product_from_stripe_id(product_id, db_session)

    # Find payment user record
    statement = select(PaymentsUser).where(
        PaymentsUser.user_id == user.id,
        PaymentsUser.payment_product_id == product.id
    )
    payment_user = db_session.exec(statement).first()

    # Update status to completed
    await update_payment_user_status(
        request=request,
        org_id=org_id,
        payment_user_id=payment_user.id, # type: ignore
        status=PaymentStatusEnum.COMPLETED,
        current_user=InternalUser(),
        db_session=db_session
    )

async def handle_subscription_created(request: Request, subscription, org_id: int, db_session: Session):
    customer_id = subscription.customer
    
    # Get product_id from metadata
    product_id = subscription.metadata.get('product_id')
    if not product_id:
        logger.error(f"No product_id found in subscription metadata: {subscription.id}")
        raise HTTPException(status_code=400, detail="No product_id found in subscription metadata")

    # Get customer email from Stripe
    customer = stripe.Customer.retrieve(customer_id)
    
    # Find user and create/update payment record
    statement = select(User).where(User.email == customer.email)
    user = db_session.exec(statement).first()
    
    if user:
        payment_user = await create_payment_user(
            request=request,
            org_id=org_id,
            user_id=user.id, # type: ignore
            product_id=int(product_id),  # Convert string from metadata to int
            current_user=InternalUser(),
            db_session=db_session
        )
        
        await update_payment_user_status(
            request=request,
            org_id=org_id,
            payment_user_id=payment_user.id, # type: ignore
            status=PaymentStatusEnum.ACTIVE,
            current_user=InternalUser(),
            db_session=db_session
        )

async def handle_subscription_updated(request: Request, subscription, org_id: int, db_session: Session):
    customer_id = subscription.customer
    
    # Get product_id from metadata
    product_id = subscription.metadata.get('product_id')
    if not product_id:
        logger.error(f"No product_id found in subscription metadata: {subscription.id}")
        raise HTTPException(status_code=400, detail="No product_id found in subscription metadata")
    
    customer = stripe.Customer.retrieve(customer_id)
    
    statement = select(User).where(User.email == customer.email)
    user = db_session.exec(statement).first()
    
    if user:
        statement = select(PaymentsUser).where(
            PaymentsUser.user_id == user.id,
            PaymentsUser.payment_product_id == int(product_id)  # Convert string from metadata to int
        )
        payment_user = db_session.exec(statement).first()
        
        if payment_user:
            status = PaymentStatusEnum.ACTIVE if subscription.status == 'active' else PaymentStatusEnum.PENDING
            await update_payment_user_status(
                request=request,
                org_id=org_id,
                payment_user_id=payment_user.id, # type: ignore
                status=status,
                current_user=InternalUser(),
                db_session=db_session
            )

async def handle_subscription_deleted(request: Request, subscription, org_id: int, db_session: Session):
    customer_id = subscription.customer
    
    # Get product_id from metadata
    product_id = subscription.metadata.get('product_id')
    if not product_id:
        logger.error(f"No product_id found in subscription metadata: {subscription.id}")
        raise HTTPException(status_code=400, detail="No product_id found in subscription metadata")
    
    customer = stripe.Customer.retrieve(customer_id)
    
    statement = select(User).where(User.email == customer.email)
    user = db_session.exec(statement).first()
    
    if user:
        statement = select(PaymentsUser).where(
            PaymentsUser.user_id == user.id,
            PaymentsUser.payment_product_id == int(product_id)  # Convert string from metadata to int
        )
        payment_user = db_session.exec(statement).first()
        
        if payment_user:
            await update_payment_user_status(
                request=request,
                org_id=org_id,
                payment_user_id=payment_user.id, # type: ignore
                status=PaymentStatusEnum.FAILED,
                current_user=InternalUser(),
                db_session=db_session
            )

async def handle_payment_succeeded(request: Request, payment_intent, org_id: int, db_session: Session):
    customer_id = payment_intent.customer
    
    customer = stripe.Customer.retrieve(customer_id)
    
    statement = select(User).where(User.email == customer.email)
    user = db_session.exec(statement).first()

    # Get product_id directly from metadata
    product_id = payment_intent.metadata.get('product_id')
    if not product_id:
        logger.error(f"No product_id found in payment_intent metadata: {payment_intent.id}")
        raise HTTPException(status_code=400, detail="No product_id found in payment metadata")
    
    if user:
        await create_payment_user(
            request=request,
            org_id=org_id,
            user_id=user.id, # type: ignore
            product_id=int(product_id),  # Convert string from metadata to int
            status=PaymentStatusEnum.COMPLETED,
            provider_data=customer,
            current_user=InternalUser(),
            db_session=db_session
        )

async def handle_payment_failed(request: Request, payment_intent, org_id: int, db_session: Session):
    # Update payment status to failed
    customer_id = payment_intent.customer
    
    customer = stripe.Customer.retrieve(customer_id)
    
    statement = select(User).where(User.email == customer.email)
    user = db_session.exec(statement).first()
    
    if user:
        statement = select(PaymentsUser).where(
            PaymentsUser.user_id == user.id,
            PaymentsUser.org_id == org_id,
            PaymentsUser.status == PaymentStatusEnum.PENDING
        )
        payment_user = db_session.exec(statement).first()
        
        if payment_user:
            await update_payment_user_status(
                request=request,
                org_id=org_id,
                payment_user_id=payment_user.id, # type: ignore
                status=PaymentStatusEnum.FAILED,
                current_user=InternalUser(),
                db_session=db_session
            )

# Create event handler mapping
STRIPE_EVENT_HANDLERS = {
    'checkout.session.completed': handle_checkout_session_completed,
    'customer.subscription.created': handle_subscription_created,
    'customer.subscription.updated': handle_subscription_updated,
    'customer.subscription.deleted': handle_subscription_deleted,
    'payment_intent.succeeded': handle_payment_succeeded,
    'payment_intent.payment_failed': handle_payment_failed,
}
