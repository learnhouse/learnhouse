'use client'
/*
 "Match pairs" (node expMatch).

 Author: a list of pairs (item ↔ its match, stacked on phones), the game mode
 (connect / memory), inline hints, and "Preview as learner" in the frame
 header.

 Learner, connect: two columns. Tap an item, then its match (either side
 first), or drag one card onto the other. Correct pairs lock in with a shared
 colour, a number and a check icon; wrong ones shake and count as a mistake.
 Keyboard: arrow keys move within a column, left / right jump to the other
 column, Enter / Space picks.

 Learner, memory: a grid of face-down cards; flip two at a time to find the
 pairs. Moves are counted and the best (fewest) is remembered per block.
 Arrow keys move around the grid.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowsLeftRight, Check, LinkSimple, Question, Trash, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS, Segmented } from '../../../Blocks/ui/BlockChrome'
import {
  ExperienceFooter,
  ExperienceFrame,
  Stars,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  MATCH_LIMITS,
  addPair,
  betterMoves,
  closeMiss,
  connectDone,
  connectStars,
  emptyConnect,
  emptyMemory,
  flipCard,
  isPlayable,
  memoryDeck,
  memoryDone,
  memoryStars,
  normalizeMatch,
  playableMatch,
  removePair,
  shuffleIds,
  tryConnect,
  updatePair,
  validateMatch,
  type ConnectState,
  type MatchData,
  type MatchMode,
  type MemoryCard,
  type MemoryState,
} from './matchModel'
import { AddRowButton, BlockHints, DragGhost, FormSection, ICON_BTN, NotReady, ResultIcon, RowHints, contentKey } from '../Sort/kit'
import { focusSibling, useTapDrag } from '../Sort/useTapDrag'

const TONE = 'media' as const
const MISS_MS = 900
const SHAKE_MS = 450

/** Colours for locked pairs, in match order (each also gets a number and a check). */
const PAIR_CLASS = [
  'bg-emerald-50 text-emerald-900 ring-emerald-300',
  'bg-sky-50 text-sky-900 ring-sky-300',
  'bg-amber-50 text-amber-900 ring-amber-300',
  'bg-teal-50 text-teal-900 ring-teal-300',
  'bg-lime-50 text-lime-900 ring-lime-300',
  'bg-cyan-50 text-cyan-900 ring-cyan-300',
  'bg-orange-50 text-orange-900 ring-orange-300',
  'bg-indigo-50 text-indigo-900 ring-indigo-300',
]

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

export default function MatchView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeMatch(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <LinkSimple weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.match.title', 'Match pairs'),
  }
  const playable = React.useMemo(() => playableMatch(data), [data])
  let body: React.ReactNode
  if (editable && !preview) body = <MatchEditor data={data} commit={commit} frame={frame} />
  else if (!isPlayable(playable))
    body = (
      <ExperienceFrame {...frame} title={data.title} instructions={data.instructions}>
        <NotReady>{t('activities.experiences.match.not_ready', 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  else if (playable.mode === 'memory') body = <MemoryPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
  else body = <ConnectPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
  return <NodeViewWrapper className="block-exp-match">{body}</NodeViewWrapper>
}

// ─── Author form ────────────────────────────────────────────────────────────

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_pairs: 'Add at least 2 pairs.',
  too_many_pairs: 'Use at most 8 pairs; learners only see the first 8.',
  empty_left: 'The item is empty; learners will not see this pair.',
  empty_right: 'The match is empty; learners will not see this pair.',
  duplicate_left: 'Another pair starts with the same item.',
  duplicate_pair: 'This pair appears twice.',
}

function MatchEditor({ data, commit, frame }: { data: MatchData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const issues = React.useMemo(() => validateMatch(data), [data])
  const issueText = (code: string) => t(`editor.experiences.match.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const edit = (fn: (_d: MatchData) => MatchData) => commit((live) => ({ pairs: fn(normalizeMatch(live)).pairs }))
  const canRemove = data.pairs.length > MATCH_LIMITS.minPairs

  return (
    <ExperienceFrame
      {...frame}
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      instructions={data.instructions}
      onInstructionsChange={(instructions) => commit({ instructions })}
    >
      <div className="flex flex-col gap-5">
        <BlockHints issues={issues} text={issueText} />

        <FormSection title={t('editor.experiences.match.mode_label', 'Game')}>
          <Segmented<MatchMode>
            value={data.mode}
            onChange={(mode) => commit({ mode })}
            ariaLabel={t('editor.experiences.match.mode_label', 'Game')}
            options={[
              { value: 'connect', label: t('editor.experiences.match.mode_connect', 'Connect') },
              { value: 'memory', label: t('editor.experiences.match.mode_memory', 'Memory') },
            ]}
          />
          <p className="m-0 text-[12px] leading-snug text-neutral-400">
            {data.mode === 'memory'
              ? t('editor.experiences.match.mode_memory_hint', 'Face-down cards: learners flip two at a time to find the pairs.')
              : t('editor.experiences.match.mode_connect_hint', 'Two columns: learners tap an item, then its match.')}
          </p>
        </FormSection>

        <FormSection title={t('editor.experiences.match.pairs_heading', 'Pairs')}>
          {data.pairs.map((p, i) => (
            <div key={p.id} className="flex flex-col gap-1 rounded-xl bg-neutral-50/80 p-2 ring-1 ring-neutral-100">
              <div className="flex items-start gap-1.5 sm:items-center">
                <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <CommitInput
                    value={p.left}
                    onCommit={(left) => edit((d) => updatePair(d, p.id, { left }))}
                    placeholder={t('editor.experiences.match.left_placeholder', 'Item')}
                    aria-label={t('editor.experiences.match.left_label', { n: i + 1, defaultValue: 'Pair {{n}}: item' })}
                    className={cn(FIELD_CLASS, 'h-9')}
                  />
                  <ArrowsLeftRight size={14} aria-hidden className="mx-auto hidden text-neutral-300 sm:block" />
                  <CommitInput
                    value={p.right}
                    onCommit={(right) => edit((d) => updatePair(d, p.id, { right }))}
                    placeholder={t('editor.experiences.match.right_placeholder', 'Its match')}
                    aria-label={t('editor.experiences.match.right_label', { n: i + 1, defaultValue: 'Pair {{n}}: match' })}
                    className={cn(FIELD_CLASS, 'h-9')}
                  />
                </div>
                <button
                  type="button"
                  className={ICON_BTN}
                  disabled={!canRemove}
                  onClick={() => edit((d) => removePair(d, p.id))}
                  aria-label={t('editor.experiences.match.remove_pair', 'Remove pair')}
                  title={t('editor.experiences.match.remove_pair', 'Remove pair')}
                >
                  <Trash size={15} aria-hidden />
                </button>
              </div>
              <RowHints issues={issues} id={p.id} text={issueText} />
            </div>
          ))}
          <AddRowButton disabled={data.pairs.length >= MATCH_LIMITS.maxPairs} onClick={() => edit((d) => addPair(d, newId()))}>
            {t('editor.experiences.match.add_pair', 'Add pair')}
          </AddRowButton>
        </FormSection>
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner: connect ───────────────────────────────────────────────────────

type Side = 'l' | 'r'

function ConnectPlayer({ data, frame, source }: { data: MatchData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const memory = useExperienceMemory(data.blockId, source)
  const leftIds = React.useMemo(() => data.pairs.map((p) => p.id), [data])
  const [rightIds, setRightIds] = React.useState(() => shuffleIds(leftIds))
  const [state, setState] = React.useState<ConnectState>(emptyConnect)
  const [selected, setSelected] = React.useState<{ side: Side; id: string } | null>(null)
  const [shake, setShake] = React.useState<{ l: string; r: string } | null>(null)
  const [live, setLive] = React.useState('')
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const leftCol = React.useRef<HTMLDivElement>(null)
  const rightCol = React.useRef<HTMLDivElement>(null)
  const shakeTimer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(shakeTimer.current), [])

  const byId = React.useMemo(() => new Map(data.pairs.map((p) => [p.id, p])), [data])
  const textOf = (side: Side, id: string) => (side === 'l' ? byId.get(id)?.left : byId.get(id)?.right) ?? ''
  const done = connectDone(data, state)
  const stars = done ? connectStars(state.mistakes, data.pairs.length) : undefined

  const attempt = (leftId: string, rightId: string) => {
    const r = tryConnect(data, state, leftId, rightId)
    if (r.state === state) return
    setState(r.state)
    setSelected(null)
    if (r.correct) {
      const finished = connectDone(data, r.state)
      if (finished) {
        const s = connectStars(r.state.mistakes, data.pairs.length)
        setLive(
          r.state.mistakes === 0
            ? t('activities.experiences.match.perfect_connect', 'All pairs matched without a mistake!')
            : t('activities.experiences.match.done_connect', { mistakes: r.state.mistakes, defaultValue: 'All pairs matched. Mistakes: {{mistakes}}' }),
        )
        if (s > best) {
          setBest(s)
          memory.write('best', s)
        }
      } else {
        setLive(t('activities.experiences.match.correct', { left: textOf('l', leftId), right: textOf('r', rightId), defaultValue: 'Correct: {{left}} and {{right}}.' }))
      }
    } else {
      setLive(t('activities.experiences.match.wrong', 'Not a match. Try again.'))
      window.clearTimeout(shakeTimer.current)
      setShake({ l: leftId, r: rightId })
      shakeTimer.current = window.setTimeout(() => setShake(null), SHAKE_MS)
    }
  }

  const pick = (side: Side, id: string) => {
    if ((side === 'l' ? state.doneLeft : state.doneRight).includes(id)) return
    if (!selected || selected.side === side) {
      const next = selected?.side === side && selected.id === id ? null : { side, id }
      setSelected(next)
      if (next) setLive(t('activities.experiences.match.selected', { item: textOf(side, id), defaultValue: 'Selected “{{item}}”. Now pick its match.' }))
      return
    }
    if (side === 'l') attempt(id, selected.id)
    else attempt(selected.id, id)
  }

  const { drag, itemProps } = useTapDrag({
    disabled: done,
    onDrop: (dragKey, target) => {
      const [fromSide, fromId] = dragKey.split(':') as [Side, string]
      const [toSide, toId] = target.split(':') as [Side, string]
      if (!fromId || !toId || fromSide === toSide) return
      if (fromSide === 'l') attempt(fromId, toId)
      else attempt(toId, fromId)
    },
  })

  const onReset = () => {
    setRightIds(shuffleIds(leftIds))
    setState(emptyConnect())
    setSelected(null)
    setShake(null)
    setLive('')
  }

  const keyDown = (e: React.KeyboardEvent<HTMLElement>, side: Side) => {
    if (e.key === 'Escape') {
      setSelected(null)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Either horizontal arrow jumps to the other column, at the same row.
      const own = (side === 'l' ? leftCol : rightCol).current
      const other = (side === 'l' ? rightCol : leftCol).current
      const mine = Array.from(own?.querySelectorAll<HTMLElement>('[data-match-card]') ?? [])
      const theirs = Array.from(other?.querySelectorAll<HTMLElement>('[data-match-card]') ?? [])
      const i = mine.indexOf(e.currentTarget)
      const target = theirs[Math.min(Math.max(i, 0), theirs.length - 1)]
      if (target) {
        e.preventDefault()
        target.focus()
      }
      return
    }
    focusSibling(e, '[data-match-card]', (side === 'l' ? leftCol : rightCol).current)
  }

  const card = (side: Side, id: string) => {
    const doneList = side === 'l' ? state.doneLeft : state.doneRight
    const matchIndex = doneList.indexOf(id)
    const locked = matchIndex >= 0
    const isSel = selected?.side === side && selected.id === id
    const shaking = !!shake && shake[side] === id
    const key = `${side}:${id}`
    return (
      <button
        key={key}
        type="button"
        data-match-card=""
        data-drop-target={locked ? undefined : key}
        {...(locked ? {} : itemProps(key))}
        onClick={() => pick(side, id)}
        onKeyDown={(e) => keyDown(e, side)}
        aria-pressed={locked ? undefined : isSel}
        aria-disabled={locked || undefined}
        aria-label={locked ? `${textOf(side, id)}, ${t('activities.experiences.match.matched', 'matched')}` : undefined}
        className={cn(
          'relative flex min-h-11 w-full min-w-0 touch-manipulation items-center gap-2 rounded-xl px-3 py-2 text-start text-[13px] leading-snug font-medium ring-1 transition-[background-color,box-shadow,opacity] outline-none select-none focus-visible:ring-2 focus-visible:ring-sky-500/60',
          locked
            ? PAIR_CLASS[matchIndex % PAIR_CLASS.length]
            : shaking
              ? 'lh-exp-shake bg-rose-50 text-rose-900 ring-2 ring-rose-400'
              : 'bg-white text-neutral-800 shadow-[0_1px_1px_rgba(0,0,0,0.05)] ring-neutral-200 hover:ring-neutral-300',
          isSel && 'ring-2 ring-indigo-500 bg-indigo-50/60',
          drag?.over === key && !locked && 'ring-2 ring-indigo-400',
          drag?.id === key && 'opacity-40',
          !locked && 'cursor-pointer',
        )}
      >
        {locked && (
          <span aria-hidden className="pointer-events-none inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-white/80 px-1 text-[10px] font-bold tabular-nums">
            {matchIndex + 1}
          </span>
        )}
        <span className="pointer-events-none min-w-0 flex-1 [overflow-wrap:anywhere]">{textOf(side, id)}</span>
        {locked && <Check size={15} weight="bold" aria-hidden className="pointer-events-none shrink-0 text-emerald-600" />}
        {shaking && <X size={15} weight="bold" aria-hidden className="pointer-events-none shrink-0 text-rose-600" />}
      </button>
    )
  }

  const footer = (
    <ExperienceFooter
      progress={done ? undefined : { done: state.doneLeft.length, total: data.pairs.length }}
      stars={stars}
      score={t('activities.experiences.match.mistakes', { mistakes: state.mistakes, defaultValue: 'Mistakes: {{mistakes}}' })}
      onRetry={done || state.doneLeft.length > 0 || state.mistakes > 0 ? onReset : undefined}
    >
      {!done && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t('activities.experiences.match.best', 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={stars === 3} live={live}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12px] leading-snug text-neutral-500">
          {done ? (
            <span className={cn('inline-flex items-center gap-1.5 font-medium', state.mistakes === 0 ? 'text-emerald-700' : 'text-neutral-700')}>
              <ResultIcon ok size={15} label="" />
              {state.mistakes === 0
                ? t('activities.experiences.match.perfect_connect', 'All pairs matched without a mistake!')
                : t('activities.experiences.match.done_connect', { mistakes: state.mistakes, defaultValue: 'All pairs matched. Mistakes: {{mistakes}}' })}
            </span>
          ) : selected ? (
            t('activities.experiences.match.selected', { item: textOf(selected.side, selected.id), defaultValue: 'Selected “{{item}}”. Now pick its match.' })
          ) : (
            t('activities.experiences.match.connect_hint', 'Tap an item, then its match. You can also drag one onto the other.')
          )}
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:gap-x-6">
          <div ref={leftCol} role="group" aria-label={t('activities.experiences.match.left_label', 'Items')} className="flex min-w-0 flex-col gap-2">
            {leftIds.map((id) => card('l', id))}
          </div>
          <div ref={rightCol} role="group" aria-label={t('activities.experiences.match.right_label', 'Matches')} className="flex min-w-0 flex-col gap-2">
            {rightIds.map((id) => card('r', id))}
          </div>
        </div>
      </div>
      {drag && <DragGhost x={drag.x} y={drag.y}>{textOf(drag.id.startsWith('l:') ? 'l' : 'r', drag.id.slice(2))}</DragGhost>}
    </ExperienceFrame>
  )
}

// ─── Learner: memory ────────────────────────────────────────────────────────

function MemoryPlayer({ data, frame, source }: { data: MatchData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const memory = useExperienceMemory(data.blockId, source)
  const [deck, setDeck] = React.useState<MemoryCard[]>(() => memoryDeck(data))
  const [state, setState] = React.useState<MemoryState>(emptyMemory)
  const [live, setLive] = React.useState('')
  const [bestMoves, setBestMoves] = React.useState<number | null>(() => {
    const v = memory.read<number | null>('bestMoves', null)
    return typeof v === 'number' && v > 0 ? v : null
  })
  const [newBest, setNewBest] = React.useState(false)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const missTimer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(missTimer.current), [])

  const done = memoryDone(deck, state)
  const pairs = data.pairs.length
  const stars = done ? memoryStars(state.moves, pairs) : undefined
  const found = state.matched.length / 2

  const flip = (index: number) => {
    const r = flipCard(data, deck, state, index)
    if (r.result === 'ignored') return
    window.clearTimeout(missTimer.current)
    setState(r.state)
    if (r.result === 'miss') {
      setLive(t('activities.experiences.match.no_pair', 'Not a pair.'))
      missTimer.current = window.setTimeout(() => setState((s) => closeMiss(s)), MISS_MS)
    } else if (r.result === 'match') {
      const a = deck.find((c) => c.key === r.state.matched[r.state.matched.length - 2])
      const b = deck[index]
      if (memoryDone(deck, r.state)) {
        const improved = bestMoves == null || r.state.moves < bestMoves
        const nextBest = betterMoves(bestMoves, r.state.moves)
        setBestMoves(nextBest)
        setNewBest(improved && bestMoves != null)
        memory.write('bestMoves', nextBest)
        const s = memoryStars(r.state.moves, pairs)
        if (s > memory.read<number>('best', 0)) memory.write('best', s)
        setLive(t('activities.experiences.match.done_memory', { moves: r.state.moves, defaultValue: 'All pairs found in {{moves}} moves.' }))
      } else {
        setLive(t('activities.experiences.match.pair_found', { a: a?.text ?? '', b: b?.text ?? '', defaultValue: 'Pair found: {{a}} and {{b}}.' }))
      }
    } else {
      setLive(deck[index]?.text ?? '')
    }
  }

  const onReset = () => {
    window.clearTimeout(missTimer.current)
    setDeck(memoryDeck(data))
    setState(emptyMemory())
    setNewBest(false)
    setLive('')
  }

  const keyDown = (e: React.KeyboardEvent<HTMLElement>, index: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
      focusSibling(e, '[data-memory-card]', gridRef.current)
      return
    }
    // Up / down: jump by the number of cards in a row (read from the layout).
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-memory-card]') ?? [])
    const top = cards[0]?.offsetTop
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === top).length)
    const next = cards[index + (e.key === 'ArrowUp' ? -cols : cols)]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  const cols = deck.length <= 8 ? 'grid-cols-2 sm:grid-cols-4' : deck.length <= 12 ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-3 sm:grid-cols-4'

  const footer = (
    <ExperienceFooter
      progress={done ? undefined : { done: found, total: pairs }}
      stars={stars}
      score={t('activities.experiences.match.moves', { moves: state.moves, defaultValue: 'Moves: {{moves}}' })}
      onRetry={done || state.moves > 0 ? onReset : undefined}
    >
      {bestMoves != null && (
        <span className="text-xs font-medium tabular-nums text-neutral-500">
          {t('activities.experiences.match.best_moves', { moves: bestMoves, defaultValue: 'Best: {{moves}}' })}
        </span>
      )}
      {done && newBest && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
          {t('activities.experiences.match.new_best', 'New best!')}
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={stars === 3} live={live}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12px] leading-snug text-neutral-500">
          {done ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <ResultIcon ok size={15} label="" />
              {t('activities.experiences.match.done_memory', { moves: state.moves, defaultValue: 'All pairs found in {{moves}} moves.' })}
            </span>
          ) : (
            t('activities.experiences.match.memory_hint', 'Flip two cards at a time to find the pairs.')
          )}
        </p>
        <div ref={gridRef} role="group" aria-label={t('activities.experiences.match.cards_label', 'Cards')} className={cn('grid gap-2 sm:gap-3', cols)}>
          {deck.map((c, i) => {
            const matched = state.matched.includes(c.key)
            const open = matched || state.open.includes(i)
            const missed = state.open.length === 2 && state.open.includes(i)
            const label = matched
              ? t('activities.experiences.match.card_matched', { text: c.text, defaultValue: '{{text}}, matched' })
              : open
                ? t('activities.experiences.match.card_shown', { n: i + 1, text: c.text, defaultValue: 'Card {{n}}: {{text}}' })
                : t('activities.experiences.match.card_hidden', { n: i + 1, defaultValue: 'Card {{n}}, face down' })
            return (
              <button
                key={c.key}
                type="button"
                data-memory-card=""
                onClick={() => flip(i)}
                onKeyDown={(e) => keyDown(e, i)}
                aria-label={label}
                aria-disabled={matched || undefined}
                className="group relative min-h-20 touch-manipulation rounded-xl outline-none perspective-midrange focus-visible:ring-2 focus-visible:ring-sky-500/60 sm:min-h-24"
              >
                <span
                  className={cn(
                    'pointer-events-none absolute inset-0 transition-transform duration-300 ease-out transform-3d motion-reduce:transition-none',
                    open && 'rotate-y-180',
                  )}
                >
                  {/* Back (face down) */}
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-300 ring-1 ring-indigo-100 backface-hidden group-hover:bg-indigo-100/70"
                  >
                    <Question size={22} weight="bold" />
                  </span>
                  {/* Front (face up) */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-0 flex rotate-y-180 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center text-[13px] leading-snug font-medium ring-1 backface-hidden',
                      matched ? 'bg-emerald-50 text-emerald-900 ring-emerald-300' : missed ? 'bg-rose-50 text-rose-900 ring-2 ring-rose-300' : 'bg-white text-neutral-800 ring-neutral-200',
                    )}
                  >
                    {matched && <Check size={14} weight="bold" className="shrink-0 text-emerald-600" />}
                    {missed && <X size={14} weight="bold" className="shrink-0 text-rose-600" />}
                    <span className="line-clamp-4 min-w-0 [overflow-wrap:anywhere]">{c.text}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </ExperienceFrame>
  )
}
