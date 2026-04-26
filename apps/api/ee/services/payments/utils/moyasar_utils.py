"""
Moyasar provider plumbing — encryption, conversion, signature verification, HTTP wrapper.

Pure-function layer. No DB, no business logic. Unit-testable without fixtures.

Webhook signature:
  Moyasar signs each webhook request with HMAC-SHA256 over the raw request body
  using the `shared_secret` configured in the Moyasar Dashboard → Settings → Webhooks.
  The computed digest is placed in the `x-moyasar-signature` request header.
  Reference: https://docs.moyasar.com (Settings → Webhooks)
"""
import base64
import hashlib
import hmac
import logging
import os
from decimal import Decimal, ROUND_HALF_UP

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Fernet encryption (credential storage)
# ---------------------------------------------------------------------------

def _fernet() -> Fernet:
    """Build a Fernet instance from LEARNHOUSE_AUTH_JWT_SECRET_KEY.

    The JWT secret is hashed with SHA-256 to produce a 32-byte key and
    then base64-url encoded (Fernet's required format).
    """
    jwt_secret = os.environ.get("LEARNHOUSE_AUTH_JWT_SECRET_KEY")
    if not jwt_secret:
        raise RuntimeError("LEARNHOUSE_AUTH_JWT_SECRET_KEY is not set")
    key = base64.urlsafe_b64encode(hashlib.sha256(jwt_secret.encode()).digest())
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret string. Returns a URL-safe base64 token (starts with gAAAAA)."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a token. Raises HTTPException(500) on any Fernet failure."""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        logger.error("Failed to decrypt payment credentials: %s", e)
        raise HTTPException(
            status_code=500, detail="Failed to decrypt payment credentials"
        )


# ---------------------------------------------------------------------------
# Webhook signature verification
# ---------------------------------------------------------------------------

def verify_webhook_signature(raw_body: bytes, signature_header: str, webhook_secret: str) -> None:
    """Verify a Moyasar webhook request using HMAC-SHA256.

    Moyasar computes:
        HMAC-SHA256(key=shared_secret, msg=raw_request_body)
    and sends the hex digest in the ``x-moyasar-signature`` request header.

    Raises HTTPException(400) on mismatch or missing signature so the caller
    can return a non-2xx to Moyasar and trigger a retry — however in practice
    we log and return 200 to avoid uncontrolled retry storms; the caller chooses.

    Args:
        raw_body: The unmodified request body bytes (must be read *before* any parsing).
        signature_header: Value of the ``x-moyasar-signature`` header.
        webhook_secret: The plaintext ``shared_secret`` (already decrypted).

    Raises:
        HTTPException(400): signature missing or does not match.
    """
    if not signature_header:
        logger.warning("Moyasar webhook: missing x-moyasar-signature header")
        raise HTTPException(status_code=400, detail="Missing webhook signature")

    expected = hmac.new(
        webhook_secret.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature_header):
        logger.warning(
            "Moyasar webhook: signature mismatch (expected=%s, got=%s)",
            expected[:8] + "...",
            signature_header[:8] + "...",
        )
        raise HTTPException(status_code=400, detail="Invalid webhook signature")


# ---------------------------------------------------------------------------
# HTTP base URL
# ---------------------------------------------------------------------------

MOYASAR_BASE_URL = "https://api.moyasar.com/v1"


# ---------------------------------------------------------------------------
# Currency & amount conversion
# ---------------------------------------------------------------------------

SUPPORTED_CURRENCIES = frozenset({"SAR", "USD", "EUR", "KWD", "AED", "BHD", "QAR", "OMR"})


def to_halalas(amount: Decimal | float | int) -> int:
    """Convert a human-readable amount to Moyasar's minor-unit integer.
    SAR 10.50 → 1050. HALF_UP rounding."""
    d = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def validate_currency(currency: str) -> None:
    """Raise HTTPException(400) if the currency is not supported by Moyasar."""
    if currency.upper() not in SUPPORTED_CURRENCIES:
        supported = ", ".join(sorted(SUPPORTED_CURRENCIES))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Currency {currency} is not supported by Moyasar. "
                f"Supported: {supported}."
            ),
        )


# ---------------------------------------------------------------------------
# HTTP wrapper
# ---------------------------------------------------------------------------

async def moyasar_request(
    *,
    method: str,
    path: str,
    secret_key: str,
    json: dict | None = None,
    params: dict | None = None,
    idempotency_key: str | None = None,
    timeout_seconds: float = 15.0,
) -> dict:
    """Call the Moyasar API. Wraps errors as FastAPI HTTPExceptions.

    Per the official Moyasar API docs (https://docs.moyasar.com/api/authentication):
      - Authentication: HTTP Basic Auth — username = secret_key, password = empty string.
      - All calls must be made over HTTPS.
      - Base URL: https://api.moyasar.com/v1

    2xx → parsed JSON; non-2xx → HTTPException(400, "Moyasar: ..."); network → 502.
    """
    url = f"{MOYASAR_BASE_URL}{path}"
    headers: dict[str, str] = {"Accept": "application/json"}
    if idempotency_key:
        # Moyasar supports idempotency keys per https://docs.moyasar.com/api/idempotency
        headers["Idempotency-Key"] = idempotency_key

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            res = await client.request(
                method=method,
                url=url,
                json=json,
                params=params,
                headers=headers,
                # Basic Auth: username=secret_key, password="" (empty)
                auth=(secret_key, ""),
            )
            res.raise_for_status()
            return res.json()
    except httpx.HTTPStatusError as e:
        detail = "HTTP error"
        try:
            body = e.response.json()
            detail = body.get("message") or body.get("type") or str(e)
        except Exception:  # noqa: BLE001 — non-JSON 5xx is possible
            pass
        logger.warning("Moyasar API error %s: %s", e.response.status_code, detail)
        raise HTTPException(status_code=400, detail=f"Moyasar: {detail}")
    except (httpx.RequestError, httpx.TimeoutException) as e:
        logger.error("Moyasar unreachable: %s", e)
        raise HTTPException(status_code=502, detail="Moyasar unreachable")
