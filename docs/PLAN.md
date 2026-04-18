# Hebrew-first LMS — Wix storefront + Grow checkout + LH headless

## Context

We forked `learnhouse/learnhouse` (Next.js 16 + FastAPI LMS) at `/home/user/coins`. The near-term goal is to launch a paid course for the user's sister; the longer-term goal is to help other Israeli creators on the same platform.

The architecture changed mid-planning. The previous direction was "fork LH and bolt Stripe-IL onto it." After weighing operational cost (VAT display, חשבונית מס/קבלה, תשלומים, Bit, payouts to an Israeli bank, Hebrew receipts) we concluded the commerce layer should live **outside** LH in a managed Israeli stack, and LH should remain the learner-experience engine only.

**Final architecture (Architecture B):**

```
[Wix site — marketing, catalog, Hebrew-first]
            │
            ▼  (Buy now button)
[Grow by Meshulam — checkout, ILS, קבלה, Bit, תשלומים, payouts]
            │
            ▼  (success webhook)
[Node.js/TS bridge service]
            │
            ├── POST /enrollments → LH FastAPI (upsert user, enroll in course)
            └── send magic-link email → Resend
                          │
                          ▼
                 [LearnHouse (headless) — learner plays course, RTL + He]
```

**Why this split:**
- Wix gives the sister a drag-and-drop Hebrew storefront she can own. No code for marketing copy changes.
- Grow by Meshulam is IL-native: ILS, automatic חשבונית מס/קבלה on every transaction, Bit, תשלומים, payouts to an Israeli bank. It removes the entire VAT/invoicing backlog from our plate.
- LH stays as the LMS — headless from the buyer's perspective. The user lands in LH only via a magic link after purchase.
- The bridge is ~200 lines of TS. It's the only "custom" code in the commerce path.

**Scope decisions (carried over from conversation):**
- **Customer-facing**: He + En both first-class on Wix and LH.
- **Admin-facing**: English-only. The sister uses Wix admin (He UI available natively) and Grow admin (He native) for commerce; LH admin for course content stays English.
- **Payments**: one-time only. No installments management on our side — if תשלומים is offered, Grow handles it.
- **Email**: Resend for transactional (magic-link + enrollment confirmation). Grow sends the קבלה separately.
- **Fork freedom**: we're free to diverge from upstream LH. Upstream-mergeability is nice-to-have, not a constraint.

Work happens on branch `claude/rtl-stripe-integration-uGQRo` (branch name kept for continuity).

## Phase 1 — LH RTL + Hebrew foundations

Goal: learner experience renders natively in Hebrew with no visual regressions in English.

1. **Tailwind upgrade to 4.2** — `apps/web/package.json` (current: 4.1.16). Confirms full logical-property utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s`, `border-e`, `rounded-s-*`, `rounded-e-*`, `float-start`, `float-end`, `inset-inline-*`).
2. **Dynamic `<html lang dir>`** — `apps/web/app/layout.tsx:26`. Replace hardcoded `lang="en"` with a server-computed language from cookie/Accept-Language, default `he`, and set `dir` from a direction map (`he`, `ar`, `fa`, `ur` → `rtl`; rest → `ltr`). Keep the existing `I18nProvider` in sync — expose a small `setLangCookie` + `router.refresh()` flow so client language changes re-render the `<html>` shell.
3. **Locale detection + cookie** — new `apps/web/services/i18n/serverLocale.ts` with `getServerLocale()` reading `NEXT_LOCALE` cookie, falling back to `Accept-Language`, defaulting to `he`. Use it from `layout.tsx` and server components that format.
4. **Hebrew locale file** — add `apps/web/locales/he.json` mirroring `en.json`. Leave strings as English initially; translate incrementally in Phase 2. The existing `i18next` setup already lazy-loads locale bundles.
5. **Hebrew-capable default font** — `apps/web/app/layout.tsx` swaps `Wix Madefor Text` for **Rubik** (already in `apps/web/lib/fonts.ts`). Keep a Latin fallback.
6. **Codemod: LTR → logical utilities** — one-pass script at `apps/web/scripts/codemod-rtl.mjs`. Replace inside `className="…"` and `cn(...)` call-sites only:
   - `ml-` → `ms-`, `mr-` → `me-`
   - `pl-` → `ps-`, `pr-` → `pe-`
   - `left-` → `start-`, `right-` → `end-`
   - `text-left` → `text-start`, `text-right` → `text-end`
   - `border-l` → `border-s`, `border-r` → `border-e`
   - `rounded-l-*` → `rounded-s-*`, `rounded-r-*` → `rounded-e-*`
   - `float-left` → `float-start`, `float-right` → `float-end`

   Exclude vendored/generated code. Manual review pass on ~10 heavy files and on semantically-LTR content (code blocks, video scrubber → explicit `dir="ltr"`).
7. **Locale-aware formatters** — new `apps/web/lib/format.ts` with `formatMoney(amount, currency, locale?)` and `formatDate(d, locale?)`. Replace hardcoded `'en-US'` sites:
   - `apps/web/components/Objects/Account/subpages/AccountPurchases.tsx:30,37`
   - `apps/web/components/Objects/Courses/CourseActions/CourseActionsMobile.tsx`
   - `apps/web/components/Objects/Courses/CourseActions/OfferCard.tsx`
   - `apps/web/components/Payments/PaymentWall.tsx`

   Defaults: `locale = getClientLocale() ?? 'he-IL'`, `currency = 'ILS'`.

**Removed from this phase** (vs. previous plan): ILS offer-currency default and Stripe `locale: 'he'` — we no longer use LH's Stripe integration. The learner lands in LH already enrolled; PaymentWall becomes a dead code path for our instance (still renders correctly for upstream but never triggered by our flow).

## Phase 2 — LH learner-surface Hebrew polish

Goal: every learner-facing screen reads natively in Hebrew. Admin screens stay English.

1. **Translate `he.json`** in learner-priority order:
   1. Auth (sign in / password reset — magic-link landing needs to look right)
   2. Course player: lesson view, video, activity (`apps/web/app/orgs/[orgslug]/(withmenu)/course/...`)
   3. Account: purchases, profile, settings
   4. Course catalog & detail (lower priority — sister's buyers won't browse LH; they buy on Wix)
   5. **Skip**: admin dashboard (`apps/web/app/orgs/[orgslug]/dash/**`) — English only
2. **Replace hardcoded strings** on learner surfaces:
   - `apps/web/components/Objects/Account/subpages/AccountPurchases.tsx:48,54,68`
   - Auth components (explore & enumerate before touching)
3. **Icon/direction audit** — directional Phosphor/Lucide icons (arrows, chevrons, back-buttons, step indicators) on learner surfaces. Either wrap in a `<DirAware>` helper that flips under `dir=rtl`, or pair each with its mirror.
4. **Typography polish for Hebrew** — `.lang-he` rule in `apps/web/app/globals.css`: tighter line-height, slightly larger base size, `letter-spacing: normal`.
5. **Date strings** — `dayjs.locale('he')` where relative time shows (`DiscussionDetail.tsx`, `CommentCard.tsx`).

## Phase 3 — Wix storefront

Goal: a Hebrew-first marketing site the sister can own, with a "Buy now" button that hands off to Grow.

Not our code — this is Wix editor work. Captured here so the plan is complete.

1. **Wix site** — He default, En as secondary via Wix Multilingual. One course = one product page.
2. **Catalog page** — course cards with title, price (₪), short description. CTA → Grow checkout URL (per-course).
3. **Content sync** — manual for now. Course title/description/price edited in Wix; LH has its own content (lessons) edited in LH admin. These are deliberately decoupled at launch.
4. **Buy button** → deep-links to the Grow hosted checkout URL for that course, with `course_id` as a custom field so the webhook carries it back.

## Phase 4 — Grow by Meshulam checkout

Goal: Israeli-native checkout that Does The Right Thing on tax, receipts, payouts.

Also not our code — this is Grow admin config.

1. **Account setup** — register under the sister's עוסק פטור/מורשה details; configure payout bank.
2. **One product per course** — name (He), price (ILS), one-time.
3. **Custom field**: `course_id` (required, hidden, populated from Wix buy-button URL).
4. **Auto-receipt** — enable automatic קבלה issuance on successful payment; emailed to buyer by Grow.
5. **Webhook** — configure success webhook → `https://<bridge-host>/webhooks/grow` with Grow's signing secret.
6. **Test mode** — do a 1₪ real transaction end-to-end before go-live.

## Phase 5 — Node.js bridge service

Goal: a small, dedicated service that turns a Grow "paid" webhook into an LH enrollment + magic-link email.

**New repo/folder**: `services/bridge/` inside this monorepo (or a sibling repo — decide during setup). Node.js + TypeScript. Framework: Hono (tiny, fits this scope) or Fastify.

**Endpoints:**
- `POST /webhooks/grow` — verifies Grow HMAC signature, parses payload, calls LH API to upsert user + enroll, triggers Resend email. Idempotent on Grow transaction ID.
- `GET /health` — liveness for the deploy target.

**Flow:**
1. Receive webhook → verify signature (reject if invalid).
2. Check idempotency store (transaction ID → already processed?). If yes, 200 OK.
3. Extract `email`, `name`, `course_id`, `transaction_id` from payload.
4. Call LH FastAPI:
   - `POST /api/v1/users` (upsert by email) — returns LH user ID. (Verify the exact endpoint during implementation; may need a service-account token.)
   - `POST /api/v1/courses/{course_id}/enrollments` with the user ID.
5. Generate a magic-link token (signed JWT, 7-day expiry) → build URL `https://<lh-host>/auth/magic?token=...`.
6. Send via Resend: He-localized email template with the magic link and a "welcome to the course" message. Store `transaction_id` in idempotency store.
7. 200 OK to Grow.

**Error handling:**
- Webhook signature invalid → 401.
- LH API transient failure → 500 so Grow retries (Grow retries on 5xx by default; confirm during config).
- LH API permanent failure (e.g. bad `course_id`) → 200 to Grow but log + alert; manual fix.

**Storage:**
- Idempotency: Redis (already in the LH docker-compose) or a small SQLite file if we want zero new infra. Decide during setup.

**Secrets (env vars):**
- `GROW_WEBHOOK_SECRET`
- `LH_API_BASE_URL`, `LH_SERVICE_TOKEN`
- `RESEND_API_KEY`, `RESEND_FROM`
- `MAGIC_LINK_SIGNING_KEY`

**Deploy:**
- Target: Fly.io or Railway (single small VM). Free tier covers launch volume.
- Or run it inside the LH docker-compose as a sibling service — simplest during early iteration.

**Tests:**
- Unit: webhook signature verification, payload parsing, idempotency.
- Integration: fake-Grow-webhook → real LH dev instance → verify enrollment + email sent (Resend test mode).

## Phase 6 — Deferred / future

- **Content sync** Wix → LH course metadata (one source of truth). Fine to stay manual for launch.
- **Refunds** — for now, refund in Grow → manual LH unenroll via admin.
- **Coupons** — Grow supports these; wire through custom field if needed.
- **Multi-seller** — today we're single-tenant (sister). LH is already org-scoped so scaling to more sellers is a config exercise later.
- **Bit / תשלומים** — enable in Grow when the sister decides; no bridge change needed.
- **LH admin Hebrew** — if/when we onboard Hebrew-only operators.

## Critical files / repos

| Purpose | Path |
|---|---|
| HTML lang/dir | `apps/web/app/layout.tsx` |
| Default font | `apps/web/app/layout.tsx` + `apps/web/lib/fonts.ts` |
| Global CSS for RTL polish | `apps/web/app/globals.css` |
| Tailwind version | `apps/web/package.json` |
| Hebrew locale bundle | `apps/web/locales/he.json` (new) |
| Server locale helper | `apps/web/services/i18n/serverLocale.ts` (new) |
| Formatters | `apps/web/lib/format.ts` (new) |
| Codemod | `apps/web/scripts/codemod-rtl.mjs` (new, one-shot) |
| Hardcoded `en-US` formatters | `apps/web/components/Objects/Account/subpages/AccountPurchases.tsx:30,37`; `.../CourseActionsMobile.tsx`; `.../OfferCard.tsx`; `apps/web/components/Payments/PaymentWall.tsx` |
| Hardcoded learner-side strings | `apps/web/components/Objects/Account/subpages/AccountPurchases.tsx:48,54,68` (+ auth components TBD) |
| Bridge service | `services/bridge/` (new) — Hono app, webhook handler, LH client, Resend client |
| Bridge entry | `services/bridge/src/index.ts` |
| Grow webhook handler | `services/bridge/src/webhooks/grow.ts` |
| LH API client | `services/bridge/src/clients/learnhouse.ts` |
| Resend email | `services/bridge/src/email/welcome.ts` + He template |

Not modified here (external systems): Wix site, Grow account.

## Existing utilities to reuse

- **i18next infra** (`apps/web/services/i18n/`) — already wired with 19 locale bundles and lazy loading.
- **Font catalog** (`apps/web/lib/fonts.ts`) — Rubik and Noto Sans already defined.
- **LH user + enrollment API** (`apps/api/ee/services/payments/...` has the server-side enrollment creation logic that runs after Stripe succeeds). The bridge can POST to the same endpoints Stripe success flow hits, bypassing Stripe entirely. **Verify the exact public endpoints** during bridge implementation before committing to the call shape.
- **LH Redis** (`docker-compose.yml`) — reuse for bridge idempotency instead of standing up new infra.
- **Docker compose** (`docker-compose.yml`) — add the bridge as a sibling service for local dev.

## Verification

**LH build & typecheck:**
```
cd apps/web && bun install && bun run lint
cd apps/api && uv sync && uv run ruff check && uv run pytest
```

**RTL smoke test:**
1. `npx learnhouse dev` → Postgres, Redis, API, Web, Collab up.
2. Open the app; confirm `<html lang="he" dir="rtl">` in devtools.
3. Switch to English via the language switcher → confirm `<html lang="en" dir="ltr">` and layout mirrors cleanly.
4. Walk through the course player, account purchases, auth pages in both directions. No clipped text, misaligned icons, overlapping chevrons.
5. Cross-browser: Chrome, Firefox, Safari (desktop), iOS Safari.

**Bridge integration smoke test:**
1. `cd services/bridge && bun run dev` (or `npm run dev`).
2. POST a fake Grow webhook payload to `localhost:3001/webhooks/grow` with a valid HMAC signature for `GROW_WEBHOOK_SECRET`.
3. Verify: LH DB has a new user + enrollment row for `course_id`.
4. Verify: Resend test-mode log shows the He magic-link email.
5. Click the magic link → lands in LH → auto-signed-in → course is accessible.
6. Replay the same webhook → idempotent (no duplicate enrollment, no duplicate email).

**End-to-end smoke (production dry-run):**
1. Wix staging → click Buy → Grow test-mode checkout in He → complete with a test card.
2. Verify: Grow sends webhook to the bridge (deployed to staging host).
3. Verify: buyer receives two emails — קבלה from Grow, magic-link from Resend.
4. Verify: magic link opens LH in He, course unlocked.

**Regression:**
1. Switch LH to English → learner flow still works, no visual regression vs. upstream.

## Hosting (LH)

**Decided:** Hostinger VPS (`srv1557529.hstgr.cloud`, IP `187.127.146.51`, Ubuntu 24.04 + Docker Manager + Traefik preinstalled). The VPS already runs chatwoot, n8n, twenty, uptime-kuma, deepwiki-open, paperclip-srme behind the same Traefik — LH becomes another stack alongside them.

**Domain:** `lms.lanternroute.com` — subdomain of a domain the user already owns (same root as `chat.lanternroute.com` used by chatwoot). Before first deploy, add an A-record pointing `lms.lanternroute.com` → `187.127.146.51` so Let's Encrypt can issue the cert.

**Stack shape** (in `docker-compose.yml`, mirroring chatwoot's Traefik pattern):
- `lms` — built from `./Dockerfile` (single bundled image: nginx + Next.js web + FastAPI + collab websocket). Routed via Traefik label `Host(\`${LMS_HOST}\`)`, entrypoint `websecure`, cert resolver `letsencrypt`, loadbalancer port 80.
- `postgres` — `postgres:16-alpine`, volume `lms_postgres_data`.
- `redis` — `redis:7-alpine` with `--requirepass`, volume `lms_redis_data`.
- Volume `lms_content` → `/app/api/content` for filesystem uploads.

**Env** lives in `.env` (gitignored; template in `.env.example`). Key vars: `LMS_HOST`, `LEARNHOUSE_AUTH_JWT_SECRET_KEY` (32+ chars), `POSTGRES_*`, `REDIS_PASSWORD`, `LEARNHOUSE_RESEND_API_KEY`, `LEARNHOUSE_FRONTEND_DOMAIN`, `LEARNHOUSE_COOKIE_DOMAIN`, `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL`.

**Deploy** (paste-in flow):
1. Point DNS A-record `lms.lanternroute.com` → `187.127.146.51`.
2. Hostinger panel → Docker Manager → Compose → new project, name `lms`.
3. Paste `docker-compose.yml`; in the Environment tab fill every blank in `.env.example` (generate secrets with `python -c "import secrets; print(secrets.token_urlsafe(32))"`).
4. Deploy. First build takes ~10–15 min.
5. Hit `https://lms.lanternroute.com` — verify Hebrew/RTL rendering.

Updates after the first deploy: push to the branch, SSH to VPS, `cd` to the project dir, `git pull && docker compose up -d --build`. (No CI pipeline yet — deferred.)

## Open items to resolve during implementation

- LH enrollment API: confirm exact endpoint + auth shape (service token vs. admin user) before wiring the bridge.
- Bridge idempotency store: Redis (reuse LH's) vs. SQLite (zero-infra). Decide Phase 5 day 1.
- Bridge deploy target: LH docker-compose sibling (simplest) vs. Fly.io (isolated). Decide before go-live. With the Hostinger VPS already serving LH, adding the bridge as a sibling service in the same compose is now the leading option.
- Magic-link token format: plain signed JWT consumed by a new LH `/auth/magic` route, vs. leveraging LH's existing session/auth primitives. Explore LH auth code before committing.
- CI pipeline (GitHub Actions → SSH-build-deploy to the VPS): deferred. Current flow is manual `git pull && docker compose up -d --build` on the VPS.
