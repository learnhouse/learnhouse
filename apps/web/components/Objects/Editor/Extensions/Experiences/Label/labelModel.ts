// Pure logic for the "Label the diagram" experience (node `expLabel`):
// normalising stored attrs, author validation, the label bank, placing labels
// on pins, checking and stars. No React, no DOM (tests/experiences-label.test.mjs).
//
// Stored shape:
//   { blockId, title, instructions, imageUrl, imageObject,
//     pins: [{ id, x, y, label }],   // x / y: % of the image; 2–12
//     distractors: [string] }        // 0–4 wrong labels mixed into the bank
//
// Pins are checked by label text (trimmed, case-insensitive), so two pins
// with the same label accept either chip.

import { asArray, normalizeAnswer, shuffle, starsFromRatio } from '../shared/utils'

export interface LabelPin {
  id: string
  x: number
  y: number
  label: string
}

export interface LabelData {
  blockId: string
  title: string
  instructions: string
  imageUrl: string
  imageObject: Record<string, unknown> | null
  pins: LabelPin[]
  distractors: string[]
}

export const LABEL_LIMITS = { minPins: 2, maxPins: 12, maxDistractors: 4 } as const

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

function pct(v: unknown, fallback = 50): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100
}

/** Guard whatever is stored into the shape the UI expects. */
export function normalizeLabel(attrs: any): LabelData {
  const seen = new Set<string>()
  const pins: LabelPin[] = asArray<any>(attrs?.pins)
    .filter((p) => p && typeof p === 'object')
    .map((p, i) => {
      let id = str(p.id, `p${i + 1}`) || `p${i + 1}`
      while (seen.has(id)) id = `${id}_${i}`
      seen.add(id)
      return { id, x: pct(p.x), y: pct(p.y), label: str(p.label) }
    })
  const distractors = asArray<unknown>(attrs?.distractors)
    .filter((d) => typeof d === 'string' || typeof d === 'number')
    .map((d) => str(d))
  const obj = attrs?.imageObject
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    instructions: str(attrs?.instructions),
    imageUrl: str(attrs?.imageUrl),
    imageObject: obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null,
    pins,
    distractors,
  }
}

/**
 * The filled-in example: a plant, drawn by the view while there is no image.
 * The pins sit on the drawing's flower, leaf, stem and roots.
 */
export function exampleLabel(t: T = identityT): Omit<LabelData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.label.example.${key}`, fallback)
  return {
    title: k('title', 'Parts of a plant'),
    instructions: k('instructions', 'Put each label on the right part.'),
    imageUrl: '',
    imageObject: null,
    pins: [
      { id: 'p1', x: 50, y: 17, label: k('flower', 'Flower') },
      { id: 'p2', x: 34, y: 47, label: k('leaf', 'Leaf') },
      { id: 'p3', x: 50, y: 66, label: k('stem', 'Stem') },
      { id: 'p4', x: 58, y: 90, label: k('roots', 'Roots') },
    ],
    distractors: [k('seed', 'Seed'), k('thorn', 'Thorn')],
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type LabelIssueCode =
  | 'no_image'
  | 'too_few_pins'
  | 'too_many_pins'
  | 'too_many_distractors'
  | 'empty_label'
  | 'duplicate_label'
  | 'distractor_is_label'

export interface LabelIssue {
  code: LabelIssueCode
  /** The pin the hint belongs to (absent for block-level hints). */
  id?: string
  /** Index of the distractor, for distractor hints. */
  index?: number
  severity: 'error' | 'warning'
}

export function validateLabel(data: LabelData, src = data.imageUrl): LabelIssue[] {
  const issues: LabelIssue[] = []
  if (!src) issues.push({ code: 'no_image', severity: 'warning' })
  if (data.pins.length < LABEL_LIMITS.minPins) issues.push({ code: 'too_few_pins', severity: 'error' })
  if (data.pins.length > LABEL_LIMITS.maxPins) issues.push({ code: 'too_many_pins', severity: 'warning' })
  if (data.distractors.length > LABEL_LIMITS.maxDistractors) issues.push({ code: 'too_many_distractors', severity: 'warning' })
  const seen = new Set<string>()
  data.pins.forEach((p) => {
    const key = normalizeAnswer(p.label)
    if (!key) issues.push({ code: 'empty_label', id: p.id, severity: 'error' })
    else if (seen.has(key)) issues.push({ code: 'duplicate_label', id: p.id, severity: 'warning' })
    else seen.add(key)
  })
  data.distractors.forEach((d, index) => {
    if (normalizeAnswer(d) && seen.has(normalizeAnswer(d))) issues.push({ code: 'distractor_is_label', index, severity: 'warning' })
  })
  return issues
}

/** Pins and distractors learners actually play with. */
export function playableLabel(data: LabelData): LabelData {
  const pins = data.pins.filter((p) => p.label.trim()).slice(0, LABEL_LIMITS.maxPins)
  const labels = new Set(pins.map((p) => normalizeAnswer(p.label)))
  const distractors = data.distractors
    .filter((d) => d.trim() && !labels.has(normalizeAnswer(d)))
    .slice(0, LABEL_LIMITS.maxDistractors)
  return { ...data, pins, distractors }
}

export function isPlayable(data: LabelData): boolean {
  return playableLabel(data).pins.length >= LABEL_LIMITS.minPins
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

export function addPin(data: LabelData, id: string, x: number, y: number, label = ''): LabelData {
  if (data.pins.length >= LABEL_LIMITS.maxPins) return data
  return { ...data, pins: [...data.pins, { id, x: pct(x), y: pct(y), label }] }
}

export function movePin(data: LabelData, id: string, x: number, y: number): LabelData {
  return { ...data, pins: data.pins.map((p) => (p.id === id ? { ...p, x: pct(x), y: pct(y) } : p)) }
}

export function nudgePin(data: LabelData, id: string, dx: number, dy: number): LabelData {
  const p = data.pins.find((q) => q.id === id)
  return p ? movePin(data, id, p.x + dx, p.y + dy) : data
}

export function updatePin(data: LabelData, id: string, patch: Partial<Omit<LabelPin, 'id'>>): LabelData {
  return { ...data, pins: data.pins.map((p) => (p.id === id ? { ...p, ...patch, x: pct(patch.x ?? p.x), y: pct(patch.y ?? p.y) } : p)) }
}

export function removePin(data: LabelData, id: string): LabelData {
  return { ...data, pins: data.pins.filter((p) => p.id !== id) }
}

export function addDistractor(data: LabelData, text = ''): LabelData {
  if (data.distractors.length >= LABEL_LIMITS.maxDistractors) return data
  return { ...data, distractors: [...data.distractors, text] }
}

export function updateDistractor(data: LabelData, index: number, text: string): LabelData {
  return { ...data, distractors: data.distractors.map((d, i) => (i === index ? text : d)) }
}

export function removeDistractor(data: LabelData, index: number): LabelData {
  return { ...data, distractors: data.distractors.filter((_, i) => i !== index) }
}

// ─── Learner ────────────────────────────────────────────────────────────────

export interface LabelChip {
  id: string
  text: string
}

/** One chip per pin label plus one per distractor (ids are stable per content). */
export function labelBank(data: LabelData): LabelChip[] {
  return [...data.pins.map((p) => ({ id: `p:${p.id}`, text: p.label })), ...data.distractors.map((d, i) => ({ id: `d:${i}`, text: d }))]
}

export function bankOrder(data: LabelData, rng: () => number = Math.random): string[] {
  return shuffle(
    labelBank(data).map((c) => c.id),
    rng,
  )
}

/** pinId → chipId placed on it. */
export type LabelPlacement = Record<string, string>

/** The pin a chip sits on, or null. */
export function pinOfChip(placement: LabelPlacement, chipId: string): string | null {
  for (const [pin, chip] of Object.entries(placement)) if (chip === chipId) return pin
  return null
}

/**
 * Put a chip on a pin (null: back to the bank). A chip sits on one pin at a
 * time; a chip already on the target pin goes back to the bank.
 */
export function placeLabel(placement: LabelPlacement, chipId: string, pinId: string | null): LabelPlacement {
  const next: LabelPlacement = {}
  for (const [pin, chip] of Object.entries(placement)) {
    if (chip === chipId || pin === pinId) continue
    next[pin] = chip
  }
  if (pinId) next[pinId] = chipId
  return next
}

export function unplacedChips(order: string[], placement: LabelPlacement): string[] {
  const used = new Set(Object.values(placement))
  return order.filter((id) => !used.has(id))
}

export function allLabelled(data: LabelData, placement: LabelPlacement): boolean {
  return data.pins.every((p) => !!placement[p.id])
}

export type PinResult = 'correct' | 'wrong' | 'empty'

export interface LabelCheck {
  results: Record<string, PinResult>
  correct: number
  total: number
  stars: 0 | 1 | 2 | 3
  perfect: boolean
}

export function checkLabel(data: LabelData, placement: LabelPlacement): LabelCheck {
  const text = new Map(labelBank(data).map((c) => [c.id, c.text]))
  const results: Record<string, PinResult> = {}
  let correct = 0
  data.pins.forEach((p) => {
    const chip = placement[p.id]
    if (!chip) results[p.id] = 'empty'
    else if (normalizeAnswer(text.get(chip)) === normalizeAnswer(p.label)) {
      results[p.id] = 'correct'
      correct++
    } else results[p.id] = 'wrong'
  })
  const total = data.pins.length
  return { results, correct, total, stars: total ? starsFromRatio(correct / total) : 0, perfect: total > 0 && correct === total }
}

/** "Retry wrong ones": correct labels stay on their pins, the rest return to the bank. */
export function retryWrong(placement: LabelPlacement, check: LabelCheck): LabelPlacement {
  const next: LabelPlacement = {}
  Object.entries(placement).forEach(([pin, chip]) => {
    if (check.results[pin] === 'correct') next[pin] = chip
  })
  return next
}

/** Convert a pointer position inside a rect into image percentages. */
export function pointToPercent(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 50, y: 50 }
  return { x: pct(((clientX - rect.left) / rect.width) * 100), y: pct(((clientY - rect.top) / rect.height) * 100) }
}
