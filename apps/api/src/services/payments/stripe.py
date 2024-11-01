from fastapi import HTTPException, Request
from sqlmodel import Session
import stripe
from config.config import get_learnhouse_config
from src.db.payments.payments_products import PaymentPriceTypeEnum, PaymentProductTypeEnum, PaymentsProduct
from src.db.users import AnonymousUser, InternalUser, PublicUser
from src.services.payments.payments_config import get_payments_config
from sqlmodel import select

async def get_stripe_credentials(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | InternalUser,
    db_session: Session,
):
    configs = await get_payments_config(request, org_id, current_user, db_session)

    if len(configs) == 0:
        raise HTTPException(status_code=404, detail="Payments config not found")
    if len(configs) > 1:
        raise HTTPException(
            status_code=400, detail="Organization has multiple payments configs"
        )
    config = configs[0]
    if config.provider != "stripe":
        raise HTTPException(
            status_code=400, detail="Payments config is not a Stripe config"
        )

    # Get provider config
    credentials = config.provider_config

    return credentials

async def create_stripe_product(
    request: Request,
    org_id: int,
    product_data: PaymentsProduct,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    creds = await get_stripe_credentials(request, org_id, current_user, db_session)
    
    # Set the Stripe API key using the credentials
    stripe.api_key = creds.get('stripe_secret_key')
    
    # Prepare default_price_data based on price_type
    if product_data.price_type == PaymentPriceTypeEnum.CUSTOMER_CHOICE:
        default_price_data = {
            "currency": product_data.currency,
            "custom_unit_amount": {
                "enabled": True,
                "minimum": int(product_data.amount * 100),  # Convert to cents
            }
        }
    else:
        default_price_data = {
            "currency": product_data.currency,
            "unit_amount": int(product_data.amount * 100)  # Convert to cents
        }

    if product_data.product_type == PaymentProductTypeEnum.SUBSCRIPTION:
        default_price_data["recurring"] = {"interval": "month"}

    product = stripe.Product.create(
        name=product_data.name,
        description=product_data.description or "",
        marketing_features=[{"name": benefit.strip()} for benefit in product_data.benefits.split(",") if benefit.strip()],
        default_price_data=default_price_data # type: ignore
    )

    return product

async def archive_stripe_product(
    request: Request,
    org_id: int,
    product_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    creds = await get_stripe_credentials(request, org_id, current_user, db_session)
    
    # Set the Stripe API key using the credentials
    stripe.api_key = creds.get('stripe_secret_key')

    try:
        # Archive the product in Stripe
        archived_product = stripe.Product.modify(product_id, active=False)

        return archived_product
    except stripe.StripeError as e:
        print(f"Error archiving Stripe product: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Error archiving Stripe product: {str(e)}")

async def update_stripe_product(
    request: Request,
    org_id: int,
    product_id: str,
    product_data: PaymentsProduct,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    creds = await get_stripe_credentials(request, org_id, current_user, db_session)
    
    # Set the Stripe API key using the credentials
    stripe.api_key = creds.get('stripe_secret_key')
    
    try:
        # Create new price based on price_type
        if product_data.price_type == PaymentPriceTypeEnum.CUSTOMER_CHOICE:
            new_price_data = {
                "currency": product_data.currency,
                "product": product_id,
                "custom_unit_amount": {
                    "enabled": True,
                    "minimum": int(product_data.amount * 100),  # Convert to cents
                }
            }
        else:
            new_price_data = {
                "currency": product_data.currency,
                "unit_amount": int(product_data.amount * 100),  # Convert to cents
                "product": product_id,
            }

        if product_data.product_type == PaymentProductTypeEnum.SUBSCRIPTION:
            new_price_data["recurring"] = {"interval": "month"}

        new_price = stripe.Price.create(**new_price_data)

        # Prepare the update data
        update_data = {
            "name": product_data.name,
            "description": product_data.description or "",
            "metadata": {"benefits": product_data.benefits},
            "marketing_features": [{"name": benefit.strip()} for benefit in product_data.benefits.split(",") if benefit.strip()],
            "default_price": new_price.id
        }

        # Update the product in Stripe
        updated_product = stripe.Product.modify(product_id, **update_data)
        
        # Archive all existing prices for the product
        existing_prices = stripe.Price.list(product=product_id, active=True)
        for price in existing_prices:
            if price.id != new_price.id:
                stripe.Price.modify(price.id, active=False)

        return updated_product
    except stripe.StripeError as e:
        raise HTTPException(status_code=400, detail=f"Error updating Stripe product: {str(e)}")

async def create_checkout_session(
    request: Request,
    org_id: int,
    product_id: int,
    redirect_uri: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Get Stripe credentials
    creds = await get_stripe_credentials(request, org_id, current_user, db_session)
    stripe.api_key = creds.get('stripe_secret_key')

    # Get product details
    statement = select(PaymentsProduct).where(
        PaymentsProduct.id == product_id,
        PaymentsProduct.org_id == org_id
    )
    product = db_session.exec(statement).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    
    success_url = redirect_uri
    cancel_url = redirect_uri
    
    # Get the default price for the product
    stripe_product = stripe.Product.retrieve(product.provider_product_id)
    line_items = [{
            "price": stripe_product.default_price,
            "quantity": 1
        }]

    # Create or retrieve Stripe customer
    try:
        customers = stripe.Customer.list(email=current_user.email)
        if customers.data:
            customer = customers.data[0]
        else:
            customer = stripe.Customer.create(
                email=current_user.email,
                metadata={
                    "user_id": str(current_user.id),
                    "org_id": str(org_id)
                }
            )
    except stripe.StripeError as e:
        raise HTTPException(status_code=400, detail=f"Error creating/retrieving customer: {str(e)}")

    # Create checkout session with customer
    try:
        checkout_session_params = {
            "success_url": success_url,
            "cancel_url": cancel_url,
            "mode": 'payment' if product.product_type == PaymentProductTypeEnum.ONE_TIME else 'subscription',
            "line_items": line_items,
            "customer": customer.id,
            "metadata": {
                "product_id": str(product.id)
            }
        }

        # Add payment_intent_data only for one-time payments
        if product.product_type == PaymentProductTypeEnum.ONE_TIME:
            checkout_session_params["payment_intent_data"] = {
                "metadata": {
                    "product_id": str(product.id)
                }
            }
        # Add subscription_data for subscription payments
        else:
            checkout_session_params["subscription_data"] = {
                "metadata": {
                    "product_id": str(product.id)
                }
            }

        checkout_session = stripe.checkout.Session.create(**checkout_session_params)
        
        return {
            "checkout_url": checkout_session.url,
            "session_id": checkout_session.id
        }
        
    except stripe.StripeError as e:
        print(f"Error creating checkout session: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))





