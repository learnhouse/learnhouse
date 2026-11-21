'use client'
/*
 Gallery: several images as a grid, a masonry wall or a carousel, each with
 an optional caption and (required) alt text. Learners open any image in a
 lightbox; the carousel moves with swipes, the arrow buttons, the dots and
 the keyboard. Uploads use the image block's endpoint and storage.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowsOut, CaretLeft, CaretRight, Images, Plus, SlidersHorizontal, Trash, Warning } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, BlockToolbarDivider, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import MediaSourcePicker from '../../../../Blocks/ui/MediaSourcePicker'
import { acceptFor, formatHint } from '../../../../Blocks/media/mediaKinds'
import { uploadErrorText } from '../../../../Blocks/media/uploadMessages'
import { normalizeUserUrl } from '../../../../Blocks/embeds/embedProviders'
import { cn } from '@/lib/utils'
import {
  GALLERY_COLUMNS,
  GALLERY_LAYOUTS,
  MAX_GALLERY_IMAGES,
  missingAltCount,
  moveItem,
  newId,
  normalizeGalleryImages,
  oneOf,
  safeUrl,
  wrapIndex,
  type GalleryImage,
  type GalleryLayout,
} from '../mediaModel'
import { activityOf, commitAttrs, DropZone, InlineInput, pickFiles, useAccessToken, useIsEditable, useMediaUrl, useReducedMotion, useUploads } from './shared'

const GRID_COLS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 md:grid-cols-4' }
const MASONRY_COLS: Record<number, string> = { 2: 'columns-2', 3: 'columns-2 sm:columns-3', 4: 'columns-2 md:columns-4' }

interface Shown extends GalleryImage {
  src: string
}

function Lightbox({ images, index, onIndex, onClose }: { images: Shown[]; index: number | null; onIndex: (_i: number) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const img = index === null ? null : images[index]
  const many = images.length > 1
  return (
    <Modal
      isDialogOpen={index !== null}
      onOpenChange={(o) => !o && onClose()}
      dialogTitle={img?.caption || t('activities.gallery.viewer_title', 'Image {{n}} of {{count}}', { n: (index ?? 0) + 1, count: images.length })}
      size="xl"
      dialogContent={
        img ? (
          <div
            className="flex flex-col items-center gap-3"
            onKeyDown={(e) => {
              if (!many) return
              if (e.key === 'ArrowRight') onIndex(wrapIndex((index ?? 0) + 1, images.length))
              else if (e.key === 'ArrowLeft') onIndex(wrapIndex((index ?? 0) - 1, images.length))
              else return
              e.preventDefault()
            }}
          >
            <div dir="ltr" className="relative flex w-full items-center justify-center">
              <img src={img.src} alt={img.alt ?? ''} className="max-h-[72vh] max-w-full rounded-lg object-contain" />
              {many && (
                <>
                  <button type="button" onClick={() => onIndex(wrapIndex((index ?? 0) - 1, images.length))} aria-label={t('activities.gallery.previous', 'Previous image')} className="absolute start-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                    <CaretLeft size={18} weight="bold" />
                  </button>
                  <button type="button" onClick={() => onIndex(wrapIndex((index ?? 0) + 1, images.length))} aria-label={t('activities.gallery.next', 'Next image')} className="absolute end-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                    <CaretRight size={18} weight="bold" />
                  </button>
                </>
              )}
            </div>
            {many && <div className="text-xs tabular-nums text-neutral-500">{t('activities.gallery.counter', '{{n}} / {{count}}', { n: (index ?? 0) + 1, count: images.length })}</div>}
          </div>
        ) : null
      }
    />
  )
}

function Carousel({ images, onOpen }: { images: Shown[]; onOpen: (_i: number) => void }) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const [index, setIndex] = React.useState(0)
  const [drag, setDrag] = React.useState<{ x: number; dx: number; id: number; w: number } | null>(null)
  const viewport = React.useRef<HTMLDivElement | null>(null)
  // A swipe ends with a click on the slide; that click must not open the lightbox.
  const swiped = React.useRef(false)
  const count = images.length
  const current = Math.min(index, count - 1)
  // `current` already clamps an index left over from a longer list.
  const go = (i: number) => setIndex(wrapIndex(i, count))
  const offset = drag ? (drag.dx / drag.w) * 100 : 0

  return (
    <div
      role="region"
      aria-roledescription={t('activities.gallery.carousel', 'carousel')}
      aria-label={t('activities.gallery.label', 'Image gallery')}
      tabIndex={0}
      className="lh-gallery-carousel rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(current + 1)
        else if (e.key === 'ArrowLeft') go(current - 1)
        else if (e.key === 'Home') go(0)
        else if (e.key === 'End') go(count - 1)
        else return
        e.preventDefault()
      }}
    >
      <div
        ref={viewport}
        dir="ltr"
        className="relative overflow-hidden rounded-xl bg-neutral-100"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          setDrag({ x: e.clientX, dx: 0, id: e.pointerId, w: e.currentTarget.getBoundingClientRect().width || 1 })
        }}
        onPointerMove={(e) => {
          if (!drag || drag.id !== e.pointerId) return
          const dx = e.clientX - drag.x
          if (Math.abs(dx) > 6) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
          setDrag({ ...drag, dx })
        }}
        onPointerUp={(e) => {
          if (!drag) return
          const { dx, w } = drag
          swiped.current = Math.abs(dx) > 6
          setDrag(null)
          ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
          if (Math.abs(dx) > Math.min(60, w * 0.15)) go(current + (dx < 0 ? 1 : -1))
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div
          className="flex"
          style={{ transform: `translateX(${-current * 100 + offset}%)`, transition: drag || reduced ? 'none' : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          aria-live="polite"
        >
          {images.map((img, i) => (
            <figure
              key={img.id}
              className="m-0 w-full flex-none"
              role="group"
              aria-roledescription={t('activities.gallery.slide', 'slide')}
              aria-label={t('activities.gallery.counter', '{{n}} / {{count}}', { n: i + 1, count })}
              aria-hidden={i !== current}
            >
              <button
                type="button"
                tabIndex={i === current ? 0 : -1}
                onClick={() => {
                  if (swiped.current) swiped.current = false
                  else onOpen(i)
                }}
                aria-label={t('activities.gallery.open_image', 'Open image {{n}} of {{count}}', { n: i + 1, count })}
                className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/60"
              >
                <img src={img.src} alt={img.alt ?? ''} draggable={false} loading={Math.abs(i - current) > 1 ? 'lazy' : undefined} className="mx-auto block aspect-[16/10] w-full select-none object-contain" />
              </button>
            </figure>
          ))}
        </div>
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(current - 1)} aria-label={t('activities.gallery.previous', 'Previous image')} className="absolute start-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-md ring-1 ring-black/5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
              <CaretLeft size={16} weight="bold" />
            </button>
            <button type="button" onClick={() => go(current + 1)} aria-label={t('activities.gallery.next', 'Next image')} className="absolute end-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-md ring-1 ring-black/5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
              <CaretRight size={16} weight="bold" />
            </button>
          </>
        )}
      </div>
      {images[current]?.caption && <p className="m-0 mt-2 text-center text-[13px] text-neutral-600">{images[current].caption}</p>}
      {count > 1 && (
        <div dir="ltr" className="mt-2.5 flex items-center justify-center gap-1.5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => go(i)}
              aria-label={t('activities.gallery.go_to', 'Show image {{n}}', { n: i + 1 })}
              aria-current={i === current ? 'true' : undefined}
              className={cn('h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60', i === current ? 'w-5 bg-neutral-800' : 'w-2 bg-neutral-300 hover:bg-neutral-400')}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function GalleryView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = useIsEditable()
  const { node } = props
  const activity = activityOf(props)
  const mediaUrl = useMediaUrl(activity)
  const uploads = useUploads({ activityUuid: activity?.activity_uuid, accessToken: useAccessToken() })
  const images = React.useMemo(() => normalizeGalleryImages(node.attrs.images), [node.attrs.images])
  const layout = oneOf(GALLERY_LAYOUTS, node.attrs.layout, 'grid')
  const columns = oneOf(GALLERY_COLUMNS, node.attrs.columns, 3)
  const shown: Shown[] = images.map((img) => ({ ...img, src: mediaUrl(img) ?? '' })).filter((img) => img.src)
  const [lightbox, setLightbox] = React.useState<number | null>(null)
  const [open, setOpen] = React.useState(false)

  const setImages = (fn: (_list: GalleryImage[]) => GalleryImage[]) => commitAttrs(props, (live) => ({ images: fn(normalizeGalleryImages(live.images)) }))
  const patchImage = (id: string, patch: Partial<GalleryImage>) =>
    setImages((list) =>
      list.map((img) => {
        if (img.id !== id) return img
        const next: any = { ...img, ...patch }
        for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k]
        return next
      }),
    )

  const room = MAX_GALLERY_IMAGES - images.length - uploads.tasks.length
  const addFiles = (files: File[]) => {
    for (const file of files.slice(0, Math.max(0, room))) {
      uploads.start(file, 'image', (blockObject) => setImages((list) => (list.length >= MAX_GALLERY_IMAGES ? list : [...list, { id: newId('img'), blockObject }])))
    }
  }
  const addLink = (input: string): string | void => {
    const url = safeUrl(normalizeUserUrl(input) || input)
    if (!url) return uploadErrorText(t, { code: 'url' })
    if (room <= 0) return t('editor.blocks_v2.gallery.full', 'A gallery holds up to {{max}} images.', { max: MAX_GALLERY_IMAGES })
    setImages((list) => [...list, { id: newId('img'), url }])
  }

  const label = (
    <>
      <Images size={11} weight="bold" />
      {t('editor.blocks_v2.gallery.label', 'Gallery')}
    </>
  )
  const hint = formatHint('image')
  const rejection = uploads.rejections[uploads.rejections.length - 1]
  const progress = uploads.tasks.length ? (
    <div className="mt-3 flex flex-col gap-2">
      {uploads.tasks.map((task) => (
        <MediaSourcePicker key={task.id} kind="image" icon={<Images size={18} />} title="" onFile={() => {}} task={task} onCancel={() => uploads.cancel(task.id)} onRetry={() => uploads.retry(task.id)} onDismiss={() => uploads.dismiss(task.id)} />
      ))}
    </div>
  ) : null
  const rejectionText = rejection ? (
    <p role="alert" className="m-0 mt-2 text-xs text-rose-600">
      {rejection.fileName}: {uploadErrorText(t, { code: rejection.code, kind: 'image', fileSize: rejection.fileSize })}
    </p>
  ) : null

  // ── Learner ──
  if (!isEditable) {
    if (!shown.length) return null
    let body: React.ReactNode
    if (layout === 'carousel') body = <Carousel images={shown} onOpen={setLightbox} />
    else {
      const tile = (img: Shown, i: number) => (
        <figure key={img.id} className={cn('m-0 min-w-0', layout === 'masonry' && 'mb-2 break-inside-avoid')}>
          <button
            type="button"
            onClick={() => setLightbox(i)}
            aria-label={t('activities.gallery.open_image', 'Open image {{n}} of {{count}}', { n: i + 1, count: shown.length })}
            className="group relative block w-full overflow-hidden rounded-xl bg-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            <img src={img.src} alt={img.alt ?? ''} loading="lazy" className={cn('block w-full transition-transform duration-300 motion-safe:group-hover:scale-[1.02]', layout === 'grid' ? 'aspect-[4/3] object-cover' : 'h-auto')} />
            <span aria-hidden className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <ArrowsOut size={14} />
            </span>
          </button>
          {img.caption && <figcaption className="mt-1.5 text-[13px] leading-snug text-neutral-600">{img.caption}</figcaption>}
        </figure>
      )
      body = layout === 'masonry' ? <div className={cn('gap-2', MASONRY_COLS[columns])}>{shown.map(tile)}</div> : <div className={cn('grid gap-2 sm:gap-3', GRID_COLS[columns])}>{shown.map(tile)}</div>
    }
    return (
      <NodeViewWrapper className="lh-gallery my-5" data-layout={layout}>
        <div role={layout === 'carousel' ? undefined : 'group'} aria-label={layout === 'carousel' ? undefined : t('activities.gallery.label', 'Image gallery')}>
          {body}
        </div>
        <Lightbox images={shown} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      </NodeViewWrapper>
    )
  }

  // ── Editor, empty ──
  if (!images.length) {
    return (
      <NodeViewWrapper className="lh-gallery my-4">
        <EditorBlockFrame editable node={node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="media" label={label}>
          <DropZone
            icon={<Images size={20} weight="duotone" />}
            title={t('editor.blocks_v2.gallery.empty_title', 'Add images to your gallery')}
            hint={t('editor.blocks_v2.gallery.empty_hint', 'Drop several images at once, or pick them from your device. {{formats}} · up to {{max}} each.', { formats: hint.formats, max: hint.max })}
            actionLabel={t('editor.blocks_v2.gallery.add_images', 'Add images')}
            accept={acceptFor('image')}
            multiple
            onFiles={addFiles}
            onUrl={addLink}
            urlPlaceholder={t('editor.blocks_v2.image_link_placeholder', 'Paste an image link…')}
            linkLabel={t('editor.blocks_v2.from_link', 'From a link')}
            addLabel={t('editor.blocks_v2.gallery.add_link', 'Add image')}
          />
          {progress}
          {rejectionText}
        </EditorBlockFrame>
      </NodeViewWrapper>
    )
  }

  // ── Editor, with images ──
  const missing = missingAltCount(images)
  const tools = (
    <>
      <BlockToolbarButton label={t('editor.blocks_v2.gallery.add_images', 'Add images')} disabled={room <= 0} onClick={() => pickFiles(acceptFor('image'), true, addFiles)}>
        <Plus size={14} />
      </BlockToolbarButton>
      <BlockToolbarDivider />
      <BlockPopover
        open={open}
        onOpenChange={setOpen}
        title={t('editor.blocks_v2.gallery.label', 'Gallery')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.gallery.settings', 'Gallery settings')} active={open}>
            <SlidersHorizontal size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField label={t('editor.blocks_v2.gallery.layout', 'Layout')}>
          <Segmented
            ariaLabel={t('editor.blocks_v2.gallery.layout', 'Layout')}
            value={layout}
            onChange={(v: GalleryLayout) => commitAttrs(props, { layout: v })}
            options={[
              { value: 'grid', label: t('editor.blocks_v2.gallery.layout_grid', 'Grid') },
              { value: 'masonry', label: t('editor.blocks_v2.gallery.layout_masonry', 'Masonry') },
              { value: 'carousel', label: t('editor.blocks_v2.gallery.layout_carousel', 'Carousel') },
            ]}
          />
        </SettingsField>
        {layout !== 'carousel' && (
          <SettingsField label={t('editor.blocks_v2.gallery.columns', 'Columns')}>
            <Segmented ariaLabel={t('editor.blocks_v2.gallery.columns', 'Columns')} value={String(columns) as '2' | '3' | '4'} onChange={(v) => commitAttrs(props, { columns: Number(v) })} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} />
          </SettingsField>
        )}
      </BlockPopover>
    </>
  )

  const field = 'h-7 w-full min-w-0 rounded-md bg-transparent px-1.5 text-[12px] outline-none placeholder:text-neutral-400 hover:bg-neutral-50 focus:bg-white focus:shadow-[0_0_0_1px_rgba(0,0,0,0.2)]'
  return (
    <NodeViewWrapper className="lh-gallery my-4" data-layout={layout}>
      <EditorBlockFrame editable node={node} editor={props.editor} getPos={props.getPos} selected={props.selected} tone="media" label={label} tools={tools} forceToolbar={open}>
        <div contentEditable={false}>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-500">
            <span>{t(`editor.blocks_v2.gallery.layout_${layout}`, layout)} · {t('editor.blocks_v2.gallery.count', 'Images: {{n}}', { n: images.length })}</span>
            {missing > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <Warning size={13} weight="fill" />
                {t('editor.blocks_v2.gallery.alt_missing', 'Alt text missing: {{n}}', { n: missing })}
              </span>
            )}
          </div>
          <div className={cn('grid gap-3', GRID_COLS[columns])}>
            {images.map((img, i) => {
              const src = mediaUrl(img)
              const noAlt = !img.alt?.trim()
              return (
                <div key={img.id} className="group/tile flex min-w-0 flex-col gap-1">
                  <div className="relative overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-black/5">
                    {src ? <img src={src} alt={img.alt ?? ''} draggable={false} className="block aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3]" />}
                    <div className="absolute inset-x-1.5 top-1.5 flex justify-between opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100">
                      <div className="flex gap-1">
                        <button type="button" disabled={i === 0} onClick={() => setImages((list) => moveItem(list, i, i - 1))} aria-label={t('editor.blocks_v2.gallery.move_earlier', 'Move earlier')} title={t('editor.blocks_v2.gallery.move_earlier', 'Move earlier')} className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white hover:bg-black/70 disabled:opacity-30">
                          <CaretLeft size={12} weight="bold" className="rtl:-scale-x-100" />
                        </button>
                        <button type="button" disabled={i === images.length - 1} onClick={() => setImages((list) => moveItem(list, i, i + 1))} aria-label={t('editor.blocks_v2.gallery.move_later', 'Move later')} title={t('editor.blocks_v2.gallery.move_later', 'Move later')} className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white hover:bg-black/70 disabled:opacity-30">
                          <CaretRight size={12} weight="bold" className="rtl:-scale-x-100" />
                        </button>
                      </div>
                      <button type="button" onClick={() => setImages((list) => list.filter((x) => x.id !== img.id))} aria-label={t('editor.blocks_v2.gallery.remove', 'Remove image')} title={t('editor.blocks_v2.gallery.remove', 'Remove image')} className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white hover:bg-rose-600">
                        <Trash size={12} />
                      </button>
                    </div>
                  </div>
                  <InlineInput value={img.caption ?? ''} maxLength={300} onCommit={(v) => patchImage(img.id, { caption: v.trim() || undefined })} placeholder={t('editor.blocks_v2.caption_placeholder', 'Add a caption…')} aria-label={t('editor.blocks_v2.caption', 'Caption')} className={cn(field, 'text-neutral-700')} />
                  <InlineInput
                    value={img.alt ?? ''}
                    maxLength={500}
                    onCommit={(v) => patchImage(img.id, { alt: v.trim() || undefined })}
                    placeholder={t('editor.blocks_v2.gallery.alt_placeholder', 'Alt text (required)')}
                    aria-label={t('editor.blocks_v2.alt_text', 'Alt text')}
                    aria-invalid={noAlt || undefined}
                    className={cn(field, noAlt ? 'bg-amber-50/80 text-amber-900 placeholder:text-amber-700/70' : 'text-neutral-500')}
                  />
                  {noAlt && <span className="px-1.5 text-[11px] leading-snug text-amber-700">{t('editor.blocks_v2.gallery.alt_hint', 'Say what the image shows, for learners using a screen reader.')}</span>}
                </div>
              )
            })}
            {room > 0 && (
              <button type="button" onClick={() => pickFiles(acceptFor('image'), true, addFiles)} className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 text-[12px] font-medium text-neutral-500 transition-colors hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-700">
                <Plus size={18} />
                {t('editor.blocks_v2.gallery.add_images', 'Add images')}
              </button>
            )}
          </div>
          {progress}
          {rejectionText}
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
