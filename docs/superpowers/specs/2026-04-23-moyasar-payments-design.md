# Moyasar Payment Gateway Integration — Design Spec

**Date:** 2026-04-23
**Branch:** `feat/payments-moyasar`
**Status:** Approved for implementation

## Goal

Allow a school (Organization) to connect a **Moyasar** merchant account and accept one-time payments for `PaymentsOffer` enrollments, alongside the existing Stripe integration. Saudi schools want a local payment gateway that supports mada, cards, Apple Pay, STC Pay, and SADAD.

## Scope — v1

**In:** one-time payments, hosted Moyasar Invoice redirect flow, webhook-driven enrollment activation, per-school API keys, unit + integration tests.

**Out (explicit non-goals for v1):**
- Subscriptions / recurring billing (Moyasar has no native subscription object; would require a separate scheduler + dunning engine).
- Embedded card form (`Moyasar.js`) — hosted redirect only.
- Admin dashboard metrics (MRR, charges list, etc.) — the Stripe dashboard endpoints have no Moyasar-native equivalents yet.
- Automatic webhook registration in the Moyasar dashboard — schools paste the webhook URL manually.
- Webhook health indicator in the config UI.

---

## §1 — Architecture & file layout

Moyasar is a **drop-in implementation** of the existing `IPaymentProvider` interface (`ee/services/payments/provider_interface.py`). The registry gets one new branch. Generic checkout/config/enrollment code already routes by `PaymentsConfig.provider`, so once that row has `provider="moyasar"`, the rest of the system routes correctly — no shared-code refactor.

### New files (API, EE-gated)

```
apps/api/ee/services/payments/
  payments_moyasar.py              # MoyasarPaymentProvider + module-level shims
  utils/moyasar_utils.py           # Fernet encryption, signature verification, halalas conversion
apps/api/src/tests/payments/
  __init__.py
  conftest.py                      # local fixtures
  test_payments_moyasar.py         # unit tests (no network)
  test_payments_moyasar_router.py  # integration via FastAPI TestClient
```

### Modified files (API)

- `ee/db/payments/payments.py` — add `MOYASAR = "moyasar"` to `PaymentProviderEnum`.
- `ee/services/payments/provider_registry.py` — add factory branch returning a cached `MoyasarPaymentProvider`.
- `ee/routers/payments.py` — add endpoints listed in §2/§3.
- `ee/services/payments/webhooks/payments_webhooks.py` — add `handle_moyasar_webhook()` branch.
- `apps/api/pyproject.toml` — add dev deps only: `respx` (HTTP mock for tests). Runtime uses existing `httpx` and `cryptography` (already pulled in by authlib).

### New files (Web)

```
apps/web/app/payments/moyasar/callback/page.tsx   # post-payment redirect landing, polls enrollment status
apps/web/services/payments/providers/moyasar.ts   # verifyMoyasarKeys, getEnrollmentStatus
apps/web/components/Dashboard/Pages/Payments/MoyasarKeysModal.tsx  # new — replaces OAuth redirect
```

### Modified files (Web)

- `components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx` — add Moyasar entry to `PAYMENT_PROVIDERS`. Provider metadata gets an optional `connectMode: 'oauth' | 'keys'` (default `'oauth'` preserves Stripe behavior); when `'keys'`, render `MoyasarKeysModal` instead of redirecting to `getConnectUrl()`.

### Explicit deviation from Stripe

Stripe uses `getConnectUrl()` to redirect to OAuth. Moyasar has no OAuth — the dashboard needs a **modal that collects keys** and calls a new `POST /{org_id}/moyasar/connect/verify`. This is the only shared-component touch, and it's an additive branch (`connectMode`).

### No config.py change

Unlike Stripe (`InternalStripeConfig` with platform-wide `stripe_secret_key`/`stripe_client_id`), there are **no global Moyasar credentials**. Every key is per-org, encrypted into `PaymentsConfig.provider_config`. `apps/api/config/config.py` is not modified.

---

## §2 — Connection flow & credential storage

### UI flow — school admin

1. Dashboard → Payments → Configuration → click **"Connect Moyasar"**.
2. `MoyasarKeysModal` opens with 3 inputs:
   - `Publishable key` (`pk_test_...` or `pk_live_...`)
   - `Secret key` (`sk_test_...` or `sk_live_...`)
   - `Webhook secret` (from Moyasar dashboard → Developers → Webhooks)
3. Read-only panel shows the school's webhook URL (`https://<host>/api/v1/payments/moyasar/webhook`) with a copy button and an inline warning: *"Set this in Moyasar → Developers → Webhooks before clicking Verify, otherwise enrollments won't auto-activate."*
4. **"Verify & Save"** → `POST /{org_id}/moyasar/connect/verify` with the 3 values (over HTTPS in production; dev uses localhost).

### API verification — `POST /{org_id}/moyasar/connect/verify`

1. RBAC check: `update` on `org_uuid` (same pattern as Stripe connect routes).
2. Test-call `GET https://api.moyasar.com/v1/invoices?limit=1` with HTTP Basic Auth using the secret key as the username (no password, per Moyasar docs).
   - 2xx → keys valid.
   - 401 → return 400 `"Invalid Moyasar secret key"`.
   - Other non-2xx / network → 502 `"Could not reach Moyasar"`.
3. Derive mode from prefix: `secret_key.startswith("sk_test_") → mode="test"`, else `"live"`.
4. Encrypt `secret_key` and `webhook_secret` with Fernet (§2a).
5. Upsert `PaymentsConfig` for `(org_id, provider="moyasar")`:
   - `active=True`
   - `provider_specific_id=None` (no platform-account concept)
   - `mode` field untouched (keeps Stripe's `standard`/`express` semantics); Moyasar mode stored inside `provider_config`
   - `provider_config = {"enc_secret_key":"gAAAAA…", "enc_webhook_secret":"gAAAAA…", "publishable_key":"pk_…", "mode":"test"}`
6. Return 200 `{"active":true, "mode":"test"}` — no keys echoed.

### Disconnect

The existing `DELETE /{org_id}/config?provider=moyasar` is provider-agnostic; it already guards against active subscriptions (not applicable here since v1 has no subs) and active enrollments. Provider-level cleanup: `MoyasarPaymentProvider.cleanup_on_disconnect()` is a **no-op** — Moyasar webhook registration lives in the school's Moyasar dashboard, not ours.

### §2a — Encryption

Helper in `ee/services/payments/utils/moyasar_utils.py`:

```python
def encrypt_secret(plaintext: str) -> str: ...
def decrypt_secret(ciphertext: str) -> str: ...
```

Uses `cryptography.fernet.Fernet`. The Fernet key is derived from `LEARNHOUSE_AUTH_JWT_SECRET_KEY` via `base64.urlsafe_b64encode(hashlib.sha256(jwt_secret.encode()).digest())` — deterministic, no extra env var, and key rotation on `LEARNHOUSE_AUTH_JWT_SECRET_KEY` is already a documented operation (JWT tokens get invalidated; Moyasar keys become unreadable and require re-entry).

**Threat model:** this protects against a database-only leak. If the app secret also leaks, the keys are exposed — accepted trade-off for v1. Future: dedicated `LEARNHOUSE_PAYMENTS_ENCRYPTION_KEY` with rotation support.

**Publishable key is stored plaintext** (it's public by design — intended to be served to the browser).

### §2b — Data model (no schema changes)

| Column | Stripe | Moyasar |
|---|---|---|
| `PaymentsConfig.provider` | `"stripe"` | `"moyasar"` |
| `PaymentsConfig.provider_specific_id` | `"acct_..."` | `NULL` |
| `PaymentsConfig.provider_config` | `{}` (mostly) | `{enc_secret_key, enc_webhook_secret, publishable_key, mode}` |
| `PaymentsConfig.active` | `false` until OAuth done | `false` until verify succeeds |
| `PaymentsConfig.mode` (existing enum) | `"standard"` / `"express"` | **untouched** — Moyasar mode lives in `provider_config.mode` |

### §2c — Rationale: why not extend `PaymentsModeEnum` with `test`/`live`

The existing `PaymentsModeEnum` encodes Stripe-specific connected-account types (`standard`, `express`). Test/live is orthogonal — it describes which *set of credentials* is in use, not which *account type*. Overloading the enum would make Stripe-specific code branches ambiguous. Storing Moyasar's `test`/`live` inside `provider_config` keeps the enum cleanly scoped and adds no migration.

---

## §3 — Checkout flow

### Happy path — student enrollment to paid

1. Student clicks **Enroll** on a one-time `PaymentsOffer` whose org has an active Moyasar `PaymentsConfig`.
2. Existing generic `POST /{org_id}/offers/{offer_id}/checkout` dispatches to `MoyasarPaymentProvider.create_checkout_session()`.
3. `create_checkout_session`:
   - Load `PaymentsConfig`, decrypt secret.
   - Reject if `offer.offer_type == SUBSCRIPTION` → `HTTPException(400, "Moyasar doesn't support subscriptions in v1. Use one-time offers.")`
   - Validate `offer.currency` (see §3a).
   - Upsert `PaymentsEnrollment` with `status=PENDING`, `user_id`, `offer_id`, `org_id`.
   - `POST https://api.moyasar.com/v1/invoices` with:
     - `amount` = halalas (integer; `int(round(offer.amount * 100))`)
     - `currency` = `offer.currency` (uppercase)
     - `description` = `f"{offer.name} — {org.name}"` (truncated to 255 chars)
     - `callback_url` = `f"https://<host>/payments/moyasar/callback?enrollment_id={enrollment.id}"`
     - `back_url` = `f"https://<host>/orgs/{org.slug}/"`
     - `metadata` = `{"enrollment_id": str, "offer_id": str, "org_id": str, "user_id": str}` — survives round-trip; webhook uses it
     - `Idempotency-Key` header = `f"enrollment-{enrollment.id}-v1"` — retrying checkout never creates duplicate invoices
   - Persist returned `invoice.id` into `enrollment.provider_specific_data = {"moyasar_invoice_id":"inv_..."}`.
   - Return `{"url": invoice.url, "provider": "moyasar"}`.
4. Frontend redirects browser to `invoice.url`.
5. Student pays on Moyasar's hosted page.
6. Moyasar redirects back to `callback_url`.

### Callback page — `app/payments/moyasar/callback/page.tsx`

UX only. Polls `GET /api/v1/payments/enrollments/{id}/status` (new lightweight endpoint) every 1.5 s, up to 10 s total.
- If status transitions to `ACTIVE` → redirect to the course page.
- If still `PENDING` at timeout → show "Confirming your payment…" with a manual refresh button. On refresh the poller restarts and also triggers §3b reconciliation.
- If `CANCELLED`/`FAILED` → show failure message + "Try again" link.

**Webhook is the source of truth. The callback redirect is never used to activate an enrollment.**

### §3a — Currency rule

Moyasar supports SAR, USD, EUR, KWD, AED, BHD, QAR, OMR. Behavior:

- `offer.currency.upper()` ∈ supported set → pass through.
- Otherwise → `HTTPException(400, f"Currency {offer.currency} is not supported by Moyasar. Supported: SAR, USD, EUR, KWD, AED, BHD, QAR, OMR.")`

v1 **does not** hide unsupported offers in the UI. The error surfaces at checkout. Future (v2): visual badge in the offer editor when Moyasar is the active provider.

### §3b — Reconciliation safety net

If the school forgot to paste the webhook URL into Moyasar's dashboard, students can still pay but enrollments never activate. Mitigation (v1):

On every call to `GET /payments/enrollments/{id}/status` where status is still `PENDING` AND the enrollment has a `moyasar_invoice_id`:
- One-shot server-side `GET https://api.moyasar.com/v1/invoices/{id}` with the org's decrypted secret key.
- If invoice `status == "paid"` → activate enrollment via `update_enrollment_status(id, ACTIVE)`.
- If `status == "failed"` → mark `CANCELLED`.
- Rate-limited per enrollment via Redis key `moyasar_reconcile:{enrollment_id}` with 5 s TTL — `SET NX EX 5` returns false → skip the outbound call, just return current DB status.

This covers the "student on the callback page, webhook not configured" gap without building webhook-health tooling.

### §3c — Webhook handler — `POST /api/v1/payments/moyasar/webhook`

Org-less path (no `org_id` in URL), like Stripe's standard webhook. Steps:

1. Read raw body + signature header.
2. **Org resolution:** parse JSON, read `data.metadata.org_id` (set during checkout). If missing → 400 `"Missing org_id in metadata"`.
3. Load that org's `PaymentsConfig.provider_config`, decrypt `webhook_secret`, verify signature. **Signature scheme unknown at design time** — the first implementation task is to confirm Moyasar's signature format (header name, HMAC algorithm, what's signed: raw body vs. canonical fields) against a live webhook event, then encode the verified scheme in `verify_webhook_signature`. If verification fails → 401, log at WARNING with `event.id[:8]` only.
4. **Idempotency:** Redis key `moyasar_evt:{event.id}` with 48 h TTL. If already present → return 200 immediately. Same pattern as `payments_stripe.py:349`.
5. Dispatch by event type:
   - `payment_paid` | `invoice_paid` → `update_enrollment_status(metadata.enrollment_id, ACTIVE)`.
   - `payment_failed` | `invoice_canceled` → `update_enrollment_status(..., CANCELLED)`.
   - Any other type → log at INFO, return 200.
6. On any handler exception → log ERROR, return 500 so Moyasar retries. Never return 4xx for internal errors (Moyasar would stop retrying).

---

## §4 — Error handling & logging

Mirrors `payments_stripe.py` patterns.

- **HTTP errors:** `HTTPException(status_code, detail)` with human-readable `detail`. No custom exception hierarchy.
- **HTTP client:** `httpx.AsyncClient`. Do **not** add the `moyasar` PyPI package — it's a thin wrapper not worth the dep.
- **Moyasar API call wrapper:**
  ```python
  try:
      res = await client.request(...)
      res.raise_for_status()
      return res.json()
  except httpx.HTTPStatusError as e:
      body = e.response.json() if e.response.headers.get("content-type", "").startswith("application/json") else {}
      detail = body.get("message") or body.get("type") or str(e)
      raise HTTPException(status_code=400, detail=f"Moyasar: {detail}")
  except httpx.RequestError:
      raise HTTPException(status_code=502, detail="Moyasar unreachable")
  ```
- **Webhook handler:** never raise `HTTPException` from within event processing — return 500 on unrecoverable error to trigger Moyasar's retry, 200 on successful processing (including idempotent duplicates and unknown-type events).
- **Signature failures:** 401, log at WARNING including first 8 chars of `event.id`. Never log the signature itself.
- **Logging:** stdlib `logger = logging.getLogger(__name__)`. Levels:
  - INFO — config verified, checkout created, webhook received, webhook processed
  - WARNING — signature mismatch, unknown event type, reconciliation trigger
  - ERROR — HTTP call failed, decryption failed, DB write failed
- **Never log:** decrypted secret keys, raw webhook bodies (may contain card/customer metadata), webhook secrets, Fernet ciphertexts.

---

## §5 — Testing

Path: `apps/api/src/tests/payments/` (new directory; existing payment test coverage is empty).

### `test_payments_moyasar.py` — unit, no network (~12 tests)

- `encrypt_secret` / `decrypt_secret` round-trip.
- `decrypt_secret` with wrong Fernet key → `cryptography.fernet.InvalidToken` → surface as `HTTPException(500)`.
- `MoyasarPaymentProvider._load_credentials`: happy, missing `PaymentsConfig`, `active=False`.
- `create_checkout_session`:
  - amount conversion decimal → halalas (`10.50 SAR` → `1050`).
  - unsupported currency (e.g. `GBP`) → `HTTPException(400)`.
  - SUBSCRIPTION offer → `HTTPException(400)`.
  - Moyasar returns 401 → wrapped as `HTTPException(400, "Moyasar: ...")`.
  - Happy path: mocks `POST /invoices` with `respx`, asserts payload shape (currency, amount, metadata, idempotency header), returns URL.
- `verify_webhook_signature`: valid, invalid, missing header.
- `handle_webhook` dispatch:
  - `payment_paid` → `update_enrollment_status(ACTIVE)` called once.
  - `payment_failed` → `CANCELLED`.
  - Unknown type → no-op, returns 200.
- Idempotency: second call with same `event.id` → no double status update (Redis mock).

### `test_payments_moyasar_router.py` — integration via `TestClient` (~8 tests)

- `POST /{org_id}/moyasar/connect/verify`:
  - Valid keys (`respx` mocks `GET /invoices` → 200) → `active=true, mode=test`.
  - Invalid keys (`GET /invoices` → 401) → 400.
  - Non-admin caller → 403.
- `POST /{org_id}/offers/{offer_id}/checkout` after Moyasar is connected → returns `url`, enrollment row in `PENDING`.
- `POST /payments/moyasar/webhook`:
  - Valid `payment_paid` → enrollment becomes `ACTIVE`.
  - Duplicate event ID → 200 no-op.
  - Bad signature → 401.
- `DELETE /{org_id}/config?provider=moyasar` → `PaymentsConfig` deleted, `MoyasarPaymentProvider.cleanup_on_disconnect` called.

### Mocking strategy

- Moyasar HTTP: `respx` (new dev dep; single widely-used `httpx` mock library).
- Redis: monkey-patch `_get_redis_client()` to return a minimal in-memory stub that implements the three operations we use (`SET NX EX`, `GET`, `SETEX`). Avoids adding a Redis test dep.
- DB: reuse whatever the existing `apps/api/src/tests/conftest.py` provides. First implementation task confirms and, if no session fixture exists yet, adds one scoped to this test package.

### What v1 does **not** test

- Real Moyasar API in CI (no credentials, no Saudi-side network).
- Moyasar-side webhook retry behavior.
- Encryption-key rotation (separate operational concern).
- Frontend — web app has no existing test setup; manual QA.

---

## Dependencies

- **Runtime (API):** none added. Uses existing `httpx`, `cryptography`, `sqlmodel`, `fastapi`.
- **Dev (API):** `respx` (HTTP mock).
- **Runtime (Web):** none added.

## Migration

None. All storage is additive (one new enum value, no new columns, no new tables).

## Rollout

1. Land on branch `feat/payments-moyasar`.
2. Merge to `dev` behind the existing EE folder gate (Moyasar lives in `ee/` like Stripe).
3. First pilot org pastes their test-mode keys, runs a 1 SAR test charge end-to-end.
4. Switch to live keys after validating webhook reception.

## Open questions (answered inline; recorded here for future readers)

- **Subscriptions:** deferred to v2 — Moyasar has no native recurring object.
- **Currency support:** pass-through for the Moyasar-supported set; 400 otherwise; UI doesn't pre-filter in v1.
- **OAuth:** not applicable — Moyasar uses per-merchant Basic Auth keys.
- **Platform Moyasar account:** not used. Every cent flows directly to the school's Moyasar account.
- **Webhook auto-registration:** out of scope — schools paste the URL manually into Moyasar's dashboard.
