import { NodeViewWrapper } from '@tiptap/react'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  PuzzlePiece,
  Link as LinkIcon,
  PencilSimple,
  WarningCircle,
  ArrowsOutLineVertical,
  ArrowSquareOut,
  CheckCircle,
  Info,
  X,
} from '@phosphor-icons/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { normalizeH5PUrl, type H5PUrlErrorReason } from '@/lib/media/h5pUrl'
import {
  clampHeight,
  isAutoSized,
  normalizeSizeMode,
  parseH5PMessage,
  replyTarget,
  resolveManualHeight,
  shouldPrepareResize,
  DEFAULT_HEIGHT,
  HEIGHT_PERSIST_THRESHOLD,
  MAX_HEIGHT,
  MIN_HEIGHT,
  SIZE_MODES,
  type H5PSizeMode,
} from '@/lib/media/h5pProtocol'
import { BlockToolbarButton } from '../../Blocks/ui/BlockChrome'
import { frameProblemFor, looksLikeH5PEmbed, openableH5PUrl, type H5PFrameProblem } from './h5pChecks'

const PROBLEM_KEYS: Record<Exclude<H5PFrameProblem, null>, string> = {
  mixed_content: 'editor.blocks_v2.h5p.blocked_mixed',
  same_site: 'editor.blocks_v2.h5p.blocked_same_site',
}

// The page origin never changes after hydration; nothing to subscribe to.
const subscribeNothing = () => () => {}

// How long a loaded frame may stay silent before we suggest it may be blocked.
const SILENCE_HINT_MS = 10000
// The live preview waits for the author to stop typing.
const PREVIEW_DEBOUNCE_MS = 500

const ERROR_KEYS: Record<H5PUrlErrorReason, string> = {
  empty: 'editor.blocks.h5p_block.errors.empty',
  unparseable: 'editor.blocks.h5p_block.errors.unparseable',
  unsupported_protocol: 'editor.blocks.h5p_block.errors.unsupported_protocol',
}

// How far one arrow-key press moves the resize handle.
const KEYBOARD_RESIZE_STEP = 20
// A pointer that never really moved was a click, not a drag. Committing one
// would flip the block to a custom size (and reload the frame) because the
// author brushed the handle.
const DRAG_THRESHOLD = 3

function respondToFrame(
  frame: HTMLIFrameElement,
  event: MessageEvent,
  message: Record<string, unknown>
): void {
  frame.contentWindow?.postMessage(message, replyTarget(event.origin))
}

function H5PBlockComponent(props: any) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable

  // Read straight from the node attributes: they are the document, and a
  // local mirror would drift on undo/redo or when a version-history preview
  // swaps the content underneath us.
  const h5pUrl: string = props.node.attrs.h5pUrl || ''
  // Re-validate at render: the stored attr may come from a hand-edited document.
  const frameSrc = useMemo(() => {
    const result = normalizeH5PUrl(h5pUrl)
    return result.ok ? result.url : ''
  }, [h5pUrl])
  const title: string = props.node.attrs.title || ''
  const sizeMode: H5PSizeMode = normalizeSizeMode(props.node.attrs.sizeMode)
  const isAuto = isAutoSized(sizeMode)
  const [frameHeight, setFrameHeight] = useState<number>(
    clampHeight(Number(props.node.attrs.height) || DEFAULT_HEIGHT)
  )
  const [isEditing, setIsEditing] = useState(false)
  const [urlDraft, setUrlDraft] = useState<string>(props.node.attrs.h5pUrl || '')
  const [titleDraft, setTitleDraft] = useState<string>(props.node.attrs.title || '')
  const [error, setError] = useState<string | null>(null)
  // Whether the content has spoken the H5P protocol yet, and whether the frame
  // finished loading: together they tell a blank frame from a slow one.
  const [heardFromFrame, setHeardFromFrame] = useState(false)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [silent, setSilent] = useState(false)
  const pageOrigin = useSyncExternalStore(subscribeNothing, () => window.location.origin, () => null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const persistedHeightRef = useRef<number>(
    clampHeight(Number(props.node.attrs.height) || DEFAULT_HEIGHT)
  )
  // The node-view props object is new on every render; keep what the message
  // listener needs in refs so it is attached once, not on each render.
  const editorRef = useRef(props.editor)
  const getPosRef = useRef(props.getPos)
  useEffect(() => {
    editorRef.current = props.editor
    getPosRef.current = props.getPos
  })

  // The ratio modes size the frame from the block's own width, so the block
  // has to know it, and has to notice when it changes, which happens without
  // a re-render (window resize, sidebar opening, the editor going full width).
  const [containerWidth, setContainerWidth] = useState(0)
  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return
    setContainerWidth(node.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [h5pUrl, isEditing])

  // Live height while the author drags the bottom edge. Kept out of the
  // document until they let go, so one drag is one undo step.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null)

  // The height is reported by the embedded content, not chosen by the author,
  // so it must never become an undo step: otherwise Ctrl+Z answers a resize
  // instead of the author's last edit, and the frame (which follows the
  // attribute) immediately writes the old height back, wiping the redo
  // branch. Write it straight into the document with history switched off.
  const persistHeight = useCallback((next: number) => {
    const editor = editorRef.current
    const pos = typeof getPosRef.current === 'function' ? getPosRef.current() : undefined
    if (!editor || typeof pos !== 'number') return
    editor.commands.command(({ tr }: any) => {
      tr.setNodeAttribute(pos, 'height', next)
      tr.setMeta('addToHistory', false)
      return true
    })
  }, [])

  // The attribute can move without us: undo/redo, or a preview replacing the
  // whole document. Follow it, and keep the persisted marker in step so our
  // own writes below don't bounce back through here.
  useEffect(() => {
    const next = clampHeight(Number(props.node.attrs.height) || DEFAULT_HEIGHT)
    if (next !== persistedHeightRef.current) {
      persistedHeightRef.current = next
      setFrameHeight(next)
    }
  }, [props.node.attrs.height])

  const manualHeight = useMemo(
    () => resolveManualHeight(sizeMode, containerWidth, frameHeight),
    [sizeMode, containerWidth, frameHeight]
  )
  // While dragging, the pointer wins over everything else.
  const displayHeight = dragHeight ?? manualHeight ?? frameHeight

  const frameTitle = title || t('editor.blocks.h5p_block.default_title')

  // Drive the parent side of H5P's embed handshake (see lib/media/h5pProtocol).
  // The one part that needs the DOM lives here: acting only on messages from
  // this very iframe, since anything on the page can postMessage at us.
  //
  // A manually sized block stays out of the handshake on purpose. Answering it
  // is what makes the content hand its scrolling over to us, and content that
  // has done that inside a frame it did not choose the height of is simply
  // clipped, which is the problem manual sizing exists to solve.
  useEffect(() => {
    if (!h5pUrl || !isAuto) return

    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current
      if (!frame || !event.source || event.source !== frame.contentWindow) return

      const message = parseH5PMessage(event.data)
      if (!message) return
      setHeardFromFrame(true)

      switch (message.kind) {
        case 'hello':
          respondToFrame(frame, event, { context: 'h5p', action: 'hello' })
          return

        case 'prepareResize': {
          if (!shouldPrepareResize(frame.clientHeight, message)) return
          if (message.clientHeight > 0) {
            const shrunk = clampHeight(message.clientHeight)
            // The content re-measures the moment it receives our reply, so the
            // frame has to be that height *now*; a React state update is not
            // guaranteed to have committed by then. Write the style directly
            // and let state catch up for the next render.
            frame.style.height = `${shrunk}px`
            setFrameHeight(shrunk)
          }
          respondToFrame(frame, event, { context: 'h5p', action: 'resizePrepared' })
          return
        }

        case 'resize': {
          const next = clampHeight(message.scrollHeight)
          setFrameHeight(next)

          if (
            isEditable &&
            Math.abs(next - persistedHeightRef.current) > HEIGHT_PERSIST_THRESHOLD
          ) {
            persistedHeightRef.current = next
            persistHeight(next)
          }
          return
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [h5pUrl, isAuto, isEditable, persistHeight])

  // The content may have finished its first internal resize before our
  // listener existed, in which case its `hello` is already gone. `ready` makes
  // it start the handshake over.
  const handleFrameLoad = useCallback(() => {
    setFrameLoaded(true)
    if (!isAuto) return
    const frame = iframeRef.current
    frame?.contentWindow?.postMessage({ context: 'h5p', action: 'ready' }, '*')
  }, [isAuto])

  const commitHeight = useCallback(
    (mode: H5PSizeMode, height: number) => {
      setFrameHeight(height)
      persistedHeightRef.current = height
      props.updateAttributes({ sizeMode: mode, height })
    },
    [props]
  )

  const handleSizeModeChange = useCallback(
    (mode: H5PSizeMode) => {
      if (mode === sizeMode) return
      const next = resolveManualHeight(mode, containerWidth, frameHeight)
      if (next === null) {
        // Back to auto. The frame remounts (see the iframe key below) and the
        // handshake starts over, so the content reports its own height again.
        props.updateAttributes({ sizeMode: 'auto' })
        return
      }
      commitHeight(mode, next)
    },
    [sizeMode, containerWidth, frameHeight, commitHeight, props]
  )

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Without this the drag turns into a text selection, and the node view's
      // own drag handle picks the block up instead.
      event.preventDefault()
      event.stopPropagation()
      dragStateRef.current = { startY: event.clientY, startHeight: displayHeight }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragHeight(displayHeight)
    },
    [displayHeight]
  )

  const handleResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag) return
    setDragHeight(clampHeight(drag.startHeight + (event.clientY - drag.startY)))
  }, [])

  const handleResizePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current
      if (!drag) return
      dragStateRef.current = null
      // pointercancel has already released the capture implicitly, and
      // releasing one we no longer hold throws.
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      const travelled = event.clientY - drag.startY
      setDragHeight(null)
      if (Math.abs(travelled) < DRAG_THRESHOLD) return
      commitHeight('custom', clampHeight(drag.startHeight + travelled))
    },
    [commitHeight]
  )

  // A cancelled pointer is the browser taking the gesture over (a touch turning
  // into a page scroll, mostly). Drop the drag rather than committing a height
  // the author never let go of.
  const handleResizePointerCancel = useCallback(() => {
    dragStateRef.current = null
    setDragHeight(null)
  }, [])

  // The handle is a real control, so it answers the arrow keys too; dragging
  // is not available to anyone working without a pointer.
  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === 'ArrowDown'
          ? KEYBOARD_RESIZE_STEP
          : event.key === 'ArrowUp'
            ? -KEYBOARD_RESIZE_STEP
            : 0
      if (!step) return
      event.preventDefault()
      const next = clampHeight(displayHeight + step)
      // Already against MIN_HEIGHT or MAX_HEIGHT: don't spend an undo step,
      // or a frame reload if the block is still on auto, on nothing.
      if (next === displayHeight) return
      commitHeight('custom', next)
    },
    [commitHeight, displayHeight]
  )

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      const result = normalizeH5PUrl(urlDraft)
      if (!result.ok) {
        setError(t(ERROR_KEYS[result.reason]))
        return
      }
      const nextTitle = titleDraft.trim()
      setError(null)
      setUrlDraft(result.url)
      setIsEditing(false)
      const problem = frameProblemFor(result.url, pageOrigin)
      if (problem) {
        setError(t(PROBLEM_KEYS[problem]))
        setIsEditing(true)
        return
      }
      if (result.url === h5pUrl) {
        if (nextTitle !== title) props.updateAttributes({ title: nextTitle })
        return
      }
      // Different content: its height is anyone's guess until it reports one,
      // so start from the default rather than inheriting the old activity's.
      // The chosen size mode is the author's, not the activity's, so it stays.
      setFrameHeight(DEFAULT_HEIGHT)
      persistedHeightRef.current = DEFAULT_HEIGHT
      props.updateAttributes({ h5pUrl: result.url, title: nextTitle, height: DEFAULT_HEIGHT })
    },
    [urlDraft, titleDraft, h5pUrl, title, pageOrigin, props, t]
  )

  const handleStartEditing = useCallback(() => {
    setUrlDraft(h5pUrl)
    setTitleDraft(title)
    setError(null)
    setIsEditing(true)
  }, [h5pUrl, title])

  // A new URL (or a new frame after a size switch) starts the silence clock over.
  useEffect(() => {
    setHeardFromFrame(false)
    setFrameLoaded(false)
    setSilent(false)
  }, [frameSrc, isAuto])
  useEffect(() => {
    if (!isEditable || !isAuto || !frameLoaded || heardFromFrame) return
    const timer = setTimeout(() => setSilent(true), SILENCE_HINT_MS)
    return () => clearTimeout(timer)
  }, [isEditable, isAuto, frameLoaded, heardFromFrame])

  // ─── Live preview while editing: validated, debounced, never written ───
  const [previewSrc, setPreviewSrc] = useState('')
  const [draftIssue, setDraftIssue] = useState<string | null>(null)
  const [draftHint, setDraftHint] = useState<string | null>(null)
  const showForm = isEditable && (!h5pUrl || isEditing)
  useEffect(() => {
    if (!showForm) return
    const timer = setTimeout(() => {
      if (!urlDraft.trim()) {
        setPreviewSrc('')
        setDraftIssue(null)
        setDraftHint(null)
        return
      }
      const result = normalizeH5PUrl(urlDraft)
      if (!result.ok) {
        setPreviewSrc('')
        setDraftIssue(t(ERROR_KEYS[result.reason]))
        setDraftHint(null)
        return
      }
      const problem = frameProblemFor(result.url, pageOrigin)
      setDraftIssue(problem ? t(PROBLEM_KEYS[problem]) : null)
      setPreviewSrc(problem ? '' : result.url)
      setDraftHint(
        !problem && !looksLikeH5PEmbed(result.url)
          ? t('editor.blocks_v2.h5p.not_embed_hint', 'This looks like a page rather than an embed link. On your H5P host, use the “Embed” button and paste the link or code it gives you.')
          : null
      )
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [urlDraft, showForm, pageOrigin, t])

  const frameProblem = frameSrc ? frameProblemFor(frameSrc, pageOrigin) : null

  const frame = (
    <iframe
      // Whether we take part in the handshake is decided when the content
      // loads, so switching between auto and a manual size has to reload it;
      // content that already handed its scrolling over never takes it back.
      key={isAuto ? 'h5p-auto' : 'h5p-manual'}
      ref={iframeRef}
      src={frameSrc || undefined}
      title={frameTitle}
      className="block w-full border-0 bg-white"
      style={{ height: `${displayHeight}px` }}
      onLoad={handleFrameLoad}
      /*
        H5P needs allow-same-origin: its own JavaScript reads resources from
        its own origin. That means the frame is isolated from US, not from
        itself; it keeps its own cookies and storage. Which is exactly why
        this block only ever points at an author-supplied URL on someone
        else's host and carries no LearnHouse credentials of any kind.
      */
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  )

  // A frame the browser will refuse: say so instead of showing a blank box.
  const blockedNotice = (compact?: boolean) => (
    <div className={cn('flex items-start gap-3 bg-amber-50/70 text-[13px] text-neutral-700', compact ? 'p-4' : 'p-5')}>
      <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <p>{frameProblem ? t(PROBLEM_KEYS[frameProblem]) : null}</p>
        {frameSrc && (
          <a href={openableH5PUrl(frameSrc)} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-neutral-800 underline underline-offset-2">
            {t('editor.blocks_v2.h5p.open_new_tab', 'Open the activity in a new tab')} <ArrowSquareOut size={12} />
          </a>
        )}
      </div>
    </div>
  )

  // Read-only with nothing configured: stay quiet rather than render a broken
  // frame at a learner.
  if (!isEditable && !h5pUrl) {
    return <NodeViewWrapper className="block-h5p" />
  }

  if (!isEditable) {
    return (
      <NodeViewWrapper className="block-h5p w-full">
        <div ref={containerRef} className="w-full overflow-hidden rounded-xl bg-white nice-shadow">
          {frameProblem ? blockedNotice() : frame}
        </div>
      </NodeViewWrapper>
    )
  }

  const handleRemove = () => {
    setUrlDraft('')
    setTitleDraft('')
    setFrameHeight(DEFAULT_HEIGHT)
    persistedHeightRef.current = DEFAULT_HEIGHT
    setError(null)
    setIsEditing(false)
    // Clear the title too: it is what the RAG indexer reads, so leaving it
    // behind keeps search citing content the activity no longer contains.
    props.updateAttributes({ h5pUrl: '', title: '', height: DEFAULT_HEIGHT, sizeMode: 'auto' })
  }

  const tools = h5pUrl && !isEditing ? (
    <BlockToolbarButton label={t('editor.blocks_v2.open_original', 'Open original')} onClick={() => window.open(openableH5PUrl(h5pUrl), '_blank', 'noopener,noreferrer')}>
      <ArrowSquareOut size={14} />
    </BlockToolbarButton>
  ) : undefined

  const inputCls = 'w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-400 focus:ring-2 focus:ring-neutral-400'

  const form = (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && h5pUrl) {
          setIsEditing(false)
          setError(null)
        }
      }}
      className="rounded-lg bg-white p-4 nice-shadow"
    >
      <p className="mb-1 text-sm text-neutral-600">{t('editor.blocks.h5p_block.description')}</p>
      <p className="mb-4 text-xs text-neutral-500">{t('editor.blocks.h5p_block.hosted_hint')}</p>

      <div className="relative mb-3">
        <div className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-500">
          <LinkIcon weight="duotone" size={16} />
        </div>
        <input
          type="text"
          autoFocus={isEditing}
          value={urlDraft}
          onChange={(event) => { setUrlDraft(event.target.value); setError(null) }}
          placeholder={t('editor.blocks.h5p_block.url_placeholder')}
          aria-label={t('editor.blocks.h5p_block.url_label')}
          aria-invalid={!!(error || draftIssue) || undefined}
          className={cn(inputCls, 'ps-10', (error || draftIssue) && 'border-red-300')}
          dir="ltr"
        />
      </div>
      <input
        type="text"
        value={titleDraft}
        onChange={(event) => setTitleDraft(event.target.value)}
        placeholder={t('editor.blocks.h5p_block.title_placeholder')}
        aria-label={t('editor.blocks.h5p_block.title_label')}
        className={cn(inputCls, 'mb-3')}
      />

      {(error || draftIssue) && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-500">
          <WarningCircle weight="duotone" size={16} className="shrink-0" />
          {error || draftIssue}
        </div>
      )}
      {!error && !draftIssue && draftHint && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          <Info weight="duotone" size={16} className="shrink-0" />
          {draftHint}
        </div>
      )}
      {!error && !draftIssue && previewSrc && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-green-700">
            <CheckCircle weight="duotone" size={14} />
            {t('editor.blocks_v2.h5p.preview_ready', 'Preview below. Apply when it shows the right activity.')}
          </div>
          <div className="overflow-hidden rounded-lg bg-white nice-shadow">
            <iframe
              key={previewSrc}
              src={previewSrc}
              title={t('editor.blocks_v2.h5p.preview', 'Preview')}
              className="block w-full border-0 bg-white"
              style={{ height: 320 }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {h5pUrl && (
          <button
            type="button"
            onClick={() => { setIsEditing(false); setError(null) }}
            className="rounded-lg px-4 py-2 text-sm text-neutral-600 transition-colors hover:text-neutral-800"
          >
            {t('editor.blocks.common.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={!urlDraft.trim() || !!draftIssue}
          className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
        >
          {t('editor.blocks.common.apply')}
        </button>
      </div>
    </form>
  )

  return (
    <NodeViewWrapper className="block-h5p w-full">
      <EditorBlockFrame
        editable
        node={props.node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="interactive"
        tools={tools}
      >
        <div data-lhb-panel="" className="rounded-xl bg-neutral-50 px-5 py-4 transition-all ease-linear">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <PuzzlePiece weight="duotone" className="shrink-0 text-neutral-400" size={16} />
              <span className="text-[12px] font-semibold text-neutral-500">{t('editor.blocks.h5p')}</span>
              {title && h5pUrl && !isEditing && <span className="truncate text-xs text-neutral-400">· {title}</span>}
            </div>
            {h5pUrl && !isEditing && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleStartEditing}
                  className="rounded-md p-1.5 text-neutral-600 transition-colors hover:bg-neutral-200"
                  title={t('editor.blocks.h5p_block.edit_content')}
                  aria-label={t('editor.blocks.h5p_block.edit_content')}
                >
                  <PencilSimple weight="duotone" size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="rounded-md p-1.5 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-red-500"
                  title={t('editor.blocks.h5p_block.remove_content')}
                  aria-label={t('editor.blocks.h5p_block.remove_content')}
                >
                  <X weight="duotone" size={16} />
                </button>
              </div>
            )}
          </div>

          {showForm ? (
            form
          ) : (
            <div className="space-y-3">
              {/* Size controls */}
              <div role="radiogroup" aria-label={t('editor.blocks_v2.h5p.height', 'Frame height')} className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-sm font-medium text-neutral-500">
                  <ArrowsOutLineVertical weight="duotone" size={14} />
                  {t('editor.blocks.h5p_block.size_label')}:
                </div>
                {SIZE_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={sizeMode === mode}
                    onClick={() => handleSizeModeChange(mode)}
                    title={t(`editor.blocks.h5p_block.sizes.${mode}_hint`)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 ${
                      sizeMode === mode ? 'bg-neutral-700 text-white' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                    }`}
                  >
                    {sizeMode === mode && <CheckCircle weight="duotone" size={14} />}
                    {t(`editor.blocks.h5p_block.sizes.${mode}`)}
                  </button>
                ))}
                {sizeMode === 'custom' && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-neutral-700 px-3 py-1.5 text-sm text-white">
                    <CheckCircle weight="duotone" size={14} />
                    {t('editor.blocks.h5p_block.sizes.custom', { height: displayHeight })}
                  </span>
                )}
              </div>

              <div ref={containerRef} className="w-full overflow-hidden rounded-lg bg-white nice-shadow">
                {frameProblem ? blockedNotice(true) : frame}
                {/* Drag the bottom edge for a height none of the presets give. */}
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t('editor.blocks.h5p_block.resize_handle')}
                  // A focusable separator is a splitter widget, and its value
                  // defaults to a 0-100 range, so a bare pixel height would be
                  // announced as a percentage of nothing.
                  aria-valuenow={displayHeight}
                  aria-valuemin={MIN_HEIGHT}
                  aria-valuemax={MAX_HEIGHT}
                  aria-valuetext={`${displayHeight}px`}
                  tabIndex={0}
                  onPointerDown={handleResizePointerDown}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerCancel}
                  onKeyDown={handleResizeKeyDown}
                  className="group flex h-3 cursor-ns-resize touch-none items-center justify-center bg-neutral-50 outline-none hover:bg-neutral-100 focus:bg-neutral-100"
                >
                  <span className="h-0.5 w-10 rounded-full bg-neutral-300 group-hover:bg-neutral-400 group-focus:bg-neutral-400" />
                </div>
              </div>
              {dragHeight !== null && <p className="text-center text-[11px] tabular-nums text-neutral-500">{dragHeight}px</p>}
              {silent && !frameProblem && (
                <p className="flex items-start gap-1.5 text-xs leading-snug text-amber-700">
                  <Info weight="duotone" size={14} className="mt-px shrink-0" />
                  {t('editor.blocks_v2.h5p.silent_hint', 'No answer from the activity yet. If the frame stays blank, the host may not allow embedding, or the link isn’t an embed link. Pick a fixed height if the content loads but sits in the wrong size.')}
                </p>
              )}
            </div>
          )}
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default H5PBlockComponent
