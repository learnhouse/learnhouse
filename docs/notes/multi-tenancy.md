# Multi-Tenancy

LearnHouse supports two tenancy modes, selected by a single environment variable: `LEARNHOUSE_TENANCY`.

| Value      | Use case                                              | Hostname pattern                  | Default org? |
|------------|-------------------------------------------------------|-----------------------------------|--------------|
| `multi`    | SaaS-style hosting with multiple orgs (EE-only)       | `slug.your-domain.tld`            | No           |
| `single`   | Self-hosted dev (`localhost`) or self-hosted VPS      | Any host the request arrives on   | Always       |

There is no third mode — `single` covers both `localhost:3000` and any production VPS hostname. The code path is the same; the only differences are derived from the request itself (e.g. `Secure` cookie flag from the request scheme).

## How modes are selected

```
LEARNHOUSE_TENANCY=multi   # requires EE (or SaaS) + LEARNHOUSE_DOMAIN
LEARNHOUSE_TENANCY=single  # default for OSS / dev / VPS self-host
# unset                    # inferred — see "Default inference" below
```

The backend validates at boot:
- `multi` requires `is_ee_available()` OR `LEARNHOUSE_SAAS=true`, AND `LEARNHOUSE_DOMAIN` set to a routable parent domain (not `localhost`). Mis-configuration aborts startup with a clear error.
- `single` ignores `LEARNHOUSE_DOMAIN` and `LEARNHOUSE_COOKIE_DOMAIN`. If you set them, you'll see a deprecation warning at boot — they are no longer authoritative.

### Default inference (when `LEARNHOUSE_TENANCY` is unset)

To preserve existing deployment behavior without forcing every operator to set a new env var, the backend infers the default from existing flags:

| Signal                                                                                       | Inferred tenancy |
|----------------------------------------------------------------------------------------------|------------------|
| `LEARNHOUSE_SAAS=true` + real (non-localhost) domain + not self-hosted/dev                   | `multi`          |
| EE folder present + `LEARNHOUSE_COOKIE_DOMAIN` starts with `.` + real domain + not self/dev  | `multi`          |
| Anything else                                                                                | `single`         |

The strong signal for "I want subdomain tenancy" is a dotted cookie domain (`LEARNHOUSE_COOKIE_DOMAIN=.foo.com`) — operators only set that when they want subdomains to share auth. This means an EE deployment on a single VPS domain (no dotted cookie domain) defaults to `single`, which is the right behavior for the self-host-EE case (one org, EE features locally available).

**Recommended:** set `LEARNHOUSE_TENANCY` explicitly in production. Inference is a backward-compat convenience, not a long-term contract.

## Compatibility with deployment modes (oss / ee / saas)

`LEARNHOUSE_TENANCY` is orthogonal to the existing **deployment mode** (`oss`, `ee`, `saas`) which is set by the presence of the `ee/` folder and `LEARNHOUSE_SAAS`. The matrix:

| Deployment | Tenancy   | Supported? | Typical use                                                     |
|------------|-----------|------------|------------------------------------------------------------------|
| `oss`      | `single`  | ✅          | Open-source self-host, one org per instance                     |
| `oss`      | `multi`   | ❌ (rejected at boot) | Multi-org requires EE                                  |
| `ee`       | `single`  | ✅          | EE features on a self-hosted VPS, one org                       |
| `ee`       | `multi`   | ✅          | Self-hosted multi-tenant with `*.your-domain.tld`               |
| `saas`     | `single`  | ✅ (unusual) | Edge case — SaaS billing logic on a single-org host            |
| `saas`     | `multi`   | ✅          | The SaaS production deployment shape                            |

Existing EE/SaaS deployments that haven't set `LEARNHOUSE_TENANCY` continue to behave as before because the inference reads their existing config (`LEARNHOUSE_SAAS`, `LEARNHOUSE_COOKIE_DOMAIN`, `LEARNHOUSE_DOMAIN`) and picks `multi` when those signal subdomain intent.

## Mode 1 — Multi (EE)

Required env:
- `LEARNHOUSE_TENANCY=multi`
- `LEARNHOUSE_DOMAIN=your-domain.tld` (the apex; e.g. `learnhouse.io`)
- `LEARNHOUSE_COOKIE_DOMAIN=.your-domain.tld` (so subdomains share the session)
- `ee/` folder present (or unset `LEARNHOUSE_DISABLE_EE`)

Behavior:
- Request `acme.your-domain.tld` → the middleware rewrites internally to `/orgs/acme/...`.
- Cookies set with `Domain=.your-domain.tld` so a user logged in on `acme.your-domain.tld` is also logged in on `beta.your-domain.tld`.
- Per-org **custom domains** (e.g. `learn.acme-academy.com` mapped to org `acme`) are resolved via the `CustomDomain` table at request time. Cookies on a custom domain are host-only; that org's session does not roam to the platform's own subdomains.
- Email/invite links use the org's verified custom domain when set, otherwise `https://{slug}.your-domain.tld/...`.
- Reserved subdomains: `auth`, `www`, `api`, `admin`. None of these can be an org slug.

## Mode 2 / 3 — Single (localhost or VPS)

Required env:
- `LEARNHOUSE_TENANCY=single` (or just leave unset; this is the default)

Behavior:
- The middleware always rewrites to `/orgs/{default_org_slug}/...`. There is one organization, identified by its slug (default: `"default"`, falling back to the row with the lowest `id` if no `default` org exists).
- Cookies are **host-only** — no `Domain=` attribute. Same code path on `localhost:3000` and on a VPS at `learn.example.org`. The browser pins the cookie to whichever Host the request arrived on.
- The `Secure` flag on cookies follows the request scheme: `false` on `http://localhost`, `true` on `https://learn.example.org`. There is no separate "dev mode" branching here.
- Email/invite links are derived from the request — whatever Host the user came in on is what the email links back to.
- The middleware never calls into the EE subdomain resolver and never makes a `/orgs/resolve/domain/*` API request. If the EE folder is missing entirely, single mode runs cleanly.

## Cookies

All LearnHouse cookies use the `LH_` prefix.

| Cookie                | Set by         | Purpose                                                                                       |
|-----------------------|----------------|-----------------------------------------------------------------------------------------------|
| `LH_access`           | API            | JWT access token (httpOnly, 8-hour TTL).                                                      |
| `LH_refresh`          | API            | JWT refresh token (httpOnly, 30-day rotating).                                                |
| `LH_org`              | middleware     | Canonical org slug for the current request. **Source of truth.**                              |
| `LH_tenancy`          | middleware     | `multi` or `single`. Source of truth for `getTenancy()` on the frontend.                      |
| `LH_default_org`      | middleware     | Default org slug from `instance/info`.                                                        |
| `LH_frontend_domain`  | middleware     | Configured frontend domain (for cookie-domain math).                                          |
| `LH_top_domain`       | middleware     | Configured top domain (apex without port).                                                    |
| `LH_mode`             | middleware     | Deployment mode: `oss`, `ee`, or `saas`.                                                      |
| `LH_custom_domain`    | middleware     | Set in multi mode when the request came in on a verified per-org custom domain.               |
| `LH_session`          | platform API   | Non-httpOnly flag indicating an active session, read by client-side gating.                   |
| `LH_region`           | platform mw    | `eur` or `usd`, derived from Vercel geolocation, used for Stripe pricing.                     |
| `LH_last_org`         | localStorage   | Last visited org slug (UX hint, not security-relevant).                                       |
| `LH_oauth_state`      | client         | OAuth CSRF state (5-min TTL).                                                                 |
| `LH_oauth_orgslug`    | client         | Org slug context preserved across the OAuth round-trip.                                       |
| `LH_oauth_org_id`     | client         | Org ID context preserved across the OAuth round-trip.                                         |

Request headers (set by the middleware on every tenant-scoped request, **not** stored anywhere — only readable via `next/headers` in the active request):

| Header                  | Purpose                                                                       |
|-------------------------|-------------------------------------------------------------------------------|
| `x-lh-tenancy`          | `multi` or `single` — same as `LH_tenancy` cookie but available to RSC on the first cold load |
| `x-lh-org`              | Resolved org slug for the current request                                     |
| `x-lh-top-domain`       | Configured top domain                                                         |
| `x-lh-frontend-domain`  | Configured frontend domain                                                    |
| `x-lh-mode`             | Deployment mode                                                               |
| `x-lh-custom-domain`    | Set when the request came in on a verified per-org custom domain              |

### Tamper resistance — what if a user edits cookies?

Cookies are hints; the backend is the security boundary. Per-cookie:

- **`LH_access` / `LH_refresh`**: signed JWTs (HS256, server-side secret). Tampering invalidates the signature → API rejects. Also bound to `password_changed_at` and a Redis revocation list, so stale-but-valid tokens get rejected after logout/password change.
- **`LH_tenancy`, `LH_default_org`, `LH_frontend_domain`, `LH_top_domain`, `LH_mode`, `LH_custom_domain`**: UX hints only. The middleware fetches authoritative tenancy/mode from the backend (`/instance/info`, server-side config). Editing these cookies only affects the rendered UI in that user's browser; they cannot redirect routing to a different deployment shape.
- **`LH_org`**: also a hint. The proxy may rewrite to `/orgs/{tampered-slug}/...`, but every API endpoint re-checks `require_org_membership(user_id, org_id)`. Worst case: the tamperer sees a broken UI shell with no data.
- **`LH_session`**: non-httpOnly boolean. Setting it to `1` without a valid JWT just triggers the "redirect logged-in users away from /login" branch — the dashboard then fails real auth and redirects back. Annoyance, not breach.
- **`LH_region`**: changes which currency Stripe shows. **Stripe enforces server-side prices at checkout** — the user manipulates display, not the charge.

The defense-in-depth principle: cookies tell us what UI to render, the JWT tells us who you are, the database tells us what you're allowed to do. Every API endpoint enforces the last two regardless of the first.

### Cookie domain rules

The cookie `Domain` attribute is computed by `auth.py:get_cookie_domain_for_request` (backend) and `services/auth/cookies.ts:getCookieDomain` (frontend). Same logic on both sides:

| Tenancy    | Request from                           | `Domain` attribute            | Effect                                  |
|------------|----------------------------------------|-------------------------------|-----------------------------------------|
| `single`   | _anywhere_                             | `None`                        | Host-only; no cross-host roaming        |
| `multi`    | `acme.your-domain.tld`                 | `.your-domain.tld`            | Roams to all subdomains of the apex     |
| `multi`    | Verified custom domain                 | `None`                        | Host-only on that custom domain         |
| `multi`    | `localhost` (misconfig)                | `None`                        | Safety net                              |

### Migration from older versions

The cookie naming convention changed in this release. **All cookies now use the `LH_` prefix and legacy names are no longer read.** Old cookie names (`access_token_cookie`, `refresh_token_cookie`, `learnhouse_orgslug`, `learnhouse_tenancy`, `learnhouse_multi_org`, `learnhouse_current_orgslug`, `learnhouse_has_session`, `lh_region`, etc.) are dropped entirely — there is no read-fallback window.

**Impact on rollout:** existing logged-in users will be signed out when this version deploys, because their browsers hold cookies the new code does not recognize. They will re-authenticate once and the new `LH_*` cookies will be set. There is no data loss; only an interactive sign-in.

If you cannot tolerate forced logouts, deploy this change during a maintenance window or notify users in advance.

## CORS

| Tenancy    | `allow_origin_regex`                                                       | Why                                          |
|------------|----------------------------------------------------------------------------|----------------------------------------------|
| `multi`    | Configured via `LEARNHOUSE_ALLOWED_REGEXP` (matches apex + subdomains)     | Strict allowlist for known multi-tenant domain |
| `single`   | `^https?://[^/\s]+$` (any well-formed http(s) origin)                      | Operator's host is the only valid origin; cookies are host-only so cross-origin attackers cannot forge authenticated requests |

`allow_credentials=True` in both modes (cookie-based auth requires it).

## Backend `instance/info`

The frontend middleware fetches `GET /api/v1/instance/info` once per 30 seconds and caches it. The endpoint returns:

```json
{
  "mode": "saas" | "ee" | "oss",
  "tenancy": "multi" | "single",
  "multi_org_enabled": true | false,
  "default_org_slug": "default",
  "frontend_domain": "learnhouse.io",
  "top_domain": "learnhouse.io"
}
```

`multi_org_enabled` is a deprecated alias for `tenancy === "multi"`. Prefer `tenancy` in new code.

## Link generation

Two helpers cover all cases:

**`getUriWithOrg(slug, path)`** — sync. For client components and any context where navigation stays on the current origin. Returns:
- **Relative path** whenever navigation stays on the current origin (single tenancy always; multi tenancy when already on the correct subdomain).
- **Absolute subdomain URL** only when crossing subdomains in multi tenancy AND we're currently on a subdomain of the base domain.
- **Relative path** as a safety net when in multi tenancy but on a non-matching host (e.g. apex, localhost, custom domain that doesn't match the slug).

**`getServerCanonicalUrl(slug, path)`** — async. For Server Components emitting `<meta canonical>`, `og:url`, JSON-LD URLs, or any other absolute-URL-required context. Reads `x-lh-tenancy`, `x-lh-top-domain`, `x-lh-custom-domain` request headers injected by the middleware on every tenant-scoped request, so it returns a fully qualified URL even on cold loads where cookies aren't yet visible to RSC.

Why two helpers? Server Components on the very first request don't see the cookies set by middleware in the response (those cookies arrive at the browser, not the in-flight RSC). The middleware injects request headers via `NextResponse.rewrite(url, { request: { headers } })` so RSC has an immediately-readable source of truth. Reading headers is async (`headers()` from `next/headers` returns a Promise in Next.js 15+), hence the async signature.

For non-org URLs use `getUriWithoutOrg(path)`. For URLs that must always point at the platform apex (e.g. Stripe Connect OAuth redirects) use `getMainDomainUri(path)`.

### Don't synthesize subdomains by hand

Do not write code like `` `${slug}.${domain}` `` in a component. The only places that should construct subdomain URLs are:
- `services/config/config.ts:getUriWithOrg` (frontend)
- `ee/services/tenancy/*` (EE-only)
- `src/services/email/utils.py:get_org_signup_base_url` (backend)

Adding a new caller? Use `getUriWithOrg(slug, path)` and you'll get correct behavior in both modes for free.

## Email and external links (backend)

`get_org_signup_base_url(slug, request, db_session, org_id)` in `src/services/email/utils.py` is the canonical helper for invitation/reset/verification links:

- `tenancy=single` → uses the URL the request came in on (`get_base_url_from_request`).
- `tenancy=multi` → custom domain (if verified for that org) → `https://{slug}.{domain}` → request fallback.

`_is_allowed_base_url` validates the URL against an allowlist before returning it. In `single` mode the operator's host is authoritative — any well-formed http(s) URL is accepted. In `multi` mode, the URL must match `LEARNHOUSE_ALLOWED_ORIGINS` / `LEARNHOUSE_ALLOWED_REGEXP` / `LEARNHOUSE_PLATFORM_URL`.

## EE / OSS code split

The OSS frontend never imports subdomain or custom-domain logic directly. All of that lives under `learnhouse/apps/web/ee/services/tenancy/`:

- `core.ts` — pure logic (subdomain extraction, custom-domain detection, full priority chain). Runtime-agnostic.
- `resolveMulti.middleware.ts` — entry point for the Next.js middleware (Edge Runtime). Takes a `NextRequest`.
- `resolveMulti.server.ts` — entry point for Server Components (Node runtime). Takes `next/headers`.

The OSS `proxy.ts` and `services/org/orgResolution.ts` reach these via dynamic `import()` wrapped in try/catch. If EE is unavailable (folder removed at deploy time, or `LEARNHOUSE_DISABLE_EE=1`) the resolver falls back to the default org and logs a warning.

The backend EE/OSS gate is `is_multi_org_allowed()` in `src/core/ee_hooks.py`. It returns true only when the deployment mode is `ee` or `saas`. The `tenancy=multi` boot validation already requires the EE folder to be present.

## Testing each mode

### Mode 1 — Multi (EE)
```sh
LEARNHOUSE_TENANCY=multi
LEARNHOUSE_DOMAIN=lh.test
LEARNHOUSE_COOKIE_DOMAIN=.lh.test
```
Add hosts entries:
```
127.0.0.1 acme.lh.test beta.lh.test admin.lh.test
```
Verify:
- `https://acme.lh.test/dashboard` rewrites internally to `/orgs/acme/dashboard`.
- Cookie `Domain=.lh.test`. Login on `acme.lh.test`, navigate to `beta.lh.test` — still authenticated.
- Insert a row in `CustomDomain` (`org_id=<acme>`, `domain="learn.acme.example"`, `status="verified"`); a request to that host resolves and gets a host-only cookie.
- Invitation link points to `https://acme.lh.test/...` (or the custom domain when set).
- `GET /api/v1/instance/info` → `tenancy: "multi"`.

### Mode 2 — Single (localhost)
```sh
LEARNHOUSE_TENANCY=single
# LEARNHOUSE_DOMAIN unset
```
Verify on `http://localhost:3000`:
- Every path rewrites to `/orgs/{default}/...`.
- Cookies have **no** `Domain=` attribute; `Secure` is false.
- DevTools network tab shows zero requests to `/orgs/resolve/domain/*`.
- Email links use `http://localhost:3000`.
- Menu links are relative (`/dash/...`), no `default.localhost:3000` URLs anywhere.

### Mode 3 — Single (VPS)
```sh
LEARNHOUSE_TENANCY=single
```
Deploy at `https://learn.example.org`. Verify:
- Same as mode 2 but `Secure=true` on cookies.
- Email links use `https://learn.example.org`.
- The same image works regardless of which domain the operator points at it — no additional config needed when changing hostnames.

### OSS-without-EE smoke
```sh
LEARNHOUSE_DISABLE_EE=1
LEARNHOUSE_TENANCY=multi   # should fail at boot
LEARNHOUSE_TENANCY=single  # should boot cleanly
```
With `single`, no EE imports are attempted at runtime.

## Upgrading from versions before `LEARNHOUSE_TENANCY` existed

Prior versions decided multi-vs-single behavior implicitly from `is_multi_org_allowed()` (deployment mode in `ee`/`saas`), `self_hosted`, `development_mode`, and `LEARNHOUSE_USE_DEFAULT_ORG`. After the introduction of `LEARNHOUSE_TENANCY` these flags are deprecated and the new env var is the source of truth.

The boot-time inference (above) is designed so that **you do not need to change anything for existing deployments** — your current env vars produce the same tenancy mode you had before. To verify after upgrade:

1. Check the boot log for any deprecation warnings about `LEARNHOUSE_USE_DEFAULT_ORG`, `LEARNHOUSE_SELF_HOSTED`, or `LEARNHOUSE_COOKIE_DOMAIN` being set in single mode.
2. Hit `GET /api/v1/instance/info` and confirm `tenancy` matches your expectation.
3. Set `LEARNHOUSE_TENANCY` explicitly in your env config to lock the behavior — inference is a backward-compat convenience, not a long-term contract.

## Operations checklist

When deploying:

1. **Pick a tenancy mode** before pointing DNS. Switching modes after launch is a planned migration, not a config flip — cookie domains, email link shape, and the org-picker UX all change.
2. **`multi` mode** requires:
   - EE folder included in the build (`docker build --build-arg LEARNHOUSE_PUBLIC=false`)
   - DNS wildcard for `*.your-domain.tld` pointing at the same backend
   - TLS cert covering the apex and `*.your-domain.tld` (or per-subdomain ACME)
   - Backend env: `LEARNHOUSE_TENANCY=multi`, `LEARNHOUSE_DOMAIN`, `LEARNHOUSE_COOKIE_DOMAIN`, `LEARNHOUSE_ALLOWED_REGEXP`
3. **`single` mode** on a VPS:
   - Point any domain at the server. No env config beyond `LEARNHOUSE_TENANCY=single` is needed.
   - The default org's slug (`default`) is shown in the URL bar at `/orgs/default/...` paths only when accessed directly; the middleware rewrites externally-clean paths internally.
4. **Custom per-org domains** (multi only): admins add the domain in the org settings, set up DNS to point at the platform, and verify ownership. Verified domains immediately resolve. Note that the CORS allowlist for verified custom domains is a known gap — newly-verified domains may need a backend restart for cross-origin API calls to succeed.

## File reference

Backend:
- `learnhouse/apps/api/config/config.py` — `LEARNHOUSE_TENANCY` env, validation
- `learnhouse/apps/api/src/routers/instance.py` — `instance/info` endpoint
- `learnhouse/apps/api/src/routers/auth.py` — `get_cookie_domain_for_request`
- `learnhouse/apps/api/src/services/email/utils.py` — `get_org_signup_base_url`
- `learnhouse/apps/api/app.py` — CORS branching
- `learnhouse/apps/api/src/core/ee_hooks.py` — `is_multi_org_allowed`, EE detection

Frontend:
- `learnhouse/apps/web/proxy.ts` — middleware (resolveTenant)
- `learnhouse/apps/web/ee/services/tenancy/core.ts` — pure resolver logic
- `learnhouse/apps/web/ee/services/tenancy/resolveMulti.middleware.ts` — Edge entry
- `learnhouse/apps/web/ee/services/tenancy/resolveMulti.server.ts` — Node entry
- `learnhouse/apps/web/services/org/orgResolution.ts` — server-side org resolution
- `learnhouse/apps/web/services/auth/cookies.ts` — cookie options
- `learnhouse/apps/web/services/config/config.ts` — `getTenancy`, `getUriWithOrg`
