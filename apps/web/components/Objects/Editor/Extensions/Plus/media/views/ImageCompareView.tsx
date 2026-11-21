'use client'
/*
 Image compare: two images stacked, a divider the learner drags (mouse,
 touch, pen) or moves with the arrow keys to reveal one over the other.
 Horizontal or vertical. The stage stays left-to-right in RTL pages, like
 the charts, so "before" is always on the start of the slider's range.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowsClockwise, ArrowsDownUp, ArrowsLeftRight, Image as ImageIcon, SlidersHorizontal, SquareSplitHorizontal } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, CommitInput, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import MediaSourcePicker from '../../../../Blocks/ui/MediaSourcePicker'
import { useBlockUpload } from '../../../../Blocks/media/useBlockUpload'
import { acceptFor } from '../../../../Blocks/media/mediaKinds'
import { normalizeUserUrl } from '../../../../Blocks/embeds/embedProviders'
import { uploadErrorText } from '../../../../Blocks/media/uploadMessages'
import { pickFile } from '../../../../Blocks/nodeViewUtils'
import { cn } from '@/lib/utils'
import { clampPercent, compareKeyStep, COMPARE_ORIENTATIONS, normalizeCompareSide, oneOf, pointerPercent, safeUrl, type CompareSide } from '../mediaModel'
import { activityOf, commitAttrs, useAccessToken, useIsEditable, useMediaUrl } from './shared'

type SideKey = 'before' | 'after'

export default function ImageCompareView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = useIsEditable()
  const { node } = props
  const activity = activityOf(props)
  const mediaUrl = useMediaUrl(activity)
  const accessToken = useAccessToken()
  const orientation = oneOf(COMPARE_ORIENTATIONS, node.attrs.orientation, 'horizontal')
  const horizontal = orientation === 'horizontal'
  const start = clampPercent(node.attrs.start)
  const fallback = { before: t('activities.image_compare.before', 'Before'), after: t('activities.image_compare.after', 'After') }
  const before = normalizeCompareSide(node.attrs.before)
  const after = normalizeCompareSide(node.attrs.after)
  const label = (s: CompareSide, key: SideKey) => s.label || fallback[key]
  const beforeUrl = mediaUrl(before)
  const afterUrl = mediaUrl(after)

  const [pos, setPos] = React.useState(start)
  const [dragging, setDragging] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  // A new start position (the author's setting, undo, a collaborator) resets the divider.
  const [seenStart, setSeenStart] = React.useState(start)
  if (seenStart !== start) {
    setSeenStart(start)
    setPos(start)
  }
  const stageRef = React.useRef<HTMLDivElement | null>(null)

  const setSide = (key: SideKey, patch: Partial<CompareSide> | null) =>
    commitAttrs(props, (live) => {
      const cur = normalizeCompareSide(live[key])
      const next: any = patch === null ? { label: cur.label } : { ...cur, ...patch }
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k]
      return { [key]: { ...next, label: next.label ?? '' } }
    })

  const uploadBefore = useBlockUpload({ kind: 'image', activityUuid: activity?.activity_uuid, accessToken, onUploaded: (o) => setSide('before', { blockObject: o, url: undefined }) })
  const uploadAfter = useBlockUpload({ kind: 'image', activityUuid: activity?.activity_uuid, accessToken, onUploaded: (o) => setSide('after', { blockObject: o, url: undefined }) })
  const uploads = { before: uploadBefore, after: uploadAfter }

  const fromPointer = (e: React.PointerEvent) => {
    const el = stageRef.current
    if (!el) return
    setPos(pointerPercent(el.getBoundingClientRect(), e.clientX, e.clientY, orientation))
  }

  const ready = !!(beforeUrl && afterUrl)
  const sideLabel = (key: SideKey) => t(`editor.blocks_v2.image_compare.${key}_image`, key === 'before' ? 'Before image' : 'After image')

  const blockLabel = (
    <>
      <SquareSplitHorizontal size={11} weight="bold" />
      {t('editor.blocks_v2.image_compare.label', 'Image compare')}
    </>
  )

  // ── Editor: at least one image missing ──
  if (!ready) {
    if (!isEditable) return null
    const slot = (key: SideKey, s: CompareSide, url: string | null) => {
      const up = uploads[key]
      return (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label(s, key)}</div>
          {url ? (
            <div className="relative overflow-hidden rounded-xl ring-1 ring-black/5">
              <img src={url} alt={s.alt ?? label(s, key)} className="block aspect-[4/3] w-full object-cover" draggable={false} />
              <button type="button" onClick={() => setSide(key, null)} className="absolute end-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white hover:bg-black/70">
                {t('editor.blocks_v2.replace', 'Replace')}
              </button>
            </div>
          ) : (
            <MediaSourcePicker
              kind="image"
              icon={<ImageIcon size={20} weight="duotone" />}
              title={sideLabel(key)}
              onFile={(f) => up.start(f)}
              onUrl={(input) => {
                const link = safeUrl(normalizeUserUrl(input) || input)
                if (!link) return uploadErrorText(t, { code: 'url' })
                setSide(key, { url: link, blockObject: undefined })
              }}
              urlPlaceholder={t('editor.blocks_v2.image_link_placeholder', 'Paste an image link…')}
              task={up.task}
              rejection={up.rejection}
              onCancel={up.cancel}
              onRetry={up.retry}
              onDismiss={up.dismiss}
            />
          )}
        </div>
      )
    }
    return (
      <NodeViewWrapper className="lh-image-compare my-4">
        <EditorBlockFrame editable node={node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="media" label={blockLabel}>
          <div contentEditable={false} className="rounded-xl bg-neutral-50/60 p-3 ring-1 ring-inset ring-neutral-200/70">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                <SquareSplitHorizontal size={16} weight="duotone" />
              </span>
              <div>
                <div className="text-[14px] font-semibold text-neutral-800">{t('editor.blocks_v2.image_compare.empty_title', 'Add images')}</div>
                <div className="text-[12px] text-neutral-500">{t('editor.blocks_v2.image_compare.empty_hint', 'Pick a before and an after image of the same size. Learners drag the divider to compare them.')}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {slot('before', before, beforeUrl)}
              {slot('after', after, afterUrl)}
            </div>
          </div>
        </EditorBlockFrame>
      </NodeViewWrapper>
    )
  }

  const tools = (
    <>
      <BlockPopover
        open={open}
        onOpenChange={setOpen}
        title={t('editor.blocks_v2.image_compare.label', 'Image compare')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.image_compare.settings', 'Comparison settings')} active={open}>
            <SlidersHorizontal size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField label={t('editor.blocks_v2.image_compare.orientation', 'Direction')}>
          <Segmented
            ariaLabel={t('editor.blocks_v2.image_compare.orientation', 'Direction')}
            value={orientation}
            onChange={(v) => commitAttrs(props, { orientation: v })}
            options={[
              { value: 'horizontal', label: <><ArrowsLeftRight size={13} />{t('editor.blocks_v2.image_compare.horizontal', 'Side by side')}</> },
              { value: 'vertical', label: <><ArrowsDownUp size={13} />{t('editor.blocks_v2.image_compare.vertical', 'Top and bottom')}</> },
            ]}
          />
        </SettingsField>
        {(['before', 'after'] as SideKey[]).map((key) => {
          const s = key === 'before' ? before : after
          return (
            <SettingsField key={key} label={sideLabel(key)}>
              <CommitInput value={s.label} placeholder={fallback[key]} aria-label={`${sideLabel(key)}: ${t('editor.blocks_v2.image_compare.side_label', 'Label')}`} onCommit={(v) => setSide(key, { label: v.trim().slice(0, 80) })} />
              <CommitInput value={s.alt ?? ''} placeholder={t('editor.blocks_v2.alt_text_placeholder', 'A bar chart showing…')} aria-label={t('editor.blocks_v2.alt_text', 'Alt text')} onCommit={(v) => setSide(key, { alt: v.trim().slice(0, 500) || undefined })} />
            </SettingsField>
          )
        })}
        <SettingsField label={t('editor.blocks_v2.image_compare.start', 'Divider starts at')} hint={`${start}%`}>
          <input type="range" min={0} max={100} value={start} onChange={(e) => commitAttrs(props, { start: clampPercent(e.target.value) })} className="w-full accent-neutral-900" aria-label={t('editor.blocks_v2.image_compare.start', 'Divider starts at')} />
        </SettingsField>
      </BlockPopover>
      <BlockToolbarButton label={t('editor.blocks_v2.image_compare.replace_before', 'Replace before image')} onClick={() => pickFile(acceptFor('image'), (f) => uploadBefore.start(f))}>
        <ArrowsClockwise size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.image_compare.replace_after', 'Replace after image')} onClick={() => pickFile(acceptFor('image'), (f) => uploadAfter.start(f))}>
        <ArrowsClockwise size={14} className="-scale-x-100" />
      </BlockToolbarButton>
    </>
  )

  // After on top, clipped to the part past the divider.
  const clip = horizontal ? `inset(0 0 0 ${pos}%)` : `inset(${pos}% 0 0 0)`
  const busy = uploadBefore.task || uploadAfter.task
  const valueText = t('activities.image_compare.value', '{{before}} {{b}}%, {{after}} {{a}}%', { before: label(before, 'before'), after: label(after, 'after'), b: pos, a: 100 - pos })

  return (
    <NodeViewWrapper className="lh-image-compare my-5" data-orientation={orientation}>
      <EditorBlockFrame editable={isEditable} node={node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="media" label={blockLabel} tools={tools} forceToolbar={open}>
        <figure className="m-0">
          <div
            ref={stageRef}
            dir="ltr"
            contentEditable={false}
            className={cn('lh-compare-stage relative select-none overflow-hidden rounded-xl bg-neutral-100', horizontal ? 'cursor-ew-resize' : 'cursor-ns-resize', dragging && 'is-dragging')}
            style={{ touchAction: horizontal ? 'pan-y' : 'pan-x' }}
            onPointerDown={(e) => {
              if (e.button !== 0 && e.pointerType === 'mouse') return
              e.preventDefault()
              ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
              setDragging(true)
              fromPointer(e)
              stageRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true })
            }}
            onPointerMove={(e) => dragging && fromPointer(e)}
            onPointerUp={(e) => {
              setDragging(false)
              ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
            }}
            onPointerCancel={() => setDragging(false)}
          >
            <img src={beforeUrl!} alt={before.alt ?? label(before, 'before')} className="block h-auto w-full" draggable={false} />
            <img src={afterUrl!} alt={after.alt ?? label(after, 'after')} className="absolute inset-0 block h-full w-full object-cover" style={{ clipPath: clip, WebkitClipPath: clip }} draggable={false} />
            <span className={cn('lh-compare-tag pointer-events-none absolute rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white', horizontal ? 'start-2 top-2' : 'start-2 top-2')}>{label(before, 'before')}</span>
            <span className={cn('lh-compare-tag pointer-events-none absolute rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white', horizontal ? 'end-2 top-2' : 'bottom-2 start-2')}>{label(after, 'after')}</span>
            <div
              role="slider"
              tabIndex={0}
              aria-label={t('activities.image_compare.slider', 'Compare images')}
              aria-orientation={orientation}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pos}
              aria-valuetext={valueText}
              onKeyDown={(e) => {
                const next = compareKeyStep(e.key, pos, orientation)
                if (next === null) return
                e.preventDefault()
                e.stopPropagation()
                setPos(next)
              }}
              className={cn('lh-compare-handle group absolute outline-none', horizontal ? 'inset-y-0 w-0' : 'inset-x-0 h-0')}
              style={horizontal ? { left: `${pos}%` } : { top: `${pos}%` }}
            >
              <span aria-hidden className={cn('absolute bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]', horizontal ? 'inset-y-0 -translate-x-1/2 w-0.5' : 'inset-x-0 -translate-y-1/2 h-0.5')} />
              <span
                aria-hidden
                className={cn(
                  'absolute start-0 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-700 shadow-[0_2px_8px_rgba(0,0,0,0.25)] ring-2 ring-transparent transition-shadow group-focus-visible:ring-sky-500',
                  !horizontal && 'start-1/2 top-0',
                )}
              >
                {horizontal ? <ArrowsLeftRight size={16} weight="bold" /> : <ArrowsDownUp size={16} weight="bold" />}
              </span>
            </div>
          </div>
          {busy && <p className="m-0 mt-2 text-xs text-neutral-500">{t('editor.blocks_v2.processing', 'Finishing up…')}</p>}
        </figure>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
