/*
 Myth or fact: pure logic. A deck of true/false statements, answered one at a
 time by swipe, buttons or arrow keys. No React, no DOM: the view feeds it
 numbers and answers and renders what comes back.
*/

export const MIN_STATEMENTS = 2
export const MAX_STATEMENTS = 20
/** Fraction of the card width a drag must travel to count as an answer. */
export const SWIPE_THRESHOLD = 0.28
/** Never require more than this many pixels, so wide cards stay easy. */
export const SWIPE_MAX_PX = 120
export const MAX_TILT_DEG = 12

/** The node's stored default labels (spec); the view shows them translated. */
export const DEFAULT_LABELS = { true: 'Fact', false: 'Myth' } as const

export type Statement = { id: string; text: string; isTrue: boolean; explanation: string }
export type MythFactLabels = { true: string; false: string }
export type MythFactData = { title: string; statements: Statement[]; labels: MythFactLabels }

export type Answer = { id: string; guess: boolean; correct: boolean }
export type DeckState = { index: number; answers: Answer[]; streak: number; bestStreak: number }

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function normalizeMythFact(attrs: any): MythFactData {
  const raw = Array.isArray(attrs?.statements) ? attrs.statements : []
  const seen = new Set<string>()
  const statements: Statement[] = []
  raw
    .filter((x: any) => x && typeof x === 'object')
    .slice(0, MAX_STATEMENTS)
    .forEach((s: any, i: number) => {
    let id = str(s.id) || `s${i + 1}`
    while (seen.has(id)) id = `${id}_`
    seen.add(id)
    statements.push({ id, text: str(s.text), isTrue: s.isTrue === true || s.isTrue === 'true', explanation: str(s.explanation) })
  })
  const labels = attrs?.labels && typeof attrs.labels === 'object' ? attrs.labels : {}
  return {
    title: str(attrs?.title),
    statements,
    labels: { true: str(labels.true), false: str(labels.false) },
  }
}

export type MythFactIssue =
  | { kind: 'tooFew' }
  | { kind: 'tooMany' }
  | { kind: 'emptyText'; id: string }
  | { kind: 'oneSided' }

export function validateMythFact(data: MythFactData): MythFactIssue[] {
  const issues: MythFactIssue[] = []
  if (data.statements.length < MIN_STATEMENTS) issues.push({ kind: 'tooFew' })
  if (data.statements.length > MAX_STATEMENTS) issues.push({ kind: 'tooMany' })
  data.statements.forEach((s) => {
    if (!s.text.trim()) issues.push({ kind: 'emptyText', id: s.id })
  })
  if (data.statements.length >= MIN_STATEMENTS) {
    const trues = data.statements.filter((s) => s.isTrue).length
    if (trues === 0 || trues === data.statements.length) issues.push({ kind: 'oneSided' })
  }
  return issues
}

/** Statements a learner can actually play (blank ones are skipped). */
export function playable(data: MythFactData): Statement[] {
  return data.statements.filter((s) => s.text.trim())
}

export function newDeck(): DeckState {
  return { index: 0, answers: [], streak: 0, bestStreak: 0 }
}

export function answerCard(state: DeckState, deck: Statement[], guess: boolean): DeckState {
  const card = deck[state.index]
  if (!card) return state
  const correct = card.isTrue === guess
  const streak = correct ? state.streak + 1 : 0
  return {
    index: state.index,
    answers: [...state.answers, { id: card.id, guess, correct }],
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
  }
}

/** Has the current card been answered (so the reveal is showing)? */
export function isRevealed(state: DeckState): boolean {
  return state.answers.length > state.index
}

export function nextCard(state: DeckState): DeckState {
  if (!isRevealed(state)) return state
  return { ...state, index: state.index + 1 }
}

export function isFinished(state: DeckState, deck: Statement[]): boolean {
  return deck.length > 0 && state.index >= deck.length
}

export function correctCount(state: DeckState): number {
  return state.answers.filter((a) => a.correct).length
}

export function misses(state: DeckState, deck: Statement[]): Statement[] {
  const wrong = new Set(state.answers.filter((a) => !a.correct).map((a) => a.id))
  return deck.filter((s) => wrong.has(s.id))
}

/** Stars by share correct: all → 3, ≥ 70% → 2, ≥ 40% → 1. */
export function starsFor(correct: number, total: number): 0 | 1 | 2 | 3 {
  if (total <= 0) return 0
  const r = correct / total
  if (r >= 1) return 3
  if (r >= 0.7) return 2
  if (r >= 0.4) return 1
  return 0
}

/** Pixels a drag must travel on a card of this width. */
export function swipeDistance(width: number): number {
  const w = Number.isFinite(width) && width > 0 ? width : 300
  return Math.min(SWIPE_MAX_PX, w * SWIPE_THRESHOLD)
}

/**
 * What a horizontal drag means. "Fact" sits at the inline end (right in LTR,
 * left in RTL), matching the button order and the arrow keys.
 */
export function swipeDecision(dx: number, width: number, rtl = false): boolean | null {
  if (!Number.isFinite(dx) || Math.abs(dx) < swipeDistance(width)) return null
  const towardEnd = rtl ? dx < 0 : dx > 0
  return towardEnd
}

/** Card rotation while dragging, clamped. */
export function tiltFor(dx: number, width: number): number {
  if (!Number.isFinite(dx)) return 0
  const d = swipeDistance(width)
  const deg = (dx / (d * 2)) * MAX_TILT_DEG
  return Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, deg))
}

/** 0..1, how close a drag is to committing (drives the side label opacity). */
export function swipeProgress(dx: number, width: number): number {
  if (!Number.isFinite(dx)) return 0
  return Math.min(1, Math.abs(dx) / swipeDistance(width))
}

/** Arrow key → answer. ArrowRight is the inline end in LTR, ArrowLeft in RTL. */
export function keyDecision(key: string, rtl = false): boolean | null {
  if (key === 'ArrowRight') return !rtl
  if (key === 'ArrowLeft') return rtl
  return null
}
