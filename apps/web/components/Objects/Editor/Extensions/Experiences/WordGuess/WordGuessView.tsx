'use client'
/*
 "Word guess" (node expWordGuess): learners guess a key term from its clue.

 Author: a single-column form (words with answer, clue and an optional
 explanation, guesses per word) with inline hints, and "Preview as learner"
 in the frame header.

 Learner: per word, a grid of guess rows. Type with the on-screen keyboard,
 or with a physical keyboard while the letter board (or a key) has focus;
 typing never leaves the block. Enter checks the row: the tiles flip one by
 one to show each letter's state, always with a shape too (solid with a
 check: in place; outlined with a dot: in the word; recessed: not in the
 word), and the result is announced. A hint reveals one letter in place and
 costs a star. Solve or run out of guesses, read the explanation, move on;
 the end screen lists every word.

 The board is a <button>, so ProseMirror leaves its key presses alone while
 the block is previewed inside the editor.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowRight, Backspace, Check, CheckCircle, Lightbulb, TextAa, Trash, XCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'
import {
  ExperienceFooter,
  ExperienceFrame,
  Stars,
  buzz,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
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
import { AddRowButton, BlockHints, FormSection, ICON_BTN, NotReady, RowHints, contentKey } from '../Sort/kit'

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

// ─── Author form ────────────────────────────────────────────────────────────

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

  return (
    <ExperienceFrame {...frame} title={data.title} onTitleChange={(title) => commit({ title })}>
      <div className="flex flex-col gap-5">
        <BlockHints issues={issues} text={issueText} />

        <FormSection title={t(`${k}words_heading`, 'Words')} hint={t(`${k}words_hint`, 'Learners guess each word from its clue. Spaces and hyphens are shown for free.')}>
          {data.words.map((w, i) => {
            const letters = letterCells(answerCells(w.answer)).length
            return (
              <div key={w.id} className="flex flex-col gap-1.5 rounded-xl bg-neutral-50/80 p-2 ring-1 ring-neutral-100">
                <div className="flex items-center gap-1.5">
                  <CommitInput
                    value={w.answer}
                    onCommit={(answer) => edit((d) => updateWord(d, w.id, { answer }))}
                    placeholder={t(`${k}answer_placeholder`, { n: i + 1, defaultValue: 'Answer {{n}}' })}
                    aria-label={t(`${k}answer_placeholder`, { n: i + 1, defaultValue: 'Answer {{n}}' })}
                    className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1 font-semibold')}
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  {letters > 0 && (
                    <span className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-medium tabular-nums text-neutral-500 ring-1 ring-neutral-200">
                      {t(`${k}letters`, { n: letters, defaultValue: 'Letters: {{n}}' })}
                    </span>
                  )}
                  <button
                    type="button"
                    className={ICON_BTN}
                    disabled={!canRemove}
                    onClick={() => edit((d) => removeWord(d, w.id))}
                    aria-label={t(`${k}remove_word`, 'Remove word')}
                    title={t(`${k}remove_word`, 'Remove word')}
                  >
                    <Trash size={15} aria-hidden />
                  </button>
                </div>
                <CommitInput
                  value={w.clue}
                  onCommit={(clue) => edit((d) => updateWord(d, w.id, { clue }))}
                  placeholder={t(`${k}clue_placeholder`, 'Clue shown to learners')}
                  aria-label={t(`${k}clue_label`, 'Clue')}
                  className={cn(FIELD_CLASS, 'h-9')}
                />
                <CommitInput
                  value={w.explanation ?? ''}
                  onCommit={(explanation) => edit((d) => updateWord(d, w.id, { explanation }))}
                  placeholder={t(`${k}explanation_placeholder`, 'Explanation shown after the word (optional)')}
                  aria-label={t(`${k}explanation_label`, 'Explanation')}
                  className={cn(FIELD_CLASS, 'h-8 text-[12px]')}
                />
                <RowHints issues={issues} id={w.id} text={issueText} />
              </div>
            )
          })}
          <AddRowButton disabled={data.words.length >= WORD_GUESS_LIMITS.maxWords} onClick={() => edit((d) => addWord(d, newId()))}>
            {t(`${k}add_word`, 'Add word')}
          </AddRowButton>
        </FormSection>

        <label className="flex flex-wrap items-center gap-2 text-[13px] text-neutral-700">
          <span>{t(`${k}max_guesses_label`, 'Guesses per word')}</span>
          <input
            type="number"
            min={WORD_GUESS_LIMITS.minGuesses}
            max={WORD_GUESS_LIMITS.maxGuesses}
            value={data.maxGuesses}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= WORD_GUESS_LIMITS.minGuesses && n <= WORD_GUESS_LIMITS.maxGuesses) commit({ maxGuesses: Math.round(n) })
            }}
            className={cn(FIELD_CLASS, 'h-9 w-20 tabular-nums')}
          />
          <span className="text-[12px] text-neutral-400">{t(`${k}max_guesses_hint`, 'Between 3 and 8.')}</span>
        </label>
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

  const renderRow = (r: number) => {
    const scored = r < round.guesses.length
    const isCurrent = !done && r === round.guesses.length
    const guess = scored ? round.guesses[r] : isCurrent ? round.current : null
    let li = -1
    return (
      <span
        // A refused Enter remounts the current row so the shake replays.
        key={isCurrent && shake?.row === r ? `r${r}s${shake.n}` : `r${r}`}
        role="group"
        aria-label={t(`${k}row_label`, { n: r + 1, defaultValue: 'Guess {{n}}' })}
        className={cn('grid justify-center gap-1.5', isCurrent && shake?.row === r && 'lh-exp-shake')}
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
          const shown = fold ? displayLetter(letters[i].fold === fold ? letters[i].char : fold) : ''
          const score = scored ? round.scores[r][i] : null
          const revealed = isCurrent && round.revealed.includes(i)
          if (score) {
            return (
              <span
                key={ci}
                data-score={score}
                aria-label={t(`${k}tile`, { letter: shown, state: stateWord(score), defaultValue: '{{letter}}: {{state}}' })}
                role="img"
                style={{ '--exp-i': i } as React.CSSProperties}
                className={cn('lh-exp-tile lh-exp-flip relative flex aspect-square items-center justify-center rounded-lg font-bold', font)}
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
          return (
            <span
              key={ci}
              aria-hidden
              className={cn(
                'relative flex aspect-square items-center justify-center rounded-lg font-bold',
                font,
                fold ? 'lh-exp-raised lh-exp-snap text-neutral-900' : 'lh-exp-well text-transparent',
                revealed && 'text-sky-700',
                !isCurrent && !fold && 'opacity-70',
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
          <span className="text-[13px] font-medium text-neutral-500">
            {t(`${k}word_of`, { n: index + 1, total: data.words.length, defaultValue: 'Word {{n}} of {{total}}' })}
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
          {Array.from({ length: round.maxGuesses }, (_, r) => renderRow(r))}
        </button>

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

