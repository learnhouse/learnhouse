// Pure logic for the Fill the gaps experience.
//
// Syntax: `[[answer|alt1|alt2]]` marks a gap. Inside or outside a gap a
// backslash escapes the next character, so `\[`, `\]`, `\|` and `\\` are
// literal. Single brackets inside a gap nest (`[[arr[0]]]` is the answer
// `arr[0]`). An unclosed `[[` or a gap with no non-empty answer stays as
// plain text and is reported as an issue.

import { normalizeAnswer, shuffle, starsFromRatio } from '../shared/utils'

export type GapsMode = 'type' | 'bank'

export interface GapsAttrs {
  blockId: string
  title: string
  text: string
  mode: GapsMode
  caseSensitive: boolean
}

export interface TextToken {
  type: 'text'
  value: string
}

export interface GapToken {
  type: 'gap'
  /** 0-based index among valid gaps. */
  index: number
  answers: string[]
  /** Source offsets of the whole `[[...]]`. */
  start: number
  end: number
}

export type GapsToken = TextToken | GapToken

export type GapsIssue =
  | { kind: 'empty'; start: number }
  | { kind: 'unclosed'; start: number }
  | { kind: 'noGaps' }

export interface ParsedGaps {
  tokens: GapsToken[]
  gaps: GapToken[]
  issues: GapsIssue[]
}

type Translate = (_key: string, _options?: Record<string, unknown>) => string

/** Read a gap body from `from` (just after `[[`). Returns the end index after `]]`, or -1. */
function scanGap(text: string, from: number): { body: string; end: number } | null {
  let depth = 0
  let body = ''
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) {
      // Keep the escape so `|` splitting can still tell `\|` apart.
      body += ch + text[i + 1]
      i += 2
      continue
    }
    if (ch === '[') {
      depth++
      body += ch
      i++
      continue
    }
    if (ch === ']') {
      if (depth > 0) {
        depth--
        body += ch
        i++
        continue
      }
      if (text[i + 1] === ']') return { body, end: i + 2 }
      body += ch
      i++
      continue
    }
    if (ch === '\n' && text[i + 1] === '\n') return null // a gap never spans paragraphs
    body += ch
    i++
  }
  return null
}

function unescape(value: string): string {
  return value.replace(/\\([\s\S])/g, '$1')
}

/** Split a gap body on unescaped pipes, unescape, trim, drop empties and duplicates. */
export function splitAnswers(body: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && i + 1 < body.length) {
      current += ch + body[i + 1]
      i++
      continue
    }
    if (ch === '|') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  const out: string[] = []
  for (const p of parts) {
    const v = unescape(p).replace(/\s+/g, ' ').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

export function parseGaps(text: string): ParsedGaps {
  const source = typeof text === 'string' ? text : ''
  const tokens: GapsToken[] = []
  const gaps: GapToken[] = []
  const issues: GapsIssue[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) tokens.push({ type: 'text', value: buffer })
    buffer = ''
  }
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\' && i + 1 < source.length) {
      buffer += source[i + 1]
      i += 2
      continue
    }
    if (ch === '[' && source[i + 1] === '[') {
      const scanned = scanGap(source, i + 2)
      if (!scanned) {
        issues.push({ kind: 'unclosed', start: i })
        buffer += '[['
        i += 2
        continue
      }
      const answers = splitAnswers(scanned.body)
      if (answers.length === 0) {
        issues.push({ kind: 'empty', start: i })
        buffer += source.slice(i, scanned.end)
        i = scanned.end
        continue
      }
      flush()
      const gap: GapToken = { type: 'gap', index: gaps.length, answers, start: i, end: scanned.end }
      gaps.push(gap)
      tokens.push(gap)
      i = scanned.end
      continue
    }
    buffer += ch
    i++
  }
  flush()
  if (gaps.length === 0) issues.push({ kind: 'noGaps' })
  return { tokens, gaps, issues }
}

/** Escape author text so it can sit inside a gap literally. */
export function escapeGapText(value: string): string {
  return value.replace(/[\\[\]|]/g, (m) => '\\' + m)
}

/** True when `pos` falls inside a valid gap of `text`. */
export function isInsideGap(text: string, pos: number): boolean {
  return parseGaps(text).gaps.some((g) => pos > g.start && pos < g.end)
}

/**
 * Wrap the textarea selection in a gap. Whitespace around the selection stays
 * outside the gap. An empty selection inserts `[[placeholder]]`. Returns null
 * when the selection overlaps an existing gap.
 */
export function makeGap(
  text: string,
  selStart: number,
  selEnd: number,
  placeholder = 'answer',
): { text: string; selStart: number; selEnd: number } | null {
  let start = Math.max(0, Math.min(selStart, selEnd, text.length))
  let end = Math.min(text.length, Math.max(selStart, selEnd))
  const { gaps } = parseGaps(text)
  if (gaps.some((g) => start < g.end && end > g.start)) return null
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  const inner = start === end ? placeholder : escapeGapText(text.slice(start, end))
  const wrapped = `[[${inner}]]`
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    selStart: start + 2,
    selEnd: start + 2 + inner.length,
  }
}

export function isCorrect(gap: Pick<GapToken, 'answers'>, value: string, caseSensitive: boolean): boolean {
  const v = normalizeAnswer(value, caseSensitive)
  if (!v) return false
  return gap.answers.some((a) => normalizeAnswer(a, caseSensitive) === v)
}

export interface GapsGrade {
  results: boolean[]
  correct: number
  total: number
}

export function gradeGaps(gaps: GapToken[], values: string[], caseSensitive: boolean): GapsGrade {
  const results = gaps.map((g, i) => isCorrect(g, values[i] ?? '', caseSensitive))
  return { results, correct: results.filter(Boolean).length, total: gaps.length }
}

/** On retry keep the right answers and clear the wrong ones. */
export function keepCorrect(values: string[], results: boolean[]): string[] {
  return values.map((v, i) => (results[i] ? v : ''))
}

/** Stars by share of correct gaps (shared thresholds); any right answer earns one. */
export function starsForScore(correct: number, total: number): 0 | 1 | 2 | 3 {
  if (total <= 0 || correct <= 0) return 0
  return Math.max(1, starsFromRatio(correct / total)) as 1 | 2 | 3
}

export interface BankChip {
  id: string
  text: string
}

/**
 * The word bank: one chip per gap (its first answer), shuffled, no
 * distractors. Chip ids are stable per gap so placements survive re-renders.
 */
export function buildBank(gaps: GapToken[], random: () => number = Math.random): BankChip[] {
  const chips = gaps.map((g) => ({ id: `chip-${g.index}`, text: g.answers[0] }))
  // Shuffling identical texts makes no visible difference; that's fine.
  return shuffle(chips, random)
}

export function defaultGapsContent(t: Translate): Omit<GapsAttrs, 'blockId'> {
  return {
    title: t('editor.experiences.gaps.example.title'),
    text: t('editor.experiences.gaps.example.text'),
    mode: 'type',
    caseSensitive: false,
  }
}

export function normalizeGapsMode(raw: unknown): GapsMode {
  return raw === 'bank' ? 'bank' : 'type'
}
