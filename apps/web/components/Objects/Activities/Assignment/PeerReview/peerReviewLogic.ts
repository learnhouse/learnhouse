// Pure helpers for the learner peer-review flow. No React, no aliases, so
// tests/peer-review-*.test.mjs can import this file directly.

export type Level = { id: string; points: number; label: string; description?: string | null }
export type Criterion = { id: string; title: string; description?: string | null; levels: Level[] }
export type Prompt = { key: string; label: string; min_chars: number }
export type Scores = Record<string, string>
export type Comments = Record<string, string>

// ─── prompts / min chars ─────────────────────────────────────────────────────

/** Characters that count toward a prompt minimum: surrounding whitespace is ignored. */
export function countChars(text: string | null | undefined): number {
  return (text ?? '').trim().length
}

export type PromptStatus = { count: number; min: number; remaining: number; ok: boolean }

export function promptStatus(text: string | null | undefined, minChars: number | null | undefined): PromptStatus {
  const min = Math.max(0, Number(minChars) || 0)
  const count = countChars(text)
  const remaining = Math.max(0, min - count)
  return { count, min, remaining, ok: remaining === 0 }
}

export type ReviewValidation = {
  ok: boolean
  /** Criteria with no level picked. */
  missingCriteria: string[]
  /** Prompt keys below their min_chars. */
  shortPrompts: string[]
}

/**
 * Mirrors the server check on submit: every criterion scored with one of its
 * own levels, every prompt at or above its minimum length.
 */
export function validateReview(
  rubric: Criterion[] | null | undefined,
  prompts: Prompt[] | null | undefined,
  scores: Scores | null | undefined,
  comments: Comments | null | undefined
): ReviewValidation {
  const missingCriteria = (rubric ?? [])
    .filter((c) => {
      const picked = scores?.[c.id]
      return !picked || !(c.levels ?? []).some((l) => l.id === picked)
    })
    .map((c) => c.id)
  const shortPrompts = (prompts ?? [])
    .filter((p) => !promptStatus(comments?.[p.key], p.min_chars).ok)
    .map((p) => p.key)
  return { ok: missingCriteria.length === 0 && shortPrompts.length === 0, missingCriteria, shortPrompts }
}

/** Instructor prompts when set, otherwise the (translated) defaults. */
export function resolvePrompts(prompts: Prompt[] | null | undefined, defaults: Prompt[]): Prompt[] {
  return Array.isArray(prompts) && prompts.length > 0 ? prompts : defaults
}

// ─── points ──────────────────────────────────────────────────────────────────

export function maxPoints(criterion: Criterion): number {
  return (criterion.levels ?? []).reduce((m, l) => Math.max(m, Number(l.points) || 0), 0)
}

export function levelPoints(criterion: Criterion, levelId: string | null | undefined): number | null {
  if (!levelId) return null
  const level = (criterion.levels ?? []).find((l) => l.id === levelId)
  return level ? Number(level.points) || 0 : null
}

/** Levels ordered from lowest to highest points (stable for equal points). */
export function sortedLevels(criterion: Criterion): Level[] {
  return [...(criterion.levels ?? [])].sort((a, b) => (Number(a.points) || 0) - (Number(b.points) || 0))
}

/** sum(points) / sum(max points) × 100, rounded. Null when nothing is scored. */
export function reviewPercentage(rubric: Criterion[] | null | undefined, scores: Scores | null | undefined): number | null {
  let got = 0
  let max = 0
  let any = false
  for (const c of rubric ?? []) {
    max += maxPoints(c)
    const p = levelPoints(c, scores?.[c.id])
    if (p !== null) {
      got += p
      any = true
    }
  }
  if (!any || max <= 0) return null
  return Math.round((got / max) * 100)
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// ─── peer median vs self (gap visual) ────────────────────────────────────────

type ReviewLike = { status?: string; scores?: Scores | null }
type PeerScoreLike = {
  criteria?: Array<{ criterion_id: string; median: number }> | Record<string, number> | null
} | null | undefined

/** Per-criterion medians from the API's peer_score, whichever shape it uses. */
export function peerScoreMedians(peerScore: PeerScoreLike): Record<string, number> {
  const out: Record<string, number> = {}
  const criteria = peerScore?.criteria
  if (Array.isArray(criteria)) {
    for (const row of criteria) {
      if (row && typeof row.criterion_id === 'string' && Number.isFinite(Number(row.median))) out[row.criterion_id] = Number(row.median)
    }
  } else if (criteria && typeof criteria === 'object') {
    for (const [k, v] of Object.entries(criteria)) if (Number.isFinite(Number(v))) out[k] = Number(v)
  }
  return out
}

export type GapDirection = 'aligned' | 'self_higher' | 'self_lower'

export type GapRow = {
  criterionId: string
  title: string
  max: number
  peer: number | null
  self: number | null
  /** self − peer, in points. */
  gap: number | null
  /** 0–100 positions on the bar. */
  peerPct: number | null
  selfPct: number | null
  direction: GapDirection | null
}

/** Within this share of the criterion's range counts as "you agree". */
export const GAP_ALIGNED_SHARE = 0.15

/**
 * One row per criterion: the peer median (from peer_score, or computed from
 * the received reviews when the score isn't published yet) next to the
 * learner's own self-review level.
 */
export function computeGaps(
  rubric: Criterion[] | null | undefined,
  peerScore: PeerScoreLike,
  received: ReviewLike[] | null | undefined,
  selfScores: Scores | null | undefined
): GapRow[] {
  const fromScore = peerScoreMedians(peerScore)
  const counted = (received ?? []).filter((r) => (r.status ?? 'submitted') === 'submitted')
  return (rubric ?? []).map((c) => {
    const max = maxPoints(c)
    let peer: number | null = c.id in fromScore ? fromScore[c.id] : null
    if (peer === null) {
      const pts = counted.map((r) => levelPoints(c, r.scores?.[c.id])).filter((p): p is number => p !== null)
      peer = median(pts)
    }
    const self = levelPoints(c, selfScores?.[c.id])
    const gap = peer !== null && self !== null ? Math.round((self - peer) * 100) / 100 : null
    const pct = (v: number | null) => (v === null || max <= 0 ? null : Math.max(0, Math.min(100, Math.round((v / max) * 100))))
    let direction: GapDirection | null = null
    if (gap !== null) {
      direction = Math.abs(gap) <= Math.max(max, 1) * GAP_ALIGNED_SHARE ? 'aligned' : gap > 0 ? 'self_higher' : 'self_lower'
    }
    return { criterionId: c.id, title: c.title, max, peer, self, gap, peerPct: pct(peer), selfPct: pct(self), direction }
  })
}

// ─── progress / unlock ───────────────────────────────────────────────────────

type ReviewsStep = { required: number; done: number; open_review_uuid?: string | null; available?: boolean }

export type ReviewProgress = {
  required: number
  done: number
  /** 1-based number of the review being written ("Review 2 of 3"). */
  current: number
  remaining: number
  complete: boolean
  /** Writing past the requirement ("extra review"). */
  extra: boolean
  /** 0–100 for the progress bar. */
  pct: number
}

export function reviewProgress(step: ReviewsStep | null | undefined): ReviewProgress {
  const required = Math.max(0, Number(step?.required) || 0)
  const done = Math.max(0, Number(step?.done) || 0)
  // `required` is the effective target (capped by how many classmates handed
  // in), so 0 means "nobody to review yet", not "finished".
  const complete = required > 0 && done >= required
  return {
    required,
    done,
    current: done + 1,
    remaining: Math.max(0, required - done),
    complete,
    extra: complete,
    pct: required > 0 ? Math.min(100, Math.round((done / required) * 100)) : 0,
  }
}

type FeedbackStep = { unlocked: boolean; reason?: 'reviews' | 'due_date' | null; count: number }

export type UnlockDisplay =
  | { state: 'unlocked'; reason: 'reviews' | 'due_date' | null; count: number }
  | { state: 'locked'; remainingReviews: number; dueDate: string | null }

export function unlockDisplay(
  feedback: FeedbackStep | null | undefined,
  reviews: ReviewsStep | null | undefined,
  reviewDueDate: string | null | undefined
): UnlockDisplay {
  if (feedback?.unlocked) return { state: 'unlocked', reason: feedback.reason ?? null, count: Math.max(0, Number(feedback.count) || 0) }
  return {
    state: 'locked',
    remainingReviews: reviewProgress(reviews).remaining,
    dueDate: reviewDueDate && String(reviewDueDate).trim() ? String(reviewDueDate) : null,
  }
}

export type StepKey = 'self' | 'calibration' | 'reviews' | 'feedback'
export type StepStatus = 'done' | 'todo' | 'locked'
export type StepItem = { key: StepKey; status: StepStatus }

type StepsLike = {
  self: { enabled: boolean; done: boolean }
  calibration: { enabled: boolean; total: number; done: number }
  reviews: ReviewsStep
  feedback: FeedbackStep
}

/**
 * The visible steps, in order. Practice is shown only when there are samples;
 * classmates' reviews are locked until practice is finished (the server
 * answers 409 otherwise).
 */
export function buildSteps(steps: StepsLike | null | undefined): StepItem[] {
  if (!steps) return []
  const out: StepItem[] = []
  if (steps.self?.enabled) out.push({ key: 'self', status: steps.self.done ? 'done' : 'todo' })
  const cal = steps.calibration
  const calPending = !!cal?.enabled && (cal.total ?? 0) > 0 && (cal.done ?? 0) < cal.total
  if (cal?.enabled && (cal.total ?? 0) > 0) out.push({ key: 'calibration', status: calPending ? 'todo' : 'done' })
  out.push({ key: 'reviews', status: calPending ? 'locked' : reviewProgress(steps.reviews).complete ? 'done' : 'todo' })
  out.push({ key: 'feedback', status: steps.feedback?.unlocked ? (steps.feedback.count > 0 ? 'done' : 'todo') : 'locked' })
  return out
}

/** Where to land: an open review first, then the first unfinished step, else feedback. */
export function defaultStep(items: StepItem[], openReview: boolean): StepKey {
  if (openReview && items.some((i) => i.key === 'reviews' && i.status !== 'locked')) return 'reviews'
  const firstTodo = items.find((i) => i.status === 'todo' && i.key !== 'feedback')
  if (firstTodo) return firstTodo.key
  return 'feedback'
}

// ─── dates ───────────────────────────────────────────────────────────────────

/** Same tolerant parse as the assignment due date: wall-clock parts, no TZ shift. */
export function parseLocalDate(raw: string | null | undefined): { at: Date; hasTime: boolean } | null {
  if (!raw || !String(raw).trim()) return null
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0))
  if (Number.isNaN(at.getTime())) return null
  return { at, hasTime: h !== undefined }
}

export function isPast(raw: string | null | undefined, now: number = Date.now()): boolean {
  const p = parseLocalDate(raw)
  if (!p) return false
  const cutoff = new Date(p.at)
  if (!p.hasTime) cutoff.setDate(cutoff.getDate() + 1)
  return cutoff.getTime() < now
}

// ─── read-only submission fallback ───────────────────────────────────────────

/** Turn arbitrary JSON into readable "key: value" lines for unknown task types. */
export function jsonToLines(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined || value === '') return []
  if (typeof value !== 'object') return [`${prefix}${String(value)}`]
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => jsonToLines(v, prefix ? `${prefix}` : `${i + 1}. `))
  }
  return Object.entries(value as Record<string, unknown>)
    .filter(([k]) => !/uuid$|^id$/i.test(k))
    .flatMap(([k, v]) => {
      const label = k.replace(/_/g, ' ')
      if (v !== null && typeof v === 'object') {
        const inner = jsonToLines(v, '')
        return inner.length ? [`${label}:`, ...inner.map((l) => `  ${l}`)] : []
      }
      return jsonToLines(v, `${label}: `)
    })
}
