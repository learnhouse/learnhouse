'use client'
/*
 "Reflection" (node expReflect): write an answer in your own words, then
 compare it with a model answer and tick the key points you covered
 (self-explanation).

 Author: edit in place: the prompt, guiding questions and writing well as
 learners see them, then the answer key (model answer, key points) under a
 quiet label. The word goal lives behind the gear.

 Learner: the prompt, "Need a start?" hints, a writing well with a live word
 count toward the goal. The draft is saved on this device only
 (useExperienceMemory), never in the document. Once the goal is reached, the
 main key unfolds the model answer like a note and shows the key points as
 check toggles; ticked / total is the score.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { CaretDown, Check, CheckCircle, Key, Lightbulb, LockSimple, Note, NotePencil } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS, SettingsField } from '../../../Blocks/ui/BlockChrome'
import {
  AddGhost,
  AnswerKeyHint,
  EDIT_OBJECT,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  RemoveX,
  SettingsGear,
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
import { InlineHint, NotReady, contentKey, type Issue } from '../Sort/kit'

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

// ─── Author: edit in place ──────────────────────────────────────────────────
// The learner's prompt, "Need a start?" questions and writing well, then the
// answer key below a quiet label: the model answer note and the key points,
// all edited where they sit. The word goal lives behind the gear.

const ISSUE_FALLBACK: Record<string, string> = {
  empty_prompt: 'Write the prompt learners respond to.',
  too_many_guiding: 'Use at most 5 guiding questions; learners only see the first 5.',
  too_many_points: 'Use at most 8 key points; learners only see the first 8.',
  empty_guiding: 'This question is empty; learners will not see it.',
  empty_point: 'This key point is empty; learners will not see it.',
  nothing_to_compare: 'Add a model answer or key points so learners have something to compare with.',
}

function ReflectEditor({ data, commit, frame }: { data: ReflectData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const k = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`editor.experiences.reflect.${key}`, { ...o, defaultValue: fallback })
  const a = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`activities.experiences.reflect.${key}`, { ...o, defaultValue: fallback })
  const issues: Issue[] = React.useMemo(
    () => validateReflect(data).map((i) => ({ code: i.code, severity: i.severity, id: i.list ? `${i.list}:${i.index}` : undefined })),
    [data],
  )
  const issueText = (code: string) => t(`editor.experiences.reflect.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const focusLater = (sel: string) => requestAnimationFrame(() => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(sel)?.focus()))
  const editList = (key: 'guidingQuestions' | 'checklist', fn: (_live: string[]) => string[]) => commit((live) => ({ [key]: fn(normalizeReflect(live)[key]) }))
  const hintsFor = (id: string) =>
    issues
      .filter((x) => x.id === id)
      .map((x) => (
        <InlineHint key={x.code} severity={x.severity}>
          {issueText(x.code)}
        </InlineHint>
      ))

  const settings = (
    <SettingsGear>
      <SettingsField label={k('min_words_label', 'Minimum words')} hint={k('min_words_hint', 'Learners can compare once they reach this. 0 lets them compare straight away.')}>
        <CommitInput
          type="number"
          inputMode="numeric"
          min={REFLECT_LIMITS.minWords}
          max={REFLECT_LIMITS.maxWords}
          value={String(data.minWords)}
          onCommit={(v) => v.trim() !== '' && commit({ minWords: clampMinWords(v) })}
          className={cn(FIELD_CLASS, 'tabular-nums')}
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
      titlePlaceholder={k('title_placeholder', 'Name this reflection')}
      headerEnd={settings}
      footer={<AnswerKeyHint />}
    >
      <div ref={rootRef} className="flex flex-col gap-4">
        {issues
          .filter((x) => !x.id)
          .map((x) => (
            <InlineHint key={x.code} severity={x.severity}>
              {issueText(x.code)}
            </InlineHint>
          ))}
        <InlineText
          multiline
          value={data.prompt}
          onCommit={(prompt) => commit({ prompt })}
          ariaLabel={k('prompt_heading', 'Prompt')}
          placeholder={k('prompt_placeholder', 'What should learners explain in their own words?')}
          maxLength={600}
          className="text-[16px] leading-relaxed font-semibold text-neutral-900 [overflow-wrap:anywhere]"
        />

        {/* "Need a start?": the guiding questions, shown open. */}
        <div className="flex flex-col gap-2">
          <span className="lh-exp-raised inline-flex h-8 items-center gap-1.5 self-start rounded-lg px-2.5 text-[13px] font-medium text-amber-800">
            <Lightbulb size={14} weight="fill" aria-hidden />
            {a('need_start', 'Need a start?')}
            <span className="text-[12px] font-normal text-amber-700/70">{k('guiding_optional', 'optional')}</span>
          </span>
          <ul aria-label={k('guiding_heading', 'Guiding questions')} className="m-0 flex list-none flex-col gap-1.5 rounded-xl bg-amber-50/70 p-3">
            {data.guidingQuestions.map((g, i) => (
              <li key={i} data-guiding={i} className={cn('relative flex flex-col gap-0.5', EDIT_OBJECT)}>
                <span className="flex items-start gap-2 text-[13.5px] leading-relaxed text-amber-950">
                  <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  <InlineText
                    value={g}
                    onCommit={(v) => editList('guidingQuestions', (live) => updateEntry(live, i, v))}
                    ariaLabel={k('guiding_label', 'Guiding question {{n}}', { n: i + 1 })}
                    placeholder={k('guiding_placeholder', 'Question {{n}}', { n: i + 1 })}
                    maxLength={200}
                    className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                  />
                  <RemoveX onClick={() => editList('guidingQuestions', (live) => removeEntry(live, i))} label={k('remove_guiding', 'Remove question {{n}}', { n: i + 1 })} />
                </span>
                {hintsFor(`guiding:${i}`)}
              </li>
            ))}
            {data.guidingQuestions.length < REFLECT_LIMITS.maxGuiding && (
              <li>
                <AddGhost
                  onClick={() => {
                    editList('guidingQuestions', (live) => addEntry(live, REFLECT_LIMITS.maxGuiding))
                    focusLater(`[data-guiding="${data.guidingQuestions.length}"] textarea`)
                  }}
                  iconSize={12}
                  className="h-8 rounded-lg px-2.5 text-[12.5px]"
                >
                  {k('add_guiding', 'Add question')}
                </AddGhost>
              </li>
            )}
          </ul>
        </div>

        {/* The writing well, as learners get it. */}
        <div aria-hidden className="lh-exp-well flex flex-col rounded-2xl">
          <div className="lh-exp-paper-lines min-h-24 px-4 pt-3.5 pb-2 text-[15px] leading-7 text-neutral-400">{a('placeholder', 'Start writing in your own words…')}</div>
          <div className="flex items-center gap-3 px-4 pt-1 pb-3">
            {data.minWords > 0 ? <div className="h-1.5 flex-1 rounded-full bg-black/[0.06]" /> : <span className="flex-1" />}
            <span className="shrink-0 text-[12px] font-medium tabular-nums text-neutral-500">
              {data.minWords > 0 ? a('words_progress', '{{n}} of {{min}} words', { n: 0, min: data.minWords }) : a('words_count', 'Words: {{n}}', { n: 0 })}
            </span>
          </div>
        </div>

        {/* The answer key: shown after learners write. */}
        <div className="flex flex-col gap-3 pt-1">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-400">
            <Key size={13} weight="duotone" aria-hidden className="text-amber-500" />
            {k('answer_key', 'Answer key')}
          </span>
          <article className="lh-exp-note relative rounded-xl px-4 pt-3.5 pb-4">
            <h4 className="m-0 mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-rose-700">
              <Note size={15} weight="duotone" aria-hidden />
              {a('model_title', 'Model answer')}
            </h4>
            <InlineText
              multiline
              value={data.modelAnswer}
              onCommit={(modelAnswer) => commit({ modelAnswer })}
              ariaLabel={k('model_heading', 'Model answer')}
              placeholder={k('model_placeholder', 'A good answer, in a few sentences')}
              maxLength={2000}
              className="text-[14.5px] leading-7 text-neutral-800 [overflow-wrap:anywhere]"
            />
          </article>
          <div className="flex flex-col gap-2">
            <h4 className="m-0 text-[14px] font-semibold text-neutral-800">{a('checklist_title', 'Which key points did you cover?')}</h4>
            <ul aria-label={k('checklist_heading', 'Key points')} className="m-0 flex list-none flex-col gap-2 p-0">
              {data.checklist.map((point, i) => (
                <li key={i} data-point={i} className="flex flex-col gap-1">
                  <div className={cn('lh-exp-raised relative flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-[14px] text-neutral-800', EDIT_OBJECT)}>
                    <span aria-hidden className="lh-exp-well inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-transparent">
                      <Check size={12} weight="bold" />
                    </span>
                    <InlineText
                      value={point}
                      onCommit={(v) => editList('checklist', (live) => updateEntry(live, i, v))}
                      ariaLabel={k('point_label', 'Key point {{n}}', { n: i + 1 })}
                      placeholder={k('point_placeholder', 'Key point {{n}}', { n: i + 1 })}
                      maxLength={200}
                      className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                    />
                    <RemoveX floating onClick={() => editList('checklist', (live) => removeEntry(live, i))} label={k('remove_point', 'Remove key point {{n}}', { n: i + 1 })} />
                  </div>
                  {hintsFor(`checklist:${i}`)}
                </li>
              ))}
              {data.checklist.length < REFLECT_LIMITS.maxChecklist && (
                <li>
                  <AddGhost
                    onClick={() => {
                      editList('checklist', (live) => addEntry(live, REFLECT_LIMITS.maxChecklist))
                      focusLater(`[data-point="${data.checklist.length}"] textarea`)
                    }}
                    className="min-h-11 w-full rounded-xl px-3 text-[14px]"
                  >
                    {k('add_point', 'Add key point')}
                  </AddGhost>
                </li>
              )}
            </ul>
          </div>
        </div>
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
