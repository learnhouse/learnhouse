# LearnHouse — first-org setup map + quality-seed playbook

## Context

Fresh self-hosted LH at `https://lms.lanternroute.com`. OSS mode, single-tenant. One admin user (`admin@lanternroute.com`), one default org (`slug=default, name="Default Organization"`), zero courses. The admin UI is English by design (Phase 2 of our PLAN.md scoped admin = EN only; learner surfaces get Hebrew). Goal of this plan: give the operator (you) an ordered, executable map of what to configure in the LH admin to reach a publishable first Hebrew course — without wandering into panels that are off-plan for us (LH payments, SSO, boards, etc.).

Commerce lives outside LH (Wix + Grow + bridge per PLAN.md). LH is the learner engine only. That constrains the setup: no LH paywall, no checkout config, no public course browsing. Enrollment arrives via bridge API call after Grow webhook.

---

## Visual map — admin panel tree

Only the sections relevant at launch. Full tree in the exploration agents' output; this is the subset you'll touch.

```
/dash                                   home (stats, onboarding bar)
/dash/org/settings/
  /general                              org name, description, about, label, footer
  /branding                             logo, favicon, colors, font, auth-screen brand
  /landing                              learner landing hero + featured courses
  /seo                                  OG + meta for link previews
  /domains                              confirm lms.lanternroute.com canonical
  /features                             feature flags — LOCK THESE EARLY
  /api                                  Phase-5 only — mint bridge token here
/dash/courses/
  /<new>                                create course shell
  /course/<uuid>/general                name, desc, learnings, thumbnail
  /course/<uuid>/content                chapters + activities drag-drop
  /course/<uuid>/access                 private/enrolled-only (required)
  /course/<uuid>/seo                    inherit org defaults
/dash/users/settings/
  /users                                break-glass admin, test learner
  /add                                  bulk invite — not used at launch
```

**Skip entirely at launch**: `/dash/payments`, `/dash/communities`, `/dash/boards`, `/dash/playgrounds`, `/dash/podcasts`, `/dash/org/settings/sso`, `/dash/org/settings/ai`, `/dash/courses/course/<uuid>/contributors`, `/dash/courses/course/<uuid>/certification`.

---

## Logical map — data model (minimum viable)

```
Organization (slug=default)
 └─ OrganizationConfig (plan=free, features JSON)
 └─ Course (published: bool, public: bool)
     └─ Chapter (order by drag)
         └─ ChapterActivity → Activity (type = video | dynamic[markdown|page|embed] | assignment | document | scorm | custom)

User (admin, + test learner)
 └─ UserOrganization (role_id = 1 for admin, 4 for learner)
     └─ Trail (one per user × org)
         └─ TrailRun (one per course enrolled)
             └─ TrailStep (one per Activity, tracks complete/grade)
```

Bootstrap (via our `bootstrap_from_env`) already seeded `Organization + OrganizationConfig + 4 global Roles + admin User + UserOrganization`. Everything else the operator creates manually. Publish is a **manual boolean toggle** on Course — no readiness validation.

---

## Playbook

### Phase A — Org identity (~10 min)

1. `/dash/org/settings/general` — rebrand org.
   Fill `name` (≤60 chars, e.g. `Coins Academy`), `description` (≤100, HE tagline), `about` (≤400, HE 2–3 sentences), `label` = closest category, `footer_text` (≤100, HE copyright).
   *Org slug `default` is not editable in UI. Leave as-is; bridge won't hardcode it.*
2. `/dash/org/settings/branding` — logo (PNG, ≥200px tall), favicon (256×256 PNG), pick a Hebrew-safe font (Heebo / Rubik / Assistant). Brand the auth screen — this is where bridge buyers land.
3. `/dash/org/settings/landing` + `/seo` — HE hero copy, SEO title ≤60 + desc ≤160, OG image 1200×630. Leave featured-courses list empty until Phase B.
4. `/dash/org/settings/domains` — verify `lms.lanternroute.com` is canonical. No action if env vars already correct.
5. `/dash/org/settings/features` — **lock the surface now**. Turn **OFF**: `payments`, `communities`, `boards`, `podcasts`, `playgrounds`. Leave `collections` on. **`payments` must stay OFF** — bridge handles entitlement, LH paywall would double-gate.

### Phase B — Course shell (~15 min)

1. `/dash/courses` → "New" — name ≤60, description, `learnings` bullets (all HE).
   *Verify auto-generated slug is URL-safe ASCII `[a-z0-9-]` only. If HE name produces percent-escapes, override to `coins-launch-v1`-style.*
2. `/course/<uuid>/general` — upload 16:9 thumbnail (≥1280×720 PNG/JPG).
3. `/course/<uuid>/access` — set **private / enrolled-only**. Default may already be — confirm.
4. `/course/<uuid>/seo` — inherit org defaults (no override needed).
5. **Skip**: contributors, certification — v2.

### Phase C — Content seed

Target: 3–5 chapters, each identical shape:

```
Chapter N (HE name ≤60)
 ├── Activity 1 — Video  (YouTube unlisted URL preferred; hosted only if you need control)
 ├── Activity 2 — Markdown notes  (HE, 200–600 words, bullet takeaways — use the block editor, don't paste HTML)
 └── Activity 3 — Assignment  (2–4 self-graded questions, low-stakes)
```

Drag-order chapters top→bottom = learner progression. Trail auto-tracks completion via TrailStep.

### Phase D — Pre-publish sanity (10 checks)

Before flipping `Course.published=true`:

1. Incognito hit of course URL → redirects to login (access gating works).
2. Create `test@lanternroute.com` via `/dash/users/settings/add`, enroll manually, walk one full chapter end-to-end.
3. Lesson page renders `dir=rtl`, bullets/align right, video controls not weirdly mirrored.
4. No Latin-font bleed-through in HE headings (font-fallback check).
5. Course URL contains no `%D7%` escapes — slug is ASCII.
6. Thumbnail renders in course list, header, OG preview (use a link debugger or `curl -I`).
7. Completing an Activity advances `TrailStep.complete` (visible on learner's account page).
8. Learner `/account` shows the enrollment row.
9. Password-reset / magic-link flow: trigger from `/auth/reset` for `test@`, confirm the email arrives (SMTP warm), link lands on the right org. **Pre-check for Phase 5** — bridge will use the same email path.
10. Only after 1–9 pass, toggle `published=true`. Unpublish is reversible but kills learner bookmarks.

---

## Post-launch hygiene (nice-to-have)

- Rotate admin password from `/dash/users/settings/users`.
- DB snapshot tagged `pre-first-paid-enrollment` (`pg_dump` or provider snapshot).
- Create `ops@lanternroute.com` as a break-glass second admin. Don't share the bootstrap `admin@` credential with the bridge.
- When bridge is ready (Phase 5), mint an API token at `/dash/org/settings/api` scoped to the default org. Store in bridge secrets — never in LH config.
- Weekly DB snapshot cron.

---

## Explicit "skip for now"

- **LH Payments** — commerce is Wix + Grow. Feature flag OFF.
- **SSO** — magic link is sufficient for paid buyers.
- **SCORM activity type** — irrelevant for creator-authored HE.
- **Communities / Boards / Playgrounds / Podcasts** — feature-flagged off; don't enable on a whim.
- **Custom roles** — default `Admin/Maintainer/Instructor/User` is enough for solo op.
- **Certification tab** — v2, needs legal-grade copy first.
- **AI tab** — off until LLM budget is a line item.
- **Collections / UserGroups** — create when course #2 ships or cohort launch is planned.

---

## Critical files (for reference if UI surprises you)

UI surfaces:
- `apps/web/components/Dashboard/Pages/Org/OrgEditGeneral/OrgEditGeneral.tsx` — general settings form
- `apps/web/components/Dashboard/Pages/Org/OrgEditBranding/OrgEditBranding.tsx` — branding inputs
- `apps/web/components/Dashboard/Pages/Org/OrgEditFeatures/OrgEditFeatures.tsx` — feature toggles (uses `PlanBadge` — OSS mode backend bypasses, frontend may still badge "Pro")
- `apps/web/components/Dashboard/Pages/Course/EditCourseGeneral/EditCourseGeneral.tsx` — course metadata form
- `apps/web/components/Dashboard/Pages/Course/EditCourseGeneral/ThumbnailUpdate.tsx` — thumbnail spec + upload
- `apps/web/components/Dashboard/Onboarding/OnboardingBar.tsx` — sidebar checklist

Backend entities (if debugging data):
- `apps/api/src/db/organizations.py:30` — Organization
- `apps/api/src/db/organization_config.py:242` — OrganizationConfig
- `apps/api/src/db/courses/courses.py:62` — Course (note `published` + `public` bools)
- `apps/api/src/db/courses/chapters.py:20` — Chapter
- `apps/api/src/db/courses/activities.py:45` — Activity (activity_type + activity_sub_type enums)
- `apps/api/src/db/trails.py:17` — Trail (enrollment)

---

## Verification

This playbook is executed manually in the admin UI, not via code. "Verification" = the Phase D 10-check list passes end-to-end with a test learner account before publishing.

No code changes required by this plan — all actions are in the admin UI. If the operator hits a UI that behaves unexpectedly (e.g. a feature toggle claims "Pro required" in OSS mode), flag it — that's an upstream-worthy bug in the frontend plan-gating (the backend already bypasses plan checks in OSS mode after `fix(admin): OSS-mode bypass` commit `5df42a1e`).

Phase 5 (bridge) can start in parallel with Phase C (content seed) — they don't block each other. The bridge only needs: the course UUID (from Phase B step 1), an API token (Phase post-launch), and the Grow webhook spec (from the Wix+Grow setup checklist).
