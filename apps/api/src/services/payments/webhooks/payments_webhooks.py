from typing import Literal
from fastapi import HTTPException, Request
from sqlmodel import Session, select
import stripe
import logging
from src.db.payments.payments_users import PaymentStatusEnum
from src.db.users import InternalUser
from src.services.payments.payments_users import update_payment_user_status
from src.services.payments.payments_stripe import get_stripe_internal_credentials
from src.db.payments.payments import PaymentsConfig, PaymentsConfigUpdate
from src.services.payments.payments_config import update_payments_config
from src.services.payments.utils.stripe_utils import get_org_id_from_stripe_account

logger = logging.getLogger(__name__)


async def handle_stripe_webhook(
    request: Request,
    webhook_type: Literal["connect", "standard"],
    db_session: Session,
) -> dict:
    # Get Stripe credentials
    creds = await get_stripe_internal_credentials()
    webhook_secret = creds.get(f'stripe_webhook_{webhook_type}_secret')
    stripe.api_key = creds.get("stripe_secret_key")
    
    if not webhook_secret:
        logger.error("Stripe webhook secret not configured")
        raise HTTPException(status_code=400, detail="Stripe webhook secret not configured")

    # Get request data
    payload = await request.body()
    sig_header = request.headers.get('stripe-signature')

    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except ValueError:
        logger.error(ValueError)
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.SignatureVerificationError:
        logger.error(stripe.SignatureVerificationError)
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        event_type = event.type
        event_data = event.data.object

        # Get organization ID based on the event type
        stripe_account_id = event.account
        if not stripe_account_id:
            logger.error("Stripe account ID not found")
            raise HTTPException(status_code=400, detail="Stripe account ID not found")
        
        org_id = await get_org_id_from_stripe_account(stripe_account_id, db_session)

        # Handle internal account events
        if event_type == 'account.application.authorized':
            statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
            config = db_session.exec(statement).first()
            
            if not config:
                logger.error("No payments configuration found for this organization")
                raise HTTPException(
                    status_code=404,
                    detail="No payments configuration found for this organization"
                )

            config_data = config.model_dump()
            config_data.update({
                "enabled": True,
                "active": True,
                "provider_config": {
                    **config.provider_config,
                    "onboarding_completed": True
                }
            })
            await update_payments_config(
                request,
                org_id,
                PaymentsConfigUpdate(**config_data),
                InternalUser(),
                db_session,
            )

            logger.info(f"Account authorized for organization {org_id}")
            return {"status": "success", "message": "Account authorized successfully"}

        elif event_type == 'account.application.deauthorized':
            statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
            config = db_session.exec(statement).first()
            
            if not config:
                raise HTTPException(
                    status_code=404,
                    detail="No payments configuration found for this organization"
                )

            config_data = config.model_dump()
            config_data.update({
                "enabled": True,
                "active": False,
                "provider_config": {
                    **config.provider_config,
                    "onboarding_completed": False
                }
            })
            await update_payments_config(
                request,
                org_id,
                PaymentsConfigUpdate(**config_data),
                InternalUser(),
                db_session,
            )

            logger.info(f"Account deauthorized for organization {org_id}")
            return {"status": "success", "message": "Account deauthorized successfully"}

        # Handle payment-related events
        elif event_type == "checkout.session.completed":
            session = event_data
            payment_user_id = int(session.get("metadata", {}).get("payment_user_id"))

            if session.get("mode") == "subscription":
                if session.get("subscription"):
                    await update_payment_user_status(
                        request=request,
                        org_id=org_id,
                        payment_user_id=payment_user_id,
                        status=PaymentStatusEnum.ACTIVE,
                        current_user=InternalUser(),
                        db_session=db_session,
                    )
            else:
                if session.get("payment_status") == "paid":
                    await update_payment_user_status(
                        request=request,
                        org_id=org_id,
                        payment_user_id=payment_user_id,
                        status=PaymentStatusEnum.COMPLETED,
                        current_user=InternalUser(),
                        db_session=db_session,
                    )

        elif event_type == "customer.subscription.deleted":
            subscription = event_data
            payment_user_id = int(subscription.get("metadata", {}).get("payment_user_id"))

            await update_payment_user_status(
                request=request,
                org_id=org_id,
                payment_user_id=payment_user_id,
                status=PaymentStatusEnum.CANCELLED,
                current_user=InternalUser(),
                db_session=db_session,
            )

        elif event_type == "payment_intent.payment_failed":
            payment_intent = event_data
            payment_user_id = int(payment_intent.get("metadata", {}).get("payment_user_id"))

            await update_payment_user_status(
                request=request,
                org_id=org_id,
                payment_user_id=payment_user_id,
                status=PaymentStatusEnum.FAILED,
                current_user=InternalUser(),
                db_session=db_session,
            )

        else:
            logger.warning(f"Unhandled event type: {event_type}")
            return {"status": "ignored", "message": f"Unhandled event type: {event_type}"}

        return {"status": "success"}

    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Error processing webhook: {str(e)}") 