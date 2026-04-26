"""Integration tests for Moyasar routes. FastAPI + httpx AsyncClient + respx for outbound HTTP.

Adapted to this repo's test conventions (see src/tests/routers/test_orgs_router.py):
- Uses AsyncClient with ASGITransport and FastAPI dependency_overrides.
- Uses the existing `admin_user` / `regular_user` / `db` / `org` fixtures from
  the root conftest, exposed via the payments `conftest.py` aliases.
"""
import hashlib
import hmac
import json

import httpx
import pytest
import respx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from ee.routers.payments import router as payments_router, webhook_router
from src.core.events.database import get_db_session
from src.security.auth import get_current_user

MOYASAR_BASE = "https://api.moyasar.com/v1"


@pytest.fixture
def student_user(regular_user):
    """Alias for the repo's regular_user fixture, matching plan wording."""
    return regular_user


def _build_app(db, user):
    app = FastAPI()
    app.include_router(payments_router, prefix="/api/v1/payments")
    app.include_router(webhook_router, prefix="/api/v1/payments")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return app


def _build_webhook_app(db):
    """App with no auth override (webhook endpoint is public)."""
    app = FastAPI()
    app.include_router(webhook_router, prefix="/api/v1/payments")
    app.dependency_overrides[get_db_session] = lambda: db
    return app


class TestConnectVerifyRoute:
    @pytest.mark.asyncio
    @respx.mock
    async def test_valid_keys_creates_active_config(
        self, organization, admin_user, db_session
    ):
        respx.get(f"{MOYASAR_BASE}/invoices", params={"limit": "1"}).mock(
            return_value=httpx.Response(200, json={"invoices": []})
        )
        app = _build_app(db_session, admin_user)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.post(
                f"/api/v1/payments/{organization.id}/moyasar/connect/verify",
                json={
                    "publishable_key": "pk_test_x",
                    "secret_key": "sk_test_x",
                    "webhook_secret": "whsec_x",
                },
            )
        assert res.status_code == 200
        body = res.json()
        assert body["active"] is True
        assert body["mode"] == "test"

        from ee.db.payments.payments import PaymentProviderEnum, PaymentsConfig
        from sqlmodel import select
        cfg = db_session.exec(
            select(PaymentsConfig).where(
                PaymentsConfig.org_id == organization.id,
                PaymentsConfig.provider == PaymentProviderEnum.MOYASAR,
            )
        ).first()
        assert cfg is not None and cfg.active

    @pytest.mark.asyncio
    @respx.mock
    async def test_invalid_keys_returns_400(
        self, organization, admin_user, db_session
    ):
        respx.get(f"{MOYASAR_BASE}/invoices", params={"limit": "1"}).mock(
            return_value=httpx.Response(401, json={"message": "Invalid key"})
        )
        app = _build_app(db_session, admin_user)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.post(
                f"/api/v1/payments/{organization.id}/moyasar/connect/verify",
                json={
                    "publishable_key": "pk_test_x",
                    "secret_key": "sk_test_bad",
                    "webhook_secret": "whsec_x",
                },
            )
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_non_admin_returns_403(
        self, organization, student_user, db_session
    ):
        app = _build_app(db_session, student_user)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.post(
                f"/api/v1/payments/{organization.id}/moyasar/connect/verify",
                json={
                    "publishable_key": "pk_test_x",
                    "secret_key": "sk_test_x",
                    "webhook_secret": "whsec_x",
                },
            )
        assert res.status_code in (401, 403)


class TestMoyasarWebhookRoute:
    """Verify the webhook endpoint enforces HMAC-SHA256 signature checking."""

    def _sign(self, body: bytes, secret: str) -> str:
        return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    @pytest.mark.asyncio
    async def test_missing_signature_returns_400(self, db_session, moyasar_config):
        """Webhook with no x-moyasar-signature must be rejected."""
        app = _build_webhook_app(db_session)
        payload = json.dumps({"type": "invoice_paid", "data": {}, "metadata": {}}).encode()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.post(
                "/api/v1/payments/moyasar/webhook",
                content=payload,
                headers={"Content-Type": "application/json"},
            )
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_wrong_signature_returns_400(self, db_session, moyasar_config, organization):
        """Webhook with incorrect signature must be rejected."""
        from ee.db.payments.payments_enrollments import PaymentsEnrollment, EnrollmentStatusEnum
        from datetime import datetime

        enrollment = PaymentsEnrollment(
            org_id=organization.id,
            user_id=1,
            offer_id=1,
            status=EnrollmentStatusEnum.PENDING,
            provider_specific_data={"moyasar_invoice_id": "inv_test"},
        )
        enrollment.creation_date = datetime.now()
        enrollment.update_date = datetime.now()
        db_session.add(enrollment)
        db_session.commit()
        db_session.refresh(enrollment)

        payload = json.dumps({
            "type": "invoice_paid",
            "data": {"metadata": {
                "enrollment_id": str(enrollment.id),
                "org_id": str(organization.id),
            }},
        }).encode()
        bad_sig = self._sign(payload, "wrong_secret")

        app = _build_webhook_app(db_session)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.post(
                "/api/v1/payments/moyasar/webhook",
                content=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-moyasar-signature": bad_sig,
                },
            )
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_valid_invoice_paid_activates_enrollment(
        self, db_session, moyasar_config, organization
    ):
        """Valid webhook with correct signature must activate the enrollment."""
        from ee.db.payments.payments_enrollments import PaymentsEnrollment, EnrollmentStatusEnum
        from ee.services.payments.utils import moyasar_utils
        from datetime import datetime

        enrollment = PaymentsEnrollment(
            org_id=organization.id,
            user_id=1,
            offer_id=1,
            status=EnrollmentStatusEnum.PENDING,
            provider_specific_data={"moyasar_invoice_id": "inv_paid_test"},
        )
        enrollment.creation_date = datetime.now()
        enrollment.update_date = datetime.now()
        db_session.add(enrollment)
        db_session.commit()
        db_session.refresh(enrollment)

        payload = json.dumps({
            "type": "invoice_paid",
            "data": {"metadata": {
                "enrollment_id": str(enrollment.id),
                "org_id": str(organization.id),
            }},
        }).encode()

        # Use the real webhook secret from the fixture
        webhook_secret = moyasar_utils.decrypt_secret(
            moyasar_config.provider_config["enc_webhook_secret"]
        )
        sig = self._sign(payload, webhook_secret)

        app = _build_webhook_app(db_session)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.post(
                "/api/v1/payments/moyasar/webhook",
                content=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-moyasar-signature": sig,
                },
            )
        assert res.status_code == 200
        assert res.json()["status"] == "success"

        db_session.refresh(enrollment)
        assert enrollment.status == EnrollmentStatusEnum.ACTIVE
