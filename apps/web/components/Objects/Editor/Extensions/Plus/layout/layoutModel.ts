/*
 Pure helpers for the layout blocks (EDITOR_PLUS_SPEC.md, section B): attr
 values and defaults, starter content, column re-layout, outline numbering
 and the checklist storage keys. No React and no editor here, so the tests,
 the node views and the static renderer all share one implementation.
*/

export const TAB_VARIANTS = ['line', 'pills', 'boxed'] as const
export type TabVariant = (typeof TAB_VARIANTS)[number]
export const MIN_TABS = 2
export const MAX_TABS = 8

export const COLUMN_LAYOUTS = ['1-1', '1-2', '2-1', '1-1-1', '1-1-1-1'] as const
export type ColumnLayout = (typeof COLUMN_LAYOUTS)[number]
export const COLUMN_GAPS = ['sm', 'md', 'lg'] as const
export type ColumnGap = (typeof COLUMN_GAPS)[number]
export const COLUMN_VALIGNS = ['top', 'center', 'bottom'] as const
export type ColumnVAlign = (typeof COLUMN_VALIGNS)[number]

export const ACCORDION_VARIANTS = ['default', 'bordered', 'filled'] as const
export type AccordionVariant = (typeof ACCORDION_VARIANTS)[number]

export const TIMELINE_VARIANTS = ['steps', 'timeline', 'process'] as const
export type TimelineVariant = (typeof TIMELINE_VARIANTS)[number]
export const TIMELINE_ORIENTATIONS = ['vertical', 'horizontal'] as const
export type TimelineOrientation = (typeof TIMELINE_ORIENTATIONS)[number]

export const TOC_LEVELS = [2, 3, 4] as const
export type TocLevel = (typeof TOC_LEVELS)[number]

/** Colour tokens a timeline step or a key takeaways card can take. */
export const LAYOUT_TONES = ['neutral', 'blue', 'teal', 'green', 'amber', 'rose'] as const
export type LayoutTone = (typeof LAYOUT_TONES)[number]

/** Icons a key takeaways card or a timeline step can show (Phosphor names mapped in the views). */
export const LAYOUT_ICONS = ['lightbulb', 'star', 'check', 'target', 'flag', 'book', 'rocket', 'key'] as const
export type LayoutIcon = (typeof LAYOUT_ICONS)[number]

export function oneOf<T extends string | number>(list: readonly T[], value: unknown, fallback: T): T {
  return (list as readonly unknown[]).includes(value) ? (value as T) : fallback
}

export const toneOf = (value: unknown): LayoutTone | null => (LAYOUT_TONES as readonly unknown[]).includes(value) ? (value as LayoutTone) : null
export const iconOf = (value: unknown): LayoutIcon | null => (LAYOUT_ICONS as readonly unknown[]).includes(value) ? (value as LayoutIcon) : null

// ── Columns ────────────────────────────────────────────────────────────────

export function columnCount(layout: unknown): number {
  return oneOf(COLUMN_LAYOUTS, layout, '1-1').split('-').length
}

/** CSS grid tracks for a layout: '1-2' → 'minmax(0,1fr) minmax(0,2fr)'. */
export function columnTracks(layout: unknown): string {
  return oneOf(COLUMN_LAYOUTS, layout, '1-1')
    .split('-')
    .map((n) => `minmax(0,${n}fr)`)
    .join(' ')
}

/** The layouts offered for a column count (the picker shows all of them). */
export function defaultLayoutFor(count: number): ColumnLayout {
  return count >= 4 ? '1-1-1-1' : count === 3 ? '1-1-1' : '1-1'
}

/** The stored layout, or an even one when it doesn't match the number of columns (content from AI or an import). */
export function effectiveLayout(layout: unknown, count: number): ColumnLayout {
  const l = oneOf(COLUMN_LAYOUTS, layout, '1-1')
  return columnCount(l) === count ? l : defaultLayoutFor(count)
}

const isEmptyParagraph = (block: any) =>
  !!block && block.type === 'paragraph' && (!Array.isArray(block.content) || block.content.length === 0)

const hasContent = (column: any) => Array.isArray(column?.content) && column.content.some((b: any) => !isEmptyParagraph(b))

/**
 * New column children for a layout. Extra columns start with an empty
 * paragraph; when a layout has fewer columns, the content of the removed ones
 * moves into the last kept column so nothing an author wrote is lost.
 */
export function relayoutColumns(columns: any[], layout: unknown): any[] {
  const count = columnCount(layout)
  const out = columns.slice(0, count).map((c) => ({ ...c, content: [...(c.content ?? [])] }))
  while (out.length < count) out.push({ type: 'column', content: [{ type: 'paragraph' }] })
  const moved = columns.slice(count).filter(hasContent).flatMap((c) => c.content)
  if (moved.length) {
    const last = out[count - 1]
    last.content = [...(hasContent(last) ? last.content : []), ...moved]
  }
  return out
}

// ── Reordering ─────────────────────────────────────────────────────────────

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const out = [...list]
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}

// ── Table of contents ──────────────────────────────────────────────────────

export interface OutlineHeading {
  level: number
  text: string
  id: string
  pos?: number
}

export interface OutlineEntry extends OutlineHeading {
  /** Indent depth below the shallowest heading shown (0 = top). */
  depth: number
  /** "1", "1.2", "2.1.3" when numbered. */
  number: string
}

/**
 * The entries a table of contents lists: headings up to `maxLevel`, indented
 * relative to the shallowest one, with hierarchical numbers.
 */
export function outlineEntries(headings: OutlineHeading[], maxLevel: unknown): OutlineEntry[] {
  const max = oneOf(TOC_LEVELS, Number(maxLevel), 3)
  const shown = headings.filter((h) => h.level >= 1 && h.level <= max && h.text.trim() !== '')
  if (!shown.length) return []
  const top = Math.min(...shown.map((h) => h.level))
  const counters: number[] = []
  return shown.map((h) => {
    const depth = h.level - top
    counters.length = depth + 1
    for (let i = 0; i < depth; i++) counters[i] = counters[i] || 1
    counters[depth] = (counters[depth] || 0) + 1
    return { ...h, depth, number: counters.join('.') }
  })
}

// ── Checklist ──────────────────────────────────────────────────────────────

export function checklistStorageKey(activityId: unknown, blockId: unknown): string {
  const a = typeof activityId === 'string' && activityId ? activityId : 'local'
  const b = typeof blockId === 'string' && blockId ? blockId : 'default'
  return `lh:checklist:${a}:${b}`
}

/** An item is tracked by its text, so reordering items keeps their ticks. */
export function checklistItemKey(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)
}

/** A stable fallback id for a list saved without one (hash of its text). */
export function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}`
}

export function newBlockId(): string {
  return `lh_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

// ── Starter content ────────────────────────────────────────────────────────

/** Translates a full key (literal keys, so the @learnhouse/react build keeps only these). */
type T = (_key: string, _fallback: string) => string

const para = (text?: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const bullets = (items: string[]) => ({
  type: 'bulletList',
  content: items.map((text) => ({ type: 'listItem', content: [para(text)] })),
})

export function starterTabs(t: T) {
  return {
    type: 'tabs',
    attrs: { blockId: newBlockId(), variant: 'line' },
    content: [
      { type: 'tabItem', attrs: { title: t('editor.blocks_v2.tabs.sample.tab_1', 'Overview') }, content: [para(t('editor.blocks_v2.tabs.sample.text_1', 'Start with the big picture.'))] },
      { type: 'tabItem', attrs: { title: t('editor.blocks_v2.tabs.sample.tab_2', 'Details') }, content: [para(t('editor.blocks_v2.tabs.sample.text_2', 'Go deeper into how it works.'))] },
      { type: 'tabItem', attrs: { title: t('editor.blocks_v2.tabs.sample.tab_3', 'Example') }, content: [para(t('editor.blocks_v2.tabs.sample.text_3', 'Show it in practice.'))] },
    ],
  }
}

export function starterColumns(t: T) {
  return {
    type: 'columns',
    attrs: { layout: '1-1', gap: 'md', stackOnMobile: true, verticalAlign: 'top' },
    content: [
      { type: 'column', content: [para(t('editor.blocks_v2.columns.sample.left', 'First column'))] },
      { type: 'column', content: [para(t('editor.blocks_v2.columns.sample.right', 'Second column'))] },
    ],
  }
}

export function starterAccordion(t: T) {
  const item = (summary: string, text: string) => ({
    type: 'toggleBlock',
    attrs: { summary, defaultOpen: false },
    content: [para(text)],
  })
  return {
    type: 'accordion',
    attrs: { single: true, variant: 'default' },
    content: [
      item(t('editor.blocks_v2.accordion.sample.item_1', 'What will I learn?'), t('editor.blocks_v2.accordion.sample.text_1', 'Describe the outcome of this lesson.')),
      item(t('editor.blocks_v2.accordion.sample.item_2', 'How long does it take?'), t('editor.blocks_v2.accordion.sample.text_2', 'Give an estimate learners can plan around.')),
      item(t('editor.blocks_v2.accordion.sample.item_3', 'What do I need?'), t('editor.blocks_v2.accordion.sample.text_3', 'List what to have ready before starting.')),
    ],
  }
}

export function starterTimeline(t: T) {
  const step = (title: string, text: string) => ({
    type: 'timelineItem',
    attrs: { title, label: '' },
    content: [para(text)],
  })
  return {
    type: 'timeline',
    attrs: { variant: 'steps', numbered: true, orientation: 'vertical' },
    content: [
      step(t('editor.blocks_v2.timeline.sample.step_1', 'Prepare'), t('editor.blocks_v2.timeline.sample.text_1', 'Gather what you need.')),
      step(t('editor.blocks_v2.timeline.sample.step_2', 'Practice'), t('editor.blocks_v2.timeline.sample.text_2', 'Try it on a small example.')),
      step(t('editor.blocks_v2.timeline.sample.step_3', 'Apply'), t('editor.blocks_v2.timeline.sample.text_3', 'Use it on a real task.')),
    ],
  }
}

export function starterKeyTakeaways(t: T) {
  return {
    type: 'keyTakeaways',
    attrs: { title: '', tone: 'amber', icon: null },
    content: [
      bullets([
        t('editor.blocks_v2.key_takeaways.sample.point_1', 'The main idea in one sentence'),
        t('editor.blocks_v2.key_takeaways.sample.point_2', 'A detail worth remembering'),
        t('editor.blocks_v2.key_takeaways.sample.point_3', 'What to do next'),
      ]),
    ],
  }
}

export function starterChecklist(t: T) {
  const item = (text: string) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(text)] })
  return {
    type: 'taskList',
    attrs: { blockId: newBlockId(), learnerCanCheck: true },
    content: [
      item(t('editor.blocks_v2.checklist.sample.item_1', 'Read the lesson')),
      item(t('editor.blocks_v2.checklist.sample.item_2', 'Try the exercise')),
      item(t('editor.blocks_v2.checklist.sample.item_3', 'Check your answers')),
    ],
  }
}

export function starterTableOfContents() {
  return { type: 'tableOfContents', attrs: { title: '', maxLevel: 3, numbered: false } }
}
