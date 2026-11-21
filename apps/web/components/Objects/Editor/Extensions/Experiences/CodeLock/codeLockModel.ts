/*
 Code lock: pure logic. Fuzzy answer matching, dial state, hint cost and
 stars. Answers stay in the node attrs; the view only ever renders an answer
 after its clue is solved.
*/

export const MIN_CLUES = 1
export const MAX_CLUES = 5
export const MAX_ANSWER_LENGTH = 40

export type Clue = { id: string; question: string; answer: string; hint: string }
export type CodeLockData = { title: string; story: string; clues: Clue[]; reward: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

export function normalizeCodeLock(attrs: any): CodeLockData {
  const raw = Array.isArray(attrs?.clues) ? attrs.clues : []
  const seen = new Set<string>()
  const clues: Clue[] = []
  raw
    .filter((x: any) => x && typeof x === 'object')
    .slice(0, MAX_CLUES)
    .forEach((c: any, i: number) => {
    let id = str(c.id) || `c${i + 1}`
    while (seen.has(id)) id = `${id}_`
    seen.add(id)
    clues.push({ id, question: str(c.question), answer: str(c.answer), hint: str(c.hint) })
  })
  return { title: str(attrs?.title), story: str(attrs?.story), clues, reward: str(attrs?.reward) }
}

export type CodeLockIssue =
  | { kind: 'noClues' }
  | { kind: 'emptyQuestion'; id: string }
  | { kind: 'emptyAnswer'; id: string }
  | { kind: 'longAnswer'; id: string }
  | { kind: 'emptyReward' }

export function validateCodeLock(d: CodeLockData): CodeLockIssue[] {
  const issues: CodeLockIssue[] = []
  if (d.clues.length < MIN_CLUES) issues.push({ kind: 'noClues' })
  for (const c of d.clues) {
    if (!c.question.trim()) issues.push({ kind: 'emptyQuestion', id: c.id })
    if (!c.answer.trim()) issues.push({ kind: 'emptyAnswer', id: c.id })
    else if (c.answer.trim().length > MAX_ANSWER_LENGTH) issues.push({ kind: 'longAnswer', id: c.id })
  }
  if (!d.reward.trim()) issues.push({ kind: 'emptyReward' })
  return issues
}

/** Clues a learner can solve (both question and answer filled). */
export function playableClues(d: CodeLockData): Clue[] {
  return d.clues.filter((c) => c.question.trim() && c.answer.trim())
}

const NUMERIC = /^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/
const THOUSANDS = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/

/**
 * Canonical form of an answer: trimmed, inner whitespace collapsed, lower
 * case, accents removed. Numbers compare by value: "7", "7.0", "07" and
 * "1,000" vs "1000" are equal; a lone comma counts as a decimal mark ("3,5").
 */
export function normalizeAnswer(input: string): string {
  const base = String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
  const compact = base.replace(/\s/g, '')
  let numeric: string | null = null
  if (THOUSANDS.test(compact)) numeric = compact.replace(/,/g, '')
  else if (NUMERIC.test(compact)) numeric = compact.replace(',', '.')
  if (numeric !== null) {
    const n = Number(numeric)
    if (Number.isFinite(n)) return `#${Object.is(n, -0) ? 0 : n}`
  }
  return base
}

export function answersMatch(input: string, answer: string): boolean {
  const a = normalizeAnswer(answer)
  return a !== '' && normalizeAnswer(input) === a
}

export type LockState = { solved: string[]; hints: string[]; wrong: Record<string, number> }

export function newLock(): LockState {
  return { solved: [], hints: [], wrong: {} }
}

export function tryClue(state: LockState, clue: Clue, input: string): { state: LockState; correct: boolean } {
  if (state.solved.includes(clue.id)) return { state, correct: true }
  if (!input.trim()) return { state, correct: false }
  if (answersMatch(input, clue.answer)) {
    return { state: { ...state, solved: [...state.solved, clue.id] }, correct: true }
  }
  return {
    state: { ...state, wrong: { ...state.wrong, [clue.id]: (state.wrong[clue.id] || 0) + 1 } },
    correct: false,
  }
}

export function takeHint(state: LockState, clue: Clue): LockState {
  if (!clue.hint.trim() || state.hints.includes(clue.id) || state.solved.includes(clue.id)) return state
  return { ...state, hints: [...state.hints, clue.id] }
}

export function isOpen(state: LockState, clues: Clue[]): boolean {
  return clues.length > 0 && clues.every((c) => state.solved.includes(c.id))
}

/** Every hint costs a star; an opened lock always keeps at least one. */
export function starsFor(hintsUsed: number): 1 | 2 | 3 {
  return Math.max(1, 3 - Math.max(0, hintsUsed)) as 1 | 2 | 3
}

/**
 * What a dial shows. Solved: the answer as typed by the author (shortened).
 * Unsolved: a placeholder, never derived from the answer (not even its length).
 */
export function dialFace(clue: Clue, solved: boolean): string {
  if (!solved) return '?'
  const a = clue.answer.trim()
  return a.length > 8 ? `${a.slice(0, 7)}…` : a
}
