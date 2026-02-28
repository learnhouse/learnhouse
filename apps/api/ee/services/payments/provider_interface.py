"""
Abstract payment provider interface.

Every payment provider must implement this class. The only files that should
import a concrete provider (e.g. StripePaymentProvider) are:
  - provider_registry.py  (factory)
  - payments_stripe.py    (implementation)
  - provider-specific router helpers (OAuth connect, etc.)

All other call-sites (offers service, webhooks, router billing portal) use
get_provider() from provider_registry.py and this interface only.

To add a new provider:
  1. Uncomment (or add) its value in PaymentProviderEnum in ee/db/payments/payments.py
  2. Create ee/services/payments/payments_<name>.py implementing IPaymentProvider
  3. Add a branch in provider_registry.get_provider()
  — no other files need to change.
"""
from abc import ABC, abstractmethod
from typing import Any

from fastapi import Request
from sqlmodel import Session

from src.db.users import AnonymousUser, APITokenUser, PublicUser


class IPaymentProvider(ABC):
    """
    Core operations every payment provider must support.

    Method shapes follow the existing Stripe implementations exactly so
    that StripePaymentProvider is a zero-behaviour-change refactor.
    """

    # ------------------------------------------------------------------
    # Product / offer lifecycle
    # These mirror the Stripe Product object. Other providers use whatever
    # internal concept they have (Lemon Squeezy "variant", Paddle "price", …)
    # ------------------------------------------------------------------

    @abstractmethod
    async def create_product(
        self,
        request: Request,
        org_id: int,
        offer: Any,                  # PaymentsOffer — typed Any to avoid circular import
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> Any:
        """
        Create the product/price object on the provider side.
        Must return an object with a string `.id` attribute that will be stored
        as PaymentsOffer.provider_product_id.
        """
        ...

    @abstractmethod
    async def update_product(
        self,
        request: Request,
        org_id: int,
        product_id: str,
        offer: Any,                  # PaymentsOffer
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> Any:
        """Update name, description, price, etc. on the provider."""
        ...

    @abstractmethod
    async def archive_product(
        self,
        request: Request,
        org_id: int,
        product_id: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> Any:
        """Deactivate / archive the product on the provider (called on offer delete)."""
        ...

    # ------------------------------------------------------------------
    # Checkout
    # ------------------------------------------------------------------

    @abstractmethod
    async def create_checkout_session(
        self,
        request: Request,
        org_id: int,
        offer_id: int,
        redirect_uri: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        """
        Create a hosted checkout session.
        Must return {"checkout_url": "...", "session_id": "..."}.
        """
        ...

    # ------------------------------------------------------------------
    # Customer / billing portal
    # ------------------------------------------------------------------

    @abstractmethod
    async def create_billing_portal_session(
        self,
        request: Request,
        org_id: int,
        return_url: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        """
        Create a self-service billing portal session.
        Must return {"portal_url": "..."}.
        Providers that don't support a managed portal should raise HTTP 501.
        """
        ...

    # ------------------------------------------------------------------
    # Webhooks
    # ------------------------------------------------------------------

    @abstractmethod
    async def handle_webhook(
        self,
        request: Request,
        webhook_type: str,          # provider-specific discriminator ("connect" / "standard" for Stripe)
        db_session: Session,
    ) -> dict[str, Any]:
        """
        Verify the webhook signature, parse the event, and drive enrollment
        status changes via update_enrollment_status().
        Must return {"status": "success"} or {"status": "ignored"}.
        """
        ...
