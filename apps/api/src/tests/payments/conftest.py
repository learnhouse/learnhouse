"""
Fixtures for Moyasar payment tests. Reuses the session + user + org fixtures
from src/tests/conftest.py; adds a ready-to-use PaymentsConfig and Offer.
"""
import pytest

from ee.db.payments.payments import (
    PaymentProviderEnum,
    PaymentsConfig,
    PaymentsModeEnum,
)


# ---------------------------------------------------------------------------
# Fixture aliases — the root conftest exposes `db` and `org`; the Moyasar
# fixtures below are written against the plan's `db_session` / `organization`
# names. Thin aliases keep the plan's wording while reusing the shared setup.
# ---------------------------------------------------------------------------
@pytest.fixture
def db_session(db):
    return db


@pytest.fixture
def organization(org):
    return org


@pytest.fixture
def moyasar_encrypted_creds():
    """Returns the provider_config dict for a fully-connected Moyasar org."""
    # Lazy import: moyasar_utils module is created in Task 2; only resolved when a test requests this fixture.
    from ee.services.payments.utils import moyasar_utils
    return {
        "enc_secret_key": moyasar_utils.encrypt_secret("sk_test_fake"),
        "enc_webhook_secret": moyasar_utils.encrypt_secret("whsec_fake"),
        "publishable_key": "pk_test_fake",
        "mode": "test",
    }


@pytest.fixture
def moyasar_config(db_session, organization, moyasar_encrypted_creds):
    """PaymentsConfig row wired up for Moyasar test-mode."""
    cfg = PaymentsConfig(
        org_id=organization.id,
        provider=PaymentProviderEnum.MOYASAR,
        mode=PaymentsModeEnum.standard,  # unused by Moyasar; kept for schema compatibility
        active=True,
        provider_config=moyasar_encrypted_creds,
    )
    db_session.add(cfg)
    db_session.commit()
    db_session.refresh(cfg)
    return cfg
