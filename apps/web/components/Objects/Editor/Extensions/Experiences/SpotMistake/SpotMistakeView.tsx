'use client'
/*
 Spot the mistake: a passage split into sentences (or code lines). Learners
 flag the parts they think are wrong; Check shows hits, missed mistakes and
 false alarms, with the corrections and explanations. Authors paste the
 passage once and toggle "this is a mistake" per segment.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Check, Code, Flag, MagnifyingGlass, TextAlignLeft, WarningCircle, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, Segmented, TEXTAREA_CLASS } from '../../../Blocks/ui/BlockChrome'
import {
  ExperienceFooter,
  ExperienceFrame,
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
  const joined = joinSegments(segments, kind)
  const [draft, setDraft] = React.useState(joined)
  const editing = React.useRef(false)
  React.useEffect(() => {
    if (!editing.current) setDraft(joined)
  }, [joined])

  const commitSegments = (fn: (_live: MistakeSegment[], _liveKind: SpotMistakeKind) => MistakeSegment[]) =>
    commit((live) => ({ segments: fn(normalizeSegments(live.segments), normalizeKind(live.kind)) }))

  const applyText = (value: string) => commitSegments((live, liveKind) => resplit(live, value, liveKind))

  const setKind = (next: SpotMistakeKind) => {
    commit((live) => {
      const liveSegments = normalizeSegments(live.segments)
      const text = joinSegments(liveSegments, normalizeKind(live.kind))
      return { kind: next, segments: resplit(liveSegments, text, next) }
    })
  }

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
  const mono = kind === 'code'
  // Author-facing numbers skip blank code lines.
  const numbers = new Map<string, number>()
  segments.filter((s) => !isBlankSegment(s)).forEach((s, i) => numbers.set(s.id, i + 1))

  return (
    <div className="flex flex-col gap-3">
      <div className="w-full sm:w-64">
        <Segmented<SpotMistakeKind>
          value={kind}
          ariaLabel={t(`${k}kind_label`)}
          onChange={setKind}
          options={[
            { value: 'text', label: <><TextAlignLeft size={13} aria-hidden />{t(`${k}kind_text`)}</> },
            { value: 'code', label: <><Code size={13} aria-hidden />{t(`${k}kind_code`)}</> },
          ]}
        />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600">{t(`${k}passage_label`)}</span>
        <textarea
          value={draft}
          rows={mono ? 7 : 5}
          dir={mono ? 'ltr' : 'auto'}
          spellCheck={!mono}
          className={cn(TEXTAREA_CLASS, mono && 'font-mono text-[12.5px] leading-6')}
          placeholder={mono ? t(`${k}passage_placeholder_code`) : t(`${k}passage_placeholder_text`)}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            editing.current = false
            if (draft !== joined) applyText(draft)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              setDraft(joined)
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
        />
        <span className="text-[11px] leading-snug text-neutral-400">{mono ? t(`${k}split_help_code`) : t(`${k}split_help_text`)}</span>
      </label>

      <ol className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={t(`${k}segments_label`)}>
        {segments.map((seg) => {
          if (isBlankSegment(seg)) return null
          const n = numbers.get(seg.id) ?? 0
          return (
            <li
              key={seg.id}
              className={cn(
                'rounded-xl px-2.5 py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.07)]',
                seg.isMistake && 'bg-orange-50/60 shadow-[0_0_0_1px_rgba(234,88,12,0.35)]',
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  aria-pressed={seg.isMistake}
                  onClick={() => commitSegments((live) => toggleMistake(live, seg.id))}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-500/40',
                    seg.isMistake ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800',
                  )}
                >
                  {seg.isMistake ? <Flag size={12} weight="fill" aria-hidden /> : <Check size={12} weight="bold" aria-hidden />}
                  {seg.isMistake ? t(`${k}is_mistake`) : t(`${k}is_correct`)}
                </button>
                <span className="sr-only">{t(`${k}segment_n`, { n })}</span>
                <span
                  dir={mono ? 'ltr' : 'auto'}
                  className={cn('min-w-0 flex-1 pt-1 text-[13px] leading-relaxed text-neutral-800 [overflow-wrap:anywhere]', mono && 'font-mono text-[12.5px] whitespace-pre-wrap')}
                >
                  {seg.text}
                </span>
              </div>
              {seg.isMistake && (
                <div className="mt-2 flex flex-col gap-1.5 ps-2 sm:ps-[5.5rem]">
                  <CommitInput
                    value={seg.correction ?? ''}
                    placeholder={t(`${k}correction_placeholder`)}
                    aria-label={t(`${k}correction_label`, { n })}
                    className={cn(
                      'h-8 w-full rounded-lg bg-white px-2.5 text-[13px] text-neutral-800 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none placeholder:text-neutral-400 focus:shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_0_3px_rgba(0,0,0,0.05)]',
                      mono && 'font-mono text-[12.5px]',
                    )}
                    onCommit={(v) => commitSegments((live) => live.map((s) => (s.id === seg.id ? { ...s, correction: v } : s)))}
                  />
                  {!(seg.correction ?? '').trim() && <span className="text-[11px] text-amber-700">{t(`${k}hint_correction_short`)}</span>}
                  <CommitInput
                    value={seg.explanation ?? ''}
                    placeholder={t(`${k}explanation_placeholder`)}
                    aria-label={t(`${k}explanation_label`, { n })}
                    onCommit={(v) => commitSegments((live) => live.map((s) => (s.id === seg.id ? { ...s, explanation: v } : s)))}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {issues.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite">
          {issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
              <WarningCircle size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
              {hint(issue)}
            </li>
          ))}
        </ul>
      )}
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

  return (
    <NodeViewWrapper className="block-exp-spot-mistake">
      <ExperienceFrame
        tone="dynamic"
        icon={<MagnifyingGlass weight="duotone" />}
        title={title}
        onTitleChange={(v) => commit({ title: v })}
        titlePlaceholder={t('editor.experiences.spot_mistake.title_placeholder')}
        instructions={instructions}
        onInstructionsChange={(v) => commit({ instructions: v })}
        editable={editable}
        preview={preview}
        onPreviewChange={setPreview}
        nodeView={props}
        label={t('editor.experiences.spot_mistake.title')}
        footer={footer}
        celebrate={learner && perfect}
        live={learner ? live : ''}
      >
        {!learner ? (
          <SpotMistakeEditor segments={segments} kind={kind} commit={commit} />
        ) : segments.length === 0 ? (
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
