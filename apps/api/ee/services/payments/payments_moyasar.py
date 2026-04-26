"""
Moyasar payment provider. Implements IPaymentProvider.

Unlike Stripe, Moyasar has no platform/product concept — schools pay per-invoice
directly. Product-lifecycle methods are no-ops that return an object with .id="".

API reference: https://docs.moyasar.com/api/api-introduction/
Authentication: HTTP Basic Auth (username=secret_key, password="")
Webhook signature: HMAC-SHA256 of raw body keyed with shared_secret,
                   sent in the ``x-moyasar-signature`` request header.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from sqlmodel import Session, select

from ee.db.payments.payments import PaymentProviderEnum, PaymentsConfig
from ee.services.payments.provider_interface import IPaymentProvider
from ee.services.payments.utils import moyasar_utils
from src.db.users import AnonymousUser, APITokenUser, PublicUser

logger = logging.getLogger(__name__)


class _NoProductId:
    """Stand-in object with .id attribute for providers that don't create products."""
    id: str = ""


class MoyasarPaymentProvider(IPaymentProvider):
    """Moyasar implementation of IPaymentProvider.

    Key design decisions:
    - Uses the Invoices API (POST /invoices) to create hosted-payment-page sessions,
      matching the Moyasar Invoices API spec (https://docs.moyasar.com/category/invoices-api).
    - Reconciliation polls GET /invoices/{id} when the webhook hasn't yet arrived.
    - Webhook verification uses HMAC-SHA256 over the raw request body with the
      ``shared_secret`` stored as ``enc_webhook_secret`` in PaymentsConfig.provider_config.
    """

    # ------------------------------------------------------------------
    # Product lifecycle — no-ops. Moyasar has no Product API.
    # ------------------------------------------------------------------
    async def create_product(self, *args, **kwargs) -> Any:
        return _NoProductId()

    async def update_product(self, *args, **kwargs) -> Any:
        return _NoProductId()

    async def archive_product(self, *args, **kwargs) -> Any:
        return _NoProductId()

    # ------------------------------------------------------------------
    # Credential loading
    # ------------------------------------------------------------------
    def _load_credentials(self, org_id: int, db_session: Session) -> dict[str, str]:
        """Load and decrypt Moyasar credentials for the given org.

        Returns a dict with keys: secret_key, webhook_secret, publishable_key, mode.
        Raises HTTPException(404) if no active config is found.
        """
        cfg = db_session.exec(
            select(PaymentsConfig).where(
                PaymentsConfig.org_id == org_id,
                PaymentsConfig.provider == PaymentProviderEnum.MOYASAR,
            )
        ).first()
        if cfg is None:
            raise HTTPException(
                status_code=404,
                detail="Moyasar is not configured for this organization",
            )
        if not cfg.active:
            raise HTTPException(
                status_code=400, detail="Moyasar payment configuration is not active"
            )
        pc = cfg.provider_config or {}
        return {
            "secret_key": moyasar_utils.decrypt_secret(pc["enc_secret_key"]),
            "webhook_secret": moyasar_utils.decrypt_secret(pc["enc_webhook_secret"]),
            "publishable_key": pc.get("publishable_key", ""),
            "mode": pc.get("mode", "test"),
        }

    # ------------------------------------------------------------------
    # Provider config upsert (called from the verify-and-connect endpoint)
    # ------------------------------------------------------------------
    async def verify_and_save_credentials(
        self,
        org_id: int,
        publishable_key: str,
        secret_key: str,
        webhook_secret: str,
        db_session: Session,
    ) -> dict[str, Any]:
        """Validate Moyasar API keys against the live API, then persist them encrypted.

        Validation: hits GET /invoices?limit=1 with Basic Auth (secret_key, "").
        This follows the Moyasar authentication spec (HTTP Basic Auth, empty password).

        Returns {"active": True, "mode": "test" | "live"}.
        Raises HTTPException on invalid keys or network failure.
        """
        import httpx as _httpx

        # Ping Moyasar to validate the secret key (official auth: Basic secret_key:"")
        try:
            async with _httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    f"{moyasar_utils.MOYASAR_BASE_URL}/invoices",
                    params={"limit": "1"},
                    auth=(secret_key, ""),
                    headers={"Accept": "application/json"},
                )
            if res.status_code == 401:
                raise HTTPException(status_code=400, detail="Invalid Moyasar secret key")
            if res.status_code >= 400:
                detail = "validation failed"
                try:
                    detail = res.json().get("message", detail)
                except Exception:
                    pass
                raise HTTPException(status_code=400, detail=f"Moyasar: {detail}")
        except _httpx.RequestError:
            raise HTTPException(status_code=502, detail="Could not reach Moyasar")

        # Determine mode from key prefix (sk_test_ → test, sk_live_ → live)
        mode = "test" if secret_key.startswith("sk_test_") else "live"

        provider_config = {
            "enc_secret_key": moyasar_utils.encrypt_secret(secret_key),
            "enc_webhook_secret": moyasar_utils.encrypt_secret(webhook_secret),
            "publishable_key": publishable_key,
            "mode": mode,
        }

        from ee.db.payments.payments import PaymentsModeEnum

        existing = db_session.exec(
            select(PaymentsConfig).where(
                PaymentsConfig.org_id == org_id,
                PaymentsConfig.provider == PaymentProviderEnum.MOYASAR,
            )
        ).first()
        if existing:
            existing.provider_config = provider_config
            existing.active = True
            existing.update_date = datetime.now()
            db_session.add(existing)
        else:
            cfg = PaymentsConfig(
                org_id=org_id,
                provider=PaymentProviderEnum.MOYASAR,
                mode=PaymentsModeEnum.standard,
                active=True,
                provider_specific_id=None,
                provider_config=provider_config,
            )
            db_session.add(cfg)
        db_session.commit()

        logger.info("Moyasar config saved for org_id=%s mode=%s", org_id, mode)
        return {"active": True, "mode": mode}

    # ------------------------------------------------------------------
    # Checkout (Invoices API)
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
        """Create a Moyasar hosted invoice (checkout) for the given offer.

        Uses the Invoices API (POST /invoices) per official docs:
        https://docs.moyasar.com/category/invoices-api

        Required invoice fields (per API spec):
          - amount (integer, in smallest unit e.g. halalas for SAR)
          - currency (ISO-4217)
          - description
        Optional:
          - callback_url (server-to-server POST notification)
          - success_url  (browser redirect after payment)
          - back_url     (browser "back" button destination)
          - metadata     (arbitrary key-value string map, stored with the invoice)

        Returns {"checkout_url": "<invoice.url>", "session_id": "<invoice.id>"}.
        """
        from ee.db.payments.payments_offers import PaymentsOffer, OfferTypeEnum
        from ee.db.payments.payments_enrollments import PaymentsEnrollment, EnrollmentStatusEnum
        from src.db.organizations import Organization

        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=401, detail="Authentication required")

        creds = self._load_credentials(org_id, db_session)

        offer = db_session.exec(
            select(PaymentsOffer).where(
                PaymentsOffer.id == offer_id,
                PaymentsOffer.org_id == org_id,
            )
        ).first()
        if offer is None:
            raise HTTPException(status_code=404, detail="Offer not found")

        if offer.offer_type == OfferTypeEnum.SUBSCRIPTION:
            raise HTTPException(
                status_code=400,
                detail="Moyasar doesn't support subscriptions in v1. Use a one-time offer.",
            )

        moyasar_utils.validate_currency(offer.currency)

        user_id = int(current_user.id)

        # Create a PENDING enrollment first so we have an ID for metadata + idempotency
        enrollment = PaymentsEnrollment(
            org_id=org_id,
            user_id=user_id,
            offer_id=offer.id,
            status=EnrollmentStatusEnum.PENDING,
            provider_specific_data={},
        )
        enrollment.creation_date = datetime.now()
        enrollment.update_date = datetime.now()
        db_session.add(enrollment)
        db_session.commit()
        db_session.refresh(enrollment)

        # ------------------------------------------------------------------
        # Build callback/success URLs
        #
        # callback_url (server-to-server): Use LEARNHOUSE_API_URL env var to
        # avoid SSRF via a spoofed Host header in reverse-proxy setups.
        # Falls back to request.base_url only when the env var is not set (dev).
        #
        # success_url / back_url (browser): derived from the redirect_uri passed
        # by the frontend (the offer page URL); we extract only the origin to
        # build the callback page path.
        # ------------------------------------------------------------------
        api_base = (
            os.environ.get("LEARNHOUSE_API_URL", "").rstrip("/")
            or str(request.base_url).rstrip("/")
        )
        callback_url = f"{api_base}/api/v1/payments/moyasar/webhook"

        parsed = urlparse(redirect_uri or "")
        if parsed.scheme and parsed.netloc:
            frontend_origin = f"{parsed.scheme}://{parsed.netloc}"
        else:
            frontend_origin = str(request.base_url).rstrip("/") if request else ""

        # Moyasar callback page: browser lands here after payment completes/fails
        callback_page = (
            f"{frontend_origin}/payments/moyasar/callback"
            f"?enrollment_id={enrollment.id}"
        )

        # Org name for invoice description
        org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
        org_name = org.name if org else ""
        description = f"{offer.name} — {org_name}"[:255] if org_name else offer.name[:255]

        # Build invoice payload per Moyasar Invoices API spec:
        # https://docs.moyasar.com/category/invoices-api

        # Expire the hosted invoice page after 30 minutes so stale checkout
        # URLs cannot be reused. Format: ISO 8601 UTC as required by Moyasar.
        expires_at = (
            datetime.now(timezone.utc) + timedelta(minutes=30)
        ).strftime("%Y-%m-%dT%H:%M:%S.000Z")

        payload: dict[str, Any] = {
            "amount": moyasar_utils.to_halalas(offer.amount),
            "currency": offer.currency.upper(),
            "description": description,
            "success_url": callback_page,
            "back_url": callback_page,
            "callback_url": callback_url,
            # Invoice expires in 30 minutes — prevents stale URL reuse
            "expired_at": expires_at,
            # metadata: string key-value pairs; enrollment_id used for webhook reconciliation
            "metadata": {
                "enrollment_id": str(enrollment.id),
                "offer_id": str(offer.id),
                "org_id": str(org_id),
                "user_id": str(user_id),
            },
        }

        # POST /invoices — idempotency key prevents double-charge on network retry
        invoice = await moyasar_utils.moyasar_request(
            method="POST",
            path="/invoices",
            secret_key=creds["secret_key"],
            json=payload,
            idempotency_key=f"enrollment-{enrollment.id}-v1",
        )

        # Persist the Moyasar invoice ID so the webhook + reconciliation can match it
        enrollment.provider_specific_data = {"moyasar_invoice_id": invoice["id"]}
        enrollment.update_date = datetime.now()
        db_session.add(enrollment)
        db_session.commit()

        logger.info(
            "Moyasar checkout: org_id=%s enrollment=%s invoice=%s",
            org_id, enrollment.id, invoice["id"],
        )

        # IPaymentProvider contract: must return {"checkout_url": "...", "session_id": "..."}
        return {"checkout_url": invoice["url"], "session_id": invoice["id"]}

    # ------------------------------------------------------------------
    # Enrollment reconciliation (called from status polling endpoint)
    # ------------------------------------------------------------------
    async def reconcile_enrollment(
        self,
        enrollment_id: int,
        db_session: Session,
    ) -> None:
        """One-shot reconciliation against the Moyasar Invoices API.

        Fetches GET /invoices/{invoice_id} and updates enrollment status if the
        invoice has been paid, failed, or cancelled since the last check.

        Called by the status-polling endpoint when the enrollment is still PENDING
        and a webhook hasn't been received yet.

        Silently swallows errors so the polling caller can return the current DB
        status and let the client retry.
        """
        from ee.db.payments.payments_enrollments import PaymentsEnrollment, EnrollmentStatusEnum

        e = db_session.exec(
            select(PaymentsEnrollment).where(PaymentsEnrollment.id == enrollment_id)
        ).first()
        if e is None or e.status != EnrollmentStatusEnum.PENDING:
            return

        invoice_id = (e.provider_specific_data or {}).get("moyasar_invoice_id")
        if not invoice_id:
            return

        try:
            creds = self._load_credentials(e.org_id, db_session)
            # GET /invoices/{invoice_id} per Moyasar Invoices API
            inv = await moyasar_utils.moyasar_request(
                method="GET",
                path=f"/invoices/{invoice_id}",
                secret_key=creds["secret_key"],
            )
            # Invoice statuses: initiated, paid, failed, refunded, canceled, on_hold, expired, voided
            inv_status = inv.get("status", "")
            if inv_status == "paid":
                e.status = EnrollmentStatusEnum.ACTIVE
                e.update_date = datetime.now()
                db_session.add(e)
                db_session.commit()
                db_session.refresh(e)
                logger.info("Enrollment %s reconciled → ACTIVE (invoice %s)", enrollment_id, invoice_id)
            elif inv_status in {"failed", "canceled", "expired", "voided"}:
                e.status = EnrollmentStatusEnum.CANCELLED
                e.update_date = datetime.now()
                db_session.add(e)
                db_session.commit()
                db_session.refresh(e)
                logger.info(
                    "Enrollment %s reconciled → CANCELLED (invoice %s, status=%s)",
                    enrollment_id, invoice_id, inv_status,
                )
        except HTTPException:
            # Reconciliation failed — log and swallow; client will retry
            logger.warning("Enrollment %s reconciliation failed (will retry)", enrollment_id)

    # ------------------------------------------------------------------
    # Billing portal — not supported by Moyasar
    # ------------------------------------------------------------------
    async def create_billing_portal_session(self, *args, **kwargs) -> dict[str, str]:
        raise HTTPException(
            status_code=501,
            detail="Moyasar has no billing portal. Manage payments in the Moyasar dashboard.",
        )

    # ------------------------------------------------------------------
    # Webhooks
    # ------------------------------------------------------------------
    async def handle_webhook(
        self, request: Request, webhook_type: str, db_session: Session
    ) -> dict[str, Any]:
        """Handle a Moyasar webhook notification.

        Moyasar webhook security (from official docs):
          - Sends ``x-moyasar-signature`` header = HMAC-SHA256(shared_secret, raw_body).
          - We MUST verify this signature before mutating any enrollment state.
          - Returns 200 regardless of outcome (after verification) to prevent
            Moyasar retry storms on legitimate but already-processed events.

        Supported event types (from Moyasar API):
          - ``payment_paid`` / ``invoice_paid``  → ACTIVE
          - ``payment_failed`` / ``invoice_failed`` / ``invoice_canceled`` → CANCELLED

        The ``metadata.enrollment_id`` set at invoice-creation time is used to
        identify which enrollment to update.
        """
        import json as _json
        from ee.db.payments.payments_enrollments import PaymentsEnrollment, EnrollmentStatusEnum

        raw = await request.body()

        # ----------------------------------------------------------------
        # Step 1: Reject immediately if the signature header is absent.
        # An unsigned POST to a webhook endpoint is always invalid.
        # ----------------------------------------------------------------
        sig_header = request.headers.get("x-moyasar-signature", "")
        if not sig_header:
            logger.warning("Moyasar webhook: missing x-moyasar-signature header")
            raise HTTPException(status_code=400, detail="Missing webhook signature")

        # ----------------------------------------------------------------
        # Step 2: Parse body to extract org_id from metadata (needed to
        # load the per-org webhook_secret for HMAC verification).
        # ----------------------------------------------------------------
        try:
            event = _json.loads(raw.decode())
        except _json.JSONDecodeError:
            logger.warning("Moyasar webhook: invalid JSON body")
            return {"status": "ignored"}

        event_type = event.get("type") or ""
        data = event.get("data") or {}
        metadata = data.get("metadata") or event.get("metadata") or {}

        enrollment_id_raw = metadata.get("enrollment_id")
        org_id_raw = metadata.get("org_id")

        if not enrollment_id_raw or not org_id_raw:
            logger.debug("Moyasar webhook: missing enrollment_id or org_id in metadata")
            return {"status": "ignored"}

        try:
            enrollment_id = int(enrollment_id_raw)
            org_id = int(org_id_raw)
        except (ValueError, TypeError):
            return {"status": "ignored"}

        # ----------------------------------------------------------------
        # Step 3: Load credentials and verify full HMAC-SHA256 signature.
        # ----------------------------------------------------------------
        try:
            creds = self._load_credentials(org_id, db_session)
        except HTTPException:
            logger.warning(
                "Moyasar webhook: could not load credentials for org_id=%s", org_id
            )
            return {"status": "ignored"}

        try:
            moyasar_utils.verify_webhook_signature(raw, sig_header, creds["webhook_secret"])
        except HTTPException:
            raise  # Propagate 400 to caller

        # ----------------------------------------------------------------
        # Step 3: Look up enrollment and apply status transition
        # ----------------------------------------------------------------
        e = db_session.exec(
            select(PaymentsEnrollment).where(PaymentsEnrollment.id == enrollment_id)
        ).first()
        if e is None:
            return {"status": "ignored"}

        if event_type in {"payment_paid", "invoice_paid"}:
            if e.status != EnrollmentStatusEnum.ACTIVE:
                e.status = EnrollmentStatusEnum.ACTIVE
                e.update_date = datetime.now()
                db_session.add(e)
                db_session.commit()
                logger.info("Enrollment %s → ACTIVE via webhook (event=%s)", enrollment_id, event_type)
            return {"status": "success"}

        if event_type in {"payment_failed", "invoice_failed", "invoice_canceled"}:
            if e.status != EnrollmentStatusEnum.CANCELLED:
                e.status = EnrollmentStatusEnum.CANCELLED
                e.update_date = datetime.now()
                db_session.add(e)
                db_session.commit()
                logger.info("Enrollment %s → CANCELLED via webhook (event=%s)", enrollment_id, event_type)
            return {"status": "success"}

        logger.debug("Moyasar webhook: unhandled event_type=%s", event_type)
        return {"status": "ignored"}
