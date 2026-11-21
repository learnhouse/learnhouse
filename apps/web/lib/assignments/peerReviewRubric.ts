// Pure rules for the instructor peer-review setup: limits that mirror the API
// validation, rubric/prompt/sample checks, the starter rubric templates and
// the "reviewers disagree" rule. No React, no i18n runtime: callers pass `t`.
// Tested in tests/peer-review-admin-rubric.test.mjs.

import type {
  PeerReviewCalibrationSample,
  PeerReviewCriterion,
  PeerReviewPrompt,
  PeerReviewSettings,
  PeerScore,
} from '../../services/courses/peerReview'

/** Same bounds the API enforces on PUT /peer-review/settings. */
export const PEER_REVIEW_LIMITS = {
  criteriaMin: 1,
  criteriaMax: 10,
  levelsMin: 2,
  levelsMax: 6,
  promptsMin: 1,
  promptsMax: 5,
  minCharsMax: 2000,
  pointsMax: 1000,
  textMax: 200,
  reviewsMin: 1,
  reviewsMax: 10,
} as const

/** Peer scores that differ by at least this many percentage points get a "reviewers disagree" badge. */
export const OUTLIER_SPREAD = 25

export function isOutlierSpread(spread: number | null | undefined, threshold: number = OUTLIER_SPREAD): boolean {
  return typeof spread === 'number' && Number.isFinite(spread) && spread >= threshold
}

export type IssueCode =
  | 'criteria_min'
  | 'criteria_max'
  | 'criterion_title'
  | 'criterion_duplicate_id'
  | 'levels_min'
  | 'levels_max'
  | 'level_label'
  | 'level_points'
  | 'level_duplicate_id'
  | 'prompts_min'
  | 'prompts_max'
  | 'prompt_label'
  | 'prompt_min_chars'
  | 'prompt_duplicate_key'
  | 'reviews_range'
  | 'min_reviews_range'
  | 'sample_title'
  | 'sample_content'
  | 'sample_levels'

export interface Issue {
  code: IssueCode
  /** Where it is: `criterion`/`level` index, `prompt` index or `sample` index. */
  criterion?: number
  level?: number
  prompt?: number
  sample?: number
}

let idCounter = 0
/** Short id for new criteria, levels, prompts and samples. Unique per page load. */
export function newId(prefix: string): string {
  idCounter += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${rand}${idCounter.toString(36)}`
}

export function validateRubric(rubric: PeerReviewCriterion[] | null | undefined): Issue[] {
  const issues: Issue[] = []
  const list = Array.isArray(rubric) ? rubric : []
  if (list.length < PEER_REVIEW_LIMITS.criteriaMin) issues.push({ code: 'criteria_min' })
  if (list.length > PEER_REVIEW_LIMITS.criteriaMax) issues.push({ code: 'criteria_max' })
  const criterionIds = new Set<string>()
  list.forEach((criterion, ci) => {
    if (!criterion?.title?.trim()) issues.push({ code: 'criterion_title', criterion: ci })
    if (criterion?.id) {
      if (criterionIds.has(criterion.id)) issues.push({ code: 'criterion_duplicate_id', criterion: ci })
      criterionIds.add(criterion.id)
    }
    const levels = Array.isArray(criterion?.levels) ? criterion.levels : []
    if (levels.length < PEER_REVIEW_LIMITS.levelsMin) issues.push({ code: 'levels_min', criterion: ci })
    if (levels.length > PEER_REVIEW_LIMITS.levelsMax) issues.push({ code: 'levels_max', criterion: ci })
    const levelIds = new Set<string>()
    levels.forEach((level, li) => {
      if (!level?.label?.trim()) issues.push({ code: 'level_label', criterion: ci, level: li })
      const points = Number(level?.points)
      if (!Number.isFinite(points) || points < 0 || points > PEER_REVIEW_LIMITS.pointsMax) issues.push({ code: 'level_points', criterion: ci, level: li })
      if (level?.id) {
        if (levelIds.has(level.id)) issues.push({ code: 'level_duplicate_id', criterion: ci, level: li })
        levelIds.add(level.id)
      }
    })
  })
  return issues
}

export function validatePrompts(prompts: PeerReviewPrompt[] | null | undefined): Issue[] {
  // null means "translated defaults", which are always valid.
  if (prompts === null || prompts === undefined) return []
  const issues: Issue[] = []
  if (prompts.length < PEER_REVIEW_LIMITS.promptsMin) issues.push({ code: 'prompts_min' })
  if (prompts.length > PEER_REVIEW_LIMITS.promptsMax) issues.push({ code: 'prompts_max' })
  const keys = new Set<string>()
  prompts.forEach((prompt, pi) => {
    if (!prompt?.label?.trim()) issues.push({ code: 'prompt_label', prompt: pi })
    const min = Number(prompt?.min_chars)
    if (!Number.isInteger(min) || min < 0 || min > PEER_REVIEW_LIMITS.minCharsMax) issues.push({ code: 'prompt_min_chars', prompt: pi })
    if (prompt?.key) {
      if (keys.has(prompt.key)) issues.push({ code: 'prompt_duplicate_key', prompt: pi })
      keys.add(prompt.key)
    }
  })
  return issues
}

/** A sample is complete when it has a title, content and an instructor level for every criterion. */
export function validateSamples(samples: PeerReviewCalibrationSample[] | null | undefined, rubric: PeerReviewCriterion[]): Issue[] {
  const issues: Issue[] = []
  ;(samples || []).forEach((sample, si) => {
    if (!sample?.title?.trim()) issues.push({ code: 'sample_title', sample: si })
    if (!sample?.content?.trim()) issues.push({ code: 'sample_content', sample: si })
    const scores = sample?.scores || {}
    const complete = rubric.every((criterion) => criterion.levels.some((level) => level.id === scores[criterion.id]))
    if (!complete) issues.push({ code: 'sample_levels', sample: si })
  })
  return issues
}

export function validateSettings(settings: PeerReviewSettings): Issue[] {
  const issues: Issue[] = []
  const reviews = Number(settings.reviews_required)
  if (!Number.isInteger(reviews) || reviews < PEER_REVIEW_LIMITS.reviewsMin || reviews > PEER_REVIEW_LIMITS.reviewsMax) {
    issues.push({ code: 'reviews_range' })
  }
  const minReviews = Number(settings.min_reviews_for_score)
  if (!Number.isInteger(minReviews) || minReviews < 1 || minReviews > PEER_REVIEW_LIMITS.reviewsMax) {
    issues.push({ code: 'min_reviews_range' })
  }
  // An empty rubric is fine while peer review is off; turning it on needs one.
  const rubric = settings.rubric || []
  if (settings.enabled || rubric.length > 0) issues.push(...validateRubric(rubric))
  issues.push(...validatePrompts(settings.prompts))
  issues.push(...validateSamples(settings.calibration_samples, rubric))
  return issues
}

// ─── Templates ───────────────────────────────────────────────────────────────

export type TemplateKey = 'writing' | 'project' | 'presentation' | 'code'
export const TEMPLATE_KEYS: TemplateKey[] = ['writing', 'project', 'presentation', 'code']

type ScaleLevel = { key: string; points: number }
const SCALE_4: ScaleLevel[] = [
  { key: 'excellent', points: 4 },
  { key: 'good', points: 3 },
  { key: 'developing', points: 2 },
  { key: 'beginning', points: 1 },
]
const SCALE_3: ScaleLevel[] = [
  { key: 'strong', points: 3 },
  { key: 'adequate', points: 2 },
  { key: 'needs_work', points: 1 },
]

export const TEMPLATES: Record<TemplateKey, { criteria: string[]; scale: ScaleLevel[] }> = {
  writing: { criteria: ['thesis', 'evidence', 'organization', 'style'], scale: SCALE_4 },
  project: { criteria: ['goal', 'process', 'result', 'reflection'], scale: SCALE_3 },
  presentation: { criteria: ['content', 'structure', 'delivery', 'visuals'], scale: SCALE_3 },
  code: { criteria: ['correctness', 'readability', 'design', 'testing'], scale: SCALE_4 },
}

const T = 'peer_review.instructor.templates'

/** Every i18n key a template uses, so a test can check they exist in the locales. */
export function templateKeys(key: TemplateKey): string[] {
  const tpl = TEMPLATES[key]
  return [
    `${T}.${key}.name`,
    `${T}.${key}.blurb`,
    ...tpl.criteria.flatMap((c) => [`${T}.${key}.${c}.title`, `${T}.${key}.${c}.description`]),
    ...tpl.scale.flatMap((l) => [`${T}.scale.${l.key}`, `${T}.scale.${l.key}_description`]),
  ]
}

type Translate = (_key: string) => string

/** A ready-to-edit rubric from a template, with fresh ids and translated text. */
export function buildTemplate(key: TemplateKey, t: Translate, makeId: (_prefix: string) => string = newId): PeerReviewCriterion[] {
  const tpl = TEMPLATES[key]
  return tpl.criteria.map((c) => ({
    id: makeId('c'),
    title: t(`${T}.${key}.${c}.title`),
    description: t(`${T}.${key}.${c}.description`),
    levels: tpl.scale.map((l) => ({
      id: makeId('l'),
      points: l.points,
      label: t(`${T}.scale.${l.key}`),
      description: t(`${T}.scale.${l.key}_description`),
    })),
  }))
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_PROMPT_SPECS: { key: string; min_chars: number }[] = [
  { key: 'strength', min_chars: 40 },
  { key: 'suggestion', min_chars: 40 },
  { key: 'question', min_chars: 0 },
]

/** The API's default prompts, with labels in the viewer's language. */
export function defaultPrompts(t: Translate): PeerReviewPrompt[] {
  return DEFAULT_PROMPT_SPECS.map((p) => ({ ...p, label: t(`peer_review.common.prompt_${p.key}`) }))
}

export function samePrompts(a: PeerReviewPrompt[], b: PeerReviewPrompt[]): boolean {
  return a.length === b.length && a.every((p, i) => p.key === b[i].key && p.label.trim() === b[i].label.trim() && Number(p.min_chars) === Number(b[i].min_chars))
}

export const DEFAULT_SETTINGS: PeerReviewSettings = {
  enabled: false,
  reviews_required: 3,
  require_reviews_to_see_feedback: true,
  review_due_date: null,
  anonymity: 'double_blind',
  self_review_enabled: true,
  calibration_enabled: true,
  helpfulness_enabled: true,
  revision_plan_enabled: true,
  prompts: null,
  rubric: [],
  score_mode: 'feedback_only',
  min_reviews_for_score: 3,
  calibration_samples: [],
}

/** Fill gaps in an API response (or a 404) with the documented defaults. */
export function normalizeSettings(raw: Partial<PeerReviewSettings> | null | undefined): PeerReviewSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) } as PeerReviewSettings
  return {
    ...merged,
    rubric: Array.isArray(merged.rubric) ? merged.rubric : [],
    prompts: Array.isArray(merged.prompts) ? merged.prompts : null,
    calibration_samples: Array.isArray(merged.calibration_samples) ? merged.calibration_samples : [],
  }
}

// ─── Scores ──────────────────────────────────────────────────────────────────

/** Sample levels limited to the rubric's current criteria and levels (the API rejects stale ones). */
export function pruneSampleScores(samples: PeerReviewCalibrationSample[], rubric: PeerReviewCriterion[]): PeerReviewCalibrationSample[] {
  return samples.map((sample) => {
    const scores: Record<string, string> = {}
    for (const criterion of rubric) {
      const levelId = sample.scores?.[criterion.id]
      if (levelId && criterion.levels.some((l) => l.id === levelId)) scores[criterion.id] = levelId
    }
    return { ...sample, scores }
  })
}

/** Total points available on a rubric (best level of each criterion). */
export function maxRubricPoints(rubric: PeerReviewCriterion[]): number {
  return rubric.reduce((sum, c) => sum + Math.max(0, ...c.levels.map((l) => Number(l.points) || 0)), 0)
}

/** Per-criterion medians as a map, whichever shape the API sent. */
export function peerScoreMedians(score: PeerScore | null | undefined): Record<string, number> {
  if (!score?.criteria) return {}
  if (Array.isArray(score.criteria)) {
    return Object.fromEntries(score.criteria.map((c) => [c.criterion_id, Number(c.median)]))
  }
  return { ...score.criteria }
}

/** A review's percentage: the API's when it sent one, else sum(points) / sum(max) × 100. */
export function reviewPercentage(
  scores: Record<string, string> | null | undefined,
  rubric: PeerReviewCriterion[],
  fromApi?: number | null
): number | null {
  if (typeof fromApi === 'number' && Number.isFinite(fromApi)) return fromApi
  const max = maxRubricPoints(rubric)
  if (!scores || max <= 0) return null
  let total = 0
  let scored = 0
  for (const criterion of rubric) {
    const level = criterion.levels.find((l) => l.id === scores[criterion.id])
    if (level) {
      total += Number(level.points) || 0
      scored += 1
    }
  }
  if (scored === 0) return null
  return (total / max) * 100
}
