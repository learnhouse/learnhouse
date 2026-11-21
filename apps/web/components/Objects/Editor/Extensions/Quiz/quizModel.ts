/*
 Pure data layer of the Quiz block (blockQuiz): the stored shape, the editing
 operations the node view commits, and the learner-side grading.

 Backward compatibility: a quiz saved before the redesign has no `settings`
 attr, no `explanation` on questions and no `feedback` on answers. Every one
 of those is optional and its absence means exactly the old behaviour
 (answers in authored order, unlimited retries, correct answers revealed after
 submitting, nothing extra shown). Nothing here rewrites what is stored unless
 the author edits that part of the quiz.

 Imported by the node view and by tests/editor-blocks-quiz.test.mjs.
*/
import {
  QUIZ_GRADING_ALL_OR_NOTHING,
  QUIZ_RESPONSE_MULTIPLE,
  QUIZ_RESPONSE_SINGLE,
  resolveQuizResponseType,
  scoreQuizQuestion,
  type QuizResponseType,
} from '../../../../../lib/quiz/modes'

export interface QuizAnswer {
  answer_id: string
  answer: string
  correct: boolean
  /** Shown under this option once the learner has submitted. */
  feedback?: string
}

/**
 * The question kinds. A question without `type` (or with one this build does
 * not know) is multiple choice, exactly as before. `custom_answer` is legacy
 * and rendered as multiple choice.
 *
 * - true_false: stored as a two-option multiple choice (answers[0] = True,
 *   answers[1] = False, one marked correct), so an older client that ignores
 *   the type still shows a working pick-one question.
 * - short_answer: `accepted_answers`, matched case- and whitespace-insensitively
 *   (and accent-insensitively with `accent_insensitive`). No options are
 *   stored, so an older client never shows the key as clickable options.
 * - numeric: `correct_value` plus `tolerance` (absolute, default 0).
 */
export type QuizQuestionType = 'multiple_choice' | 'true_false' | 'short_answer' | 'numeric' | 'custom_answer'

export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'short_answer', 'numeric'] as const
export type EditableQuestionType = (typeof QUESTION_TYPES)[number]

export interface QuizQuestion {
  question_id: string
  question: string
  type: QuizQuestionType
  // Absent on blocks authored before the mode existed: read it through
  // responseTypeOf, never directly.
  response_type?: QuizResponseType
  /** Shown after submitting (the AI generator already writes it). */
  explanation?: string
  answers: QuizAnswer[]
  /** short_answer: what counts as right. */
  accepted_answers?: string[]
  /** short_answer: "é" matches "e". */
  accent_insensitive?: boolean
  /** numeric: the expected value. */
  correct_value?: number
  /** numeric: how far off still counts (absolute). */
  tolerance?: number
}

export interface QuizSettings {
  shuffleAnswers: boolean
  shuffleQuestions: boolean
  /** 0 = unlimited (the old behaviour: the reset button always worked). */
  maxAttempts: number
  /** Reveal the answer key after submitting (the old behaviour). */
  showCorrectAnswers: boolean
  /** Score (%) needed to pass. 0 = no pass mark: the old all-correct message. */
  passMark: number
  /** Show the authors' explanations after submitting (the old behaviour). */
  showExplanations: boolean
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  shuffleAnswers: false,
  shuffleQuestions: false,
  maxAttempts: 0,
  showCorrectAnswers: true,
  passMark: 0,
  showExplanations: true,
}

export const PASS_MARK_OPTIONS = [0, 50, 60, 70, 80, 90, 100] as const
export const MAX_ACCEPTED_ANSWERS = 10

export const MAX_ANSWERS = 8
export const ATTEMPT_OPTIONS = [0, 1, 2, 3, 5] as const

type IdFactory = () => string

const fallbackId: IdFactory = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

// ─── reading stored attrs ────────────────────────────────────────────────

/** Stored questions, tolerating whatever a paste, an import or the AI wrote. */
const KNOWN_TYPES: readonly string[] = [...QUESTION_TYPES, 'custom_answer']

/** A finite number from a stored value (numbers, or numeric strings an import wrote). */
function finiteOrUndefined(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** The type-specific keys, only when stored (absent keys stay absent). */
function typedFields(q: Record<string, any>): Partial<QuizQuestion> {
  const out: Partial<QuizQuestion> = {}
  if ('accepted_answers' in q) {
    out.accepted_answers = Array.isArray(q.accepted_answers) ? q.accepted_answers.filter((a: unknown) => typeof a === 'string') : []
  }
  if ('accent_insensitive' in q) out.accent_insensitive = q.accent_insensitive === true
  if ('correct_value' in q) out.correct_value = finiteOrUndefined(q.correct_value)
  if ('tolerance' in q) out.tolerance = finiteOrUndefined(q.tolerance)
  return out
}

/** Numeric keys that can't be read are dropped rather than kept as junk. */
function dropUnreadableNumbers<T extends Record<string, any>>(q: T): T {
  for (const k of ['correct_value', 'tolerance']) if (k in q && q[k] === undefined) delete q[k]
  return q
}

export function normalizeQuestions(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((q): q is Record<string, any> => !!q && typeof q === 'object')
    .map((q) => dropUnreadableNumbers({
      ...q,
      question_id: typeof q.question_id === 'string' && q.question_id ? q.question_id : String(q.question_id ?? ''),
      question: typeof q.question === 'string' ? q.question : '',
      type: KNOWN_TYPES.includes(q.type) ? q.type : 'multiple_choice',
      ...typedFields(q),
      answers: Array.isArray(q.answers)
        ? q.answers
            .filter((a: unknown): a is Record<string, any> => !!a && typeof a === 'object')
            .map((a: Record<string, any>) => ({
              ...a,
              answer_id: typeof a.answer_id === 'string' ? a.answer_id : String(a.answer_id ?? ''),
              answer: typeof a.answer === 'string' ? a.answer : '',
              correct: a.correct === true,
            }))
        : [],
    })) as QuizQuestion[]
}

export function normalizeSettings(raw: unknown): QuizSettings {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const attempts = Number(s.maxAttempts)
  return {
    shuffleAnswers: s.shuffleAnswers === true,
    shuffleQuestions: s.shuffleQuestions === true,
    maxAttempts: Number.isFinite(attempts) && attempts > 0 ? Math.min(99, Math.floor(attempts)) : 0,
    showCorrectAnswers: s.showCorrectAnswers !== false,
    passMark: normalizePassMark(s.passMark),
    showExplanations: s.showExplanations !== false,
  }
}

function normalizePassMark(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.round(n)) : 0
}

/** Settings as stored: only the keys that differ from the default (null when none). */
export function compactSettings(settings: QuizSettings): Partial<QuizSettings> | null {
  const out: Partial<QuizSettings> = {}
  for (const key of Object.keys(DEFAULT_QUIZ_SETTINGS) as (keyof QuizSettings)[]) {
    if (settings[key] !== DEFAULT_QUIZ_SETTINGS[key]) (out as any)[key] = settings[key]
  }
  return Object.keys(out).length ? out : null
}

/** How a question is answered: options (multiple choice, true/false), a typed text or a number. */
export function questionKind(question: Pick<QuizQuestion, 'type'>): EditableQuestionType {
  const t = question?.type
  return t === 'true_false' || t === 'short_answer' || t === 'numeric' ? t : 'multiple_choice'
}

export function responseTypeOf(question: QuizQuestion): QuizResponseType {
  if (questionKind(question) === 'true_false') return QUIZ_RESPONSE_SINGLE
  return resolveQuizResponseType(question.response_type, question.answers.filter((a) => a.correct).length)
}

/** The accepted answers that can actually match something. */
export function acceptedAnswers(question: QuizQuestion): string[] {
  return (question.accepted_answers ?? []).filter((a) => typeof a === 'string' && a.trim())
}

export function hasCorrectAnswer(question: QuizQuestion): boolean {
  switch (questionKind(question)) {
    case 'short_answer':
      return acceptedAnswers(question).length > 0
    case 'numeric':
      return typeof question.correct_value === 'number' && Number.isFinite(question.correct_value)
    default:
      return question.answers.some((a) => a.correct)
  }
}

// ─── answer matching (typed answers) ────────────────────────────────────────

/** Case-, whitespace- and (optionally) accent-insensitive form of a typed answer. */
export function normalizeTypedAnswer(text: unknown, accentInsensitive = false): string {
  let v = String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (accentInsensitive) v = v.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC')
  return v
}

export function matchShortAnswer(input: unknown, accepted: string[], opts: { accentInsensitive?: boolean } = {}): boolean {
  const given = normalizeTypedAnswer(input, opts.accentInsensitive)
  if (!given) return false
  return accepted.some((a) => {
    const want = normalizeTypedAnswer(a, opts.accentInsensitive)
    return !!want && want === given
  })
}

const THOUSANDS_INT = /^[+-]?\d{1,3}(,\d{3})+$/
const THOUSANDS_DEC = /^[+-]?\d{1,3}(,\d{3})+\.\d+$/

/**
 * A typed number, read like the graded number task does on the server
 * (assignments.py > _check_number_answer): "1,000" is a thousand, "3,14" is
 * 3.14. Null for blank or non-numeric input.
 */
export function parseNumericAnswer(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  let v = String(raw ?? '').trim().replace(/\s+/g, '')
  if (!v) return null
  if (THOUSANDS_INT.test(v) || THOUSANDS_DEC.test(v)) v = v.replace(/,/g, '')
  else if ((v.match(/,/g) || []).length === 1 && !v.includes('.')) v = v.replace(',', '.')
  else if (v.includes(',') && v.includes('.')) v = v.replace(/,/g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function matchNumeric(input: unknown, correct: number, tolerance: number = 0): boolean {
  const n = parseNumericAnswer(input)
  if (n === null || !Number.isFinite(correct)) return false
  const tol = Math.abs(Number.isFinite(tolerance) ? tolerance : 0)
  // A hair of slack so 0.1 + 0.2 style floats don't fail an exact answer.
  return Math.abs(n - correct) <= tol + 1e-9 * Math.max(1, Math.abs(correct))
}

// ─── editing operations (each returns a new array; the caller commits it) ──

export function newAnswer(id: IdFactory = fallbackId): QuizAnswer {
  return { answer_id: id(), answer: '', correct: false }
}

export function newQuestion(id: IdFactory = fallbackId): QuizQuestion {
  return {
    question_id: id(),
    question: '',
    type: 'multiple_choice',
    response_type: QUIZ_RESPONSE_SINGLE,
    answers: [newAnswer(id), newAnswer(id)],
  }
}

export function updateQuestion(
  questions: QuizQuestion[],
  questionId: string,
  fn: (_q: QuizQuestion) => QuizQuestion
): QuizQuestion[] {
  return questions.map((q) => (q.question_id === questionId ? fn(q) : q))
}

export function updateAnswer(
  questions: QuizQuestion[],
  questionId: string,
  answerId: string,
  patch: Partial<QuizAnswer>
): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => ({
    ...q,
    answers: q.answers.map((a) => (a.answer_id === answerId ? { ...a, ...patch } : a)),
  }))
}

/** Insert an empty option after `afterId` (or at the end). */
export function insertAnswer(
  questions: QuizQuestion[],
  questionId: string,
  afterId: string | null,
  answer: QuizAnswer
): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => {
    if (q.answers.length >= MAX_ANSWERS) return q
    const at = afterId ? q.answers.findIndex((a) => a.answer_id === afterId) + 1 : q.answers.length
    const answers = [...q.answers]
    answers.splice(at <= 0 ? answers.length : at, 0, answer)
    return { ...q, answers }
  })
}

export function removeAnswer(questions: QuizQuestion[], questionId: string, answerId: string): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => ({
    ...q,
    answers: q.answers.filter((a) => a.answer_id !== answerId),
  }))
}

/** Move an item within a list (used for options and questions). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
}

export function moveAnswer(questions: QuizQuestion[], questionId: string, from: number, to: number): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => ({ ...q, answers: moveItem(q.answers, from, to) }))
}

/**
 * One click on an option's marker. On a pick-one question the key is a radio
 * group (marking one un-marks the others); on select-all-that-apply each
 * option toggles on its own.
 */
export function toggleCorrect(questions: QuizQuestion[], questionId: string, answerId: string): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => {
    const single = responseTypeOf(q) === QUIZ_RESPONSE_SINGLE
    const wasCorrect = !!q.answers.find((a) => a.answer_id === answerId)?.correct
    return {
      ...q,
      answers: q.answers.map((a) => {
        if (a.answer_id === answerId) return { ...a, correct: !wasCorrect }
        if (single && !wasCorrect) return { ...a, correct: false }
        return a
      }),
    }
  })
}

/**
 * Switch a question between pick-one and select-all. Going to pick-one keeps
 * only the first correct option, so the key stays one a learner can satisfy.
 */
export function setResponseType(
  questions: QuizQuestion[],
  questionId: string,
  responseType: QuizResponseType
): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => {
    if (responseType !== QUIZ_RESPONSE_SINGLE) return { ...q, response_type: QUIZ_RESPONSE_MULTIPLE }
    let kept = false
    return {
      ...q,
      response_type: QUIZ_RESPONSE_SINGLE,
      answers: q.answers.map((a) => {
        if (!a.correct) return a
        if (!kept) {
          kept = true
          return a
        }
        return { ...a, correct: false }
      }),
    }
  })
}

/** A copy of a question with fresh ids (ids must stay unique in the quiz). */
export function duplicateQuestion(questions: QuizQuestion[], questionId: string, id: IdFactory = fallbackId): QuizQuestion[] {
  const at = questions.findIndex((q) => q.question_id === questionId)
  if (at < 0) return questions
  const src = questions[at]
  const copy: QuizQuestion = {
    ...src,
    question_id: id(),
    answers: src.answers.map((a) => ({ ...a, answer_id: id() })),
  }
  const next = [...questions]
  next.splice(at + 1, 0, copy)
  return next
}

export interface TrueFalseLabels {
  true: string
  false: string
}

const TYPED_KEYS = ['accepted_answers', 'accent_insensitive', 'correct_value', 'tolerance'] as const

function withoutTypedKeys(q: QuizQuestion): QuizQuestion {
  const next = { ...q }
  for (const k of TYPED_KEYS) delete next[k]
  return next
}

/**
 * Switch a question to another kind. The question text and explanation stay;
 * what only made sense for the old kind is dropped (undo brings it back).
 */
export function setQuestionType(
  questions: QuizQuestion[],
  questionId: string,
  type: EditableQuestionType,
  labels: TrueFalseLabels = { true: 'True', false: 'False' },
  id: IdFactory = fallbackId
): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => {
    if (questionKind(q) === type) return q
    const base = withoutTypedKeys(q)
    switch (type) {
      case 'true_false':
        return {
          ...base,
          type,
          response_type: QUIZ_RESPONSE_SINGLE,
          answers: [
            { answer_id: id(), answer: labels.true, correct: true },
            { answer_id: id(), answer: labels.false, correct: false },
          ],
        }
      case 'short_answer': {
        const { response_type: _r, ...rest } = base
        return { ...rest, type, answers: [], accepted_answers: [] }
      }
      case 'numeric': {
        const { response_type: _r, ...rest } = base
        return { ...rest, type, answers: [], tolerance: 0 }
      }
      default: {
        // Back to options: true/false keeps its two options as editable text.
        const answers = q.answers.length ? q.answers : [newAnswer(id), newAnswer(id)]
        return { ...base, type: 'multiple_choice', response_type: q.response_type ?? QUIZ_RESPONSE_SINGLE, answers }
      }
    }
  })
}

/** Mark True (answers[0]) or False (answers[1]) as the right answer. */
export function setTrueFalseAnswer(questions: QuizQuestion[], questionId: string, value: boolean): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => ({
    ...q,
    answers: q.answers.map((a, i) => (i === 0 ? { ...a, correct: value } : i === 1 ? { ...a, correct: !value } : { ...a, correct: false })),
  }))
}

/** The true/false key: true, false, or null when neither is marked. */
export function trueFalseValue(question: QuizQuestion): boolean | null {
  if (question.answers[0]?.correct) return true
  if (question.answers[1]?.correct) return false
  return null
}

export function setAcceptedAnswers(questions: QuizQuestion[], questionId: string, list: string[]): QuizQuestion[] {
  const clean = list.map((a) => String(a ?? '').slice(0, 500)).slice(0, MAX_ACCEPTED_ANSWERS)
  return updateQuestion(questions, questionId, (q) => ({ ...q, accepted_answers: clean }))
}

export function setAccentInsensitive(questions: QuizQuestion[], questionId: string, on: boolean): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => {
    const next = { ...q }
    if (on) next.accent_insensitive = true
    else delete next.accent_insensitive
    return next
  })
}

/** Set the numeric key; a blank or unreadable value clears it. */
export function setNumericAnswer(
  questions: QuizQuestion[],
  questionId: string,
  patch: { correct_value?: unknown; tolerance?: unknown }
): QuizQuestion[] {
  return updateQuestion(questions, questionId, (q) => {
    const next = { ...q }
    if ('correct_value' in patch) {
      const v = parseNumericAnswer(patch.correct_value)
      if (v === null) delete next.correct_value
      else next.correct_value = v
    }
    if ('tolerance' in patch) {
      const v = parseNumericAnswer(patch.tolerance)
      next.tolerance = v === null ? 0 : Math.abs(v)
    }
    return next
  })
}

/** Drop an optional text field instead of storing an empty string. */
export function withOptionalText<T extends object, K extends keyof T>(obj: T, key: K, value: string): T {
  const next = { ...obj }
  if (value.trim()) (next as any)[key] = value
  else delete next[key]
  return next
}

// ─── learner side ─────────────────────────────────────────────────────────

export type Selection = Record<string, string[]>

/** Pick (or toggle) an option, with radio semantics on a pick-one question. */
export function selectAnswer(selection: Selection, question: QuizQuestion, answerId: string): Selection {
  const current = selection[question.question_id] ?? []
  if (responseTypeOf(question) === QUIZ_RESPONSE_SINGLE) {
    return { ...selection, [question.question_id]: [answerId] }
  }
  const next = current.includes(answerId) ? current.filter((id) => id !== answerId) : [...current, answerId]
  return { ...selection, [question.question_id]: next }
}

/** What a learner typed (short answer and numeric questions keep it as the one entry). */
export function setTypedAnswer(selection: Selection, question: QuizQuestion, text: string): Selection {
  return { ...selection, [question.question_id]: text ? [text] : [] }
}

/** Whether the learner has given any answer to this question. */
export function isAnswered(question: QuizQuestion, selected: string[] = []): boolean {
  const kind = questionKind(question)
  if (kind === 'short_answer' || kind === 'numeric') return !!selected[0]?.trim()
  return selected.length > 0
}

export type QuestionResult = 'correct' | 'incorrect' | 'ungraded'

/**
 * All-or-nothing self-check. Options go through the same scorer as the graded
 * quiz task; typed answers through the matchers above. A question without a
 * key can't be judged: it is skipped.
 */
export function gradeQuestion(question: QuizQuestion, selected: string[] = []): QuestionResult {
  if (!hasCorrectAnswer(question)) return 'ungraded'
  const kind = questionKind(question)
  if (kind === 'short_answer') {
    return matchShortAnswer(selected[0], acceptedAnswers(question), { accentInsensitive: question.accent_insensitive === true })
      ? 'correct'
      : 'incorrect'
  }
  if (kind === 'numeric') {
    return matchNumeric(selected[0], question.correct_value as number, question.tolerance ?? 0) ? 'correct' : 'incorrect'
  }
  const outcomes = question.answers.map((a) => ({ correct: a.correct, selected: selected.includes(a.answer_id) }))
  return scoreQuizQuestion(outcomes, responseTypeOf(question), QUIZ_GRADING_ALL_OR_NOTHING) === 1 ? 'correct' : 'incorrect'
}

/**
 * Grade every question. `passed` follows the pass mark when one is set;
 * without one it is the old rule (all graded questions right, or nothing to grade).
 */
export function gradeQuiz(questions: QuizQuestion[], selection: Selection, passMark = 0) {
  const results: Record<string, QuestionResult> = {}
  let correct = 0
  let graded = 0
  for (const q of questions) {
    const r = gradeQuestion(q, selection[q.question_id])
    results[q.question_id] = r
    if (r !== 'ungraded') graded++
    if (r === 'correct') correct++
  }
  const allCorrect = graded > 0 && correct === graded
  const percent = graded > 0 ? Math.round((correct / graded) * 100) : 100
  const mark = normalizePassMark(passMark)
  const passed = mark > 0 ? graded > 0 && percent >= mark : allCorrect || graded === 0
  return { results, correct, graded, allCorrect, percent, passed }
}

/** Seeded Fisher-Yates, so a learner's order holds still across re-renders. */
export function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list]
  let s = seed >>> 0 || 1
  const rand = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The questions (and their options) in the order a learner sees them. */
export function learnerOrder(questions: QuizQuestion[], settings: QuizSettings, seed: number): QuizQuestion[] {
  const qs = settings.shuffleQuestions ? shuffled(questions, seed) : questions
  if (!settings.shuffleAnswers) return qs
  return qs.map((q, i) => ({ ...q, answers: shuffled(q.answers, seed + i + 1) }))
}

export function attemptsLeft(settings: QuizSettings, used: number): number | null {
  return settings.maxAttempts > 0 ? Math.max(0, settings.maxAttempts - used) : null
}

export function answerLetter(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : '?'
}
