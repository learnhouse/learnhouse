# Site Architecture — Maya's Storefront (`chofshi.co.il`)

**Type:** hybrid — single-course seller + content-heavy blog for Hebrew SEO.
**Platform:** Webflow (per `PLAN.md` Phase 3).
**Language:** Hebrew primary (RTL), English secondary.
**Related docs:** `/opt/lms/docs/PLAN.md`, `/opt/lms/docs/BRAND.md` (TBD), `/opt/lms/docs/REFERENCE-SITES.md` (in progress).

## Core decisions

| Topic | Decision | Rationale |
|---|---|---|
| URL slug language | **English, kebab-case** (`/blog/credit-card-trap`) | Clean, shareable, copy-paste-friendly; Google indexes Hebrew content regardless of slug language. Maya can override per-post in Webflow if she wants a Hebrew slug for a specific piece. |
| Trailing slash | **No trailing slash** (Webflow default) | Enforce one convention site-wide; Webflow handles redirects. |
| Case | Lowercase always | Standard. |
| Multilingual URLs | Hebrew at root (`/about`), English under `/en/` prefix (`/en/about`) | Primary audience is Hebrew; English is fallback. Keeps Hebrew URLs uncluttered. Uses Webflow Localization's locale prefix feature. |
| Personal brand path | `/about` (not `/maya`) | Brand is `chofshi`, not Maya-person. Her story lives *inside* `/about`. If Maya becomes the brand later, add `/maya` as a 301 → `/about`. |

## Page hierarchy

```
Homepage (/)
├── About (/about)
├── Courses (/courses)
│   └── Course detail (/courses/{slug})              ← e.g. /courses/chofshi-from-debt
├── Blog (/blog)
│   ├── Category — Debt (/blog/category/debt)        ← חוב
│   ├── Category — Budgeting (/blog/category/budgeting)  ← תקציב
│   ├── Category — Mindset (/blog/category/mindset)  ← חשיבה
│   ├── Category — Investing (/blog/category/investing)  ← השקעות
│   ├── Category — Tools (/blog/category/tools)      ← כלים
│   └── Blog post (/blog/{slug})                     ← flat under /blog, not /category/slug/post
├── Contact (/contact)
├── Resources (/resources)                           ← POST-LAUNCH: lead-magnet PDF + free tools
├── Legal
│   ├── Privacy (/privacy)                           ← פרטיות
│   ├── Terms (/terms)                               ← תנאים
│   └── Accessibility (/accessibility)               ← הצהרת נגישות (required in IL)
└── Sign in (external)                               ← redirects to https://<learner-subdomain>
```

**Launch scope**: everything except `/resources` (deferred post-launch per PLAN.md Phase 7).

## Visual sitemap

```mermaid
graph TD
    subgraph Header Nav
        HOME[Home /]
        ABOUT[About /about]
        COURSES[Courses /courses]
        BLOG[Blog /blog]
        CONTACT[Contact /contact]
        LOGIN[Sign in → LH]
        CTA[Buy the course — CTA]
    end

    subgraph Footer Nav
        PRIVACY[/privacy]
        TERMS[/terms]
        A11Y[/accessibility]
        EN[English toggle]
    end

    HOME --> ABOUT
    HOME --> COURSES
    HOME --> BLOG
    HOME --> CONTACT

    COURSES --> COURSE1[Course detail /courses/slug]

    BLOG --> CAT_DEBT[/blog/category/debt]
    BLOG --> CAT_BUDGET[/blog/category/budgeting]
    BLOG --> CAT_MIND[/blog/category/mindset]
    BLOG --> CAT_INVEST[/blog/category/investing]
    BLOG --> CAT_TOOLS[/blog/category/tools]

    CAT_DEBT --> POST1[/blog/post-slug]
    CAT_BUDGET --> POST1
    POST1 --> COURSE1
    COURSE1 --> POST1

    HOME --> PRIVACY
    HOME --> TERMS
    HOME --> A11Y
```

## URL map

| Page | URL (Hebrew) | URL (English) | Parent | Nav location | Priority |
|---|---|---|---|---|---|
| Home | `/` | `/en/` | — | Header (logo) | High |
| About | `/about` | `/en/about` | Home | Header | High |
| Courses list | `/courses` | `/en/courses` | Home | Header | High |
| Course detail | `/courses/{slug}` | `/en/courses/{slug}` | Courses | Linked from list | High |
| Blog hub | `/blog` | `/en/blog` | Home | Header | High |
| Blog category | `/blog/category/{slug}` | `/en/blog/category/{slug}` | Blog | Linked from hub + posts | Medium |
| Blog post | `/blog/{slug}` | `/en/blog/{slug}` | Blog | Linked from hub/categories | Medium |
| Contact | `/contact` | `/en/contact` | Home | Header | Medium |
| Resources (deferred) | `/resources` | `/en/resources` | Home | Header (post-launch) | Low |
| Privacy | `/privacy` | `/en/privacy` | Home | Footer | Low |
| Terms | `/terms` | `/en/terms` | Home | Footer | Low |
| Accessibility | `/accessibility` | `/en/accessibility` | Home | Footer | Low |
| Sign in | `https://<learner-subdomain>` | same | — | Header (text link) | High |

## Navigation spec

### Header (RTL — right-to-left visual order)

Reading right-to-left (standard Hebrew layout):

```
[Logo]    בית    עליי    קורסים    בלוג    צור קשר    |    כניסה →    [התחילי כאן]
 ^                                                                        ^
 right                                                                    left
```

- **Logo** (right edge) links to `/`.
- **Primary links** (5 items, ordered right-to-left by priority): Home, About, Courses, Blog, Contact.
- **Secondary cluster** (left edge): "Sign in" text link (→ LH learner subdomain in a new tab) + primary CTA "התחילי כאן" / "Start now" (solid button, scrolls to course or opens Grow checkout depending on page).
- **Language toggle**: small `EN / עב` switcher in the top-right corner of the header, above or beside the logo.

### Footer

Three columns plus a baseline row.

**Column 1 — תוכן (Content):**
- בלוג → `/blog`
- קטגוריות (expand into 5 category links)
- משאבים חינם / Free resources → `/resources` (post-launch)

**Column 2 — חופשי (About the brand):**
- עליי (About Maya) → `/about`
- סיפור השינוי (Success stories / testimonials — anchor on /about or separate page) → `/about#stories`
- צור קשר → `/contact`

**Column 3 — קורסים (Courses):**
- כל הקורסים → `/courses`
- הקורס הראשי → `/courses/chofshi-from-debt` (or flagship slug)
- חוות דעת → `/courses/chofshi-from-debt#reviews`

**Baseline row:** `© 2026 chofshi • פרטיות • תנאים • הצהרת נגישות • עב / EN`

### Breadcrumbs

Enable on blog posts and category pages (not home/about/courses list).

Example: `Home > Blog > Debt > מלכודת האשראי`

Order in RTL visual: `מלכודת האשראי < חוב < בלוג < בית`

Use Webflow's native breadcrumb component with JSON-LD structured data (`BreadcrumbList` schema).

## Internal linking strategy

### Hub-and-spoke per blog category

Each category has one **pillar/cornerstone post** (long-form, evergreen, 2000+ words) that all other posts in the category link to, and that links out to all sub-posts.

Example (Debt category):
```
Hub:  /blog/the-complete-guide-to-getting-out-of-debt
  ├── Spoke: /blog/credit-card-trap
  ├── Spoke: /blog/debt-snowball-vs-avalanche
  ├── Spoke: /blog/talking-to-creditors-in-israel
  └── Spoke: /blog/emergency-fund-before-debt
```

Each spoke has "Read the full guide → [pillar title]" link in the post body. Pillar has a "Related in this series" block listing all spokes.

### Cross-section links (the conversion path)

- **Home → course** — primary CTA above the fold + featured-course block.
- **Blog post → course** — bottom-of-post card "הקורס שיפתור את זה" (the course that solves this) with image + price + Buy CTA. **This is the primary discovery-to-purchase path**; every post must have one, autogenerated from Webflow's `related_courses` multi-reference on the post (see PLAN.md Phase 3 item 5).
- **Course → blog** — "קריאה נוספת" (Further reading) section at bottom of course page listing 3–5 related posts from the `related_courses` reverse reference.
- **About → course** — mid-page CTA "מוכנה? בואי נתחיל" linking to the course detail.
- **LH learner app** — header "Sign in" link + post-purchase magic-link flow (PLAN.md Phase 5). Site → LH is one-way; LH → site is handled by LH's own branding/nav.

### Anchor-text rules

- **Descriptive** — "הקורס של חופשי על חובות" (not "לחצי כאן").
- **Hebrew in Hebrew pages, English in English pages** — don't mix unless linking to an external English resource.
- **Consistent for repeated links** — the primary course should always be linked as "קורס חופשי מחובות" (or whatever the final name is), not different phrasings per post.

### Orphan-page audit

At launch there's only ~15 pages so orphans are easy to avoid. Post-launch, when blog volume grows past 30 posts, run a monthly audit:
- Every post must have ≥1 inbound internal link from the pillar OR from another post.
- Every new post gets added to its category's pillar's "Related" block within 24h of publish.

## Hebrew / RTL considerations

- `<html lang="he" dir="rtl">` on Hebrew pages, `<html lang="en" dir="ltr">` on `/en/*`.
- **Logical CSS properties** throughout (margin-inline-start, not margin-left). Webflow 2026 Designer supports these natively.
- **Icons with direction** (arrows, chevrons, "next" indicators) must mirror under RTL. Use Webflow's built-in "RTL flip" class or inline transforms.
- **Numbers + dates** — LTR within RTL text (Hebrew handles this automatically with Unicode bidi, but verify in Webflow preview).
- **Line-height** — Hebrew typography needs slightly tighter line-height than English (1.4 vs 1.5). Set in BRAND.md tokens.

## SEO considerations

- **Sitemap.xml** — Webflow generates automatically. Verify both Hebrew + English pages are included.
- **hreflang** — each Hebrew page must declare `<link rel="alternate" hreflang="he" href="...">` and `<link rel="alternate" hreflang="en" href="/en/...">`. Webflow Localization handles this.
- **Canonical URLs** — one canonical per language variant.
- **Structured data** — JSON-LD on each page type:
  - Home: `Organization` + `WebSite`
  - About: `Person` (Maya) with `knowsAbout`, `sameAs` (social)
  - Course detail: `Course` schema with `offers`, `provider`
  - Blog post: `BlogPosting` with `author`, `datePublished`, `image`, `articleSection` (category)
  - Category pages: `CollectionPage`
  - Breadcrumbs: `BreadcrumbList` on all deep pages
- **Meta titles** — Hebrew pattern: `{page title} | חופשי — אימון פיננסי` (~60 chars).
- **Meta descriptions** — 140–160 chars in Hebrew.
- **OG images** per-page, 1200×630, Hebrew text rendered at rasterization time (not browser-rendered).

## Launch-phase scope

**At launch (2–3 months per PLAN.md):**
- Home, About, Courses, Course detail ×1, Blog hub, 5 category pages, 5 cornerstone posts, Contact, Privacy, Terms, Accessibility. ~15 pages.

**Month 2–6 (content build):**
- Add blog posts weekly (~30 more posts across categories by month 6).
- Add Resources section with lead-magnet PDF.

**Year 1+:**
- Second course (when Maya records it) → add `/courses/{new-slug}` — architecture already supports it.
- Multi-seller (per PLAN.md Phase 7) — not addressed here; would require a rethink.

## Follow-ups needed to finalize

- **Final domain** (blocks all URL decisions) — Maya picks.
- **Final course name + slug** — blocks `/courses/{slug}` path and the first Buy CTA.
- **Category labels in Hebrew** — above I used literal translations; Maya may prefer different phrasings.
- **Brand tokens** (`/opt/lms/docs/BRAND.md`) — feeds fonts, palette, spacing into the Webflow design system.
- **Reference-site research** (`/opt/lms/docs/REFERENCE-SITES.md`, in progress) — will inform section-level layout choices within each page.
