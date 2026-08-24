import { NodeViewWrapper } from '@tiptap/react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PuzzlePiece, Link as LinkIcon, PencilSimple, X, WarningCircle } from '@phosphor-icons/react'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
import { normalizeH5PUrl, type H5PUrlErrorReason } from '@/lib/media/h5pUrl'

// Matches the `height` attribute default on the H5PBlock node.
const DEFAULT_HEIGHT = 400
// The host controls the number in the resize message, so clamp it before it
// reaches a style attribute.
const MIN_HEIGHT = 120
const MAX_HEIGHT = 4000
// Only persist a resize once it has actually moved, so a noisy host does not
// flood the document with attribute updates.
const HEIGHT_PERSIST_THRESHOLD = 16

const ERROR_KEYS: Record<H5PUrlErrorReason, string> = {
  empty: 'editor.blocks.h5p_block.errors.empty',
  unparseable: 'editor.blocks.h5p_block.errors.unparseable',
  unsupported_protocol: 'editor.blocks.h5p_block.errors.unsupported_protocol',
}

function clampHeight(value: number): number {
  return Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)))
}

// Reply on the origin the message came from. A sandboxed frame reports its
// origin as the string 'null', which postMessage rejects as a target.
function respondToFrame(
  frame: HTMLIFrameElement,
  event: MessageEvent,
  message: Record<string, unknown>
): void {
  const target = event.origin && event.origin !== 'null' ? event.origin : '*'
  frame.contentWindow?.postMessage(message, target)
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
  // The node-view props object is new on every render; keep the writer in a
  // ref so the message listener is attached once, not on each render.
  const updateAttributesRef = useRef(props.updateAttributes)
  useEffect(() => {
    updateAttributesRef.current = props.updateAttributes
  })

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

  // H5P's external-embed protocol is a three-step handshake, not a single
  // message: the content posts `hello` and will not send anything else until
  // the parent answers `hello` back, then it asks `prepareResize` and only
  // sends the actual `resize` once we reply `resizePrepared`. Answering just
  // the last step means the content never auto-sizes at all.
  //
  // Anything on the page can postMessage at us, so we only act on a message
  // whose source is this very iframe, with the exact shape we expect, and a
  // height we clamp ourselves.
  useEffect(() => {
    if (!h5pUrl) return

    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current
      if (!frame || !event.source || event.source !== frame.contentWindow) return

      let payload: any = event.data
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload)
        } catch {
          return
        }
      }
      if (!payload || typeof payload !== 'object') return
      if (payload.context !== 'h5p') return

      switch (payload.action) {
        case 'hello':
          respondToFrame(frame, event, { context: 'h5p', action: 'hello' })
          return

        case 'prepareResize': {
          // Mirrors H5P's own h5p-resizer.js: shrink the frame back to the
          // content's client height first so the content can re-measure, and
          // skip the whole round-trip when nothing actually changed — without
          // that guard the shrink retriggers the content's resize and the two
          // sides bounce off each other forever.
          const clientHeight = Number(payload.clientHeight)
          const scrollHeight = Number(payload.scrollHeight)
          if (!Number.isFinite(clientHeight) || !Number.isFinite(scrollHeight)) return
          if (frame.clientHeight === scrollHeight && scrollHeight === clientHeight) return
          if (clientHeight > 0) setFrameHeight(clampHeight(clientHeight))
          respondToFrame(frame, event, { context: 'h5p', action: 'resizePrepared' })
          return
        }

        case 'resize': {
          const raw = Number(payload.scrollHeight)
          if (!Number.isFinite(raw) || raw <= 0) return

          const next = clampHeight(raw)
          setFrameHeight(next)

          if (
            isEditable &&
            Math.abs(next - persistedHeightRef.current) > HEIGHT_PERSIST_THRESHOLD
          ) {
            persistedHeightRef.current = next
            updateAttributesRef.current({ height: next })
          }
          return
        }

        default:
          return
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [h5pUrl, isEditable])

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
      props.updateAttributes({ h5pUrl: result.url, title: nextTitle })
    },
    [urlDraft, titleDraft, props, t]
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
