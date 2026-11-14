# LearnHouse V2 design system

The dashboard and the learner side were redesigned in one language. This
folder is where that language lives, so new screens and future updates follow
it instead of re-inventing it.

```ts
import { DashPage, DashPageHeader, Panel, Toolbar, Button, SubTabs, AIButton, tokens, recipes } from '@/design'
```

| File | What it is |
| --- | --- |
| `design/tokens.ts` | The single source: color roles, radius, shadow, spacing, type, motion, z-index, icons, chart palette |
| `design/tokensCss.ts` + `scripts/design-tokens.mjs` | Mirror the tokens into `styles/globals.css` (between the `@design-tokens` markers) |
| `design/recipes.ts` | Named class strings the redesigned pages repeat |
| `design/primitives.tsx` | Small additions: `DashPage`, `Panel`, `Toolbar`, `Eyebrow`, `StatusPill`, `StatusDot`, `Skeleton` |
| `design/index.ts` | The public entry: re-exports DashKit, buttons, SubTabs, DashTabBar, AIBrand and the above |
| `/design-system` (dev only) | Living style guide: `app/orgs/[orgslug]/design-system`, 404 in production |

The components still live where pages already import them
(`components/Dashboard/Shared/DashKit/*`, `components/Objects/AI/AIBrand.tsx`).
Both import paths are valid; new code should prefer `@/design`.

## Principles

1. **Quiet surfaces, one accent.** Neutral greys on a `#f8f8f8` canvas, white
   cards, near-black primary actions. Color means something: status, the org
   accent, or AI. Nothing is colored for decoration.
2. **Light relief, not elevation.** Cards use `nice-shadow`; buttons carry a
   hairline ring and a 1px shadow. No heavy drop shadows except floating dark
   bars.
3. **Tabs over long scroll.** A page that grows past a few sections splits into
   `SubTabs` (`?section=` in the URL), not a longer page.
4. **Codify, don't invent.** New UI reuses a primitive, then a recipe, then a
   token. If a pattern shows up in three pages, it earns a primitive here.
5. **Every screen works at 390px and in RTL.** Logical utilities only, no
   sideways page scroll, Arabic and Persian mirror automatically.
6. **The org theme is opt-in.** Learner pages follow the org accent through
   `lh-t-*` markers and `lh-accent` tokens; the dashboard stays neutral.

## Tokens

Tailwind v4 utilities come from the `@theme inline` block in `globals.css`:

| Group | CSS | Utility | Examples |
| --- | --- | --- | --- |
| Color roles | `--color-lh-*` | `bg-lh-*`, `text-lh-*`, `ring-lh-*`, `border-lh-*` | `canvas`, `surface`, `surface-muted`, `surface-sunken`, `track`, `border`, `border-strong`, `fg`, `fg-secondary`, `fg-muted`, `fg-subtle`, `ink`, `ink-reading`, `ink-ai`, `accent*`, `success*`, `warning*`, `dirty`, `danger*`, `info*`, `ai*`, `chart-1..8`, `chart-previous`, `chart-grid`, `chart-axis` |
| Radius | `--radius-lh-*` | `rounded-lh-*` | `control-sm` 8px, `control` 12px, `card` 16px, `pill` |
| Shadow | `--shadow-lh-*` | `shadow-lh-*` | `btn-primary`, `btn-secondary`, `btn-danger`, `segment`, `floating` (cards: the `nice-shadow` class) |
| Spacing | `--spacing-lh-*` | `p-lh-*`, `gap-lh-*` | `gutter` 16, `gutter-wide` 40, `section` 20, `card` 20, `card-compact` 16, `grid` 16, `stack` 12, `inline` 8 |
| Type | `--text-lh-*` | `text-lh-*` | `micro` 10, `meta` 11, `label` 12, `ui` 13, `body` 14, `card-title` 15, `section-title` 16, `stat` 20, `metric` 26, `title` 24, `title-lg` 30 |
| Motion | `--lh-duration-*`, `--ease-lh-out` | `ease-lh-out` | `fast` 150ms, `base` 200ms, `slow` 500ms; press `active:scale-[0.98]` |
| Z-index | existing `--z-*` | - | mirrored as `tokens.zIndex`; DashKit bars use z-10 / z-30 / z-40 |

Existing pages write the palette classes (`bg-white`, `text-neutral-500`,
`rounded-2xl`); each token records the class it equals in `tailwind`, and both
render the same. Use the `lh-` utilities in new code where they read better,
and always for the org accent.

**Org accent.** `bg-lh-accent`, `text-lh-accent-ink`, `bg-lh-accent-soft` read
`var(--lh-accent, neutral-900)`. Inside the org layout's `.lh-theme` root they
take the org color; in the dashboard (no theme root) they are neutral. The
block is `inline` on purpose so the variable resolves on the element. For
existing components the marker classes in `styles/theme.css` (`lh-t-btn`,
`lh-t-card`, `lh-t-progress`, `lh-t-chip`…) still do the theming; `Button
variant="primary"` already carries `lh-t-btn`.

**In JS** (charts, canvas, emails), read `tokens.color.<role>.hex` or
`tokens.chartSeries`; SVG attributes cannot read CSS variables.

**Changing a token:** edit `design/tokens.ts`, run `bun scripts/design-tokens.mjs`
from `apps/web`, check `/design-system`. `tests/design-tokens.test.mjs` fails
when the CSS block, the button shadows or the analytics palette drift.

## Dark mode

Light is the default; dark is the user's manual choice (user menu, account
**Appearance**, ⌘K, the sun/moon button on public and auth pages). It never
follows the OS. `<html data-theme="dark">` is set before paint by
`public/theme-init.js` from `localStorage['lh:theme']`, and
`ColorSchemeProvider` keeps it in sync with the account
(`user.ui_preferences.theme`, `PUT /users/me/preferences`).

`styles/dark.css` does the work, so screens need no `dark:` classes:

- The Tailwind palette is remapped under the dark root: `white` is the card
  (#17171a), neutrals invert (900 titles, 500 muted, 50–200 fills and
  hairlines), hue 50–300 become low-alpha washes, hue 600–950 lifted inks.
  Canvas #111113, raised #1c1c20, hairlines white 8% / 12% / 16%.
- Parts that are already dark in light mode (sidebar, floating bars, tooltips,
  anything with `text-white`) keep their light-mode design.
- Solid near-black controls (primary buttons, selected pills, switches) invert
  to a light fill with dark ink.
- Cards get a hairline instead of `nice-shadow`; menus and dialogs sit on the
  raised surface.

Rules for new UI: use the kit and palette classes as in light and check
`/design-system` in both themes. Mark org-authored content that keeps its own
colors with `data-lh-user-content` (or `lh-keep-light` for content that also
needs light form controls); a light panel inside an already-dark part opts
back in with `lh-follow-theme`; a dark-ink image that should turn white gets
`lh-dark-invert`. In JS (charts, canvas) read `useColorScheme()`. Never use
`prefers-color-scheme` (`tests/color-scheme.test.mjs` checks). If you need a
`dark:` utility, remember it already sees the remapped palette.

## Layout grammar

A dashboard list page, top to bottom:

```tsx
<DashPage bottom="xl">                     {/* px-4 sm:px-10, gap-5, min-w-0 */}
  <DashPageHeader breadcrumbs={…} title={t('…')} subtitle={t('…')} actions={<Button variant="primary" icon={<Plus size={14} weight="bold" />}>…</Button>} />
  <div className={recipes.statGrid}>        {/* 2 cols on phones, 4 from lg */}
    <StatCard icon={<BookOpen size={18} />} iconClass="bg-sky-50 text-sky-600" label={…} value={count ?? null} />
  </div>
  <Toolbar end={<><ToolbarSelect … /><ViewToggle … /></>}>
    <SearchInput className="xl:max-w-md" … />
  </Toolbar>
  <Panel divided>                            {/* list: rows split by hairlines */}
    <div className={recipes.tableHead}>…</div>
    {rows.map((row) => <Row key={row.id} … />)}
  </Panel>
  <BulkActionBar … />
</DashPage>
```

- **Page shell:** `DashPage` under the main `DashTabBar`. One `DashPageHeader`
  per page: breadcrumbs, a title, an optional one-line subtitle, actions at the
  end. One primary button per view.
- **Sub-tabs instead of long scroll:** an editor or settings page with more
  than about three cards uses `SubTabs` + `useSubTab` (pills; `variant="sidebar"`
  when there are many sections). Keep one `StickySaveBar` outside the panels and
  mark changed tabs with `dirty`.
- **Cards:** `Panel` (or `recipes.card`) for any white box; `SectionCard` when
  it has a title row; `SettingRow` for label-left / control-right settings;
  `StatCard` for counts. Card padding is `p-5`; tiles and dense rows `p-4`.
- **Tables:** `Panel divided` with a `recipes.tableHead` row, `px-5 py-3.5`
  rows, `hover:bg-neutral-50/70`, numbers `tabular-nums`. Hide secondary columns
  below `sm` rather than scrolling sideways.
- **Grids:** `recipes.cardGrid` (1 → 2 → 3 → 4 columns) with `gap-4`.
- **Floating actions:** `BulkActionBar` for selections, `StickySaveBar` for
  unsaved edits. Both are dark, docked at the bottom; leave room with
  `DashPage bottom="xl"`.
- **Dialogs:** `ConfirmDialog` for confirms (controlled, so it survives a
  closing dropdown); `Modal` with `size` for forms.

## States

- **Empty:** `EmptyState` inside a `Panel`, with an icon (22px), a title, one
  sentence and the next action. Filtered-to-nothing shows a "clear filters"
  action instead of "create".
- **Loading:** `Skeleton` blocks shaped like the content (StatCard shows its
  own when `value={null}`). Spinners only inside buttons (`loading`).
- **Error:** the same `EmptyState` with `WarningCircle` and a retry button,
  inside a `Panel`. Field errors go in `FieldLabel error=…` (rose-600).
- **Unsaved:** the amber dot (`recipes.dirtyDot`, `dirty` on tabs).

## Mobile (390px)

- Gutters `px-4`, `sm:px-10`. Nothing may scroll the page sideways: give flex
  children `min-w-0`, truncate long names, wrap action groups (`flex-wrap`).
- Rows that hold many controls scroll inside themselves (`overflow-x-auto
  scrollbar-hide`, like `DashTabBar` and `SubTabs`), never the page.
- Stat tiles go two per row; toolbars stack until `xl`; tables drop secondary
  columns.
- Below `lg` the dashboard shows a bottom tab bar; fixed bottom UI uses
  `var(--lh-mobile-nav-h)` (see `styles/mobile.css`).

## RTL

- Logical utilities only: `ps-/pe-`, `ms-/me-`, `start-/end-`, `text-start`,
  `border-s`, `rounded-s`. ESLint (`rtl/no-physical-direction`) rejects
  `ml-`, `left-`, `text-left` and friends; `tests/rtl-guard.test.mjs` checks the
  CSS.
- Directional icons flip: `className="rtl:rotate-180"` on carets and arrows.
- Measure scroll positions with client rects (as `SubTabs` does), since
  `scrollLeft` runs negative in RTL.

## Do / don't

```tsx
// Do: a primitive, then a recipe, then tokens
<Panel padded>…</Panel>
<Link href={href} className={buttonClass('secondary', 'sm')}>…</Link>
<span className="text-lh-accent-ink">…</span>

// Don't: re-type the card or a one-off look
<div className="bg-white rounded-[14px] shadow-lg border border-gray-300 p-[18px]">…</div>
```

```tsx
// Do: status by meaning
<StatusPill status="success" dot>{t('…published')}</StatusPill>

// Don't: pick a hue per page, or use violet for anything that isn't AI
<span className="bg-purple-100 text-purple-700 rounded px-2">Published</span>
```

```tsx
// Do: split a long editor
const [section, setSection] = useSubTab('general', SECTIONS)
<SubTabs items={…} value={section} onChange={setSection}>…</SubTabs>

// Don't: stack ten SectionCards in one scroll
```

```tsx
// Do: logical spacing, flipped icons
<CaretRight size={16} className="ms-auto rtl:rotate-180" />
// Don't
<CaretRight size={16} className="ml-auto" />
```

- Do use Phosphor icons at the sizes in `tokens.icon`; don't mix icon sets.
- Do translate every string (`t('…')`, all 22 locales); the dev style guide is
  the only English-only page.
- Don't add new `components/ui/*` (shadcn) looks to dashboard pages; DashKit
  replaces them there.

## AI features

Every AI feature uses `components/Objects/AI/AIBrand.tsx`, nothing hand-made:

- The mark is the LearnHouse AI logo (`public/learnhouse_ai_simple_colored.png`)
  via `AIMark`; in buttons `AIButton` adds it for you.
- "Ask AI" / generate actions are `AIButton` (`solid` for the main AI action,
  `soft` or `outline` for secondary ones). Labels use `AIChip`.
- AI panels are `aiSurface.panel` with `AISurfaceHeader`; dark ones use
  `AI_DARK_SURFACE`. Loading is `AIThinking` / `AIShimmer`.
- The violet family and the gradients are reserved for AI. Never use them for
  plans, promos or decoration.

## Public API

Everything `design/index.ts` exports (the test checks both directions).

| Export | From | What |
| --- | --- | --- |
| `tokens`, `color`, `radius`, `shadow`, `spacing`, `text`, `font`, `motion`, `zIndex`, `icon`, `layout`, `chartSeries`, `cssTokenList` | tokens.ts | Design tokens |
| `Token`, `ColorRole` | tokens.ts | Token types |
| `recipes`, `Recipe` | recipes.ts | Class recipes |
| `buttonClass`, `ButtonVariant`, `ButtonSize` | DashKit/buttons | Button class recipe (primary, secondary, ghost, danger, danger-ghost × sm, md, lg, icon) |
| `Button` | DashKit | The button, with `icon` and `loading` |
| `BTN_PRIMARY`, `BTN_SECONDARY`, `BTN_GHOST`, `BTN_PRIMARY_SM`, `BTN_SECONDARY_SM`, `BTN_DANGER` | DashKit | Prebuilt button strings for older call sites |
| `INPUT`, `TEXTAREA` | DashKit | Field classes (h-9, rounded-xl, ring) |
| `Chip`, `ChipTone` | DashKit | Tinted label by hue |
| `DashPageHeader` | DashKit | Breadcrumbs, title, subtitle, actions |
| `StatCard` | DashKit | Count tile, optionally a filter toggle |
| `SearchInput` | DashKit | Search with the `/` shortcut |
| `SegmentedControl` | DashKit | Filter pills on a track |
| `ToolbarSelect` | DashKit | Compact native select for toolbars |
| `ViewToggle`, `ViewMode` | DashKit | Grid / list toggle |
| `useStoredState` | DashKit | Per-browser preference (view, sort) |
| `EmptyState` | DashKit | Empty and error states |
| `BulkActionBar`, `BulkActionButton` | DashKit | Floating selection bar |
| `OptionCard` | DashKit | "How to start" choice row |
| `ChoiceCard` | DashKit | Either/or setting card |
| `FieldLabel` | DashKit | Label with hint or error |
| `formatRelative` | DashKit | "3 min ago" dates |
| `SectionCard` | DashKit | Titled settings card |
| `SettingRow` | DashKit | Label start, control end |
| `StickySaveBar` | DashKit | Unsaved changes bar |
| `ConfirmDialog` | DashKit | Controlled confirm |
| `AvatarStack` | DashKit | Overlapping avatars with +N |
| `DashTabBar`, `DashTabItem` | DashTabBar | Main page tabs (underline) |
| `SubTabs`, `SubTabPanel`, `useSubTab`, `SubTabItem`, `SubTabsVariant`, `SUB_TAB_PARAM` | DashKit/SubTabs | Second-level tabs kept in `?section=` |
| `Breadcrumbs` | Objects/Breadcrumbs | Breadcrumb trail |
| `Modal` | StyledElements/Modal | Dialog shell with sizes |
| `AI_GRADIENT`, `AI_GRADIENT_LINEAR`, `AI_DARK_SURFACE` | AIBrand | AI brand paints |
| `AIMark`, `AIMarkIcon`, `AIMarkVariant` | AIBrand | The LearnHouse AI logo |
| `AIButton`, `AIButtonMark`, `aiButtonClass`, `AIButtonVariant`, `AIButtonSize` | AIBrand | AI actions |
| `AIChip` | AIBrand | Small "AI" label |
| `aiSurface`, `AIAccentLine`, `AISurfaceHeader` | AIBrand | AI panels |
| `AIAvatar` | AIBrand | Assistant avatar in chats |
| `AIThinking`, `AIShimmer` | AIBrand | AI loading states |
| `DashPage` | primitives | Page body shell |
| `Panel` | primitives | The white card; `divided` for lists, `padded` for p-5 |
| `Toolbar` | primitives | Search + filters row |
| `Eyebrow` | primitives | Small uppercase group label |
| `StatusPill`, `StatusDot`, `STATUS_TONE`, `Status` | primitives | Status by meaning (success, warning, danger, info, neutral, ai) |
| `Skeleton` | primitives | Loading block |
