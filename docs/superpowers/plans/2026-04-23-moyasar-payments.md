# Moyasar Payment Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **User preference — read before executing any `git` step:** `git add` and `git commit` steps are included in every task to preserve TDD discipline, but **each commit requires explicit user approval at execution time.** Stop and ask before running any `git` command. See memory: `No auto-commit`.

**Goal:** Add Moyasar (Saudi payment gateway) as a drop-in `IPaymentProvider` implementation alongside Stripe, enabling schools to accept one-time payments via per-school API keys and hosted invoice redirect.

**Architecture:** New `MoyasarPaymentProvider` class implementing the existing `IPaymentProvider` ABC. Credentials encrypted with Fernet (key derived from `LEARNHOUSE_AUTH_JWT_SECRET_KEY`) and stored in `PaymentsConfig.provider_config` JSON. Checkout creates a Moyasar Invoice and redirects the student; webhooks drive enrollment status. Callback page polls with a one-shot reconciliation fallback for missing webhooks. EE-gated like Stripe.

**Tech Stack:** Python 3.14 / FastAPI / SQLModel / `httpx` (existing) / `cryptography.fernet` (existing, pulled by authlib) / `respx` (new dev dep for HTTP mocking). Web: Next.js / TypeScript / React — no new frontend deps.

**Spec:** `docs/superpowers/specs/2026-04-23-moyasar-payments-design.md`

**Branch:** `feat/payments-moyasar`

---

## File structure

### New files

| Path | Purpose |
|---|---|
| `apps/api/ee/services/payments/utils/__init__.py` | Package marker (may already exist) |
| `apps/api/ee/services/payments/utils/moyasar_utils.py` | Fernet encryption, halalas conversion, webhook signature verification, `httpx` wrapper |
| `apps/api/ee/services/payments/payments_moyasar.py` | `MoyasarPaymentProvider(IPaymentProvider)` + module-level shims used by the router |
| `apps/api/src/tests/payments/__init__.py` | Test package marker |
| `apps/api/src/tests/payments/conftest.py` | Payment-specific fixtures (org + Moyasar config + user + offer + enrollment) |
| `apps/api/src/tests/payments/test_payments_moyasar.py` | Unit tests (no network) |
| `apps/api/src/tests/payments/test_payments_moyasar_router.py` | Integration tests via `TestClient` |
| `apps/web/app/payments/moyasar/callback/page.tsx` | Post-payment landing, polls enrollment status |
| `apps/web/services/payments/providers/moyasar.ts` | Client API wrappers: `verifyMoyasarKeys`, `getEnrollmentStatus` |
| `apps/web/components/Dashboard/Pages/Payments/MoyasarKeysModal.tsx` | Modal that collects pk + sk + webhook secret and calls verify |

### Modified files

| Path | Change |
|---|---|
| `apps/api/ee/db/payments/payments.py` | Add `MOYASAR = "moyasar"` to `PaymentProviderEnum` |
| `apps/api/ee/services/payments/provider_registry.py` | Add `_moyasar_provider()` factory + branch in `get_provider()` |
| `apps/api/ee/routers/payments.py` | Add 3 routes: `connect/verify`, `webhook`, `enrollments/{id}/status` |
| `apps/api/ee/services/payments/webhooks/payments_webhooks.py` | Add `handle_moyasar_webhook(request, db_session)` branch |
| `apps/api/pyproject.toml` | Add `respx` to dev dependencies |
| `apps/web/components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx` | Add Moyasar entry with `connectMode: 'keys'` branch |

### Responsibility boundaries

- **`moyasar_utils.py`** — pure functions only (encryption, conversion, signature math, HTTP wrapper). No DB, no business logic. Easily unit-testable.
- **`payments_moyasar.py`** — business logic (credential lookup, checkout creation, webhook handling). Calls `moyasar_utils` for plumbing. Implements `IPaymentProvider`.
- **`ee/routers/payments.py`** — HTTP glue: auth, RBAC, request parsing, invoke `MoyasarPaymentProvider`, return response.
- **`test_payments_moyasar.py`** — unit-tests provider + utils, no FastAPI, no real HTTP.
- **`test_payments_moyasar_router.py`** — integration via `TestClient`, mocks outbound Moyasar HTTP with `respx`, mocks Redis via monkey-patch.

---

## Task 1: Scaffold — enum + dev dep + test package

**Files:**
- Modify: `apps/api/ee/db/payments/payments.py:14`
- Modify: `apps/api/pyproject.toml`
- Create: `apps/api/src/tests/payments/__init__.py` (empty)
- Create: `apps/api/src/tests/payments/conftest.py`

- [ ] **Step 1: Add `MOYASAR` to `PaymentProviderEnum`**

Open `apps/api/ee/db/payments/payments.py`, line 14, modify:

```python
class PaymentProviderEnum(str, Enum):
    STRIPE = "stripe"
    MOYASAR = "moyasar"
    # LEMON_SQUEEZY = "lemon_squeezy"  # example future provider
    # PADDLE = "paddle"                # example future provider
```

- [ ] **Step 2: Add `respx` to dev dependencies**

Open `apps/api/pyproject.toml`, find the dev/test dependencies section, add `respx>=0.22.0`. Typical shape:

```toml
[dependency-groups]
dev = [
    # ...existing entries...
    "respx>=0.22.0",
]
```

If the section is named `[tool.uv.dev-dependencies]` or `[project.optional-dependencies]` instead, match that form — look at the existing file to confirm before editing.

- [ ] **Step 3: Install new dep**

Run: `cd apps/api && uv sync`
Expected: `respx` is installed, no errors.

- [ ] **Step 4: Create empty test package marker**

Create `apps/api/src/tests/payments/__init__.py` with a single empty line.

- [ ] **Step 5: Create payment test fixtures**

Create `apps/api/src/tests/payments/conftest.py`:

```python
"""
Fixtures for Moyasar payment tests. Reuses the session + user + org fixtures
from src/tests/conftest.py; adds a ready-to-use PaymentsConfig and Offer.
"""
import json
from datetime import datetime
from decimal import Decimal

import pytest

from ee.db.payments.payments import (
    PaymentProviderEnum,
    PaymentsConfig,
    PaymentsModeEnum,
)


@pytest.fixture
def moyasar_encrypted_creds(monkeypatch):
    """Returns the provider_config dict for a fully-connected Moyasar org."""
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
        provider_specific_id=None,
        provider_config=moyasar_encrypted_creds,
        creation_date=datetime.now(),
        update_date=datetime.now(),
    )
    db_session.add(cfg)
    db_session.commit()
    db_session.refresh(cfg)
    return cfg
```

**Note:** This fixture depends on `organization` and `db_session` existing in `src/tests/conftest.py`. Before running, verify they exist with:

Run: `grep -n "def organization\|def db_session" apps/api/src/tests/conftest.py`
Expected: both fixtures listed. If either is missing, add a short scoped fixture to `src/tests/payments/conftest.py` using the same pattern as other tests in the repo.

- [ ] **Step 6: Verify enum import works**

Run: `cd apps/api && uv run python -c "from ee.db.payments.payments import PaymentProviderEnum; print(PaymentProviderEnum.MOYASAR)"`
Expected: `PaymentProviderEnum.MOYASAR`

- [ ] **Step 7: Commit** *(ask user before running)*

```bash
git add apps/api/ee/db/payments/payments.py apps/api/pyproject.toml apps/api/uv.lock apps/api/src/tests/payments/
git commit -m "feat(payments): scaffold MOYASAR enum + respx dev dep + test package"
```

---

## Task 2: Utils — Fernet encryption (TDD)

**Files:**
- Create: `apps/api/ee/services/payments/utils/__init__.py` (if missing — check first)
- Create: `apps/api/ee/services/payments/utils/moyasar_utils.py`
- Create: `apps/api/src/tests/payments/test_payments_moyasar.py` (seeded with the first tests)

- [ ] **Step 1: Ensure utils package exists**

Run: `ls apps/api/ee/services/payments/utils/ 2>/dev/null || mkdir -p apps/api/ee/services/payments/utils && touch apps/api/ee/services/payments/utils/__init__.py`
Expected: directory exists, `__init__.py` present.

- [ ] **Step 2: Write failing tests for encryption**

Create `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
"""Unit tests for payments_moyasar and moyasar_utils. No network, no DB writes."""
import pytest
from fastapi import HTTPException

from ee.services.payments.utils import moyasar_utils


class TestEncryption:
    def test_encrypt_decrypt_round_trip(self):
        plain = "sk_test_abcdef1234567890"
        cipher = moyasar_utils.encrypt_secret(plain)
        assert cipher != plain
        assert cipher.startswith("gAAAAA")
        assert moyasar_utils.decrypt_secret(cipher) == plain

    def test_decrypt_invalid_token_raises_http_500(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.decrypt_secret("not-a-valid-fernet-token")
        assert exc.value.status_code == 500
        assert "decrypt" in exc.value.detail.lower()

    def test_encrypt_deterministic_with_same_jwt_secret(self, monkeypatch):
        """Fernet output isn't deterministic (built-in nonce), but decryption should
        round-trip when JWT secret is unchanged."""
        plain = "whsec_xyz"
        c1 = moyasar_utils.encrypt_secret(plain)
        c2 = moyasar_utils.encrypt_secret(plain)
        assert c1 != c2  # random nonce
        assert moyasar_utils.decrypt_secret(c1) == plain
        assert moyasar_utils.decrypt_secret(c2) == plain
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: all 3 tests FAIL with `ImportError` or `AttributeError` on `moyasar_utils.encrypt_secret` / `moyasar_utils.decrypt_secret`.

- [ ] **Step 4: Implement encryption helpers**

Create `apps/api/ee/services/payments/utils/moyasar_utils.py`:

```python
"""
Moyasar provider plumbing — encryption, conversion, signature verification, HTTP wrapper.

Pure-function layer. No DB, no business logic. Unit-testable without fixtures.
"""
import base64
import hashlib
import hmac
import logging
import os
from decimal import Decimal, ROUND_HALF_UP

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

logger = logging.getLogger(__name__)


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
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 6: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/utils/ apps/api/src/tests/payments/test_payments_moyasar.py
git commit -m "feat(payments): Fernet encryption helpers for Moyasar credentials"
```

---

## Task 3: Utils — Halalas conversion + currency check (TDD)

**Files:**
- Modify: `apps/api/ee/services/payments/utils/moyasar_utils.py` (append)
- Modify: `apps/api/src/tests/payments/test_payments_moyasar.py` (append test class)

- [ ] **Step 1: Write failing tests for halalas conversion + currency**

Append to `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
from decimal import Decimal


class TestHalalas:
    def test_to_halalas_from_decimal(self):
        assert moyasar_utils.to_halalas(Decimal("10.50")) == 1050
        assert moyasar_utils.to_halalas(Decimal("0.01")) == 1
        assert moyasar_utils.to_halalas(Decimal("100")) == 10000
        assert moyasar_utils.to_halalas(Decimal("0")) == 0

    def test_to_halalas_from_float(self):
        assert moyasar_utils.to_halalas(5.25) == 525

    def test_to_halalas_from_int(self):
        assert moyasar_utils.to_halalas(7) == 700

    def test_to_halalas_rounds_half_up(self):
        # 0.005 → 0.50 halalas should round to 1
        assert moyasar_utils.to_halalas(Decimal("0.005")) == 1


class TestCurrency:
    def test_supported_currency_passes(self):
        for ccy in ["SAR", "USD", "EUR", "KWD", "AED", "BHD", "QAR", "OMR"]:
            moyasar_utils.validate_currency(ccy)  # no raise

    def test_supported_currency_case_insensitive(self):
        moyasar_utils.validate_currency("sar")
        moyasar_utils.validate_currency("Usd")

    def test_unsupported_currency_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.validate_currency("GBP")
        assert exc.value.status_code == 400
        assert "GBP" in exc.value.detail
        assert "SAR" in exc.value.detail  # lists supported currencies
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: 8 tests FAIL (the 3 from Task 2 pass, 5 new ones fail on missing functions).

- [ ] **Step 3: Implement `to_halalas` and `validate_currency`**

Append to `apps/api/ee/services/payments/utils/moyasar_utils.py`:

```python
# -- Currency & amount conversion -------------------------------------------

SUPPORTED_CURRENCIES = frozenset({"SAR", "USD", "EUR", "KWD", "AED", "BHD", "QAR", "OMR"})


def to_halalas(amount: Decimal | float | int) -> int:
    """Convert a human-readable amount to Moyasar's minor-unit integer.

    SAR 10.50 → 1050. Uses HALF_UP rounding to avoid banker's rounding surprises.
    """
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
```

- [ ] **Step 4: Run tests — verify all pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/utils/moyasar_utils.py apps/api/src/tests/payments/test_payments_moyasar.py
git commit -m "feat(payments): halalas conversion + Moyasar currency validator"
```

---

## Task 4: Utils — Webhook signature verification (TDD, with live-validation caveat)

**Files:**
- Modify: `apps/api/ee/services/payments/utils/moyasar_utils.py` (append)
- Modify: `apps/api/src/tests/payments/test_payments_moyasar.py` (append test class)

**⚠️ Implementation note from spec §3c:**
The spec explicitly flagged Moyasar's signature scheme as *unknown at design time*. Based on Moyasar's public docs, webhook events include a `secret_token` **field inside the JSON body** that equals the webhook secret the merchant configured — not a signed header. This implementation assumes that scheme. Before closing out Task 4, trigger a real test webhook from the Moyasar dashboard and verify the incoming payload matches the assumption. If Moyasar also sends an HMAC signature header (some gateways do both), extend the verifier to check both.

- [ ] **Step 1: Write failing tests for signature verification**

Append to `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
class TestWebhookSignature:
    def test_valid_secret_token_in_body_passes(self):
        body = {"type": "payment_paid", "secret_token": "whsec_correct", "data": {}}
        # Does not raise
        moyasar_utils.verify_webhook_signature(body, webhook_secret="whsec_correct")

    def test_missing_secret_token_raises_401(self):
        body = {"type": "payment_paid", "data": {}}
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.verify_webhook_signature(body, webhook_secret="whsec_correct")
        assert exc.value.status_code == 401

    def test_mismatched_secret_token_raises_401(self):
        body = {"type": "payment_paid", "secret_token": "whsec_wrong", "data": {}}
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.verify_webhook_signature(body, webhook_secret="whsec_correct")
        assert exc.value.status_code == 401

    def test_constant_time_comparison(self):
        """Uses hmac.compare_digest to avoid timing side-channel leaks."""
        # Smoke: just verify it doesn't raise when tokens match — implementation
        # detail (timing safety) is validated by reading the code.
        body = {"secret_token": "whsec_x"}
        moyasar_utils.verify_webhook_signature(body, webhook_secret="whsec_x")
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestWebhookSignature -v`
Expected: 4 tests FAIL on missing `verify_webhook_signature`.

- [ ] **Step 3: Implement `verify_webhook_signature`**

Append to `apps/api/ee/services/payments/utils/moyasar_utils.py`:

```python
# -- Webhook signature -----------------------------------------------------


def verify_webhook_signature(body: dict, webhook_secret: str) -> None:
    """Verify a Moyasar webhook payload.

    Moyasar webhooks include a `secret_token` field in the JSON body that the
    merchant configured in the Moyasar dashboard. We compare with constant-time
    equality and raise 401 on mismatch.

    IMPORTANT: validated against Moyasar's current webhook format. If Moyasar
    ever adds an HMAC signature header, extend this function to check both.
    """
    received = body.get("secret_token")
    if not received or not isinstance(received, str):
        raise HTTPException(status_code=401, detail="Missing webhook secret_token")
    if not hmac.compare_digest(received, webhook_secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
```

- [ ] **Step 4: Run tests — verify all pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: 12 tests PASS.

- [ ] **Step 5: Record the live-webhook validation TODO**

Add an inline comment at the top of `verify_webhook_signature` (already present via the IMPORTANT note in step 3). No separate tracking file needed — the executor closing this task must also have sent a real test webhook and confirmed payload shape before proceeding.

- [ ] **Step 6: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/utils/moyasar_utils.py apps/api/src/tests/payments/test_payments_moyasar.py
git commit -m "feat(payments): Moyasar webhook signature verification (secret_token)"
```

---

## Task 5: Utils — httpx wrapper for Moyasar API calls (TDD)

**Files:**
- Modify: `apps/api/ee/services/payments/utils/moyasar_utils.py` (append)
- Modify: `apps/api/src/tests/payments/test_payments_moyasar.py` (append test class)

- [ ] **Step 1: Write failing tests for the HTTP wrapper**

Append to `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
import respx
import httpx


MOYASAR_BASE = "https://api.moyasar.com/v1"


class TestMoyasarApiCall:
    @respx.mock
    @pytest.mark.asyncio
    async def test_returns_parsed_json_on_200(self):
        respx.post(f"{MOYASAR_BASE}/invoices").mock(
            return_value=httpx.Response(200, json={"id": "inv_1", "status": "initiated"})
        )
        result = await moyasar_utils.moyasar_request(
            method="POST",
            path="/invoices",
            secret_key="sk_test_x",
            json={"amount": 100},
        )
        assert result == {"id": "inv_1", "status": "initiated"}

    @respx.mock
    @pytest.mark.asyncio
    async def test_401_wraps_as_http_400(self):
        respx.post(f"{MOYASAR_BASE}/invoices").mock(
            return_value=httpx.Response(401, json={"message": "Unauthorized"})
        )
        with pytest.raises(HTTPException) as exc:
            await moyasar_utils.moyasar_request(
                method="POST", path="/invoices", secret_key="sk_test_x", json={}
            )
        assert exc.value.status_code == 400
        assert "Moyasar" in exc.value.detail
        assert "Unauthorized" in exc.value.detail

    @respx.mock
    @pytest.mark.asyncio
    async def test_network_error_wraps_as_http_502(self):
        respx.post(f"{MOYASAR_BASE}/invoices").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        with pytest.raises(HTTPException) as exc:
            await moyasar_utils.moyasar_request(
                method="POST", path="/invoices", secret_key="sk_test_x", json={}
            )
        assert exc.value.status_code == 502
        assert "unreachable" in exc.value.detail.lower()

    @respx.mock
    @pytest.mark.asyncio
    async def test_basic_auth_is_secret_key(self):
        route = respx.post(f"{MOYASAR_BASE}/invoices").mock(
            return_value=httpx.Response(200, json={})
        )
        await moyasar_utils.moyasar_request(
            method="POST", path="/invoices", secret_key="sk_test_mine", json={}
        )
        # Basic Auth: "sk_test_mine:" base64-encoded → "c2tfdGVzdF9taW5lOg=="
        assert route.called
        assert route.calls[0].request.headers["authorization"] == "Basic c2tfdGVzdF9taW5lOg=="

    @respx.mock
    @pytest.mark.asyncio
    async def test_idempotency_key_header_forwarded(self):
        route = respx.post(f"{MOYASAR_BASE}/invoices").mock(
            return_value=httpx.Response(200, json={})
        )
        await moyasar_utils.moyasar_request(
            method="POST",
            path="/invoices",
            secret_key="sk_test_x",
            json={},
            idempotency_key="enrollment-42-v1",
        )
        assert route.calls[0].request.headers["idempotency-key"] == "enrollment-42-v1"
```

- [ ] **Step 2: Install `pytest-asyncio` if not already present**

Run: `cd apps/api && uv run pytest --version && grep -E "pytest-asyncio|asyncio_mode" pyproject.toml`
Expected: pytest installed; if `asyncio_mode` config missing, add `asyncio_mode = "auto"` under `[tool.pytest.ini_options]` in `apps/api/pyproject.toml`.

- [ ] **Step 3: Run tests — verify they fail**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestMoyasarApiCall -v`
Expected: 5 tests FAIL on missing `moyasar_request`.

- [ ] **Step 4: Implement `moyasar_request`**

Append to `apps/api/ee/services/payments/utils/moyasar_utils.py`:

```python
# -- HTTP wrapper -----------------------------------------------------------

import httpx

MOYASAR_BASE_URL = "https://api.moyasar.com/v1"


async def moyasar_request(
    *,
    method: str,
    path: str,
    secret_key: str,
    json: dict | None = None,
    idempotency_key: str | None = None,
    timeout_seconds: float = 15.0,
) -> dict:
    """Call the Moyasar API. Wraps httpx errors as FastAPI HTTPExceptions.

    - HTTP 2xx → returns parsed JSON.
    - HTTP non-2xx → HTTPException(400, "Moyasar: <their message>").
    - Network / timeout → HTTPException(502, "Moyasar unreachable").
    """
    url = f"{MOYASAR_BASE_URL}{path}"
    headers: dict[str, str] = {}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            res = await client.request(
                method=method,
                url=url,
                json=json,
                headers=headers,
                auth=(secret_key, ""),  # Moyasar uses Basic Auth: sk as user, no password
            )
            res.raise_for_status()
            return res.json()
    except httpx.HTTPStatusError as e:
        detail = "HTTP error"
        try:
            body = e.response.json()
            detail = body.get("message") or body.get("type") or str(e)
        except Exception:  # noqa: BLE001 — Moyasar may return non-JSON on some 5xx
            pass
        logger.warning("Moyasar API error: %s", detail)
        raise HTTPException(status_code=400, detail=f"Moyasar: {detail}")
    except (httpx.RequestError, httpx.TimeoutException) as e:
        logger.error("Moyasar unreachable: %s", e)
        raise HTTPException(status_code=502, detail="Moyasar unreachable")
```

- [ ] **Step 5: Run all util tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: 17 tests PASS.

- [ ] **Step 6: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/utils/moyasar_utils.py apps/api/src/tests/payments/test_payments_moyasar.py apps/api/pyproject.toml
git commit -m "feat(payments): Moyasar HTTP wrapper with basic-auth + idempotency"
```

---

## Task 6: Provider — `_load_credentials` (TDD)

**Files:**
- Create: `apps/api/ee/services/payments/payments_moyasar.py`
- Modify: `apps/api/src/tests/payments/test_payments_moyasar.py` (append)

- [ ] **Step 1: Write failing test for credential loading**

Append to `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
from ee.db.payments.payments import PaymentProviderEnum


class TestLoadCredentials:
    def test_loads_decrypted_credentials_for_active_moyasar_config(
        self, db_session, moyasar_config, organization
    ):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider

        provider = MoyasarPaymentProvider()
        creds = provider._load_credentials(organization.id, db_session)

        assert creds["secret_key"] == "sk_test_fake"
        assert creds["webhook_secret"] == "whsec_fake"
        assert creds["publishable_key"] == "pk_test_fake"
        assert creds["mode"] == "test"

    def test_raises_404_when_no_config(self, db_session, organization):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider

        provider = MoyasarPaymentProvider()
        with pytest.raises(HTTPException) as exc:
            provider._load_credentials(organization.id, db_session)
        assert exc.value.status_code == 404

    def test_raises_400_when_config_inactive(
        self, db_session, moyasar_config, organization
    ):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider

        moyasar_config.active = False
        db_session.add(moyasar_config)
        db_session.commit()

        provider = MoyasarPaymentProvider()
        with pytest.raises(HTTPException) as exc:
            provider._load_credentials(organization.id, db_session)
        assert exc.value.status_code == 400
        assert "not active" in exc.value.detail.lower()
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestLoadCredentials -v`
Expected: 3 tests FAIL on missing `MoyasarPaymentProvider`.

- [ ] **Step 3: Create `payments_moyasar.py` with stub class and `_load_credentials`**

Create `apps/api/ee/services/payments/payments_moyasar.py`:

```python
"""
Moyasar payment provider implementation.

Mirrors payments_stripe.py in shape: one class implementing IPaymentProvider,
plus module-level thin wrappers used by the router.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, Request
from sqlmodel import Session, select

from ee.db.payments.payments import (
    PaymentProviderEnum,
    PaymentsConfig,
)
from ee.services.payments.provider_interface import IPaymentProvider
from ee.services.payments.utils import moyasar_utils
from src.db.users import AnonymousUser, APITokenUser, PublicUser

logger = logging.getLogger(__name__)


class MoyasarPaymentProvider(IPaymentProvider):
    """Moyasar implementation of the payment provider interface."""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_credentials(self, org_id: int, db_session: Session) -> dict[str, str]:
        """Load and decrypt the org's Moyasar credentials.

        Returns {"secret_key", "webhook_secret", "publishable_key", "mode"}.
        Raises 404 if no config, 400 if inactive, 500 on decryption failure.
        """
        cfg = db_session.exec(
            select(PaymentsConfig).where(
                PaymentsConfig.org_id == org_id,
                PaymentsConfig.provider == PaymentProviderEnum.MOYASAR,
            )
        ).first()
        if cfg is None:
            raise HTTPException(
                status_code=404, detail="Moyasar is not configured for this organization"
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
    # IPaymentProvider — stubs to satisfy ABC; implemented in later tasks
    # ------------------------------------------------------------------

    async def create_product(self, *args, **kwargs) -> Any:
        raise HTTPException(
            status_code=501,
            detail="Moyasar does not manage products — prices are passed per invoice",
        )

    async def update_product(self, *args, **kwargs) -> Any:
        raise HTTPException(
            status_code=501,
            detail="Moyasar does not manage products — prices are passed per invoice",
        )

    async def archive_product(self, *args, **kwargs) -> Any:
        # No-op: Moyasar has no product lifecycle. Return a minimal object with .id
        # for call-site compatibility.
        class _Noop:
            id = None
        return _Noop()

    async def create_checkout_session(
        self,
        request: Request,
        org_id: int,
        offer_id: int,
        redirect_uri: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        raise NotImplementedError("Implemented in Task 7")

    async def create_billing_portal_session(self, *args, **kwargs) -> dict[str, str]:
        raise HTTPException(
            status_code=501,
            detail="Moyasar has no billing portal. Manage payments in the Moyasar dashboard.",
        )

    async def handle_webhook(
        self, request: Request, webhook_type: str, db_session: Session
    ) -> dict[str, Any]:
        raise NotImplementedError("Implemented in Task 8")
```

- [ ] **Step 4: Run tests — verify `_load_credentials` tests pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestLoadCredentials -v`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/payments_moyasar.py apps/api/src/tests/payments/test_payments_moyasar.py
git commit -m "feat(payments): MoyasarPaymentProvider stub + _load_credentials"
```

---

## Task 7: Provider — `create_checkout_session` (TDD)

**Files:**
- Modify: `apps/api/ee/services/payments/payments_moyasar.py`
- Modify: `apps/api/src/tests/payments/test_payments_moyasar.py` (append)

**Prerequisite:** `PaymentsOffer` and `PaymentsEnrollment` models exist in `apps/api/ee/db/payments/`. Before writing the tests, verify:

Run: `grep -n "class PaymentsOffer\|class PaymentsEnrollment\|offer_type\|SUBSCRIPTION\|ONE_TIME" apps/api/ee/db/payments/*.py | head -20`

Expected: both classes found; note the exact enum values for `offer_type` (probably `PaymentsOfferTypeEnum.SUBSCRIPTION` / `ONE_TIME`).

- [ ] **Step 1: Add offer + enrollment fixtures**

Append to `apps/api/src/tests/payments/conftest.py`:

```python
# Additional fixtures for checkout tests. `PaymentsOffer` import path and enum
# values come from the verification step above — adjust if your grep showed
# a different path.
from decimal import Decimal

@pytest.fixture
def moyasar_offer_one_time(db_session, organization, moyasar_config):
    from ee.db.payments.payments_offers import PaymentsOffer, PaymentsOfferTypeEnum
    offer = PaymentsOffer(
        org_id=organization.id,
        payments_config_id=moyasar_config.id,
        provider_product_id=None,
        name="Test course",
        amount=Decimal("10.50"),
        currency="SAR",
        offer_type=PaymentsOfferTypeEnum.ONE_TIME,
        creation_date=datetime.now(),
        update_date=datetime.now(),
    )
    db_session.add(offer)
    db_session.commit()
    db_session.refresh(offer)
    return offer


@pytest.fixture
def moyasar_offer_subscription(db_session, organization, moyasar_config):
    from ee.db.payments.payments_offers import PaymentsOffer, PaymentsOfferTypeEnum
    offer = PaymentsOffer(
        org_id=organization.id,
        payments_config_id=moyasar_config.id,
        provider_product_id=None,
        name="Sub course",
        amount=Decimal("50.00"),
        currency="SAR",
        offer_type=PaymentsOfferTypeEnum.SUBSCRIPTION,
        creation_date=datetime.now(),
        update_date=datetime.now(),
    )
    db_session.add(offer)
    db_session.commit()
    db_session.refresh(offer)
    return offer
```

**If the `PaymentsOffer` shape (field names, enum class path) differs from what the grep showed, adjust this fixture to match.**

- [ ] **Step 2: Write failing tests for checkout**

Append to `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
class TestCreateCheckoutSession:
    @respx.mock
    @pytest.mark.asyncio
    async def test_happy_path_returns_checkout_url(
        self, db_session, organization, moyasar_config, moyasar_offer_one_time, mock_public_user
    ):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        route = respx.post(f"{MOYASAR_BASE}/invoices").mock(
            return_value=httpx.Response(
                200,
                json={"id": "inv_abc", "url": "https://moyasar.com/i/abc", "status": "initiated"},
            )
        )
        provider = MoyasarPaymentProvider()
        result = await provider.create_checkout_session(
            request=None,  # not used
            org_id=organization.id,
            offer_id=moyasar_offer_one_time.id,
            redirect_uri="http://localhost:3000/orgs/default/",
            current_user=mock_public_user,
            db_session=db_session,
        )
        assert result["checkout_url"] == "https://moyasar.com/i/abc"
        assert result["session_id"] == "inv_abc"
        # Payload shape
        payload = respx.calls[0].request.read().decode()
        import json as _json
        body = _json.loads(payload)
        assert body["amount"] == 1050  # 10.50 SAR → halalas
        assert body["currency"] == "SAR"
        assert body["metadata"]["org_id"] == str(organization.id)
        assert body["metadata"]["offer_id"] == str(moyasar_offer_one_time.id)
        assert "enrollment_id" in body["metadata"]
        # Idempotency header
        assert respx.calls[0].request.headers["idempotency-key"].startswith("enrollment-")

    @respx.mock
    @pytest.mark.asyncio
    async def test_subscription_offer_rejected(
        self, db_session, organization, moyasar_config, moyasar_offer_subscription, mock_public_user
    ):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        provider = MoyasarPaymentProvider()
        with pytest.raises(HTTPException) as exc:
            await provider.create_checkout_session(
                request=None,
                org_id=organization.id,
                offer_id=moyasar_offer_subscription.id,
                redirect_uri="http://localhost:3000/",
                current_user=mock_public_user,
                db_session=db_session,
            )
        assert exc.value.status_code == 400
        assert "subscription" in exc.value.detail.lower()

    @respx.mock
    @pytest.mark.asyncio
    async def test_unsupported_currency_rejected(
        self, db_session, organization, moyasar_config, moyasar_offer_one_time, mock_public_user
    ):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        moyasar_offer_one_time.currency = "GBP"
        db_session.add(moyasar_offer_one_time)
        db_session.commit()

        provider = MoyasarPaymentProvider()
        with pytest.raises(HTTPException) as exc:
            await provider.create_checkout_session(
                request=None,
                org_id=organization.id,
                offer_id=moyasar_offer_one_time.id,
                redirect_uri="http://localhost:3000/",
                current_user=mock_public_user,
                db_session=db_session,
            )
        assert exc.value.status_code == 400
        assert "GBP" in exc.value.detail

    @respx.mock
    @pytest.mark.asyncio
    async def test_moyasar_api_error_wrapped(
        self, db_session, organization, moyasar_config, moyasar_offer_one_time, mock_public_user
    ):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        respx.post(f"{MOYASAR_BASE}/invoices").mock(
            return_value=httpx.Response(401, json={"message": "Invalid API key"})
        )
        provider = MoyasarPaymentProvider()
        with pytest.raises(HTTPException) as exc:
            await provider.create_checkout_session(
                request=None,
                org_id=organization.id,
                offer_id=moyasar_offer_one_time.id,
                redirect_uri="http://localhost:3000/",
                current_user=mock_public_user,
                db_session=db_session,
            )
        assert exc.value.status_code == 400
        assert "Moyasar" in exc.value.detail
```

`mock_public_user` comes from the base `src/tests/conftest.py`. If it isn't defined there under that name, find the equivalent fixture (any `PublicUser`-shaped) with:

Run: `grep -n "@pytest.fixture" apps/api/src/tests/conftest.py | head -20` and adjust the imports accordingly.

- [ ] **Step 3: Run tests — verify they fail**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestCreateCheckoutSession -v`
Expected: 4 tests FAIL on `NotImplementedError`.

- [ ] **Step 4: Implement `create_checkout_session`**

Replace the `create_checkout_session` method body in `apps/api/ee/services/payments/payments_moyasar.py`:

```python
    async def create_checkout_session(
        self,
        request: Request,
        org_id: int,
        offer_id: int,
        redirect_uri: str,
        current_user: PublicUser | AnonymousUser | APITokenUser,
        db_session: Session,
    ) -> dict[str, str]:
        from datetime import datetime
        from ee.db.payments.payments_offers import PaymentsOffer, PaymentsOfferTypeEnum
        from ee.db.payments.payments_enrollments import (
            PaymentsEnrollment,
            PaymentsEnrollmentStatusEnum,
        )

        # Load credentials (404 / 400 / 500 on error)
        creds = self._load_credentials(org_id, db_session)

        # Load offer
        offer = db_session.exec(
            select(PaymentsOffer).where(
                PaymentsOffer.id == offer_id,
                PaymentsOffer.org_id == org_id,
            )
        ).first()
        if offer is None:
            raise HTTPException(status_code=404, detail="Offer not found")

        # Reject subscriptions (v1 scope)
        if offer.offer_type == PaymentsOfferTypeEnum.SUBSCRIPTION:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Moyasar doesn't support subscriptions in v1. "
                    "Use a one-time offer."
                ),
            )

        # Currency check
        moyasar_utils.validate_currency(offer.currency)

        # Identify user (anonymous users can't enroll at checkout time)
        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=401, detail="Authentication required")
        user_id = int(current_user.id)

        # Create PENDING enrollment
        enrollment = PaymentsEnrollment(
            org_id=org_id,
            user_id=user_id,
            offer_id=offer.id,
            status=PaymentsEnrollmentStatusEnum.PENDING,
            provider_specific_data={},
            creation_date=datetime.now(),
            update_date=datetime.now(),
        )
        db_session.add(enrollment)
        db_session.commit()
        db_session.refresh(enrollment)

        # Determine host for callback/back URLs
        base = str(request.base_url).rstrip("/") if request else redirect_uri.rstrip("/")
        callback_url = f"{base}/payments/moyasar/callback?enrollment_id={enrollment.id}"
        back_url = redirect_uri

        # Call Moyasar
        payload = {
            "amount": moyasar_utils.to_halalas(offer.amount),
            "currency": offer.currency.upper(),
            "description": f"{offer.name}"[:255],
            "callback_url": callback_url,
            "back_url": back_url,
            "metadata": {
                "enrollment_id": str(enrollment.id),
                "offer_id": str(offer.id),
                "org_id": str(org_id),
                "user_id": str(user_id),
            },
        }
        invoice = await moyasar_utils.moyasar_request(
            method="POST",
            path="/invoices",
            secret_key=creds["secret_key"],
            json=payload,
            idempotency_key=f"enrollment-{enrollment.id}-v1",
        )

        # Persist invoice ID
        enrollment.provider_specific_data = {"moyasar_invoice_id": invoice["id"]}
        enrollment.update_date = datetime.now()
        db_session.add(enrollment)
        db_session.commit()

        logger.info(
            "Moyasar checkout created: enrollment=%s invoice=%s", enrollment.id, invoice["id"]
        )
        return {"checkout_url": invoice["url"], "session_id": invoice["id"]}
```

**If the enrollment model's field names or enum path (`PaymentsEnrollmentStatusEnum.PENDING`, `PaymentsOfferTypeEnum.SUBSCRIPTION`) differ from what the file-level verification showed, adjust the imports in the method above to match.**

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestCreateCheckoutSession -v`
Expected: 4 tests PASS.

- [ ] **Step 6: Run the full unit-test module**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: all tests PASS (~21 total).

- [ ] **Step 7: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/payments_moyasar.py apps/api/src/tests/payments/test_payments_moyasar.py apps/api/src/tests/payments/conftest.py
git commit -m "feat(payments): Moyasar create_checkout_session + enrollment PENDING"
```

---

## Task 8: Provider — `handle_webhook` with idempotency (TDD)

**Files:**
- Modify: `apps/api/ee/services/payments/payments_moyasar.py`
- Modify: `apps/api/src/tests/payments/test_payments_moyasar.py` (append)

**Prerequisite:** Locate the enrollment status update helper:

Run: `grep -n "def update_enrollment_status" apps/api/ee/services/payments/payments_enrollments.py`

Expected: one function; note its exact signature. Below we assume `update_enrollment_status(enrollment_id: int, new_status: PaymentsEnrollmentStatusEnum, db_session: Session)`. Adjust the implementation call if the real signature differs.

- [ ] **Step 1: Write failing tests for webhook dispatch**

Append to `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
class TestHandleWebhook:
    @pytest.fixture
    def pending_enrollment(self, db_session, moyasar_offer_one_time, mock_public_user):
        from datetime import datetime
        from ee.db.payments.payments_enrollments import (
            PaymentsEnrollment, PaymentsEnrollmentStatusEnum,
        )
        e = PaymentsEnrollment(
            org_id=moyasar_offer_one_time.org_id,
            user_id=int(mock_public_user.id),
            offer_id=moyasar_offer_one_time.id,
            status=PaymentsEnrollmentStatusEnum.PENDING,
            provider_specific_data={"moyasar_invoice_id": "inv_abc"},
            creation_date=datetime.now(),
            update_date=datetime.now(),
        )
        db_session.add(e)
        db_session.commit()
        db_session.refresh(e)
        return e

    @pytest.fixture
    def fake_redis(self, monkeypatch):
        """Replace _get_redis_client to return an in-memory dict-backed stub."""
        store: dict[str, str] = {}

        class _StubRedis:
            def setex(self, key, ttl, val):
                store[key] = val
                return True
            def get(self, key):
                return store.get(key)
            def set(self, key, val, nx=False, ex=None):
                if nx and key in store:
                    return None
                store[key] = val
                return True

        stub = _StubRedis()
        # Patch the module-level helper wherever payments_moyasar imports it
        monkeypatch.setattr(
            "ee.services.payments.payments_moyasar._get_redis_client",
            lambda: stub,
        )
        return stub

    @pytest.mark.asyncio
    async def test_payment_paid_activates_enrollment(
        self, db_session, moyasar_config, pending_enrollment, fake_redis
    ):
        from ee.db.payments.payments_enrollments import PaymentsEnrollmentStatusEnum
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        from starlette.requests import Request as StarletteRequest
        import json as _json

        body = _json.dumps({
            "id": "evt_1",
            "type": "payment_paid",
            "secret_token": "whsec_fake",
            "data": {
                "metadata": {
                    "enrollment_id": str(pending_enrollment.id),
                    "org_id": str(pending_enrollment.org_id),
                }
            }
        }).encode()

        # Minimal request: payments_moyasar reads body via request._body
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        request = StarletteRequest({"type": "http", "method": "POST", "headers": []}, receive)
        await request.body()  # force-load body into cache

        provider = MoyasarPaymentProvider()
        result = await provider.handle_webhook(request, webhook_type="moyasar", db_session=db_session)

        assert result["status"] == "success"
        db_session.refresh(pending_enrollment)
        assert pending_enrollment.status == PaymentsEnrollmentStatusEnum.ACTIVE

    @pytest.mark.asyncio
    async def test_payment_failed_cancels_enrollment(
        self, db_session, moyasar_config, pending_enrollment, fake_redis
    ):
        from ee.db.payments.payments_enrollments import PaymentsEnrollmentStatusEnum
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        from starlette.requests import Request as StarletteRequest
        import json as _json

        body = _json.dumps({
            "id": "evt_2",
            "type": "payment_failed",
            "secret_token": "whsec_fake",
            "data": {
                "metadata": {
                    "enrollment_id": str(pending_enrollment.id),
                    "org_id": str(pending_enrollment.org_id),
                }
            }
        }).encode()
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        request = StarletteRequest({"type": "http", "method": "POST", "headers": []}, receive)
        await request.body()

        provider = MoyasarPaymentProvider()
        result = await provider.handle_webhook(request, webhook_type="moyasar", db_session=db_session)

        assert result["status"] == "success"
        db_session.refresh(pending_enrollment)
        assert pending_enrollment.status == PaymentsEnrollmentStatusEnum.CANCELLED

    @pytest.mark.asyncio
    async def test_unknown_event_type_is_ignored(
        self, db_session, moyasar_config, pending_enrollment, fake_redis
    ):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        from starlette.requests import Request as StarletteRequest
        import json as _json

        body = _json.dumps({
            "id": "evt_3",
            "type": "random_future_event",
            "secret_token": "whsec_fake",
            "data": {"metadata": {"org_id": str(moyasar_config.org_id)}}
        }).encode()
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        request = StarletteRequest({"type": "http", "method": "POST", "headers": []}, receive)
        await request.body()

        provider = MoyasarPaymentProvider()
        result = await provider.handle_webhook(request, webhook_type="moyasar", db_session=db_session)

        assert result["status"] == "ignored"

    @pytest.mark.asyncio
    async def test_duplicate_event_id_is_idempotent(
        self, db_session, moyasar_config, pending_enrollment, fake_redis
    ):
        """Second webhook call with the same event.id must not double-update."""
        from ee.db.payments.payments_enrollments import PaymentsEnrollmentStatusEnum
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        from starlette.requests import Request as StarletteRequest
        import json as _json

        body = _json.dumps({
            "id": "evt_dupe",
            "type": "payment_paid",
            "secret_token": "whsec_fake",
            "data": {
                "metadata": {
                    "enrollment_id": str(pending_enrollment.id),
                    "org_id": str(pending_enrollment.org_id),
                }
            }
        }).encode()

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        provider = MoyasarPaymentProvider()

        req1 = StarletteRequest({"type": "http", "method": "POST", "headers": []}, receive)
        await req1.body()
        await provider.handle_webhook(req1, webhook_type="moyasar", db_session=db_session)

        # Flip back to PENDING to detect accidental re-processing
        pending_enrollment.status = PaymentsEnrollmentStatusEnum.PENDING
        db_session.add(pending_enrollment)
        db_session.commit()

        req2 = StarletteRequest({"type": "http", "method": "POST", "headers": []}, receive)
        await req2.body()
        result2 = await provider.handle_webhook(req2, webhook_type="moyasar", db_session=db_session)

        assert result2["status"] == "duplicate"
        db_session.refresh(pending_enrollment)
        assert pending_enrollment.status == PaymentsEnrollmentStatusEnum.PENDING  # untouched

    @pytest.mark.asyncio
    async def test_missing_org_id_metadata_raises_400(self, db_session, moyasar_config, fake_redis):
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider
        from starlette.requests import Request as StarletteRequest
        import json as _json

        body = _json.dumps({
            "id": "evt_x",
            "type": "payment_paid",
            "secret_token": "whsec_fake",
            "data": {"metadata": {}}  # no org_id
        }).encode()
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        request = StarletteRequest({"type": "http", "method": "POST", "headers": []}, receive)
        await request.body()

        provider = MoyasarPaymentProvider()
        with pytest.raises(HTTPException) as exc:
            await provider.handle_webhook(request, webhook_type="moyasar", db_session=db_session)
        assert exc.value.status_code == 400
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestHandleWebhook -v`
Expected: 5 tests FAIL on `NotImplementedError`.

- [ ] **Step 3: Implement `handle_webhook`**

Replace the `handle_webhook` method body in `apps/api/ee/services/payments/payments_moyasar.py`, and add a Redis helper:

```python
# Near the top of the file, after the logger:
def _get_redis_client():
    """Return a Redis client, or None if unavailable. Indirection lets tests patch it."""
    try:
        from src.services.orgs.cache import _get_redis_client as get_client
        return get_client()
    except Exception:  # noqa: BLE001
        return None
```

Then the method:

```python
    async def handle_webhook(
        self, request: Request, webhook_type: str, db_session: Session
    ) -> dict[str, Any]:
        import json
        from ee.db.payments.payments_enrollments import PaymentsEnrollmentStatusEnum
        from ee.services.payments.payments_enrollments import update_enrollment_status

        raw = await request.body()
        try:
            event = json.loads(raw.decode())
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        event_id = event.get("id") or "unknown"
        event_type = event.get("type") or ""
        data = event.get("data") or {}
        metadata = (data.get("metadata") or event.get("metadata") or {})

        # Org resolution — needed to fetch this org's webhook secret
        org_id_raw = metadata.get("org_id")
        if not org_id_raw:
            raise HTTPException(status_code=400, detail="Missing org_id in metadata")
        try:
            org_id = int(org_id_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid org_id in metadata")

        # Load credentials for this org; verify signature (secret_token in body)
        creds = self._load_credentials(org_id, db_session)
        moyasar_utils.verify_webhook_signature(event, webhook_secret=creds["webhook_secret"])

        # Idempotency: 48h TTL, best-effort via Redis
        redis = _get_redis_client()
        if redis is not None:
            cache_key = f"moyasar_evt:{event_id}"
            try:
                stored = redis.set(cache_key, "1", nx=True, ex=48 * 3600)
                if not stored:  # already processed
                    logger.info("Duplicate Moyasar webhook %s — skipping", event_id[:8])
                    return {"status": "duplicate"}
            except Exception as e:  # noqa: BLE001 — Redis failure must not block webhook
                logger.warning("Redis idempotency check failed: %s", e)

        # Dispatch
        if event_type in {"payment_paid", "invoice_paid"}:
            enrollment_id = int(metadata.get("enrollment_id", 0))
            if not enrollment_id:
                raise HTTPException(status_code=400, detail="Missing enrollment_id")
            update_enrollment_status(
                enrollment_id, PaymentsEnrollmentStatusEnum.ACTIVE, db_session
            )
            logger.info("Enrollment %s activated via Moyasar webhook", enrollment_id)
            return {"status": "success"}

        if event_type in {"payment_failed", "invoice_canceled"}:
            enrollment_id = int(metadata.get("enrollment_id", 0))
            if enrollment_id:
                update_enrollment_status(
                    enrollment_id, PaymentsEnrollmentStatusEnum.CANCELLED, db_session
                )
            logger.info("Enrollment %s cancelled via Moyasar webhook", enrollment_id)
            return {"status": "success"}

        logger.info("Unhandled Moyasar event type: %s", event_type)
        return {"status": "ignored"}
```

**Before running: verify the import path + signature of `update_enrollment_status` matches the prerequisite grep result. Adjust the import and call if different.**

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestHandleWebhook -v`
Expected: 5 tests PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py -v`
Expected: all ~26 unit tests PASS.

- [ ] **Step 6: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/payments_moyasar.py apps/api/src/tests/payments/test_payments_moyasar.py
git commit -m "feat(payments): Moyasar webhook dispatch + Redis idempotency"
```

---

## Task 9: Wire into provider registry + webhooks dispatcher

**Files:**
- Modify: `apps/api/ee/services/payments/provider_registry.py`
- Modify: `apps/api/ee/services/payments/webhooks/payments_webhooks.py`
- Modify: `apps/api/src/tests/payments/test_payments_moyasar.py` (append)

- [ ] **Step 1: Write failing test for registry wiring**

Append to `apps/api/src/tests/payments/test_payments_moyasar.py`:

```python
class TestRegistry:
    def test_get_provider_moyasar_returns_moyasar_instance(self):
        from ee.db.payments.payments import PaymentProviderEnum
        from ee.services.payments.provider_registry import get_provider
        from ee.services.payments.payments_moyasar import MoyasarPaymentProvider

        provider = get_provider(PaymentProviderEnum.MOYASAR)
        assert isinstance(provider, MoyasarPaymentProvider)

    def test_get_provider_moyasar_is_cached(self):
        from ee.db.payments.payments import PaymentProviderEnum
        from ee.services.payments.provider_registry import get_provider

        p1 = get_provider(PaymentProviderEnum.MOYASAR)
        p2 = get_provider(PaymentProviderEnum.MOYASAR)
        assert p1 is p2
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestRegistry -v`
Expected: 2 tests FAIL with `ValueError: Unsupported payment provider`.

- [ ] **Step 3: Add registry branch**

Modify `apps/api/ee/services/payments/provider_registry.py`:

```python
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
    raise ValueError(f"Unsupported payment provider: {provider!r}")
```

- [ ] **Step 4: Add webhook dispatcher branch**

Look at the existing dispatcher first:

Run: `cat apps/api/ee/services/payments/webhooks/payments_webhooks.py`

Then modify the dispatcher to add a `handle_moyasar_webhook` branch that calls `get_provider(PaymentProviderEnum.MOYASAR).handle_webhook(request, "moyasar", db_session)`. The exact edit depends on the current file — follow the `handle_stripe_webhook` pattern already there.

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar.py::TestRegistry -v`
Expected: 2 tests PASS.

- [ ] **Step 6: Commit** *(ask user before running)*

```bash
git add apps/api/ee/services/payments/provider_registry.py apps/api/ee/services/payments/webhooks/payments_webhooks.py apps/api/src/tests/payments/test_payments_moyasar.py
git commit -m "feat(payments): register MoyasarPaymentProvider in factory + webhooks dispatch"
```

---

## Task 10: Router — `POST /{org_id}/moyasar/connect/verify` (integration TDD)

**Files:**
- Modify: `apps/api/ee/routers/payments.py`
- Create: `apps/api/src/tests/payments/test_payments_moyasar_router.py`

- [ ] **Step 1: Write failing router test**

Create `apps/api/src/tests/payments/test_payments_moyasar_router.py`:

```python
"""Integration tests for Moyasar routes. FastAPI TestClient + respx for outbound HTTP."""
import json

import httpx
import pytest
import respx
from fastapi import status

MOYASAR_BASE = "https://api.moyasar.com/v1"


class TestConnectVerifyRoute:
    @respx.mock
    def test_valid_keys_creates_active_config(
        self, async_client, organization, admin_user, admin_auth_headers, db_session
    ):
        respx.get(f"{MOYASAR_BASE}/invoices", params={"limit": "1"}).mock(
            return_value=httpx.Response(200, json={"invoices": []})
        )
        res = async_client.post(
            f"/api/v1/payments/{organization.id}/moyasar/connect/verify",
            headers=admin_auth_headers,
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
        # Confirm DB
        from ee.db.payments.payments import PaymentProviderEnum, PaymentsConfig
        from sqlmodel import select
        cfg = db_session.exec(
            select(PaymentsConfig).where(
                PaymentsConfig.org_id == organization.id,
                PaymentsConfig.provider == PaymentProviderEnum.MOYASAR,
            )
        ).first()
        assert cfg is not None and cfg.active

    @respx.mock
    def test_invalid_keys_returns_400(
        self, async_client, organization, admin_auth_headers
    ):
        respx.get(f"{MOYASAR_BASE}/invoices", params={"limit": "1"}).mock(
            return_value=httpx.Response(401, json={"message": "Invalid key"})
        )
        res = async_client.post(
            f"/api/v1/payments/{organization.id}/moyasar/connect/verify",
            headers=admin_auth_headers,
            json={
                "publishable_key": "pk_test_x",
                "secret_key": "sk_test_bad",
                "webhook_secret": "whsec_x",
            },
        )
        assert res.status_code == 400
        assert "Invalid" in res.json()["detail"] or "Moyasar" in res.json()["detail"]

    def test_non_admin_returns_403(
        self, async_client, organization, student_user, student_auth_headers
    ):
        res = async_client.post(
            f"/api/v1/payments/{organization.id}/moyasar/connect/verify",
            headers=student_auth_headers,
            json={
                "publishable_key": "pk_test_x",
                "secret_key": "sk_test_x",
                "webhook_secret": "whsec_x",
            },
        )
        assert res.status_code in (401, 403)
```

`async_client`, `admin_user`, `admin_auth_headers`, `student_user`, `student_auth_headers` come from the base `src/tests/conftest.py`. Verify their exact names before running:

Run: `grep -n "@pytest.fixture" apps/api/src/tests/conftest.py | head -30`
If names differ, adjust the test.

- [ ] **Step 2: Run test — verify it fails**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar_router.py::TestConnectVerifyRoute -v`
Expected: tests FAIL with 404 (route not registered).

- [ ] **Step 3: Add route**

Append to `apps/api/ee/routers/payments.py` (after the existing Stripe connect routes — look for the Stripe connect router section):

```python
# -- Moyasar -------------------------------------------------------------------

from pydantic import BaseModel
from ee.db.payments.payments import PaymentProviderEnum, PaymentsConfig, PaymentsModeEnum
from ee.services.payments.utils import moyasar_utils
import httpx


class MoyasarConnectVerifyRequest(BaseModel):
    publishable_key: str
    secret_key: str
    webhook_secret: str


@router.post(
    "/{org_id}/moyasar/connect/verify",
    summary="Verify Moyasar keys and persist encrypted provider_config",
)
async def api_verify_moyasar_connection(
    request: Request,
    org_id: int,
    body: MoyasarConnectVerifyRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Ping Moyasar to validate secret key
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                f"{moyasar_utils.MOYASAR_BASE_URL}/invoices",
                params={"limit": "1"},
                auth=(body.secret_key, ""),
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
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach Moyasar")

    mode = "test" if body.secret_key.startswith("sk_test_") else "live"

    provider_config = {
        "enc_secret_key": moyasar_utils.encrypt_secret(body.secret_key),
        "enc_webhook_secret": moyasar_utils.encrypt_secret(body.webhook_secret),
        "publishable_key": body.publishable_key,
        "mode": mode,
    }

    # Upsert PaymentsConfig
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
            creation_date=datetime.now(),
            update_date=datetime.now(),
        )
        db_session.add(cfg)
    db_session.commit()

    return {"active": True, "mode": mode}
```

Add missing imports to `payments.py` at the top if not present: `from pydantic import BaseModel`, `from datetime import datetime`, and the Moyasar-related imports shown inline above.

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar_router.py::TestConnectVerifyRoute -v`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit** *(ask user before running)*

```bash
git add apps/api/ee/routers/payments.py apps/api/src/tests/payments/test_payments_moyasar_router.py
git commit -m "feat(payments): POST /{org_id}/moyasar/connect/verify"
```

---

## Task 11: Router — `POST /payments/moyasar/webhook` (integration TDD)

**Files:**
- Modify: `apps/api/ee/routers/payments.py`
- Modify: `apps/api/src/tests/payments/test_payments_moyasar_router.py` (append)

- [ ] **Step 1: Write failing router test**

Append to `apps/api/src/tests/payments/test_payments_moyasar_router.py`:

```python
class TestWebhookRoute:
    def test_valid_paid_event_activates_enrollment(
        self, async_client, db_session, moyasar_config, moyasar_offer_one_time, mock_public_user
    ):
        from datetime import datetime
        from ee.db.payments.payments_enrollments import (
            PaymentsEnrollment, PaymentsEnrollmentStatusEnum,
        )
        e = PaymentsEnrollment(
            org_id=moyasar_config.org_id,
            user_id=int(mock_public_user.id),
            offer_id=moyasar_offer_one_time.id,
            status=PaymentsEnrollmentStatusEnum.PENDING,
            provider_specific_data={"moyasar_invoice_id": "inv_x"},
            creation_date=datetime.now(),
            update_date=datetime.now(),
        )
        db_session.add(e)
        db_session.commit()
        db_session.refresh(e)

        res = async_client.post(
            "/api/v1/payments/moyasar/webhook",
            json={
                "id": "evt_paid_1",
                "type": "payment_paid",
                "secret_token": "whsec_fake",
                "data": {"metadata": {
                    "enrollment_id": str(e.id),
                    "org_id": str(moyasar_config.org_id),
                }},
            },
        )
        assert res.status_code == 200
        db_session.refresh(e)
        assert e.status == PaymentsEnrollmentStatusEnum.ACTIVE

    def test_bad_signature_returns_401(
        self, async_client, moyasar_config
    ):
        res = async_client.post(
            "/api/v1/payments/moyasar/webhook",
            json={
                "id": "evt_bad",
                "type": "payment_paid",
                "secret_token": "whsec_wrong",
                "data": {"metadata": {"org_id": str(moyasar_config.org_id)}},
            },
        )
        assert res.status_code == 401
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar_router.py::TestWebhookRoute -v`
Expected: FAIL with 404.

- [ ] **Step 3: Add webhook route**

Append to `apps/api/ee/routers/payments.py`:

```python
@router.post(
    "/moyasar/webhook",
    summary="Moyasar webhook endpoint (org identified via metadata.org_id)",
)
async def api_handle_moyasar_webhook(
    request: Request,
    db_session: Session = Depends(get_db_session),
):
    from ee.services.payments.provider_registry import get_provider
    provider = get_provider(PaymentProviderEnum.MOYASAR)
    return await provider.handle_webhook(request, webhook_type="moyasar", db_session=db_session)
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar_router.py::TestWebhookRoute -v`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit** *(ask user before running)*

```bash
git add apps/api/ee/routers/payments.py apps/api/src/tests/payments/test_payments_moyasar_router.py
git commit -m "feat(payments): POST /payments/moyasar/webhook"
```

---

## Task 12: Router — `GET /payments/enrollments/{id}/status` with reconciliation (integration TDD)

**Files:**
- Modify: `apps/api/ee/routers/payments.py`
- Modify: `apps/api/src/tests/payments/test_payments_moyasar_router.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `apps/api/src/tests/payments/test_payments_moyasar_router.py`:

```python
class TestEnrollmentStatusRoute:
    @respx.mock
    def test_pending_enrollment_reconciles_from_moyasar(
        self, async_client, db_session, moyasar_config, moyasar_offer_one_time,
        mock_public_user, user_auth_headers
    ):
        """When Moyasar says the invoice is paid but webhook never came, reconcile."""
        from datetime import datetime
        from ee.db.payments.payments_enrollments import (
            PaymentsEnrollment, PaymentsEnrollmentStatusEnum,
        )
        e = PaymentsEnrollment(
            org_id=moyasar_config.org_id,
            user_id=int(mock_public_user.id),
            offer_id=moyasar_offer_one_time.id,
            status=PaymentsEnrollmentStatusEnum.PENDING,
            provider_specific_data={"moyasar_invoice_id": "inv_pay_me"},
            creation_date=datetime.now(),
            update_date=datetime.now(),
        )
        db_session.add(e)
        db_session.commit()
        db_session.refresh(e)

        respx.get(f"{MOYASAR_BASE}/invoices/inv_pay_me").mock(
            return_value=httpx.Response(200, json={"id": "inv_pay_me", "status": "paid"})
        )

        res = async_client.get(
            f"/api/v1/payments/enrollments/{e.id}/status",
            headers=user_auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "ACTIVE"
        db_session.refresh(e)
        assert e.status == PaymentsEnrollmentStatusEnum.ACTIVE

    def test_active_enrollment_returns_directly_without_api_call(
        self, async_client, db_session, moyasar_config, moyasar_offer_one_time,
        mock_public_user, user_auth_headers
    ):
        from datetime import datetime
        from ee.db.payments.payments_enrollments import (
            PaymentsEnrollment, PaymentsEnrollmentStatusEnum,
        )
        e = PaymentsEnrollment(
            org_id=moyasar_config.org_id,
            user_id=int(mock_public_user.id),
            offer_id=moyasar_offer_one_time.id,
            status=PaymentsEnrollmentStatusEnum.ACTIVE,
            provider_specific_data={"moyasar_invoice_id": "inv_x"},
            creation_date=datetime.now(),
            update_date=datetime.now(),
        )
        db_session.add(e)
        db_session.commit()
        db_session.refresh(e)

        # No respx mock — any call to Moyasar would fail
        res = async_client.get(
            f"/api/v1/payments/enrollments/{e.id}/status",
            headers=user_auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "ACTIVE"
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar_router.py::TestEnrollmentStatusRoute -v`
Expected: FAIL with 404.

- [ ] **Step 3: Add route**

Append to `apps/api/ee/routers/payments.py`:

```python
@router.get(
    "/enrollments/{enrollment_id}/status",
    summary="Get current enrollment status. For PENDING Moyasar enrollments, reconciles with Moyasar.",
)
async def api_get_enrollment_status(
    request: Request,
    enrollment_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    from ee.db.payments.payments_enrollments import (
        PaymentsEnrollment, PaymentsEnrollmentStatusEnum,
    )
    from ee.services.payments.payments_enrollments import update_enrollment_status
    from ee.services.payments.payments_moyasar import MoyasarPaymentProvider, _get_redis_client

    e = db_session.exec(
        select(PaymentsEnrollment).where(PaymentsEnrollment.id == enrollment_id)
    ).first()
    if e is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    if int(current_user.id) != e.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    # Reconcile only if PENDING and has a moyasar_invoice_id
    invoice_id = (e.provider_specific_data or {}).get("moyasar_invoice_id")
    if e.status == PaymentsEnrollmentStatusEnum.PENDING and invoice_id:
        # Rate-limit reconciliation to 1/5s per enrollment
        redis = _get_redis_client()
        can_reconcile = True
        if redis is not None:
            try:
                acquired = redis.set(
                    f"moyasar_reconcile:{enrollment_id}", "1", nx=True, ex=5
                )
                can_reconcile = bool(acquired)
            except Exception:
                can_reconcile = True  # fail open; Moyasar unreachable will produce a 502 below

        if can_reconcile:
            provider = MoyasarPaymentProvider()
            creds = provider._load_credentials(e.org_id, db_session)
            inv = await moyasar_utils.moyasar_request(
                method="GET",
                path=f"/invoices/{invoice_id}",
                secret_key=creds["secret_key"],
            )
            if inv.get("status") == "paid":
                update_enrollment_status(
                    e.id, PaymentsEnrollmentStatusEnum.ACTIVE, db_session
                )
                db_session.refresh(e)
            elif inv.get("status") in {"failed", "canceled"}:
                update_enrollment_status(
                    e.id, PaymentsEnrollmentStatusEnum.CANCELLED, db_session
                )
                db_session.refresh(e)

    return {"status": e.status.name if hasattr(e.status, "name") else str(e.status)}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd apps/api && uv run pytest src/tests/payments/test_payments_moyasar_router.py::TestEnrollmentStatusRoute -v`
Expected: 2 tests PASS.

- [ ] **Step 5: Run all API tests in the payments module**

Run: `cd apps/api && uv run pytest src/tests/payments/ -v`
Expected: all tests PASS (~33).

- [ ] **Step 6: Commit** *(ask user before running)*

```bash
git add apps/api/ee/routers/payments.py apps/api/src/tests/payments/test_payments_moyasar_router.py
git commit -m "feat(payments): GET /payments/enrollments/{id}/status with Moyasar reconciliation"
```

---

## Task 13: Web — client service helpers

**Files:**
- Create: `apps/web/services/payments/providers/moyasar.ts`

- [ ] **Step 1: Copy the Stripe pattern**

Look at the existing file for shape:

Run: `cat apps/web/services/payments/providers/stripe.ts | head -60`

- [ ] **Step 2: Create `moyasar.ts`**

Create `apps/web/services/payments/providers/moyasar.ts`:

```typescript
import { getAPIUrl } from '@services/config/config'
import { errorHandling, getResponseMetadata, RequestBody } from '@services/utils/ts/requests'

export type MoyasarConnectVerifyBody = {
  publishable_key: string
  secret_key: string
  webhook_secret: string
}

export async function verifyMoyasarKeys(
  orgId: number,
  body: MoyasarConnectVerifyBody,
  accessToken: string,
) {
  const res = await fetch(
    `${getAPIUrl()}payments/${orgId}/moyasar/connect/verify`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
  )
  await errorHandling(res)
  return getResponseMetadata(res)
}

export async function getEnrollmentStatus(
  enrollmentId: number,
  accessToken: string,
): Promise<{ status: string }> {
  const res = await fetch(
    `${getAPIUrl()}payments/enrollments/${enrollmentId}/status`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
  await errorHandling(res)
  return await res.json()
}
```

**Before running:** verify `errorHandling` and `getResponseMetadata` are the actual exports from `@services/utils/ts/requests`:

Run: `grep -n "export" apps/web/services/utils/ts/requests.ts | head -10`

If the helpers are named differently, adjust imports to match.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bun run tsc --noEmit 2>&1 | grep -i "moyasar" | head -20`
Expected: no errors.

- [ ] **Step 4: Commit** *(ask user before running)*

```bash
git add apps/web/services/payments/providers/moyasar.ts
git commit -m "feat(web): Moyasar client service wrappers"
```

---

## Task 14: Web — `MoyasarKeysModal` component

**Files:**
- Create: `apps/web/components/Dashboard/Pages/Payments/MoyasarKeysModal.tsx`

- [ ] **Step 1: Inspect existing modal patterns for style consistency**

Run: `find apps/web/components/Objects/Modals -name "*.tsx" -not -path "*/node_modules/*" | head -5`

Read one (e.g. the first result) to match the surrounding style (icons, class conventions).

- [ ] **Step 2: Create the modal**

Create `apps/web/components/Dashboard/Pages/Payments/MoyasarKeysModal.tsx`:

```tsx
'use client'
import React, { useState } from 'react'
import { Copy, Check, Loader2, X, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { verifyMoyasarKeys } from '@services/payments/providers/moyasar'
import { useLHSession } from '@components/Contexts/LHSessionContext'

type MoyasarKeysModalProps = {
  orgId: number
  webhookUrl: string
  onSuccess: () => void
  onClose: () => void
}

export default function MoyasarKeysModal({
  orgId,
  webhookUrl,
  onSuccess,
  onClose,
}: MoyasarKeysModalProps) {
  const session = useLHSession() as any
  const [pub, setPub] = useState('')
  const [sec, setSec] = useState('')
  const [wh, setWh] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const copyWebhookUrl = async () => {
    await navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await verifyMoyasarKeys(
        orgId,
        { publishable_key: pub, secret_key: sec, webhook_secret: wh },
        session?.data?.tokens?.access_token,
      )
      toast.success('Moyasar connected')
      onSuccess()
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Connect Moyasar</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle size={18} className="shrink-0 text-yellow-700" />
            <div className="text-sm text-yellow-900">
              Before clicking Verify, set this webhook URL in Moyasar → Developers → Webhooks,
              otherwise enrollments won't auto-activate.
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Webhook URL</label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={webhookUrl}
                className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-xs font-mono truncate"
              />
              <button
                type="button"
                onClick={copyWebhookUrl}
                className="px-3 py-2 bg-gray-900 text-white rounded-lg text-xs hover:bg-gray-700"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Publishable key</label>
            <input
              type="text"
              required
              value={pub}
              onChange={(e) => setPub(e.target.value)}
              placeholder="pk_test_..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Secret key</label>
            <input
              type="password"
              required
              value={sec}
              onChange={(e) => setSec(e.target.value)}
              placeholder="sk_test_..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Webhook secret</label>
            <input
              type="password"
              required
              value={wh}
              onChange={(e) => setWh(e.target.value)}
              placeholder="Webhook secret from Moyasar"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Verify & Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bun run tsc --noEmit 2>&1 | grep -iE "moyasarkeys|MoyasarKeysModal" | head -10`
Expected: no errors.

- [ ] **Step 4: Commit** *(ask user before running)*

```bash
git add apps/web/components/Dashboard/Pages/Payments/MoyasarKeysModal.tsx
git commit -m "feat(web): MoyasarKeysModal component"
```

---

## Task 15: Web — integrate Moyasar into `PaymentsConfigurationPage`

**Files:**
- Modify: `apps/web/components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx`

- [ ] **Step 1: Inspect current file**

Run: `cat apps/web/components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx`

Locate the `PAYMENT_PROVIDERS` array and the function that handles "Connect" clicks.

- [ ] **Step 2: Modify `PAYMENT_PROVIDERS` + add key-mode branch**

Edit `apps/web/components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx`:

1. Import: `import MoyasarKeysModal from './MoyasarKeysModal'`.
2. Add Moyasar to the providers array (schema varies by current file — preserve existing keys, add a new entry):

```tsx
{
  id: 'moyasar',
  name: 'Moyasar',
  description: 'Accept payments from Saudi cards, mada, Apple Pay, STC Pay, and SADAD.',
  connectMode: 'keys',
  icon: '/payment-providers/moyasar.svg',  // add a placeholder SVG if missing
}
```

3. Where the current click handler redirects to `getConnectUrl()` for Stripe, add a branch:

```tsx
if (provider.connectMode === 'keys' && provider.id === 'moyasar') {
  setShowMoyasarModal(true)
  return
}
```

4. Render the modal when state is true, passing `webhookUrl={`${apiOrigin}/api/v1/payments/moyasar/webhook`}`.

**Exact placement depends on the current file structure — keep the edit minimal and scoped; do not refactor unrelated code.**

- [ ] **Step 3: Typecheck + manual smoke**

Run: `cd apps/web && bun run tsc --noEmit`
Expected: no new errors.

Then: boot dev if not already running, visit `/orgs/default/dash/payments/configuration`, click **Connect Moyasar** — modal appears with the webhook URL, fields, and the warning banner.

- [ ] **Step 4: Commit** *(ask user before running)*

```bash
git add apps/web/components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx
git commit -m "feat(web): wire Moyasar provider into PaymentsConfigurationPage"
```

---

## Task 16: Web — callback page with polling

**Files:**
- Create: `apps/web/app/payments/moyasar/callback/page.tsx`

- [ ] **Step 1: Create the callback page**

Create `apps/web/app/payments/moyasar/callback/page.tsx`:

```tsx
'use client'
import React, { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle, Loader2, AlertTriangle } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getEnrollmentStatus } from '@services/payments/providers/moyasar'

function MoyasarCallbackInner() {
  const search = useSearchParams()
  const router = useRouter()
  const session = useLHSession() as any
  const enrollmentId = Number(search.get('enrollment_id') || '0')
  const [status, setStatus] = useState<'polling' | 'success' | 'failed' | 'timeout'>('polling')

  useEffect(() => {
    if (!enrollmentId || !session?.data?.tokens?.access_token) return
    let attempts = 0
    const MAX = 7  // ~10.5 s total at 1.5 s intervals
    const timer = setInterval(async () => {
      attempts += 1
      try {
        const res = await getEnrollmentStatus(enrollmentId, session.data.tokens.access_token)
        if (res.status === 'ACTIVE') {
          setStatus('success')
          clearInterval(timer)
          setTimeout(() => router.push('/'), 1500)
          return
        }
        if (res.status === 'CANCELLED' || res.status === 'FAILED') {
          setStatus('failed')
          clearInterval(timer)
          return
        }
        if (attempts >= MAX) {
          setStatus('timeout')
          clearInterval(timer)
        }
      } catch {
        if (attempts >= MAX) {
          setStatus('timeout')
          clearInterval(timer)
        }
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [enrollmentId, session?.data?.tokens?.access_token, router])

  return (
    <div className="h-screen flex items-center justify-center bg-[#f8f8f8]">
      <div className="text-center">
        {status === 'polling' && (
          <>
            <Loader2 size={36} className="mx-auto animate-spin text-gray-600 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Confirming your payment…</h1>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={36} className="mx-auto text-green-600 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">You're enrolled!</h1>
          </>
        )}
        {status === 'failed' && (
          <>
            <AlertTriangle size={36} className="mx-auto text-red-600 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Payment was not completed</h1>
            <p className="text-sm text-gray-500 mt-1">Please try again.</p>
          </>
        )}
        {status === 'timeout' && (
          <>
            <Loader2 size={36} className="mx-auto animate-spin text-gray-600 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Still confirming…</h1>
            <p className="text-sm text-gray-500 mt-1">
              Refresh this page in a moment or check your enrollment in the dashboard.
            </p>
            <button
              onClick={() => location.reload()}
              className="mt-4 px-4 py-2 bg-black text-white rounded-lg text-sm"
            >
              Refresh
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function MoyasarCallback() {
  return (
    <Suspense fallback={<div />}>
      <MoyasarCallbackInner />
    </Suspense>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bun run tsc --noEmit 2>&1 | grep -iE "moyasar/callback" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit** *(ask user before running)*

```bash
git add apps/web/app/payments/moyasar/callback/page.tsx
git commit -m "feat(web): Moyasar post-payment callback page with polling"
```

---

## Task 17: End-to-end smoke test (manual)

**Goal:** Verify the happy path against Moyasar's test environment, and confirm the `secret_token` webhook assumption from Task 4.

- [ ] **Step 1: Set up a Moyasar test merchant**

In Moyasar dashboard (test mode):
- Settings → API Keys: copy `pk_test_*` and `sk_test_*`.
- Developers → Webhooks → Create: URL = `http://localhost:1338/api/v1/payments/moyasar/webhook` (or your ngrok/Cloudflare tunnel if dev is not exposed). Set a webhook secret, copy it.

- [ ] **Step 2: Connect via the UI**

In LearnHouse dev → `/orgs/default/dash/payments/configuration` → **Connect Moyasar** → paste the three keys → **Verify & Save**.

Expected:
- Toast: "Moyasar connected".
- DB row:
  ```sql
  select org_id, provider, active, provider_config ->> 'mode' from paymentsconfig where provider = 'moyasar';
  ```
  returns one row, `active=true`, `mode='test'`.

- [ ] **Step 3: Create a test one-time offer**

Either via the existing offers UI or SQL. Minimal fields: `org_id`, `payments_config_id` → the Moyasar config row, `name="Test"`, `amount=1.00`, `currency="SAR"`, `offer_type="ONE_TIME"`.

- [ ] **Step 4: Run a test checkout**

From a student account, enroll on the offer → redirected to Moyasar hosted page → pay with Moyasar's test card (`4111 1111 1111 1111`, any future expiry, any CVC).

- [ ] **Step 5: Confirm webhook fired + enrollment activated**

Watch `[api]` logs for `Enrollment … activated via Moyasar webhook`. Check DB:

```sql
select id, status, provider_specific_data from paymentsenrollment order by id desc limit 5;
```

Expected: most recent row is `ACTIVE`, `provider_specific_data.moyasar_invoice_id` set.

- [ ] **Step 6: Verify webhook payload format matches `verify_webhook_signature` assumption**

In the `[api]` logs from step 5, grep for the raw webhook body (temporarily add `logger.info("Raw: %s", raw)` in `handle_webhook` if needed; remove after verification). Confirm the body contains a top-level `secret_token` field equal to the webhook secret you entered.

If Moyasar's actual payload differs (e.g. uses `X-Moyasar-Signature` HMAC header), update `verify_webhook_signature` in `moyasar_utils.py` and re-run Task 4 unit tests.

- [ ] **Step 7: Reconciliation fallback**

Deliberately break the webhook (e.g. temporarily block the endpoint in Moyasar) and do another checkout. Poll the callback page — reconciliation should still activate the enrollment within ~5 s via the `GET /invoices/{id}` fallback.

- [ ] **Step 8: Note any drift**

If any test behavior diverges from the spec or plan, record it in a brief note under the design spec so future work has the ground truth.

- [ ] **Step 9: Commit any last fixes** *(ask user before running)*

```bash
git add apps/api apps/web
git commit -m "fix(payments): adjustments after end-to-end Moyasar smoke test"
```

---

## Self-review notes

**Coverage vs spec:**
- §1 architecture → Tasks 1, 9 (registry, webhooks), 10/11/12 (routes)
- §2 connection flow + Fernet encryption → Tasks 2, 10
- §3 checkout → Tasks 3, 6, 7
- §3a currency rule → Task 3
- §3b reconciliation fallback → Task 12
- §3c webhook dispatch + signature + idempotency → Tasks 4, 8, 11
- §4 error handling & logging → covered inside each provider/router task (HTTPException, `logger = getLogger(__name__)`)
- §5 testing → Tasks 2/3/4/5/6/7/8/9 (unit), 10/11/12 (integration), 17 (manual)
- Web layout (§1) → Tasks 13, 14, 15, 16

**Type consistency check:**
- `MoyasarPaymentProvider._load_credentials` returns `dict` with keys `secret_key`, `webhook_secret`, `publishable_key`, `mode` — referenced identically in Tasks 7, 8, 12.
- `moyasar_utils.moyasar_request(method=, path=, secret_key=, json=, idempotency_key=)` — referenced identically in Tasks 5, 7, 12.
- `PaymentProviderEnum.MOYASAR` — Tasks 1, 6, 9, 10, 11.
- `PaymentsEnrollmentStatusEnum.PENDING / ACTIVE / CANCELLED` — Tasks 7, 8, 12. **Verify this enum's exact variant names against `apps/api/ee/db/payments/payments_enrollments.py` before running those tasks** (see Task 7 prerequisite grep).

**Open risks:**
- **Moyasar's webhook payload shape** — the whole signature-verification path assumes `secret_token` is in the body. Task 4 documents this explicitly; Task 17 validates against real traffic. If Moyasar changed or the initial research was wrong, Task 4 and relevant tests get updated — a contained blast radius.
- **`update_enrollment_status` signature** — the plan assumes `(enrollment_id, status, db_session)`. Task 8 prerequisite grep verifies it before implementing.
- **Web test coverage** — none. Manual QA in Task 17 is the only web-level check. Accepted per spec §5.
