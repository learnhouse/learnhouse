"""
Webhook dispatcher.

Routes incoming webhook requests to the correct provider implementation.
Each provider's IPaymentProvider.handle_webhook() does signature verification,
event parsing, and enrollment status updates.

The module-level handle_stripe_webhook() function is kept as-is so existing
router imports require zero changes.
"""
from typing import Literal

from fastapi import Request
from sqlmodel import Session

from ee.db.payments.payments import PaymentProviderEnum
from ee.services.payments.provider_registry import get_provider


async def handle_stripe_webhook(
    request: Request,
    webhook_type: Literal["connect", "standard"],
    db_session: Session,
) -> dict:
    """
    Backward-compatible entrypoint used by the router.
    Delegates entirely to StripePaymentProvider.handle_webhook().
    """
    provider = get_provider(PaymentProviderEnum.STRIPE)
    return await provider.handle_webhook(request, webhook_type, db_session)
