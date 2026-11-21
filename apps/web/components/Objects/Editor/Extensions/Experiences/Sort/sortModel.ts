// Pure logic for the "Sort it" experience (node `expSort`): normalising stored
// attrs, author validation, the learner tray order, checking and stars. No
// React, so it is unit-tested directly (tests/experiences-sort.test.mjs).
//
// Stored shape:
//   { blockId, title, instructions, shuffle,
//     categories: [{ id, label, color }],           // 2–4
//     items: [{ id, text, categoryId, explanation? }] } // 2–20

import { asArray, shuffle } from '../shared/utils'

export interface SortCategory {
  id: string
  label: string
  color: SortColor
}

export interface SortItem {
  id: string
  text: string
  categoryId: string
  explanation?: string
}

export interface SortData {
  blockId: string
  title: string
  instructions: string
  categories: SortCategory[]
  items: SortItem[]
  shuffle: boolean
}

export const SORT_LIMITS = { minCategories: 2, maxCategories: 4, minItems: 2, maxItems: 20 } as const

/** Category colours, one per slot. Stored by name so themes can restyle them. */
export const SORT_COLORS = ['sky', 'amber', 'emerald', 'rose'] as const
export type SortColor = (typeof SORT_COLORS)[number]

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

const isColor = (v: unknown): v is SortColor => typeof v === 'string' && (SORT_COLORS as readonly string[]).includes(v)

/** Common colour names (AI output, the registry) mapped onto the palette. */
const COLOR_ALIAS: Record<string, SortColor> = { green: 'emerald', teal: 'emerald', orange: 'amber', yellow: 'amber', blue: 'sky', red: 'rose', pink: 'rose' }

function colorOf(v: unknown, index: number): SortColor {
  if (isColor(v)) return v
  if (typeof v === 'string' && COLOR_ALIAS[v.toLowerCase()]) return COLOR_ALIAS[v.toLowerCase()]
  return SORT_COLORS[index % SORT_COLORS.length]
}

/** Next colour not used yet (falls back to cycling). */
export function nextColor(categories: SortCategory[]): SortColor {
  const used = new Set(categories.map((c) => c.color))
  return SORT_COLORS.find((c) => !used.has(c)) ?? SORT_COLORS[categories.length % SORT_COLORS.length]
}

/** Guard whatever is stored (AI output, collab peers, pasted HTML) into the shape the UI expects. */
export function normalizeSort(attrs: any): SortData {
  const rawCats: any[] = asArray(attrs?.categories)
  const categories: SortCategory[] = []
  const seenCat = new Set<string>()
  rawCats
    .filter((c) => c && typeof c === 'object')
    .forEach((c, i) => {
      let id = str(c.id, `c${i + 1}`) || `c${i + 1}`
      while (seenCat.has(id)) id = `${id}_${i}`
      seenCat.add(id)
      categories.push({ id, label: str(c.label), color: colorOf(c.color, i) })
    })
  const rawItems: any[] = asArray(attrs?.items)
  const seenItem = new Set<string>()
  const items: SortItem[] = rawItems
    .filter((it) => it && typeof it === 'object')
    .map((it, i) => {
      let id = str(it.id, `i${i + 1}`) || `i${i + 1}`
      while (seenItem.has(id)) id = `${id}_${i}`
      seenItem.add(id)
      const item: SortItem = { id, text: str(it.text), categoryId: str(it.categoryId) }
      const explanation = str(it.explanation)
      if (explanation) item.explanation = explanation
      return item
    })
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    instructions: str(attrs?.instructions),
    categories,
    items,
    shuffle: attrs?.shuffle !== false,
  }
}

/** The filled-in example a new block starts with; same content and keys as the registry's insert. */
export function exampleSort(t: T = identityT): Omit<SortData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.sort.example.${key}`, fallback)
  return {
    title: k('title', 'Renewable or not?'),
    instructions: k('instructions', 'Put each energy source in the right group.'),
    shuffle: true,
    categories: [
      { id: 'c1', label: k('cat_renewable', 'Renewable'), color: 'emerald' },
      { id: 'c2', label: k('cat_fossil', 'Non-renewable'), color: 'amber' },
    ],
    items: [
      { id: 'i1', text: k('solar', 'Solar'), categoryId: 'c1' },
      { id: 'i2', text: k('coal', 'Coal'), categoryId: 'c2', explanation: k('coal_why', 'Coal took millions of years to form, so it runs out.') },
      { id: 'i3', text: k('wind', 'Wind'), categoryId: 'c1' },
      { id: 'i4', text: k('gas', 'Natural gas'), categoryId: 'c2' },
      { id: 'i5', text: k('hydro', 'Hydropower'), categoryId: 'c1', explanation: k('hydro_why', 'Rivers keep flowing, refilled by rain.') },
      { id: 'i6', text: k('oil', 'Oil'), categoryId: 'c2' },
    ],
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type SortIssueCode =
  | 'too_few_categories'
  | 'too_many_categories'
  | 'too_few_items'
  | 'too_many_items'
  | 'empty_category'
  | 'empty_item'
  | 'item_no_category'
  | 'unused_category'
  | 'duplicate_item'

export interface SortIssue {
  code: SortIssueCode
  /** The category or item the hint belongs to (absent for block-level issues). */
  id?: string
  /** Blocking issues make the block unplayable; the rest are hints. */
  severity: 'error' | 'warning'
}

export function validateSort(data: SortData): SortIssue[] {
  const issues: SortIssue[] = []
  const { categories, items } = data
  if (categories.length < SORT_LIMITS.minCategories) issues.push({ code: 'too_few_categories', severity: 'error' })
  if (categories.length > SORT_LIMITS.maxCategories) issues.push({ code: 'too_many_categories', severity: 'warning' })
  if (items.length < SORT_LIMITS.minItems) issues.push({ code: 'too_few_items', severity: 'error' })
  if (items.length > SORT_LIMITS.maxItems) issues.push({ code: 'too_many_items', severity: 'warning' })
  const catIds = new Set(categories.map((c) => c.id))
  categories.forEach((c) => {
    if (!c.label.trim()) issues.push({ code: 'empty_category', id: c.id, severity: 'error' })
    else if (!items.some((it) => it.categoryId === c.id)) issues.push({ code: 'unused_category', id: c.id, severity: 'warning' })
  })
  const seenText = new Map<string, string>()
  items.forEach((it) => {
    if (!it.text.trim()) issues.push({ code: 'empty_item', id: it.id, severity: 'error' })
    if (!catIds.has(it.categoryId)) issues.push({ code: 'item_no_category', id: it.id, severity: 'error' })
    const key = it.text.trim().toLowerCase()
    if (key) {
      const first = seenText.get(key)
      if (first !== undefined) issues.push({ code: 'duplicate_item', id: it.id, severity: 'warning' })
      else seenText.set(key, it.id)
    }
  })
  return issues
}

/** Items and categories learners can actually play with (blank ones are skipped). */
export function playableSort(data: SortData): SortData {
  const categories = data.categories.filter((c) => c.label.trim()).slice(0, SORT_LIMITS.maxCategories)
  const catIds = new Set(categories.map((c) => c.id))
  const items = data.items.filter((it) => it.text.trim() && catIds.has(it.categoryId)).slice(0, SORT_LIMITS.maxItems)
  return { ...data, categories, items }
}

export function isPlayable(data: SortData): boolean {
  const p = playableSort(data)
  return p.categories.length >= SORT_LIMITS.minCategories && p.items.length >= SORT_LIMITS.minItems
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

export function addCategory(data: SortData, id: string, label = ''): SortData {
  if (data.categories.length >= SORT_LIMITS.maxCategories) return data
  return { ...data, categories: [...data.categories, { id, label, color: nextColor(data.categories) }] }
}

/** Removing a category moves its items to the first remaining one (never orphans them). */
export function removeCategory(data: SortData, id: string): SortData {
  if (data.categories.length <= SORT_LIMITS.minCategories) return data
  const categories = data.categories.filter((c) => c.id !== id)
  if (categories.length === data.categories.length) return data
  const fallback = categories[0]?.id ?? ''
  return { ...data, categories, items: data.items.map((it) => (it.categoryId === id ? { ...it, categoryId: fallback } : it)) }
}

export function updateCategory(data: SortData, id: string, patch: Partial<Omit<SortCategory, 'id'>>): SortData {
  return { ...data, categories: data.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
}

export function addItem(data: SortData, id: string, categoryId?: string, text = ''): SortData {
  if (data.items.length >= SORT_LIMITS.maxItems) return data
  const cat = categoryId && data.categories.some((c) => c.id === categoryId) ? categoryId : data.categories[0]?.id ?? ''
  return { ...data, items: [...data.items, { id, text, categoryId: cat }] }
}

export function removeItem(data: SortData, id: string): SortData {
  if (data.items.length <= SORT_LIMITS.minItems) return data
  return { ...data, items: data.items.filter((it) => it.id !== id) }
}

export function updateItem(data: SortData, id: string, patch: Partial<Omit<SortItem, 'id'>>): SortData {
  return {
    ...data,
    items: data.items.map((it) => {
      if (it.id !== id) return it
      const next = { ...it, ...patch }
      if (!next.explanation) delete next.explanation
      return next
    }),
  }
}

// ─── Learner ────────────────────────────────────────────────────────────────

/** itemId → categoryId the learner put it in (absent or null: still in the tray). */
export type SortPlacement = Record<string, string | null>

export type ItemResult = 'correct' | 'wrong' | 'unplaced'

export interface SortCheck {
  results: Record<string, ItemResult>
  correct: number
  total: number
  stars: 0 | 1 | 2 | 3
  perfect: boolean
}

/** Shuffled copy; with more than one item never the input order (shared helper). */
export const shuffleIds: <V>(_arr: readonly V[], _rng?: () => number) => V[] = shuffle

/** Item order in the tray: shuffled unless the author turned shuffling off. */
export function trayOrder(data: SortData, rng: () => number = Math.random): string[] {
  const ids = data.items.map((it) => it.id)
  return data.shuffle ? shuffleIds(ids, rng) : ids
}

export function place(placement: SortPlacement, itemId: string, categoryId: string | null): SortPlacement {
  return { ...placement, [itemId]: categoryId }
}

export function unplacedIds(order: string[], placement: SortPlacement): string[] {
  return order.filter((id) => !placement[id])
}

export function allPlaced(data: SortData, placement: SortPlacement): boolean {
  return data.items.every((it) => !!placement[it.id])
}

/** Stars by share correct: 100% → 3, ≥70% → 2, ≥40% → 1. */
export function starsForRatio(correct: number, total: number): 0 | 1 | 2 | 3 {
  if (total <= 0) return 0
  const r = correct / total
  if (r >= 1) return 3
  if (r >= 0.7) return 2
  if (r >= 0.4) return 1
  return 0
}

export function checkSort(data: SortData, placement: SortPlacement): SortCheck {
  const results: Record<string, ItemResult> = {}
  let correct = 0
  data.items.forEach((it) => {
    const at = placement[it.id]
    if (!at) results[it.id] = 'unplaced'
    else if (at === it.categoryId) {
      results[it.id] = 'correct'
      correct++
    } else results[it.id] = 'wrong'
  })
  const total = data.items.length
  const stars = starsForRatio(correct, total)
  return { results, correct, total, stars, perfect: total > 0 && correct === total }
}

/** "Retry wrong ones": correct items stay where they are, the rest go back to the tray. */
export function retryWrong(placement: SortPlacement, check: SortCheck): SortPlacement {
  const next: SortPlacement = {}
  Object.entries(placement).forEach(([id, cat]) => {
    if (check.results[id] === 'correct') next[id] = cat
  })
  return next
}
