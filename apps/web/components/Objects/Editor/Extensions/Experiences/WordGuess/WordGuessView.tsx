'use client'
/*
 "Word guess" (node expWordGuess): learners guess a key term from its clue.

 Author: edit in place, one word at a time: the clue card, the answer typed
 straight into a row of solved tiles, and the explanation learners read
 afterwards. Prev / next / "+ Add word"; guesses per word behind the gear.

 Learner: per word, ONE row of tiles (one per letter; spaces and hyphens
 are shown for free). Type with the on-screen keyboard, or with a physical
 keyboard while the letter board (or a key) has focus; typing never leaves
 the block. Enter checks the row: the tiles flip one by one to show each
 letter's state, always with a shape too (solid with a check: in place;
 outlined with a dot: in the word; recessed: not in the word), and the
 result is announced. Then the row resets for the next guess, with letters
 found in place (or revealed by a hint, which costs a star) locked in.
 Earlier guesses sit under the row as small coloured words, newest first;
 dots next to "Word n of N" count the guesses left. Solve or run out of
 guesses, read the explanation, move on; the end screen lists every word.

 The board is a <button>, so ProseMirror leaves its key presses alone while
 the block is previewed inside the editor.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowRight, Backspace, Check, CheckCircle, Lightbulb, TextAa, XCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS, SettingsField } from '../../../Blocks/ui/BlockChrome'
import {
  AnswerKeyHint,
  CardNav,
  EDIT_OBJECT,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  RemoveX,
  SettingsGear,
  Stars,
  buzz,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  usePrefersReducedMotion,
  type CommitPatch,
} from '../shared'
import {
  WORD_GUESS_LIMITS,
  addWord,
  answerCells,
  backspace,
  blockStars,
  canHint,
  displayLetter,
  foldLetter,
  isLetter,
  isRtlText,
  keyStates,
  keyboardRows,
  letterCells,
  lockedSlots,
  newRound,
  normalizeWordGuess,
  playableWordGuess,
  removeWord,
  revealHint,
  rowComplete,
  submitGuess,
  typeLetter,
  updateWord,
  validateWordGuess,
  type Cell,
  type LetterScore,
  type WordGuessData,
  type WordRound,
} from './wordGuessModel'
import { InlineHint, NotReady, contentKey } from '../Sort/kit'

const TONE = 'link' as const

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

export default function WordGuessView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeWordGuess(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <TextAa weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.word_guess.title', 'Word guess'),
  }
  const playable = React.useMemo(() => playableWordGuess(data), [data])
  return (
    <NodeViewWrapper className="block-exp-word-guess">
      {editable && !preview ? (
        <WordGuessEditor data={data} commit={commit} frame={frame} />
      ) : (
        <WordGuessPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author: edit in place ──────────────────────────────────────────────────
// One word at a time, as learners see it: the clue card, then the letter
// board whose first row holds the answer as solved tiles (type straight into
// it), and the explanation learners read afterwards. Prev / next and "+ Add
// word" move through the words; guesses per word live behind the gear.

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_words: 'Add at least one word.',
  too_many_words: 'Use at most 8 words; learners only see the first 8.',
  empty_answer: 'Type the answer, or remove this word.',
  empty_clue: 'Add a clue so learners know what to guess.',
  bad_characters: 'Use letters only. Spaces and hyphens are fine; digits and other signs are not.',
  too_short: 'Use at least 2 letters.',
  too_long: 'Use at most 12 letters so the tiles fit on a phone.',
  duplicate_answer: 'Another word has the same answer.',
}

/** The answer as a row of solved tiles; an input over the row takes the typing. */
function AnswerTiles({ value, onCommit, ariaLabel, placeholder }: { value: string; onCommit: (_v: string) => void; ariaLabel: string; placeholder: string }) {
  const [draft, setDraft] = React.useState(value)
  const [focused, setFocused] = React.useState(false)
  // Follow remote changes while the field isn't being edited (adjusted during render).
  const [seen, setSeen] = React.useState(value)
  if (!focused && seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  const cells = answerCells(draft)
  const letters = letterCells(cells)
  const rtl = isRtlText(draft)
  const font = tileFont(Math.max(letters.length, 5))
  const shown = cells.length ? cells : null
  const gridCols = (shown ?? [0, 1, 2, 3, 4].map(() => ({ kind: 'letter' }) as Cell)).map((c) => (c.kind === 'letter' ? 'minmax(0, 3rem)' : 'minmax(0, 0.85rem)')).join(' ')
  return (
    <span className={cn('relative grid justify-center gap-1.5 rounded-lg', focused && 'ring-2 ring-sky-500/40 ring-offset-4 ring-offset-[var(--exp-paper,#fff)]')} style={{ gridTemplateColumns: gridCols }} dir={rtl ? 'rtl' : 'ltr'}>
      {shown
        ? shown.map((c, ci) =>
            c.kind === 'fixed' ? (
              <span key={ci} aria-hidden className="flex items-center justify-center text-neutral-400">
                {c.char === '-' ? <span className="h-0.5 w-2.5 rounded-full bg-current" /> : null}
              </span>
            ) : (
              <span key={ci} aria-hidden data-score="hit" className={cn('lh-exp-tile relative flex aspect-square items-center justify-center rounded-lg font-bold', font)}>
                {displayLetter(c.char)}
              </span>
            ),
          )
        : [0, 1, 2, 3, 4].map((i) => (
            <span key={i} aria-hidden className={cn('lh-exp-well flex aspect-square items-center justify-center rounded-lg font-bold text-neutral-300', font)}>
              ·
            </span>
          ))}
      <input
        type="text"
        value={draft}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
        dir="auto"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          if (draft !== value) onCommit(draft)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setDraft(value)
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
          }
        }}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none selection:bg-transparent"
      />
    </span>
  )
}

function WordGuessEditor({ data, commit, frame }: { data: WordGuessData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const k = 'editor.experiences.word_guess.'
  const issues = React.useMemo(() => validateWordGuess(data), [data])
  const edit = (fn: (_d: WordGuessData) => WordGuessData) =>
    commit((live) => {
      const next = fn(normalizeWordGuess(live))
      return { words: next.words }
    })
  const issueText = (code: string) => t(`${k}issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const canRemove = data.words.length > WORD_GUESS_LIMITS.minWords
  const [index, setIndex] = React.useState(0)
  const [live, setLive] = React.useState('')
  const count = data.words.length
  const i = Math.min(index, Math.max(0, count - 1))
  const w = data.words[i]
  const rootRef = React.useRef<HTMLDivElement>(null)
  const focusLater = (sel: string) => requestAnimationFrame(() => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(sel)?.focus()))
  const wordOf = (n: number) => t('activities.experiences.word_guess.word_of', { n, total: count, defaultValue: 'Word {{n}} of {{total}}' })

  const go = (n: number) => {
    const next = Math.max(0, Math.min(count - 1, n))
    setIndex(next)
    setLive(wordOf(next + 1))
  }
  const add = () => {
    edit((d) => addWord(d, newId()))
    setIndex(count)
    focusLater('[data-clue] textarea')
  }
  const remove = () => {
    if (!w) return
    edit((d) => removeWord(d, w.id))
    setIndex(data.words[i + 1] ? i : Math.max(0, i - 1))
  }

  const settings = (
    <SettingsGear>
      <SettingsField label={t(`${k}max_guesses_label`, 'Guesses per word')} hint={t(`${k}max_guesses_hint`, 'Between 3 and 8.')}>
        <CommitInput
          type="number"
          inputMode="numeric"
          min={WORD_GUESS_LIMITS.minGuesses}
          max={WORD_GUESS_LIMITS.maxGuesses}
          value={String(data.maxGuesses)}
          onCommit={(v) => {
            const n = Math.round(Number(v))
            if (Number.isFinite(n)) commit({ maxGuesses: Math.max(WORD_GUESS_LIMITS.minGuesses, Math.min(WORD_GUESS_LIMITS.maxGuesses, n)) })
          }}
          className={cn(FIELD_CLASS, 'tabular-nums')}
        />
      </SettingsField>
    </SettingsGear>
  )

  const blockIssues = issues.filter((x) => !x.id)
  const wordIssues = w ? issues.filter((x) => x.id === w.id) : []
  const answerText = w ? answerCells(w.answer).map((c) => (c.kind === 'letter' ? displayLetter(c.char) : c.char)).join('') : ''

  return (
    <ExperienceFrame {...frame} wysiwyg title={data.title} onTitleChange={(title) => commit({ title })} headerEnd={settings} footer={<AnswerKeyHint />} live={live}>
      <div ref={rootRef} className="flex flex-col gap-4">
        {blockIssues.map((x) => (
          <InlineHint key={x.code} severity={x.severity}>
            {issueText(x.code)}
          </InlineHint>
        ))}
        {w ? (
          <div className={cn('relative flex flex-col gap-4', EDIT_OBJECT)}>
            <span className="text-[13px] font-medium text-neutral-500">{wordOf(i + 1)}</span>
            <div data-clue="" className="lh-exp-raised flex items-start gap-2.5 rounded-xl px-3.5 py-3">
              <span className="mt-px shrink-0 text-[12px] font-semibold text-sky-700">{t('activities.experiences.word_guess.clue', 'Clue')}</span>
              <InlineText
                value={w.clue}
                onCommit={(clue) => edit((d) => updateWord(d, w.id, { clue }))}
                ariaLabel={t(`${k}clue_label`, 'Clue')}
                placeholder={t(`${k}clue_placeholder`, 'Clue shown to learners')}
                maxLength={200}
                className="min-w-0 flex-1 text-[15px] leading-snug font-medium text-neutral-900 [overflow-wrap:anywhere]"
              />
            </div>

            <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-1.5 p-1">
              <AnswerTiles
                key={w.id}
                value={w.answer}
                onCommit={(answer) => edit((d) => updateWord(d, w.id, { answer }))}
                ariaLabel={t(`${k}answer_placeholder`, { n: i + 1, defaultValue: 'Answer {{n}}' })}
                placeholder={t(`${k}answer_placeholder`, { n: i + 1, defaultValue: 'Answer {{n}}' })}
              />
              <span className="pt-1 text-center text-[12px] text-neutral-400">
                {t(`${k}type_answer`, 'Click the tiles and type the answer.')}{' '}
                {letterCells(answerCells(w.answer)).length > 0 && t(`${k}letters`, { n: letterCells(answerCells(w.answer)).length, defaultValue: 'Letters: {{n}}' })}
              </span>
            </div>

            <div className="flex flex-col gap-1 rounded-xl bg-emerald-50/80 px-3.5 py-3">
              <p className="m-0 text-[14px] text-neutral-800">{t('activities.experiences.word_guess.answer_was', { answer: answerText || '…', defaultValue: 'The word: {{answer}}' })}</p>
              <InlineText
                multiline
                value={w.explanation ?? ''}
                onCommit={(explanation) => edit((d) => updateWord(d, w.id, { explanation }))}
                ariaLabel={t(`${k}explanation_label`, 'Explanation')}
                placeholder={t(`${k}explanation_placeholder`, 'Explanation shown after the word (optional)')}
                maxLength={400}
                className="text-[13px] leading-relaxed text-neutral-600 [overflow-wrap:anywhere]"
              />
            </div>
            <RemoveX floating disabled={!canRemove} onClick={remove} label={t(`${k}remove_word`, 'Remove word')} className="-top-1 -end-1" />
          </div>
        ) : null}
        {wordIssues.map((x) => (
          <InlineHint key={x.code} severity={x.severity}>
            {issueText(x.code)}
          </InlineHint>
        ))}
        <CardNav
          count={count}
          index={i}
          onGo={go}
          onAdd={add}
          canAdd={count < WORD_GUESS_LIMITS.maxWords}
          addLabel={t(`${k}add_word`, 'Add word')}
          itemLabel={wordOf}
          flagged={(n) => issues.some((x) => x.id === data.words[n]?.id)}
          prevLabel={t(`${k}prev_word`, 'Previous word')}
          nextLabel={t(`${k}next_word`, 'Next word')}
        />
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner ────────────────────────────────────────────────────────────────

type WordResult = { solved: boolean; hints: number; guesses: number }

function tileFont(n: number) {
  if (n <= 6) return 'text-[20px] sm:text-[22px]'
  if (n <= 9) return 'text-[16px] sm:text-[19px]'
  return 'text-[13px] sm:text-[16px]'
}

function WordGuessPlayer({ data, frame, source }: { data: WordGuessData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const k = 'activities.experiences.word_guess.'
  const memory = useExperienceMemory(data.blockId, source)
  const [index, setIndex] = React.useState(0)
  const [round, setRound] = React.useState<WordRound | null>(() => (data.words[0] ? newRound(data.words[0].answer, data.maxGuesses) : null))
  const [results, setResults] = React.useState<WordResult[]>([])
  const [phase, setPhase] = React.useState<'play' | 'end'>('play')
  const [live, setLive] = React.useState('')
  const [shake, setShake] = React.useState<{ row: number; n: number } | null>(null)
  // The guess whose tiles are flipping in the row (then the row resets for the next guess).
  const [flash, setFlash] = React.useState<number | null>(null)
  const reduced = usePrefersReducedMotion()
  const flashTimer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(flashTimer.current), [])
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const boardRef = React.useRef<HTMLButtonElement>(null)
  const nextRef = React.useRef<HTMLButtonElement>(null)

  const rows = React.useMemo(() => keyboardRows(data.words.map((w) => w.answer)), [data])
  const keySet = React.useMemo(() => new Set(rows.flat()), [rows])

  if (!data.words.length || !round) {
    return (
      <ExperienceFrame {...frame} title={data.title}>
        <NotReady>{t(`${k}not_ready`, 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const word = data.words[index]
  const cells = answerCells(word.answer)
  const letters = letterCells(cells)
  const done = round.status !== 'playing'
  const rtl = isRtlText(word.answer)
  const states = keyStates(round.guesses, round.scores)
  const stateWord = (s: LetterScore) =>
    s === 'hit' ? t(`${k}legend_hit`, 'In place') : s === 'near' ? t(`${k}legend_near`, 'In the word') : t(`${k}legend_miss`, 'Not in the word')
  const answerText = letters.length ? cells.map((c) => (c.kind === 'letter' ? displayLetter(c.char) : c.char)).join('') : word.answer

  const finishWord = (next: WordRound) => {
    const solved = next.status === 'solved'
    setResults((r) => [...r, { solved, hints: next.revealed.length, guesses: next.guesses.length }])
    buzz(solved ? 'correct' : 'wrong')
    window.setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 60)
  }

  const type = (letter: string) => {
    if (done) return
    if (flash !== null) setFlash(null)
    setRound((r) => (r ? typeLetter(r, letter) : r))
  }
  const erase = () => !done && setRound((r) => (r ? backspace(r) : r))
  const enter = () => {
    if (done) return
    if (!rowComplete(round)) {
      setShake((s) => ({ row: round.guesses.length, n: (s?.n ?? 0) + 1 }))
      setLive(t(`${k}incomplete`, 'Fill in every letter first.'))
      return
    }
    const { round: next } = submitGuess(round)
    const score = next.scores[next.scores.length - 1]
    const guess = next.guesses[next.guesses.length - 1]
    const parts = guess.map((g, i) => {
      const letter = displayLetter(letters[i] && letters[i].fold === g ? letters[i].char : g)
      return score[i] === 'hit'
        ? t(`${k}live_hit`, { letter, defaultValue: '{{letter}} in place' })
        : score[i] === 'near'
          ? t(`${k}live_near`, { letter, defaultValue: '{{letter}} in the word' })
          : t(`${k}live_miss`, { letter, defaultValue: '{{letter}} not in the word' })
    })
    let message = t(`${k}live_guess`, { n: next.guesses.length, feedback: parts.join(', '), defaultValue: 'Guess {{n}}: {{feedback}}.' })
    if (next.status === 'solved') message += ` ${t(`${k}live_solved`, { answer: answerText, defaultValue: 'Solved! The word is {{answer}}.' })}`
    if (next.status === 'failed') message += ` ${t(`${k}live_failed`, { answer: answerText, defaultValue: 'Out of guesses. The word was {{answer}}.' })}`
    setLive(message)
    setShake(null)
    setRound(next)
    window.clearTimeout(flashTimer.current)
    if (next.status === 'playing') {
      setFlash(next.guesses.length - 1)
      flashTimer.current = window.setTimeout(() => setFlash(null), (reduced ? 700 : 900) + letters.length * 90)
    } else setFlash(null)
    if (next.status !== 'playing') finishWord(next)
  }
  const hint = () => {
    if (!canHint(round)) return
    const next = revealHint(round)
    const at = next.revealed.find((i) => !round.revealed.includes(i)) ?? 0
    setRound(next)
    setLive(t(`${k}live_hint`, { n: at + 1, letter: displayLetter(letters[at]?.char ?? ''), defaultValue: 'Hint: letter {{n}} is {{letter}}.' }))
    boardRef.current?.focus({ preventScroll: true })
  }

  const goNext = () => {
    if (index + 1 >= data.words.length) {
      const all = results
      const stars = blockStars(all)
      if (stars > best) {
        setBest(stars)
        memory.write('best', stars)
      }
      setPhase('end')
      setLive(t(`${k}results`, { solved: all.filter((r) => r.solved).length, total: all.length, defaultValue: '{{solved}} of {{total}} solved' }))
      return
    }
    const i = index + 1
    setIndex(i)
    setRound(newRound(data.words[i].answer, data.maxGuesses))
    setLive(t(`${k}word_of`, { n: i + 1, total: data.words.length, defaultValue: 'Word {{n}} of {{total}}' }))
    window.setTimeout(() => boardRef.current?.focus({ preventScroll: true }), 30)
  }

  const reset = () => {
    setIndex(0)
    setRound(newRound(data.words[0].answer, data.maxGuesses))
    setResults([])
    setPhase('play')
    setLive('')
  }

  // Physical keyboard: only while focus is inside the block (board or a key).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (phase !== 'play' || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
    const target = e.target as HTMLElement
    const onKey = target !== boardRef.current && target.tagName === 'BUTTON'
    if (e.key === 'Enter') {
      if (onKey) return // a focused on-screen key or button clicks itself
      e.preventDefault()
      e.stopPropagation()
      enter()
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      erase()
    } else if ([...e.key].length === 1 && isLetter(e.key)) {
      const fold = foldLetter(e.key)
      if (!keySet.has(fold) && !/^\p{L}$/u.test(fold)) return
      e.preventDefault()
      e.stopPropagation()
      type(fold)
    }
  }

  const footer = (
    <ExperienceFooter
      progress={phase === 'end' ? undefined : { done: results.length, total: data.words.length }}
      stars={phase === 'end' ? blockStars(results) : undefined}
      score={phase === 'end' ? `${results.filter((r) => r.solved).length} / ${data.words.length}` : undefined}
      onRetry={phase === 'end' || results.length > 0 || round.guesses.length > 0 ? reset : undefined}
    >
      {phase !== 'end' && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t(`${k}best`, 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  if (phase === 'end') {
    const stars = blockStars(results)
    return (
      <ExperienceFrame {...frame} title={data.title} footer={footer} celebrate={stars === 3} live={live}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="m-0 text-[15px] font-semibold text-neutral-900">{t(`${k}results_title`, 'Your words')}</h4>
            <span className="text-[13px] text-neutral-500">
              {t(`${k}results`, { solved: results.filter((r) => r.solved).length, total: results.length, defaultValue: '{{solved}} of {{total}} solved' })}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.words.map((w, i) => {
              const r = results[i]
              const ok = !!r?.solved
              const Icon = ok ? CheckCircle : XCircle
              return (
                <li key={w.id} style={{ '--exp-i': i } as React.CSSProperties} className="lh-exp-raised lh-exp-reveal-in flex items-start gap-3 rounded-xl px-3 py-2.5">
                  <Icon size={18} weight="fill" aria-hidden className={cn('mt-0.5 shrink-0', ok ? 'text-emerald-600' : 'text-rose-500')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[15px] font-semibold tracking-wide text-neutral-900" dir="auto">
                        {answerCells(w.answer).map((c) => (c.kind === 'letter' ? displayLetter(c.char) : c.char)).join('')}
                      </span>
                      <span className="sr-only">{ok ? t(`${k}solved_mark`, 'Solved') : t(`${k}missed_mark`, 'Not solved')}</span>
                      {r && r.hints > 0 && (
                        <span className="text-[12px] text-neutral-400">{t(`${k}hints_used`, { n: r.hints, defaultValue: 'Hints used: {{n}}' })}</span>
                      )}
                    </div>
                    {w.clue && <p className="m-0 text-[13px] leading-snug text-neutral-600 [overflow-wrap:anywhere]">{w.clue}</p>}
                    {w.explanation && <p className="m-0 mt-1 text-[13px] leading-snug text-neutral-500 [overflow-wrap:anywhere]">{w.explanation}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
          <div>
            <button type="button" onClick={reset} className="lh-exp-key">
              {t(`${k}play_again`, 'Play again')}
            </button>
          </div>
        </div>
      </ExperienceFrame>
    )
  }

  const gridCols = cells.map((c) => (c.kind === 'letter' ? 'minmax(0, 3rem)' : 'minmax(0, 0.85rem)')).join(' ')
  const font = tileFont(letters.length)
  const locked = lockedSlots(round)
  // The row shows the guess just scored (its flip), or the last one once the word is over; else the typing row.
  const shownGuess = done ? round.guesses.length - 1 : flash
  const shownLetter = (fold: string, i: number) => (fold ? displayLetter(letters[i] && letters[i].fold === fold ? letters[i].char : fold) : '')
  const guessWord = (g: readonly string[]) => g.map((f, i) => shownLetter(f, i)).join('')

  /** The single row of tiles: the guess being typed, or a scored guess flipping. */
  const renderRow = () => {
    const scored = shownGuess !== null && shownGuess >= 0
    const guess = scored ? round.guesses[shownGuess] : round.current
    const firstEmpty = scored ? -1 : round.current.findIndex((c, i) => !c && !locked.includes(i))
    let li = -1
    return (
      <span
        // A refused Enter remounts the row so the shake replays; each scored guess remounts so the flip plays.
        key={scored ? `g${shownGuess}` : shake ? `t${round.guesses.length}s${shake.n}` : `t${round.guesses.length}`}
        role="group"
        aria-label={scored ? t(`${k}row_label`, { n: shownGuess + 1, defaultValue: 'Guess {{n}}' }) : t(`${k}typing_row`, 'Your guess')}
        className={cn('grid justify-center gap-1.5', !scored && shake && 'lh-exp-shake')}
        style={{ gridTemplateColumns: gridCols }}
      >
        {cells.map((c: Cell, ci) => {
          if (c.kind === 'fixed') {
            return (
              <span key={ci} aria-hidden className="flex items-center justify-center text-neutral-400">
                {c.char === '-' ? <span className="h-0.5 w-2.5 rounded-full bg-current" /> : null}
              </span>
            )
          }
          li++
          const i = li
          const fold = guess?.[i] ?? ''
          const shown = shownLetter(fold, i)
          const score = scored ? round.scores[shownGuess][i] : locked.includes(i) && !round.revealed.includes(i) ? 'hit' : null
          if (score) {
            return (
              <span
                key={ci}
                data-score={score}
                aria-label={t(`${k}tile`, { letter: shown, state: stateWord(score), defaultValue: '{{letter}}: {{state}}' })}
                role="img"
                style={{ '--exp-i': i } as React.CSSProperties}
                className={cn('lh-exp-tile relative flex aspect-square items-center justify-center rounded-lg font-bold', scored && 'lh-exp-flip', font)}
              >
                <span aria-hidden>{shown}</span>
                {score === 'hit' && (
                  <span aria-hidden className={cn('lh-exp-flip-mark absolute end-0.5 top-0.5 h-3.5 w-3.5 items-center justify-center rounded-full bg-white/90 text-emerald-600', letters.length <= 8 ? 'flex' : 'hidden sm:flex')}>
                    <Check size={9} weight="bold" />
                  </span>
                )}
                {score === 'near' && <span aria-hidden className="lh-exp-flip-mark absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-amber-500" />}
              </span>
            )
          }
          const revealed = round.revealed.includes(i)
          return (
            <span
              key={ci}
              aria-hidden
              className={cn(
                'relative flex aspect-square items-center justify-center rounded-lg font-bold',
                font,
                fold ? 'lh-exp-raised lh-exp-snap text-neutral-900' : 'lh-exp-well text-transparent',
                revealed && 'text-sky-700',
                i === firstEmpty && 'shadow-[inset_0_0_0_2px_rgba(14,165,233,0.45)]',
              )}
            >
              {shown || '·'}
              {revealed && <Lightbulb size={10} weight="fill" className="absolute end-0.5 top-0.5 text-sky-500" />}
            </span>
          )
        })}
      </span>
    )
  }

  /** Earlier guesses, newest first: small words with coloured letters (and the same marks). */
  const history = round.guesses
    .map((g, r) => ({ g, r }))
    .filter(({ r }) => r !== shownGuess)
    .reverse()
  const historyChip = ({ g, r }: { g: string[]; r: number }) => (
    <li
      key={r}
      role="img"
      aria-label={t(`${k}history_item`, {
        n: r + 1,
        word: guessWord(g),
        feedback: g.map((f, i) => `${shownLetter(f, i)}: ${stateWord(round.scores[r][i])}`).join(', '),
        defaultValue: 'Guess {{n}}: {{word}} ({{feedback}})',
      })}
      className="lh-exp-raised inline-flex items-center gap-0.5 rounded-lg p-1"
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {g.map((f, i) => {
        const s = round.scores[r][i]
        return (
          <span key={i} aria-hidden data-score={s} className="lh-exp-tile relative inline-flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-bold">
            {shownLetter(f, i)}
            {s === 'near' && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-500" />}
            {s === 'hit' && <span className="absolute -end-0.5 -top-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-white text-emerald-600 shadow-[0_0_0_1px_rgba(5,150,105,0.4)]"><Check size={6} weight="bold" /></span>}
          </span>
        )
      })}
    </li>
  )
  const guessesLeft = round.maxGuesses - round.guesses.length

  const keyClass = (s?: LetterScore) =>
    cn(
      'lh-exp-raised lh-exp-press relative inline-flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg px-0.5 text-[15px] font-semibold outline-none select-none',
      s === 'hit' && 'lh-exp-key-hit',
      s === 'near' && 'lh-exp-key-near',
      s === 'miss' && 'lh-exp-key-miss',
      !s && 'text-neutral-800',
    )

  const typedSoFar = round.current.filter(Boolean).length
  const solvedNow = round.status === 'solved'

  return (
    <ExperienceFrame {...frame} title={data.title} footer={footer} live={live}>
      <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2.5 text-[13px] font-medium text-neutral-500">
            {t(`${k}word_of`, { n: index + 1, total: data.words.length, defaultValue: 'Word {{n}} of {{total}}' })}
            <span role="img" aria-label={t(`${k}guesses_left`, { n: guessesLeft, defaultValue: 'Guesses left: {{n}}' })} className="inline-flex items-center gap-1">
              {Array.from({ length: round.maxGuesses }, (_, i) => (
                <span key={i} aria-hidden className={cn('h-2 w-2 rounded-full', i < guessesLeft ? 'bg-sky-500' : 'lh-exp-well')} />
              ))}
            </span>
          </span>
          {!done && (
            <button
              type="button"
              onClick={hint}
              disabled={!canHint(round)}
              title={t(`${k}hint_cost`, 'Costs a star')}
              className="lh-exp-raised lh-exp-press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Lightbulb size={14} weight="duotone" className="text-amber-500" aria-hidden />
              {t(`${k}hint`, 'Reveal a letter')}
              <span className="text-[12px] font-normal text-neutral-400">{t(`${k}hint_cost`, 'Costs a star')}</span>
            </button>
          )}
        </div>

        {word.clue && (
          <div className="lh-exp-raised flex items-start gap-2.5 rounded-xl px-3.5 py-3">
            <span className="mt-px shrink-0 text-[12px] font-semibold text-sky-700">{t(`${k}clue`, 'Clue')}</span>
            <p className="m-0 min-w-0 text-[15px] leading-snug font-medium text-neutral-900 [overflow-wrap:anywhere]">{word.clue}</p>
          </div>
        )}

        <button
          ref={boardRef}
          type="button"
          dir={rtl ? 'rtl' : 'ltr'}
          aria-label={t(`${k}board_label`, 'Letter board. Type your guess and press Enter.')}
          onClick={() => boardRef.current?.focus()}
          className="mx-auto flex w-full max-w-[26rem] cursor-text flex-col gap-1.5 rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          {renderRow()}
        </button>
        {history.length > 0 && (
          <ol aria-label={t(`${k}history_label`, 'Earlier guesses')} className="m-0 -mt-1 flex list-none flex-wrap justify-center gap-1.5 p-0">
            {history.map(historyChip)}
          </ol>
        )}

        {done ? (
          <div className={cn('lh-exp-slide-in flex flex-col gap-2 rounded-xl px-3.5 py-3', solvedNow ? 'bg-emerald-50/80' : 'bg-rose-50/70')}>
            <p className={cn('m-0 flex items-center gap-2 text-[14px] font-semibold', solvedNow ? 'text-emerald-800' : 'text-rose-800')}>
              {solvedNow ? <CheckCircle size={17} weight="fill" aria-hidden /> : <XCircle size={17} weight="fill" aria-hidden />}
              {solvedNow
                ? t(`${k}solved`, { n: round.guesses.length, max: round.maxGuesses, defaultValue: 'Solved in {{n}} of {{max}} guesses' })
                : t(`${k}failed`, 'Out of guesses')}
            </p>
            <p className="m-0 text-[14px] text-neutral-800">
              {t(`${k}answer_was`, { answer: answerText, defaultValue: 'The word: {{answer}}' })}
            </p>
            {word.explanation && <p className="m-0 text-[13px] leading-relaxed text-neutral-600 [overflow-wrap:anywhere]">{word.explanation}</p>}
            <div className="pt-1">
              <button ref={nextRef} type="button" onClick={goNext} className="lh-exp-key">
                {index + 1 >= data.words.length ? t(`${k}see_results`, 'See results') : t(`${k}next_word`, 'Next word')}
                <ArrowRight size={14} weight="bold" aria-hidden className="rtl:rotate-180" />
              </button>
            </div>
          </div>
        ) : (
          <div role="group" aria-label={t(`${k}keyboard_label`, 'Keyboard')} className="mx-auto flex w-full max-w-[30rem] flex-col gap-1.5" dir={rtl ? 'rtl' : 'ltr'}>
            {rows.map((row, ri) => {
              const last = ri === rows.length - 1
              return (
                <div key={ri} className="flex justify-center gap-1">
                  {last && (
                    <button type="button" onClick={enter} disabled={typedSoFar === 0} className="lh-exp-key h-11 min-w-0 flex-[1.6] px-1 text-[13px]">
                      {t(`${k}enter`, 'Enter')}
                    </button>
                  )}
                  {row.map((key) => {
                    const s = states[key]
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => type(key)}
                        aria-label={s ? `${displayLetter(key)}, ${stateWord(s)}` : displayLetter(key)}
                        className={cn(keyClass(s), 'max-w-[2.6rem]')}
                      >
                        {displayLetter(key)}
                        {s === 'near' && <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-500" />}
                      </button>
                    )
                  })}
                  {last && (
                    <button
                      type="button"
                      onClick={erase}
                      aria-label={t(`${k}backspace`, 'Delete letter')}
                      title={t(`${k}backspace`, 'Delete letter')}
                      className="lh-exp-raised lh-exp-press inline-flex h-11 min-w-0 flex-[1.6] items-center justify-center rounded-lg text-neutral-700"
                    >
                      <Backspace size={18} aria-hidden className="rtl:-scale-x-100" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-4 gap-y-1 p-0 text-[12px] text-neutral-500" aria-hidden>
          {(['hit', 'near', 'miss'] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span data-score={s} className="lh-exp-tile relative inline-flex h-4 w-4 items-center justify-center rounded">
                {s === 'hit' && <Check size={9} weight="bold" />}
                {s === 'near' && <span className="h-1 w-1 rounded-full bg-amber-500" />}
              </span>
              {stateWord(s)}
            </li>
          ))}
        </ul>
      </div>
    </ExperienceFrame>
  )
}

