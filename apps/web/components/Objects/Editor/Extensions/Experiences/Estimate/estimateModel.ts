/*
 Estimate: pure logic. Range validation, snapping guesses to the step, how far
 off a guess is, stars by tolerance, and the reveal animation as a function of
 elapsed time.
*/

export const DEFAULT_TOLERANCE = 10
export const MAX_STEPS_ON_SLIDER = 100_000
export const REVEAL_MS = 1200

export type EstimateData = {
  question: string
  min: number
  max: number
  step: number
  answer: number
  unit: string
  tolerancePct: number
  explanation: string
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function normalizeEstimate(attrs: any): EstimateData {
  return {
    question: str(attrs?.question),
    min: num(attrs?.min, 0),
    max: num(attrs?.max, 100),
    step: num(attrs?.step, 1),
    answer: num(attrs?.answer, 50),
    unit: str(attrs?.unit),
    tolerancePct: Math.max(0, Math.min(100, num(attrs?.tolerancePct, DEFAULT_TOLERANCE))),
    explanation: str(attrs?.explanation),
  }
}

export type EstimateIssue =
  | 'emptyQuestion'
  | 'minNotBelowMax'
  | 'stepNotPositive'
  | 'stepTooLarge'
  | 'tooManySteps'
  | 'answerOutside'
  | 'answerOffStep'

export function validateEstimate(d: EstimateData): EstimateIssue[] {
  const issues: EstimateIssue[] = []
  if (!d.question.trim()) issues.push('emptyQuestion')
  const rangeOk = d.min < d.max
  if (!rangeOk) issues.push('minNotBelowMax')
  if (!(d.step > 0)) issues.push('stepNotPositive')
  else if (rangeOk && d.step > d.max - d.min) issues.push('stepTooLarge')
  else if (rangeOk && (d.max - d.min) / d.step > MAX_STEPS_ON_SLIDER) issues.push('tooManySteps')
  if (rangeOk && (d.answer < d.min || d.answer > d.max)) issues.push('answerOutside')
  else if (rangeOk && d.step > 0 && !onStep(d.answer, d.min, d.step)) issues.push('answerOffStep')
  return issues
}

/** Decimal places of a number (so 0.1 + 0.2 snaps to 0.3, not 0.30000000000000004). */
export function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0
  const s = String(n)
  if (s.includes('e-')) return Number(s.split('e-')[1]) || 0
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

function round(n: number, decimals: number): number {
  const f = 10 ** Math.min(decimals, 12)
  return Math.round(n * f) / f
}

function onStep(v: number, min: number, step: number): boolean {
  const k = (v - min) / step
  return Math.abs(k - Math.round(k)) < 1e-6
}

/**
 * The slider range the learner sees. Broken settings still give a usable
 * slider: min/max are swapped if reversed, a zero range is widened, and a bad
 * step falls back to 1/100 of the range.
 */
export function sliderRange(d: EstimateData): { min: number; max: number; step: number } {
  let min = Math.min(d.min, d.max)
  let max = Math.max(d.min, d.max)
  if (min === max) {
    min -= 1
    max += 1
  }
  let step = d.step
  if (!(step > 0) || step > max - min || (max - min) / step > MAX_STEPS_ON_SLIDER) step = (max - min) / 100
  return { min, max, step }
}

export function snapGuess(value: number, range: { min: number; max: number; step: number }): number {
  if (!Number.isFinite(value)) return range.min
  const clamped = Math.max(range.min, Math.min(range.max, value))
  const k = Math.round((clamped - range.min) / range.step)
  const snapped = Math.min(range.max, range.min + k * range.step)
  return round(snapped, Math.max(decimalsOf(range.step), decimalsOf(range.min)))
}

/** Middle of the range, snapped: where the slider starts (never the answer). */
export function startGuess(range: { min: number; max: number; step: number }): number {
  return snapGuess((range.min + range.max) / 2, range)
}

/**
 * How far off, in % of the true value. For an answer of 0 the error is taken
 * against the range width instead, so it stays finite.
 */
export function offByPct(guess: number, answer: number, range: { min: number; max: number }): number {
  const diff = Math.abs(guess - answer)
  const base = answer !== 0 ? Math.abs(answer) : Math.abs(range.max - range.min) || 1
  return (diff / base) * 100
}

/** Within tolerance → 3, within 2× → 2, within 4× → 1, else 0. */
export function starsFor(pct: number, tolerance: number): 0 | 1 | 2 | 3 {
  const tol = Math.max(0, tolerance)
  if (pct <= tol + 1e-9) return 3
  if (tol === 0) return pct <= 5 ? 2 : pct <= 15 ? 1 : 0
  if (pct <= tol * 2) return 2
  if (pct <= tol * 4) return 1
  return 0
}

/** Rounded % for display: one decimal under 10%, whole numbers above. */
export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '∞'
  return pct < 10 ? String(Math.round(pct * 10) / 10) : String(Math.round(pct))
}

export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return 1 - (1 - x) ** 3
}

/** The marker's value during the reveal, from the guess to the true value. */
export function revealValue(from: number, to: number, elapsed: number, duration = REVEAL_MS): number {
  if (duration <= 0) return to
  return from + (to - from) * easeOutCubic(elapsed / duration)
}

/**
 * Axis for the reveal: the slider range, widened to include an answer that
 * lies outside it. Positions are 0..1 along it.
 */
export function revealAxis(range: { min: number; max: number }, answer: number) {
  const min = Math.min(range.min, answer)
  const max = Math.max(range.max, answer)
  const span = max - min || 1
  return { min, max, pos: (v: number) => Math.max(0, Math.min(1, (v - min) / span)) }
}

export function formatValue(v: number, step: number, locale?: string): string {
  const decimals = Math.min(6, Math.max(decimalsOf(step), 0))
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(v)
  } catch {
    return String(round(v, decimals))
  }
}

export function direction(guess: number, answer: number): 'low' | 'high' | 'exact' {
  if (guess === answer) return 'exact'
  return guess < answer ? 'low' : 'high'
}
