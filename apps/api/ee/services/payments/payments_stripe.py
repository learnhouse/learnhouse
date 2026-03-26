import logging
from typing import Any, Literal
from fastapi import HTTPException, Request
from sqlmodel import Session, select
import stripe

from config.config import get_learnhouse_config
from ee.db.payments.payments import PaymentsConfig, PaymentsConfigUpdate, PaymentsModeEnum
from ee.db.payments.payments_enrollments import EnrollmentStatusEnum
from ee.db.payments.payments_offers import OfferPriceTypeEnum, OfferTypeEnum, PaymentsOffer
from ee.services.payments.payments_config import get_payments_config, update_payments_config
from ee.services.payments.provider_interface import IPaymentProvider
from src.db.users import AnonymousUser, APITokenUser, InternalUser, PublicUser

logger = logging.getLogger(__name__)


# ===========================================================================
# StripePaymentProvider — implements IPaymentProvider
# All Stripe logic lives here.  The module-level shim functions below
# delegate to a singleton instance so existing imports keep working.
# ===========================================================================

class StripePaymentProvider(IPaymentProvider):
    """Stripe implementation of IPaymentProvider."""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_credentials(self) -> dict[str, Any]:
        learnhouse_config = get_learnhouse_config()
        stripe_cfg = learnhouse_config.payments_config.stripe

        if not stripe_cfg.stripe_secret_key:
            raise HTTPException(status_code=400, detail="Stripe secret key not configured")
        if not stripe_cfg.stripe_publishable_key:
            raise HTTPException(status_code=400, detail="Stripe publishable key not configured")

        return {
            "stripe_secret_key": stripe_cfg.stripe_secret_key,
            "stripe_publishable_key": stripe_cfg.stripe_publishable_key,
            "stripe_webhook_standard_secret": stripe_cfg.stripe_webhook_standard_secret,
            "stripe_webhook_connect_secret": stripe_cfg.stripe_webhook_connect_secret,
        }

    async def _get_connected_account_id(
        self,
        request: Request,
        org_id: int,
        current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
        db_session: Session,
    ) -> str:
        payments_config = await get_payments_config(request, org_id, current_user, db_session)
        return payments_config[0].provider_specific_id

    # ------------------------------------------------------------------
    # Product lifecycle
    # ------------------------------------------------------------------

    async def create_product(
        self,
        request: Request,
        org_id: int,
        offer: PaymentsOffer,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> Any:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]

        if offer.price_type == OfferPriceTypeEnum.CUSTOMER_CHOICE:
            default_price_data: dict[str, Any] = {
                "currency": offer.currency,
                "custom_unit_amount": {
                    "enabled": True,
                    "minimum": int(offer.amount * 100),
                },
            }
        else:
            default_price_data = {
                "currency": offer.currency,
                "unit_amount": int(offer.amount * 100),
            }

        if offer.offer_type == OfferTypeEnum.SUBSCRIPTION:
            default_price_data["recurring"] = {"interval": "month"}

        stripe_acc_id = await self._get_connected_account_id(request, org_id, current_user, db_session)

        product = stripe.Product.create(
            name=offer.name,
            description=offer.description or "",
            marketing_features=[
                {"name": b.strip()} for b in offer.benefits.split(",") if b.strip()
            ],
            default_price_data=default_price_data,  # type: ignore
            stripe_account=stripe_acc_id,
        )
        return product

    async def update_product(
        self,
        request: Request,
        org_id: int,
        product_id: str,
        offer: PaymentsOffer,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> Any:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]
        stripe_acc_id = await self._get_connected_account_id(request, org_id, current_user, db_session)

        try:
            if offer.price_type == OfferPriceTypeEnum.CUSTOMER_CHOICE:
                new_price_data: dict[str, Any] = {
                    "currency": offer.currency,
                    "product": product_id,
                    "custom_unit_amount": {
                        "enabled": True,
                        "minimum": int(offer.amount * 100),
                    },
                }
            else:
                new_price_data = {
                    "currency": offer.currency,
                    "unit_amount": int(offer.amount * 100),
                    "product": product_id,
                }

            if offer.offer_type == OfferTypeEnum.SUBSCRIPTION:
                new_price_data["recurring"] = {"interval": "month"}

            new_price = stripe.Price.create(**new_price_data)

            update_data = {
                "name": offer.name,
                "description": offer.description or "",
                "metadata": {"benefits": offer.benefits},
                "marketing_features": [
                    {"name": b.strip()} for b in offer.benefits.split(",") if b.strip()
                ],
                "default_price": new_price.id,
            }

            updated_product = stripe.Product.modify(
                product_id, **update_data, stripe_account=stripe_acc_id
            )

            existing_prices = stripe.Price.list(product=product_id, active=True)
            for price in existing_prices:
                if price.id != new_price.id:
                    stripe.Price.modify(price.id, active=False, stripe_account=stripe_acc_id)

            return updated_product
        except stripe.StripeError as e:
            raise HTTPException(status_code=400, detail=f"Error updating Stripe product: {str(e)}")

    async def archive_product(
        self,
        request: Request,
        org_id: int,
        product_id: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> Any:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]
        stripe_acc_id = await self._get_connected_account_id(request, org_id, current_user, db_session)

        try:
            return stripe.Product.modify(product_id, active=False, stripe_account=stripe_acc_id)
        except stripe.StripeError as e:
            raise HTTPException(status_code=400, detail=f"Error archiving Stripe product: {str(e)}")

    # ------------------------------------------------------------------
    # Checkout
    # ------------------------------------------------------------------

    async def create_checkout_session(
        self,
        request: Request,
        org_id: int,
        offer_id: int,
        redirect_uri: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        """Create a Stripe checkout session for a PaymentsOffer."""
        from ee.services.payments.payments_enrollments import create_enrollment, delete_enrollment

        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]
        stripe_acc_id = await self._get_connected_account_id(request, org_id, current_user, db_session)

        offer = db_session.exec(
            select(PaymentsOffer).where(
                PaymentsOffer.id == offer_id, PaymentsOffer.org_id == org_id
            )
        ).first()
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found")

        stripe_product = stripe.Product.retrieve(offer.provider_product_id, stripe_account=stripe_acc_id)
        line_items = [{"price": stripe_product.default_price, "quantity": 1}]

        enrollment = None
        try:
            customers = stripe.Customer.list(email=current_user.email, stripe_account=stripe_acc_id)
            if customers.data:
                customer = customers.data[0]
            else:
                customer = stripe.Customer.create(
                    email=current_user.email,
                    metadata={"user_id": str(current_user.id), "org_id": str(org_id)},
                    stripe_account=stripe_acc_id,
                )

            enrollment = await create_enrollment(
                request=request,
                org_id=org_id,
                offer_id=offer_id,
                user_id=current_user.id,
                status=EnrollmentStatusEnum.PENDING,
                provider_data={"stripe_customer": customer.id},
                current_user=InternalUser(),
                db_session=db_session,
            )
            if not enrollment:
                raise HTTPException(status_code=400, detail="Error creating enrollment")

        except stripe.StripeError as e:
            if enrollment and enrollment.id:
                await delete_enrollment(request, org_id, enrollment.id, InternalUser(), db_session)
            raise HTTPException(status_code=400, detail=f"Error creating/retrieving customer: {str(e)}")

        is_subscription = offer.offer_type == OfferTypeEnum.SUBSCRIPTION

        # Fetch config to determine mode (Express vs Standard)
        payment_config = db_session.exec(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        ).first()
        is_express = payment_config and payment_config.mode == PaymentsModeEnum.express

        try:
            checkout_params: dict[str, Any] = {
                "success_url": redirect_uri,
                "cancel_url": redirect_uri,
                "mode": "subscription" if is_subscription else "payment",
                "line_items": line_items,
                "customer": customer.id,
                "metadata": {
                    "offer_id": str(offer.id),
                    "enrollment_id": str(enrollment.id),
                },
            }

            if is_subscription:
                sub_data: dict[str, Any] = {
                    "metadata": {
                        "offer_id": str(offer.id),
                        "enrollment_id": str(enrollment.id),
                    }
                }
                if is_express:
                    sub_data["application_fee_percent"] = 5.0
                checkout_params["subscription_data"] = sub_data
            else:
                intent_data: dict[str, Any] = {
                    "metadata": {
                        "offer_id": str(offer.id),
                        "enrollment_id": str(enrollment.id),
                    }
                }
                if is_express:
                    intent_data["application_fee_amount"] = int(offer.amount * 100 * 0.05)
                checkout_params["payment_intent_data"] = intent_data

            session = stripe.checkout.Session.create(**checkout_params, stripe_account=stripe_acc_id)
            return {"checkout_url": session.url, "session_id": session.id}

        except stripe.StripeError as e:
            if enrollment and enrollment.id:
                await delete_enrollment(request, org_id, enrollment.id, InternalUser(), db_session)
            logger.error(f"Error creating offer checkout session: {str(e)}")
            raise HTTPException(status_code=400, detail=str(e))

    # ------------------------------------------------------------------
    # Billing portal
    # ------------------------------------------------------------------

    async def create_billing_portal_session(
        self,
        request: Request,
        org_id: int,
        return_url: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]
        stripe_acc_id = await self._get_connected_account_id(request, org_id, current_user, db_session)

        customers = stripe.Customer.list(email=current_user.email, stripe_account=stripe_acc_id)
        if not customers.data:
            raise HTTPException(
                status_code=404,
                detail="No Stripe customer found for this account. Complete a purchase first.",
            )

        session = stripe.billing_portal.Session.create(
            customer=customers.data[0].id,
            return_url=return_url,
            stripe_account=stripe_acc_id,
        )
        return {"portal_url": session.url}

    # ------------------------------------------------------------------
    # Webhooks
    # ------------------------------------------------------------------

    async def handle_webhook(
        self,
        request: Request,
        webhook_type: str,
        db_session: Session,
    ) -> dict[str, Any]:
        from ee.services.payments.utils.stripe_utils import get_org_id_from_stripe_account

        creds = await self._get_credentials()
        webhook_secret = creds.get(f"stripe_webhook_{webhook_type}_secret")
        stripe.api_key = creds["stripe_secret_key"]

        if not webhook_secret:
            logger.error("Stripe webhook secret not configured")
            raise HTTPException(status_code=400, detail="Stripe webhook secret not configured")

        payload = await request.body()
        sig_header = request.headers.get("stripe-signature")

        try:
            event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid payload")
        except stripe.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid signature")

        try:
            event_type = event.type
            event_data = event.data.object

            stripe_account_id = getattr(event, "account", None)
            if not stripe_account_id:
                # Platform-level event (no connected account) — nothing to process
                logger.info(f"Ignoring platform-level Stripe event: {event_type}")
                return {"status": "ignored", "message": f"Platform event: {event_type}"}

            org_id = await get_org_id_from_stripe_account(stripe_account_id, db_session)

            if event_type == "account.application.authorized":
                config = db_session.exec(
                    select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
                ).first()
                if not config:
                    raise HTTPException(status_code=404, detail="No payments configuration found")

                config_data = config.model_dump()
                config_data.update({
                    "enabled": True,
                    "active": True,
                    "provider_config": {**config.provider_config, "onboarding_completed": True},
                })
                await update_payments_config(
                    request, org_id, PaymentsConfigUpdate(**config_data), InternalUser(), db_session
                )
                logger.info(f"Account authorized for organization {org_id}")
                return {"status": "success", "message": "Account authorized successfully"}

            elif event_type == "account.application.deauthorized":
                config = db_session.exec(
                    select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
                ).first()
                if not config:
                    raise HTTPException(status_code=404, detail="No payments configuration found")

                config_data = config.model_dump()
                config_data.update({
                    "enabled": True,
                    "active": False,
                    "provider_config": {**config.provider_config, "onboarding_completed": False},
                })
                await update_payments_config(
                    request, org_id, PaymentsConfigUpdate(**config_data), InternalUser(), db_session
                )
                logger.info(f"Account deauthorized for organization {org_id}")
                return {"status": "success", "message": "Account deauthorized successfully"}

            elif event_type == "account.updated":
                # Express accounts: mark active when both charges and payouts are enabled
                account_obj = event_data
                if account_obj.get("charges_enabled") and account_obj.get("payouts_enabled"):
                    config = db_session.exec(
                        select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
                    ).first()
                    if config and config.mode == PaymentsModeEnum.express:
                        config_data = config.model_dump()
                        config_data.update({
                            "enabled": True,
                            "active": True,
                            "provider_config": {**config.provider_config, "onboarding_completed": True},
                        })
                        await update_payments_config(
                            request, org_id, PaymentsConfigUpdate(**config_data), InternalUser(), db_session
                        )
                        logger.info(f"Express account onboarding completed for organization {org_id}")
                return {"status": "success", "message": "account.updated processed"}

            elif event_type == "checkout.session.completed":
                session = event_data
                metadata = session.get("metadata", {})
                enrollment_id_str = metadata.get("enrollment_id")

                if enrollment_id_str:
                    from ee.services.payments.payments_enrollments import update_enrollment_status
                    enrollment_id = int(enrollment_id_str)
                    if session.get("mode") == "subscription":
                        if session.get("subscription"):
                            await update_enrollment_status(
                                request=request, org_id=org_id,
                                enrollment_id=enrollment_id,
                                status=EnrollmentStatusEnum.ACTIVE,
                                current_user=InternalUser(), db_session=db_session,
                            )
                    else:
                        if session.get("payment_status") == "paid":
                            await update_enrollment_status(
                                request=request, org_id=org_id,
                                enrollment_id=enrollment_id,
                                status=EnrollmentStatusEnum.COMPLETED,
                                current_user=InternalUser(), db_session=db_session,
                            )

            elif event_type == "customer.subscription.deleted":
                metadata = event_data.get("metadata", {})
                enrollment_id_str = metadata.get("enrollment_id")
                if enrollment_id_str:
                    from ee.services.payments.payments_enrollments import update_enrollment_status
                    await update_enrollment_status(
                        request=request, org_id=org_id,
                        enrollment_id=int(enrollment_id_str),
                        status=EnrollmentStatusEnum.CANCELLED,
                        current_user=InternalUser(), db_session=db_session,
                    )

            elif event_type == "payment_intent.payment_failed":
                metadata = event_data.get("metadata", {})
                enrollment_id_str = metadata.get("enrollment_id")
                if enrollment_id_str:
                    from ee.services.payments.payments_enrollments import update_enrollment_status
                    await update_enrollment_status(
                        request=request, org_id=org_id,
                        enrollment_id=int(enrollment_id_str),
                        status=EnrollmentStatusEnum.FAILED,
                        current_user=InternalUser(), db_session=db_session,
                    )

            else:
                logger.warning(f"Unhandled Stripe event type: {event_type}")
                return {"status": "ignored", "message": f"Unhandled event type: {event_type}"}

            return {"status": "success"}

        except Exception as e:
            logger.error(f"Error processing Stripe webhook: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Error processing webhook: {str(e)}")

    # ------------------------------------------------------------------
    # Stripe Connect — not in IPaymentProvider (Stripe-specific OAuth flow)
    # The router imports these directly from this class or via shims below.
    # ------------------------------------------------------------------

    async def generate_connect_link(
        self,
        request: Request,
        org_id: int,
        redirect_uri: str,
        current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]

        learnhouse_config = get_learnhouse_config()
        client_id = learnhouse_config.payments_config.stripe.stripe_client_id
        if not client_id:
            raise HTTPException(status_code=400, detail="Stripe client ID not configured")

        state = f"org_id={org_id}"
        oauth_link = (
            f"https://connect.stripe.com/oauth/authorize"
            f"?response_type=code&client_id={client_id}&scope=read_write"
            f"&redirect_uri={redirect_uri}&state={state}"
        )
        return {"connect_url": oauth_link}

    async def create_connected_account(
        self,
        request: Request,
        org_id: int,
        account_type: Literal["standard"],
        current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
        db_session: Session,
    ) -> Any:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]

        existing_config = db_session.exec(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        ).first()

        if existing_config and existing_config.provider_specific_id:
            logger.error(f"A Stripe account is already linked: {existing_config.provider_specific_id}")
            return existing_config.provider_specific_id

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
            "provider_specific_id": stripe_account.id,
            "provider_config": {"onboarding_completed": False},
        })

        await update_payments_config(
            request, org_id, PaymentsConfigUpdate(**config_data), current_user, db_session
        )
        return stripe_account

    async def update_connected_account_id(
        self,
        request: Request,
        org_id: int,
        stripe_account_id: str,
        current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        existing_config = db_session.exec(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        ).first()
        if not existing_config:
            raise HTTPException(status_code=404, detail="No payments configuration found for this organization")

        config_data = existing_config.model_dump()
        config_data["provider_specific_id"] = stripe_account_id
        config_data["active"] = True

        await update_payments_config(
            request, org_id, PaymentsConfigUpdate(**config_data), current_user, db_session
        )
        return {"message": "Stripe account ID updated successfully"}

    async def handle_oauth_callback(
        self,
        request: Request,
        org_id: int,
        code: str,
        current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, Any]:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]

        try:
            response = stripe.OAuth.token(grant_type="authorization_code", code=code)
            connected_account_id = response.stripe_user_id
            if not connected_account_id:
                raise HTTPException(status_code=400, detail="No account ID received from Stripe")

            await self.update_connected_account_id(
                request, org_id, connected_account_id, current_user, db_session
            )
            return {"success": True, "account_id": connected_account_id}

        except stripe.StripeError as e:
            logger.error(f"Error connecting Stripe account: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Error connecting Stripe account: {str(e)}")

    # ------------------------------------------------------------------
    # Express Connect — create/onboard a Stripe Express account
    # ------------------------------------------------------------------

    async def create_express_account_and_link(
        self,
        request: Request,
        org_id: int,
        redirect_uri: str,
        current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]

        existing_config = db_session.exec(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        ).first()
        if not existing_config:
            raise HTTPException(status_code=404, detail="No payments configuration found for this organization")

        # Reuse existing Express account if already created
        acct_id = existing_config.provider_specific_id
        if not acct_id:
            acct = stripe.Account.create(
                type="express",
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
            )
            acct_id = acct.id

            config_data = existing_config.model_dump()
            config_data.update({
                "enabled": True,
                "active": False,
                "mode": PaymentsModeEnum.express,
                "provider_specific_id": acct_id,
                "provider_config": {**existing_config.provider_config, "onboarding_completed": False},
            })
            await update_payments_config(
                request, org_id, PaymentsConfigUpdate(**config_data), current_user, db_session
            )

        link = stripe.AccountLink.create(
            account=acct_id,
            refresh_url=redirect_uri,
            return_url=redirect_uri,
            type="account_onboarding",
        )
        return {"onboarding_url": link.url}

    async def refresh_express_onboarding_link(
        self,
        org_id: int,
        redirect_uri: str,
        db_session: Session,
    ) -> dict[str, str]:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]

        config = db_session.exec(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        ).first()
        if not config or not config.provider_specific_id:
            raise HTTPException(status_code=404, detail="No Express account found for this organization")

        link = stripe.AccountLink.create(
            account=config.provider_specific_id,
            refresh_url=redirect_uri,
            return_url=redirect_uri,
            type="account_onboarding",
        )
        return {"onboarding_url": link.url}

    async def get_express_dashboard_link(
        self,
        org_id: int,
        db_session: Session,
    ) -> dict[str, str]:
        creds = await self._get_credentials()
        stripe.api_key = creds["stripe_secret_key"]

        config = db_session.exec(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        ).first()
        if not config or not config.provider_specific_id:
            raise HTTPException(status_code=404, detail="No Express account found for this organization")

        login_link = stripe.Account.create_login_link(config.provider_specific_id)
        return {"url": login_link.url}


# ===========================================================================
# Module-level shims — backward-compatible wrappers so that existing imports
# from this module continue to work without any changes in callers.
# ===========================================================================

_stripe = StripePaymentProvider()


async def get_stripe_internal_credentials() -> dict[str, Any]:
    return await _stripe._get_credentials()


async def get_stripe_connected_account_id(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> str:
    return await _stripe._get_connected_account_id(request, org_id, current_user, db_session)


async def generate_stripe_connect_link(
    request: Request,
    org_id: int,
    redirect_uri: str,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> dict[str, str]:
    return await _stripe.generate_connect_link(request, org_id, redirect_uri, current_user, db_session)


async def create_stripe_account(
    request: Request,
    org_id: int,
    type: Literal["standard"],
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> Any:
    return await _stripe.create_connected_account(request, org_id, type, current_user, db_session)


async def update_stripe_account_id(
    request: Request,
    org_id: int,
    stripe_account_id: str,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> dict[str, str]:
    return await _stripe.update_connected_account_id(request, org_id, stripe_account_id, current_user, db_session)


async def handle_stripe_oauth_callback(
    request: Request,
    org_id: int,
    code: str,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> dict[str, Any]:
    return await _stripe.handle_oauth_callback(request, org_id, code, current_user, db_session)


async def create_stripe_product(
    request: Request,
    org_id: int,
    product_data: PaymentsOffer,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> Any:
    return await _stripe.create_product(request, org_id, product_data, current_user, db_session)


async def archive_stripe_product(
    request: Request,
    org_id: int,
    product_id: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> Any:
    return await _stripe.archive_product(request, org_id, product_id, current_user, db_session)


async def update_stripe_product(
    request: Request,
    org_id: int,
    product_id: str,
    product_data: PaymentsOffer,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> Any:
    return await _stripe.update_product(request, org_id, product_id, product_data, current_user, db_session)


async def create_offer_checkout_session(
    request: Request,
    org_id: int,
    offer_id: int,
    redirect_uri: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> dict[str, str]:
    return await _stripe.create_checkout_session(request, org_id, offer_id, redirect_uri, current_user, db_session)


async def create_stripe_express_account_and_link(
    request: Request,
    org_id: int,
    redirect_uri: str,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    db_session: Session,
) -> dict[str, str]:
    return await _stripe.create_express_account_and_link(request, org_id, redirect_uri, current_user, db_session)


async def refresh_stripe_express_onboarding_link(
    org_id: int,
    redirect_uri: str,
    db_session: Session,
) -> dict[str, str]:
    return await _stripe.refresh_express_onboarding_link(org_id, redirect_uri, db_session)


async def get_stripe_express_dashboard_link(
    org_id: int,
    db_session: Session,
) -> dict[str, str]:
    return await _stripe.get_express_dashboard_link(org_id, db_session)
