// Pure logic for Flashcards (flipcardGrid): the study-mode session (a small
// in-session Leitner queue), card identity for "known" persistence, the
// learner-side shuffle, and bulk paste parsing for the list editor.
// No React here, so it is unit-tested directly (tests/experiences-flashcards.test.mjs).

export type GridMode = 'grid' | 'study'
export type Rating = 'again' | 'hard' | 'good'

export interface StudyCard {
  key: string
  question: string
  answer: string
}

/** flipcardGrid attrs added with the redesign; defaults reproduce the old grid. */
export interface FlashcardDeckAttrs {
  mode: GridMode
  title: string
  shuffle: boolean
}

export function resolveDeckAttrs(attrs: any): FlashcardDeckAttrs {
  return {
    mode: attrs?.mode === 'study' ? 'study' : 'grid',
    title: typeof attrs?.title === 'string' ? attrs.title : '',
    shuffle: attrs?.shuffle === true,
  }
}

// ─── Card identity ───────────────────────────────────────────────────────────

/** FNV-1a, base 36. Short and stable across sessions and browsers. */
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Flipcards have no ids, so a card is known by its content: the same card
 * stays known when the deck is reordered, and an edited card starts fresh.
 */
export const cardKey = (question: string, answer: string) => `c${hashString(`${question.trim()}\u0000${answer.trim()}`)}`

export function toStudyCards(cards: { question?: unknown; answer?: unknown }[]): StudyCard[] {
  const seen = new Map<string, number>()
  return cards.map((c) => {
    const question = typeof c.question === 'string' ? c.question : ''
    const answer = typeof c.answer === 'string' ? c.answer : ''
    // Duplicate cards get distinct keys so the queue can hold both.
    const base = cardKey(question, answer)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { key: n ? `${base}_${n}` : base, question, answer }
  })
}

// ─── Shuffle ─────────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) so a session's order is stable across re-renders. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffled<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** CSS `order` for a card in a shuffled learner grid (each card computes its own). */
export const shuffleOrder = (seed: number, key: string) => parseInt(hashString(`${seed}:${key}`), 36) % 100000

// ─── Study session ───────────────────────────────────────────────────────────

/** Again comes back after this many cards; Hard waits longer. */
export const AGAIN_GAP = 2
export const HARD_GAP = 5

export interface StudySession {
  /** Card keys still to study; the head is on screen. */
  queue: string[]
  /** Keys rated "Got it" (this session, plus those remembered from before). */
  known: string[]
  /** Keys rated Again or Hard at least once this session. */
  missed: string[]
  /** Every rating given this session. */
  reviews: number
  /** All keys in the deck, in deck order. */
  total: string[]
}

export interface SessionOptions {
  /** Keys remembered as known from an earlier visit; they start out of the queue. */
  known?: Iterable<string>
  /** Only study these keys (the "Study missed cards" pass). */
  only?: Iterable<string>
  shuffle?: boolean
  rand?: () => number
}

export function createSession(cards: StudyCard[], opts: SessionOptions = {}): StudySession {
  const total = cards.map((c) => c.key)
  const all = new Set(total)
  const only = opts.only ? new Set([...opts.only].filter((k) => all.has(k))) : null
  const remembered = new Set([...(opts.known ?? [])].filter((k) => all.has(k)))
  // A missed-cards pass studies those cards even if they were known before.
  if (only) for (const k of only) remembered.delete(k)
  let queue = total.filter((k) => (only ? only.has(k) : !remembered.has(k)))
  if (opts.shuffle) queue = shuffled(queue, opts.rand)
  return { queue, known: total.filter((k) => remembered.has(k)), missed: [], reviews: 0, total }
}

export const currentCard = (s: StudySession) => s.queue[0] ?? null
export const isFinished = (s: StudySession) => s.queue.length === 0

export function rateCard(s: StudySession, rating: Rating): StudySession {
  const key = s.queue[0]
  if (!key) return s
  const rest = s.queue.slice(1)
  const reviews = s.reviews + 1
  if (rating === 'good') {
    return { ...s, queue: rest, known: s.known.includes(key) ? s.known : [...s.known, key], reviews }
  }
  const gap = rating === 'again' ? AGAIN_GAP : HARD_GAP
  const at = Math.min(gap, rest.length)
  const queue = [...rest.slice(0, at), key, ...rest.slice(at)]
  return {
    ...s,
    queue,
    known: s.known.filter((k) => k !== key),
    missed: s.missed.includes(key) ? s.missed : [...s.missed, key],
    reviews,
  }
}

export function sessionProgress(s: StudySession) {
  const known = s.known.filter((k) => s.total.includes(k)).length
  const total = s.total.length
  return { known, total, pct: total ? Math.round((known / total) * 100) : 0 }
}

/** Keys of cards in `remembered` that still exist, plus this session's known cards. */
export function mergeKnown(remembered: string[], session: StudySession, cap = 500): string[] {
  const missed = new Set(session.missed.filter((k) => !session.known.includes(k)))
  const out = [...remembered.filter((k) => !missed.has(k) && !session.known.includes(k)), ...session.known]
  return out.slice(-cap)
}

/** Rating from a key press (1/2/3), or null. */
export function ratingFromKey(key: string): Rating | null {
  return key === '1' ? 'again' : key === '2' ? 'hard' : key === '3' ? 'good' : null
}

// ─── Bulk paste ("term – definition" per line) ──────────────────────────────

// Order matters: tab first, then spaced dashes, then a colon.
const SEPARATORS = [/\t+/, /\s+[–—]\s+/, /\s+-\s+/, /\s*[–—]\s*/, /\s*:\s+|:\s*/]

/**
 * Parse pasted lines into cards. Each line is "term – definition",
 * "term - definition", "term: definition" or "term<TAB>definition".
 * Lines without a separator become a card with an empty answer; blank lines
 * are skipped. Leading list markers ("1.", "-", "•") are dropped.
 */
export function parseBulkCards(text: string): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
    if (!line) continue
    let question = line
    let answer = ''
    for (const sep of SEPARATORS) {
      const m = sep.exec(line)
      if (m && m.index > 0) {
        question = line.slice(0, m.index).trim()
        answer = line.slice(m.index + m[0].length).trim()
        break
      }
    }
    if (question) out.push({ question, answer })
  }
  return out
}

// ─── Node attrs (spread into FlipcardGrid.ts; pure so tests build the schema) ─

/**
 * New optional flipcardGrid attrs. Defaults reproduce the old grid exactly,
 * and nothing extra is written to HTML unless an author changed them.
 */
export const FLIPCARD_GRID_EXTRA_ATTRS = {
  mode: {
    default: 'grid' as GridMode,
    parseHTML: (el: HTMLElement): GridMode => (el.getAttribute('data-mode') === 'study' ? 'study' : 'grid'),
    renderHTML: (a: Record<string, any>) => (a.mode === 'study' ? { 'data-mode': 'study' } : {}),
  },
  title: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-title') ?? '',
    renderHTML: (a: Record<string, any>) => (a.title ? { 'data-title': String(a.title) } : {}),
  },
  shuffle: {
    default: false,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-shuffle') === 'true',
    renderHTML: (a: Record<string, any>) => (a.shuffle ? { 'data-shuffle': 'true' } : {}),
  },
}
