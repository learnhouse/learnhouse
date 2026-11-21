// Pure logic for the "Match pairs" experience (node `expMatch`): normalising
// stored attrs, author validation, the connect game and the memory game, and
// stars. No React, so it is unit-tested directly (tests/experiences-match.test.mjs).
//
// Stored shape:
//   { blockId, title, instructions, mode: 'connect' | 'memory',
//     pairs: [{ id, left, right }] }   // 2–8

import { asArray, shuffle } from '../shared/utils'

export interface MatchPair {
  id: string
  left: string
  right: string
}

export type MatchMode = 'connect' | 'memory'

export interface MatchData {
  blockId: string
  title: string
  instructions: string
  pairs: MatchPair[]
  mode: MatchMode
}

export const MATCH_LIMITS = { minPairs: 2, maxPairs: 8 } as const

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)
const norm = (s: string) => s.trim().toLowerCase()

export function normalizeMatch(attrs: any): MatchData {
  const raw: any[] = asArray(attrs?.pairs)
  const seen = new Set<string>()
  const pairs: MatchPair[] = raw
    .filter((p) => p && typeof p === 'object')
    .map((p, i) => {
      let id = str(p.id, `p${i + 1}`) || `p${i + 1}`
      while (seen.has(id)) id = `${id}_${i}`
      seen.add(id)
      return { id, left: str(p.left), right: str(p.right) }
    })
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    instructions: str(attrs?.instructions),
    pairs,
    mode: attrs?.mode === 'memory' ? 'memory' : 'connect',
  }
}

/** The filled-in example; same content and keys as the registry's insert. */
export function exampleMatch(t: T = identityT): Omit<MatchData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.match.example.${key}`, fallback)
  return {
    title: k('title', 'Countries and capitals'),
    instructions: k('instructions', 'Match each country with its capital.'),
    mode: 'connect',
    pairs: [
      { id: 'p1', left: k('france', 'France'), right: k('paris', 'Paris') },
      { id: 'p2', left: k('japan', 'Japan'), right: k('tokyo', 'Tokyo') },
      { id: 'p3', left: k('kenya', 'Kenya'), right: k('nairobi', 'Nairobi') },
      { id: 'p4', left: k('brazil', 'Brazil'), right: k('brasilia', 'Brasília') },
    ],
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type MatchIssueCode = 'too_few_pairs' | 'too_many_pairs' | 'empty_left' | 'empty_right' | 'duplicate_left' | 'duplicate_pair'

export interface MatchIssue {
  code: MatchIssueCode
  id?: string
  severity: 'error' | 'warning'
}

export function validateMatch(data: MatchData): MatchIssue[] {
  const issues: MatchIssue[] = []
  if (data.pairs.length < MATCH_LIMITS.minPairs) issues.push({ code: 'too_few_pairs', severity: 'error' })
  if (data.pairs.length > MATCH_LIMITS.maxPairs) issues.push({ code: 'too_many_pairs', severity: 'warning' })
  const lefts = new Set<string>()
  const both = new Set<string>()
  data.pairs.forEach((p) => {
    const l = norm(p.left)
    const r = norm(p.right)
    if (!l) issues.push({ code: 'empty_left', id: p.id, severity: 'error' })
    if (!r) issues.push({ code: 'empty_right', id: p.id, severity: 'error' })
    if (!l || !r) return
    if (both.has(`${l}\u0000${r}`)) issues.push({ code: 'duplicate_pair', id: p.id, severity: 'warning' })
    else if (lefts.has(l)) issues.push({ code: 'duplicate_left', id: p.id, severity: 'warning' })
    lefts.add(l)
    both.add(`${l}\u0000${r}`)
  })
  return issues
}

export function playableMatch(data: MatchData): MatchData {
  return { ...data, pairs: data.pairs.filter((p) => p.left.trim() && p.right.trim()).slice(0, MATCH_LIMITS.maxPairs) }
}

export function isPlayable(data: MatchData): boolean {
  return playableMatch(data).pairs.length >= MATCH_LIMITS.minPairs
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

export function addPair(data: MatchData, id: string): MatchData {
  if (data.pairs.length >= MATCH_LIMITS.maxPairs) return data
  return { ...data, pairs: [...data.pairs, { id, left: '', right: '' }] }
}

export function removePair(data: MatchData, id: string): MatchData {
  if (data.pairs.length <= MATCH_LIMITS.minPairs) return data
  return { ...data, pairs: data.pairs.filter((p) => p.id !== id) }
}

export function updatePair(data: MatchData, id: string, patch: Partial<Omit<MatchPair, 'id'>>): MatchData {
  return { ...data, pairs: data.pairs.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

// ─── Shared ─────────────────────────────────────────────────────────────────

/** Shuffled copy; with more than one item never the input order (shared helper). */
export const shuffleIds: <V>(_arr: readonly V[], _rng?: () => number) => V[] = shuffle

/**
 * Whether the left side of pair `leftId` goes with the right side of pair
 * `rightId`. Two pairs that share the same right text (2+2 → 4, 3+1 → 4) are
 * interchangeable, so either "4" is accepted.
 */
export function isMatch(data: MatchData, leftId: string, rightId: string): boolean {
  if (leftId === rightId) return data.pairs.some((p) => p.id === leftId)
  const l = data.pairs.find((p) => p.id === leftId)
  const r = data.pairs.find((p) => p.id === rightId)
  return !!l && !!r && norm(l.right) === norm(r.right)
}

// ─── Connect mode ───────────────────────────────────────────────────────────

export interface ConnectState {
  /** Pair ids whose LEFT card is locked in. */
  doneLeft: string[]
  /** Pair ids whose RIGHT card is locked in. */
  doneRight: string[]
  mistakes: number
}

export const emptyConnect = (): ConnectState => ({ doneLeft: [], doneRight: [], mistakes: 0 })

export function tryConnect(data: MatchData, state: ConnectState, leftId: string, rightId: string): { state: ConnectState; correct: boolean } {
  if (state.doneLeft.includes(leftId) || state.doneRight.includes(rightId)) return { state, correct: false }
  if (isMatch(data, leftId, rightId)) {
    return { state: { ...state, doneLeft: [...state.doneLeft, leftId], doneRight: [...state.doneRight, rightId] }, correct: true }
  }
  return { state: { ...state, mistakes: state.mistakes + 1 }, correct: false }
}

export const connectDone = (data: MatchData, state: ConnectState) => data.pairs.length > 0 && state.doneLeft.length >= data.pairs.length

/** No mistakes → 3, up to a third of the pairs → 2, otherwise 1 (finishing always earns a star). */
export function connectStars(mistakes: number, pairs: number): 0 | 1 | 2 | 3 {
  if (pairs <= 0) return 0
  if (mistakes <= 0) return 3
  if (mistakes <= Math.ceil(pairs / 3)) return 2
  return 1
}

// ─── Memory mode ────────────────────────────────────────────────────────────

export interface MemoryCard {
  key: string
  pairId: string
  side: 'left' | 'right'
  text: string
}

export function memoryDeck(data: MatchData, rng: () => number = Math.random): MemoryCard[] {
  const cards: MemoryCard[] = []
  data.pairs.forEach((p) => {
    cards.push({ key: `${p.id}:l`, pairId: p.id, side: 'left', text: p.left })
    cards.push({ key: `${p.id}:r`, pairId: p.id, side: 'right', text: p.right })
  })
  return shuffleIds(cards, rng)
}

export interface MemoryState {
  /** Indices of the face-up, not yet matched cards (0–2). */
  open: number[]
  /** Keys of matched cards. */
  matched: string[]
  /** One move = one pair of cards turned. */
  moves: number
}

export const emptyMemory = (): MemoryState => ({ open: [], matched: [], moves: 0 })

export type FlipResult = 'ignored' | 'first' | 'match' | 'miss'

/**
 * Turn card `index`. A third flip while a miss is still showing first turns the
 * two missed cards back. Returns 'miss' when the second card doesn't match; the
 * view shows both briefly, then calls `closeMiss`.
 */
export function flipCard(data: MatchData, deck: MemoryCard[], state: MemoryState, index: number): { state: MemoryState; result: FlipResult } {
  const card = deck[index]
  if (!card || state.matched.includes(card.key)) return { state, result: 'ignored' }
  let open = state.open
  if (open.length >= 2) open = []
  if (open.includes(index)) return { state, result: 'ignored' }
  if (open.length === 0) return { state: { ...state, open: [index] }, result: 'first' }
  const first = deck[open[0]]
  const moves = state.moves + 1
  const pairsUp =
    first.side !== card.side &&
    (first.side === 'left' ? isMatch(data, first.pairId, card.pairId) : isMatch(data, card.pairId, first.pairId))
  if (pairsUp) return { state: { open: [], matched: [...state.matched, first.key, card.key], moves }, result: 'match' }
  return { state: { ...state, open: [open[0], index], moves }, result: 'miss' }
}

export const closeMiss = (state: MemoryState): MemoryState => (state.open.length >= 2 ? { ...state, open: [] } : state)

export const memoryDone = (deck: MemoryCard[], state: MemoryState) => deck.length > 0 && state.matched.length >= deck.length

/**
 * Perfect memory still needs some luck, so 3 stars allow about 1.5 moves per
 * pair, 2 stars 2.5 per pair; finishing always earns one.
 */
export function memoryStars(moves: number, pairs: number): 0 | 1 | 2 | 3 {
  if (pairs <= 0) return 0
  if (moves <= Math.ceil(pairs * 1.5)) return 3
  if (moves <= Math.ceil(pairs * 2.5)) return 2
  return 1
}

/** Lower is better; `null` means no best yet. */
export function betterMoves(best: number | null, moves: number): number {
  return best == null || !Number.isFinite(best) || best <= 0 ? moves : Math.min(best, moves)
}
