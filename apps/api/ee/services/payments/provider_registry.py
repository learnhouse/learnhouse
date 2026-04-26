"""
Payment provider registry / factory.

Usage:
    from ee.services.payments.provider_registry import get_provider
    provider = get_provider(config.provider)
    result = await provider.create_checkout_session(...)

To register a new provider:
  1. Add its value to PaymentProviderEnum in ee/db/payments/payments.py
  2. Create ee/services/payments/payments_<name>.py implementing IPaymentProvider
  3. Add a branch in get_provider() below
"""
from functools import lru_cache

from ee.db.payments.payments import PaymentProviderEnum
from ee.services.payments.provider_interface import IPaymentProvider


@lru_cache(maxsize=None)
def _stripe_provider() -> IPaymentProvider:
    from ee.services.payments.payments_stripe import StripePaymentProvider
    return StripePaymentProvider()


@lru_cache(maxsize=None)
def _moyasar_provider() -> IPaymentProvider:
    from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
    return MoyasarPaymentProvider()


def get_provider(provider: PaymentProviderEnum) -> IPaymentProvider:
    """Return a cached, stateless provider instance for the given enum value."""
    if provider == PaymentProviderEnum.STRIPE:
        return _stripe_provider()
    if provider == PaymentProviderEnum.MOYASAR:
        return _moyasar_provider()
    # elif provider == PaymentProviderEnum.LEMON_SQUEEZY:
    #     return _lemon_squeezy_provider()
    # elif provider == PaymentProviderEnum.PADDLE:
    #     return _paddle_provider()
    raise ValueError(f"Unsupported payment provider: {provider!r}")
