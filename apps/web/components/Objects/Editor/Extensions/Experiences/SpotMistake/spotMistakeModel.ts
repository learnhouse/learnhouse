// Pure logic for the Spot the mistake experience: splitting a passage into
// clickable segments and scoring a learner's picks.

import { newId } from '../shared/utils'

export type SpotMistakeKind = 'text' | 'code'

export interface MistakeSegment {
  id: string
  text: string
  isMistake: boolean
  correction?: string
  explanation?: string
}

export interface SpotMistakeAttrs {
  blockId: string
  title: string
  instructions: string
  kind: SpotMistakeKind
  segments: MistakeSegment[]
}

type Translate = (_key: string, _options?: Record<string, unknown>) => string

export const MAX_SEGMENTS = 80

// Words that end with a period but rarely end a sentence. Lower-case, no
// trailing period. Words like "etc." or "Inc." often do end a sentence, so they
// are left out and handled by the "next word starts lower-case" rule instead.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ave', 'vs', 'cf', 'al',
  'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'pp', 'p', 'approx', 'ca', 'gen', 'gov', 'sen',
  'rep', 'capt', 'lt', 'col', 'sgt', 'rev', 'hon', 'dept', 'univ', 'eq', 'eqs', 'ch', 'sec',
  'mme', 'mlle', 'mm', 'bzw', 'nr', 'sra', 'srta', 'dra', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
])

const TERMINATORS = '.!?…'
const CJK_TERMINATORS = '。！？'
const CLOSERS = '"\'”’)]}»'

function isLowerLetter(ch: string | undefined): boolean {
  if (!ch) return false
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase()
}

/** The token right before index `dotIndex` (letters and inner dots), lower-cased. */
function wordBefore(text: string, dotIndex: number): string {
  let i = dotIndex - 1
  while (i >= 0 && !/\s/.test(text[i]) && !'("“[{«'.includes(text[i])) i--
  return text.slice(i + 1, dotIndex).toLowerCase()
}

function isAbbreviation(word: string): boolean {
  if (!word) return false
  if (ABBREVIATIONS.has(word)) return true
  // Initials ("J." in "J. K. Rowling").
  if (word.length === 1 && /[a-z]/i.test(word)) return true
  // Dotted forms: "e.g", "i.e", "u.s", "z.b", "a.m", "p.m".
  if (/^([a-z]\.)+[a-z]$/i.test(word)) return true
  return false
}

/** Split one paragraph (no line breaks) into sentences. */
function splitParagraph(paragraph: string): string[] {
  const out: string[] = []
  let start = 0
  let i = 0
  while (i < paragraph.length) {
    const ch = paragraph[i]
    if (CJK_TERMINATORS.includes(ch)) {
      let end = i + 1
      while (end < paragraph.length && (CJK_TERMINATORS.includes(paragraph[end]) || CLOSERS.includes(paragraph[end]) || paragraph[end] === '」' || paragraph[end] === '』')) end++
      out.push(paragraph.slice(start, end))
      start = end
      i = end
      continue
    }
    if (!TERMINATORS.includes(ch)) {
      i++
      continue
    }
    let end = i
    while (end < paragraph.length && TERMINATORS.includes(paragraph[end])) end++
    const runLength = end - i
    while (end < paragraph.length && CLOSERS.includes(paragraph[end])) end++
    // A boundary needs whitespace after it (or the end of the paragraph).
    if (end < paragraph.length && !/\s/.test(paragraph[end])) {
      i = end
      continue
    }
    let next = end
    while (next < paragraph.length && /\s/.test(paragraph[next])) next++
    if (next >= paragraph.length) break
    const nextChar = paragraph[next]
    const singleDot = runLength === 1 && ch === '.'
    if (isLowerLetter(nextChar) || (singleDot && isAbbreviation(wordBefore(paragraph, i)))) {
      i = end
      continue
    }
    out.push(paragraph.slice(start, end))
    start = next
    i = next
  }
  if (start < paragraph.length) out.push(paragraph.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Sentences of a prose passage. Line breaks always split. */
export function splitSentences(text: string): string[] {
  const source = (text ?? '').replace(/\r\n?/g, '\n')
  const out: string[] = []
  for (const paragraph of source.split('\n')) {
    if (!paragraph.trim()) continue
    out.push(...splitParagraph(paragraph.replace(/\s+/g, ' ').trim()))
  }
  return out
}

/** Lines of a code passage. Indentation is kept; outer blank lines are dropped. */
export function splitLines(code: string): string[] {
  const lines = (code ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n').map((l) => l.replace(/\s+$/, ''))
  let first = 0
  let last = lines.length - 1
  while (first <= last && !lines[first].trim()) first++
  while (last >= first && !lines[last].trim()) last--
  return lines.slice(first, last + 1)
}

export function splitPassage(text: string, kind: SpotMistakeKind): string[] {
  return (kind === 'code' ? splitLines(text) : splitSentences(text)).slice(0, MAX_SEGMENTS)
}

/** Blank code lines are layout only: never clickable, never a mistake. */
export function isBlankSegment(segment: Pick<MistakeSegment, 'text'>): boolean {
  return !segment.text.trim()
}

/**
 * Re-split an edited passage. Segments whose text did not change keep their id,
 * mistake flag, correction and explanation.
 */
export function resplit(previous: MistakeSegment[], text: string, kind: SpotMistakeKind): MistakeSegment[] {
  const used = new Set<string>()
  return splitPassage(text, kind).map((piece) => {
    const match = previous.find((s) => !used.has(s.id) && s.text === piece)
    if (match) {
      used.add(match.id)
      return { ...match, isMistake: isBlankSegment(match) ? false : match.isMistake }
    }
    return { id: newId(), text: piece, isMistake: false, correction: '', explanation: '' }
  })
}

/** Rebuild the passage from segments (for the author's textarea). */
export function joinSegments(segments: MistakeSegment[], kind: SpotMistakeKind): string {
  return segments.map((s) => s.text).join(kind === 'code' ? '\n' : ' ')
}

export function normalizeSegments(raw: unknown): MistakeSegment[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MistakeSegment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    let id = typeof s.id === 'string' && s.id ? s.id : newId()
    while (seen.has(id)) id = newId()
    seen.add(id)
    const text = typeof s.text === 'string' ? s.text : ''
    out.push({
      id,
      text,
      isMistake: s.isMistake === true && !!text.trim(),
      correction: typeof s.correction === 'string' ? s.correction : '',
      explanation: typeof s.explanation === 'string' ? s.explanation : '',
    })
    if (out.length >= MAX_SEGMENTS) break
  }
  return out
}

export function normalizeKind(raw: unknown): SpotMistakeKind {
  return raw === 'code' ? 'code' : 'text'
}

export function toggleMistake(segments: MistakeSegment[], id: string): MistakeSegment[] {
  return segments.map((s) => (s.id === id && !isBlankSegment(s) ? { ...s, isMistake: !s.isMistake } : s))
}

export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export interface MistakeScore {
  hits: string[]
  misses: string[]
  falseAlarms: string[]
  totalMistakes: number
  stars: 0 | 1 | 2 | 3
}

/**
 * Hits are mistakes the learner picked, misses are mistakes they left, false
 * alarms are correct segments they picked. Stars drop for both kinds of error.
 */
export function scoreSelection(segments: MistakeSegment[], selected: ReadonlySet<string>): MistakeScore {
  const hits: string[] = []
  const misses: string[] = []
  const falseAlarms: string[] = []
  for (const s of segments) {
    if (isBlankSegment(s)) continue
    const picked = selected.has(s.id)
    if (s.isMistake && picked) hits.push(s.id)
    else if (s.isMistake) misses.push(s.id)
    else if (picked) falseAlarms.push(s.id)
  }
  const totalMistakes = hits.length + misses.length
  return { hits, misses, falseAlarms, totalMistakes, stars: starsFor(hits.length, misses.length, falseAlarms.length) }
}

export function starsFor(hits: number, misses: number, falseAlarms: number): 0 | 1 | 2 | 3 {
  const errors = misses + falseAlarms
  if (errors === 0) return hits > 0 ? 3 : 0
  // Accuracy against everything that should or should not have been picked.
  const accuracy = hits / (hits + misses + falseAlarms)
  if (accuracy >= 0.6) return 2
  if (accuracy >= 0.3) return 1
  return 0
}

export type SpotMistakeIssue =
  | { kind: 'tooFew' }
  | { kind: 'noMistakes' }
  | { kind: 'allMistakes' }
  | { kind: 'missingCorrection'; segmentIndex: number }

export function validateSpotMistake(segments: MistakeSegment[]): SpotMistakeIssue[] {
  const issues: SpotMistakeIssue[] = []
  const real = segments.filter((s) => !isBlankSegment(s))
  if (real.length < 2) issues.push({ kind: 'tooFew' })
  const mistakes = real.filter((s) => s.isMistake)
  if (mistakes.length === 0) issues.push({ kind: 'noMistakes' })
  else if (real.length >= 2 && mistakes.length === real.length) issues.push({ kind: 'allMistakes' })
  segments.forEach((s, i) => {
    if (s.isMistake && !(s.correction ?? '').trim()) issues.push({ kind: 'missingCorrection', segmentIndex: i })
  })
  return issues
}

export function defaultSpotMistakeContent(t: Translate): Omit<SpotMistakeAttrs, 'blockId'> {
  // Same keys as the registry example (editor.experiences.spot_mistake.example.*).
  const k = 'editor.experiences.spot_mistake.example.'
  const seg = (n: number, isMistake: boolean): MistakeSegment => ({
    id: newId(),
    text: t(`${k}s${n}`),
    isMistake,
    correction: isMistake ? t(`${k}s${n}_fix`) : '',
    explanation: isMistake ? t(`${k}s${n}_why`) : '',
  })
  return {
    title: t(`${k}title`),
    instructions: t(`${k}instructions`),
    kind: 'text',
    segments: [seg(1, false), seg(2, true), seg(3, false), seg(4, true)],
  }
}
