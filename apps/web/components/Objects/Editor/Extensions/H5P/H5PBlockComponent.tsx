import { NodeViewWrapper } from '@tiptap/react'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  PuzzlePiece,
  Link as LinkIcon,
  PencilSimple,
  X,
  WarningCircle,
  ArrowsOutLineVertical,
  CheckCircle,
} from '@phosphor-icons/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
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
  SIZE_MODES,
  type H5PSizeMode,
} from '@/lib/media/h5pProtocol'

const ERROR_KEYS: Record<H5PUrlErrorReason, string> = {
  empty: 'editor.blocks.h5p_block.errors.empty',
  unparseable: 'editor.blocks.h5p_block.errors.unparseable',
  unsupported_protocol: 'editor.blocks.h5p_block.errors.unsupported_protocol',
}

// How far one arrow-key press moves the resize handle.
const KEYBOARD_RESIZE_STEP = 20

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
  // has to know it — and has to notice when it changes, which happens without
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
  // instead of the author's last edit, and the frame — which follows the
  // attribute — immediately writes the old height back, wiping the redo
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
  // clipped — which is the problem manual sizing exists to solve.
  useEffect(() => {
    if (!h5pUrl || !isAuto) return

    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current
      if (!frame || !event.source || event.source !== frame.contentWindow) return

      const message = parseH5PMessage(event.data)
      if (!message) return

      switch (message.kind) {
        case 'hello':
          respondToFrame(frame, event, { context: 'h5p', action: 'hello' })
          return

        case 'prepareResize': {
          if (!shouldPrepareResize(frame.clientHeight, message)) return
          if (message.clientHeight > 0) {
            const shrunk = clampHeight(message.clientHeight)
            // The content re-measures the moment it receives our reply, so the
            // frame has to be that height *now* — a React state update is not
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
      const next = clampHeight(drag.startHeight + (event.clientY - drag.startY))
      setDragHeight(null)
      commitHeight('custom', next)
    },
    [commitHeight]
  )

  // The handle is a real control, so it answers the arrow keys too — dragging
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
      commitHeight('custom', clampHeight(displayHeight + step))
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
      if (result.url === h5pUrl) {
        props.updateAttributes({ title: nextTitle })
        return
      }
      // Different content: its height is anyone's guess until it reports one,
      // so start from the default rather than inheriting the old activity's.
      // The chosen size mode is the author's, not the activity's, so it stays.
      setFrameHeight(DEFAULT_HEIGHT)
      persistedHeightRef.current = DEFAULT_HEIGHT
      props.updateAttributes({ h5pUrl: result.url, title: nextTitle, height: DEFAULT_HEIGHT })
    },
    [urlDraft, titleDraft, h5pUrl, props, t]
  )

  const handleRemove = useCallback(() => {
    setUrlDraft('')
    setTitleDraft('')
    setFrameHeight(DEFAULT_HEIGHT)
    persistedHeightRef.current = DEFAULT_HEIGHT
    setError(null)
    setIsEditing(false)
    // Clear the title too: it is what the RAG indexer reads, so leaving it
    // behind keeps search citing content the activity no longer contains.
    props.updateAttributes({ h5pUrl: '', title: '', height: DEFAULT_HEIGHT, sizeMode: 'auto' })
  }, [props])

  const handleStartEditing = useCallback(() => {
    setUrlDraft(h5pUrl)
    setTitleDraft(title)
    setError(null)
    setIsEditing(true)
  }, [h5pUrl, title])

  const frame = (
    <iframe
      // Whether we take part in the handshake is decided when the content
      // loads, so switching between auto and a manual size has to reload it —
      // content that already handed its scrolling over never takes it back.
      key={isAuto ? 'h5p-auto' : 'h5p-manual'}
      ref={iframeRef}
      src={h5pUrl}
      title={frameTitle}
      className="w-full block border-0 rounded-lg bg-white"
      style={{ height: `${displayHeight}px` }}
      onLoad={handleFrameLoad}
      /*
        H5P needs allow-same-origin: its own JavaScript reads resources from
        its own origin. That means the frame is isolated from US, not from
        itself — it keeps its own cookies and storage. Which is exactly why
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

  // Read-only with nothing configured: stay quiet rather than render a broken
  // frame at a learner.
  if (!isEditable && !h5pUrl) {
    return <NodeViewWrapper className="block-h5p" />
  }

  if (!isEditable) {
    return (
      <NodeViewWrapper className="block-h5p w-full">
        <div ref={containerRef} className="w-full rounded-xl overflow-hidden nice-shadow bg-white">
          {frame}
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="block-h5p w-full">
      <div className="bg-neutral-50 rounded-xl px-5 py-4 transition-all ease-linear">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <PuzzlePiece weight="duotone" className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              {t('editor.blocks.h5p')}
            </span>
          </div>
          {h5pUrl && !isEditing && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleStartEditing}
                className="p-1.5 rounded-md hover:bg-neutral-200 text-neutral-600 transition-colors"
                title={t('editor.blocks.h5p_block.edit_content')}
              >
                <PencilSimple weight="duotone" size={16} />
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="p-1.5 rounded-md hover:bg-neutral-200 text-neutral-600 hover:text-red-500 transition-colors"
                title={t('editor.blocks.h5p_block.remove_content')}
              >
                <X weight="duotone" size={16} />
              </button>
            </div>
          )}
        </div>

        {h5pUrl && !isEditing ? (
          <div className="space-y-3">
            {/* Size controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm text-neutral-500 font-medium flex items-center gap-1">
                <ArrowsOutLineVertical weight="duotone" size={14} />
                {t('editor.blocks.h5p_block.size_label')}:
              </div>
              {SIZE_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleSizeModeChange(mode)}
                  title={t(`editor.blocks.h5p_block.sizes.${mode}_hint`)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors outline-none ${
                    sizeMode === mode
                      ? 'bg-neutral-700 text-white'
                      : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                  }`}
                >
                  {sizeMode === mode && <CheckCircle weight="duotone" size={14} />}
                  {t(`editor.blocks.h5p_block.sizes.${mode}`)}
                </button>
              ))}
              {sizeMode === 'custom' && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-neutral-700 text-white">
                  <CheckCircle weight="duotone" size={14} />
                  {t('editor.blocks.h5p_block.sizes.custom', { height: displayHeight })}
                </span>
              )}
            </div>

            <div ref={containerRef} className="w-full rounded-lg overflow-hidden nice-shadow bg-white">
              {frame}
              {/* Drag the bottom edge for a height none of the presets give. */}
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t('editor.blocks.h5p_block.resize_handle')}
                aria-valuenow={displayHeight}
                tabIndex={0}
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onKeyDown={handleResizeKeyDown}
                className="group flex items-center justify-center h-3 cursor-ns-resize touch-none bg-neutral-50 hover:bg-neutral-100 focus:bg-neutral-100 outline-none"
              >
                <span className="h-0.5 w-10 rounded-full bg-neutral-300 group-hover:bg-neutral-400 group-focus:bg-neutral-400" />
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-lg nice-shadow p-4">
            <p className="text-sm text-neutral-600 mb-1">
              {t('editor.blocks.h5p_block.description')}
            </p>
            <p className="text-xs text-neutral-500 mb-4">
              {t('editor.blocks.h5p_block.hosted_hint')}
            </p>

            <div className="relative mb-3">
              <div className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-500">
                <LinkIcon weight="duotone" size={16} />
              </div>
              <input
                type="text"
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                placeholder={t('editor.blocks.h5p_block.url_placeholder')}
                aria-label={t('editor.blocks.h5p_block.url_label')}
                className="w-full ps-10 pe-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-neutral-400 focus:border-neutral-400 outline-none transition-all text-sm"
              />
            </div>

            <input
              type="text"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              placeholder={t('editor.blocks.h5p_block.title_placeholder')}
              aria-label={t('editor.blocks.h5p_block.title_label')}
              className="w-full px-4 py-2.5 mb-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-neutral-400 focus:border-neutral-400 outline-none transition-all text-sm"
            />

            {error && (
              <div className="mb-3 flex items-center gap-2 text-sm text-red-500 font-medium bg-red-50 rounded-lg p-3">
                <WarningCircle weight="duotone" size={16} />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {h5pUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false)
                    setError(null)
                  }}
                  className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800 rounded-lg transition-colors"
                >
                  {t('editor.blocks.common.cancel')}
                </button>
              )}
              <button
                type="submit"
                disabled={!urlDraft.trim()}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-800 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {t('editor.blocks.common.apply')}
              </button>
            </div>
          </form>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default H5PBlockComponent
