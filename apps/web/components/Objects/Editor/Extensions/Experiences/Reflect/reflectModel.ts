// Pure logic for the "Reflection" experience (node `expReflect`): normalising
// stored attrs, author validation, word counting (any script) and the score
// from the key points a learner ticks. No React, so it is unit-tested
// directly (tests/experiences-reflect.test.mjs).
//
// Stored shape:
//   { blockId, title, prompt,
//     guidingQuestions: [string],   // 0–5
//     minWords: 30,                 // 0–500 (0: compare straight away)
//     modelAnswer: string,          // optional
//     checklist: [string] }         // 0–8 key points

import { asArray, starsFromRatio } from '../shared/utils'

export interface ReflectData {
  blockId: string
  title: string
  prompt: string
  guidingQuestions: string[]
  minWords: number
  modelAnswer: string
  checklist: string[]
}

export const REFLECT_LIMITS = { maxGuiding: 5, maxChecklist: 8, minWords: 0, maxWords: 500, defaultMinWords: 30 } as const

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

export function clampMinWords(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return REFLECT_LIMITS.defaultMinWords
  return Math.min(REFLECT_LIMITS.maxWords, Math.max(REFLECT_LIMITS.minWords, Math.round(n)))
}

/** Guard whatever is stored (AI output, collab peers, pasted HTML) into the shape the UI expects. */
export function normalizeReflect(attrs: any): ReflectData {
  const strings = (v: unknown) => asArray<unknown>(v).filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => str(x))
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    prompt: str(attrs?.prompt),
    guidingQuestions: strings(attrs?.guidingQuestions),
    minWords: clampMinWords(attrs?.minWords),
    modelAnswer: str(attrs?.modelAnswer),
    checklist: strings(attrs?.checklist),
  }
}

/** The filled-in example a new block starts with; same content and keys as the registry's insert. */
export function exampleReflect(t: T = identityT): Omit<ReflectData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.reflect.example.${key}`, fallback)
  return {
    title: k('title', 'In your own words'),
    prompt: k('prompt', 'Explain why the seasons change during the year, as if to a friend.'),
    guidingQuestions: [
      k('g1', 'What is tilted, and by how much?'),
      k('g2', 'What changes about the sunlight that reaches us?'),
      k('g3', 'Why are the seasons opposite in the two hemispheres?'),
    ],
    minWords: 30,
    modelAnswer: k(
      'model',
      'The Earth’s axis is tilted by about 23°. As the Earth orbits the Sun, first one hemisphere and then the other leans towards it. The half leaning towards the Sun gets more direct light and longer days, so it has summer, while the other half has winter. It is not about being closer to the Sun.',
    ),
    checklist: [
      k('p1', 'The Earth’s axis is tilted'),
      k('p2', 'The Earth orbits the Sun over a year'),
      k('p3', 'More direct sunlight and longer days in summer'),
      k('p4', 'It is not caused by distance from the Sun'),
    ],
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type ReflectIssueCode = 'empty_prompt' | 'too_many_guiding' | 'too_many_points' | 'empty_guiding' | 'empty_point' | 'nothing_to_compare'

export interface ReflectIssue {
  code: ReflectIssueCode
  /** Index of the guiding question or key point the hint belongs to. */
  index?: number
  list?: 'guiding' | 'checklist'
  severity: 'error' | 'warning'
}

export function validateReflect(data: ReflectData): ReflectIssue[] {
  const issues: ReflectIssue[] = []
  if (!data.prompt.trim()) issues.push({ code: 'empty_prompt', severity: 'error' })
  if (data.guidingQuestions.length > REFLECT_LIMITS.maxGuiding) issues.push({ code: 'too_many_guiding', severity: 'warning' })
  if (data.checklist.length > REFLECT_LIMITS.maxChecklist) issues.push({ code: 'too_many_points', severity: 'warning' })
  data.guidingQuestions.forEach((g, index) => {
    if (!g.trim()) issues.push({ code: 'empty_guiding', index, list: 'guiding', severity: 'warning' })
  })
  data.checklist.forEach((p, index) => {
    if (!p.trim()) issues.push({ code: 'empty_point', index, list: 'checklist', severity: 'warning' })
  })
  if (!data.modelAnswer.trim() && !data.checklist.some((p) => p.trim())) issues.push({ code: 'nothing_to_compare', severity: 'warning' })
  return issues
}

/** What learners see: blank entries dropped, lists capped. */
export function playableReflect(data: ReflectData): ReflectData {
  return {
    ...data,
    guidingQuestions: data.guidingQuestions.filter((g) => g.trim()).slice(0, REFLECT_LIMITS.maxGuiding),
    checklist: data.checklist.filter((p) => p.trim()).slice(0, REFLECT_LIMITS.maxChecklist),
  }
}

export function isPlayable(data: ReflectData): boolean {
  return data.prompt.trim().length > 0
}

// ─── Author edits (immutable list helpers) ─────────────────────────────────

export function addEntry(list: string[], max: number, value = ''): string[] {
  return list.length >= max ? list : [...list, value]
}

export function removeEntry(list: string[], index: number): string[] {
  return list.filter((_, i) => i !== index)
}

export function updateEntry(list: string[], index: number, value: string): string[] {
  return list.map((x, i) => (i === index ? value : x))
}

// ─── Word count ─────────────────────────────────────────────────────────────

// Scripts written without spaces between words: Han, Hiragana, Katakana,
// Hangul is spaced (counted as words), Thai, Lao, Khmer, Myanmar.
const UNSPACED = /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿຀-໿ក-៿က-႟]/
const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g
const WORDLIKE = /[\p{L}\p{N}]/u

type SegmenterCtor = new (_locale?: string, _opts?: { granularity: 'word' }) => {
  segment: (_s: string) => Iterable<{ segment: string; isWordLike?: boolean }>
}

function segmenter(): SegmenterCtor | null {
  const S = (globalThis as any).Intl?.Segmenter
  return typeof S === 'function' ? (S as SegmenterCtor) : null
}

/**
 * Words in a text, for any script. Spaced scripts split on whitespace (so
 * "well-known" and "don't" are one word). Text in unspaced scripts (Chinese,
 * Japanese, Thai…) uses Intl.Segmenter word boundaries when available, and
 * otherwise counts each CJK character as one word.
 */
export function countWords(text: string, options: { useSegmenter?: boolean } = {}): number {
  const s = String(text ?? '').normalize('NFKC')
  if (!s.trim()) return 0
  let count = 0
  const useSeg = options.useSegmenter !== false ? segmenter() : null
  for (const token of s.split(/\s+/)) {
    if (!token) continue
    if (!UNSPACED.test(token)) {
      if (WORDLIKE.test(token)) count++
      continue
    }
    if (useSeg) {
      const seg = new useSeg(undefined, { granularity: 'word' })
      for (const part of seg.segment(token)) if (part.isWordLike) count++
      continue
    }
    // Fallback: each CJK character is a word; runs of other letters count once.
    const cjk = token.match(CJK_CHAR)?.length ?? 0
    const rest = token.replace(CJK_CHAR, ' ').split(/\s+/).filter((x) => WORDLIKE.test(x)).length
    count += cjk + rest
  }
  return count
}

/** True when the learner has written enough to compare. */
export function reachedGoal(words: number, minWords: number): boolean {
  return words >= Math.max(0, minWords)
}

/** 0..1 progress towards the word goal (1 when there is no goal). */
export function goalProgress(words: number, minWords: number): number {
  if (minWords <= 0) return 1
  return Math.min(1, Math.max(0, words / minWords))
}

export interface ReflectScore {
  ticked: number
  total: number
  stars: 0 | 1 | 2 | 3
}

/** Ticked key points out of the checklist. With no checklist there is no score. */
export function scoreReflect(ticked: ReadonlySet<number> | number[], total: number): ReflectScore | null {
  if (total <= 0) return null
  const set = ticked instanceof Set ? ticked : new Set(ticked as number[])
  const n = [...set].filter((i) => Number.isInteger(i) && i >= 0 && i < total).length
  return { ticked: n, total, stars: starsFromRatio(n / total) }
}
