import { NodeViewWrapper } from '@tiptap/react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PuzzlePiece, Link as LinkIcon, PencilSimple, X, WarningCircle } from '@phosphor-icons/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
import { normalizeH5PUrl, type H5PUrlErrorReason } from '@/lib/media/h5pUrl'
import {
  clampHeight,
  parseH5PMessage,
  replyTarget,
  shouldPrepareResize,
  DEFAULT_HEIGHT,
  HEIGHT_PERSIST_THRESHOLD,
} from '@/lib/media/h5pProtocol'

const ERROR_KEYS: Record<H5PUrlErrorReason, string> = {
  empty: 'editor.blocks.h5p_block.errors.empty',
  unparseable: 'editor.blocks.h5p_block.errors.unparseable',
  unsupported_protocol: 'editor.blocks.h5p_block.errors.unsupported_protocol',
}

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
  const [frameHeight, setFrameHeight] = useState<number>(
    clampHeight(Number(props.node.attrs.height) || DEFAULT_HEIGHT)
  )
  const [isEditing, setIsEditing] = useState(false)
  const [urlDraft, setUrlDraft] = useState<string>(props.node.attrs.h5pUrl || '')
  const [titleDraft, setTitleDraft] = useState<string>(props.node.attrs.title || '')
  const [error, setError] = useState<string | null>(null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
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

  const frameTitle = title || t('editor.blocks.h5p_block.default_title')

  // Drive the parent side of H5P's embed handshake (see lib/media/h5pProtocol).
  // The one part that needs the DOM lives here: acting only on messages from
  // this very iframe, since anything on the page can postMessage at us.
  useEffect(() => {
    if (!h5pUrl) return

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
  }, [h5pUrl, isEditable, persistHeight])

  // The content may have finished its first internal resize before our
  // listener existed, in which case its `hello` is already gone. `ready` makes
  // it start the handshake over.
  const handleFrameLoad = useCallback(() => {
    const frame = iframeRef.current
    frame?.contentWindow?.postMessage({ context: 'h5p', action: 'ready' }, '*')
  }, [])

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
    props.updateAttributes({ h5pUrl: '', title: '', height: DEFAULT_HEIGHT })
  }, [props])

  const handleStartEditing = useCallback(() => {
    setUrlDraft(h5pUrl)
    setTitleDraft(title)
    setError(null)
    setIsEditing(true)
  }, [h5pUrl, title])

  const frame = (
    <iframe
      ref={iframeRef}
      src={h5pUrl}
      title={frameTitle}
      className="w-full block border-0 rounded-lg bg-white"
      style={{ height: `${frameHeight}px` }}
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
        <div className="w-full rounded-xl overflow-hidden nice-shadow bg-white">{frame}</div>
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
          <div className="w-full rounded-lg overflow-hidden nice-shadow bg-white">{frame}</div>
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
