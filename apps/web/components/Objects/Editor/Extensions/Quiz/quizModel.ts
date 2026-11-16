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

export interface QuizQuestion {
  question_id: string
  question: string
  // `custom_answer` is legacy and never rendered.
  type: 'multiple_choice' | 'custom_answer'
  // Absent on blocks authored before the mode existed: read it through
  // responseTypeOf, never directly.
  response_type?: QuizResponseType
  /** Shown after submitting (the AI generator already writes it). */
  explanation?: string
  answers: QuizAnswer[]
}

export interface QuizSettings {
  shuffleAnswers: boolean
  shuffleQuestions: boolean
  /** 0 = unlimited (the old behaviour: the reset button always worked). */
  maxAttempts: number
  /** Reveal the answer key after submitting (the old behaviour). */
  showCorrectAnswers: boolean
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  shuffleAnswers: false,
  shuffleQuestions: false,
  maxAttempts: 0,
  showCorrectAnswers: true,
}

export const MAX_ANSWERS = 8
export const ATTEMPT_OPTIONS = [0, 1, 2, 3, 5] as const

type IdFactory = () => string

const fallbackId: IdFactory = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

// ─── reading stored attrs ────────────────────────────────────────────────

/** Stored questions, tolerating whatever a paste, an import or the AI wrote. */
export function normalizeQuestions(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((q): q is Record<string, any> => !!q && typeof q === 'object')
    .map((q) => ({
      ...q,
      question_id: typeof q.question_id === 'string' && q.question_id ? q.question_id : String(q.question_id ?? ''),
      question: typeof q.question === 'string' ? q.question : '',
      type: q.type === 'custom_answer' ? 'custom_answer' : 'multiple_choice',
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
  }
}

/** Settings as stored: only the keys that differ from the default (null when none). */
export function compactSettings(settings: QuizSettings): Partial<QuizSettings> | null {
  const out: Partial<QuizSettings> = {}
  for (const key of Object.keys(DEFAULT_QUIZ_SETTINGS) as (keyof QuizSettings)[]) {
    if (settings[key] !== DEFAULT_QUIZ_SETTINGS[key]) (out as any)[key] = settings[key]
  }
  return Object.keys(out).length ? out : null
}

export function responseTypeOf(question: QuizQuestion): QuizResponseType {
  return resolveQuizResponseType(question.response_type, question.answers.filter((a) => a.correct).length)
}

export function hasCorrectAnswer(question: QuizQuestion): boolean {
  return question.answers.some((a) => a.correct)
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

export type QuestionResult = 'correct' | 'incorrect' | 'ungraded'

/**
 * All-or-nothing self-check through the same scorer as the graded quiz task.
 * A question with no correct option marked can't be judged: it is skipped.
 */
export function gradeQuestion(question: QuizQuestion, selected: string[] = []): QuestionResult {
  if (!hasCorrectAnswer(question)) return 'ungraded'
  const outcomes = question.answers.map((a) => ({ correct: a.correct, selected: selected.includes(a.answer_id) }))
  return scoreQuizQuestion(outcomes, responseTypeOf(question), QUIZ_GRADING_ALL_OR_NOTHING) === 1 ? 'correct' : 'incorrect'
}

export function gradeQuiz(questions: QuizQuestion[], selection: Selection) {
  const results: Record<string, QuestionResult> = {}
  let correct = 0
  let graded = 0
  for (const q of questions) {
    const r = gradeQuestion(q, selection[q.question_id])
    results[q.question_id] = r
    if (r !== 'ungraded') graded++
    if (r === 'correct') correct++
  }
  return { results, correct, graded, allCorrect: graded > 0 && correct === graded }
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
