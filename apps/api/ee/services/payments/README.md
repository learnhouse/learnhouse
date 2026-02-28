# Payments — Architecture & Provider Guide

## Overview

The payment system is built around a generic provider model. Each organization connects
exactly one payment provider (e.g. Stripe). The core data model, offer management, and
enrollment lifecycle are provider-agnostic. Provider-specific logic (OAuth, checkout
sessions, webhooks) is isolated to a single service file per provider.

---

## Directory structure

```
ee/
├── db/payments/
│   ├── payments.py              # PaymentsConfig model + PaymentProviderEnum
│   ├── payments_offers.py       # PaymentsOffer model
│   └── payments_enrollments.py  # PaymentsEnrollment model + status lifecycle
│
└── services/payments/
    ├── payments_config.py       # Generic config CRUD (provider-agnostic)
    ├── payments_offers.py       # Offer CRUD + Stripe product sync
    ├── payments_enrollments.py  # Enrollment CRUD + UserGroup side-effects
    ├── payments_customers.py    # Customer/enrollment read views
    ├── payments_stripe.py       # ALL Stripe-specific logic ← provider module
    ├── utils/
    │   └── stripe_utils.py      # Stripe lookup helpers
    └── webhooks/
        └── payments_webhooks.py # Stripe webhook dispatcher
```

---

## Generic data model

```
Organization
    └── PaymentsConfig          (one per org per provider)
            provider            → PaymentProviderEnum ("stripe", ...)
            provider_specific_id → connected account ID (e.g. acct_xxx for Stripe)
            provider_config     → JSON blob — provider fills this during setup
            active              → True only after OAuth/auth is confirmed

PaymentsOffer                   (provider-agnostic offer)
    └── usergroup_id → UserGroup ← UserGroupResource (courses, docspaces, …)

PaymentsEnrollment              (one per user per offer purchase)
    status: PENDING → ACTIVE/COMPLETED → CANCELLED/REFUNDED/FAILED
    side-effect: ACTIVE/COMPLETED  → add user to UserGroup
                 CANCELLED/REFUNDED → remove user from UserGroup
```

The RBAC system (`check_usergroup_access`) gates every resource type through UserGroup
membership automatically. Adding a new resource type to an offer requires no access-control
code — only adding it to the UserGroup.

---

## Stripe configuration

### Platform-level keys (in `config/config.yaml`)

These are the LearnHouse platform's own Stripe credentials. They are **not** per-organization.

| Key | Where to get it | Required |
|-----|----------------|----------|
| `stripe_secret_key` | Stripe Dashboard → Developers → API keys → Secret key | Yes |
| `stripe_publishable_key` | Stripe Dashboard → Developers → API keys → Publishable key | Yes |
| `stripe_client_id` | Stripe Dashboard → Settings → Connect → OAuth client ID (`ca_xxx`) | Yes — needed for Connect OAuth |
| `stripe_webhook_standard_secret` | Stripe Dashboard → Developers → Webhooks → Standard endpoint → Signing secret | Yes — verifies direct payment webhooks |
| `stripe_webhook_connect_secret` | Stripe Dashboard → Developers → Webhooks → Connect endpoint → Signing secret | Yes — verifies Connect account events |

```yaml
# config/config.yaml
payments_config:
  stripe:
    stripe_secret_key: "sk_live_..."          # or sk_test_... for development
    stripe_publishable_key: "pk_live_..."
    stripe_client_id: "ca_..."                # from Connect settings
    stripe_webhook_standard_secret: "whsec_..." # standard endpoint secret
    stripe_webhook_connect_secret: "whsec_..."  # connect endpoint secret
```

### Organization-level (stored in the database)

Each organization that connects Stripe goes through the OAuth flow:

1. Admin clicks **Connect with Stripe** in the dashboard.
2. Backend generates an OAuth URL via `generate_stripe_connect_link()`.
3. Org admin authorizes LearnHouse on their Stripe account.
4. Stripe redirects to `/payments/stripe/connect/oauth` with `?code=...&state=org_id=N`.
5. Frontend calls `GET /payments/stripe/oauth/callback?code=...&org_id=N`.
6. Backend exchanges the code for the connected account ID (`acct_xxx`) and stores it
   in `PaymentsConfig.provider_specific_id`. `active` is set to `True` at this point.

The connected account ID (`acct_xxx`) is then used as the `stripe_account=` parameter
on every Stripe API call for that organization.

### Webhook endpoints to register in Stripe

Register both endpoints in your Stripe Dashboard (Developers → Webhooks):

| Type | URL | Events to listen for |
|------|-----|----------------------|
| Standard | `https://your-domain/payments/stripe/webhook/standard` | `checkout.session.completed`, `payment_intent.payment_failed` |
| Connect | `https://your-domain/payments/stripe/webhook/connect` | `account.application.authorized`, `customer.subscription.deleted` |

For local development, use the Stripe CLI:
```bash
stripe listen --forward-to localhost:1338/payments/stripe/webhook/standard
stripe listen --forward-connect-to localhost:1338/payments/stripe/webhook/connect
```

---

## Adding a new payment provider

Follow these steps to add a provider (e.g. "Lemon Squeezy"):

### 1 — Backend: register the provider

**`ee/db/payments/payments.py`**
```python
class PaymentProviderEnum(str, Enum):
    STRIPE = "stripe"
    LEMON_SQUEEZY = "lemon_squeezy"   # ← add here
```

### 2 — Backend: platform credentials

**`config/config.py`** — add a config model for the new provider:
```python
class InternalLemonSqueezyConfig(BaseModel):
    api_key: str | None
    webhook_secret: str | None

class InternalPaymentsConfig(BaseModel):
    stripe: InternalStripeConfig
    lemon_squeezy: InternalLemonSqueezyConfig   # ← add here
```

**`config/config.yaml`** — add the keys (see how Stripe keys are structured there).

### 3 — Backend: provider service module

Create `ee/services/payments/payments_lemon_squeezy.py` implementing at minimum:

```python
async def get_lemon_squeezy_internal_credentials() -> dict: ...
async def generate_lemon_squeezy_connect_link(request, org_id, redirect_uri, current_user, db_session) -> dict: ...
async def handle_lemon_squeezy_oauth_callback(request, org_id, code, current_user, db_session) -> dict: ...
async def create_lemon_squeezy_offer_checkout_session(request, org_id, offer_id, redirect_uri, current_user, db_session) -> dict: ...
async def handle_lemon_squeezy_webhook(request, db_session) -> dict: ...
```

The checkout session handler must call `update_enrollment_status()` from
`payments_enrollments.py` to trigger the UserGroup side-effects — just like the Stripe
implementation does. This is the only integration point required.

### 4 — Backend: router endpoints

Add provider-specific routes to `ee/routers/payments.py` following the Stripe pattern:

```python
# Connect OAuth
POST /{org_id}/lemon_squeezy/connect/link
GET  /lemon_squeezy/oauth/callback

# Webhook
POST /lemon_squeezy/webhook

# Checkout is already provider-agnostic:
# POST /{org_id}/offers/{offer_id}/checkout  ← route to correct provider by config
```

The checkout route `POST /{org_id}/offers/{offer_id}/checkout` should detect the org's
active provider from `PaymentsConfig.provider` and dispatch accordingly.

### 5 — Frontend: provider service file

Create `apps/web/services/payments/providers/lemon_squeezy.ts`:
```ts
export async function getLemonSqueezyOnboardingLink(orgId, accessToken, redirectUri) { ... }
export async function verifyLemonSqueezyConnection(orgId, code, accessToken) { ... }
```

### 6 — Frontend: provider callback page

Create `apps/web/app/payments/lemon_squeezy/connect/oauth/page.tsx` following the
pattern of the Stripe callback page. It must post this message on success:
```ts
window.opener.postMessage({ type: 'payment_provider_connected', provider: 'lemon_squeezy' }, '*')
```

### 7 — Frontend: register in the provider registry

Add one entry to `PAYMENT_PROVIDERS` in
`apps/web/components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx`:
```ts
{
  id: 'lemon_squeezy',
  name: 'Lemon Squeezy',
  Icon: SiLemonsqueezy,
  tagline: 'Merchant of record payments for digital products.',
  docsUrl: 'https://docs.lemonsqueezy.com',
  callbackPath: '/payments/lemon_squeezy/connect/oauth',
  async getConnectUrl(orgId, accessToken, redirectUri) {
    const { connect_url } = await getLemonSqueezyOnboardingLink(orgId, accessToken, redirectUri);
    return connect_url;
  },
},
```

No other frontend files need to change.

---

## Key design invariants

- **`update_enrollment_status()` owns all side-effects.** Every status transition —
  whether triggered by a webhook, admin action, or refund — must go through this function.
  It is the single place that adds/removes users from UserGroups.

- **`usergroup_id` is immutable after offer creation.** Changing the group post-creation
  would silently break access for existing subscribers.

- **`ondelete="RESTRICT"` on `PaymentsOffer.usergroup_id`.** A UserGroup that controls
  paying users' access cannot be deleted accidentally.

- **`active` is set by the OAuth callback, not only by the webhook.** The `account.application.authorized`
  webhook remains a redundant confirmation, but `active=True` is written immediately when
  the OAuth code exchange succeeds so the UI reflects the correct state without requiring
  webhook delivery.
