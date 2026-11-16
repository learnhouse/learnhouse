'use client'
import React from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import {
  ArrowSquareOut, ArrowsClockwise, CircleNotch, Globe, Link as LinkIcon, PencilSimple, SlidersHorizontal, TextAa, WarningCircle,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { getUrlPreview } from '@services/courses/activities'
import { safeExternalUrl, safeImageSrc } from '@services/security/url'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useUrlEmbedSandbox } from '@/lib/media/useUrlEmbedSandbox'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, BlockToolbarDivider, CommitInput, FIELD_CLASS, Segmented, SettingsField } from '../../Blocks/ui/BlockChrome'
import {
  isThinMetadata, metadataAttrsFrom, normalizePreviewUrl, previewAlignOf, previewLayoutOf, previewTextOf, type PreviewLayout,
} from './previewMeta'

const JUSTIFY = { left: 'justify-start', center: 'justify-center', right: 'justify-end' } as const

async function fetchMetadata(url: string) {
  const res: any = await getUrlPreview(url)
  // The endpoint answers errors with { detail } (rate limit, unreachable page).
  if (!res || typeof res !== 'object' || res.detail) throw new Error(typeof res?.detail === 'string' ? res.detail : 'preview failed')
  return metadataAttrsFrom(res)
}

/** The card itself; the same markup for learners and the editor preview. */
function PreviewCard({
  attrs, layout, editing, onOpenPopup,
}: {
  attrs: Record<string, any>
  layout: PreviewLayout
  editing?: boolean
  onOpenPopup?: () => void
}) {
  const { t } = useTranslation()
  const href = safeExternalUrl(attrs.url)
  const image = safeImageSrc(attrs.og_image)
  const favicon = safeImageSrc(attrs.favicon)
  // Remember which src failed, so a new image (after Refresh) gets its chance.
  const [brokenImage, setBrokenImage] = React.useState<string | null>(null)
  const [brokenFavicon, setBrokenFavicon] = React.useState<string | null>(null)
  const { title, description, host } = previewTextOf(attrs)
  const showImage = !!image && brokenImage !== image
  const buttonLabel = (typeof attrs.buttonLabel === 'string' && attrs.buttonLabel.trim()) || t('editor.blocks.web_preview_block.visit_site', 'Visit site')
  // In the editor the card is a preview: clicks select the block.
  const linkProps = editing
    ? { tabIndex: -1, onClick: (e: React.MouseEvent) => e.preventDefault() }
    : { target: '_blank', rel: 'noopener noreferrer nofollow' }

  // The original card: white, image bleeding to the edges, the full URL with
  // its favicon under a hairline, and the solid black "Visit" button.
  const footer = (
    <span className="mt-0 flex items-center border-t border-gray-100 pt-2">
      {favicon && brokenFavicon !== favicon ? (
        <img src={favicon} alt="" className="me-2 h-[18px] w-[18px] shrink-0 rounded bg-gray-100 object-contain" onError={() => setBrokenFavicon(favicon)} />
      ) : (
        <Globe size={16} className="me-2 shrink-0 text-gray-400" />
      )}
      <span className="truncate text-xs text-gray-500" dir="ltr">{attrs.url || host}</span>
    </span>
  )

  const buttonCls = 'mt-4 block w-full rounded-xl bg-black px-4 py-2.5 text-center text-[16px] font-semibold text-white nice-shadow transition-all hover:bg-gray-900 hover:shadow-lg !no-underline'
  const button = attrs.showButton && href ? (
    attrs.openInPopup && !editing ? (
      <button type="button" onClick={onOpenPopup} className={buttonCls}>{buttonLabel}</button>
    ) : (
      <a href={href} {...linkProps} className={buttonCls} style={{ color: 'var(--color-white)', textDecoration: 'none' }}>
        {buttonLabel}
      </a>
    )
  ) : null

  const titleEl = <span className="mb-1.5 block font-semibold leading-tight text-[var(--lhb-text,#232323)] group-hover/wp:underline" dir="auto">{title}</span>
  const descEl = description ? <span className="mb-3 block text-sm leading-snug text-gray-700" dir="auto">{description}</span> : null

  if (layout === 'compact') {
    return (
      <div className="relative w-full min-w-[260px] max-w-[560px] rounded-xl bg-white px-5 pb-4 pt-4 nice-shadow">
        <a href={href ?? undefined} {...linkProps} className="group/wp flex items-start gap-4 no-underline hover:no-underline" style={{ textDecoration: 'none' }}>
          <span className="min-w-0 flex-1 pb-1">
            <span className="text-base">{titleEl}</span>
            {descEl && <span className="line-clamp-2">{descEl}</span>}
          </span>
          {showImage && (
            <img src={image} alt={t('editor.blocks.web_preview_block.preview_alt', 'Preview')} className="h-20 w-28 shrink-0 rounded-lg object-cover" onError={() => setBrokenImage(image || null)} />
          )}
        </a>
        {footer}
        {button}
      </div>
    )
  }

  return (
    <div className="relative my-2 w-full min-w-[260px] max-w-[420px] rounded-xl bg-white px-6 pb-4 pt-6 nice-shadow">
      <a href={href ?? undefined} {...linkProps} className="group/wp block no-underline hover:no-underline" style={{ textDecoration: 'none' }}>
        {showImage && (
          <span className="-mx-6 -mt-6 mb-0 block overflow-hidden rounded-t-xl">
            <img src={image} alt={t('editor.blocks.web_preview_block.preview_alt', 'Preview')} className="block h-40 w-full object-cover" onError={() => setBrokenImage(image || null)} />
          </span>
        )}
        <span className="block pb-2 pt-4">
          <span className="text-lg">{titleEl}</span>
          {descEl}
        </span>
      </a>
      {footer}
      {button}
    </div>
  )
}

function CardSkeleton({ url }: { url: string }) {
  const { t } = useTranslation()
  return (
    <div aria-busy="true" className="my-2 w-full min-w-[260px] max-w-[420px] overflow-hidden rounded-xl bg-white px-6 pb-4 pt-6 nice-shadow">
      <div className="-mx-6 -mt-6 h-40 animate-pulse bg-gray-100" />
      <div className="flex flex-col gap-2 pb-2 pt-4">
        <span className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
        <span className="h-3 w-full animate-pulse rounded bg-gray-100" />
      </div>
      <span className="flex items-center gap-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
        <CircleNotch size={12} className="animate-spin" /> {t('editor.blocks_v2.web_preview.fetching', 'Fetching preview…')}
        <span className="truncate" dir="ltr">{url}</span>
      </span>
    </div>
  )
}

const WebPreviewComponent: React.FC<any> = (props) => {
  const { node, updateAttributes, editor, getPos, selected } = props
  const { t } = useTranslation()
  const editorContext = useEditorProvider() as any
  const isEditable = editorContext?.isEditable ?? true
  const attrs = node.attrs
  const url: string = attrs.url || ''
  const layout = previewLayoutOf(attrs.layout)
  const align = previewAlignOf(attrs.alignment)
  const previewUrl = safeExternalUrl(url)
  const sandbox = useUrlEmbedSandbox(previewUrl)
  const [popupOpen, setPopupOpen] = React.useState(false)

  // ─── Editor-only transient state ───
  const [editingLink, setEditingLink] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [fetching, setFetching] = React.useState<string | null>(null)
  const [error, setError] = React.useState<{ message: string; url?: string } | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState<null | 'text' | 'display'>(null)
  const mounted = React.useRef(true)
  React.useEffect(() => () => { mounted.current = false }, [])

  const submitLink = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const next = normalizePreviewUrl(draft)
    if (!next) {
      setError({ message: t('editor.blocks_v2.errors.url', 'That doesn’t look like a web link.') })
      return
    }
    setError(null)
    setFetching(next)
    try {
      const meta = await fetchMetadata(next)
      if (!mounted.current) return
      // One write with everything; a new page drops the old page's overrides.
      updateAttributes({ ...meta, url: next, customTitle: null, customDescription: null })
      setEditingLink(false)
      setNotice(isThinMetadata(meta) ? t('editor.blocks.web_preview_block.metadata_unavailable', 'This site shares little preview information. You can write the title and description yourself.') : null)
    } catch {
      if (mounted.current) setError({ message: t('editor.blocks_v2.web_preview.fetch_failed', 'We couldn’t read that page. Check the link, or add it as a plain link card.'), url: next })
    } finally {
      if (mounted.current) setFetching(null)
    }
  }

  // Keep the link without metadata: the card shows the site's name.
  const addPlain = (link: string) => {
    updateAttributes({ url: link, title: null, description: null, og_image: null, favicon: null, og_type: null, og_url: null, customTitle: null, customDescription: null })
    setError(null)
    setEditingLink(false)
  }

  const refresh = async () => {
    if (!previewUrl || refreshing) return
    setRefreshing(true)
    setNotice(null)
    try {
      const meta = await fetchMetadata(previewUrl)
      if (!mounted.current) return
      if (isThinMetadata(meta)) setNotice(t('editor.blocks_v2.web_preview.refresh_empty', 'The page returned no preview information, so the card was left as it was.'))
      // Only the page's own fields: the author's overrides stay.
      else updateAttributes(meta)
    } catch {
      if (mounted.current) setNotice(t('editor.blocks_v2.web_preview.refresh_failed', 'Couldn’t refresh: the page didn’t answer.'))
    } finally {
      if (mounted.current) setRefreshing(false)
    }
  }

  // Cards added by the AI or an import carry a URL but no metadata yet. Fill
  // it in once, from the editor only (never on a learner's page load).
  const autoFetched = React.useRef(false)
  React.useEffect(() => {
    if (!isEditable || autoFetched.current || !previewUrl || attrs.title || attrs.description || attrs.og_image) return
    autoFetched.current = true
    fetchMetadata(previewUrl)
      .then((meta) => {
        if (mounted.current && !isThinMetadata(meta)) updateAttributes(meta)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditable, previewUrl])

  // ─── Learner ───
  if (!isEditable) {
    if (!previewUrl) return <NodeViewWrapper className="web-preview-block" />
    return (
      <NodeViewWrapper className="web-preview-block">
        <div className={cn('flex w-full', JUSTIFY[align])}>
          <PreviewCard attrs={attrs} layout={layout} onOpenPopup={() => setPopupOpen(true)} />
        </div>
        {attrs.openInPopup && (
          <Modal
            isDialogOpen={popupOpen}
            onOpenChange={setPopupOpen}
            dialogTitle={previewTextOf(attrs).title || t('editor.blocks.web_preview_block.website_preview')}
            minWidth="xl"
            minHeight="xl"
            dialogContent={
              previewUrl && sandbox ? (
                <iframe
                  src={previewUrl}
                  title={t('editor.blocks.web_preview_block.embedded_preview')}
                  className="h-full w-full border-0 bg-white"
                  style={{ display: 'block', borderRadius: 0 }}
                  allowFullScreen
                  sandbox={sandbox}
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              ) : null
            }
          />
        )}
      </NodeViewWrapper>
    )
  }

  // ─── Editor ───
  const startEditLink = () => {
    setDraft(url)
    setError(null)
    setEditingLink(true)
  }

  const linkForm = (
    <form
      noValidate
      onSubmit={submitLink}
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && url) setEditingLink(false)
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <LinkIcon size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            autoFocus={editingLink}
            type="url"
            inputMode="url"
            value={draft}
            disabled={!!fetching}
            onChange={(e) => { setDraft(e.target.value); setError(null) }}
            placeholder={t('editor.blocks_v2.web_preview.placeholder', 'Paste a link to any page…')}
            aria-label={t('editor.blocks.web_preview_block.website_url', 'Website URL')}
            className={cn(FIELD_CLASS, 'ps-8')}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {url && (
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setEditingLink(false)}>
              {t('editor.blocks.common.cancel', 'Cancel')}
            </button>
          )}
          <button type="submit" disabled={!draft.trim() || !!fetching} className={cn(buttonClass('primary', 'sm'), 'h-8')}>
            {fetching ? <CircleNotch size={13} className="animate-spin" /> : null}
            {t('editor.blocks_v2.web_preview.add', 'Add preview')}
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-rose-600">
          <WarningCircle size={13} weight="fill" className="shrink-0" /> <span>{error.message}</span>
          {error.url && (
            <button type="button" className="font-medium text-neutral-700 underline underline-offset-2" onClick={() => addPlain(error.url!)}>
              {t('editor.blocks_v2.web_preview.add_plain', 'Add as plain link')}
            </button>
          )}
        </div>
      )}
    </form>
  )

  const label = <><Globe size={11} weight="bold" />{t('editor.blocks.web_preview', 'Web preview')}</>
  const text = previewTextOf(attrs)

  const tools = previewUrl ? (
    <>
      <BlockToolbarButton label={t('editor.blocks.web_preview_block.edit_url', 'Edit link')} onClick={startEditLink}>
        <PencilSimple size={14} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.web_preview.refresh', 'Refresh metadata')} onClick={refresh} disabled={refreshing}>
        <ArrowsClockwise size={14} className={refreshing ? 'animate-spin' : undefined} />
      </BlockToolbarButton>
      <BlockPopover
        open={open === 'text'}
        onOpenChange={(o) => setOpen(o ? 'text' : null)}
        title={t('editor.blocks_v2.web_preview.text', 'Title & description')}
        width={320}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.web_preview.text', 'Title & description')} active={!!(attrs.customTitle || attrs.customDescription)}><TextAa size={14} /></BlockToolbarButton>}
      >
        <SettingsField label={t('editor.blocks_v2.web_preview.title', 'Title')}>
          <CommitInput
            value={attrs.customTitle || ''}
            placeholder={attrs.title || text.host}
            aria-label={t('editor.blocks_v2.web_preview.title', 'Title')}
            onCommit={(v) => updateAttributes({ customTitle: v.trim() || null })}
          />
        </SettingsField>
        <SettingsField label={t('editor.blocks_v2.web_preview.description', 'Description')}>
          <CommitInput
            multiline
            value={attrs.customDescription || ''}
            placeholder={attrs.description || t('editor.blocks_v2.web_preview.description_placeholder', 'A sentence about why this page is worth a visit')}
            aria-label={t('editor.blocks_v2.web_preview.description', 'Description')}
            onCommit={(v) => updateAttributes({ customDescription: v.trim() || null })}
          />
        </SettingsField>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-neutral-400">{t('editor.blocks_v2.web_preview.override_hint', 'Leave empty to use the page’s own text.')}</span>
          {(attrs.customTitle || attrs.customDescription) && (
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => updateAttributes({ customTitle: null, customDescription: null })}>
              {t('editor.blocks_v2.web_preview.reset_text', 'Reset')}
            </button>
          )}
        </div>
      </BlockPopover>
      <BlockPopover
        open={open === 'display'}
        onOpenChange={(o) => setOpen(o ? 'display' : null)}
        title={t('editor.blocks_v2.web_preview.display', 'Display')}
        width={300}
        trigger={<BlockToolbarButton label={t('editor.blocks_v2.web_preview.display', 'Display')}><SlidersHorizontal size={14} /></BlockToolbarButton>}
      >
        <SettingsField label={t('editor.blocks_v2.web_preview.card_style', 'Card style')}>
          <Segmented
            ariaLabel={t('editor.blocks_v2.web_preview.card_style', 'Card style')}
            value={layout}
            onChange={(v) => v !== layout && updateAttributes({ layout: v })}
            options={[
              { value: 'large', label: t('editor.blocks_v2.web_preview.large', 'Large image') },
              { value: 'compact', label: t('editor.blocks_v2.web_preview.compact', 'Compact') },
            ]}
          />
        </SettingsField>
        <SettingsField label={t('editor.blocks.web_preview_block.alignment', 'Alignment')}>
          <Segmented
            ariaLabel={t('editor.blocks.web_preview_block.alignment', 'Alignment')}
            value={align}
            onChange={(v) => v !== align && updateAttributes({ alignment: v })}
            options={[
              { value: 'left', label: t('editor.blocks.common.align_left', 'Left') },
              { value: 'center', label: t('editor.blocks.common.align_center', 'Center') },
              { value: 'right', label: t('editor.blocks.common.align_right', 'Right') },
            ]}
          />
        </SettingsField>
        <label className="flex items-center justify-between gap-3 text-[13px] text-neutral-700">
          {t('editor.blocks.web_preview_block.show_button', 'Show button')}
          <input type="checkbox" className="h-4 w-4 accent-neutral-900" checked={!!attrs.showButton} onChange={(e) => updateAttributes({ showButton: e.target.checked })} />
        </label>
        {attrs.showButton && (
          <>
            <SettingsField label={t('editor.blocks.web_preview_block.button_label', 'Button label')}>
              <CommitInput
                value={attrs.buttonLabel || ''}
                placeholder={t('editor.blocks.web_preview_block.visit_site', 'Visit site')}
                aria-label={t('editor.blocks.web_preview_block.button_label', 'Button label')}
                onCommit={(v) => updateAttributes({ buttonLabel: v.trim() || 'Visit Site' })}
              />
            </SettingsField>
            <label className="flex items-center justify-between gap-3 text-[13px] text-neutral-700">
              {t('editor.blocks.web_preview_block.open_popup', 'Open in a popup')}
              <input type="checkbox" className="h-4 w-4 accent-neutral-900" checked={!!attrs.openInPopup} onChange={(e) => updateAttributes({ openInPopup: e.target.checked })} />
            </label>
          </>
        )}
      </BlockPopover>
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.blocks_v2.open_original', 'Open original')} onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}>
        <ArrowSquareOut size={14} />
      </BlockToolbarButton>
    </>
  ) : undefined

  let body: React.ReactNode
  if (fetching) {
    body = <div className={cn('flex w-full', JUSTIFY[align])}><CardSkeleton url={fetching} /></div>
  } else if (!previewUrl || editingLink) {
    body = (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 p-4">
        {!editingLink && (
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Globe size={20} weight="duotone" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-neutral-800">{t('editor.blocks_v2.web_preview.empty_title', 'Link to a page with a preview card')}</div>
              <div className="text-[11px] text-neutral-400">{t('editor.blocks_v2.web_preview.empty_hint', 'We fetch its title, description and image. You can edit them afterwards.')}</div>
            </div>
          </div>
        )}
        {linkForm}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <div className={cn('flex w-full', JUSTIFY[align])}>
          <PreviewCard attrs={attrs} layout={layout} editing />
        </div>
        {notice && (
          <p className={cn('flex items-center gap-1.5 text-[11px] text-amber-700', align === 'center' && 'justify-center', align === 'right' && 'justify-end')}>
            <WarningCircle size={12} weight="fill" /> {notice}
            <button type="button" className="text-neutral-400 hover:text-neutral-700" onClick={() => setNotice(null)}>{t('editor.blocks_v2.dismiss', 'Dismiss')}</button>
          </p>
        )}
      </div>
    )
  }

  return (
    <NodeViewWrapper className="web-preview-block">
      <EditorBlockFrame
        editable={!!editor}
        node={node}
        editor={editor}
        getPos={getPos}
        selected={selected}
        tone="link"
        label={label}
        tools={tools}
        forceToolbar={!!open}
        className="p-1"
      >
        {body}
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default WebPreviewComponent
