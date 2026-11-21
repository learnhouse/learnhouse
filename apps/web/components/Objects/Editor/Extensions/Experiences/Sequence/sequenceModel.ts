// Pure logic for the "Sequence" experience (node `expSequence`): normalising
// stored attrs, author validation, the shuffled start order, moves, checking
// and stars. No React, so it is unit-tested directly
// (tests/experiences-sequence.test.mjs).
//
// Stored shape:
//   { blockId, title, instructions, variant: 'list' | 'timeline',
//     items: [{ id, text, detail? }] }   // 3–10, stored in the CORRECT order

import { asArray, shuffle } from '../shared/utils'

export interface SequenceItem {
  id: string
  text: string
  /** Shown after checking in the timeline variant (a year, a date, a step note). */
  detail?: string
}

export type SequenceVariant = 'list' | 'timeline'

export interface SequenceData {
  blockId: string
  title: string
  instructions: string
  items: SequenceItem[]
  variant: SequenceVariant
}

export const SEQUENCE_LIMITS = { minItems: 3, maxItems: 10 } as const

/** Learners get one more try after the first check; then the answer is shown. */
export const SEQUENCE_MAX_ATTEMPTS = 2

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

export function normalizeSequence(attrs: any): SequenceData {
  const raw: any[] = asArray(attrs?.items)
  const seen = new Set<string>()
  const items: SequenceItem[] = raw
    .filter((it) => it && typeof it === 'object')
    .map((it, i) => {
      let id = str(it.id, `s${i + 1}`) || `s${i + 1}`
      while (seen.has(id)) id = `${id}_${i}`
      seen.add(id)
      const item: SequenceItem = { id, text: str(it.text) }
      const detail = str(it.detail)
      if (detail) item.detail = detail
      return item
    })
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    instructions: str(attrs?.instructions),
    items,
    variant: attrs?.variant === 'timeline' ? 'timeline' : 'list',
  }
}

/** The filled-in example; same content and keys as the registry's insert. */
export function exampleSequence(t: T = identityT): Omit<SequenceData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.sequence.example.${key}`, fallback)
  return {
    title: k('title', 'The water cycle'),
    instructions: k('instructions', 'Put the stages in the right order.'),
    variant: 'list',
    items: [
      { id: 's1', text: k('step1', 'Water evaporates from the sea') },
      { id: 's2', text: k('step2', 'Vapour cools and forms clouds') },
      { id: 's3', text: k('step3', 'Rain or snow falls') },
      { id: 's4', text: k('step4', 'Water flows back to the sea') },
    ],
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type SequenceIssueCode = 'too_few_items' | 'too_many_items' | 'empty_item' | 'duplicate_item' | 'missing_detail'

export interface SequenceIssue {
  code: SequenceIssueCode
  id?: string
  severity: 'error' | 'warning'
}

export function validateSequence(data: SequenceData): SequenceIssue[] {
  const issues: SequenceIssue[] = []
  if (data.items.length < SEQUENCE_LIMITS.minItems) issues.push({ code: 'too_few_items', severity: 'error' })
  if (data.items.length > SEQUENCE_LIMITS.maxItems) issues.push({ code: 'too_many_items', severity: 'warning' })
  const seen = new Set<string>()
  data.items.forEach((it) => {
    const key = it.text.trim().toLowerCase()
    if (!key) issues.push({ code: 'empty_item', id: it.id, severity: 'error' })
    else if (seen.has(key)) issues.push({ code: 'duplicate_item', id: it.id, severity: 'warning' })
    else seen.add(key)
    if (data.variant === 'timeline' && key && !it.detail?.trim()) issues.push({ code: 'missing_detail', id: it.id, severity: 'warning' })
  })
  return issues
}

export function playableSequence(data: SequenceData): SequenceData {
  return { ...data, items: data.items.filter((it) => it.text.trim()).slice(0, SEQUENCE_LIMITS.maxItems) }
}

export function isPlayable(data: SequenceData): boolean {
  return playableSequence(data).items.length >= SEQUENCE_LIMITS.minItems
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

export function addItem(data: SequenceData, id: string, text = ''): SequenceData {
  if (data.items.length >= SEQUENCE_LIMITS.maxItems) return data
  return { ...data, items: [...data.items, { id, text }] }
}

export function removeItem(data: SequenceData, id: string): SequenceData {
  if (data.items.length <= SEQUENCE_LIMITS.minItems) return data
  return { ...data, items: data.items.filter((it) => it.id !== id) }
}

export function updateItem(data: SequenceData, id: string, patch: Partial<Omit<SequenceItem, 'id'>>): SequenceData {
  return {
    ...data,
    items: data.items.map((it) => {
      if (it.id !== id) return it
      const next = { ...it, ...patch }
      if (!next.detail) delete next.detail
      return next
    }),
  }
}

/** Move one entry of a list (author items or learner order); out-of-range moves are no-ops. */
export function moveInList<V>(list: readonly V[], from: number, to: number): V[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice()
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function moveItem(data: SequenceData, from: number, to: number): SequenceData {
  return { ...data, items: moveInList(data.items, from, to) }
}

// ─── Learner ────────────────────────────────────────────────────────────────

/** Shuffled copy; with more than one item never the input order (shared helper). */
export const shuffleIds: <V>(_arr: readonly V[], _rng?: () => number) => V[] = shuffle

/**
 * The order learners start from: shuffled and never already solved. Items with
 * the same text are interchangeable, so "solved" compares texts, not ids.
 */
export function initialOrder(data: SequenceData, rng: () => number = Math.random): string[] {
  const ids = data.items.map((it) => it.id)
  if (ids.length < 2) return ids
  const texts = new Set(data.items.map((it) => norm(it.text)))
  if (texts.size < 2) return shuffleIds(ids, rng)
  for (let attempt = 0; attempt < 8; attempt++) {
    const order = shuffleIds(ids, rng)
    if (!checkSequence(data, order).perfect) return order
  }
  // Swap the first two distinct neighbours of the correct order.
  const order = ids.slice()
  const i = data.items.findIndex((it, idx) => idx > 0 && norm(it.text) !== norm(data.items[idx - 1].text))
  ;[order[i - 1], order[i]] = [order[i], order[i - 1]]
  return order
}

const norm = (s: string) => s.trim().toLowerCase()

export interface SequenceCheck {
  /** itemId → in the right position. */
  positions: Record<string, boolean>
  inPlace: number
  total: number
  perfect: boolean
}

export function checkSequence(data: SequenceData, order: string[]): SequenceCheck {
  const byId = new Map(data.items.map((it) => [it.id, it]))
  const positions: Record<string, boolean> = {}
  let inPlace = 0
  order.forEach((id, i) => {
    const it = byId.get(id)
    const ok = !!it && !!data.items[i] && norm(it.text) === norm(data.items[i].text)
    positions[id] = ok
    if (ok) inPlace++
  })
  const total = data.items.length
  return { positions, inPlace, total, perfect: total > 0 && inPlace === total && order.length === total }
}

/** 1-based correct position of every item (shown after the last try). */
export function correctPositions(data: SequenceData): Record<string, number> {
  const out: Record<string, number> = {}
  data.items.forEach((it, i) => (out[it.id] = i + 1))
  return out
}

/**
 * Stars: share in place (100% → 3, ≥70% → 2, ≥40% → 1), one star less on the
 * second try, so a perfect second try earns 2.
 */
export function sequenceStars(check: SequenceCheck, attempt: number): 0 | 1 | 2 | 3 {
  if (check.total <= 0) return 0
  const r = check.inPlace / check.total
  const base = r >= 1 ? 3 : r >= 0.7 ? 2 : r >= 0.4 ? 1 : 0
  return Math.max(0, base - (attempt > 1 ? 1 : 0)) as 0 | 1 | 2 | 3
}
