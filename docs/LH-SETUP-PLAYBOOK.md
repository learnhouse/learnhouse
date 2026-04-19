# LearnHouse — MVP setup playbook (1 org, 2 courses, bridge enrollment)

## Context

Self-hosted LH at `https://lms.lanternroute.com`. OSS mode, single-tenant. One admin user (`admin@lanternroute.com`), one org (`slug=default`). The MVP target is **two Hebrew courses** for a single creator (operator's sister), with all commerce + enrollment driven by an external bridge (Wix + Grow → bridge → LH API). No LH paywall, no public catalogue, no self-signup.

This playbook is the result of a code-level audit of LH's API + plan/deploy gating. Phase A (feature locks + signup mode) is automatable via API and has already been executed; Phase B–C are content/asset decisions that require the operator. Phase 5 (bridge) is deferred to its own track.

---

## Visibility model (read this first — original playbook had it wrong)

LH does **not** have a per-course "access mode" / "enrolled-only" toggle. There is no enrollment gate on visibility — `Trail` only tracks progress. Course visibility is the cross-product of two booleans on `Course` (`apps/api/src/db/courses/courses.py:48-60`):

| `public` | `published` | Anonymous (logged-out) | Logged-in non-member | Org admin |
|----------|-------------|------------------------|----------------------|-----------|
| true     | true        | ✅ visible (search-indexed) | ✅ | ✅ |
| false    | true        | ❌ | ✅ (any logged-in user) | ✅ |
| any      | false       | ❌ | ❌ | ✅ |

To make a course **paid-only** in our world: combine `public=false, published=true` with `signup_mechanism=inviteOnly`. The bridge is then the only thing that can create user accounts, so only paid buyers can log in, so only paid buyers can see the course. There is no per-user entitlement check inside LH — entitlement = "you exist as a user".

Courses are addressed by `course_uuid` (UUID4-derived, ASCII), not by a name-derived slug. Hebrew course names produce no URL-safety risk.

---

## Visual map — admin panel tree (subset we touch)

```
/dash                                     home (stats, onboarding bar)
/dash/org/settings/
  /general                                org name, description, about, label, footer
  /branding                               logo, favicon, colors, font, auth-screen brand
  /landing                                learner landing hero + featured courses
  /seo                                    OG + meta for link previews
  /domains                                confirm lms.lanternroute.com canonical
  /features                               feature flags (already locked via API)
  /api                                    Phase-5 only — mint bridge token here
/dash/courses/
  /<new>                                  create course shell
  /course/<uuid>/general                  name, desc, learnings, thumbnail
  /course/<uuid>/content                  chapters + activities drag-drop
  /course/<uuid>/seo                      inherit org defaults
/dash/users/settings/
  /users                                  break-glass admin, test learner
```

**Skip entirely**: `/dash/payments`, `/dash/communities`, `/dash/boards`, `/dash/playgrounds`, `/dash/podcasts`, `/dash/org/settings/sso`, `/dash/org/settings/ai`, `/dash/courses/course/<uuid>/contributors`, `/dash/courses/course/<uuid>/certification`. Most are already feature-flagged off, so the menu items won't render — see `apps/web/lib/dashboard-menu-items.ts`.

---

## Logical map — data model (MVP)

```
Organization (slug=default, plan=free, OSS mode)
 └─ OrganizationConfig (admin_toggles JSON, customization JSON)
 └─ Course × 2 (public=false, published=true, course_uuid)
     └─ Chapter (order via drag)
         └─ ChapterActivity → Activity (video | dynamic[markdown|page] | assignment | document)

User (admin + test learner; later: bridge-created paid users)
 └─ UserOrganization (role_id 1=Admin, 4=User)
     └─ Trail (one per user × org — created on first course-add)
         └─ TrailRun (one per course enrolled)
             └─ TrailStep (one per Activity, complete/grade)
```

`bootstrap_from_env` (`apps/api/src/services/setup/setup.py`) already seeded org + config + 4 global roles + admin user + UserOrganization on first boot. No default Trail or Course is created by bootstrap.

OSS-mode plan enforcement is bypassed on the backend (`apps/api/src/security/features_utils/plans.py:257-280` + the 5df42a1e admin-API fix). Frontend may still render "Pro" badges on plan-gated panels — they're cosmetic only; backend will not 403.

---

## Phase A — feature locks (DONE via API)

Already executed against the live instance. Repeatable curl recipe:

```bash
JWT=$(curl -s -X POST https://lms.lanternroute.com/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@lanternroute.com&password=$ADMIN_PASSWORD" \
  | jq -r .tokens.access_token)

H="Authorization: Bearer $JWT"
B=https://lms.lanternroute.com/api/v1/orgs/1

# disable everything not in MVP scope
for q in \
  "config/payments?payments_enabled=false" \
  "config/communities?communities_enabled=false" \
  "config/boards?boards_enabled=false" \
  "config/podcasts?podcasts_enabled=false" \
  "config/playgrounds?playgrounds_enabled=false" \
  "config/collections?collections_enabled=true" \
  "config/ai?ai_enabled=false&copilot_enabled=false" \
  "signup_mechanism?signup_mechanism=inviteOnly"
do curl -s -o /dev/null -w "%{http_code} $q\n" -X PUT "$B/$q" -H "$H"; done
```

**Resulting state** (verified): `payments boards communities podcasts playgrounds ai = disabled`; `collections collaboration analytics api members = enabled`; `signup_mode = inviteOnly`. Endpoints live in `apps/api/src/routers/orgs/orgs.py:328-565`.

Notes from the audit:
- `analytics` left ON: events fire to Tinybird async, but Tinybird env vars are blank → calls gracefully no-op (`apps/api/src/services/analytics/analytics.py:34`). Safe to revisit if a Tinybird account is ever provisioned.
- `collaboration` left ON: only meaningful for boards (Yjs/Hocuspocus). With boards off, it's dead code in practice. No cost.
- `api` left ON: **required** for Phase 5 — bridge needs `/api-tokens` to mint a token.
- `collections` flipped ON (was off): no enforcement, no cost; useful if course #3+ ever ships.

---

## Phase B — org identity (operator only — content + asset decisions)

These need Hebrew copy + actual designs from the operator. Each row maps to an API endpoint so the operator can either use the admin UI or paste curl.

| Setting | UI | API endpoint | Notes |
|---------|----|--------------|-------|
| name, description, about, label | `/dash/org/settings/general` | `PUT /api/v1/orgs/1` | name ≤60, description ≤100, about ≤400 |
| logo | branding | `PUT /api/v1/orgs/1/logo` (multipart) | PNG, ≥200px tall |
| favicon | branding | `PUT /api/v1/orgs/1/favicon` (multipart) | 256×256 PNG |
| color, font, footer_text | branding | `PUT /api/v1/orgs/1/config/{color,font,footer_text}` | font: Heebo / Rubik / Assistant for HE |
| auth screen branding | branding | `PUT /api/v1/orgs/1/config/auth_branding` | this is what bridge buyers land on |
| auth background | branding | `PUT /api/v1/orgs/1/auth_background` (multipart) | optional |
| SEO defaults | `/seo` | `PUT /api/v1/orgs/1/config/seo` | title ≤60, desc ≤160 |
| OG image | `/seo` | `PUT /api/v1/orgs/1/og_image` (multipart) | 1200×630 |
| landing page | `/landing` | `PUT /api/v1/orgs/1/landing` | featured-courses payload below |
| domains | `/domains` | n/a | nothing to do — env vars already correct |

---

## Phase C — two courses

Per course (created via `POST /api/v1/courses/` form, or admin UI):

1. **Create shell** — name (HE, ≤60), description, learnings, thumbnail (16:9, ≥1280×720). Save the returned `course_uuid`.
2. **Set visibility** — `PUT /api/v1/courses/{course_uuid}` body `{"public": false, "published": false}`. Keep `published=false` until Phase D passes.
3. **Add chapters + activities** in admin UI (the block editor isn't friendly to scripted setup). Suggested shape per chapter:
   ```
   Chapter N (HE name ≤60)
    ├── Video      (YouTube unlisted preferred; hosted only if you need download control)
    ├── Markdown   (HE, 200–600 words, bullet takeaways — use the block editor, don't paste HTML)
    └── Assignment (2–4 self-graded questions, low-stakes)
   ```
   Drag order = learner progression.
4. **SEO** — inherit org defaults; only override per-course title/description if the OG card needs the course name.

After both courses exist, set them as featured on the landing page:

```bash
curl -X PUT "$B/landing" -H "$H" -H "Content-Type: application/json" -d '{
  "enabled": true,
  "sections": [{
    "type": "featured-courses",
    "title": "הקורסים שלנו",
    "courses": [
      {"course_uuid": "course_…COURSE_1_UUID"},
      {"course_uuid": "course_…COURSE_2_UUID"}
    ]
  }]
}'
```

---

## Phase D — pre-publish sanity (8 checks)

Before flipping each course's `published=true`:

1. Incognito hit course URL → 404 / login wall (since `public=false`). Confirms anonymous can't snoop.
2. Create `test@lanternroute.com` via `/dash/users/settings/users` (manual, since signup is invite-only). Log in as them, walk one full chapter end-to-end.
3. Lesson page renders `dir=rtl`, bullets/align right, video controls not weirdly mirrored.
4. No Latin-font bleed-through in HE headings (font-fallback check).
5. Thumbnail renders in course list, header, OG preview (use `curl -I` or a link debugger — but only for `public=true` URLs; ours stays private).
6. Completing an Activity advances `TrailStep.complete` (visible on learner's `/account` page) and fires `COURSE_ENROLLED` / step webhooks if any are wired.
7. Password-reset / magic-link flow: trigger from `/auth/reset` for `test@`, confirm the email arrives. **SMTP is the bridge's critical path — if Resend is unconfigured, paid buyers won't be able to log in.**
8. Only after 1–7 pass, `PUT /api/v1/courses/{uuid}` with `{"published": true}`. `public` stays `false`.

---

## Phase 5 — bridge (separate track)

LH has a dedicated **admin bridge API** at `/api/v1/admin/{org_slug}/...` that is exactly what we need. It's API-token-only (`_require_api_token` dep, see `apps/api/src/routers/admin.py:434`), so the bridge authenticates with a token rather than impersonating a user. The bridge's flow per purchase:

1. **Provision the buyer** — `POST /api/v1/admin/default/users/provision` (admin.py:658)
2. **Issue magic sign-in link** — `POST /api/v1/admin/default/.../magic-link` (admin.py:748) → email handed to Wix/Grow or sent via LH's SMTP (Resend)
3. **Enroll buyer in course** — `POST /api/v1/admin/default/enrollments/{user_id}/{course_uuid}` (admin.py:411). Creates Trail + TrailRun atomically, idempotent (returns 400 if already enrolled).

Bulk variants exist too: `POST .../enrollments/bulk` (admin.py:872) and `POST .../enrollments/bulk/unenroll` (admin.py:384). For 2 courses + low purchase volume, single-user calls are fine.

Mint the API token at `POST /api/v1/orgs/1/api-tokens`. Minimum rights set (validated against `apps/api/src/db/roles.py:39-72`):

```json
{
  "name": "wix-grow-bridge",
  "rights": {
    "users":         {"action_create": true, "action_read": true, "action_update": true},
    "courses":       {"action_read": true}
  }
}
```

The full secret is returned **once** — store in bridge secrets, never in LH config (`apps/api/src/services/api_tokens/api_tokens.py`).

There is also `POST /api/v1/admin/.../user-token` (admin.py:323) which mints a JWT for a specific user — useful if the bridge wants to drop the buyer straight into a logged-in session via a redirect URL instead of an email round-trip.

Resolved (was an open question in the previous draft): the legacy `/api/v1/trail/*` endpoints all act on the authenticated user (`apps/api/src/routers/trail.py:36,82,108,...`), but they're for the learner-facing UI, not for the bridge. The bridge uses `/api/v1/admin/.../enrollments/...` instead. No upstream patch required.

---

## Post-launch hygiene

- Rotate admin password from `/dash/users/settings/users` (and remove `LEARNHOUSE_INITIAL_ADMIN_PASSWORD` from `.env`).
- DB snapshot tagged `pre-first-paid-enrollment` (provider snapshot or `pg_dump`).
- Create `ops@lanternroute.com` as a break-glass second admin. Don't share the bootstrap `admin@` credential with the bridge.
- Weekly DB snapshot cron.

---

## Explicit "skip for now"

- **LH Payments** — commerce is Wix + Grow. Backend has no enforcement on the `payments` flag (`apps/web/lib/dashboard-menu-items.ts:73`); frontend menu just hides.
- **SSO / OAuth** — magic link is sufficient for paid buyers. Google OAuth env vars left blank.
- **SCORM** — irrelevant for creator-authored HE content; also EE-gated.
- **Communities / Boards / Playgrounds / Podcasts** — feature-flagged off; boards + playgrounds also Pro-gated.
- **Custom roles** — default Admin / Maintainer / Instructor / User is enough.
- **Certification tab** — v2, needs legal-grade copy first.
- **AI** — flipped off via `copilot_enabled=false`. Re-enable only when an LLM budget is a line item.
- **UserGroups** — create when course #3 ships or a cohort launch is planned.

---

## Critical files (for reference)

UI surfaces:
- `apps/web/components/Dashboard/Pages/Org/OrgEditGeneral/OrgEditGeneral.tsx`
- `apps/web/components/Dashboard/Pages/Org/OrgEditBranding/OrgEditBranding.tsx`
- `apps/web/components/Dashboard/Pages/Org/OrgEditFeatures/OrgEditFeatures.tsx`
- `apps/web/components/Dashboard/Pages/Org/OrgEditLanding/landing_types.ts` (featured-courses shape)
- `apps/web/components/Dashboard/Pages/Course/EditCourseGeneral/{EditCourseGeneral,ThumbnailUpdate}.tsx`
- `apps/web/lib/dashboard-menu-items.ts` (which menu items respect which feature flags)

Backend:
- `apps/api/src/db/organizations.py:30` — Organization
- `apps/api/src/db/organization_config.py:242` — OrganizationConfig (admin_toggles schema)
- `apps/api/src/db/courses/courses.py:48-75` — Course (`public`, `published`)
- `apps/api/src/db/courses/{chapters,activities}.py`
- `apps/api/src/db/trails.py:17` — Trail
- `apps/api/src/db/api_tokens.py` + `apps/api/src/db/roles.py:39-72` — API token rights
- `apps/api/src/routers/orgs/orgs.py:70-565` — feature_config_router (the endpoints we just used)
- `apps/api/src/routers/trail.py` — enrollment endpoints (validate the bridge gap noted in Phase 5)
- `apps/api/src/security/features_utils/plans.py:257-280` — OSS plan-bypass
