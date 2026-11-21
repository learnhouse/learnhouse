/*
 Speed round: pure logic. The clock is a value, not a timer: every function
 takes "now" (ms) and returns a new value, so the view can drive it with
 requestAnimationFrame and tests can drive it with plain numbers.
*/

export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4
export const MAX_QUESTIONS = 30
export const MIN_SECONDS = 3
export const MAX_SECONDS = 120
export const DEFAULT_SECONDS = 10
export const MAX_LIVES = 10
export const BASE_POINTS = 100
export const SPEED_BONUS = 100
export const MAX_MULTIPLIER = 4
/** Correct answers in a row needed per multiplier step. */
export const COMBO_STEP = 3

export type SpeedQuestion = { id: string; prompt: string; options: string[]; answer: number }
export type SpeedRoundData = { title: string; questions: SpeedQuestion[]; secondsPerQuestion: number; lives: number }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function normalizeSpeedRound(attrs: any): SpeedRoundData {
  const raw = Array.isArray(attrs?.questions) ? attrs.questions : []
  const seen = new Set<string>()
  const questions: SpeedQuestion[] = []
  raw
    .filter((x: any) => x && typeof x === 'object')
    .slice(0, MAX_QUESTIONS)
    .forEach((q: any, i: number) => {
    let id = str(q.id) || `q${i + 1}`
    while (seen.has(id)) id = `${id}_`
    seen.add(id)
    const options = (Array.isArray(q.options) ? q.options : []).slice(0, MAX_OPTIONS).map(str)
    const answer = clampInt(q.answer, 0, Math.max(0, options.length - 1), 0)
    questions.push({ id, prompt: str(q.prompt), options, answer })
  })
  return {
    title: str(attrs?.title),
    questions,
    secondsPerQuestion: clampInt(attrs?.secondsPerQuestion, MIN_SECONDS, MAX_SECONDS, DEFAULT_SECONDS),
    lives: clampInt(attrs?.lives, 0, MAX_LIVES, 3),
  }
}

export type SpeedIssue =
  | { kind: 'noQuestions' }
  | { kind: 'emptyPrompt'; id: string }
  | { kind: 'fewOptions'; id: string }
  | { kind: 'emptyOption'; id: string }
  | { kind: 'badAnswer'; id: string }
  | { kind: 'duplicateOption'; id: string }

export function validateSpeedRound(data: SpeedRoundData): SpeedIssue[] {
  const issues: SpeedIssue[] = []
  if (!data.questions.length) issues.push({ kind: 'noQuestions' })
  for (const q of data.questions) {
    if (!q.prompt.trim()) issues.push({ kind: 'emptyPrompt', id: q.id })
    if (q.options.length < MIN_OPTIONS) issues.push({ kind: 'fewOptions', id: q.id })
    if (q.options.some((o) => !o.trim())) issues.push({ kind: 'emptyOption', id: q.id })
    const lower = q.options.map((o) => o.trim().toLowerCase()).filter(Boolean)
    if (new Set(lower).size !== lower.length) issues.push({ kind: 'duplicateOption', id: q.id })
    if (q.answer < 0 || q.answer >= q.options.length) issues.push({ kind: 'badAnswer', id: q.id })
  }
  return issues
}

/** Questions a learner can play: a prompt and at least two filled options. */
export function playableQuestions(data: SpeedRoundData): SpeedQuestion[] {
  return data.questions.filter(
    (q) => q.prompt.trim() && q.options.filter((o) => o.trim()).length >= MIN_OPTIONS && q.answer < q.options.length,
  )
}

// ---- clock ---------------------------------------------------------------

export type Clock = { startedAt: number; pausedAt: number | null; pausedTotal: number }

export function startClock(now: number): Clock {
  return { startedAt: now, pausedAt: null, pausedTotal: 0 }
}

export function pauseClock(c: Clock, now: number): Clock {
  return c.pausedAt === null ? { ...c, pausedAt: now } : c
}

export function resumeClock(c: Clock, now: number): Clock {
  if (c.pausedAt === null) return c
  return { ...c, pausedAt: null, pausedTotal: c.pausedTotal + Math.max(0, now - c.pausedAt) }
}

export function elapsedMs(c: Clock, now: number): number {
  const end = c.pausedAt ?? now
  return Math.max(0, end - c.startedAt - c.pausedTotal)
}

export function remainingMs(elapsed: number, seconds: number): number {
  return Math.max(0, seconds * 1000 - Math.max(0, elapsed))
}

/** 1 at the start of a question, 0 when time runs out (the ring's fill). */
export function remainingFraction(elapsed: number, seconds: number): number {
  const total = seconds * 1000
  if (total <= 0) return 0
  return remainingMs(elapsed, seconds) / total
}

export function isTimeUp(elapsed: number, seconds: number): boolean {
  return remainingMs(elapsed, seconds) <= 0
}

/** Whole seconds left, for the number in the ring (rounded up: 9.2s shows 10). */
export function secondsLeft(elapsed: number, seconds: number): number {
  return Math.ceil(remainingMs(elapsed, seconds) / 1000)
}

// ---- scoring -------------------------------------------------------------

export function multiplierFor(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(Math.max(0, combo) / COMBO_STEP))
}

/**
 * Points for a correct answer. Base plus a speed bonus that shrinks linearly
 * with the time used, times the combo multiplier. Relaxed mode has no timer,
 * so it earns the base only (still multiplied).
 */
export function pointsFor(elapsed: number, seconds: number, comboBefore: number, relaxed: boolean): number {
  const bonus = relaxed ? 0 : Math.round(SPEED_BONUS * remainingFraction(elapsed, seconds))
  return (BASE_POINTS + bonus) * multiplierFor(comboBefore)
}

export type Miss = { questionId: string; choice: number | null }

export type RoundState = {
  index: number
  score: number
  combo: number
  bestCombo: number
  livesLeft: number | null // null = unlimited
  correct: number
  misses: Miss[]
  last: { questionId: string; choice: number | null; correct: boolean; points: number } | null
  over: boolean
}

export function newRound(lives: number): RoundState {
  return {
    index: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    livesLeft: lives > 0 ? lives : null,
    correct: 0,
    misses: [],
    last: null,
    over: false,
  }
}

/** Record an answer (choice null = time ran out). Does not advance. */
export function answerQuestion(
  state: RoundState,
  questions: SpeedQuestion[],
  choice: number | null,
  elapsed: number,
  seconds: number,
  relaxed: boolean,
): RoundState {
  const q = questions[state.index]
  if (!q || state.over || state.last) return state
  const correct = choice !== null && choice === q.answer
  if (correct) {
    const points = pointsFor(elapsed, seconds, state.combo, relaxed)
    const combo = state.combo + 1
    return {
      ...state,
      score: state.score + points,
      combo,
      bestCombo: Math.max(state.bestCombo, combo),
      correct: state.correct + 1,
      last: { questionId: q.id, choice, correct, points },
    }
  }
  const livesLeft = state.livesLeft === null ? null : Math.max(0, state.livesLeft - 1)
  return {
    ...state,
    combo: 0,
    livesLeft,
    misses: [...state.misses, { questionId: q.id, choice }],
    last: { questionId: q.id, choice, correct, points: 0 },
  }
}

/** Move on after the feedback beat; ends the round when out of lives or questions. */
export function advance(state: RoundState, total: number): RoundState {
  if (!state.last || state.over) return state
  const index = state.index + 1
  const over = index >= total || state.livesLeft === 0
  return { ...state, index, last: null, over }
}

export function starsForRound(correct: number, total: number): 0 | 1 | 2 | 3 {
  if (total <= 0) return 0
  const r = correct / total
  if (r >= 0.9) return 3
  if (r >= 0.6) return 2
  if (r >= 0.3) return 1
  return 0
}

/** Questions never reached (out of lives) count as misses in the review. */
export function unansweredIds(state: RoundState, questions: SpeedQuestion[]): string[] {
  const done = state.index + (state.last ? 1 : 0)
  return questions.slice(done).map((q) => q.id)
}

export function bestScore(previous: unknown, score: number): number {
  const p = typeof previous === 'number' && Number.isFinite(previous) ? previous : 0
  return Math.max(p, score)
}
