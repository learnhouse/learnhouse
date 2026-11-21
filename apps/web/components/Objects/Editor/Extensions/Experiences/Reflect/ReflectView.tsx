'use client'
/*
 "Reflection" (node expReflect): write an answer in your own words, then
 compare it with a model answer and tick the key points you covered
 (self-explanation).

 Author: a single-column form (prompt, optional guiding questions, a word
 goal, an optional model answer, key points) with inline hints, and
 "Preview as learner" in the frame header.

 Learner: the prompt, "Need a start?" hints, a writing well with a live word
 count toward the goal. The draft is saved on this device only
 (useExperienceMemory), never in the document. Once the goal is reached, the
 main key unfolds the model answer like a note and shows the key points as
 check toggles; ticked / total is the score.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { CaretDown, Check, CheckCircle, Lightbulb, LockSimple, Note, NotePencil, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS, TEXTAREA_CLASS } from '../../../Blocks/ui/BlockChrome'
import {
  ExperienceFooter,
  ExperienceFrame,
  buzz,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  REFLECT_LIMITS,
  addEntry,
  clampMinWords,
  countWords,
  goalProgress,
  isPlayable,
  normalizeReflect,
  playableReflect,
  reachedGoal,
  removeEntry,
  scoreReflect,
  updateEntry,
  validateReflect,
  type ReflectData,
} from './reflectModel'
import { AddRowButton, BlockHints, FormSection, ICON_BTN, NotReady, RowHints, contentKey, type Issue } from '../Sort/kit'

const TONE = 'document' as const

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

export default function ReflectView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeReflect(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <NotePencil weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.reflect.title', 'Reflection'),
  }
  const playable = React.useMemo(() => playableReflect(data), [data])
  return (
    <NodeViewWrapper className="block-exp-reflect">
      {editable && !preview ? (
        <ReflectEditor data={data} commit={commit} frame={frame} />
      ) : (
        <ReflectPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author form ────────────────────────────────────────────────────────────

const ISSUE_FALLBACK: Record<string, string> = {
  empty_prompt: 'Write the prompt learners respond to.',
  too_many_guiding: 'Use at most 5 guiding questions; learners only see the first 5.',
  too_many_points: 'Use at most 8 key points; learners only see the first 8.',
  empty_guiding: 'This question is empty; learners will not see it.',
  empty_point: 'This key point is empty; learners will not see it.',
  nothing_to_compare: 'Add a model answer or key points so learners have something to compare with.',
}

function ListEditor({
  items,
  max,
  list,
  issues,
  issueText,
  placeholder,
  label,
  removeLabel,
  addLabel,
  onChange,
}: {
  items: string[]
  max: number
  list: 'guiding' | 'checklist'
  issues: Issue[]
  issueText: (_code: string) => string
  placeholder: (_n: number) => string
  label: (_n: number) => string
  removeLabel: (_n: number) => string
  addLabel: string
  onChange: (_fn: (_live: string[]) => string[]) => void
}) {
  return (
    <>
      {items.map((value, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-neutral-400">
              {list === 'checklist' ? <Check size={12} weight="bold" className="mx-auto" /> : i + 1}
            </span>
            <CommitInput
              value={value}
              onCommit={(v) => onChange((live) => updateEntry(live, i, v))}
              placeholder={placeholder(i + 1)}
              aria-label={label(i + 1)}
              maxLength={200}
              className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1')}
            />
            <button type="button" className={ICON_BTN} onClick={() => onChange((live) => removeEntry(live, i))} aria-label={removeLabel(i + 1)} title={removeLabel(i + 1)}>
              <Trash size={15} aria-hidden />
            </button>
          </div>
          <RowHints issues={issues} id={`${list}:${i}`} text={issueText} />
        </div>
      ))}
      <AddRowButton disabled={items.length >= max} onClick={() => onChange((live) => addEntry(live, max))}>
        {addLabel}
      </AddRowButton>
    </>
  )
}

function ReflectEditor({ data, commit, frame }: { data: ReflectData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const k = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`editor.experiences.reflect.${key}`, { ...o, defaultValue: fallback })
  const issues: Issue[] = React.useMemo(
    () => validateReflect(data).map((i) => ({ code: i.code, severity: i.severity, id: i.list ? `${i.list}:${i.index}` : undefined })),
    [data],
  )
  const issueText = (code: string) => t(`editor.experiences.reflect.issues.${code}`, ISSUE_FALLBACK[code] ?? code)

  return (
    <ExperienceFrame {...frame} title={data.title} onTitleChange={(title) => commit({ title })} titlePlaceholder={k('title_placeholder', 'Name this reflection')}>
      <div className="flex flex-col gap-5">
        <BlockHints issues={issues} text={issueText} />

        <FormSection title={k('prompt_heading', 'Prompt')}>
          <CommitInput
            multiline
            value={data.prompt}
            onCommit={(prompt) => commit({ prompt })}
            placeholder={k('prompt_placeholder', 'What should learners explain in their own words?')}
            aria-label={k('prompt_heading', 'Prompt')}
            className={cn(TEXTAREA_CLASS, 'min-h-[64px] resize-y text-[14px]')}
          />
        </FormSection>

        <FormSection title={k('guiding_heading', 'Guiding questions')} hint={k('guiding_hint', 'Optional hints learners can open if they are stuck (up to 5).')}>
          <ListEditor
            items={data.guidingQuestions}
            max={REFLECT_LIMITS.maxGuiding}
            list="guiding"
            issues={issues}
            issueText={issueText}
            placeholder={(n) => k('guiding_placeholder', 'Question {{n}}', { n })}
            label={(n) => k('guiding_label', 'Guiding question {{n}}', { n })}
            removeLabel={(n) => k('remove_guiding', 'Remove question {{n}}', { n })}
            addLabel={k('add_guiding', 'Add question')}
            onChange={(fn) => commit((live) => ({ guidingQuestions: fn(normalizeReflect(live).guidingQuestions) }))}
          />
        </FormSection>

        <FormSection title={k('min_words_label', 'Minimum words')} hint={k('min_words_hint', 'Learners can compare once they reach this. 0 lets them compare straight away.')}>
          <CommitInput
            type="number"
            inputMode="numeric"
            min={REFLECT_LIMITS.minWords}
            max={REFLECT_LIMITS.maxWords}
            value={String(data.minWords)}
            onCommit={(v) => v.trim() !== '' && commit({ minWords: clampMinWords(v) })}
            aria-label={k('min_words_label', 'Minimum words')}
            className={cn(FIELD_CLASS, 'h-9 w-28 tabular-nums')}
          />
        </FormSection>

        <FormSection title={k('model_heading', 'Model answer')} hint={k('model_hint', 'Optional. Learners see it after writing their own.')}>
          <CommitInput
            multiline
            value={data.modelAnswer}
            onCommit={(modelAnswer) => commit({ modelAnswer })}
            placeholder={k('model_placeholder', 'A good answer, in a few sentences')}
            aria-label={k('model_heading', 'Model answer')}
            className={cn(TEXTAREA_CLASS, 'min-h-[88px] resize-y')}
          />
        </FormSection>

        <FormSection title={k('checklist_heading', 'Key points')} hint={k('checklist_hint', 'Learners tick the points they covered; that becomes their score (up to 8).')}>
          <ListEditor
            items={data.checklist}
            max={REFLECT_LIMITS.maxChecklist}
            list="checklist"
            issues={issues}
            issueText={issueText}
            placeholder={(n) => k('point_placeholder', 'Key point {{n}}', { n })}
            label={(n) => k('point_label', 'Key point {{n}}', { n })}
            removeLabel={(n) => k('remove_point', 'Remove key point {{n}}', { n })}
            addLabel={k('add_point', 'Add key point')}
            onChange={(fn) => commit((live) => ({ checklist: fn(normalizeReflect(live).checklist) }))}
          />
        </FormSection>
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner ────────────────────────────────────────────────────────────────

const SAVE_DELAY_MS = 500

function ReflectPlayer({ data, frame, source }: { data: ReflectData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const k = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`activities.experiences.reflect.${key}`, { ...o, defaultValue: fallback })
  const memory = useExperienceMemory(data.blockId, source)
  const [text, setText] = React.useState<string>(() => memory.read<string>('draft', ''))
  const [revealed, setRevealed] = React.useState<boolean>(() => memory.read<boolean>('revealed', false))
  const [ticked, setTicked] = React.useState<number[]>(() => memory.read<number[]>('ticked', []))
  const [hintsOpen, setHintsOpen] = React.useState(false)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [live, setLive] = React.useState('')
  const areaRef = React.useRef<HTMLTextAreaElement>(null)
  const uid = React.useId()

  const words = React.useMemo(() => countWords(text), [text])
  const ready = reachedGoal(words, data.minWords)
  const hasCompare = !!data.modelAnswer.trim() || data.checklist.length > 0
  const score = scoreReflect(ticked, data.checklist.length)

  // Save the draft shortly after typing stops (and on blur, below).
  React.useEffect(() => {
    const id = window.setTimeout(() => memory.write('draft', text), SAVE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [text, memory])

  // Announce once when the goal is reached.
  const wasReady = React.useRef(ready)
  React.useEffect(() => {
    if (ready && !wasReady.current && data.minWords > 0) setLive(k('live_ready', 'You have written enough to compare.'))
    wasReady.current = ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // The writing well grows with its text.
  React.useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 144)}px`
  }, [text, revealed])

  React.useEffect(() => {
    if (!confirmClear) return
    const id = window.setTimeout(() => setConfirmClear(false), 3000)
    return () => window.clearTimeout(id)
  }, [confirmClear])

  if (!isPlayable(data)) {
    return (
      <ExperienceFrame {...frame} title={data.title}>
        <NotReady>{k('not_ready', 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const reveal = () => {
    if (!ready) return
    memory.write('draft', text)
    setRevealed(true)
    memory.write('revealed', true)
    buzz('correct')
    setLive(hasCompare ? k('live_revealed', 'The model answer is open below your text.') : k('completed_note', 'Done. Read it through once more and keep what you missed in mind.'))
  }

  const toggle = (i: number) => {
    const next = ticked.includes(i) ? ticked.filter((x) => x !== i) : [...ticked, i].sort((a, b) => a - b)
    setTicked(next)
    memory.write('ticked', next)
    const s = scoreReflect(next, data.checklist.length)
    if (s) setLive(k('covered', 'Covered: {{n}} of {{total}}', { n: s.ticked, total: s.total }))
  }

  const writeAgain = () => {
    setRevealed(false)
    setTicked([])
    memory.write('revealed', false)
    memory.write('ticked', [])
    setLive('')
    window.requestAnimationFrame(() => areaRef.current?.focus({ preventScroll: true }))
  }

  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    setText('')
    memory.remove('draft')
    writeAgain()
    setLive(k('cleared', 'Your draft was cleared.'))
  }

  const pct = Math.round(goalProgress(words, data.minWords) * 100)
  const allTicked = !!score && score.ticked === score.total

  const footer = (
    <ExperienceFooter
      stars={revealed && score ? score.stars : undefined}
      score={revealed && score ? `${score.ticked} / ${score.total}` : undefined}
      onRetry={revealed ? writeAgain : undefined}
      retryLabel={k('write_again', 'Edit my answer')}
    />
  )

  return (
    <ExperienceFrame {...frame} title={data.title} footer={footer} celebrate={revealed && allTicked} live={live}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[16px] leading-relaxed font-semibold text-neutral-900 [overflow-wrap:anywhere]" id={`${uid}-prompt`}>
          {data.prompt}
        </p>

        {data.guidingQuestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={hintsOpen}
              aria-controls={`${uid}-hints`}
              onClick={() => setHintsOpen((v) => !v)}
              className="lh-exp-raised lh-exp-press inline-flex h-8 items-center gap-1.5 self-start rounded-lg px-2.5 text-[13px] font-medium text-amber-800"
            >
              <Lightbulb size={14} weight={hintsOpen ? 'fill' : 'bold'} aria-hidden />
              {k('need_start', 'Need a start?')}
              <CaretDown size={12} weight="bold" aria-hidden className={cn('transition-transform motion-reduce:transition-none', hintsOpen && 'rotate-180')} />
            </button>
            {hintsOpen && (
              <ul id={`${uid}-hints`} className="lh-exp-slide-in m-0 flex list-none flex-col gap-1.5 rounded-xl bg-amber-50/70 p-3 ps-3">
                {data.guidingQuestions.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13.5px] leading-relaxed text-amber-950">
                    <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{g}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="lh-exp-well flex flex-col rounded-2xl">
          <label htmlFor={`${uid}-area`} className="sr-only">
            {k('write_label', 'Your answer')}
          </label>
          <textarea
            id={`${uid}-area`}
            ref={areaRef}
            value={text}
            readOnly={revealed}
            aria-describedby={`${uid}-prompt ${uid}-count`}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => memory.write('draft', text)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={k('placeholder', 'Start writing in your own words…')}
            spellCheck
            dir="auto"
            className={cn(
              'lh-exp-paper-lines block min-h-36 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-7 text-neutral-900 outline-none placeholder:text-neutral-400',
              revealed && 'text-neutral-700',
            )}
          />
          <div className="flex items-center gap-3 px-4 pt-1 pb-3">
            {data.minWords > 0 ? (
              <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                <div
                  className={cn('lh-exp-progress-fill h-full rounded-full', ready ? 'bg-emerald-500' : 'bg-rose-400')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            ) : (
              <span className="flex-1" />
            )}
            <span id={`${uid}-count`} className={cn('flex shrink-0 items-center gap-1 text-[12px] font-medium tabular-nums', ready && data.minWords > 0 ? 'text-emerald-700' : 'text-neutral-500')}>
              {ready && data.minWords > 0 && <CheckCircle size={13} weight="fill" aria-hidden />}
              {data.minWords > 0 && words < data.minWords
                ? k('words_progress', '{{n}} of {{min}} words', { n: words, min: data.minWords })
                : k('words_count', 'Words: {{n}}', { n: words })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-neutral-500">
            <LockSimple size={13} weight="bold" aria-hidden className="shrink-0" />
            {k('private_note', 'Only you can see this. It is saved on this device.')}
          </span>
          {text.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className={cn('lh-exp-raised lh-exp-press inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium', confirmClear ? 'text-rose-700' : 'text-neutral-600')}
            >
              {confirmClear ? k('clear_confirm', 'Tap again to clear') : k('clear', 'Clear')}
            </button>
          )}
        </div>

        {!revealed ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={reveal} disabled={!ready} className="lh-exp-key">
              {hasCompare ? k('compare', 'Compare with the model answer') : k('done', 'I’m done')}
            </button>
            {!ready && <span className="text-[13px] text-neutral-500">{k('need_words', 'Write at least {{n}} words to continue.', { n: data.minWords })}</span>}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {data.modelAnswer.trim() && (
              <article className="lh-exp-note lh-exp-unfold relative rounded-xl px-4 pt-3.5 pb-4" aria-labelledby={`${uid}-model`}>
                <h4 id={`${uid}-model`} className="m-0 mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-rose-700">
                  <Note size={15} weight="duotone" aria-hidden />
                  {k('model_title', 'Model answer')}
                </h4>
                <p className="m-0 text-[14.5px] leading-7 whitespace-pre-line text-neutral-800 [overflow-wrap:anywhere]">{data.modelAnswer}</p>
              </article>
            )}
            {data.checklist.length > 0 && (
              <div className="lh-exp-reveal-in flex flex-col gap-2" style={{ '--exp-i': 3 } as React.CSSProperties}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="m-0 text-[14px] font-semibold text-neutral-800">{k('checklist_title', 'Which key points did you cover?')}</h4>
                  {score && (
                    <span className="text-[12.5px] font-medium tabular-nums text-neutral-500">{k('covered', 'Covered: {{n}} of {{total}}', { n: score.ticked, total: score.total })}</span>
                  )}
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {data.checklist.map((point, i) => {
                    const on = ticked.includes(i)
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => toggle(i)}
                          className={cn(
                            'lh-exp-raised lh-exp-press flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-[14px] outline-none',
                            on ? 'lh-exp-tint text-emerald-800' : 'text-neutral-800',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                              on ? 'lh-exp-snap bg-emerald-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]' : 'lh-exp-well text-transparent',
                            )}
                          >
                            <Check size={12} weight="bold" />
                          </span>
                          <span className="min-w-0 [overflow-wrap:anywhere]">{point}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {!hasCompare && (
              <p className="m-0 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-900">
                <CheckCircle size={16} weight="fill" aria-hidden className="shrink-0 text-emerald-600" />
                {k('completed_note', 'Done. Read it through once more and keep what you missed in mind.')}
              </p>
            )}
          </div>
        )}
      </div>
    </ExperienceFrame>
  )
}
