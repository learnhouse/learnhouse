'use client'
/*
 Code lock: a mini escape room. Each clue fills one dial of a padlock; when
 every dial is set the shackle springs open and the reward appears. Answers
 are matched loosely (codeLockModel.normalizeAnswer). Hints cost a star.

 Answers live only in the node attrs: the learner DOM never contains an
 answer before its clue is solved, and the reward is only rendered once the
 lock is open.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Check, Lightbulb, LockKey, Plus, Trash, WarningCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CommitInput, FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { ExperienceFooter, ExperienceFrame, newId, useEnsureBlockId, useExperienceEditable, useLiveAttrs, usePrefersReducedMotion } from '../shared'
import {
  MAX_ANSWER_LENGTH,
  MAX_CLUES,
  type Clue,
  type CodeLockData,
  type CodeLockIssue,
  dialFace,
  isOpen,
  newLock,
  normalizeCodeLock,
  playableClues,
  starsFor,
  takeHint,
  tryClue,
  validateCodeLock,
} from './codeLockModel'
import { experienceById } from '../registry'

type FrameBase = Omit<React.ComponentProps<typeof ExperienceFrame>, 'children'>

export default function CodeLockView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeCodeLock(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: FrameBase = {
    tone: 'code',
    icon: <LockKey weight="duotone" />,
    title: data.title,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.code_lock.name'),
  }
  return (
    <NodeViewWrapper className="block-exp-code-lock">
      {editable && !preview ? (
        <ExperienceFrame {...frame} onTitleChange={(title) => commit({ title })} titlePlaceholder={t('editor.experiences.code_lock.title_placeholder')}>
          <CodeLockForm data={data} commit={commit} />
        </ExperienceFrame>
      ) : (
        <CodeLockPlayer key={JSON.stringify(data.clues)} data={data} frame={frame} />
      )}
    </NodeViewWrapper>
  )
}

// ---- authoring -----------------------------------------------------------

/** The registry's example (what the slash menu inserts), minus its fresh blockId. */
function exampleAttrs(t: TFunction): Record<string, unknown> {
  const { blockId: _drop, ...attrs } = (experienceById('codeLock')?.defaultContent(t)?.attrs ?? {}) as Record<string, unknown>
  return attrs
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-1.5 text-xs leading-snug text-amber-700">
      <WarningCircle size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function CodeLockForm({ data, commit }: { data: CodeLockData; commit: (_p: any) => void }) {
  const { t } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`editor.experiences.code_lock.${s}`, o)
  const issues = validateCodeLock(data)
  const issueText = (i: CodeLockIssue) => k(`issue_${i.kind}`, { max: MAX_ANSWER_LENGTH })
  const edit = (fn: (_c: Clue[]) => Clue[]) => commit((live: any) => ({ clues: fn(normalizeCodeLock(live).clues) }))
  const patch = (id: string, p: Partial<Clue>) => edit((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)))
  const addClue = () => edit((cs) => [...cs, { id: newId(), question: '', answer: '', hint: '' }])

  if (!data.clues.length && !data.story && !data.reward) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-neutral-50 px-4 py-6 text-center">
        <p className="m-0 text-sm text-neutral-500">{k('empty')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => commit(exampleAttrs(t))}>
            {k('fill_example')}
          </button>
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={addClue}>
            <Plus size={14} weight="bold" aria-hidden />
            {k('add_clue')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-600">{k('story_label')}</span>
        <CommitInput multiline value={data.story} onCommit={(story) => commit({ story })} placeholder={k('story_placeholder')} aria-label={k('story_label')} />
      </label>

      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {data.clues.map((c, i) => {
          const rowIssues = issues.filter((x) => 'id' in x && x.id === c.id)
          return (
            <li key={c.id} className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-200 text-xs font-bold tabular-nums text-slate-700">{i + 1}</span>
                <CommitInput
                  value={c.question}
                  onCommit={(question) => patch(c.id, { question })}
                  placeholder={k('question_placeholder')}
                  aria-label={k('question_label', { n: i + 1 })}
                  maxLength={300}
                  className={cn(FIELD_CLASS, 'flex-1')}
                />
                <button type="button" className={buttonClass('danger-ghost', 'icon', 'shrink-0')} aria-label={k('remove_clue', { n: i + 1 })} onClick={() => edit((cs) => cs.filter((x) => x.id !== c.id))}>
                  <Trash size={14} aria-hidden />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 ps-8 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                <CommitInput
                  value={c.answer}
                  onCommit={(answer) => patch(c.id, { answer })}
                  placeholder={k('answer_placeholder')}
                  aria-label={k('answer_label', { n: i + 1 })}
                  maxLength={MAX_ANSWER_LENGTH + 20}
                  className={cn(FIELD_CLASS, 'font-mono')}
                />
                <CommitInput
                  value={c.hint}
                  onCommit={(hint) => patch(c.id, { hint })}
                  placeholder={k('hint_placeholder')}
                  aria-label={k('hint_label', { n: i + 1 })}
                  maxLength={200}
                />
              </div>
              {rowIssues.length > 0 && (
                <div className="flex flex-col gap-1 ps-8">
                  {rowIssues.map((x) => (
                    <Hint key={x.kind}>{issueText(x)}</Hint>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {issues.some((x) => x.kind === 'noClues') && <Hint>{issueText({ kind: 'noClues' })}</Hint>}
      {data.clues.length < MAX_CLUES && (
        <button type="button" className={buttonClass('secondary', 'sm', 'self-start')} onClick={addClue}>
          <Plus size={14} weight="bold" aria-hidden />
          {k('add_clue')}
        </button>
      )}
      <p className="m-0 text-[11px] leading-snug text-neutral-400">{k('match_hint')}</p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-600">{k('reward_label')}</span>
        <CommitInput multiline value={data.reward} onCommit={(reward) => commit({ reward })} placeholder={k('reward_placeholder')} aria-label={k('reward_label')} />
      </label>
      {issues.some((x) => x.kind === 'emptyReward') && <Hint>{issueText({ kind: 'emptyReward' })}</Hint>}
    </div>
  )
}

// ---- learner -------------------------------------------------------------

function CodeLockPlayer({ data, frame }: { data: CodeLockData; frame: FrameBase }) {
  const { t } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`activities.experiences.code_lock.${s}`, o)
  const clues = React.useMemo(() => playableClues(data), [data])
  const reduced = usePrefersReducedMotion()
  const [lock, setLock] = React.useState(newLock)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [shake, setShake] = React.useState<{ id: string; n: number } | null>(null)
  const [live, setLive] = React.useState('')
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({})
  const open = isOpen(lock, clues)
  const stars = starsFor(lock.hints.length)

  const submit = (clue: Clue, index: number) => {
    const res = tryClue(lock, clue, drafts[clue.id] ?? '')
    if (res.state === lock && !res.correct) return
    setLock(res.state)
    if (res.correct) {
      const nowOpen = isOpen(res.state, clues)
      setLive(nowOpen ? k('live_open') : k('live_dial', { n: index + 1 }))
      // Move on to the next unsolved clue.
      const next = clues.find((c) => c.id !== clue.id && !res.state.solved.includes(c.id))
      if (next) requestAnimationFrame(() => inputs.current[next.id]?.focus())
    } else {
      setShake({ id: clue.id, n: (shake?.n ?? 0) + 1 })
      setLive(k('live_wrong', { n: index + 1 }))
      // The input remounts to replay the shake; keep the learner in it.
      requestAnimationFrame(() => inputs.current[clue.id]?.focus())
    }
  }

  const retry = () => {
    setLock(newLock())
    setDrafts({})
    setShake(null)
    setLive('')
    requestAnimationFrame(() => clues[0] && inputs.current[clues[0].id]?.focus())
  }

  if (!clues.length) {
    return (
      <ExperienceFrame {...frame}>
        <p className="m-0 rounded-xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">{k('empty')}</p>
      </ExperienceFrame>
    )
  }

  const footer = (
    <ExperienceFooter
      stars={open ? stars : undefined}
      progress={open ? undefined : { done: lock.solved.length, total: clues.length }}
      score={open ? k('opened') : undefined}
      onRetry={open || lock.solved.length || lock.hints.length ? retry : undefined}
    >
      {!open && lock.hints.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
          <Lightbulb size={13} weight="fill" aria-hidden />
          {k('hints_used', { count: lock.hints.length })}
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} instructions={k('instructions')} footer={footer} live={live} celebrate={open}>
      <div className="flex flex-col gap-4">
        {data.story.trim() && <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-neutral-700 [overflow-wrap:anywhere]">{data.story}</p>}

        <Padlock clues={clues} solved={lock.solved} open={open} reduced={reduced} label={k('lock_label', { done: lock.solved.length, total: clues.length })} />

        {open ? (
          <div className="flex flex-col gap-2 rounded-xl bg-emerald-50 px-4 py-3 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:slide-in-from-bottom-0">
            <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
              <Check size={15} weight="bold" aria-hidden />
              {k('unlocked')}
            </p>
            {data.reward.trim() && <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-neutral-800 [overflow-wrap:anywhere]">{data.reward}</p>}
          </div>
        ) : null}

        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {clues.map((clue, i) => {
            const solved = lock.solved.includes(clue.id)
            const hinted = lock.hints.includes(clue.id)
            const wrong = lock.wrong[clue.id] || 0
            return (
              <li key={clue.id} className={cn('flex flex-col gap-2 rounded-xl p-3', solved ? 'bg-emerald-50/70' : 'bg-neutral-50')}>
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums',
                      solved ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-700',
                    )}
                  >
                    {solved ? <Check size={12} weight="bold" /> : i + 1}
                  </span>
                  <p id={`${clue.id}-q`} className="m-0 min-w-0 flex-1 text-sm font-medium text-neutral-900 [overflow-wrap:anywhere]">
                    <span className="sr-only">{k('clue_n', { n: i + 1 })} </span>
                    {clue.question}
                  </p>
                </div>
                {solved ? (
                  <p className="m-0 ps-8 text-sm text-emerald-800">
                    {k('solved_with')} <span className="font-mono font-semibold">{clue.answer}</span>
                  </p>
                ) : (
                  <form
                    className="flex flex-col gap-2 ps-8 sm:flex-row sm:items-center"
                    onSubmit={(e) => {
                      e.preventDefault()
                      submit(clue, i)
                    }}
                  >
                    <input
                      ref={(el) => {
                        inputs.current[clue.id] = el
                      }}
                      key={shake?.id === clue.id ? shake.n : 0}
                      type="text"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={drafts[clue.id] ?? ''}
                      aria-labelledby={`${clue.id}-q`}
                      aria-invalid={wrong > 0 && shake?.id === clue.id ? true : undefined}
                      onChange={(e) => setDrafts((d) => ({ ...d, [clue.id]: e.target.value }))}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder={k('answer_placeholder')}
                      className={cn(FIELD_CLASS, 'h-9 font-mono sm:max-w-[14rem]', shake?.id === clue.id && 'lh-exp-shake shadow-[0_0_0_1px_rgba(225,29,72,0.5)]')}
                    />
                    <div className="flex items-center gap-2">
                      <button type="submit" className={buttonClass('primary', 'md')}>
                        {k('try')}
                      </button>
                      {clue.hint.trim() && !hinted && (
                        <button type="button" className={buttonClass('ghost', 'md', 'text-amber-700')} onClick={() => setLock((s) => takeHint(s, clue))}>
                          <Lightbulb size={14} aria-hidden />
                          {k('show_hint')}
                        </button>
                      )}
                    </div>
                  </form>
                )}
                {!solved && shake?.id === clue.id && (
                  <p className="m-0 ps-8 text-xs font-medium text-rose-600">{k('not_quite')}</p>
                )}
                {!solved && hinted && (
                  <p className="m-0 ms-8 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 animate-in fade-in duration-200">
                    <Lightbulb size={13} weight="fill" aria-hidden className="mt-px shrink-0" />
                    <span className="[overflow-wrap:anywhere]">{clue.hint}</span>
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </ExperienceFrame>
  )
}

function Padlock({ clues, solved, open, reduced, label }: { clues: Clue[]; solved: string[]; open: boolean; reduced: boolean; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex flex-col items-center py-1">
      {/* Shackle: lifts and swings open when every dial is set. */}
      <svg
        viewBox="0 0 80 48"
        aria-hidden
        className={cn(
          'h-12 w-20 text-slate-400',
          !reduced && 'transition-transform duration-500 [transition-timing-function:cubic-bezier(.3,1.6,.5,1)]',
          open && (reduced ? 'text-emerald-500' : '-translate-y-2 text-emerald-500'),
        )}
        style={open && !reduced ? { transformOrigin: '75% 100%' } : undefined}
      >
        <path
          d={open ? 'M18 48 V24 A22 22 0 0 1 62 24 V14' : 'M18 48 V24 A22 22 0 0 1 62 24 V48'}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          strokeLinecap="round"
          className={reduced ? 'transition-none' : 'transition-[d] duration-500'}
        />
      </svg>
      <div
        className={cn(
          '-mt-1 flex max-w-full flex-wrap justify-center gap-1.5 rounded-2xl px-3 py-3 shadow-[inset_0_-3px_0_rgba(0,0,0,0.12)] transition-colors duration-300 motion-reduce:transition-none',
          open ? 'bg-emerald-500' : 'bg-slate-700',
        )}
      >
        {clues.map((c) => {
          const done = solved.includes(c.id)
          return (
            <span
              key={c.id}
              aria-hidden
              className={cn(
                'inline-flex h-12 min-w-10 items-center justify-center rounded-lg px-2 font-mono text-base font-bold tabular-nums shadow-[inset_0_2px_3px_rgba(0,0,0,0.25)]',
                done ? 'bg-white text-slate-900 animate-in zoom-in-90 duration-300 motion-reduce:zoom-in-100' : 'bg-slate-800 text-slate-400',
              )}
            >
              {dialFace(c, done)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
