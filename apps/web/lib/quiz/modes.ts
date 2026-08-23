/**
 * Response-mode and grading-mode resolution for quizzes.
 *
 * A quiz question is either a *single response* (pick exactly one) or a
 * *multiple response* (select all that apply), carried as `response_type` on
 * the question. A graded quiz task additionally carries `grading_mode` on its
 * contents, deciding whether a select-all-that-apply question is all-or-nothing
 * or earns partial credit.
 *
 * Both shapes exist in two places — the graded assignment QUIZ task
 * (`TaskQuizObject`) and the in-editor `blockQuiz` (`QuizBlockComponent`) — so
 * the resolution lives here once, keyed on a correct-option COUNT rather than
 * on either component's option shape.
 *
 * Content authored before these fields existed carries no mode at all, hence
 * the inference: 2+ correct options was always a de-facto select-all-that-apply.
 * Nothing here rewrites stored questions.
 *
 * The server mirror is `apps/api/src/services/courses/activities/quiz_modes.py`.
 * Keep the two in sync — the learner sees the score this file computes and the
 * server stores the score that one computes, so a divergence is a visible bug.
 */

export type QuizResponseType = 'single' | 'multiple'
export type QuizGradingMode = 'all_or_nothing' | 'partial_credit'

export const QUIZ_RESPONSE_SINGLE: QuizResponseType = 'single'
export const QUIZ_RESPONSE_MULTIPLE: QuizResponseType = 'multiple'
export const QUIZ_GRADING_ALL_OR_NOTHING: QuizGradingMode = 'all_or_nothing'
export const QUIZ_GRADING_PARTIAL_CREDIT: QuizGradingMode = 'partial_credit'

/** Mode for a question that carries no explicit `response_type`. */
export function inferQuizResponseType(correctOptionCount: number): QuizResponseType {
    return correctOptionCount >= 2 ? QUIZ_RESPONSE_MULTIPLE : QUIZ_RESPONSE_SINGLE
}

/**
 * The response mode of one question: explicit when set, inferred otherwise.
 *
 * Anything that isn't one of the two known values falls back to inference
 * rather than being trusted, so a bad value can never render a question with
 * three correct options as a pick-one.
 */
export function resolveQuizResponseType(
    explicit: unknown,
    correctOptionCount: number
): QuizResponseType {
    if (typeof explicit === 'string') {
        const normalized = explicit.trim().toLowerCase()
        if (normalized === QUIZ_RESPONSE_SINGLE || normalized === QUIZ_RESPONSE_MULTIPLE) {
            return normalized
        }
    }
    return inferQuizResponseType(correctOptionCount)
}

/**
 * The grading mode of a quiz task. Defaults to all-or-nothing, which is the
 * behaviour every task had before partial credit existed.
 */
export function resolveQuizGradingMode(raw: unknown): QuizGradingMode {
    if (typeof raw === 'string' && raw.trim().toLowerCase() === QUIZ_GRADING_PARTIAL_CREDIT) {
        return QUIZ_GRADING_PARTIAL_CREDIT
    }
    return QUIZ_GRADING_ALL_OR_NOTHING
}

export type QuizOptionOutcome = {
    correct: boolean
    selected: boolean
}

/**
 * Score one question in [0, 1].
 *
 * - all-or-nothing (either response type): 1 only on an exact set match.
 * - partial credit, single response: still 1 or 0 — there is no partial state
 *   to award when only one option can be right.
 * - partial credit, multiple response:
 *   `(correctSelected - incorrectSelected) / totalCorrect`, clamped to [0, 1].
 *   Wrong picks cancel right ones, so selecting everything scores 0.
 *
 * A question whose key marks nothing correct scores 0; callers exclude those
 * from the denominator, exactly as the server does.
 */
export function scoreQuizQuestion(
    outcomes: QuizOptionOutcome[],
    responseType: QuizResponseType,
    gradingMode: QuizGradingMode
): number {
    const totalCorrect = outcomes.filter((o) => o.correct).length
    if (totalCorrect === 0) return 0

    const exactMatch = outcomes.every((o) => o.correct === o.selected)
    if (gradingMode !== QUIZ_GRADING_PARTIAL_CREDIT || responseType !== QUIZ_RESPONSE_MULTIPLE) {
        return exactMatch ? 1 : 0
    }

    const correctSelected = outcomes.filter((o) => o.correct && o.selected).length
    const incorrectSelected = outcomes.filter((o) => !o.correct && o.selected).length
    return Math.max(0, Math.min(1, (correctSelected - incorrectSelected) / totalCorrect))
}
