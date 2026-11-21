'use client'
/*
 Hotspot: find the right places on an image (find mode) or read a labelled
 diagram (explore mode). Spot coordinates are percentages of the image, so
 the block is responsive. The image stage always uses physical left/top:
 the picture itself is never mirrored in RTL, so neither are its spots.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  ArrowsClockwise,
  Check,
  Crosshair,
  Image as ImageIcon,
  Info,
  MagnifyingGlass,
  Trash,
  X,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getActivityBlockMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'
import { Segmented, SettingsField } from '../../../Blocks/ui/BlockChrome'
import { InlineHint } from '../Sort/kit'
import MediaSourcePicker from '../../../Blocks/ui/MediaSourcePicker'
import { useBlockUpload } from '../../../Blocks/media/useBlockUpload'
import { acceptFor } from '../../../Blocks/media/mediaKinds'
import { fetchRemoteFile, UrlImportError } from '../../../Blocks/media/urlImport'
import { normalizeUserUrl } from '../../../Blocks/embeds/embedProviders'
import { uploadErrorText } from '../../../Blocks/media/uploadMessages'
import { pickFile } from '../../../Blocks/nodeViewUtils'
import {
  AnswerKeyHint,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  SettingsGear,
  buzz,
  type InlineTextHandle,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  addSpot,
  hitTest,
  isComplete,
  missHint,
  moveSpot,
  normalizeMode,
  normalizeSpots,
  nudgeSpot,
  pointToPercent,
  removeSpot,
  starsForMisses,
  targetSpots,
  updateSpot,
  validateHotspot,
  MAX_RADIUS,
  MAX_SPOTS,
  MIN_RADIUS,
  type HotspotMode,
  type HotspotSpot,
} from './hotspotModel'

type Stars = 0 | 1 | 2 | 3

interface StoredAttrs {
  blockId: string
  title: string
  instructions: string
  imageUrl: string
  imageObject: any
  spots: unknown
  mode: unknown
}

/** Resolve the image: an uploaded file (like blockImage) wins over a plain URL. */
function useImageSrc(attrs: StoredAttrs, activityUuid: string | undefined): string {
  const org = useOrg() as any
  const course = useCourse() as any
  const obj = attrs.imageObject
  const blockActivity = obj?.content?.activity_uuid || activityUuid
  if (obj?.content?.file_id && blockActivity) {
    return getActivityBlockMediaDirectory(
      org?.org_uuid,
      course?.courseStructure?.course_uuid,
      blockActivity,
      obj.block_uuid,
      `${obj.content.file_id}.${obj.content.file_format}`,
      'imageBlock',
    ) ?? ''
  }
  return typeof attrs.imageUrl === 'string' ? attrs.imageUrl : ''
}

/** Neutral illustration used until an image is added. Shapes sit under the default spots. */
function PlaceholderArt({ prompt }: { prompt?: string }) {
  return (
    <div className="relative w-full" style={{ aspectRatio: '16 / 10' }}>
      <svg viewBox="0 0 160 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <rect width="160" height="100" className="fill-neutral-50" />
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={16 * (i + 1)} y1="0" x2={16 * (i + 1)} y2="100" className="stroke-neutral-200/70" strokeWidth="0.3" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={(100 / 6) * (i + 1)} x2="160" y2={(100 / 6) * (i + 1)} className="stroke-neutral-200/70" strokeWidth="0.3" />
        ))}
        <circle cx="44.8" cy="38" r="12" className="fill-sky-100 stroke-sky-300" strokeWidth="0.8" />
        <rect x="101" y="51" width="22" height="22" rx="1.5" className="fill-amber-100 stroke-amber-300" strokeWidth="0.8" />
        <path d="M70 84 L84 60 L98 84 Z" className="fill-neutral-100 stroke-neutral-300" strokeWidth="0.8" />
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
    <div
      ref={stageRef}
      dir="ltr"
      className={cn('relative w-full overflow-hidden rounded-xl bg-neutral-50 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08)),0_2px_6px_-3px_var(--exp-drop,rgba(0,0,0,0.12))] select-none', className)}
      {...rest}
    >
      {src ? (
        <img src={src} alt={alt} draggable={false} className="block h-auto w-full" />
      ) : (
        <PlaceholderArt prompt={prompt} />
      )}
      {children}
    </div>
  )
}

function spotStyle(spot: Pick<HotspotSpot, 'x' | 'y' | 'r'>): React.CSSProperties {
  // Physical left/top on purpose: image coordinates do not mirror in RTL.
  return { left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.r * 2}%`, aspectRatio: '1 / 1', transform: 'translate(-50%, -50%)' }
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
// Edit in place: the picture as learners see it. Click the picture to add a
// pin, drag a pin (or arrow keys on it) to move it; a pin opens a small card
// where its label, explanation and (find mode) size are edited. Mode and the
// image actions live behind the header gear.

function useHotspotEditor({
  props,
  attrs,
  mode,
  src,
  commit,
}: {
  props: NodeViewProps
  attrs: StoredAttrs
  mode: HotspotMode
  src: string
  commit: (_patch: CommitPatch<StoredAttrs>) => void
}) {
  const { t } = useTranslation()
  const k = 'editor.experiences.hotspot.'
  const session = useLHSession() as any
  const activity = (props.extension?.options as any)?.activity

  const upload = useBlockUpload({
    kind: 'image',
    activityUuid: activity?.activity_uuid,
    accessToken: session?.data?.tokens?.access_token,
    onUploaded: (object) => {
      commit({ imageObject: object, imageUrl: '' })
    },
  })

  // Keep a plain URL next to the uploaded object for renderers that only read `imageUrl`.
  React.useEffect(() => {
    if (attrs.imageObject?.content?.file_id && src && attrs.imageUrl !== src) commit({ imageUrl: src })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, attrs.imageObject])

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

  const settings = (
    <SettingsGear>
      <SettingsField
        label={t(`${k}mode_label`)}
        hint={mode === 'find' ? t(`${k}mode_find_hint`, 'Learners click the picture to find each spot.') : t(`${k}mode_explore_hint`, 'Learners open numbered pins to read about each spot.')}
      >
        <Segmented<HotspotMode>
          value={mode}
          ariaLabel={t(`${k}mode_label`)}
          onChange={(v) => commit({ mode: v })}
          options={[
            { value: 'find', label: <><MagnifyingGlass size={13} aria-hidden />{t(`${k}mode_find`)}</> },
            { value: 'explore', label: <><Info size={13} aria-hidden />{t(`${k}mode_explore`)}</> },
          ]}
        />
      </SettingsField>
      {src && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => pickFile(acceptFor('image'), (f) => upload.start(f))}>
            <ArrowsClockwise size={13} aria-hidden />
            {t(`${k}replace_image`)}
          </button>
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => commit({ imageObject: null, imageUrl: '' })}>
            <Trash size={13} aria-hidden />
            {t(`${k}remove_image`)}
          </button>
        </div>
      )}
    </SettingsGear>
  )

  const picker =
    !src || upload.task ? (
      <MediaSourcePicker
        kind="image"
        tone="embed"
        icon={<ImageIcon size={20} weight="duotone" />}
        title={t(`${k}add_image`)}
        onFile={(f) => upload.start(f)}
        onUrl={importFromUrl}
        urlPlaceholder={t('editor.blocks_v2.image_link_placeholder', 'Paste an image link…')}
        task={upload.task}
        rejection={upload.rejection}
        onCancel={upload.cancel}
        onRetry={upload.retry}
        onDismiss={upload.dismiss}
      />
    ) : null

  return { settings, picker }
}

function HotspotEditor({
  spots,
  mode,
  src,
  picker,
  commit,
}: {
  spots: HotspotSpot[]
  mode: HotspotMode
  src: string
  picker: React.ReactNode
  commit: (_patch: CommitPatch<StoredAttrs>) => void
}) {
  const { t } = useTranslation()
  const k = 'editor.experiences.hotspot.'
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [opened, setOpened] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState<{ id: string; x: number; y: number } | null>(null)
  const dragRef = React.useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const labelRef = React.useRef<InlineTextHandle>(null)
  const pendingFocus = React.useRef<string | null>(null)

  const commitSpots = (fn: (_live: HotspotSpot[]) => HotspotSpot[]) => commit((live) => ({ spots: fn(normalizeSpots(live.spots)) }))
  const focusPin = (id: string) => requestAnimationFrame(() => stageRef.current?.querySelector<HTMLElement>(`[data-pin="${id}"]`)?.focus())

  // A new pin's card focuses its label once it has rendered.
  React.useEffect(() => {
    if (pendingFocus.current && opened === pendingFocus.current) {
      pendingFocus.current = null
      labelRef.current?.focus()
    }
  })

  const percentAt = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect ? pointToPercent(clientX, clientY, rect) : { x: 50, y: 50 }
  }

  const onStageClick = (e: React.MouseEvent) => {
    // Pins and the card stop their own clicks, so anything reaching here is the picture.
    if (opened) {
      setOpened(null)
      return
    }
    if (spots.length >= MAX_SPOTS) return
    const { x, y } = percentAt(e.clientX, e.clientY)
    const next = addSpot(spots, x, y)
    const added = next[next.length - 1]
    commitSpots((live) => [...live, added])
    pendingFocus.current = added.id
    setOpened(added.id)
  }

  const remove = (id: string) => {
    const i = spots.findIndex((s) => s.id === id)
    const next = spots[i + 1] ?? spots[i - 1]
    commitSpots((live) => removeSpot(live, id))
    setOpened(null)
    if (next) focusPin(next.id)
    else stageRef.current?.focus()
  }

  const onPinPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false }
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
      commitSpots((live) => moveSpot(live, d.id, x, y))
      // A drag is not a click: keep the card as it was.
      ;(e.currentTarget as HTMLElement).dataset.dragged = 'true'
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
      commitSpots((live) => nudgeSpot(live, id, dx, dy))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      remove(id)
    } else if (e.key === 'Escape') {
      setOpened(null)
    }
  }

  const issues = validateHotspot({ imageUrl: src, spots })
  const hint = (issue: (typeof issues)[number]) => {
    switch (issue.kind) {
      case 'noImage':
        return t(`${k}hint_no_image`)
      case 'noSpots':
        return t(`${k}hint_no_spots`)
      case 'missingLabel':
        return t(`${k}hint_missing_label`, { n: issue.spotIndex + 1 })
      case 'overlap':
        return t(`${k}hint_overlap`, { a: issue.a + 1, b: issue.b + 1 })
    }
  }

  const current = spots.find((s) => s.id === opened) ?? null
  const currentIndex = current ? spots.indexOf(current) : -1
  const find = mode === 'find'

  return (
    <div className="flex flex-col gap-3">
      {picker}
      <Stage
        src={src}
        alt=""
        stageRef={stageRef}
        tabIndex={-1}
        prompt={src ? undefined : t(`${k}placeholder_prompt`)}
        className={cn('cursor-crosshair outline-none', spots.length >= MAX_SPOTS && !opened && 'cursor-default')}
        onClick={onStageClick}
        onKeyDown={(e) => e.key === 'Escape' && current && (setOpened(null), focusPin(current.id))}
      >
        {spots.map((spot, i) => {
          const pos = drag?.id === spot.id ? { ...spot, x: drag.x, y: drag.y } : spot
          const isOpen = opened === spot.id
          return (
            <React.Fragment key={spot.id}>
              {/* Find mode: the area that counts as a hit (the answer key). */}
              {find && (
                <span
                  aria-hidden
                  style={spotStyle(pos)}
                  className={cn(
                    'pointer-events-none absolute rounded-full border-2 border-dashed',
                    isOpen ? 'border-white bg-neutral-900/15' : 'border-white/90 bg-teal-500/20 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]',
                  )}
                />
              )}
              <button
                type="button"
                data-pin={spot.id}
                aria-expanded={isOpen}
                aria-label={t(`${k}spot_aria`, { n: i + 1, label: spot.label || t(`${k}untitled_spot`) })}
                title={t(`${k}pin_hint`, 'Click to edit. Drag, or use the arrow keys, to move.')}
                onPointerDown={(e) => onPinPointerDown(e, spot.id)}
                onPointerMove={onPinPointerMove}
                onPointerUp={onPinPointerUp}
                onPointerCancel={() => {
                  dragRef.current = null
                  setDrag(null)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  const el = e.currentTarget as HTMLElement
                  if (el.dataset.dragged) {
                    delete el.dataset.dragged
                    return
                  }
                  setOpened(isOpen ? null : spot.id)
                }}
                onKeyDown={(e) => onPinKeyDown(e, spot.id)}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
                className={cn(
                  'absolute flex h-9 w-9 cursor-grab touch-none items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_0_rgba(0,0,0,0.25),0_6px_10px_-2px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-4 focus-visible:ring-teal-500/40 active:cursor-grabbing',
                  isOpen ? 'bg-neutral-900' : spot.label.trim() ? 'bg-teal-500' : 'bg-amber-500',
                )}
              >
                {i + 1}
              </button>
            </React.Fragment>
          )
        })}
        {current && (
          <div
            role="dialog"
            aria-label={t(`${k}select_spot`, { n: currentIndex + 1 })}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setOpened(null)
                focusPin(current.id)
              }
            }}
            style={{
              left: `${Math.min(Math.max(current.x, 22), 78)}%`,
              top: current.y > 55 ? undefined : `calc(${current.y}% + 22px)`,
              bottom: current.y > 55 ? `calc(${100 - current.y}% + 22px)` : undefined,
              transform: 'translateX(-50%)',
            }}
            className="lh-exp-raised lh-exp-slide-in absolute z-10 w-[min(18rem,86%)] cursor-default rounded-xl p-3 text-start shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
            dir="auto"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[11px] font-semibold text-white">{currentIndex + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <InlineText
                  ref={labelRef}
                  value={current.label}
                  onCommit={(v) => commitSpots((live) => updateSpot(live, current.id, { label: v }))}
                  ariaLabel={t(`${k}label_label`, { n: currentIndex + 1 })}
                  placeholder={t(`${k}label_placeholder`)}
                  maxLength={80}
                  className="text-sm font-semibold text-neutral-900"
                />
                <InlineText
                  multiline
                  value={current.explanation ?? ''}
                  onCommit={(v) => commitSpots((live) => updateSpot(live, current.id, { explanation: v }))}
                  ariaLabel={t(`${k}explanation_label`, { n: currentIndex + 1 })}
                  placeholder={t(`${k}explanation_placeholder`)}
                  maxLength={300}
                  className="text-[13px] leading-relaxed text-neutral-600"
                />
                {find && (
                  <label className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                    <span className="shrink-0">{t(`${k}size_label`)}</span>
                    <input
                      type="range"
                      min={MIN_RADIUS}
                      max={MAX_RADIUS}
                      step={1}
                      value={current.r}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => commitSpots((live) => updateSpot(live, current.id, { r: Number(e.target.value) }))}
                      className="min-w-0 flex-1 accent-teal-600"
                    />
                  </label>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-center gap-1">
                <button
                  type="button"
                  aria-label={t('activities.experiences.hotspot.close')}
                  onClick={() => {
                    setOpened(null)
                    focusPin(current.id)
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500/40"
                >
                  <X size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t(`${k}remove_spot`, { n: currentIndex + 1 })}
                  title={t(`${k}remove_spot`, { n: currentIndex + 1 })}
                  onClick={() => remove(current.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 outline-none hover:bg-rose-50 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-sky-500/40"
                >
                  <Trash size={13} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        )}
      </Stage>
      <p className="m-0 text-[12px] text-neutral-400">{t(`${k}stage_help`)}</p>

      {/* Explore mode: the learner's legend, labels edited in place. */}
      {!find && spots.length > 0 && (
        <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2" aria-label={t(`${k}spots_label`)}>
          {spots.map((spot, i) => (
            <li key={spot.id} className="lh-exp-raised flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-start text-[14px] text-neutral-700">
              <button
                type="button"
                aria-label={t(`${k}select_spot`, { n: i + 1 })}
                aria-expanded={opened === spot.id}
                onClick={() => setOpened(opened === spot.id ? null : spot.id)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                  opened === spot.id ? 'bg-neutral-900' : 'bg-teal-500',
                )}
              >
                {i + 1}
              </button>
              <InlineText
                value={spot.label}
                onCommit={(v) => commitSpots((live) => updateSpot(live, spot.id, { label: v }))}
                ariaLabel={t(`${k}label_label`, { n: i + 1 })}
                placeholder={t(`${k}label_placeholder`)}
                maxLength={80}
                className="min-w-0 flex-1"
              />
            </li>
          ))}
        </ol>
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

/* ───────────────────────────── Learner ───────────────────────────── */

type FindFeedback =
  | { kind: 'hit'; spot: HotspotSpot }
  | { kind: 'miss'; hint: 'close' | 'far' }
  | null

function useHotspotGame(spots: HotspotSpot[]) {
  const [found, setFound] = React.useState<Set<string>>(() => new Set())
  const [misses, setMisses] = React.useState(0)
  const [feedback, setFeedback] = React.useState<FindFeedback>(null)
  const [opened, setOpened] = React.useState<string | null>(null)
  const [viewed, setViewed] = React.useState<Set<string>>(() => new Set())
  const reset = React.useCallback(() => {
    setFound(new Set())
    setMisses(0)
    setFeedback(null)
    setOpened(null)
    setViewed(new Set())
  }, [])
  const targets = targetSpots(spots)
  const complete = isComplete(spots, found)
  return { found, setFound, misses, setMisses, feedback, setFeedback, opened, setOpened, viewed, setViewed, reset, targets, complete }
}

type Game = ReturnType<typeof useHotspotGame>

function FindPlayer({ spots, src, game, alt, onComplete }: { spots: HotspotSpot[]; src: string; game: Game; alt: string; onComplete: (_misses: number) => void }) {
  const { t } = useTranslation()
  const k = 'activities.experiences.hotspot.'
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = React.useState({ x: 50, y: 50 })
  const [keyboard, setKeyboard] = React.useState(false)
  const [miss, setMiss] = React.useState<{ x: number; y: number; n: number } | null>(null)
  // The miss marker fades away on its own.
  React.useEffect(() => {
    if (!miss) return
    const id = window.setTimeout(() => setMiss(null), 900)
    return () => window.clearTimeout(id)
  }, [miss])

  const tryAt = (x: number, y: number) => {
    if (game.complete) return
    const rect = stageRef.current?.getBoundingClientRect()
    const aspect = rect && rect.width > 0 ? rect.height / rect.width : 1
    const hit = hitTest(game.targets, x, y, aspect, game.found)
    if (hit) {
      const next = new Set(game.found).add(hit.id)
      game.setFound(next)
      buzz('correct')
      if (isComplete(spots, next)) onComplete(game.misses)
      game.setFeedback({ kind: 'hit', spot: hit })
      setMiss(null)
    } else if (hitTest(game.targets, x, y, aspect)) {
      // Clicked a spot already found: no penalty.
      return
    } else {
      game.setMisses((m) => m + 1)
      buzz('wrong')
      game.setFeedback({ kind: 'miss', hint: missHint(game.targets, game.found, x, y, aspect) })
      setMiss((prev) => ({ x, y, n: (prev?.n ?? 0) + 1 }))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 4
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key]) {
      e.preventDefault()
      setKeyboard(true)
      const [dx, dy] = moves[e.key]
      setCursor((c) => ({ x: Math.min(100, Math.max(0, c.x + dx)), y: Math.min(100, Math.max(0, c.y + dy)) }))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setKeyboard(true)
      tryAt(cursor.x, cursor.y)
    }
  }

  const fb = game.feedback
  return (
    <div className="flex flex-col gap-3">
      <Stage
        src={src}
        alt={alt}
        stageRef={stageRef}
        role="application"
        tabIndex={0}
        aria-roledescription={t(`${k}stage_role`)}
        aria-label={t(`${k}stage_aria`)}
        className={cn('outline-none focus-visible:ring-4 focus-visible:ring-teal-500/30', game.complete ? 'cursor-default' : 'cursor-crosshair')}
        onClick={(e) => {
          const rect = stageRef.current?.getBoundingClientRect()
          if (!rect) return
          setKeyboard(false)
          const p = pointToPercent(e.clientX, e.clientY, rect)
          setCursor(p)
          tryAt(p.x, p.y)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setKeyboard(false)}
      >
        {spots.map((spot, i) =>
          game.found.has(spot.id) ? (
            <span key={spot.id} style={spotStyle(spot)} className="pointer-events-none absolute flex items-center justify-center">
              <span aria-hidden className="absolute inset-0 rounded-full border-2 border-white/90 bg-emerald-500/20 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" />
              <span aria-hidden className="lh-exp-pulse absolute inset-0 rounded-full border-2 border-emerald-400" />
              <span className="lh-exp-pin relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_0_rgba(4,120,87,0.9),0_6px_10px_-2px_rgba(0,0,0,0.35)]">
                <Check size={14} weight="bold" aria-hidden />
                <span className="sr-only">{i + 1}</span>
              </span>
            </span>
          ) : null,
        )}
        {miss && (
          <React.Fragment key={miss.n}>
            <span
              aria-hidden
              style={{ left: `${miss.x}%`, top: `${miss.y}%`, transform: 'translate(-50%, -50%)' }}
              className="lh-exp-ripple pointer-events-none absolute h-14 w-14 rounded-full border-2 border-white/90 bg-white/20 shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
            />
            <span
              aria-hidden
              style={{ left: `${miss.x}%`, top: `${miss.y}%`, transform: 'translate(-50%, -50%)' }}
              className="pointer-events-none absolute flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/85 text-white shadow-sm transition-opacity"
            >
              <X size={11} weight="bold" />
            </span>
          </React.Fragment>
        )}
        {keyboard && !game.complete && (
          <span
            aria-hidden
            style={{ left: `${cursor.x}%`, top: `${cursor.y}%`, transform: 'translate(-50%, -50%)' }}
            className="pointer-events-none absolute flex h-9 w-9 items-center justify-center rounded-full border-2 border-teal-600 bg-white/40 text-teal-700"
          >
            <Crosshair size={18} weight="bold" />
          </span>
        )}
      </Stage>
      <p className="m-0 text-[12px] text-neutral-400">{t(`${k}keyboard_help`)}</p>

      {fb?.kind === 'hit' && (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
          <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold">{t(`${k}found`, { label: fb.spot.label })}</div>
            {fb.spot.explanation && <div className="mt-0.5 text-[13px] text-emerald-800">{fb.spot.explanation}</div>}
          </div>
        </div>
      )}
      {fb?.kind === 'miss' && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <MagnifyingGlass size={16} weight="bold" className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <span>{fb.hint === 'close' ? t(`${k}miss_close`) : t(`${k}miss_far`)}</span>
        </div>
      )}

      {game.found.size > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t(`${k}found_list`)}>
          {game.targets.filter((s) => game.found.has(s.id)).map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
              <Check size={12} weight="bold" aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExplorePlayer({ spots, src, game, alt }: { spots: HotspotSpot[]; src: string; game: Game; alt: string }) {
  const { t } = useTranslation()
  const k = 'activities.experiences.hotspot.'
  const stageRef = React.useRef<HTMLDivElement>(null)
  const open = (id: string | null) => {
    game.setOpened(id)
    if (id) game.setViewed((prev) => new Set(prev).add(id))
  }
  const current = spots.find((s) => s.id === game.opened) ?? null
  const currentIndex = current ? spots.indexOf(current) : -1

  return (
    <div className="flex flex-col gap-3" onKeyDown={(e) => e.key === 'Escape' && open(null)}>
      <Stage src={src} alt={alt} stageRef={stageRef}>
        {spots.map((spot, i) => {
          const isOpen = game.opened === spot.id
          const seen = game.viewed.has(spot.id)
          return (
            <button
              key={spot.id}
              type="button"
              aria-expanded={isOpen}
              aria-controls={isOpen ? `hotspot-pop-${spot.id}` : undefined}
              aria-label={t(`${k}pin_aria`, { n: i + 1, label: spot.label })}
              onClick={() => open(isOpen ? null : spot.id)}
              style={{ left: `${spot.x}%`, top: `${spot.y}%`, transform: 'translate(-50%, -50%)' }}
              className={cn(
                'absolute flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_0_rgba(0,0,0,0.25),0_6px_10px_-2px_rgba(0,0,0,0.35)] outline-none transition-transform focus-visible:ring-4 focus-visible:ring-teal-500/40 motion-safe:hover:scale-110 motion-safe:active:scale-95',
                isOpen ? 'bg-neutral-900' : seen ? 'bg-teal-700' : 'bg-teal-500',
              )}
            >
              {i + 1}
            </button>
          )
        })}
        {current && (
          <div
            id={`hotspot-pop-${current.id}`}
            role="dialog"
            aria-label={current.label}
            style={{
              left: `${Math.min(Math.max(current.x, 22), 78)}%`,
              top: current.y > 55 ? undefined : `calc(${current.y}% + 22px)`,
              bottom: current.y > 55 ? `calc(${100 - current.y}% + 22px)` : undefined,
              transform: 'translateX(-50%)',
            }}
            className="lh-exp-raised lh-exp-slide-in absolute z-10 w-[min(18rem,80%)] rounded-xl p-3 text-start shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
            dir="auto"
          >
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[11px] font-semibold text-white">{currentIndex + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-neutral-900">{current.label}</div>
                {current.explanation && <p className="m-0 mt-1 text-[13px] leading-relaxed text-neutral-600">{current.explanation}</p>}
              </div>
              <button type="button" aria-label={t(`${k}close`)} onClick={() => open(null)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <X size={12} aria-hidden />
              </button>
            </div>
          </div>
        )}
      </Stage>
      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2" aria-label={t(`${k}legend`)}>
        {spots.map((spot, i) => (
          <li key={spot.id}>
            <button
              type="button"
              aria-pressed={game.opened === spot.id}
              onClick={() => open(game.opened === spot.id ? null : spot.id)}
              className={cn(
                'lh-exp-raised lh-exp-press flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-start text-[14px] outline-none',
                game.opened === spot.id ? 'text-teal-700' : 'text-neutral-700',
              )}
            >
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white', game.viewed.has(spot.id) ? 'bg-teal-700' : 'bg-teal-500')}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{spot.label}</span>
              {game.viewed.has(spot.id) && <Check size={12} weight="bold" className="text-teal-700" aria-label={t(`${k}viewed`)} />}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ───────────────────────────── View ───────────────────────────── */

export default function HotspotView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs<StoredAttrs>(props)
  const [preview, setPreview] = React.useState(false)
  const activity = (props.extension?.options as any)?.activity
  const src = useImageSrc(attrs, activity?.activity_uuid)
  const spots = React.useMemo(() => normalizeSpots(attrs.spots), [attrs.spots])
  const mode = normalizeMode(attrs.mode)
  const memory = useExperienceMemory(attrs.blockId, props)
  const game = useHotspotGame(spots)
  const learner = !editable || preview
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const instructions = typeof attrs.instructions === 'string' ? attrs.instructions : ''

  const [best, setBest] = React.useState<Stars | null>(() => memory.read<Stars | null>('best', null))

  // Fresh round whenever the author toggles preview or edits the spots.
  useResetOn(`${preview}|${mode}|${JSON.stringify(spots)}`, game.reset)

  const stars: Stars = game.complete ? starsForMisses(game.misses, game.targets.length) : 0
  const onComplete = (misses: number) => {
    const earned = starsForMisses(misses, game.targets.length)
    if (best === null || earned > best) {
      memory.write('best', earned)
      setBest(earned)
    }
  }

  const k = 'activities.experiences.hotspot.'
  let live = ''
  if (learner && mode === 'find') {
    if (game.complete) live = t(`${k}complete_live`, { misses: game.misses })
    else if (game.feedback?.kind === 'hit') live = `${t(`${k}found`, { label: game.feedback.spot.label })} ${game.feedback.spot.explanation ?? ''}`
    else if (game.feedback?.kind === 'miss') live = game.feedback.hint === 'close' ? t(`${k}miss_close`) : t(`${k}miss_far`)
  }

  const allViewed = mode === 'explore' && spots.length > 0 && spots.every((s) => game.viewed.has(s.id))
  const footer = !learner ? undefined : mode === 'find' ? (
    <ExperienceFooter
      progress={{ done: game.found.size, total: game.targets.length }}
      stars={game.complete ? stars : undefined}
      score={game.complete ? t(`${k}misses`, { n: game.misses }) : undefined}
      onRetry={game.found.size > 0 || game.misses > 0 ? game.reset : undefined}
    >
      {best !== null && <span className="text-xs text-neutral-400">{t(`${k}best`, { stars: best })}</span>}
    </ExperienceFooter>
  ) : (
    <ExperienceFooter progress={{ done: game.viewed.size, total: spots.length }} />
  )

  const frame = {
    tone: 'embed' as const,
    icon: <Crosshair weight="duotone" />,
    title,
    onTitleChange: (v: string) => commit({ title: v }),
    titlePlaceholder: t('editor.experiences.hotspot.title_placeholder'),
    instructions,
    onInstructionsChange: (v: string) => commit({ instructions: v }),
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.hotspot.title'),
  }

  return (
    <NodeViewWrapper className="block-exp-hotspot">
      {!learner ? (
        <HotspotAuthor frame={frame} props={props} attrs={attrs} spots={spots} mode={mode} src={src} commit={commit} />
      ) : (
        <ExperienceFrame
          {...frame}
          footer={footer}
          celebrate={(mode === 'find' && game.complete && stars === 3) || allViewed}
          live={live}
        >
          {spots.length === 0 ? (
            <p className="m-0 text-[14px] text-neutral-500">{t(`${k}empty`)}</p>
          ) : mode === 'find' ? (
            <FindPlayer spots={spots} src={src} game={game} alt={title} onComplete={onComplete} />
          ) : (
            <ExplorePlayer spots={spots} src={src} game={game} alt={title} />
          )}
        </ExperienceFrame>
      )}
    </NodeViewWrapper>
  )
}

function HotspotAuthor({
  frame,
  props,
  attrs,
  spots,
  mode,
  src,
  commit,
}: {
  frame: Omit<React.ComponentProps<typeof ExperienceFrame>, 'children'>
  props: NodeViewProps
  attrs: StoredAttrs
  spots: HotspotSpot[]
  mode: HotspotMode
  src: string
  commit: (_patch: CommitPatch<StoredAttrs>) => void
}) {
  const { settings, picker } = useHotspotEditor({ props, attrs, mode, src, commit })
  return (
    <ExperienceFrame {...frame} wysiwyg headerEnd={settings} footer={<AnswerKeyHint />}>
      <HotspotEditor spots={spots} mode={mode} src={src} picker={picker} commit={commit} />
    </ExperienceFrame>
  )
}
