'use client'
/*
 Spot the mistake: a passage split into sentences (or code lines). Learners
 flag the parts they think are wrong; Check shows hits, missed mistakes and
 false alarms, with the corrections and explanations. Authors edit in place:
 click a part to mark it as a mistake and write its correction below.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Check, Code, Flag, MagnifyingGlass, PencilSimple, TextAlignLeft, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Segmented, SettingsField } from '../../../Blocks/ui/BlockChrome'
import { InlineHint } from '../Sort/kit'
import {
  AnswerKeyHint,
  EDIT_OBJECT,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  RemoveX,
  SettingsGear,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  isBlankSegment,
  joinSegments,
  normalizeKind,
  normalizeSegments,
  resplit,
  scoreSelection,
  toggleMistake,
  toggleSelection,
  validateSpotMistake,
  type MistakeScore,
  type MistakeSegment,
  type SpotMistakeKind,
} from './spotMistakeModel'

type Stars = 0 | 1 | 2 | 3

interface StoredAttrs {
  blockId: string
  title: string
  instructions: string
  segments: unknown
  kind: unknown
}

/** Start a fresh round when `key` changes (state adjusted during render, no effect). */
function useResetOn(key: string, reset: () => void) {
  const [seen, setSeen] = React.useState(key)
  if (seen !== key) {
    setSeen(key)
    reset()
  }
}

/* ───────────────────────────── Editor ───────────────────────────── */
// Edit in place: the passage as learners see it, with the mistakes already
// marked (the answer key). Click a sentence or line to toggle it as a
// mistake; each mistake's correction and explanation are edited below, the
// way learners read them after checking. "Edit text" edits the passage
// itself and re-splits it. Text / code lives behind the gear.

function SpotMistakeEditor({
  segments,
  kind,
  commit,
}: {
  segments: MistakeSegment[]
  kind: SpotMistakeKind
  commit: (_patch: CommitPatch<StoredAttrs>) => void
}) {
  const { t } = useTranslation()
  const k = 'editor.experiences.spot_mistake.'
  const [editingText, setEditingText] = React.useState(segments.length === 0)
  const code = kind === 'code'

  const commitSegments = (fn: (_live: MistakeSegment[], _liveKind: SpotMistakeKind) => MistakeSegment[]) =>
    commit((live) => ({ segments: fn(normalizeSegments(live.segments), normalizeKind(live.kind)) }))
  const patchSeg = (id: string, p: Partial<MistakeSegment>) => commitSegments((live) => live.map((s) => (s.id === id ? { ...s, ...p } : s)))

  const issues = validateSpotMistake(segments)
  const hint = (issue: (typeof issues)[number]) => {
    switch (issue.kind) {
      case 'tooFew':
        return t(`${k}hint_too_few`)
      case 'noMistakes':
        return t(`${k}hint_no_mistakes`)
      case 'allMistakes':
        return t(`${k}hint_all_mistakes`)
      case 'missingCorrection':
        return t(`${k}hint_missing_correction`, { n: issue.segmentIndex + 1 })
    }
  }
  // Author-facing numbers skip blank code lines.
  const numbers = new Map<string, number>()
  segments.filter((s) => !isBlankSegment(s)).forEach((s, i) => numbers.set(s.id, i + 1))
  const mistakes = segments.filter((s) => s.isMistake && !isBlankSegment(s))

  return (
    <div className="flex flex-col gap-4">
      {editingText ? (
        <PassageText segments={segments} kind={kind} onDone={(value) => {
          if (value !== joinSegments(segments, kind)) commitSegments((live, liveKind) => resplit(live, value, liveKind))
          setEditingText(false)
        }} />
      ) : (
        <div
          dir={code ? 'ltr' : 'auto'}
          className={cn(code ? 'overflow-x-auto rounded-xl bg-white py-2 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08))]' : 'text-neutral-800 [overflow-wrap:anywhere]')}
          role="group"
          aria-label={t(`${k}segments_label`)}
        >
          {segments.map((seg, index) => {
            const line = index + 1
            if (isBlankSegment(seg)) {
              return code ? (
                <div key={seg.id} className="flex gap-3 px-2 font-mono text-[13px] leading-6" aria-hidden>
                  <span className="w-6 shrink-0 text-end text-[11px] text-neutral-400 tabular-nums">{line}</span>
                </div>
              ) : null
            }
            const n = numbers.get(seg.id) ?? 0
            return (
              <button
                key={seg.id}
                type="button"
                aria-pressed={seg.isMistake}
                aria-label={`${t(`${k}segment_n`, { n })}: ${seg.text}`}
                title={seg.isMistake ? t(`${k}unmark_hint`, 'A mistake. Click to mark it correct.') : t(`${k}mark_hint`, 'Click to mark this as a mistake.')}
                onClick={() => commitSegments((live) => toggleMistake(live, seg.id))}
                data-marked={seg.isMistake ? 'true' : undefined}
                style={{ '--exp-mark': 'rgba(251, 146, 60, 0.42)' } as React.CSSProperties}
                className={cn(
                  'lh-exp-mark group text-start outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50',
                  code ? 'flex w-full items-start gap-3 rounded-md px-2 py-0.5 font-mono text-[13px] leading-6 whitespace-pre-wrap' : 'me-1 inline rounded-md px-0.5 py-0.5 text-[15px] leading-8',
                  seg.isMistake ? 'text-neutral-950' : 'hover:bg-amber-50',
                )}
              >
                {code && <span aria-hidden className="w-6 shrink-0 select-none text-end text-[11px] leading-6 text-neutral-400 tabular-nums">{line}</span>}
                {seg.isMistake && (
                  <span aria-hidden className={cn('me-1 inline-flex h-4 w-4 translate-y-[2px] items-center justify-center rounded-full bg-orange-500 align-baseline text-white', code && 'mt-1 translate-y-0')}>
                    <Flag size={12} weight="fill" />
                  </span>
                )}
                <span className={cn(code && 'min-w-0 flex-1')}>{seg.text}</span>
              </button>
            )
          })}
        </div>
      )}

      {!editingText && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditingText(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-neutral-500 outline-none hover:bg-neutral-200/60 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <PencilSimple size={14} aria-hidden />
            {t(`${k}edit_text`, 'Edit text')}
          </button>
          <span className="text-[12px] text-neutral-400">{t(`${k}author_hint`, 'Click a part to mark it as a mistake, then write its correction below.')}</span>
        </div>
      )}

      {/* The answer key, as learners read it after checking. */}
      {mistakes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t(`${k}mistakes_label`, 'Mistakes and their corrections')}>
          {mistakes.map((seg) => {
            const n = numbers.get(seg.id) ?? 0
            return (
              <li key={seg.id} className={cn('relative rounded-xl bg-orange-50/70 px-3 py-2.5 text-[13px]', EDIT_OBJECT)}>
                <div className="flex items-start gap-2">
                  <Flag size={14} weight="fill" className="mt-0.5 shrink-0 text-orange-500" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className={cn('text-neutral-500 line-through decoration-neutral-400', code && 'font-mono text-[12.5px]')} dir={code ? 'ltr' : 'auto'}>
                      {seg.text}
                    </div>
                    <InlineText
                      value={seg.correction ?? ''}
                      onCommit={(v) => patchSeg(seg.id, { correction: v })}
                      ariaLabel={t(`${k}correction_label`, { n })}
                      placeholder={t(`${k}correction_placeholder`)}
                      maxLength={300}
                      className={cn('font-medium text-neutral-900', code && 'font-mono text-[12.5px]')}
                    />
                    <InlineText
                      multiline
                      value={seg.explanation ?? ''}
                      onCommit={(v) => patchSeg(seg.id, { explanation: v })}
                      ariaLabel={t(`${k}explanation_label`, { n })}
                      placeholder={t(`${k}explanation_placeholder`)}
                      maxLength={400}
                      className="text-neutral-600"
                    />
                    {!(seg.correction ?? '').trim() && <InlineHint severity="warning">{t(`${k}hint_correction_short`)}</InlineHint>}
                  </div>
                </div>
                <RemoveX floating onClick={() => patchSeg(seg.id, { isMistake: false })} label={t(`${k}unmark_named`, { n, defaultValue: 'Mark part {{n}} as correct' })} />
              </li>
            )
          })}
        </ul>
      )}

      {issues.length > 0 && (
        <div className="flex flex-col gap-1" aria-live="polite">
          {issues.map((issue, i) => (
            <InlineHint key={i} severity="warning">
              {hint(issue)}
            </InlineHint>
          ))}
        </div>
      )}
    </div>
  )
}

/** The whole passage, edited in place with its own typography; re-split on Done / blur. */
function PassageText({ segments, kind, onDone }: { segments: MistakeSegment[]; kind: SpotMistakeKind; onDone: (_value: string) => void }) {
  const { t } = useTranslation()
  const k = 'editor.experiences.spot_mistake.'
  const joined = joinSegments(segments, kind)
  const [draft, setDraft] = React.useState(joined)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const mono = kind === 'code'
  React.useEffect(() => {
    if (segments.length) ref.current?.focus()
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  return (
    <div className="flex flex-col gap-2">
      <span className={cn('lh-exp-edit block', mono && 'rounded-xl bg-white px-2 py-2 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08))]')}>
        <textarea
          ref={ref}
          value={draft}
          rows={mono ? 5 : 3}
          dir={mono ? 'ltr' : 'auto'}
          spellCheck={!mono}
          aria-label={t(`${k}passage_label`)}
          placeholder={mono ? t(`${k}passage_placeholder_code`) : t(`${k}passage_placeholder_text`)}
          className={cn(
            'm-0 block w-full resize-none overflow-hidden bg-transparent p-0 text-neutral-800 outline-none placeholder:text-neutral-400',
            mono ? 'font-mono text-[13px] leading-6' : 'font-[inherit] text-[15px] leading-8',
          )}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onDone(draft)}
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey) e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              onDone(joined)
            }
          }}
        />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onDone(draft)}
          className="lh-exp-raised lh-exp-press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <Check size={14} aria-hidden />
          {t(`${k}done_editing`, 'Done')}
        </button>
        <span className="text-[12px] text-neutral-400">{mono ? t(`${k}split_help_code`) : t(`${k}split_help_text`)}</span>
      </div>
    </div>
  )
}

/* ───────────────────────────── Learner ───────────────────────────── */

type Verdict = 'hit' | 'miss' | 'falseAlarm' | 'ok' | null

function verdictOf(seg: MistakeSegment, score: MistakeScore | null, selected: ReadonlySet<string>): Verdict {
  if (!score) return null
  if (score.hits.includes(seg.id)) return 'hit'
  if (score.misses.includes(seg.id)) return 'miss'
  if (score.falseAlarms.includes(seg.id)) return 'falseAlarm'
  return selected.has(seg.id) ? 'falseAlarm' : 'ok'
}

function SegmentButton({
  seg,
  kind,
  selected,
  verdict,
  onToggle,
  lineNo,
  order = 0,
}: {
  seg: MistakeSegment
  kind: SpotMistakeKind
  selected: boolean
  verdict: Verdict
  onToggle: () => void
  lineNo?: number
  /** Position among the marked segments, for the staggered reveal on Check. */
  order?: number
}) {
  const { t } = useTranslation()
  const k = 'activities.experiences.spot_mistake.'
  const checked = verdict !== null
  const code = kind === 'code'
  const icon =
    verdict === 'hit' ? <Check size={12} weight="bold" aria-hidden /> :
    verdict === 'miss' ? <MagnifyingGlass size={12} weight="bold" aria-hidden /> :
    verdict === 'falseAlarm' ? <X size={12} weight="bold" aria-hidden /> :
    !checked && selected ? <Flag size={12} weight="fill" aria-hidden /> : null
  const status =
    verdict === 'hit' ? t(`${k}status_hit`) :
    verdict === 'miss' ? t(`${k}status_miss`) :
    verdict === 'falseAlarm' ? t(`${k}status_false_alarm`) :
    !checked && selected ? t(`${k}status_flagged`) : ''

  // Highlighter ink per state; the swipe itself is .lh-exp-mark.
  const ink =
    verdict === 'hit' ? 'rgba(52, 211, 153, 0.45)' :
    verdict === 'miss' ? 'rgba(251, 113, 133, 0.42)' :
    !checked && selected ? 'rgba(250, 204, 21, 0.6)' : undefined
  const marked = verdict === 'hit' || verdict === 'miss' || (!checked && selected)
  return (
    <button
      type="button"
      aria-pressed={checked ? undefined : selected}
      aria-disabled={checked || undefined}
      onClick={() => !checked && onToggle()}
      data-marked={marked ? 'true' : undefined}
      style={
        {
          '--exp-mark': ink,
          '--exp-i': order,
          transitionDelay: checked && verdict === 'miss' ? `${order * 80}ms` : undefined,
        } as React.CSSProperties
      }
      className={cn(
        'lh-exp-mark group text-start outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50',
        code
          ? 'flex w-full items-start gap-3 rounded-md px-2 py-0.5 font-mono text-[13px] leading-6 whitespace-pre-wrap'
          : 'me-1 inline rounded-md px-0.5 py-0.5 text-[15px] leading-8',
        !checked && !selected && 'hover:bg-amber-50',
        !checked && selected && 'text-neutral-950',
        verdict === 'hit' && 'text-emerald-950',
        verdict === 'miss' && 'text-rose-950',
        verdict === 'falseAlarm' && 'text-neutral-500 line-through decoration-neutral-400',
        checked && 'cursor-default',
      )}
    >
      {code && lineNo !== undefined && (
        <span aria-hidden className="w-6 shrink-0 select-none text-end text-[11px] leading-6 text-neutral-400 tabular-nums">{lineNo}</span>
      )}
      {icon && (
        <span
          className={cn(
            'me-1 inline-flex h-4 w-4 translate-y-[2px] items-center justify-center rounded-full align-baseline text-white',
            code && 'mt-1 translate-y-0',
            checked && 'lh-exp-reveal-in',
            verdict === 'hit' && 'bg-emerald-600',
            verdict === 'miss' && 'bg-rose-600',
            verdict === 'falseAlarm' && 'bg-neutral-400',
            !checked && 'bg-orange-500',
          )}
        >
          {icon}
        </span>
      )}
      <span className={cn(code && 'min-w-0 flex-1')}>{seg.text}</span>
      {status && <span className="sr-only"> ({status})</span>}
    </button>
  )
}

function SpotMistakePlayer({
  segments,
  kind,
  selected,
  score,
  onToggle,
  onCheck,
}: {
  segments: MistakeSegment[]
  kind: SpotMistakeKind
  selected: ReadonlySet<string>
  score: MistakeScore | null
  onToggle: (_id: string) => void
  onCheck: () => void
}) {
  const { t } = useTranslation()
  const k = 'activities.experiences.spot_mistake.'
  const code = kind === 'code'
  const mistakes = segments.filter((s) => s.isMistake && !isBlankSegment(s))
  const falseAlarms = score ? segments.filter((s) => score.falseAlarms.includes(s.id)) : []

  return (
    <div className="flex flex-col gap-4">
      <div
        dir={code ? 'ltr' : 'auto'}
        className={cn(
          code ? 'overflow-x-auto rounded-xl bg-white py-2 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08))]' : 'text-neutral-800 [overflow-wrap:anywhere]',
        )}
        role="group"
        aria-label={t(`${k}passage_aria`)}
      >
        {segments.map((seg, index) => {
          const line = index + 1
          const order = segments.slice(0, index).filter((s) => !isBlankSegment(s) && (s.isMistake || selected.has(s.id))).length
          if (isBlankSegment(seg)) {
            return code ? (
              <div key={seg.id} className="flex gap-3 px-2 font-mono text-[13px] leading-6" aria-hidden>
                <span className="w-6 shrink-0 text-end text-[11px] text-neutral-400 tabular-nums">{line}</span>
              </div>
            ) : null
          }
          return (
            <SegmentButton
              key={seg.id}
              seg={seg}
              kind={kind}
              selected={selected.has(seg.id)}
              verdict={verdictOf(seg, score, selected)}
              onToggle={() => onToggle(seg.id)}
              lineNo={code ? line : undefined}
              order={order}
            />
          )
        })}
      </div>

      {!score ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="lh-exp-key" onClick={onCheck}>
            <Check size={13} weight="bold" aria-hidden />
            {t(`${k}check`)}
          </button>
          <span className="text-[13px] text-neutral-500">{t(`${k}flagged_count`, { n: selected.size })}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5 text-[12px] font-medium">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">
              <Check size={12} weight="bold" aria-hidden />
              {t(`${k}hits`, { n: score.hits.length })}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">
              <MagnifyingGlass size={12} weight="bold" aria-hidden />
              {t(`${k}misses`, { n: score.misses.length })}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
              <X size={12} weight="bold" aria-hidden />
              {t(`${k}false_alarms`, { n: score.falseAlarms.length })}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {mistakes.map((seg) => {
              const hit = score.hits.includes(seg.id)
              return (
                <li key={seg.id} className={cn('rounded-xl px-3 py-2.5 text-[13px]', hit ? 'bg-emerald-50/70' : 'bg-rose-50/70')}>
                  <div className="flex items-start gap-2">
                    {hit ? (
                      <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-emerald-600" role="img" aria-label={t(`${k}status_hit`)} />
                    ) : (
                      <MagnifyingGlass size={14} weight="bold" className="mt-0.5 shrink-0 text-rose-600" role="img" aria-label={t(`${k}status_miss`)} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-neutral-500 line-through decoration-neutral-400', code && 'font-mono text-[12.5px]')} dir={code ? 'ltr' : 'auto'}>
                        {seg.text}
                      </div>
                      {seg.correction && (
                        <div className={cn('mt-0.5 font-medium text-neutral-900', code && 'font-mono text-[12.5px]')} dir={code ? 'ltr' : 'auto'}>
                          <span className="sr-only">{t(`${k}correction`)}: </span>
                          {seg.correction}
                        </div>
                      )}
                      {seg.explanation && <p className="m-0 mt-1 text-neutral-600">{seg.explanation}</p>}
                    </div>
                  </div>
                </li>
              )
            })}
            {falseAlarms.map((seg) => (
              <li key={seg.id} className="rounded-xl bg-neutral-50 px-3 py-2.5 text-[13px]">
                <div className="flex items-start gap-2">
                  <X size={14} weight="bold" className="mt-0.5 shrink-0 text-neutral-500" role="img" aria-label={t(`${k}status_false_alarm`)} />
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-neutral-800', code && 'font-mono text-[12.5px]')} dir={code ? 'ltr' : 'auto'}>{seg.text}</div>
                    <p className="m-0 mt-0.5 text-neutral-500">{t(`${k}was_correct`)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── View ───────────────────────────── */

export default function SpotMistakeView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs<StoredAttrs>(props)
  const [preview, setPreview] = React.useState(false)
  const segments = React.useMemo(() => normalizeSegments(attrs.segments), [attrs.segments])
  const kind = normalizeKind(attrs.kind)
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const instructions = typeof attrs.instructions === 'string' ? attrs.instructions : ''
  const learner = !editable || preview
  const memory = useExperienceMemory(attrs.blockId, props)
  const k = 'activities.experiences.spot_mistake.'

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [score, setScore] = React.useState<MistakeScore | null>(null)
  const [best, setBest] = React.useState<Stars | null>(() => memory.read<Stars | null>('best', null))

  const reset = React.useCallback(() => {
    setSelected(new Set())
    setScore(null)
  }, [])
  useResetOn(`${preview}|${kind}|${JSON.stringify(segments)}`, reset)

  const check = () => {
    const s = scoreSelection(segments, selected)
    setScore(s)
    if (best === null || s.stars > best) {
      memory.write('best', s.stars)
      setBest(s.stars)
    }
  }

  const live = score
    ? t(`${k}result_live`, { hits: score.hits.length, total: score.totalMistakes, falseAlarms: score.falseAlarms.length })
    : ''
  const perfect = !!score && score.stars === 3

  const footer = learner && segments.length > 0 ? (
    <ExperienceFooter
      stars={score ? score.stars : undefined}
      score={score ? t(`${k}score`, { hits: score.hits.length, total: score.totalMistakes }) : undefined}
      onRetry={score || selected.size > 0 ? reset : undefined}
    >
      {best !== null && <span className="text-xs text-neutral-400">{t(`${k}best`, { stars: best })}</span>}
    </ExperienceFooter>
  ) : undefined

  const frame = {
    tone: 'dynamic' as const,
    icon: <MagnifyingGlass weight="duotone" />,
    title,
    onTitleChange: (v: string) => commit({ title: v }),
    titlePlaceholder: t('editor.experiences.spot_mistake.title_placeholder'),
    instructions,
    onInstructionsChange: (v: string) => commit({ instructions: v }),
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.spot_mistake.title'),
  }

  if (!learner) {
    const setKind = (next: SpotMistakeKind) =>
      commit((live) => {
        const liveSegments = normalizeSegments(live.segments)
        const text = joinSegments(liveSegments, normalizeKind(live.kind))
        return { kind: next, segments: resplit(liveSegments, text, next) }
      })
    const settings = (
      <SettingsGear>
        <SettingsField label={t('editor.experiences.spot_mistake.kind_label')}>
          <Segmented<SpotMistakeKind>
            value={kind}
            ariaLabel={t('editor.experiences.spot_mistake.kind_label')}
            onChange={setKind}
            options={[
              { value: 'text', label: <><TextAlignLeft size={13} aria-hidden />{t('editor.experiences.spot_mistake.kind_text')}</> },
              { value: 'code', label: <><Code size={13} aria-hidden />{t('editor.experiences.spot_mistake.kind_code')}</> },
            ]}
          />
        </SettingsField>
      </SettingsGear>
    )
    return (
      <NodeViewWrapper className="block-exp-spot-mistake">
        <ExperienceFrame {...frame} wysiwyg headerEnd={settings} footer={<AnswerKeyHint />}>
          <SpotMistakeEditor segments={segments} kind={kind} commit={commit} />
        </ExperienceFrame>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="block-exp-spot-mistake">
      <ExperienceFrame {...frame} footer={footer} celebrate={perfect} live={live}>
        {segments.length === 0 ? (
          <p className="m-0 text-sm text-neutral-500">{t(`${k}empty`)}</p>
        ) : (
          <SpotMistakePlayer
            segments={segments}
            kind={kind}
            selected={selected}
            score={score}
            onToggle={(id) => setSelected((prev) => toggleSelection(prev, id))}
            onCheck={check}
          />
        )}
      </ExperienceFrame>
    </NodeViewWrapper>
  )
}
