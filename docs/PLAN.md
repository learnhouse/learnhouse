# Hebrew-first LMS — Webflow storefront + Grow checkout + LH headless

## Context

We forked `learnhouse/learnhouse` (Next.js 16 + FastAPI LMS) at `/home/user/coins`. The near-term goal is to launch a paid course for the user's sister; the longer-term goal is (aspirationally) to help other Israeli creators on the same platform.

The architecture was revised twice. First revision: move commerce out of LH to a managed Israeli stack (Grow by Meshulam) to avoid owning VAT / חשבונית מס/קבלה / תשלומים / Bit / Israeli-bank payouts. Second revision (grill-me session 2026-04-19): move the marketing storefront from Wix to **Webflow** after confirming (a) Webflow's design ceiling and CMS match the editorial bar Maya wants, (b) Maya will accept the English admin in exchange, (c) Webflow has a first-party Claude MCP (released Feb 2026) so Claude can drive the build without a freelancer.

**Final architecture:**

```
[chofshi.co.il — Webflow: home / about / courses / blog / contact]
            │
            ▼  per-course "Buy now"
[Grow — ILS, קבלה, Bit, תשלומים, payouts]
            │
            ▼  success / refund webhook
[Node.js/TS bridge — services/bridge/]
            │
            ├── LH admin API: upsert user + enroll (12-mo expiry) / unenroll on refund
            ├── Mailchimp: add buyer to list / tag as refunded
            └── Resend: He magic-link email
                          │
                          ▼ click
[<brand-app>.co.il (fresh subdomain) — LH learner: gate page + course player]
```

**Why this split:**
- **Webflow** — editorial design ceiling, native CMS for the Hebrew blog, Claude MCP makes the build Claude-assisted (not a freelancer job). Accepted the English admin tradeoff since Maya co-edits with Eyal.
- **Grow** — IL-native. ILS, automatic חשבונית מס/קבלה per transaction, Bit, תשלומים, Israeli bank payouts. Removes the entire VAT/invoicing backlog.
- **LH** — headless from the buyer's perspective. Buyers land in LH only via a magic link post-purchase.
- **Bridge** — ~300 lines of TS. The only "custom" code in the commerce path.

**Scope decisions (grill-me canonical, 2026-04-19):**
- **Customer-facing**: He + En both first-class on Webflow and LH.
- **Admin-facing**: English-only across the stack. Maya accepts this in exchange for Webflow design ceiling.
- **Payments**: one-time only. תשלומים (installments) offered at Grow checkout; bridge doesn't manage installments.
- **Course access window**: **12 months** from purchase. Bridge sets expiry at enrollment time.
- **Displayed prices**: pre-VAT now (Maya is עוסק פטור); migrate to VAT-inclusive when she crosses to מורשה (~₪107K/yr threshold — verify current). A VAT-migration runbook handles the switch.
- **Promos at launch**: early-bird only (first 20–50 buyers at a discount). Two Grow products per course (early-bird + standard); Webflow CTA swaps at threshold.
- **Email**: Resend for transactional (He magic-link email). Grow sends the קבלה separately. Mailchimp is the canonical buyer list for broadcasts.
- **Refunds / chargebacks**: Grow refund webhook → bridge auto-unenrolls in LH and tags the contact in Mailchimp.
- **Magic-link expiry**: 7 days. Expired-link recovery is a self-serve reissue page on LH.
- **Build**: Eyal + Claude via the Webflow MCP. No freelancer at launch.
- **Launch target**: 2–3 months (comfortable scope — Tier 1 items + CRM + refund webhook all in scope).
- **Fork freedom**: we're free to diverge from upstream LH. Upstream-mergeability is nice-to-have, not a constraint.
- **Phase 6 multi-seller vision**: aspirational; no v1 architectural concessions.

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
   4. Course catalog & detail (lower priority — sister's buyers won't browse LH; they buy on Webflow)
   5. **Skip**: admin dashboard (`apps/web/app/orgs/[orgslug]/dash/**`) — English only
2. **Replace hardcoded strings** on learner surfaces:
   - `apps/web/components/Objects/Account/subpages/AccountPurchases.tsx:48,54,68`
   - Auth components (explore & enumerate before touching)
3. **Icon/direction audit** — directional Phosphor/Lucide icons (arrows, chevrons, back-buttons, step indicators) on learner surfaces. Either wrap in a `<DirAware>` helper that flips under `dir=rtl`, or pair each with its mirror.
4. **Typography polish for Hebrew** — `.lang-he` rule in `apps/web/app/globals.css`: tighter line-height, slightly larger base size, `letter-spacing: normal`.
5. **Date strings** — `dayjs.locale('he')` where relative time shows (`DiscussionDetail.tsx`, `CommentCard.tsx`).

## Phase 3 — Webflow storefront

Goal: an editorial Hebrew-first marketing site with a Hebrew blog, built via the Webflow Claude MCP, that hands off per-course purchases to Grow.

Not LH code — Webflow project work driven by the Webflow MCP (released Feb 2026). Captured here so the plan is complete.

1. **Webflow project** — Maya's account. Hebrew primary, English secondary via Webflow Localization. Editorial template or blank canvas; built via the Webflow MCP.
2. **Pages** — home, about, courses (one page per course), blog, contact.
3. **CMS collections** — `courses` (title, slug, short description, long description, price, hero image, `course_uuid` = LH UUID, `grow_early_bird_url`, `grow_standard_url`, `early_bird_active` boolean), `blog_posts` (title, slug, category, body, hero, author), `testimonials` (name, photo, quote, course reference).
4. **Buy button** — per-course CTA deep-links to the active Grow checkout URL (`early_bird_active` toggles which of the two URLs renders). Both URLs carry `course_uuid` as a hidden `course_id` custom field so Grow echoes it back in the webhook.
5. **Blog** — Hebrew-first, categories seeded: debt / budgeting / mindset / investing / tools. SEO content engine for Israeli financial search terms.
6. **Branding** — fonts, palette, logo defined in `/opt/lms/docs/BRAND.md` (new); both Webflow and LH `OrgEditBranding` reference the same source of truth.
7. **DNS** — `chofshi.co.il` (or whichever Maya picks) → Webflow. A fresh brand-family subdomain (e.g. `app.<marketing-domain>`) → LH instance.
8. **DKIM / SPF / DMARC** on the marketing domain for Resend (so magic-link emails don't hit Gmail spam).
9. **Cross-domain GA4** — single measurement ID across Webflow + LH for full-funnel visibility.
10. **Content sync** — manual for now. Course title/description/price edited in Webflow; LH holds the actual lessons in its admin. Decoupled at launch; `check-course-ids` + `check-prices` scripts (Phase 5) catch drift.

## Phase 4 — Grow checkout

Goal: Israeli-native checkout that Does The Right Thing on tax, receipts, payouts.

Not our code — Grow admin config. Grow rebranded `grow.meshulam.co.il` → **`grow.business`** (Meshulam Payment Solutions Ltd.).

### Pricing (Apr 2026, excluding VAT)

| Plan | Monthly | Per-transaction | Best for |
|---|---|---|---|
| **Pay-per-use** | ₪0 | 1.7% + ₪1 (drops to **1.5% + ₪1** above ₪5K/mo volume) | Launch / variable volume |
| **Service plan** | ₪59 | 1.5% (no fixed fee) | Steady ≥ ~₪15K/mo |

Crossover (avg ₪500/sale): pay-per-use cheaper up to ~30 sales/mo. **Launch on pay-per-use; switch around ~₪15K/mo.**

### Supported methods (bundled)
Credit cards (Visa / Mastercard / Isracard / Amex), **Bit**, **תשלומים** (3/6/12 mo on cards), Apple Pay, Google Pay, direct bank charge. Auto-issued **חשבונית מס/קבלה** on every transaction.

### Account opening (online, digital, 2–5 business days post-submission)

1. Sign up at https://grow.business/ (Maya's email + phone).
2. Submit:
   - **עוסק פטור** or **עוסק מורשה** number (longest lead time — if not registered, handle at רשות המסים first, 1–2 weeks).
   - תעודת זהות.
   - Israeli bank account for payouts (IBAN / account+branch).
   - Business description + expected monthly turnover.
3. KYC: selfie + ID.
4. Bank verification: Grow tests a small deposit.

Payouts: T+2 to T+3 business days, no payout fee mentioned.

### Products (per course)

Two Grow products per course at launch, supporting the early-bird mechanic:
- **early-bird** — discounted price; linked from Webflow while `early_bird_active = true`.
- **standard** — regular price; linked from Webflow once the threshold is hit.

Both products have:
- **Custom field**: `course_id` (required, hidden, populated from the Webflow buy-button URL; value = LH `course_uuid`).
- Auto-קבלה enabled.

### Webhooks (bridge-consumed)

- **Success**: `https://<bridge-host>/webhooks/grow` — signed with per-account secret (`GROW_WEBHOOK_SECRET`). Carries `transaction_id`, amount, buyer email/name, custom fields.
- **Refund / chargeback**: same endpoint, dispatched internally by event type in the bridge. Triggers LH unenroll + Mailchimp tagging.
- **Test mode**: use for e2e smoke (₪1 real transaction before go-live).

### Developer docs
- API + webhook reference: **https://grow-il.readme.io** (Postman collection included).

### Gotchas

- **VAT**: Grow fees exclude 17% VAT. Real cost ~17% higher than headline.
- **עוסק פטור threshold**: ~₪107K/yr (verify current). Above → must register as מורשה (17% VAT charged to customers). If year-1 projections cross the line, register as מורשה from the start.
- **Bit + תשלומים**: Bit doesn't support installments. Bit payers pay full upfront. Note in Hebrew on the checkout page.
- **Webhook retries**: Grow retries on 5xx. Bridge must be idempotent on `transaction_id` (see Phase 5).

## Phase 5 — Node.js bridge service

Goal: a small, dedicated service that turns Grow webhooks (success + refund) into LH enrollment/unenrollment + Mailchimp sync + magic-link email.

**Folder**: `services/bridge/` inside this monorepo. **Stack**: Bun + TypeScript + Hono + zod (decided; scaffold exists as of commit `f0ed2d96`).

**Endpoints:**
- `POST /webhooks/grow` — verifies Grow HMAC signature, parses payload (zod), dispatches by event type. Idempotent on `transaction_id`.
- `GET /health` — liveness for the deploy target and UptimeRobot.

**Flow — success path:**
1. Receive webhook → verify signature (reject 401 if invalid).
2. Check idempotency store (transaction ID → already processed?). If yes, 200 OK.
3. Extract `email`, `name`, `course_uuid`, `transaction_id`, `amount` from payload.
4. Call LH admin API (token-gated; mint at `POST /api/v1/orgs/{org_id}/api-tokens`):
   - `GET /api/v1/admin/{org_slug}/users/by-email/{email}` — find existing buyer; 404 → not yet a member.
   - If 404: `POST /api/v1/admin/{org_slug}/users` (`ProvisionUserRequest`) to create + attach in one call. Email is auto-verified, no signup-flow email triggered.
   - `POST /api/v1/admin/{org_slug}/enrollments/{user_id}/{course_uuid}` — atomic Trail + TrailRun create, with **`expires_at = now + 12 months`** per the 12-month access-window decision. Returns 400 if already enrolled (treat as success: `{ alreadyEnrolled: true }`; do not reset expiry).
5. `POST /api/v1/admin/{org_slug}/auth/magic-link` (`MagicLinkRequest`: `user_id`, optional `redirect_to`, `ttl_seconds` up to 604800 = 7 days). Returns `{ url, token, expires_at }`. The URL is what the buyer clicks to land logged-in. (Earlier draft proposed rolling our own JWT — unnecessary; LH ships this.)
6. **Mailchimp**: `POST /lists/{MAILCHIMP_LIST_ID}/members` — add buyer with tags `course-<slug>` and `early-bird` if applicable. Idempotent on email.
7. Send via Resend: He-localized email template embedding the magic-link URL and a "welcome to the course" message. Store `transaction_id` in idempotency store with status `success`.
8. 200 OK to Grow.

**Flow — refund / chargeback path:**
1. Receive webhook → verify signature → event type is `refund` or `chargeback_loss`.
2. Check idempotency store (refund event ID → already processed?). If yes, 200 OK.
3. Look up the original `transaction_id` in the idempotency store to get `user_id` + `course_uuid`.
4. `DELETE /api/v1/admin/{org_slug}/enrollments/{user_id}/{course_uuid}` — LH unenroll (remove Trail + TrailRun).
5. **Mailchimp**: `POST /lists/{id}/members/{hash}/tags` — add tag `refunded-<course-slug>`. Do not remove from list (keeps future broadcast targeting flexible).
6. Store refund event ID in idempotency store with status `refunded`.
7. 200 OK to Grow.

All admin endpoints require an API token created at `/api/v1/orgs/{org_id}/api-tokens` with at least `users.action_create/read/update`, `courses.action_read`, and `enrollments.action_create/delete` rights (see `apps/api/src/db/roles.py:39-72`). The bridge stores the token as `LH_ADMIN_TOKEN`; LH validates token org-boundary on every call.

**Error handling:**
- Webhook signature invalid → 401.
- Zod parse failure → 400.
- LH API transient failure → 500 so Grow retries (Grow retries on 5xx by default; confirm during Grow config).
- LH API permanent failure (e.g. bad `course_uuid`) → 200 to Grow but log + alert; manual replay via script.
- Mailchimp failure → log + alert but do NOT fail the webhook; enrollment + email must succeed even if Mailchimp is down.

**Storage (idempotency)**: **SQLite** — single file at `services/bridge/data/idempotency.sqlite`. Decided: zero new infra, fault-isolated from LH's Redis, trivially backed up. Schema: one table keyed by `event_id` with `transaction_id`, `event_type`, `user_id`, `course_uuid`, `status`, `processed_at`.

**Secrets (env vars):**
- `GROW_WEBHOOK_SECRET`
- `LH_API_BASE_URL`, `LH_ADMIN_TOKEN`
- `MAILCHIMP_API_KEY`, `MAILCHIMP_LIST_ID`, `MAILCHIMP_DC` (data-center prefix, e.g. `us21`)
- `RESEND_API_KEY`, `RESEND_FROM`

**Deploy**: **Hostinger VPS sibling** — add `bridge` service to `docker-compose.yml` alongside `lms`, `postgres`, `redis`. Traefik-routed at `bridge.<marketing-domain>` or internal. Decided over Fly.io because (a) VPS already hosts LH; (b) bridge idempotency + Grow retries make VPS-level outages tolerable; (c) simplest ops footprint.

**Monitoring + alerting:**
- **UptimeRobot** ping on `/health` every 5 min; alert to Slack + email on 2 consecutive fails.
- **Log-level alerting**: any ERROR log → Slack webhook.
- **Daily reconciliation**: cron `0 6 * * *` runs `bun run reconcile` — diffs Grow `GET /transactions?since=yesterday` against the idempotency store; alerts on any Grow transaction with no matching bridge record.

**Scripts (`services/bridge/scripts/`):**
- `bun run replay --transaction-id=<id>` — fetch transaction details from Grow API, synthesize an internal webhook, dispatch through the normal handler (respects idempotency). Manual recovery tool.
- `bun run check-course-ids` — query LH courses via `GET /api/v1/admin/{org_slug}/courses`, query Grow products via Grow API, diff `course_id` custom-field values. Exit non-zero on mismatch.
- `bun run check-prices` — query Webflow CMS items for `courses` collection via Webflow Data API, query Grow product prices, diff per course. Exit non-zero on mismatch.
- `bun run reconcile` — daily cron (see above).

**Tests:**
- Unit: webhook signature verification, payload parsing, idempotency.
- Integration: fake-Grow-webhook → real LH dev instance → verify enrollment + email sent (Resend test mode).

## Phase 6 — LH learner-app additions (at launch)

Small, targeted LH changes beyond Phases 1–2.

1. **Magic-link reissue page** — new route `apps/web/app/auth/magic/request/page.tsx`. Public page, Hebrew. Email input → on submit, call a new LH endpoint `POST /api/v1/auth/magic-link/reissue` that checks the email against active enrollments and (if found) generates a new magic link via the same internal helper used by the bridge path, emails it via Resend. Rate-limit per email (e.g. 3/hour) to prevent abuse. ~50–100 lines on LH + a public endpoint.
2. **Branding source-of-truth** — `OrgEditBranding` populated from `/opt/lms/docs/BRAND.md` (new): fonts, palette (hex), logo SVG, favicon. Same values used in Webflow.
3. **Custom learner domain** — add a fresh brand-family subdomain (e.g. `app.chofshi.co.il`) as an alias in Traefik + LH's `top_domain`. Keep `lms.lanternroute.com` as a fallback until cutover is verified.

## Phase 7 — Post-launch (deferred)

- **Free preview path** — (a) mark lesson 1 public-visibility in LH + link from Webflow "Preview this course" button; (b) lead-magnet PDF (email-gated) as a top-of-funnel entry. Both deferred to post-launch per the 2–3 month comfortable-scope decision.
- **Coupons / discount codes** — beyond early-bird, for affiliates/partners. Grow supports; wire through a `coupon_code` custom field if needed.
- **Payment plans** — 3× ₪200 instead of ₪497 upfront; Grow supports on credit cards (תשלומים covers most cases; anything beyond needs Grow's payment-plan product).
- **Multi-seller (aspirational)** — today single-tenant (Maya). No v1 architectural concessions. LH is already org-scoped; scaling is a config + onboarding exercise when concrete.
- **LH admin Hebrew** — if/when we onboard Hebrew-only operators.
- **Content sync automation** — Webflow CMS course fields ↔ LH course metadata as a one-way push. `check-course-ids` + `check-prices` are stop-gaps; a real sync can come later.
- **CI pipeline** — GitHub Actions → SSH-build-deploy to the VPS. Manual `git pull && docker compose up -d --build` for now.

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
| Bridge service | `services/bridge/` — Hono + Bun + TS + zod; webhook handler, LH client, Mailchimp client, Resend client |
| Bridge entry | `services/bridge/src/index.ts` |
| Grow webhook handler | `services/bridge/src/webhooks/grow.ts` |
| LH admin client | `services/bridge/src/clients/learnhouse.ts` |
| Mailchimp client | `services/bridge/src/clients/mailchimp.ts` (new) |
| Resend email | `services/bridge/src/email/welcome.ts` + He template; `refund.ts` (new) + He template |
| Idempotency store | `services/bridge/data/idempotency.sqlite` (gitignored) |
| Bridge scripts | `services/bridge/scripts/{replay,check-course-ids,check-prices,reconcile}.ts` |
| Magic-link reissue (LH) | `apps/web/app/auth/magic/request/page.tsx` (new) |
| Magic-link reissue endpoint (LH) | `apps/api/src/routers/auth/magic_reissue.py` (new) |
| Brand source-of-truth | `/opt/lms/docs/BRAND.md` (new) |
| Runbooks | `/opt/lms/docs/RUNBOOKS.md` (new) — webhook-secret rotation, data-deletion (GDPR/IL Privacy), refund procedure, VAT migration, course-id alignment |

Not modified here (external systems): Webflow project, Grow account, Mailchimp account.

## Existing utilities to reuse

- **i18next infra** (`apps/web/services/i18n/`) — already wired with 19 locale bundles and lazy loading.
- **Font catalog** (`apps/web/lib/fonts.ts`) — Rubik and Noto Sans already defined; **Heebo** set as the live default (verified on the running instance).
- **LH admin API** — `GET/POST/DELETE /api/v1/admin/{org_slug}/...` is the real surface the bridge uses (per the Phase 5 correction). Stripe payment-flow code in `apps/api/ee/services/payments/...` is a dead code path for our instance and not used.
- **Docker compose** (`docker-compose.yml`) — add the bridge as a sibling service alongside `lms`, `postgres`, `redis`.

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
1. `cd services/bridge && bun run dev`.
2. POST a fake Grow **success** webhook payload to `localhost:3001/webhooks/grow` with a valid HMAC signature.
3. Verify: LH has a new user + enrollment row for `course_uuid` with `expires_at = now + 12 months`.
4. Verify: Mailchimp has the contact with tags `course-<slug>` + (optionally) `early-bird`.
5. Verify: Resend test-mode log shows the He magic-link email.
6. Click the magic link → lands in LH → auto-signed-in → course is accessible.
7. Replay the same webhook → idempotent (no duplicate enrollment, no duplicate email, no duplicate Mailchimp contact).
8. POST a **refund** webhook for that transaction → verify LH unenroll + Mailchimp tag `refunded-<slug>` applied.
9. Run `bun run replay --transaction-id=<id>` after clearing the idempotency row → verify enrollment re-created.

**Magic-link reissue smoke:**
1. Generate a magic link with 10-second TTL; wait for expiry.
2. Click → "expired" page. Navigate to `/auth/magic/request`, enter buyer email.
3. Verify: new magic-link email arrives; rate-limit after 3 requests in an hour.

**End-to-end smoke (production dry-run):**
1. Webflow staging → click Buy on a course page → Grow test-mode checkout in He → complete with a test card.
2. Verify: Grow sends webhook to the bridge (staging host).
3. Verify: buyer receives two emails — קבלה from Grow, He magic-link from Resend.
4. Verify: magic link opens LH at the fresh brand-family subdomain, course unlocked.
5. Issue a refund in Grow sandbox → verify refund webhook → LH unenroll → Mailchimp tag.

**Check-script smoke:**
1. `bun run check-course-ids` — clean output across all courses.
2. `bun run check-prices` — clean output across all courses.
3. Introduce a deliberate price mismatch in Grow → verify script exits non-zero with clear diff.

**Monitoring smoke:**
1. Stop the bridge container; within 10 min UptimeRobot alert fires to Slack + email.
2. Bring it back up; alert clears.

**DKIM/SPF/DMARC:**
1. Send a magic-link email to a Gmail test account → lands in Inbox, not Spam.
2. `dig TXT <marketing-domain>` shows correct SPF/DMARC records.

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

## Resolved decisions (grill-me 2026-04-19)

| Topic | Decision |
|---|---|
| LH enrollment API | Real LH admin endpoints (Phase 5 spec). `LH_ADMIN_TOKEN` scoped with required rights. |
| Magic-link format | LH's built-in `POST /api/v1/admin/{org_slug}/auth/magic-link`. Bridge does not roll its own JWT. |
| Bridge idempotency store | **SQLite** (zero new infra, fault-isolated from LH Redis). |
| Bridge deploy target | **Hostinger VPS sibling** of LH (migrate to Fly.io only if reliability warrants). |
| Bridge framework / runtime | Hono + Bun + TypeScript + zod. |
| Marketing storefront | **Webflow** (built via Claude MCP; not Wix). |
| Hebrew blog | Webflow CMS. |
| Course access window | 12 months; bridge sets expiry at enrollment. |
| VAT display | Pre-VAT while עוסק פטור; migrate to VAT-inclusive at מורשה (runbook). |
| Promos at launch | Early-bird only (two Grow products per course; Webflow CTA swap). |
| Refunds / chargebacks | Grow refund webhook → bridge auto-unenrolls + Mailchimp tags. |
| CRM | Mailchimp — bridge adds every buyer; refunds tagged (not removed). |
| Magic-link expiry UX | Self-serve reissue page on LH. |
| Bridge monitoring | UptimeRobot + Slack alerts + replay script + daily reconcile. |
| Data drift | `check-course-ids` + `check-prices` scripts. |
| Free preview | Deferred post-launch (LH public lesson + lead-magnet PDF). |
| Phase 6 multi-seller | Aspirational; no v1 architectural concessions. |
| Launch target | 2–3 months comfortable scope. |
| Build ownership | Eyal + Claude via Webflow MCP. |

## Open items (Maya-gated)

- Final marketing domain (`chofshi.co.il` leading; `growmoney.co.il`, `klari.co.il` as backups; all three verified available on ISOC IL).
- עוסק פטור/מורשה registration at רשות המסים (longest lead item — 1–2 weeks if not already registered).
- Israeli business bank account for Grow payouts.
- First-cohort soft-launch invite list (10 friends/family at early-bird).
- First 3–5 blog post topics + outlines for SEO seed content.
- First course title + price + short/long description (Hebrew).
- Brand assets for `/opt/lms/docs/BRAND.md`: logo SVG, favicon, OG image, palette, typographic scale.

## Still-deferred (not blocking launch)

- CI pipeline (GitHub Actions → SSH-build-deploy to the VPS). Current flow is manual `git pull && docker compose up -d --build` on the VPS.
- Multi-tenant v2 architecture sketch (only if Phase 6 becomes concrete).
