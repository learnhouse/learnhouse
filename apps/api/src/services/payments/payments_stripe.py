import logging
from typing import Literal
from fastapi import HTTPException, Request
from sqlmodel import Session
import stripe
from config.config import  get_learnhouse_config
from src.db.payments.payments import PaymentsConfigUpdate, PaymentsConfig
from src.db.payments.payments_products import (
    PaymentPriceTypeEnum,
    PaymentProductTypeEnum,
    PaymentsProduct,
)
from src.db.payments.payments_users import PaymentStatusEnum
from src.db.users import AnonymousUser, InternalUser, PublicUser
from src.services.payments.payments_config import (
    get_payments_config,
    update_payments_config,
)
from sqlmodel import select

from src.services.payments.payments_users import (
    create_payment_user,
    delete_payment_user,
)


async def get_stripe_connected_account_id(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | InternalUser,
    db_session: Session,
):
    # Get payments config
    payments_config = await get_payments_config(request, org_id, current_user, db_session)

    return payments_config[0].provider_specific_id


async def get_stripe_internal_credentials(
):
    # Get payments config from config file
    learnhouse_config = get_learnhouse_config()

    if not learnhouse_config.payments_config.stripe.stripe_secret_key:
        raise HTTPException(status_code=400, detail="Stripe secret key not configured")

    if not learnhouse_config.payments_config.stripe.stripe_publishable_key:
        raise HTTPException(
            status_code=400, detail="Stripe publishable key not configured"
        )

    return {
        "stripe_secret_key": learnhouse_config.payments_config.stripe.stripe_secret_key,
        "stripe_publishable_key": learnhouse_config.payments_config.stripe.stripe_publishable_key,
        "stripe_webhook_standard_secret": learnhouse_config.payments_config.stripe.stripe_webhook_standard_secret,
        "stripe_webhook_connect_secret": learnhouse_config.payments_config.stripe.stripe_webhook_connect_secret,
    }


async def create_stripe_product(
    request: Request,
    org_id: int,
    product_data: PaymentsProduct,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    creds = await get_stripe_internal_credentials()

    # Set the Stripe API key using the credentials
    stripe.api_key = creds.get("stripe_secret_key")

    # Prepare default_price_data based on price_type
    if product_data.price_type == PaymentPriceTypeEnum.CUSTOMER_CHOICE:
        default_price_data = {
            "currency": product_data.currency,
            "custom_unit_amount": {
                "enabled": True,
                "minimum": int(product_data.amount * 100),  # Convert to cents
            },
        }
    else:
        default_price_data = {
            "currency": product_data.currency,
            "unit_amount": int(product_data.amount * 100),  # Convert to cents
        }

    if product_data.product_type == PaymentProductTypeEnum.SUBSCRIPTION:
        default_price_data["recurring"] = {"interval": "month"}

    stripe_acc_id = await get_stripe_connected_account_id(request, org_id, current_user, db_session)

    product = stripe.Product.create(
        name=product_data.name,
        description=product_data.description or "",
        marketing_features=[
            {"name": benefit.strip()}
            for benefit in product_data.benefits.split(",")
            if benefit.strip()
        ],
        default_price_data=default_price_data,  # type: ignore
        stripe_account=stripe_acc_id,
    )

    return product


async def archive_stripe_product(
    request: Request,
    org_id: int,
    product_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    creds = await get_stripe_internal_credentials()

    # Set the Stripe API key using the credentials
    stripe.api_key = creds.get("stripe_secret_key")

    stripe_acc_id = await get_stripe_connected_account_id(request, org_id, current_user, db_session)

    try:
        # Archive the product in Stripe
        archived_product = stripe.Product.modify(product_id, active=False, stripe_account=stripe_acc_id)

        return archived_product
    except stripe.StripeError as e:
        print(f"Error archiving Stripe product: {str(e)}")
        raise HTTPException(
            status_code=400, detail=f"Error archiving Stripe product: {str(e)}"
        )


async def update_stripe_product(
    request: Request,
    org_id: int,
    product_id: str,
    product_data: PaymentsProduct,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    creds = await get_stripe_internal_credentials()

    # Set the Stripe API key using the credentials
    stripe.api_key = creds.get("stripe_secret_key")

    stripe_acc_id = await get_stripe_connected_account_id(request, org_id, current_user, db_session)

    try:
        # Create new price based on price_type
        if product_data.price_type == PaymentPriceTypeEnum.CUSTOMER_CHOICE:
            new_price_data = {
                "currency": product_data.currency,
                "product": product_id,
                "custom_unit_amount": {
                    "enabled": True,
                    "minimum": int(product_data.amount * 100),  # Convert to cents
                },
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
            "marketing_features": [
                {"name": benefit.strip()}
                for benefit in product_data.benefits.split(",")
                if benefit.strip()
            ],
            "default_price": new_price.id,
        }

        # Update the product in Stripe
        updated_product = stripe.Product.modify(product_id, **update_data, stripe_account=stripe_acc_id)

        # Archive all existing prices for the product
        existing_prices = stripe.Price.list(product=product_id, active=True)
        for price in existing_prices:
            if price.id != new_price.id:
                stripe.Price.modify(price.id, active=False, stripe_account=stripe_acc_id)

        return updated_product
    except stripe.StripeError as e:
        raise HTTPException(
            status_code=400, detail=f"Error updating Stripe product: {str(e)}"
        )


async def create_checkout_session(
    request: Request,
    org_id: int,
    product_id: int,
    redirect_uri: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Get Stripe credentials
    creds = await get_stripe_internal_credentials()
    stripe.api_key = creds.get("stripe_secret_key")


    stripe_acc_id = await get_stripe_connected_account_id(request, org_id, current_user, db_session)

    # Get product details
    statement = select(PaymentsProduct).where(
        PaymentsProduct.id == product_id, PaymentsProduct.org_id == org_id
    )
    product = db_session.exec(statement).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    success_url = redirect_uri
    cancel_url = redirect_uri

    # Get the default price for the product
    stripe_product = stripe.Product.retrieve(product.provider_product_id, stripe_account=stripe_acc_id)
    line_items = [{"price": stripe_product.default_price, "quantity": 1}]


    # Create or retrieve Stripe customer
    try:
        customers = stripe.Customer.list(
            email=current_user.email, stripe_account=stripe_acc_id
        )
        if customers.data:
            customer = customers.data[0]
        else:
            customer = stripe.Customer.create(
                email=current_user.email,
                metadata={
                    "user_id": str(current_user.id),
                    "org_id": str(org_id),
                },
                stripe_account=stripe_acc_id,
            )

        # Create initial payment user with pending status
        payment_user = await create_payment_user(
            request=request,
            org_id=org_id,
            user_id=current_user.id,
            product_id=product_id,
            status=PaymentStatusEnum.PENDING,
            provider_data=customer,
            current_user=InternalUser(),
            db_session=db_session,
        )

        if not payment_user:
            raise HTTPException(status_code=400, detail="Error creating payment user")

    except stripe.StripeError as e:
        # Clean up payment user if customer creation fails
        if payment_user and payment_user.id:
            await delete_payment_user(
                request, org_id, payment_user.id, InternalUser(), db_session
            )
        raise HTTPException(
            status_code=400, detail=f"Error creating/retrieving customer: {str(e)}"
        )

    # Create checkout session with customer
    try:
        checkout_session_params = {
            "success_url": success_url,
            "cancel_url": cancel_url,
            "mode": (
                "payment"
                if product.product_type == PaymentProductTypeEnum.ONE_TIME
                else "subscription"
            ),
            "line_items": line_items,
            "customer": customer.id,
            "metadata": {
                "product_id": str(product.id),
                "payment_user_id": str(payment_user.id),
            }
        }

        # Add payment_intent_data only for one-time payments
        if product.product_type == PaymentProductTypeEnum.ONE_TIME:
            checkout_session_params["payment_intent_data"] = {
                "metadata": {
                    "product_id": str(product.id),
                    "payment_user_id": str(payment_user.id),
                }
            }
        # Add subscription_data for subscription payments
        else:
            checkout_session_params["subscription_data"] = {
                "metadata": {
                    "product_id": str(product.id),
                    "payment_user_id": str(payment_user.id),
                }
            }

        checkout_session = stripe.checkout.Session.create(**checkout_session_params, stripe_account=stripe_acc_id)

        return {"checkout_url": checkout_session.url, "session_id": checkout_session.id}

    except stripe.StripeError as e:
        # Clean up payment user if checkout session creation fails
        if payment_user and payment_user.id:
            await delete_payment_user(
                request, org_id, payment_user.id, InternalUser(), db_session
            )
        logging.error(f"Error creating checkout session: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


async def generate_stripe_connect_link(
    request: Request,
    org_id: int,
    redirect_uri: str,
    current_user: PublicUser | AnonymousUser | InternalUser,
    db_session: Session,
):
    """
    Generate a Stripe OAuth link for connecting a Stripe account
    """
    # Get credentials
    creds = await get_stripe_internal_credentials()
    stripe.api_key = creds.get("stripe_secret_key")
    
    # Get learnhouse config for client_id
    learnhouse_config = get_learnhouse_config()
    client_id = learnhouse_config.payments_config.stripe.stripe_client_id
    
    if not client_id:
        raise HTTPException(status_code=400, detail="Stripe client ID not configured")

    state = f"org_id={org_id}"
    
    # Generate OAuth link for existing accounts
    oauth_link = f"https://connect.stripe.com/oauth/authorize?response_type=code&client_id={client_id}&scope=read_write&redirect_uri={redirect_uri}&state={state}"

    return {"connect_url": oauth_link}

async def create_stripe_account(
    request: Request,
    org_id: int,
    type: Literal["standard"], # Only standard is supported for now, we'll see if we need express later
    current_user: PublicUser | AnonymousUser | InternalUser,
    db_session: Session,
):
    # Get credentials
    creds = await get_stripe_internal_credentials()
    stripe.api_key = creds.get("stripe_secret_key")

    # Get existing payments config
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    existing_config = db_session.exec(statement).first()

    if existing_config and existing_config.provider_specific_id:
        logging.error(f"A Stripe Account is already linked to this organization: {existing_config.provider_specific_id}")
        return existing_config.provider_specific_id

    # Create Stripe account
    stripe_account = stripe.Account.create(
        type="standard",
        capabilities={
            "card_payments": {"requested": True},
            "transfers": {"requested": True},
        },
    )

    config_data = existing_config.model_dump() if existing_config else {}
    config_data.update({
            "enabled": True,
            "provider_specific_id": stripe_account.id,  # Use the ID directly
        "provider_config": {"onboarding_completed": False}
    })

    # Update payments config for the org
    await update_payments_config(
        request,
        org_id,
        PaymentsConfigUpdate(**config_data),
        current_user,
        db_session,
    )

    return stripe_account


async def update_stripe_account_id(
    request: Request,
    org_id: int,
    stripe_account_id: str,
    current_user: PublicUser | AnonymousUser | InternalUser,
    db_session: Session,
):
    """
    Update the Stripe account ID for an organization
    """
    # Get existing payments config
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    existing_config = db_session.exec(statement).first()

    if not existing_config:
        raise HTTPException(
            status_code=404,
            detail="No payments configuration found for this organization"
        )

    # Create config update with existing values but new stripe account id
    config_data = existing_config.model_dump()
    config_data["provider_specific_id"] = stripe_account_id

    # Update payments config
    await update_payments_config(
        request,
        org_id,
        PaymentsConfigUpdate(**config_data),
        current_user,
        db_session,
    )

    return {"message": "Stripe account ID updated successfully"}

async def handle_stripe_oauth_callback(
    request: Request,
    org_id: int,
    code: str,
    current_user: PublicUser | AnonymousUser | InternalUser,
    db_session: Session,
):
    """
    Handle the OAuth callback from Stripe and complete the account connection
    """
    creds = await get_stripe_internal_credentials()
    stripe.api_key = creds.get("stripe_secret_key")

    try:
        # Exchange the authorization code for an access token
        response = stripe.OAuth.token(
            grant_type='authorization_code',
            code=code,
        )
        
        connected_account_id = response.stripe_user_id
        if not connected_account_id:
            raise HTTPException(status_code=400, detail="No account ID received from Stripe")

        # Now connected_account_id is guaranteed to be a string
        await update_stripe_account_id(
            request,
            org_id,
            connected_account_id,
            current_user,
            db_session,
        )

        return {"success": True, "account_id": connected_account_id}

    except stripe.StripeError as e:
        logging.error(f"Error connecting Stripe account: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Error connecting Stripe account: {str(e)}"
        )
