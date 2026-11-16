import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Link as LinkIcon, DotsSixVertical, DotsSix, TextAlignCenter, TextAlignLeft, Code, Trash, PencilSimple, Cube, Crop, ArrowSquareOut,
} from '@phosphor-icons/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { sanitizeEmbedCode, urlEmbedSandboxFor } from '@/lib/media/embedSanitize'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import {
  BlockChrome, BlockPopover, BlockToolbarButton, BlockToolbarDivider, FIELD_CLASS, Segmented, TEXTAREA_CLASS,
} from '../../Blocks/ui/BlockChrome'
import BlockCaption from '../../Blocks/ui/BlockCaption'
import {
  ASPECT_PRESETS, aspectPresetFor, embedAttrsFor, normalizeUserUrl, parseEmbedUrl,
} from '../../Blocks/embeds/embedProviders'
import { deleteBlock } from '../../Blocks/nodeViewUtils'
import { resolveEmbedSrc } from '../../Blocks/embeds/embedRender'

// Matches the embedHeight default in the EmbedObjects node
const DEFAULT_EMBED_HEIGHT = 300

const SCRIPT_BASED_EMBEDS = {
  twitter: { src: 'https://platform.twitter.com/widgets.js', identifier: 'twitter-tweet' },
  instagram: { src: 'https://www.instagram.com/embed.js', identifier: 'instagram-media' },
  tiktok: { src: 'https://www.tiktok.com/embed.js', identifier: 'tiktok-embed' },
}

const PROVIDER_HINTS = ['YouTube', 'Vimeo', 'Loom', 'Figma', 'Google Docs', 'Slides', 'Sheets', 'Forms', 'CodePen', 'CodeSandbox', 'Spotify', 'Miro', 'Canva', 'Desmos', 'GeoGebra']

const MemoizedEmbed = React.memo(({ embedUrl, sanitizedEmbedCode, embedType, provider, title }: {
  embedUrl: string
  sanitizedEmbedCode: string
  embedType: 'url' | 'code'
  provider: string | null
  title?: string
}) => {
  useEffect(() => {
    if (embedType === 'code' && sanitizedEmbedCode) {
      const matchingPlatform = Object.entries(SCRIPT_BASED_EMBEDS).find(([, config]) =>
        sanitizedEmbedCode.includes(config.identifier)
      )
      if (matchingPlatform) {
        const [, config] = matchingPlatform
        const script = document.createElement('script')
        script.src = config.src
        script.async = true
        script.charset = 'utf-8'
        document.body.appendChild(script)
        return () => {
          document.body.removeChild(script)
        }
      }
    }
  }, [embedType, sanitizedEmbedCode])

  if (embedType === 'url' && embedUrl) {
    const processedUrl = resolveEmbedSrc(embedUrl, provider)
    return (
      <iframe
        src={processedUrl}
        title={title}
        // Inline height: the editor's global `iframe { height: 440px }` outranks h-full.
        style={{ height: '100%' }}
        className="w-full h-full rounded-lg"
        frameBorder="0"
        allowFullScreen
        allow={provider ? 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' : undefined}
        sandbox={urlEmbedSandboxFor(processedUrl, typeof window !== 'undefined' ? window.location.origin : undefined)}
      />
    )
  }

  if (embedType === 'code' && sanitizedEmbedCode) {
    return <div dangerouslySetInnerHTML={{ __html: sanitizedEmbedCode }} className="w-full h-full" />
  }

  return null
})
MemoizedEmbed.displayName = 'MemoizedEmbed'

function EmbedObjectsComponent(props: NodeViewProps) {
  const { t } = useTranslation()
  const attrs = props.node.attrs
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  // Stored values come straight from the node (the shared document).
  const embedType: 'url' | 'code' = attrs.embedType === 'code' ? 'code' : 'url'
  const embedUrl: string = attrs.embedUrl || ''
  const embedCode: string = attrs.embedCode || ''
  const embedHeight = attrs.embedHeight || DEFAULT_EMBED_HEIGHT
  const embedWidth = attrs.embedWidth || '100%'
  const alignment: string = attrs.alignment || 'left'
  const provider: string | null = attrs.embedProvider || null
  const caption: string = attrs.caption || ''

  const [isResizing, setIsResizing] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  // Legacy blocks without a stored ratio get one derived for display only.
  const [derivedRatio, setDerivedRatio] = useState<number | null>(null)
  const aspectRatio: number | null = attrs.embedAspectRatio || derivedRatio

  const resizeRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Only track the breakpoint here. Sizing itself is handled in CSS
  // (percentage width + aspect-ratio), so the observer never writes node
  // attributes; that used to fire on every window resize.
  useEffect(() => {
    const parentElement = containerRef.current?.parentElement
    if (!parentElement) return
    const updateDimensions = () => setIsMobile(parentElement.offsetWidth < 640)
    updateDimensions()
    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(parentElement)
    return () => resizeObserver.disconnect()
  }, [])

  // Blocks saved before the aspect-ratio attribute existed only have a pixel
  // height, which kept the frame at a fixed size while the window (and the
  // video inside it) shrank. Give them a ratio so they scale too. URL embeds
  // only: script embeds (tweets, TikTok) need their height.
  useEffect(() => {
    if (attrs.embedAspectRatio || derivedRatio) return
    if (embedType !== 'url' || !embedUrl || provider) return
    const height = parseInt(String(embedHeight), 10)
    const renderedWidth = resizeRef.current?.offsetWidth || 0
    if (!height) return
    // Never resized by hand, so the 300px is just the attribute default;
    // 16:9 fits video, which is what most URL embeds are.
    if (height === DEFAULT_EMBED_HEIGHT) {
      setDerivedRatio(16 / 9)
      return
    }
    if (!renderedWidth) return
    setDerivedRatio(renderedWidth / height)
  }, [attrs.embedAspectRatio, derivedRatio, embedType, embedUrl, embedHeight, provider])

  const sanitizedEmbedCode = useMemo(() => (embedCode ? sanitizeEmbedCode(embedCode) : ''), [embedCode])
  // Same test the block always used, so stored embeds keep their frame.
  const hasContent = !!(embedUrl || sanitizedEmbedCode)

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>, direction: 'horizontal' | 'vertical') => {
    event.preventDefault()
    setIsResizing(true)
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = resizeRef.current?.offsetWidth || 0
    const startHeight = resizeRef.current?.offsetHeight || 0
    const dims = { width: embedWidth, height: embedHeight, ratio: aspectRatio as number | null }

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      if (direction === 'horizontal') {
        // In RTL the handle sits on the left, so dragging left grows the frame.
        const rtl = getComputedStyle(resizeRef.current).direction === 'rtl'
        const newWidth = startWidth + (rtl ? startX - e.clientX : e.clientX - startX)
        const parentWidth = resizeRef.current.parentElement?.offsetWidth || 1
        const widthPercentage = Math.min(100, Math.max(10, (newWidth / parentWidth) * 100))
        dims.width = `${widthPercentage}%`
        resizeRef.current.style.width = dims.width
      } else {
        const newHeight = Math.max(100, startHeight + e.clientY - startY)
        dims.height = newHeight
        // Drop the ratio while dragging so the height follows the cursor,
        // then re-derive it from the box the user settled on.
        resizeRef.current.style.aspectRatio = 'auto'
        resizeRef.current.style.height = `${newHeight}px`
        const currentWidth = resizeRef.current.offsetWidth
        dims.ratio = embedType === 'url' && currentWidth ? currentWidth / newHeight : null
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      props.updateAttributes({ embedWidth: dims.width, embedHeight: dims.height, embedAspectRatio: dims.ratio })
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const frameStyle = (): React.CSSProperties => {
    const styles: React.CSSProperties = { width: isMobile ? '100%' : embedWidth, maxWidth: '100%' }
    // An aspect ratio lets the frame shrink with its container instead of
    // keeping a pixel height the content no longer fills.
    if (aspectRatio) styles.aspectRatio = String(aspectRatio)
    else styles.height = `${embedHeight}px`
    return styles
  }

  const embedContent = useMemo(() => (
    !isResizing && hasContent ? (
      <MemoizedEmbed
        embedUrl={embedUrl}
        sanitizedEmbedCode={sanitizedEmbedCode}
        embedType={embedType}
        provider={provider}
        title={caption || provider || undefined}
      />
    ) : (
      <div className="w-full h-full bg-neutral-100 rounded-lg" />
    )
  ), [embedUrl, sanitizedEmbedCode, embedType, isResizing, hasContent, provider, caption])

  // ─── Editing state (local until applied) ───
  const [editing, setEditing] = useState<false | 'url' | 'code'>(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [draftCode, setDraftCode] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [aspectOpen, setAspectOpen] = useState(false)
  const draftParsed = useMemo(() => (draftUrl.trim() ? parseEmbedUrl(draftUrl) : null), [draftUrl])

  const startEditing = (mode: 'url' | 'code') => {
    setDraftUrl(mode === 'url' ? attrs.embedSourceUrl || embedUrl : '')
    setDraftCode(mode === 'code' ? embedCode : '')
    setDraftError(null)
    setEditing(mode)
  }

  const applyDraft = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (editing === 'url') {
      const url = normalizeUserUrl(draftUrl)
      if (!url) {
        setDraftError(t('editor.blocks_v2.errors.url', 'That doesn’t look like a web link.'))
        return
      }
      const parsed = parseEmbedUrl(url)
      // One attr write with the final values; known services get their player
      // URL and frame shape, any other page is framed as-is.
      props.updateAttributes(
        parsed
          ? { ...embedAttrsFor(parsed), embedCode: null, embedWidth: '100%' }
          : { embedType: 'url', embedUrl: url, embedSourceUrl: url, embedProvider: null, embedCode: null, embedAspectRatio: 16 / 9 }
      )
    } else if (editing === 'code') {
      if (!draftCode.trim()) return
      props.updateAttributes({ embedType: 'code', embedCode: draftCode, embedUrl: null, embedSourceUrl: null, embedProvider: null, embedAspectRatio: null })
    }
    setEditing(false)
  }

  const editorForm = editing && (
    <form
      onSubmit={applyDraft}
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') setEditing(false)
      }}
    >
      {editing === 'url' ? (
        <>
          <div className="relative">
            <LinkIcon size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              type="url"
              inputMode="url"
              value={draftUrl}
              onChange={(e) => { setDraftUrl(e.target.value); setDraftError(null) }}
              placeholder={t('editor.blocks.embed_block.paste_any_url', 'Paste any URL…')}
              aria-label={t('editor.blocks.embed_block.add_embed_url', 'Embed a URL')}
              className={cn(FIELD_CLASS, 'ps-8')}
            />
          </div>
          <p className="text-[11px] text-neutral-500">
            {draftParsed
              ? t('editor.blocks_v2.embed_detected', 'Recognized: {{provider}}. It will play right in the lesson.', { provider: draftParsed.label })
              : t('editor.blocks_v2.embed_any', 'Links from {{providers}} and more are recognized automatically. Other pages are shown as they are, if the site allows it.', { providers: PROVIDER_HINTS.slice(0, 6).join(', ') })}
          </p>
        </>
      ) : (
        <>
          <textarea
            autoFocus
            rows={5}
            value={draftCode}
            onChange={(e) => setDraftCode(e.target.value)}
            placeholder={t('editor.blocks.embed_block.paste_code', 'Paste your embed code…')}
            aria-label={t('editor.blocks.embed_block.add_embed_code', 'Embed code')}
            className={cn(TEXTAREA_CLASS, 'font-mono text-xs')}
          />
          <p className="text-[11px] text-neutral-500">{t('editor.blocks.embed_block.paste_iframe')}</p>
        </>
      )}
      {draftError && <p role="alert" className="text-xs text-rose-600">{draftError}</p>}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-xs font-medium text-neutral-500 hover:text-neutral-800"
          onClick={() => startEditing(editing === 'url' ? 'code' : 'url')}
        >
          {editing === 'url' ? t('editor.blocks_v2.use_code', 'Use embed code instead') : t('editor.blocks_v2.use_link', 'Use a link instead')}
        </button>
        <div className="flex items-center gap-1.5">
          {hasContent && (
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setEditing(false)}>
              {t('editor.blocks.common.cancel', 'Cancel')}
            </button>
          )}
          <button
            type="submit"
            className={buttonClass('primary', 'sm')}
            disabled={editing === 'url' ? !draftUrl.trim() : !draftCode.trim()}
          >
            {t('editor.blocks_v2.embed', 'Embed')}
          </button>
        </div>
      </div>
    </form>
  )

  // ─── Learner view (unchanged markup for existing embeds) ───
  if (!isEditable) {
    return (
      <NodeViewWrapper className="embed-block w-full" ref={containerRef}>
        <div
          ref={resizeRef}
          className={cn('relative bg-white rounded-xl overflow-hidden nice-shadow', alignment === 'center' && 'mx-auto')}
          style={hasContent ? frameStyle() : { width: '100%' }}
        >
          {hasContent ? embedContent : null}
        </div>
        <BlockCaption
          value={caption}
          editable={false}
          align={alignment === 'center' ? 'center' : 'start'}
          style={hasContent && !isMobile ? { width: embedWidth, maxWidth: '100%', marginInline: alignment === 'center' ? 'auto' : undefined } : undefined}
        />
      </NodeViewWrapper>
    )
  }

  const label = <><Cube size={11} weight="bold" />{provider ? parseEmbedUrl(attrs.embedSourceUrl || '')?.label || t('editor.blocks.embed') : t('editor.blocks.embed')}</>
  const deleteButton = (
    <BlockToolbarButton label={t('common.delete', 'Delete')} tone="danger" onClick={() => deleteBlock(props)}>
      <Trash size={14} />
    </BlockToolbarButton>
  )

  // ─── Editor: empty ───
  if (!hasContent || (editing && !hasContent)) {
    return (
      <NodeViewWrapper className="embed-block w-full" ref={containerRef}>
        <BlockChrome tone="embed" selected={props.selected} label={label} toolbar={deleteButton}>
          <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 p-4">
            {editing ? (
              editorForm
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                    <Cube size={20} weight="duotone" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-800">{t('editor.blocks_v2.embed_title', 'Embed anything with a link')}</div>
                    <div className="truncate text-[11px] text-neutral-400">{PROVIDER_HINTS.join(' · ')}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" className={buttonClass('primary', 'sm')} onClick={() => startEditing('url')}>
                    <LinkIcon size={13} /> {t('editor.blocks_v2.paste_link_button', 'Paste link')}
                  </button>
                  <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => startEditing('code')}>
                    <Code size={13} /> {t('editor.blocks.embed_block.code', 'Code')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </BlockChrome>
      </NodeViewWrapper>
    )
  }

  // ─── Editor: embed ───
  const aspectId = aspectPresetFor(attrs.embedAspectRatio)
  const toolbar = (
    <>
      <BlockToolbarButton label={t('editor.blocks.embed_block.edit_embed', 'Edit embed')} onClick={() => startEditing(embedType)}>
        <PencilSimple size={14} />
      </BlockToolbarButton>
      {embedType === 'url' && (
        <BlockPopover
          open={aspectOpen}
          onOpenChange={setAspectOpen}
          title={t('editor.blocks_v2.frame_shape', 'Frame shape')}
          width={300}
          trigger={<BlockToolbarButton label={t('editor.blocks_v2.frame_shape', 'Frame shape')}><Crop size={14} /></BlockToolbarButton>}
        >
          <Segmented
            ariaLabel={t('editor.blocks_v2.frame_shape', 'Frame shape')}
            value={aspectId}
            onChange={(id) => {
              const preset = ASPECT_PRESETS.find((p) => p.id === id)
              if (preset) props.updateAttributes({ embedAspectRatio: preset.value, embedWidth: preset.value < 1 ? '45%' : embedWidth })
            }}
            options={ASPECT_PRESETS.map((p) => ({ value: p.id, label: p.id }))}
          />
          <p className="text-[11px] text-neutral-400">{t('editor.blocks_v2.frame_hint', 'Or drag the frame’s edges for a custom size.')}</p>
        </BlockPopover>
      )}
      <BlockToolbarButton
        label={alignment === 'center' ? t('editor.blocks.common.align_left') : t('editor.blocks.common.align_center')}
        onClick={() => props.updateAttributes({ alignment: alignment === 'center' ? 'left' : 'center' })}
      >
        {alignment === 'center' ? <TextAlignLeft size={14} /> : <TextAlignCenter size={14} />}
      </BlockToolbarButton>
      {embedType === 'url' && (attrs.embedSourceUrl || embedUrl) && (
        <BlockToolbarButton
          label={t('editor.blocks_v2.open_original', 'Open original')}
          onClick={() => window.open(attrs.embedSourceUrl || embedUrl, '_blank', 'noopener,noreferrer')}
        >
          <ArrowSquareOut size={14} />
        </BlockToolbarButton>
      )}
      <BlockToolbarDivider />
      {deleteButton}
    </>
  )

  return (
    <NodeViewWrapper className="embed-block w-full" ref={containerRef}>
      <BlockChrome tone="embed" selected={props.selected} forceToolbar={aspectOpen || !!editing} label={label} toolbar={toolbar} className="p-1">
        <div
          ref={resizeRef}
          className={cn('relative bg-white rounded-xl overflow-hidden nice-shadow', alignment === 'center' && 'mx-auto')}
          style={frameStyle()}
        >
          {embedContent}
          {editing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/95 p-4">
              <div className="w-full max-w-lg">{editorForm}</div>
            </div>
          )}
          <div
            className="absolute end-0 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center bg-white/70 opacity-0 group-hover/block:opacity-100 hover:bg-white/90 transition-opacity"
            onMouseDown={(e) => handleResizeStart(e, 'horizontal')}
          >
            <DotsSixVertical weight="duotone" size={16} className="text-neutral-500" />
          </div>
          <div
            className="absolute start-0 end-0 bottom-0 h-4 cursor-ns-resize flex items-center justify-center bg-white/70 opacity-0 group-hover/block:opacity-100 hover:bg-white/90 transition-opacity"
            onMouseDown={(e) => handleResizeStart(e, 'vertical')}
          >
            <DotsSix weight="duotone" size={16} className="text-neutral-500" />
          </div>
        </div>
        <BlockCaption
          value={caption}
          editable
          selected={props.selected}
          align={alignment === 'center' ? 'center' : 'start'}
          onCommit={(value) => props.updateAttributes({ caption: value })}
          style={isMobile ? undefined : { width: embedWidth, maxWidth: '100%', marginInline: alignment === 'center' ? 'auto' : undefined }}
        />
      </BlockChrome>
    </NodeViewWrapper>
  )
}

export default EmbedObjectsComponent
