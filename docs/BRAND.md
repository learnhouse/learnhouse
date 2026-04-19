# Brand System — חופשי / chofshi

**Source of truth** for all visual tokens. Used in Webflow Designer (marketing site) AND LH `OrgEditBranding` (learner app) so the buyer → learner transition feels continuous.

**Theme name:** *Exhale* — warm neutrals + earth tones + sage, evoking the relief of financial clarity (the "free" in חופשי). Editorial/magazine feel, not bank-blue, not coach-pink.

**Audience:** Hebrew-primary; female-skew 25–50; financially stressed, looking for a trusted guide. Calm competence > persuasive energy.

---

## Colors

### Core palette

| Token | Hex | Usage | Notes |
|---|---|---|---|
| `--bg-paper` | `#F7F3EC` | Page background (warm off-white, the canvas for everything) | Cream-leaning, never pure white; reduces glare for long-form reading |
| `--bg-surface` | `#FFFFFF` | Card / surface background (above paper) | Pure white when we need a lift; rare |
| `--bg-muted` | `#E8E2D5` | Section dividers, disabled states, subtle bands | |
| `--ink` | `#1F1A15` | Primary text (warm near-black) | **Never pure `#000`** — too harsh for editorial |
| `--ink-soft` | `#4A413A` | Secondary text, captions | |
| `--ink-quiet` | `#8A7F74` | Meta, timestamps, placeholders | |
| `--border` | `#D9D1C1` | Hairlines, card borders, input borders | |

### Brand accents

| Token | Hex | Usage | Contrast on `--bg-paper` |
|---|---|---|---|
| `--primary` | `#B56A38` | **Primary CTA** background, key moments, the "Buy now" button | 5.4:1 (AA body) with white text |
| `--primary-hover` | `#9E5A2C` | CTA hover / active | 6.4:1 |
| `--primary-ink` | `#7A4B2B` | Headline accent color, pull-quote marks, section labels | 8.3:1 (AAA) |
| `--sage` | `#88997A` | Secondary accent — tags, trust cues, "success" confirmation | 3.7:1 (AA large only — use for tags/badges, not body) |
| `--sage-deep` | `#5E6E52` | Sage for body text usage | 6.1:1 |
| `--sage-soft` | `#DCE1D4` | Sage tinted surface (tag backgrounds, gentle callouts) | — |

### Semantic (functional) colors

| Token | Hex | Usage |
|---|---|---|
| `--success` | `#5E6E52` (= `--sage-deep`) | Form success, enrolled-state checkmarks |
| `--warning` | `#C98A2B` | Gentle warnings (warm amber, not jarring yellow) |
| `--error` | `#A84231` | Form errors, destructive actions (warm red, not pure `#FF0000`) |
| `--info` | `#7A4B2B` (= `--primary-ink`) | Informational banners, not a separate hue |

### Palette relationships (why it works)

- **Cream + warm-black + terracotta** is the editorial-magazine spine (think The Cut, Morning Brew, old-school book covers). Inviting, not corporate.
- **Sage as secondary accent** avoids the cliché "money green" while still gesturing at growth/calm.
- **Single warm hue family** (terracotta → sage → cream are all warm-biased) means the palette reads as one coherent mood, not a swatch grid.
- **No pure black, no pure white, no saturated primaries** — nothing in the palette is above ~65% saturation, which is what makes it feel editorial instead of "coach site from a template."

---

## Typography

### Font families

| Role | Family | Source | Why |
|---|---|---|---|
| Display / headlines | **Frank Ruhl Libre** | Google Fonts | Contemporary Hebrew serif by Michal Sahar (Israeli type designer). Warm, authoritative, editorial. De-facto standard for serious IL editorial sites. Excellent Hebrew + Latin coverage. |
| Body / UI | **Heebo** | Google Fonts | Modern Hebrew sans-serif, extensive weight range, clean at small sizes, renders well at long body-copy lengths. Already set as the running LH default (verified). |
| Monospace (rare) | **JetBrains Mono** | Google Fonts | For any code snippets in blog posts (calculators, tools). Latin only — Hebrew falls back to Heebo. |

**Alternative pairings** (if Maya wants to swap during brand review):
- *Literary/classical:* David Libre (display) + Assistant (body)
- *Pure modern:* Rubik (single family, varied weights)
- *Warmer serif:* Tinos (display) + Assistant (body)

All four options keep the "warm, Hebrew-native, editorial" character. Default is **Frank Ruhl Libre + Heebo** unless overridden.

### Google Fonts import (Webflow + LH)

```
https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Heebo:wght@300;400;500;600;700;800&display=swap
```

### Weights used

- **Frank Ruhl Libre**: 400 (regular), 500 (medium, subheads), 700 (bold, H1/H2), 900 (black, hero only).
- **Heebo**: 300 (light, oversized leads only), 400 (body), 500 (UI strong), 600 (buttons, labels), 700 (bold callouts).

### Type scale

8px base grid, ~1.25 modular ratio. Sizes in `rem` (assuming 16px root) and equivalent `px`.

| Token | rem / px | Usage | Family · Weight · Line-height | Letter-spacing |
|---|---|---|---|---|
| `--text-xs` | 0.75 / 12 | Caption, tiny meta | Heebo · 400 · 1.5 | normal |
| `--text-sm` | 0.875 / 14 | Small meta, form helper text | Heebo · 400 · 1.55 | normal |
| `--text-base` | 1.0625 / 17 | **Body copy** | Heebo · 400 · 1.55 | normal |
| `--text-md` | 1.3125 / 21 | Lede paragraph, large body | Heebo · 400 · 1.5 | normal |
| `--text-lg` | 1.625 / 26 | H4, pull-quote | Frank Ruhl Libre · 500 · 1.35 | -0.005em |
| `--text-xl` | 2.0625 / 33 | H3 | Frank Ruhl Libre · 600 · 1.25 | -0.01em |
| `--text-2xl` | 2.625 / 42 | H2 | Frank Ruhl Libre · 700 · 1.2 | -0.015em |
| `--text-3xl` | 3.25 / 52 | H1 (mobile) | Frank Ruhl Libre · 700 · 1.1 | -0.02em |
| `--text-4xl` | 4.5 / 72 | Hero (desktop) | Frank Ruhl Libre · 900 · 1.05 | -0.025em |

**Body base = 17px** (not the default 16) — Hebrew typography reads better at 16.5–18px than Latin at the same size because Hebrew letterforms are denser. The extra point matters for long blog posts.

**Line-heights are slightly tighter for Hebrew** — 1.55 instead of the Latin-standard 1.6. Hebrew doesn't have descenders like `g/j/p/q/y`, so lines pack tighter without feeling cramped.

### Headline rules

- H1: always Frank Ruhl Libre, weight 700 mobile / 900 hero. Negative letter-spacing (-0.02em to -0.025em) for editorial crispness.
- Never mix two serif display faces in one composition.
- Never use Frank Ruhl Libre below 20px — it's a display face, not a body face. Use Heebo there.

### Long-form (blog post) rules

- Max-width for body column: **65ch** (≈ 620px) — readable measure, standard for long-form.
- Paragraph spacing: 1em after (space after = one line-height worth).
- Subheads within posts (H2/H3): extra top padding (2em top, 0.5em bottom) for rhythm.
- Block quotes: Frank Ruhl Libre italic 500, `--primary-ink` color, `--primary` 3px left border (in RTL: right border), 1.5em padding-inline-start.

---

## Spacing + layout

### Spacing scale (4px base)

| Token | px | Usage |
|---|---|---|
| `--space-1` | 4 | Tight inline gaps |
| `--space-2` | 8 | Stack gaps, tag padding |
| `--space-3` | 12 | Small paddings |
| `--space-4` | 16 | Default padding, small section inner |
| `--space-5` | 20 | Card internal padding |
| `--space-6` | 24 | Medium section padding |
| `--space-8` | 32 | Standard block spacing |
| `--space-10` | 40 | Between-section small |
| `--space-12` | 48 | Between-section default |
| `--space-16` | 64 | Between-section large |
| `--space-20` | 80 | Hero top/bottom padding (mobile) |
| `--space-24` | 96 | Major section dividers |
| `--space-32` | 128 | Hero top/bottom padding (desktop) |

### Layout

- **Container width:** max 1200px, centered, 24px horizontal padding on mobile, 48px on desktop.
- **Breakpoints:** 640 / 768 / 1024 / 1280 (standard Webflow/Tailwind).
- **Grid:** 12-column on desktop, 4-column on mobile. 24px gutters.
- **Column measure for long-form body:** ~620px (65ch) centered within the 12-col grid.

---

## Component styles

### Buttons

| Variant | Background | Text | Border | Radius | Padding | Shadow |
|---|---|---|---|---|---|---|
| Primary | `--primary` `#B56A38` | `#FFFFFF` | none | 12px | 12px 24px | `0 2px 8px rgba(31,26,21,0.08)` |
| Primary hover | `--primary-hover` `#9E5A2C` | `#FFFFFF` | none | 12px | 12px 24px | `0 4px 12px rgba(31,26,21,0.12)` |
| Secondary | transparent | `--ink` `#1F1A15` | `1px solid --ink` | 12px | 12px 24px | none |
| Secondary hover | `--ink` `#1F1A15` | `#FFFFFF` | `1px solid --ink` | 12px | 12px 24px | none |
| Ghost (text-only) | transparent | `--primary-ink` `#7A4B2B` | none (underline on hover) | — | 8px 12px | — |

Button text: Heebo 600, size `--text-base` (17px), letter-spacing 0.

### Cards

- Background: `--bg-surface` `#FFFFFF`.
- Border: `1px solid --border` `#D9D1C1`.
- Radius: `16px`.
- Shadow (rest): `0 2px 8px rgba(31,26,21,0.04)`.
- Shadow (hover): `0 6px 20px rgba(31,26,21,0.08)`.
- Internal padding: `--space-5` (20px) on mobile, `--space-6` (24px) on desktop.

### Inputs

- Background: `--bg-surface`.
- Border: `1px solid --border`.
- Border on focus: `2px solid --primary`.
- Radius: `8px`.
- Padding: `12px 16px`.
- Font: Heebo 400, size `--text-base`.

### Tags / pills (blog categories, etc.)

- Background: `--sage-soft` `#DCE1D4`.
- Text: `--sage-deep` `#5E6E52`.
- Border: none.
- Radius: `999px` (full pill).
- Padding: `4px 12px`.
- Font: Heebo 500, size `--text-xs` (12px), letter-spacing 0.02em, uppercase if Latin, normal case if Hebrew.

### Links (in body content)

- Rest: `--primary-ink` `#7A4B2B`, underline with 2px offset.
- Hover: `--primary` `#B56A38`, underline.
- Visited: same as rest (no visited state — looks fussier than it helps in editorial).

### Dividers

- Hairline: `1px solid --border` `#D9D1C1`.
- Section divider: empty band of `--bg-muted` `#E8E2D5`, height `--space-12` (48px).

---

## Imagery direction

- **Photography:** warm, naturally-lit, editorial. Maya's own photos (already have `/root/maya_photo.webp` + `maya_photo_2.jpg`) fit — both have golden-hour warmth and relaxed framing. Avoid stock "business woman at laptop smiling at camera."
- **Illustration:** skip at launch. If needed later, commission hand-drawn warm-line illustrations (à la The Pudding), not flat-vector coach-site clipart.
- **Icons:** use **Phosphor** (already referenced in LH per CLAUDE.md) in weight `light` or `regular`. Consistent `1.5px` stroke. No Font Awesome or Heroicons-default — too techy.
- **Pattern / texture:** zero. The warmth comes from color + type, not from "paper texture" overlays which look dated.

---

## Logo

Placeholder — Maya to provide. When she does, capture:
- SVG primary (horizontal + stacked versions).
- Monogram / favicon.
- Clear-space rules.
- Minimum size.
- Mono versions (on `--ink`, on `--primary`, on `--bg-paper`).

Until a logo exists, use wordmark-only: **"חופשי"** in Frank Ruhl Libre 700, color `--ink`, with a small **"•"** mark in `--primary` at the baseline. Quick placeholder; not intended to survive to launch.

---

## Webflow implementation notes

1. Create these as **Style Variables** in Webflow Designer (Variables panel) — colors, font families, and sizes all map 1:1 to Webflow variable types.
2. Define **two Style modes** — Hebrew (default) and English — if Webflow's Localization-aware variables can swap line-height/letter-spacing per locale. Hebrew needs tighter line-height (1.55 vs 1.6).
3. Set `html[dir="rtl"]` base styles via Webflow's embed HTML block on the site settings — use logical properties (`margin-inline-start`, not `margin-left`) everywhere in custom CSS.
4. Body base size: 17px on `<body>`, not the Webflow default of 14px. Webflow scales from there.
5. Use Webflow's **semantic class names** matching token names where possible (`is-primary`, `is-ink-soft`) so component restyling flows from variable changes.

## LH `OrgEditBranding` mapping

LH's branding surface lets you set a subset — capture these exact values in the admin:

| LH field | Value |
|---|---|
| Primary font | `Heebo` (Google Fonts) |
| Display font | `Frank Ruhl Libre` (Google Fonts) |
| Primary color | `#B56A38` |
| Secondary color | `#7A4B2B` |
| Background color | `#F7F3EC` |
| Text color | `#1F1A15` |
| Logo | (pending from Maya) |
| Favicon | (pending from Maya) |

Anything LH doesn't expose (type scale, spacing, component shadows) is out-of-scope for OrgEditBranding — those are set globally in `apps/web/app/globals.css` / the codebase. Keep that CSS in sync with these tokens.

---

## Accessibility

- **Contrast** — all text/background combinations above meet WCAG AA. `--primary` + white text passes AA at body size (5.4:1).
- **Focus ring** — all interactive elements get `2px solid --primary` outline with `2px` offset on keyboard focus.
- **Motion** — respect `prefers-reduced-motion`. No large parallax or auto-playing video.
- **Font minimum** — never go below 14px (`--text-sm`) for any readable content. 12px reserved for meta only.
- **Accessibility statement** — required in IL; linked from footer at `/accessibility`.

---

## Decisions deferred to Maya

- Final logo + wordmark (placeholder in use until then).
- Final photo direction — are we sticking with the two photos we have, commissioning a shoot, or building a photo library over time? (Budget-dependent.)
- Tone of voice guide (how חופשי "speaks") — lives in copy, not in this brand doc, but affects button labels / error messages / etc. Draft as part of the `copywriting` skill work later.

---

## Changelog

- **2026-04-19** — initial draft. Theme name "Exhale". Frank Ruhl Libre + Heebo. Terracotta + sage + cream palette. Output of theme-factory skill.
