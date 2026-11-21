// Pure logic for the "Word guess" experience (node `expWordGuess`): stored
// attrs, author validation, splitting an answer into letter tiles, scoring a
// guess (Wordle rules), hints, the on-screen keyboard and stars. No React, so
// it is unit-tested directly (tests/experiences-wordguess.test.mjs).
//
// Stored shape:
//   { blockId, title, maxGuesses,
//     words: [{ id, answer, clue, explanation? }] }   // 1–8
//
// Matching is accent- and case-insensitive: a learner typing "e" matches an
// "é" in the answer. Spaces and hyphens in an answer are shown as fixed gaps
// and never typed.

import { asArray } from '../shared/utils'

export interface WordGuessWord {
  id: string
  answer: string
  clue: string
  explanation?: string
}

export interface WordGuessData {
  blockId: string
  title: string
  words: WordGuessWord[]
  maxGuesses: number
}

export const WORD_GUESS_LIMITS = { minWords: 1, maxWords: 8, minGuesses: 3, maxGuesses: 8, defaultGuesses: 6, minLetters: 2, maxLetters: 12 } as const

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

function clampGuesses(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return WORD_GUESS_LIMITS.defaultGuesses
  return Math.min(WORD_GUESS_LIMITS.maxGuesses, Math.max(WORD_GUESS_LIMITS.minGuesses, n))
}

/** Guard whatever is stored (AI output, collab peers, pasted HTML) into the shape the UI expects. */
export function normalizeWordGuess(attrs: any): WordGuessData {
  const seen = new Set<string>()
  const words: WordGuessWord[] = asArray<any>(attrs?.words)
    .filter((w) => w && typeof w === 'object')
    .map((w, i) => {
      let id = str(w.id, `w${i + 1}`) || `w${i + 1}`
      while (seen.has(id)) id = `${id}_${i}`
      seen.add(id)
      const word: WordGuessWord = { id, answer: str(w.answer), clue: str(w.clue) }
      const explanation = str(w.explanation)
      if (explanation) word.explanation = explanation
      return word
    })
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    words,
    maxGuesses: clampGuesses(attrs?.maxGuesses ?? WORD_GUESS_LIMITS.defaultGuesses),
  }
}

/** The filled-in example a new block starts with; same content and keys as the registry's insert. */
export function exampleWordGuess(t: T = identityT): Omit<WordGuessData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.word_guess.example.${key}`, fallback)
  return {
    title: k('title', 'Guess the science word'),
    maxGuesses: 6,
    words: [
      { id: 'w1', answer: k('w1_answer', 'atom'), clue: k('w1_clue', 'The tiny building block of all matter.'), explanation: k('w1_why', 'Everything around you is made of atoms.') },
      { id: 'w2', answer: k('w2_answer', 'planet'), clue: k('w2_clue', 'A large body that orbits a star, like Earth.'), explanation: k('w2_why', 'Our solar system has eight planets.') },
      { id: 'w3', answer: k('w3_answer', 'energy'), clue: k('w3_clue', 'What makes things move, warm up or light up.'), explanation: k('w3_why', 'Energy changes form, for example from food to movement, but it is never lost.') },
    ],
  }
}

// ─── Letters ────────────────────────────────────────────────────────────────

/** A tile in the answer: a letter to guess, or a fixed space / hyphen. */
export type Cell = { kind: 'letter'; char: string; fold: string } | { kind: 'fixed'; char: string }

const FIXED = new Set([' ', '-', '‐', '‑', '–'])

function graphemes(s: string): string[] {
  try {
    const Seg = (Intl as any).Segmenter
    if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s) as Iterable<{ segment: string }>, (x) => x.segment)
  } catch {
    // fall through
  }
  return Array.from(s)
}

const STRIP_MARKS = /^[\p{Script=Latin}\p{Script=Greek}]/u

/**
 * One letter folded for comparison: lower-case, accents removed for Latin and
 * Greek letters (é → e, ç → c). Other scripts keep their marks, because there
 * they are part of the letter (Hindi vowel signs, Thai tone marks).
 */
export function foldLetter(g: string): string {
  const lower = g.normalize('NFC').toLowerCase()
  if (lower === 'ё') return 'е'
  if (STRIP_MARKS.test(lower.normalize('NFD'))) return lower.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
  return lower
}

/** Is this grapheme a letter (base character is a letter, marks allowed)? */
export function isLetter(g: string): boolean {
  return /^\p{L}/u.test(g)
}

/** Split an answer into tiles. Surrounding spaces are dropped, inner runs collapse. */
export function answerCells(answer: string): Cell[] {
  const clean = answer.normalize('NFC').trim().replace(/\s+/g, ' ')
  return graphemes(clean).map<Cell>((g) => (FIXED.has(g) ? { kind: 'fixed', char: g === ' ' ? ' ' : '-' } : { kind: 'letter', char: g, fold: foldLetter(g) }))
}

export function letterCells(cells: Cell[]): Extract<Cell, { kind: 'letter' }>[] {
  return cells.filter((c): c is Extract<Cell, { kind: 'letter' }> => c.kind === 'letter')
}

/** Answers written right to left (Arabic, Persian, Hebrew…) lay their tiles out RTL. */
export function isRtlText(s: string): boolean {
  return /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u.test(s)
}

/** Upper-case for display when that keeps one character per tile (not ß → SS). */
export function displayLetter(g: string): string {
  const up = g.toUpperCase()
  return graphemes(up).length === graphemes(g).length ? up : g
}

// ─── Author validation ──────────────────────────────────────────────────────

export type WordGuessIssueCode =
  | 'too_few_words'
  | 'too_many_words'
  | 'empty_answer'
  | 'empty_clue'
  | 'bad_characters'
  | 'too_short'
  | 'too_long'
  | 'duplicate_answer'

export interface WordGuessIssue {
  code: WordGuessIssueCode
  id?: string
  severity: 'error' | 'warning'
}

/** Characters an answer may not contain (digits, punctuation, symbols). */
export function badCharacters(answer: string): string[] {
  const out = new Set<string>()
  answerCells(answer).forEach((c) => {
    if (c.kind === 'letter' && !isLetter(c.char)) out.add(c.char)
  })
  return [...out]
}

export function validateWordGuess(data: WordGuessData): WordGuessIssue[] {
  const issues: WordGuessIssue[] = []
  if (data.words.length < WORD_GUESS_LIMITS.minWords) issues.push({ code: 'too_few_words', severity: 'error' })
  if (data.words.length > WORD_GUESS_LIMITS.maxWords) issues.push({ code: 'too_many_words', severity: 'warning' })
  const seen = new Set<string>()
  data.words.forEach((w) => {
    if (!w.answer.trim()) {
      issues.push({ code: 'empty_answer', id: w.id, severity: 'error' })
    } else if (badCharacters(w.answer).length) {
      issues.push({ code: 'bad_characters', id: w.id, severity: 'error' })
    } else {
      const n = letterCells(answerCells(w.answer)).length
      if (n < WORD_GUESS_LIMITS.minLetters) issues.push({ code: 'too_short', id: w.id, severity: 'error' })
      if (n > WORD_GUESS_LIMITS.maxLetters) issues.push({ code: 'too_long', id: w.id, severity: 'error' })
      const key = letterCells(answerCells(w.answer)).map((c) => c.fold).join('')
      if (seen.has(key)) issues.push({ code: 'duplicate_answer', id: w.id, severity: 'warning' })
      seen.add(key)
    }
    if (!w.clue.trim()) issues.push({ code: 'empty_clue', id: w.id, severity: 'warning' })
  })
  return issues
}

/** A word learners can play: a usable answer (blank or broken ones are skipped). */
export function isPlayableWord(w: WordGuessWord): boolean {
  if (!w.answer.trim() || badCharacters(w.answer).length) return false
  const n = letterCells(answerCells(w.answer)).length
  return n >= WORD_GUESS_LIMITS.minLetters && n <= WORD_GUESS_LIMITS.maxLetters
}

export function playableWordGuess(data: WordGuessData): WordGuessData {
  return { ...data, words: data.words.filter(isPlayableWord).slice(0, WORD_GUESS_LIMITS.maxWords) }
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

export function addWord(data: WordGuessData, id: string): WordGuessData {
  if (data.words.length >= WORD_GUESS_LIMITS.maxWords) return data
  return { ...data, words: [...data.words, { id, answer: '', clue: '' }] }
}

export function removeWord(data: WordGuessData, id: string): WordGuessData {
  if (data.words.length <= WORD_GUESS_LIMITS.minWords) return data
  return { ...data, words: data.words.filter((w) => w.id !== id) }
}

export function updateWord(data: WordGuessData, id: string, patch: Partial<Omit<WordGuessWord, 'id'>>): WordGuessData {
  return {
    ...data,
    words: data.words.map((w) => {
      if (w.id !== id) return w
      const next = { ...w, ...patch }
      if (!next.explanation) delete next.explanation
      return next
    }),
  }
}

export function moveWord(data: WordGuessData, id: string, delta: -1 | 1): WordGuessData {
  const i = data.words.findIndex((w) => w.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= data.words.length) return data
  const words = [...data.words]
  ;[words[i], words[j]] = [words[j], words[i]]
  return { ...data, words }
}

export const setMaxGuesses = (data: WordGuessData, n: unknown): WordGuessData => ({ ...data, maxGuesses: clampGuesses(n) })

// ─── Scoring ────────────────────────────────────────────────────────────────

/** hit: right letter, right place · near: in the word elsewhere · miss: not in the word. */
export type LetterScore = 'hit' | 'near' | 'miss'

/**
 * Score a guess against the answer (both as folded letters, same length).
 * Duplicate letters follow Wordle: hits are counted first, then each "near"
 * uses up one remaining copy of that letter in the answer.
 */
export function scoreGuess(answer: readonly string[], guess: readonly string[]): LetterScore[] {
  const out: LetterScore[] = guess.map(() => 'miss')
  const left = new Map<string, number>()
  answer.forEach((a, i) => {
    if (guess[i] === a) out[i] = 'hit'
    else left.set(a, (left.get(a) ?? 0) + 1)
  })
  guess.forEach((g, i) => {
    if (out[i] === 'hit' || !g) return
    const n = left.get(g) ?? 0
    if (n > 0) {
      out[i] = 'near'
      left.set(g, n - 1)
    }
  })
  return out
}

const RANK: Record<LetterScore, number> = { miss: 1, near: 2, hit: 3 }

/** Best known state per letter, for colouring the on-screen keyboard. */
export function keyStates(guesses: readonly (readonly string[])[], scores: readonly (readonly LetterScore[])[]): Record<string, LetterScore> {
  const out: Record<string, LetterScore> = {}
  guesses.forEach((g, r) =>
    g.forEach((letter, i) => {
      const s = scores[r]?.[i]
      if (!letter || !s) return
      if (!out[letter] || RANK[s] > RANK[out[letter]]) out[letter] = s
    }),
  )
  return out
}

// ─── Learner round (one word) ───────────────────────────────────────────────

export interface WordRound {
  /** Folded answer letters. */
  answer: string[]
  guesses: string[][]
  scores: LetterScore[][]
  /** The row being typed: one slot per letter, '' when empty. */
  current: string[]
  /** Letter indexes revealed by hints (pre-filled and locked in every new row). */
  revealed: number[]
  status: 'playing' | 'solved' | 'failed'
  maxGuesses: number
}

function rowWithRevealed(answer: string[], revealed: number[]): string[] {
  return answer.map((a, i) => (revealed.includes(i) ? a : ''))
}

export function newRound(answer: string, maxGuesses: number): WordRound {
  const letters = letterCells(answerCells(answer)).map((c) => c.fold)
  return { answer: letters, guesses: [], scores: [], current: letters.map(() => ''), revealed: [], status: 'playing', maxGuesses: clampGuesses(maxGuesses) }
}

/** Put a letter in the first empty slot (revealed slots are skipped). */
export function typeLetter(round: WordRound, letter: string): WordRound {
  if (round.status !== 'playing') return round
  const fold = foldLetter(letter)
  if (!fold) return round
  const i = round.current.findIndex((c, idx) => !c && !round.revealed.includes(idx))
  if (i < 0) return round
  const current = [...round.current]
  current[i] = fold
  return { ...round, current }
}

/** Clear the last typed slot (never a revealed one). */
export function backspace(round: WordRound): WordRound {
  if (round.status !== 'playing') return round
  for (let i = round.current.length - 1; i >= 0; i--) {
    if (round.current[i] && !round.revealed.includes(i)) {
      const current = [...round.current]
      current[i] = ''
      return { ...round, current }
    }
  }
  return round
}

export function rowComplete(round: WordRound): boolean {
  return round.current.every(Boolean)
}

/** Score the typed row. An incomplete row is refused (the round is returned unchanged). */
export function submitGuess(round: WordRound): { round: WordRound; ok: boolean } {
  if (round.status !== 'playing' || !rowComplete(round)) return { round, ok: false }
  const score = scoreGuess(round.answer, round.current)
  const guesses = [...round.guesses, round.current]
  const scores = [...round.scores, score]
  const solved = score.every((s) => s === 'hit')
  const status: WordRound['status'] = solved ? 'solved' : guesses.length >= round.maxGuesses ? 'failed' : 'playing'
  return { round: { ...round, guesses, scores, status, current: status === 'playing' ? rowWithRevealed(round.answer, round.revealed) : round.current }, ok: true }
}

/** Letter positions a hint could still reveal: not revealed and never guessed in place. */
export function hintCandidates(round: WordRound): number[] {
  const known = new Set<number>(round.revealed)
  round.scores.forEach((row) => row.forEach((s, i) => s === 'hit' && known.add(i)))
  return round.answer.map((_, i) => i).filter((i) => !known.has(i))
}

/** A hint is allowed while the word is open and more than one unknown letter is left. */
export function canHint(round: WordRound): boolean {
  return round.status === 'playing' && hintCandidates(round).length > 1
}

/** Reveal one letter in place (the first unknown one; `pick` chooses among candidates for tests). */
export function revealHint(round: WordRound, pick: (_n: number) => number = () => 0): WordRound {
  if (!canHint(round)) return round
  const cands = hintCandidates(round)
  const at = cands[Math.min(cands.length - 1, Math.max(0, pick(cands.length)))]
  const revealed = [...round.revealed, at].sort((a, b) => a - b)
  // Typed letters shift out of the revealed slot so nothing typed is lost.
  const typed = round.current.filter((c, i) => c && !round.revealed.includes(i))
  const current = rowWithRevealed(round.answer, revealed)
  let ti = 0
  for (let i = 0; i < current.length && ti < typed.length; i++) {
    if (!current[i]) current[i] = typed[ti++]
  }
  return { ...round, revealed, current }
}

// ─── Stars ──────────────────────────────────────────────────────────────────

/** Per word: solved earns 3, minus one per hint (never below 1); unsolved 0. */
export function wordStars(solved: boolean, hints: number): 0 | 1 | 2 | 3 {
  if (!solved) return 0
  return Math.max(1, 3 - Math.max(0, hints)) as 1 | 2 | 3
}

/** Block stars: the average of the word stars, rounded down. */
export function blockStars(results: { solved: boolean; hints: number }[]): 0 | 1 | 2 | 3 {
  if (!results.length) return 0
  const avg = results.reduce((s, r) => s + wordStars(r.solved, r.hints), 0) / results.length
  return Math.min(3, Math.max(0, Math.floor(avg + 1e-9))) as 0 | 1 | 2 | 3
}

// ─── On-screen keyboard ─────────────────────────────────────────────────────

const QWERTY = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

// Full alphabets where a script has one; other scripts (Indic, Thai, CJK,
// Hangul, kana) get the answers' letters plus a few fillers from these pools.
const POOLS: [RegExp, string, boolean][] = [
  [/\p{Script=Cyrillic}/u, 'абвгдежзийклмнопрстуфхцчшщъыьэюяґєії', true],
  [/\p{Script=Greek}/u, 'αβγδεζηθικλμνξοπρστυφχψω', true],
  [/\p{Script=Arabic}/u, 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', true],
  [/\p{Script=Hebrew}/u, 'אבגדהוזחטיכלמנסעפצקרשת', true],
  [/\p{Script=Devanagari}/u, 'कखगघचछजझटठडढणतथदधनपफबभमयरलवशसह', false],
  [/\p{Script=Bengali}/u, 'কখগঘচছজঝটঠডঢণতথদধনপফবভমযরলশসহ', false],
  [/\p{Script=Thai}/u, 'กขคงจฉชซญดตถทธนบปผพฟภมยรลวศสหอฮ', false],
  [/\p{Script=Hangul}/u, '가나다라마바사아자차카타파하고노도로모보소오조호구누두루무부수우주후', false],
  [/\p{Script=Hiragana}/u, 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん', false],
  [/\p{Script=Katakana}/u, 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン', false],
  [/\p{Script=Han}/u, '日月水火木金土山川人大小中天地光电气力心手', false],
]

const ROW_LEN = 10

function chunk<V>(arr: V[], size: number): V[][] {
  const out: V[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Keyboard rows for a set of answers. Latin answers get QWERTY plus a row for
 * any other letters they use (ß, ø, ł…). Other scripts get their alphabet,
 * or the answers' letters plus a few same-script fillers, in a stable order.
 * The result is the same on every render (no randomness).
 */
export function keyboardRows(answers: string[]): string[][] {
  const letters: string[] = []
  answers.forEach((a) => letterCells(answerCells(a)).forEach((c) => !letters.includes(c.fold) && letters.push(c.fold)))
  if (!letters.length) return QWERTY.map((r) => r.split(''))
  const latin = letters.filter((l) => /^[a-z]$/.test(l))
  const others = letters.filter((l) => !/^[a-z]$/.test(l))
  const rows: string[][] = []
  if (latin.length || others.every((l) => /\p{Script=Latin}/u.test(l))) {
    rows.push(...QWERTY.map((r) => r.split('')))
    const extraLatin = others.filter((l) => /\p{Script=Latin}/u.test(l)).sort()
    if (extraLatin.length) rows.push(extraLatin)
  }
  const rest = others.filter((l) => !/\p{Script=Latin}/u.test(l))
  POOLS.forEach(([re, pool, full]) => {
    const mine = rest.filter((l) => re.test(l))
    if (!mine.length) return
    const poolLetters = graphemes(pool)
    let keys: string[]
    if (full) {
      keys = [...poolLetters.filter((p) => !/[ґєії]/u.test(p) || mine.includes(p)), ...mine.filter((m) => !poolLetters.includes(m))]
    } else {
      const fillers = poolLetters.filter((p) => !mine.includes(p))
      const want = Math.min(30, Math.max(12, mine.length + 8))
      keys = [...mine, ...fillers.slice(0, Math.max(0, want - mine.length))]
      const order = (g: string) => {
        const i = poolLetters.indexOf(g)
        return i < 0 ? 1000 + (g.codePointAt(0) ?? 0) : i
      }
      keys.sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    }
    rows.push(...chunk(keys, ROW_LEN + 1))
  })
  // Letters from scripts with no pool: one sorted row.
  const unknown = rest.filter((l) => !POOLS.some(([re]) => re.test(l))).sort()
  if (unknown.length) rows.push(...chunk(unknown, ROW_LEN + 1))
  return rows
}
