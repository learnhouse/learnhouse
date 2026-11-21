'use client'
/*
 "Label the diagram" (node expLabel): learners put labels on numbered pins on
 an image. Pin coordinates are percentages of the image, so the block is
 responsive. The image stage always uses physical left/top: the picture is
 never mirrored in RTL, so neither are its pins.

 Author: the same image flow as Hotspot (upload, link or replace), click the
 picture to add a pin, drag pins or nudge them with the arrow keys, name each
 pin, add up to 4 wrong labels.

 Learner: a bank of label chips (the pin labels plus the wrong ones,
 shuffled). Drag a chip onto a pin or onto its numbered slot under the
 picture, or tap a chip and then a pin / slot. Placed labels can be picked up
 again. Keyboard: Tab to a pin, arrow keys move between pins, Enter / Space
 opens a list of labels to choose from. "Check" marks every pin ✓ / ✗.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowCounterClockwise, ArrowsClockwise, Check, DotsSixVertical, Image as ImageIcon, Tag, Trash, Tray, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'
import MediaSourcePicker from '../../../Blocks/ui/MediaSourcePicker'
import { useBlockUpload } from '../../../Blocks/media/useBlockUpload'
import { acceptFor } from '../../../Blocks/media/mediaKinds'
import { fetchRemoteFile, UrlImportError } from '../../../Blocks/media/urlImport'
import { normalizeUserUrl } from '../../../Blocks/embeds/embedProviders'
import { uploadErrorText } from '../../../Blocks/media/uploadMessages'
import { pickFile } from '../../../Blocks/nodeViewUtils'
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
  LABEL_LIMITS,
  addDistractor,
  addPin,
  allLabelled,
  bankOrder,
  checkLabel,
  isPlayable,
  labelBank,
  movePin,
  normalizeLabel,
  nudgePin,
  pinOfChip,
  placeLabel,
  playableLabel,
  pointToPercent,
  removeDistractor,
  removePin,
  retryWrong,
  unplacedChips,
  updateDistractor,
  updatePin,
  validateLabel,
  type LabelCheck,
  type LabelData,
  type LabelPlacement,
} from './labelModel'
import { AddRowButton, BlockHints, DragGhost, FormSection, ICON_BTN, InlineHint, NotReady, ResultIcon, contentKey } from '../Sort/kit'
import { focusSibling, useTapDrag } from '../Sort/useTapDrag'

const TONE = 'embed' as const
const BANK = '__bank__'

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

/** Resolve the image: an uploaded file (like blockImage) wins over a plain URL. */
function useImageSrc(data: LabelData, activityUuid: string | undefined): string {
  const org = useOrg() as any
  const course = useCourse() as any
  const obj = data.imageObject as any
  const blockActivity = obj?.content?.activity_uuid || activityUuid
  if (obj?.content?.file_id && blockActivity) {
    return (
      getActivityBlockMediaDirectory(
        org?.org_uuid,
        course?.courseStructure?.course_uuid,
        blockActivity,
        obj.block_uuid,
        `${obj.content.file_id}.${obj.content.file_format}`,
        'imageBlock',
      ) ?? ''
    )
  }
  return data.imageUrl
}

/** A simple plant, drawn until an image is added. The example pins sit on its parts. */
function PlantArt({ prompt }: { prompt?: string }) {
  return (
    <div className="relative w-full" style={{ aspectRatio: '16 / 10' }}>
      <svg viewBox="0 0 160 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <rect width="160" height="100" className="fill-sky-50/70" />
        <rect y="78" width="160" height="22" className="fill-amber-100/80" />
        <line x1="0" y1="78" x2="160" y2="78" className="stroke-amber-300/70" strokeWidth="0.6" />
        {/* roots */}
        <path d="M80 78 C80 86 74 90 70 96 M80 78 C81 88 80 92 81 98 M80 78 C84 84 90 86 93 92 M86 85 C90 86 95 86 98 88" className="fill-none stroke-amber-700/60" strokeWidth="0.9" strokeLinecap="round" />
        {/* stem */}
        <path d="M80 78 C79 64 81 46 80 26" className="fill-none stroke-emerald-600" strokeWidth="1.6" strokeLinecap="round" />
        {/* leaves */}
        <path d="M80 54 C70 44 60 44 52 47 C60 53 70 56 80 54 Z" className="fill-emerald-300 stroke-emerald-600" strokeWidth="0.6" />
        <path d="M80 60 C90 52 100 52 107 55 C100 62 90 64 80 60 Z" className="fill-emerald-200 stroke-emerald-600" strokeWidth="0.6" />
        {/* flower */}
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="80" cy="11" rx="3.4" ry="6" transform={`rotate(${a} 80 17)`} className="fill-rose-200 stroke-rose-400" strokeWidth="0.5" />
        ))}
        <circle cx="80" cy="17" r="3.4" className="fill-amber-300 stroke-amber-500" strokeWidth="0.5" />
      </svg>
      {prompt && (
        <span className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit max-w-[90%] rounded-full bg-white/90 px-3 py-1 text-center text-[11px] font-medium text-neutral-500 shadow-sm">
          {prompt}
        </span>
      )}
    </div>
  )
}

function Stage({
  src,
  alt,
  prompt,
  stageRef,
  className,
  children,
  ...rest
}: {
  src: string
  alt: string
  prompt?: string
  stageRef: React.RefObject<HTMLDivElement | null>
  className?: string
  children?: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div ref={stageRef} dir="ltr" className={cn('relative w-full select-none', className)} {...rest}>
      <div className="overflow-hidden rounded-xl bg-neutral-50 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08)),0_2px_6px_-3px_var(--exp-drop,rgba(0,0,0,0.12))]">
        {src ? <img src={src} alt={alt} draggable={false} className="block h-auto w-full" /> : <PlantArt prompt={prompt} />}
      </div>
      {children}
    </div>
  )
}

const at = (p: { x: number; y: number }): React.CSSProperties => ({ left: `${p.x}%`, top: `${p.y}%` })

// ─── View ───────────────────────────────────────────────────────────────────

export default function LabelView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeLabel(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const activity = (props.extension?.options as any)?.activity
  const src = useImageSrc(data, activity?.activity_uuid)
  const frame: Frame = {
    tone: TONE,
    icon: <Tag weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.label.title', 'Label the diagram'),
  }
  const playable = React.useMemo(() => playableLabel(data), [data])
  return (
    <NodeViewWrapper className="block-exp-label">
      {editable && !preview ? (
        <LabelEditor data={data} src={src} commit={commit} frame={frame} props={props} />
      ) : (
        <LabelPlayer key={contentKey({ playable, src })} data={playable} src={src} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author form ────────────────────────────────────────────────────────────

const ISSUE_FALLBACK: Record<string, string> = {
  no_image: 'Add an image. Until then learners see the example drawing.',
  too_few_pins: 'Add at least 2 pins: click the picture.',
  too_many_pins: 'Use at most 12 pins; learners only see the first 12.',
  too_many_distractors: 'Use at most 4 wrong labels.',
  empty_label: 'Name this pin, or remove it.',
  duplicate_label: 'Another pin has the same label.',
  distractor_is_label: 'This wrong label is also a pin label; learners will not see it.',
}

function LabelEditor({
  data,
  src,
  commit,
  frame,
  props,
}: {
  data: LabelData
  src: string
  commit: (_p: CommitPatch<Record<string, any>>) => void
  frame: Frame
  props: NodeViewProps
}) {
  const { t } = useTranslation()
  const k = 'editor.experiences.label.'
  const session = useLHSession() as any
  const activity = (props.extension?.options as any)?.activity
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState<{ id: string; x: number; y: number } | null>(null)
  const dragRef = React.useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const issues = React.useMemo(() => validateLabel(data, src), [data, src])
  const issueText = (code: string) => t(`${k}issues.${code}`, ISSUE_FALLBACK[code] ?? code)

  const edit = (fn: (_d: LabelData) => LabelData) =>
    commit((live) => {
      const next = fn(normalizeLabel(live))
      return { pins: next.pins, distractors: next.distractors }
    })

  const upload = useBlockUpload({
    kind: 'image',
    activityUuid: activity?.activity_uuid,
    accessToken: session?.data?.tokens?.access_token,
    onUploaded: (object) => commit({ imageObject: object, imageUrl: '' }),
  })

  // Keep a plain URL next to the uploaded object for renderers that only read `imageUrl`.
  React.useEffect(() => {
    if ((data.imageObject as any)?.content?.file_id && src && data.imageUrl !== src) commit({ imageUrl: src })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, data.imageObject])

  const importFromUrl = async (input: string): Promise<string | void> => {
    const url = normalizeUserUrl(input)
    if (!url) return uploadErrorText(t, { code: 'url' })
    try {
      const file = await fetchRemoteFile(url, 'image')
      upload.start(file)
    } catch (err) {
      if (err instanceof UrlImportError && err.code === 'blocked') {
        commit({ imageObject: null, imageUrl: url })
        toast(t('editor.blocks_v2.image_linked', 'This site blocks copying, so the image is shown from its link.'))
        return
      }
      if (err instanceof UrlImportError) return uploadErrorText(t, { code: err.code, kind: 'image', error: err.message })
      return uploadErrorText(t, { code: 'server', error: (err as any)?.message })
    }
  }

  const percentAt = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect ? pointToPercent(clientX, clientY, rect) : { x: 50, y: 50 }
  }

  const onStageClick = (e: React.MouseEvent) => {
    if (data.pins.length >= LABEL_LIMITS.maxPins) return
    const { x, y } = percentAt(e.clientX, e.clientY)
    const id = newId()
    edit((d) => addPin(d, id, x, y))
    setSelected(id)
  }

  const onPinPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false }
    setSelected(id)
  }
  const onPinPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
    d.moved = true
    setDrag({ id: d.id, ...percentAt(e.clientX, e.clientY) })
  }
  const onPinPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved) {
      const { x, y } = percentAt(e.clientX, e.clientY)
      edit((live) => movePin(live, d.id, x, y))
    }
    setDrag(null)
  }
  const onPinKeyDown = (e: React.KeyboardEvent, id: string) => {
    const step = e.shiftKey ? 5 : 1
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key]) {
      e.preventDefault()
      e.stopPropagation()
      const [dx, dy] = moves[e.key]
      edit((d) => nudgePin(d, id, dx, dy))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      edit((d) => removePin(d, id))
      setSelected(null)
    }
  }

  const pinIssues = (id: string) => issues.filter((i) => i.id === id)

  return (
    <ExperienceFrame
      {...frame}
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      instructions={data.instructions}
      onInstructionsChange={(instructions) => commit({ instructions })}
    >
      <div className="flex flex-col gap-4">
        <BlockHints issues={issues.filter((i) => i.index === undefined)} text={issueText} />

        {src && (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => pickFile(acceptFor('image'), (f) => upload.start(f))}>
              <ArrowsClockwise size={13} aria-hidden />
              {t(`${k}replace_image`, 'Replace image')}
            </button>
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => commit({ imageObject: null, imageUrl: '' })}>
              <Trash size={13} aria-hidden />
              {t(`${k}remove_image`, 'Remove image')}
            </button>
          </div>
        )}

        {(!src || upload.task) && (
          <MediaSourcePicker
            kind="image"
            tone="embed"
            icon={<ImageIcon size={20} weight="duotone" />}
            title={t(`${k}add_image`, 'Add the diagram image')}
            onFile={(f) => upload.start(f)}
            onUrl={importFromUrl}
            urlPlaceholder={t('editor.blocks_v2.image_link_placeholder', 'Paste an image link…')}
            task={upload.task}
            rejection={upload.rejection}
            onCancel={upload.cancel}
            onRetry={upload.retry}
            onDismiss={upload.dismiss}
          />
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <Stage
              src={src}
              alt=""
              stageRef={stageRef}
              prompt={src ? undefined : t(`${k}placeholder_prompt`, 'Example drawing: add your own image above')}
              className={cn('cursor-crosshair', data.pins.length >= LABEL_LIMITS.maxPins && 'cursor-default')}
              onClick={onStageClick}
            >
              {data.pins.map((pin, i) => {
                const pos = drag?.id === pin.id ? { x: drag.x, y: drag.y } : pin
                const active = selected === pin.id
                return (
                  <button
                    key={pin.id}
                    type="button"
                    style={{ ...at(pos), transform: 'translate(-50%, -50%)' }}
                    aria-label={t(`${k}pin_aria`, { n: i + 1, label: pin.label || t(`${k}untitled_pin`, 'Unnamed'), defaultValue: 'Pin {{n}}: {{label}}' })}
                    aria-pressed={active}
                    onPointerDown={(e) => onPinPointerDown(e, pin.id)}
                    onPointerMove={onPinPointerMove}
                    onPointerUp={onPinPointerUp}
                    onPointerCancel={() => {
                      dragRef.current = null
                      setDrag(null)
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelected(pin.id)
                    }}
                    onKeyDown={(e) => onPinKeyDown(e, pin.id)}
                    className={cn(
                      'absolute flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-full border-2 border-white text-[12px] font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] outline-none active:cursor-grabbing focus-visible:ring-4 focus-visible:ring-sky-500/40',
                      active ? 'bg-sky-600' : 'bg-teal-600',
                    )}
                  >
                    {i + 1}
                  </button>
                )
              })}
            </Stage>
            <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">{t(`${k}stage_help`, 'Click the picture to add a pin. Drag a pin, or use the arrow keys, to move it.')}</p>
          </div>

          <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t(`${k}pins_label`, 'Pins')}>
            {data.pins.length === 0 && <li className="rounded-lg bg-neutral-50 px-3 py-3 text-xs text-neutral-500">{t(`${k}empty_list`, 'No pins yet. Click the picture to add one.')}</li>}
            {data.pins.map((pin, i) => (
              <li
                key={pin.id}
                className={cn('rounded-xl p-2 shadow-[0_0_0_1px_rgba(0,0,0,0.07)] transition-shadow', selected === pin.id && 'shadow-[0_0_0_2px_rgba(2,132,199,0.5)]')}
                onFocusCapture={() => setSelected(pin.id)}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title={t(`${k}move_hint`, 'Select, then use the arrow keys to move')}
                    aria-label={t(`${k}select_pin`, { n: i + 1, defaultValue: 'Select pin {{n}}' })}
                    onClick={() => setSelected(pin.id)}
                    onKeyDown={(e) => onPinKeyDown(e, pin.id)}
                    className="flex h-6 w-6 shrink-0 cursor-move items-center justify-center rounded-md text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500/40"
                  >
                    <DotsSixVertical size={14} weight="bold" aria-hidden />
                  </button>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[11px] font-semibold text-white">{i + 1}</span>
                  <CommitInput
                    value={pin.label}
                    placeholder={t(`${k}label_placeholder`, 'Label')}
                    aria-label={t(`${k}label_label`, { n: i + 1, defaultValue: 'Label for pin {{n}}' })}
                    onCommit={(label) => edit((d) => updatePin(d, pin.id, { label }))}
                    className={cn(FIELD_CLASS, 'h-8 min-w-0 flex-1')}
                  />
                  <button
                    type="button"
                    aria-label={t(`${k}remove_pin`, { n: i + 1, defaultValue: 'Remove pin {{n}}' })}
                    title={t(`${k}remove_pin`, { n: i + 1, defaultValue: 'Remove pin {{n}}' })}
                    onClick={() => edit((d) => removePin(d, pin.id))}
                    className={ICON_BTN}
                  >
                    <Trash size={14} aria-hidden />
                  </button>
                </div>
                {pinIssues(pin.id).map((issue) => (
                  <div key={issue.code} className="mt-1 ps-14">
                    <InlineHint severity={issue.severity}>{issueText(issue.code)}</InlineHint>
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </div>

        <FormSection
          title={t(`${k}distractors_heading`, 'Wrong labels (optional)')}
          hint={t(`${k}distractors_hint`, 'Extra labels that belong nowhere. They make learners think instead of guessing.')}
        >
          {data.distractors.map((d, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <CommitInput
                  value={d}
                  onCommit={(text) => edit((live) => updateDistractor(live, i, text))}
                  placeholder={t(`${k}distractor_placeholder`, { n: i + 1, defaultValue: 'Wrong label {{n}}' })}
                  aria-label={t(`${k}distractor_placeholder`, { n: i + 1, defaultValue: 'Wrong label {{n}}' })}
                  className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1')}
                />
                <button
                  type="button"
                  className={ICON_BTN}
                  onClick={() => edit((live) => removeDistractor(live, i))}
                  aria-label={t(`${k}remove_distractor`, 'Remove wrong label')}
                  title={t(`${k}remove_distractor`, 'Remove wrong label')}
                >
                  <Trash size={15} aria-hidden />
                </button>
              </div>
              {issues
                .filter((issue) => issue.index === i)
                .map((issue) => (
                  <div key={issue.code} className="ps-1">
                    <InlineHint severity={issue.severity}>{issueText(issue.code)}</InlineHint>
                  </div>
                ))}
            </div>
          ))}
          <AddRowButton disabled={data.distractors.length >= LABEL_LIMITS.maxDistractors} onClick={() => edit((live) => addDistractor(live))}>
            {t(`${k}add_distractor`, 'Add a wrong label')}
          </AddRowButton>
        </FormSection>
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner ────────────────────────────────────────────────────────────────

function LabelPlayer({ data, src, frame, source }: { data: LabelData; src: string; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const k = 'activities.experiences.label.'
  const memory = useExperienceMemory(data.blockId, source)
  const bank = React.useMemo(() => labelBank(data), [data])
  const textOf = React.useCallback((chip: string | null | undefined) => (chip ? bank.find((c) => c.id === chip)?.text ?? '' : ''), [bank])
  const [order, setOrder] = React.useState(() => bankOrder(data))
  const [placement, setPlacement] = React.useState<LabelPlacement>({})
  const [selected, setSelected] = React.useState<string | null>(null)
  const [check, setCheck] = React.useState<LabelCheck | null>(null)
  const [live, setLive] = React.useState('')
  const [menu, setMenu] = React.useState<string | null>(null)
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const rootRef = React.useRef<HTMLDivElement>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const pinNumber = (pinId: string) => data.pins.findIndex((p) => p.id === pinId) + 1

  const doPlace = (chipId: string, pinId: string | null) => {
    if (check) return
    setPlacement((p) => placeLabel(p, chipId, pinId))
    setSelected(null)
    setMenu(null)
    setLive(
      pinId
        ? t(`${k}placed`, { label: textOf(chipId), n: pinNumber(pinId), defaultValue: 'Put “{{label}}” on point {{n}}.' })
        : t(`${k}returned`, { label: textOf(chipId), defaultValue: 'Moved “{{label}}” back to the labels.' }),
    )
  }

  const { drag, itemProps } = useTapDrag({
    disabled: !!check,
    onDrop: (id, target) => doPlace(id, target === BANK ? null : target),
  })

  const tapChip = (id: string) => {
    if (check) return
    const next = selected === id ? null : id
    setSelected(next)
    setMenu(null)
    if (next) setLive(t(`${k}selected`, { label: textOf(id), defaultValue: 'Selected “{{label}}”. Now choose a point.' }))
  }

  const tapPin = (pinId: string) => {
    if (check) return
    if (selected) doPlace(selected, pinId)
    else setMenu((m) => (m === pinId ? null : pinId))
  }

  const onCheck = () => {
    const c = checkLabel(data, placement)
    setCheck(c)
    setSelected(null)
    setMenu(null)
    buzz(c.perfect ? 'correct' : 'wrong')
    setLive(
      c.perfect
        ? t(`${k}perfect`, 'Perfect! Every label is in the right place.')
        : t(`${k}result`, { correct: c.correct, total: c.total, defaultValue: '{{correct}} of {{total}} correct' }),
    )
    if (c.stars > best) {
      setBest(c.stars)
      memory.write('best', c.stars)
    }
  }

  const onRetryWrong = () => {
    if (!check) return
    setPlacement((p) => retryWrong(p, check))
    setCheck(null)
    setLive(t(`${k}retry_live`, 'The wrong labels are back in the bank.'))
  }

  const onReset = () => {
    setOrder(bankOrder(data))
    setPlacement({})
    setCheck(null)
    setSelected(null)
    setMenu(null)
    setLive('')
  }

  if (!isPlayable(data)) {
    return (
      <ExperienceFrame {...frame} title={data.title} instructions={data.instructions}>
        <NotReady>{t(`${k}not_ready`, 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const free = unplacedChips(order, placement)
  const placedCount = Object.keys(placement).length
  const ready = allLabelled(data, placement)
  const wrong = check ? data.pins.filter((p) => check.results[p.id] !== 'correct') : []

  const chipKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (check) return
    if (e.key === 'Escape') setSelected(null)
    else focusSibling(e, '[data-label-chip]', rootRef.current)
  }

  const chip = (id: string, where: 'bank' | 'slot') => {
    const isSel = selected === id
    const pin = pinOfChip(placement, id)
    const result = pin && check ? check.results[pin] : undefined
    return (
      <button
        key={id}
        type="button"
        data-label-chip=""
        {...itemProps(id)}
        onClick={(e) => {
          e.stopPropagation()
          tapChip(id)
        }}
        onKeyDown={chipKeyDown}
        aria-pressed={check ? undefined : isSel}
        aria-disabled={check ? true : undefined}
        data-result={result === 'correct' || result === 'wrong' ? result : undefined}
        className={cn(
          'lh-exp-raised inline-flex max-w-full min-w-0 touch-manipulation items-center gap-1.5 rounded-xl text-start leading-snug font-medium outline-none select-none',
          where === 'slot' ? 'min-h-8 px-2.5 py-1 text-[13px]' : 'min-h-10 px-3 py-2 text-[14px]',
          !check && 'lh-exp-press cursor-grab active:cursor-grabbing',
          isSel ? 'text-teal-700' : !result && 'text-neutral-800',
          drag?.id === id && 'opacity-40',
          where === 'slot' && !check && 'lh-exp-snap',
          result === 'wrong' && 'lh-exp-wrong-shake',
        )}
      >
        {result && result !== 'empty' && <ResultIcon ok={result === 'correct'} size={14} />}
        <span className="pointer-events-none min-w-0 [overflow-wrap:anywhere]">{textOf(id)}</span>
      </button>
    )
  }

  const footer = (
    <ExperienceFooter
      progress={check ? undefined : { done: placedCount, total: data.pins.length }}
      stars={check ? check.stars : undefined}
      score={check ? `${check.correct} / ${check.total}` : undefined}
      onRetry={check || placedCount > 0 ? onReset : undefined}
    >
      {!check && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t(`${k}best`, 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={!!check?.perfect} live={live}>
      <div ref={rootRef} className="flex flex-col gap-4">
        {!check && (
          <p className="m-0 text-[13px] leading-snug text-neutral-500">
            {selected
              ? t(`${k}selected_hint`, { label: textOf(selected), defaultValue: 'Now tap the point for “{{label}}”.' })
              : t(`${k}hint`, 'Drag each label onto its point, or tap a label and then a point.')}
          </p>
        )}

        {/* Label bank */}
        {!check && (
          <div
            data-drop-target={BANK}
            role="group"
            aria-label={t(`${k}bank_label`, 'Labels')}
            onClick={() => selected && pinOfChip(placement, selected) && doPlace(selected, null)}
            data-over={drag?.over === BANK ? 'true' : undefined}
            className={cn('lh-exp-well flex min-h-16 flex-wrap items-center gap-2 rounded-2xl p-3 text-neutral-400', selected && pinOfChip(placement, selected) && 'cursor-pointer')}
          >
            {free.length ? (
              free.map((id) => chip(id, 'bank'))
            ) : (
              <span className="flex items-center gap-2 text-[13px] text-neutral-500">
                <Tray size={16} aria-hidden />
                {t(`${k}bank_empty`, 'All labels are placed.')}
              </span>
            )}
            {selected && pinOfChip(placement, selected) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  doPlace(selected, null)
                }}
                className="lh-exp-raised lh-exp-press ms-auto inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-neutral-700"
              >
                {t(`${k}back_to_bank`, 'Back to the labels')}
              </button>
            )}
          </div>
        )}

        {/* The picture with its pins */}
        <Stage
          src={src}
          alt={data.title}
          stageRef={stageRef}
          className="mx-auto max-w-[720px]"
          role="group"
          aria-label={t(`${k}stage_aria`, 'Picture with numbered points')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenu(null)
          }}
        >
          {data.pins.map((pin, i) => {
            const placed = placement[pin.id]
            const result = check?.results[pin.id]
            const over = drag?.over === pin.id
            const target = !check && !!selected
            const right = pin.x < 62
            return (
              <span key={pin.id} data-drop-target={pin.id} className="absolute h-0 w-0" style={at(pin)}>
                <button
                  type="button"
                  data-label-pin=""
                  style={{ left: 0, top: 0 }}
                  onClick={() => tapPin(pin.id)}
                  onKeyDown={(e) => {
                    if (focusSibling(e, '[data-label-pin]', stageRef.current)) return
                    if (e.key === 'Escape') setMenu(null)
                  }}
                  aria-haspopup={check ? undefined : 'listbox'}
                  aria-expanded={check ? undefined : menu === pin.id}
                  aria-disabled={check ? true : undefined}
                  aria-label={
                    placed
                      ? t(`${k}pin_placed_aria`, { n: i + 1, label: textOf(placed), defaultValue: 'Point {{n}}: {{label}}' })
                      : t(`${k}pin_empty_aria`, { n: i + 1, defaultValue: 'Point {{n}}: no label yet' })
                  }
                  className={cn('absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full outline-none', !check && 'cursor-pointer', 'focus-visible:ring-4 focus-visible:ring-teal-500/40')}
                >
                  <span aria-hidden className={cn('pointer-events-none absolute inset-0.5 rounded-full transition-colors', over ? 'bg-teal-400/35 ring-2 ring-teal-500' : target ? 'bg-white/40 ring-2 ring-teal-500/60' : '')} />
                  <span
                    key={placed ?? 'none'}
                    aria-hidden
                    className={cn(
                      'relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[12px] font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]',
                      result === 'correct' ? 'bg-emerald-600' : result === 'wrong' || result === 'empty' ? 'bg-rose-600' : placed ? 'bg-neutral-800' : 'bg-teal-600',
                      placed && !check && 'lh-exp-label-click',
                    )}
                  >
                    {result === 'correct' ? <Check size={13} weight="bold" /> : result ? <X size={13} weight="bold" /> : i + 1}
                  </span>
                </button>
                {placed && (
                  <span
                    className="pointer-events-none absolute top-0 hidden -translate-y-1/2 sm:block"
                    style={right ? { left: 18 } : { right: 18 }}
                    aria-hidden
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      {...itemProps(placed)}
                      onClick={(e) => {
                        e.stopPropagation()
                        tapChip(placed)
                      }}
                      data-result={result === 'correct' || result === 'wrong' ? result : undefined}
                      data-side={right ? 'end' : 'start'}
                      className={cn(
                        'lh-exp-raised pointer-events-auto flex w-max max-w-[9rem] items-center gap-1 rounded-lg px-2 py-1 text-start text-[12.5px] leading-tight font-semibold outline-none select-none',
                        !check && 'lh-exp-press lh-exp-label-land cursor-grab',
                        selected === placed ? 'text-teal-700' : !result && 'text-neutral-800',
                        drag?.id === placed && 'opacity-40',
                      )}
                      style={{ '--exp-from-x': right ? '14px' : '-14px' } as React.CSSProperties}
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">{textOf(placed)}</span>
                    </button>
                  </span>
                )}
                {menu === pin.id && !check && (
                  <PinMenu
                    pinX={pin.x}
                    pinY={pin.y}
                    title={t(`${k}menu_title`, { n: i + 1, defaultValue: 'Label for point {{n}}' })}
                    options={[...(placed ? [placed] : []), ...free].map((id) => ({ id, text: textOf(id) }))}
                    current={placed ?? null}
                    clearLabel={placed ? t(`${k}menu_clear`, 'Remove the label') : null}
                    emptyLabel={t(`${k}menu_empty`, 'No labels left. Pick one up from another point first.')}
                    onChoose={(id) => {
                      if (id === null) {
                        if (placed) doPlace(placed, null)
                      } else doPlace(id, pin.id)
                      focusPin(stageRef.current, i)
                    }}
                    onClose={() => {
                      setMenu(null)
                      focusPin(stageRef.current, i)
                    }}
                    onDismiss={() => setMenu(null)}
                  />
                )}
              </span>
            )
          })}
        </Stage>

        {/* Numbered slots: the comfortable target on small screens */}
        <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2" aria-label={t(`${k}slots_label`, 'Points')}>
          {data.pins.map((pin, i) => {
            const placed = placement[pin.id]
            const result = check?.results[pin.id]
            const over = drag?.over === pin.id
            const target = !check && !!selected && placed !== selected
            return (
              <li key={pin.id} className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
                    result === 'correct' ? 'bg-emerald-600' : result ? 'bg-rose-600' : placed ? 'bg-neutral-800' : 'bg-teal-600',
                  )}
                >
                  {i + 1}
                </span>
                <div
                  data-drop-target={pin.id}
                  onClick={() => target && selected && doPlace(selected, pin.id)}
                  data-over={over || target ? 'true' : undefined}
                  role="group"
                  aria-label={t(`${k}slot_aria`, { n: i + 1, defaultValue: 'Point {{n}}' })}
                  className={cn('lh-exp-well flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-xl px-1.5 py-1 text-teal-600', target && 'cursor-pointer')}
                >
                  {placed ? (
                    chip(placed, 'slot')
                  ) : (
                    <span className="px-1.5 text-[12.5px] text-neutral-400">{target ? t(`${k}slot_put`, 'Put it here') : t(`${k}slot_empty`, 'Drop a label')}</span>
                  )}
                  {result && result !== 'correct' && (
                    <span className="ms-auto px-1 text-[12px] font-medium text-neutral-600">
                      {t(`${k}should_be`, { label: pin.label, defaultValue: 'Answer: {{label}}' })}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {!check ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onCheck} disabled={!ready} className="lh-exp-key">
              {t(`${k}check`, 'Check')}
            </button>
            {!ready && <span className="text-[13px] text-neutral-500">{t(`${k}label_all`, 'Label every point to check.')}</span>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn('m-0 flex items-center gap-2 text-[14px] font-medium', check.perfect ? 'text-emerald-700' : 'text-neutral-700')}>
              <ResultIcon ok={check.perfect} size={16} label="" />
              {check.perfect
                ? t(`${k}perfect`, 'Perfect! Every label is in the right place.')
                : t(`${k}result`, { correct: check.correct, total: check.total, defaultValue: '{{correct}} of {{total}} correct' })}
            </p>
            {wrong.length > 0 && (
              <div>
                <button type="button" onClick={onRetryWrong} className="lh-exp-key">
                  <ArrowCounterClockwise size={14} weight="bold" aria-hidden />
                  {t(`${k}retry_wrong`, 'Retry wrong ones')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {drag && <DragGhost x={drag.x} y={drag.y}>{textOf(drag.id)}</DragGhost>}
    </ExperienceFrame>
  )
}

function focusPin(stage: HTMLElement | null, index: number) {
  window.requestAnimationFrame(() => stage?.querySelectorAll<HTMLElement>('[data-label-pin]')[index]?.focus())
}

/** A small listbox of labels next to a pin (keyboard: arrows, Enter, Escape). */
function PinMenu({
  pinX,
  pinY,
  title,
  options,
  current,
  clearLabel,
  emptyLabel,
  onChoose,
  onClose,
  onDismiss,
}: {
  pinX: number
  pinY: number
  title: string
  options: { id: string; text: string }[]
  current: string | null
  clearLabel: string | null
  emptyLabel: string
  onChoose: (_id: string | null) => void
  onClose: () => void
  /** Focus left the menu (a click elsewhere): close without moving focus back. */
  onDismiss: () => void
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const id = React.useId()
  const rows: { id: string | null; text: string }[] = [...options, ...(clearLabel ? [{ id: null, text: clearLabel }] : [])]
  const [active, setActive] = React.useState(() => Math.max(0, rows.findIndex((r) => r.id === current)))
  React.useEffect(() => {
    listRef.current?.focus()
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(rows.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(rows.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const row = rows[active]
      if (row) onChoose(row.id)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose()
    }
  }
  const below = pinY < 60
  const align: React.CSSProperties = pinX < 30 ? { left: -16 } : pinX > 70 ? { right: -16 } : { left: 0, transform: 'translateX(-50%)' }
  return (
    <div
      className="lh-exp-raised lh-exp-slide-in absolute z-20 w-56 max-w-[70vw] rounded-xl p-1.5 text-start shadow-[0_10px_24px_-8px_rgba(15,23,42,0.25)]"
      style={{ ...align, ...(below ? { top: 24 } : { bottom: 24 }) }}
      dir="auto"
      onBlur={(e) => {
        // Focus moving to this pin's own button (it toggles the menu) is not "outside".
        const anchor = e.currentTarget.parentElement
        if (!anchor?.contains(e.relatedTarget as Node | null)) onDismiss()
      }}
    >
      <div id={`${id}-t`} className="px-2 pt-1 pb-1.5 text-[12px] font-semibold text-neutral-500">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="m-0 px-2 pb-1.5 text-[12.5px] text-neutral-500" tabIndex={-1} ref={listRef as any}>
          {emptyLabel}
        </p>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-labelledby={`${id}-t`}
          aria-activedescendant={`${id}-o${active}`}
          onKeyDown={onKeyDown}
          className="flex max-h-56 flex-col gap-0.5 overflow-y-auto outline-none"
        >
          {rows.map((row, i) => (
            <div
              key={row.id ?? '__clear__'}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={row.id === current}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => onChoose(row.id)}
              className={cn(
                'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13.5px] leading-snug',
                i === active ? 'bg-teal-50 text-teal-800' : 'text-neutral-700',
                row.id === null && 'text-neutral-500',
              )}
            >
              {row.id === null ? <X size={13} aria-hidden /> : row.id === current ? <Check size={13} weight="bold" aria-hidden /> : <Tag size={13} aria-hidden className="text-neutral-400" />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{row.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
