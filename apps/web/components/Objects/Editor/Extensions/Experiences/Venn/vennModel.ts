// Pure logic for the "Venn compare" experience (node `expVenn`): normalising
// stored attrs, author validation, placing chips, checking and stars. No
// React, so it is unit-tested directly (tests/experiences-venn.test.mjs).
//
// Stored shape:
//   { blockId, title, instructions, showNeither,
//     sets: { a: { label, color }, b: { label, color } },
//     items: [{ id, text, zone: 'a'|'b'|'both'|'neither', explanation? }] } // 3–16

import { asArray, shuffle, starsFromRatio } from '../shared/utils'

export const VENN_ZONES = ['a', 'both', 'b', 'neither'] as const
export type VennZone = (typeof VENN_ZONES)[number]

export const VENN_COLORS = ['sky', 'amber', 'emerald', 'rose', 'violet'] as const
export type VennColor = (typeof VENN_COLORS)[number]

export interface VennSet {
  label: string
  color: VennColor
}

export interface VennItem {
  id: string
  text: string
  zone: VennZone
  explanation?: string
}

export interface VennData {
  blockId: string
  title: string
  instructions: string
  sets: { a: VennSet; b: VennSet }
  items: VennItem[]
  showNeither: boolean
}

export const VENN_LIMITS = { minItems: 3, maxItems: 16 } as const

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

const COLOR_ALIAS: Record<string, VennColor> = {
  blue: 'sky',
  green: 'emerald',
  teal: 'emerald',
  orange: 'amber',
  yellow: 'amber',
  red: 'rose',
  pink: 'rose',
  purple: 'violet',
  indigo: 'violet',
}

export function vennColorOf(v: unknown, fallback: VennColor): VennColor {
  if (typeof v !== 'string') return fallback
  const s = v.toLowerCase()
  if ((VENN_COLORS as readonly string[]).includes(s)) return s as VennColor
  return COLOR_ALIAS[s] ?? fallback
}

const ZONE_ALIAS: Record<string, VennZone> = {
  a: 'a',
  b: 'b',
  both: 'both',
  ab: 'both',
  overlap: 'both',
  neither: 'neither',
  none: 'neither',
  outside: 'neither',
}

export function zoneOf(v: unknown): VennZone {
  return (typeof v === 'string' && ZONE_ALIAS[v.toLowerCase()]) || 'a'
}

function setOf(raw: any, fallbackColor: VennColor): VennSet {
  const o = raw && typeof raw === 'object' ? raw : {}
  return { label: str(o.label), color: vennColorOf(o.color, fallbackColor) }
}

/** Guard whatever is stored (AI output, collab peers, pasted HTML) into the shape the UI expects. */
export function normalizeVenn(attrs: any): VennData {
  let rawSets = attrs?.sets
  if (typeof rawSets === 'string') {
    try {
      rawSets = JSON.parse(rawSets)
    } catch {
      rawSets = null
    }
  }
  const a = setOf(rawSets?.a, 'sky')
  const b = setOf(rawSets?.b, a.color === 'amber' ? 'rose' : 'amber')
  const seen = new Set<string>()
  const items: VennItem[] = asArray<any>(attrs?.items)
    .filter((it) => it && typeof it === 'object')
    .map((it, i) => {
      let id = str(it.id, `i${i + 1}`) || `i${i + 1}`
      while (seen.has(id)) id = `${id}_${i}`
      seen.add(id)
      const item: VennItem = { id, text: str(it.text), zone: zoneOf(it.zone) }
      const explanation = str(it.explanation)
      if (explanation) item.explanation = explanation
      return item
    })
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    instructions: str(attrs?.instructions),
    sets: { a, b },
    items,
    showNeither: attrs?.showNeither === true,
  }
}

/** The filled-in example a new block starts with; same keys as the registry's insert. */
export function exampleVenn(t: T = identityT): Omit<VennData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.venn.example.${key}`, fallback)
  return {
    title: k('title', 'Frogs and toads'),
    instructions: k('instructions', 'Where does each fact belong?'),
    sets: {
      a: { label: k('set_a', 'Frogs'), color: 'emerald' },
      b: { label: k('set_b', 'Toads'), color: 'amber' },
    },
    showNeither: false,
    items: [
      { id: 'i1', text: k('smooth', 'Smooth, wet skin'), zone: 'a' },
      { id: 'i2', text: k('long_legs', 'Long legs for jumping'), zone: 'a' },
      { id: 'i3', text: k('amphibian', 'Amphibians'), zone: 'both', explanation: k('amphibian_why', 'Both start life in water and later breathe air.') },
      { id: 'i4', text: k('eggs', 'Lay eggs'), zone: 'both' },
      { id: 'i5', text: k('dry', 'Dry, bumpy skin'), zone: 'b' },
      { id: 'i6', text: k('walk', 'Short legs, often walk'), zone: 'b', explanation: k('walk_why', 'Toads hop short distances or walk instead of leaping.') },
    ],
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type VennIssueCode =
  | 'too_few_items'
  | 'too_many_items'
  | 'empty_set_a'
  | 'empty_set_b'
  | 'same_labels'
  | 'empty_item'
  | 'duplicate_item'
  | 'neither_hidden'
  | 'no_both'

export interface VennIssue {
  code: VennIssueCode
  id?: string
  severity: 'error' | 'warning'
}

export function validateVenn(data: VennData): VennIssue[] {
  const issues: VennIssue[] = []
  const { items, sets } = data
  if (!sets.a.label.trim()) issues.push({ code: 'empty_set_a', severity: 'error' })
  if (!sets.b.label.trim()) issues.push({ code: 'empty_set_b', severity: 'error' })
  if (sets.a.label.trim() && sets.a.label.trim().toLowerCase() === sets.b.label.trim().toLowerCase())
    issues.push({ code: 'same_labels', severity: 'warning' })
  const filled = items.filter((it) => it.text.trim())
  if (filled.length < VENN_LIMITS.minItems) issues.push({ code: 'too_few_items', severity: 'error' })
  if (items.length > VENN_LIMITS.maxItems) issues.push({ code: 'too_many_items', severity: 'warning' })
  if (filled.length >= VENN_LIMITS.minItems && !filled.some((it) => it.zone === 'both')) issues.push({ code: 'no_both', severity: 'warning' })
  const seen = new Set<string>()
  items.forEach((it) => {
    const key = it.text.trim().toLowerCase()
    if (!key) issues.push({ code: 'empty_item', id: it.id, severity: 'error' })
    else if (seen.has(key)) issues.push({ code: 'duplicate_item', id: it.id, severity: 'warning' })
    else seen.add(key)
    if (it.zone === 'neither' && !data.showNeither) issues.push({ code: 'neither_hidden', id: it.id, severity: 'warning' })
  })
  return issues
}

/** The zones a learner can drop into. */
export function activeZones(data: Pick<VennData, 'showNeither'>): VennZone[] {
  return data.showNeither ? ['a', 'both', 'b', 'neither'] : ['a', 'both', 'b']
}

/** Items learners actually play with: blank ones skipped, "neither" items only when that well shows. */
export function playableVenn(data: VennData): VennData {
  const zones = new Set(activeZones(data))
  const items = data.items.filter((it) => it.text.trim() && zones.has(it.zone)).slice(0, VENN_LIMITS.maxItems)
  return { ...data, items }
}

export function isPlayable(data: VennData): boolean {
  const p = playableVenn(data)
  return !!p.sets.a.label.trim() && !!p.sets.b.label.trim() && p.items.length >= VENN_LIMITS.minItems
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

export function addItem(data: VennData, id: string, zone: VennZone = 'a', text = ''): VennData {
  if (data.items.length >= VENN_LIMITS.maxItems) return data
  return { ...data, items: [...data.items, { id, text, zone }] }
}

export function removeItem(data: VennData, id: string): VennData {
  if (data.items.length <= VENN_LIMITS.minItems) return data
  return { ...data, items: data.items.filter((it) => it.id !== id) }
}

export function updateItem(data: VennData, id: string, patch: Partial<Omit<VennItem, 'id'>>): VennData {
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

export function updateSet(data: VennData, which: 'a' | 'b', patch: Partial<VennSet>): VennData {
  return { ...data, sets: { ...data.sets, [which]: { ...data.sets[which], ...patch } } }
}

/** Next palette colour that the other set does not use. */
export function cycleColor(current: VennColor, other: VennColor): VennColor {
  let i = VENN_COLORS.indexOf(current)
  for (let n = 0; n < VENN_COLORS.length; n++) {
    i = (i + 1) % VENN_COLORS.length
    if (VENN_COLORS[i] !== other) return VENN_COLORS[i]
  }
  return current
}

// ─── Learner ────────────────────────────────────────────────────────────────

/** itemId → zone the learner put it in (absent or null: still in the tray). */
export type VennPlacement = Record<string, VennZone | null>
export type VennResult = 'correct' | 'wrong' | 'unplaced'

export interface VennCheck {
  results: Record<string, VennResult>
  correct: number
  total: number
  stars: 0 | 1 | 2 | 3
  perfect: boolean
  /** Every "both" item is in the overlap (and there is at least one). */
  overlapRight: boolean
}

export function trayOrder(data: VennData, rng: () => number = Math.random): string[] {
  return shuffle(
    data.items.map((it) => it.id),
    rng,
  )
}

export function place(placement: VennPlacement, itemId: string, zone: VennZone | null): VennPlacement {
  return { ...placement, [itemId]: zone }
}

export function unplacedIds(order: string[], placement: VennPlacement): string[] {
  return order.filter((id) => !placement[id])
}

export function allPlaced(data: VennData, placement: VennPlacement): boolean {
  return data.items.every((it) => !!placement[it.id])
}

export function checkVenn(data: VennData, placement: VennPlacement): VennCheck {
  const results: Record<string, VennResult> = {}
  let correct = 0
  data.items.forEach((it) => {
    const at = placement[it.id]
    if (!at) results[it.id] = 'unplaced'
    else if (at === it.zone) {
      results[it.id] = 'correct'
      correct++
    } else results[it.id] = 'wrong'
  })
  const total = data.items.length
  const both = data.items.filter((it) => it.zone === 'both')
  const overlapRight = both.length > 0 && both.every((it) => results[it.id] === 'correct') && !data.items.some((it) => it.zone !== 'both' && placement[it.id] === 'both')
  return { results, correct, total, stars: total > 0 ? starsFromRatio(correct / total) : 0, perfect: total > 0 && correct === total, overlapRight }
}

/** "Retry wrong ones": correct items stay, the rest go back to the tray. */
export function retryWrong(placement: VennPlacement, check: VennCheck): VennPlacement {
  const next: VennPlacement = {}
  Object.entries(placement).forEach(([id, zone]) => {
    if (check.results[id] === 'correct') next[id] = zone
  })
  return next
}
