'use client'
/*
 "Match pairs" (node expMatch).

 Author: edit in place on the learner's two columns of tiles, one row per
 pair, each row tagged with its pair number (the answer key). "+ Add pair"
 adds a row, × removes one; the game mode (connect / memory) sits behind the
 header gear.

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
import { Check, LinkSimple, Question, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Segmented, SettingsField } from '../../../Blocks/ui/BlockChrome'
import {
  AddGhost,
  AnswerKeyHint,
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
import { DragGhost, InlineHint, NotReady, ResultIcon, contentKey } from '../Sort/kit'
import { focusSibling, useTapDrag } from '../Sort/useTapDrag'

const TONE = 'media' as const
const MISS_MS = 900
const SHAKE_MS = 450

/** Colour tabs for locked pairs, in match order (each also gets a number and a check). */
const PAIR_TAB = ['bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-violet-500', 'bg-lime-600', 'bg-cyan-600', 'bg-orange-500', 'bg-indigo-500']

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
  if (editable && !preview) body = <MatchAuthor data={data} commit={commit} frame={frame} />
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

type Side = 'l' | 'r'

// ─── Author: edit in place ──────────────────────────────────────────────────
// The learner's two columns of raised tiles, one row per pair (the answer
// key: each row carries the numbered tab a matched pair gets). Text is edited
// in the tiles; "+ Add pair" adds a row, × removes one. The game mode lives
// behind the header gear.

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_pairs: 'Add at least 2 pairs.',
  too_many_pairs: 'Use at most 8 pairs; learners only see the first 8.',
  empty_left: 'The item is empty; learners will not see this pair.',
  empty_right: 'The match is empty; learners will not see this pair.',
  duplicate_left: 'Another pair starts with the same item.',
  duplicate_pair: 'This pair appears twice.',
}

function MatchAuthor({ data, commit, frame }: { data: MatchData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const issues = React.useMemo(() => validateMatch(data), [data])
  const issueText = (code: string) => t(`editor.experiences.match.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const edit = (fn: (_d: MatchData) => MatchData) => commit((live) => ({ pairs: fn(normalizeMatch(live)).pairs }))
  const canRemove = data.pairs.length > MATCH_LIMITS.minPairs
  const rootRef = React.useRef<HTMLDivElement>(null)

  // Focus moves to a new or neighbouring row once it has rendered.
  const pendingFocus = React.useRef<string | null>(null)
  const tryFocus = () => {
    const sel = pendingFocus.current
    const el = sel ? rootRef.current?.querySelector<HTMLElement>(sel) : null
    if (el) {
      pendingFocus.current = null
      el.focus()
    }
  }
  React.useEffect(tryFocus)
  const focusLater = (selector: string) => {
    pendingFocus.current = selector
    requestAnimationFrame(tryFocus)
  }

  const add = () => {
    const id = newId()
    edit((d) => addPair(d, id))
    focusLater(`[data-pair-id="${id}"] [data-side="l"] textarea`)
  }
  const remove = (index: number) => {
    const p = data.pairs[index]
    const next = data.pairs[index + 1] ?? data.pairs[index - 1]
    edit((d) => removePair(d, p.id))
    focusLater(next ? `[data-pair-id="${next.id}"] [data-side="l"] textarea` : '[data-add-pair]')
  }

  const tile = (side: Side, index: number) => {
    const p = data.pairs[index]
    const n = index + 1
    return (
      <div
        data-side={side}
        className="lh-exp-raised relative flex min-h-12 w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl py-2 ps-9 pe-3 text-start text-[14px] leading-snug font-medium text-neutral-800"
      >
        <span
          aria-hidden
          className={cn(
            'lh-exp-tab pointer-events-none absolute inset-y-0 start-0 inline-flex w-6 items-center justify-center text-[11px] font-bold tabular-nums text-white',
            PAIR_TAB[index % PAIR_TAB.length],
          )}
        >
          {n}
        </span>
        <InlineText
          value={side === 'l' ? p.left : p.right}
          onCommit={(v) => edit((d) => updatePair(d, p.id, side === 'l' ? { left: v } : { right: v }))}
          ariaLabel={
            side === 'l'
              ? t('editor.experiences.match.left_label', { n, defaultValue: 'Pair {{n}}: item' })
              : t('editor.experiences.match.right_label', { n, defaultValue: 'Pair {{n}}: match' })
          }
          placeholder={side === 'l' ? t('editor.experiences.match.left_placeholder', 'Item') : t('editor.experiences.match.right_placeholder', 'Its match')}
          maxLength={120}
          onEnter={
            side === 'l'
              ? () => rootRef.current?.querySelector<HTMLElement>(`[data-pair-id="${p.id}"] [data-side="r"] textarea`)?.focus()
              : () => (document.activeElement as HTMLElement | null)?.blur()
          }
          className="min-w-0 flex-1 [overflow-wrap:anywhere]"
        />
      </div>
    )
  }

  const settings = (
    <SettingsGear>
      <SettingsField
        label={t('editor.experiences.match.mode_label', 'Game')}
        hint={
          data.mode === 'memory'
            ? t('editor.experiences.match.mode_memory_hint', 'Face-down cards: learners flip two at a time to find the pairs.')
            : t('editor.experiences.match.mode_connect_hint', 'Two columns: learners tap an item, then its match.')
        }
      >
        <Segmented<MatchMode>
          value={data.mode}
          onChange={(mode) => commit({ mode })}
          ariaLabel={t('editor.experiences.match.mode_label', 'Game')}
          options={[
            { value: 'connect', label: t('editor.experiences.match.mode_connect', 'Connect') },
            { value: 'memory', label: t('editor.experiences.match.mode_memory', 'Memory') },
          ]}
        />
      </SettingsField>
    </SettingsGear>
  )

  return (
    <ExperienceFrame
      {...frame}
      wysiwyg
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      instructions={data.instructions}
      onInstructionsChange={(instructions) => commit({ instructions })}
      headerEnd={settings}
      footer={<AnswerKeyHint />}
    >
      <div ref={rootRef} className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-snug text-neutral-500">
          {data.mode === 'memory'
            ? t('editor.experiences.match.author_memory_hint', 'Each row is a pair. In memory mode learners see them as face-down cards.')
            : t('editor.experiences.match.author_connect_hint', 'Each row is a pair. Learners get the matches shuffled and connect them.')}
        </p>
        {issues.some((i) => !i.id) && (
          <div className="flex flex-col gap-1">
            {issues
              .filter((i) => !i.id)
              .map((i) => (
                <InlineHint key={i.code} severity={i.severity}>
                  {issueText(i.code)}
                </InlineHint>
              ))}
          </div>
        )}
        <div role="list" aria-label={t('editor.experiences.match.pairs_heading', 'Pairs')} className="flex flex-col gap-2">
          {data.pairs.map((p, index) => {
            const rowIssues = issues.filter((i) => i.id === p.id)
            return (
              <div key={p.id} role="listitem" data-pair-id={p.id} className="flex flex-col gap-1">
                <div className={cn('relative grid grid-cols-2 gap-x-3 sm:gap-x-6', EDIT_OBJECT)}>
                  {tile('l', index)}
                  {tile('r', index)}
                  <RemoveX
                    floating
                    disabled={!canRemove}
                    onClick={() => remove(index)}
                    label={t('editor.experiences.match.remove_pair_n', { n: index + 1, defaultValue: 'Remove pair {{n}}' })}
                  />
                </div>
                {rowIssues.map((i) => (
                  <InlineHint key={i.code} severity={i.severity}>
                    {issueText(i.code)}
                  </InlineHint>
                ))}
              </div>
            )
          })}
          {data.pairs.length < MATCH_LIMITS.maxPairs && (
            <AddGhost data-add-pair="" onClick={add} className="min-h-12 w-full rounded-xl px-3 text-[14px]">
              {t('editor.experiences.match.add_pair', 'Add pair')}
            </AddGhost>
          )}
        </div>
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner: connect ───────────────────────────────────────────────────────

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
    buzz(r.correct ? 'correct' : 'wrong')
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
        data-picked={!locked && (isSel || drag?.over === key) ? 'true' : undefined}
        data-result={shaking ? 'wrong' : undefined}
        className={cn(
          'lh-exp-raised relative flex min-h-12 w-full min-w-0 touch-manipulation items-center gap-2 overflow-hidden rounded-xl py-2 pe-3 text-start text-[14px] leading-snug font-medium outline-none select-none',
          locked ? 'lh-exp-lock ps-9 text-neutral-800' : 'lh-exp-press ps-3',
          !locked && !shaking && (isSel || drag?.over === key ? 'text-indigo-700' : 'text-neutral-800'),
          shaking && 'lh-exp-shake',
          drag?.id === key && 'opacity-40',
        )}
      >
        {locked && (
          <span
            aria-hidden
            className={cn(
              'lh-exp-tab pointer-events-none absolute inset-y-0 start-0 inline-flex w-6 items-center justify-center text-[11px] font-bold tabular-nums text-white',
              PAIR_TAB[matchIndex % PAIR_TAB.length],
            )}
          >
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
        <p className="m-0 text-[13px] leading-snug text-neutral-500">
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
    if (r.result === 'miss' || r.result === 'match') buzz(r.result === 'match' ? 'correct' : 'wrong')
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
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
          {t('activities.experiences.match.new_best', 'New best!')}
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={stars === 3} live={live}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-snug text-neutral-500">
          {done ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <ResultIcon ok size={15} label="" />
              {t('activities.experiences.match.done_memory', { moves: state.moves, defaultValue: 'All pairs found in {{moves}} moves.' })}
            </span>
          ) : (
            t('activities.experiences.match.memory_hint', 'Flip two cards at a time to find the pairs.')
          )}
        </p>
        <div ref={gridRef} role="group" aria-label={t('activities.experiences.match.cards_label', 'Cards')} className={cn('lh-exp-well lh-exp-felt grid gap-2.5 rounded-2xl p-2.5 sm:gap-3 sm:p-3', cols)}>
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
                data-open={open ? 'true' : undefined}
                className={cn(
                  'lh-exp-card3d group relative min-h-20 touch-manipulation rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 sm:min-h-24',
                  !open && 'transition-transform duration-150 hover:-translate-y-px active:translate-y-px motion-reduce:transform-none',
                )}
              >
                <span className="lh-exp-card3d-inner pointer-events-none absolute inset-0">
                  {/* Back (face down) */}
                  <span
                    aria-hidden
                    className="lh-exp-card3d-face lh-exp-raised lh-exp-cardback absolute inset-0 flex items-center justify-center rounded-xl text-indigo-400"
                  >
                    <span className="lh-exp-well inline-flex h-9 w-9 items-center justify-center rounded-full">
                      <Question size={18} weight="bold" />
                    </span>
                  </span>
                  {/* Front (face up) */}
                  <span
                    aria-hidden
                    data-result={matched ? 'correct' : missed ? 'wrong' : undefined}
                    className={cn(
                      'lh-exp-card3d-face lh-exp-card3d-front lh-exp-raised absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center text-[14px] leading-snug font-medium',
                      !matched && !missed && 'text-neutral-800',
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
