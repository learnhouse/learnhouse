/**
 * Class recipes: the Tailwind strings the redesigned pages repeat, named once.
 * They are the exact classes already on screen (so swapping a literal for a
 * recipe changes nothing), written with the palette utilities the tokens in
 * design/tokens.ts map to. Pure module, safe on the server.
 *
 * Prefer a primitive (DashPage, Panel, Toolbar…) when one exists; reach for a
 * recipe on links, list rows or wrappers that need the look without the
 * component.
 */
export const recipes = {
  // ── layout ──
  /** Dashboard page body under DashPageHeader: gutters, section rhythm, no sideways overflow. */
  pageShell: 'px-4 sm:px-10 pb-10 flex flex-col gap-5 w-full min-w-0',
  /** Four stat tiles: two per row on phones. */
  statGrid: 'grid grid-cols-2 lg:grid-cols-4 gap-3',
  /** Card grid for courses, paths, podcasts, communities. */
  cardGrid: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
  /** Search + filters row: stacked on phones, one row from xl. */
  toolbar: 'flex flex-col xl:flex-row gap-3 xl:items-center',
  /** The filter group at the end of a toolbar. */
  toolbarEnd: 'flex flex-wrap items-center gap-2 xl:ms-auto',

  // ── surfaces ──
  /** The white card every redesigned page is built from. */
  card: 'bg-white rounded-2xl nice-shadow',
  /** A card holding a list or table: rows separated by hairlines. */
  listCard: 'bg-white rounded-2xl nice-shadow overflow-hidden divide-y divide-neutral-100',
  /** Header row of a table inside a list card. */
  tableHead: 'px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500',
  /** Grey icon square at the start of a card header or row. */
  iconTile: 'w-9 h-9 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0',
  /** Grey track behind segmented items. */
  track: 'inline-flex items-center rounded-xl bg-neutral-200/60 p-1',
  /** The selected item on a track. */
  trackItemActive: 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.06)]',
  /** An idle item on a track. */
  trackItemIdle: 'text-neutral-500 hover:text-neutral-800',

  // ── text ──
  /** Small uppercase label above a group (a "kicker"). */
  eyebrow: 'text-[11px] font-semibold uppercase tracking-wide text-neutral-400',
  pageTitle: 'text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900',
  sectionTitle: 'text-base font-semibold text-neutral-900 leading-tight',
  description: 'text-sm text-neutral-500',
  meta: 'text-xs text-neutral-400',

  // ── states ──
  /** Keyboard focus for buttons and links. */
  focusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 focus-visible:ring-offset-2',
  /** Focus for text fields. */
  fieldFocus: 'focus:outline-none focus:ring-2 focus:ring-neutral-900/15',
  /** Loading placeholder block; size it with h-* w-*. */
  skeleton: 'rounded-lg bg-neutral-100 animate-pulse',
  /** The amber "unsaved" dot. */
  dirtyDot: 'w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0',

  // ── dark surfaces ──
  /** Floating dark bar (bulk actions, unsaved changes). */
  floatingBar: 'rounded-2xl bg-neutral-900 text-white shadow-2xl ring-1 ring-black/10',
  /** A ghost button on a dark bar. */
  floatingBarButton: 'h-8 px-3 rounded-lg text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors',
  /** Focus mode in its dark theme (video theater). */
  readingDark: 'bg-[#0b0b0c] text-white [color-scheme:dark]',
  /** Focus mode in its light theme. */
  readingLight: 'bg-[#f7f7f6] text-neutral-900',
  /** A raised control on a dark surface. */
  darkControl: 'bg-white/[0.07] text-white/85 ring-1 ring-white/10 hover:bg-white/[0.12] focus-visible:ring-white/40',
} as const

export type Recipe = keyof typeof recipes
