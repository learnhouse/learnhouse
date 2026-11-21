// Pure logic for the "Confidence check" experience (node `expConfidence`):
// normalising stored attrs, author validation, the learner round and the
// calibration summary. No React, so it is unit-tested directly
// (tests/experiences-confidence.test.mjs).
//
// Stored shape:
//   { blockId, title,
//     questions: [{ id, prompt, options: [string] (2–4), answer: index, explanation }] } // 1–10

import { asArray, starsFromRatio } from '../shared/utils'

export interface ConfidenceQuestion {
  id: string
  prompt: string
  options: string[]
  answer: number
  explanation: string
}

export interface ConfidenceData {
  blockId: string
  title: string
  questions: ConfidenceQuestion[]
}

export const CONFIDENCE_LIMITS = { minQuestions: 1, maxQuestions: 10, minOptions: 2, maxOptions: 4 } as const

/** How sure the learner was, from least to most. */
export const CONFIDENCE_LEVELS = ['guess', 'fair', 'certain'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

/** Guard whatever is stored (AI output, collab peers, pasted HTML) into the shape the UI expects. */
export function normalizeConfidence(attrs: any): ConfidenceData {
  const seen = new Set<string>()
  const questions: ConfidenceQuestion[] = asArray<any>(attrs?.questions)
    .filter((q) => q && typeof q === 'object')
    .map((q, i) => {
      let id = str(q.id, `q${i + 1}`) || `q${i + 1}`
      while (seen.has(id)) id = `${id}_${i}`
      seen.add(id)
      const options = asArray<unknown>(q.options).map((o) => str(o))
      const raw = Number(q.answer)
      const answer = Number.isInteger(raw) && raw >= 0 && raw < options.length ? raw : 0
      return { id, prompt: str(q.prompt), options, answer, explanation: str(q.explanation) }
    })
  return { blockId: str(attrs?.blockId), title: str(attrs?.title), questions }
}

/** The filled-in example a new block starts with; same content and keys as the registry's insert. */
export function exampleConfidence(t: T = identityT): Omit<ConfidenceData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.confidence.example.${key}`, fallback)
  return {
    title: k('title', 'How sure are you?'),
    questions: [
      {
        id: 'q1',
        prompt: k('q1', 'Which planet is closest to the Sun?'),
        options: [k('q1_a', 'Venus'), k('q1_b', 'Mercury'), k('q1_c', 'Mars')],
        answer: 1,
        explanation: k('q1_why', 'Mercury orbits closest to the Sun. Venus is second, but it is the hottest planet.'),
      },
      {
        id: 'q2',
        prompt: k('q2', 'What do plants mainly take in from the air to make food?'),
        options: [k('q2_a', 'Oxygen'), k('q2_b', 'Nitrogen'), k('q2_c', 'Carbon dioxide')],
        answer: 2,
        explanation: k('q2_why', 'Plants use carbon dioxide, water and light to make sugar, and give off oxygen.'),
      },
      {
        id: 'q3',
        prompt: k('q3', 'At sea level, water boils at…'),
        options: [k('q3_a', '90 °C'), k('q3_b', '100 °C'), k('q3_c', '120 °C')],
        answer: 1,
        explanation: k('q3_why', 'At sea level water boils at 100 °C. Higher up, where the air is thinner, it boils at a lower temperature.'),
      },
    ],
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type ConfidenceIssueCode =
  | 'too_few_questions'
  | 'too_many_questions'
  | 'empty_prompt'
  | 'too_few_options'
  | 'too_many_options'
  | 'empty_option'
  | 'no_explanation'

export interface ConfidenceIssue {
  code: ConfidenceIssueCode
  /** The question the hint belongs to (absent for block-level issues). */
  id?: string
  severity: 'error' | 'warning'
}

export function validateConfidence(data: ConfidenceData): ConfidenceIssue[] {
  const issues: ConfidenceIssue[] = []
  const L = CONFIDENCE_LIMITS
  if (data.questions.length < L.minQuestions) issues.push({ code: 'too_few_questions', severity: 'error' })
  if (data.questions.length > L.maxQuestions) issues.push({ code: 'too_many_questions', severity: 'warning' })
  data.questions.forEach((q) => {
    if (!q.prompt.trim()) issues.push({ code: 'empty_prompt', id: q.id, severity: 'error' })
    const filled = q.options.filter((o) => o.trim()).length
    if (filled < L.minOptions) issues.push({ code: 'too_few_options', id: q.id, severity: 'error' })
    else if (q.options.some((o) => !o.trim())) issues.push({ code: 'empty_option', id: q.id, severity: 'warning' })
    if (q.options.length > L.maxOptions) issues.push({ code: 'too_many_options', id: q.id, severity: 'warning' })
    if (!q.explanation.trim()) issues.push({ code: 'no_explanation', id: q.id, severity: 'warning' })
  })
  return issues
}

/**
 * Questions learners can play: a prompt and at least two filled options,
 * blank options dropped (the answer index follows its option), capped.
 */
export function playableConfidence(data: ConfidenceData): ConfidenceData {
  const questions = data.questions
    .map((q) => {
      const kept: string[] = []
      let answer = -1
      q.options.slice(0, CONFIDENCE_LIMITS.maxOptions).forEach((o, i) => {
        if (!o.trim()) return
        if (i === q.answer) answer = kept.length
        kept.push(o)
      })
      return { ...q, options: kept, answer }
    })
    .filter((q) => q.prompt.trim() && q.options.length >= CONFIDENCE_LIMITS.minOptions && q.answer >= 0)
    .slice(0, CONFIDENCE_LIMITS.maxQuestions)
  return { ...data, questions }
}

export function isPlayable(data: ConfidenceData): boolean {
  return playableConfidence(data).questions.length >= CONFIDENCE_LIMITS.minQuestions
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

export function addQuestion(data: ConfidenceData, id: string): ConfidenceData {
  if (data.questions.length >= CONFIDENCE_LIMITS.maxQuestions) return data
  return { ...data, questions: [...data.questions, { id, prompt: '', options: ['', ''], answer: 0, explanation: '' }] }
}

export function removeQuestion(data: ConfidenceData, id: string): ConfidenceData {
  if (data.questions.length <= CONFIDENCE_LIMITS.minQuestions) return data
  return { ...data, questions: data.questions.filter((q) => q.id !== id) }
}

export function updateQuestion(data: ConfidenceData, id: string, patch: Partial<Omit<ConfidenceQuestion, 'id'>>): ConfidenceData {
  return { ...data, questions: data.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }
}

export function addOption(data: ConfidenceData, id: string): ConfidenceData {
  return {
    ...data,
    questions: data.questions.map((q) => (q.id === id && q.options.length < CONFIDENCE_LIMITS.maxOptions ? { ...q, options: [...q.options, ''] } : q)),
  }
}

/** Removing an option keeps the right answer on the same option (or the first one if it was removed). */
export function removeOption(data: ConfidenceData, id: string, index: number): ConfidenceData {
  return {
    ...data,
    questions: data.questions.map((q) => {
      if (q.id !== id || q.options.length <= CONFIDENCE_LIMITS.minOptions) return q
      const options = q.options.filter((_, i) => i !== index)
      const answer = q.answer === index ? 0 : q.answer > index ? q.answer - 1 : q.answer
      return { ...q, options, answer }
    }),
  }
}

// ─── Learner ────────────────────────────────────────────────────────────────

export interface ConfidenceAnswer {
  questionId: string
  choice: number
  level: ConfidenceLevel
  correct: boolean
}

export function isLevel(v: unknown): v is ConfidenceLevel {
  return typeof v === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(v)
}

export function judge(question: ConfidenceQuestion, choice: number, level: ConfidenceLevel): ConfidenceAnswer {
  return { questionId: question.id, choice, level, correct: choice === question.answer }
}

export interface LevelStat {
  level: ConfidenceLevel
  total: number
  correct: number
  /** 0..1, or null when the level was never used. */
  accuracy: number | null
}

/** Accuracy per confidence level, always in CONFIDENCE_LEVELS order. */
export function calibration(answers: ConfidenceAnswer[]): LevelStat[] {
  return CONFIDENCE_LEVELS.map((level) => {
    const mine = answers.filter((a) => a.level === level)
    const correct = mine.filter((a) => a.correct).length
    return { level, total: mine.length, correct, accuracy: mine.length ? correct / mine.length : null }
  })
}

export type InsightCode = 'certain_wrong' | 'guess_right' | 'well_calibrated' | 'overconfident' | 'underconfident' | 'all_right'

export interface Insight {
  code: InsightCode
  /** A count the message mentions (times certain-and-wrong, lucky guesses). */
  n: number
  tone: 'good' | 'warn' | 'info'
}

/**
 * Plain-language takeaways, most useful first.
 *  - certain_wrong: any "Certain" answer that was wrong (worth reviewing).
 *  - guess_right: guesses that were right (lucky, or knew more than they thought).
 *  - overconfident / underconfident: overall confidence vs. accuracy.
 *  - well_calibrated: confidence matched accuracy; all_right: everything right.
 */
export function insights(answers: ConfidenceAnswer[]): Insight[] {
  if (!answers.length) return []
  const out: Insight[] = []
  const certainWrong = answers.filter((a) => a.level === 'certain' && !a.correct).length
  const guessRight = answers.filter((a) => a.level === 'guess' && a.correct).length
  const correct = answers.filter((a) => a.correct).length
  const accuracy = correct / answers.length
  // Expected accuracy for each level: guessing ≈ 1/3, fairly sure ≈ 2/3, certain ≈ 1.
  const expected = answers.reduce((s, a) => s + (CONFIDENCE_LEVELS.indexOf(a.level) + 1) / 3, 0) / answers.length
  if (certainWrong > 0) out.push({ code: 'certain_wrong', n: certainWrong, tone: 'warn' })
  if (guessRight > 0) out.push({ code: 'guess_right', n: guessRight, tone: 'info' })
  const gap = expected - accuracy
  if (gap > 0.25) out.push({ code: 'overconfident', n: 0, tone: 'warn' })
  else if (gap < -0.25) out.push({ code: 'underconfident', n: 0, tone: 'info' })
  else if (correct === answers.length && certainWrong === 0 && answers.every((a) => a.level === 'certain')) out.push({ code: 'all_right', n: 0, tone: 'good' })
  // Only call it well calibrated when nothing above needs a second look.
  else if (!out.some((n) => n.tone === 'warn')) out.push({ code: 'well_calibrated', n: 0, tone: 'good' })
  return out
}

export interface ConfidenceResult {
  correct: number
  total: number
  stars: 0 | 1 | 2 | 3
  perfect: boolean
}

export function scoreConfidence(answers: ConfidenceAnswer[], total: number): ConfidenceResult {
  const correct = answers.filter((a) => a.correct).length
  const stars = total > 0 ? starsFromRatio(correct / total) : 0
  return { correct, total, stars, perfect: total > 0 && correct === total }
}
