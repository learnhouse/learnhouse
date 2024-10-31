from fastapi import HTTPException, Request
from sqlmodel import Session
import stripe
from src.db.payments.payments_products import PaymentPriceTypeEnum, PaymentProductTypeEnum, PaymentsProduct
from src.db.users import AnonymousUser, PublicUser
from src.services.payments.payments_config import get_payments_config


async def get_stripe_credentials(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
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





