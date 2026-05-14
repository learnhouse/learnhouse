import React from 'react'
import { createPortal } from 'react-dom'
import { X, FloppyDisk, Flask, ChatCircle, ClockCounterClockwise, Sparkle, Check, Clipboard } from '@phosphor-icons/react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import MagicBlockPreview from './MagicBlockPreview'
import MagicBlockChat from './MagicBlockChat'
import MagicBlockRevisions from './MagicBlockRevisions'
import { extractHtmlDocument } from './extractHtml'
import type { MagicBlockMessage, MagicBlockContext, MagicBlockRevision } from './types'
import {
  startMagicBlockSession,
  iterateMagicBlock,
} from '@services/ai/magicblocks'
import lrnaiIcon from 'public/lrnai_icon.png'
import { useTranslation } from 'react-i18next'

interface MagicBlockModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (htmlContent: string, sessionUuid: string) => void
  blockUuid: string
  activityUuid: string
  context: MagicBlockContext
  accessToken: string
  initialSessionUuid?: string | null
  initialHtmlContent?: string | null
  initialMessages?: MagicBlockMessage[]
  initialRevisions?: MagicBlockRevision[]
}

type SidebarTab = 'chat' | 'history'

function MagicBlockModal({
  isOpen,
  onClose,
  onSave,
  blockUuid,
  activityUuid,
  context,
  accessToken,
  initialSessionUuid = null,
  initialHtmlContent = null,
  initialMessages = [],
  initialRevisions = [],
}: MagicBlockModalProps) {
  const { t } = useTranslation()
  const [sessionUuid, setSessionUuid] = React.useState<string | null>(initialSessionUuid)
  const [messages, setMessages] = React.useState<MagicBlockMessage[]>(initialMessages)
  const [revisions, setRevisions] = React.useState<MagicBlockRevision[]>(initialRevisions)
  const [previewingRevisionId, setPreviewingRevisionId] = React.useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = React.useState<SidebarTab>('chat')
  const [isLoading, setIsLoading] = React.useState(false)
  const [streamingContent, setStreamingContent] = React.useState('')
  const [htmlContent, setHtmlContent] = React.useState<string | null>(initialHtmlContent)
  const [error, setError] = React.useState<string | null>(null)
  const [styleReference, setStyleReference] = React.useState<string | null>(null)
  const [styleCopied, setStyleCopied] = React.useState(false)
  const pendingPromptRef = React.useRef<string>('')

  const STYLE_STORAGE_KEY = 'magicblock_style_reference'

  // Reset all state only when the modal transitions from closed → open
  const wasOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setSessionUuid(initialSessionUuid)
      setMessages(initialMessages)
      setRevisions(initialRevisions)
      setPreviewingRevisionId(null)
      setSidebarTab('chat')
      setHtmlContent(initialHtmlContent)
      setStreamingContent('')
      setError(null)
      setStyleCopied(false)
      // Hydrate the active style reference from localStorage on each open
      try {
        const stored = window.localStorage.getItem(STYLE_STORAGE_KEY)
        setStyleReference(stored && stored.length > 0 ? stored : null)
      } catch {
        setStyleReference(null)
      }
    }
    wasOpenRef.current = isOpen
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // When async messages load from the server, update them without touching other state
  React.useEffect(() => {
    if (isOpen && initialMessages.length > 0) {
      setMessages((current) => (current.length === 0 ? initialMessages : current))
    }
  }, [isOpen, initialMessages])

  // Same for revisions: hydrate from server once available
  React.useEffect(() => {
    if (isOpen && initialRevisions.length > 0) {
      setRevisions((current) => (current.length === 0 ? initialRevisions : current))
    }
  }, [isOpen, initialRevisions])

  const previewedRevision = React.useMemo(
    () => revisions.find((r) => r.revision_uuid === previewingRevisionId) || null,
    [revisions, previewingRevisionId]
  )
  const displayedHtml = previewedRevision ? previewedRevision.html : htmlContent

  const handleSendMessage = async (message: string) => {
    if (isLoading) return

    setIsLoading(true)
    setError(null)
    setStreamingContent('')
    setPreviewingRevisionId(null)
    pendingPromptRef.current = message

    const userMessage: MagicBlockMessage = { role: 'user', content: message }
    setMessages((prev) => [...prev, userMessage])

    const onChunk = (chunk: string) => {
      setStreamingContent((prev) => prev + chunk)
    }

    const onComplete = (newSessionUuid: string) => {
      setSessionUuid(newSessionUuid)

      setTimeout(() => {
        setStreamingContent((current) => {
          const cleaned = extractHtmlDocument(current) || current
          setHtmlContent(cleaned)
          const aiMessage: MagicBlockMessage = { role: 'model', content: cleaned }
          setMessages((prev) => [...prev, aiMessage])
          // Optimistically append the revision so the History tab updates immediately
          const newRevision: MagicBlockRevision = {
            revision_uuid: `rev_local_${Date.now()}`,
            prompt: pendingPromptRef.current,
            html: cleaned,
            created_at: Date.now() / 1000,
          }
          setRevisions((prev) => {
            const next = [...prev, newRevision]
            return next.length > 20 ? next.slice(-20) : next
          })
          setIsLoading(false)
          return ''
        })
      }, 100)
    }

    const onError = (errorMsg: string) => {
      setError(errorMsg)
      setIsLoading(false)
      setStreamingContent('')
    }

    try {
      if (!sessionUuid) {
        await startMagicBlockSession(
          activityUuid,
          blockUuid,
          message,
          context,
          accessToken,
          onChunk,
          onComplete,
          onError,
          styleReference
        )
      } else {
        const currentHtmlForIteration = htmlContent || streamingContent || null
        await iterateMagicBlock(
          sessionUuid,
          activityUuid,
          blockUuid,
          message,
          accessToken,
          onChunk,
          onComplete,
          onError,
          currentHtmlForIteration,
          styleReference
        )
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleCopyStyle = async () => {
    if (!displayedHtml) return
    // Write to the system clipboard so the user can paste this style into a
    // magic block in another activity, tab, or device. Also persist locally so
    // re-opening the modal hydrates the reference instantly.
    let clipboardOk = false
    try {
      await navigator.clipboard.writeText(displayedHtml)
      clipboardOk = true
    } catch {
      // Clipboard blocked — fall back to localStorage only
    }
    try {
      window.localStorage.setItem(STYLE_STORAGE_KEY, displayedHtml)
    } catch {
      // ignore
    }
    setStyleReference(displayedHtml)
    setStyleCopied(true)
    setTimeout(() => setStyleCopied(false), 1500)
    if (!clipboardOk) {
      setError(t('editor.blocks.magic_block_content.clipboard_unavailable'))
      setTimeout(() => setError((e) => (e === t('editor.blocks.magic_block_content.clipboard_unavailable') ? null : e)), 3000)
    }
  }

  const handlePasteStyle = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const looksLikeHtml = /<\w/.test(text) && text.includes('>')
      if (!text || !looksLikeHtml) {
        setError(t('editor.blocks.magic_block_content.paste_style_invalid'))
        setTimeout(() => setError(null), 3000)
        return
      }
      try {
        window.localStorage.setItem(STYLE_STORAGE_KEY, text)
      } catch {
        // ignore
      }
      setStyleReference(text)
    } catch {
      setError(t('editor.blocks.magic_block_content.clipboard_unavailable'))
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleClearStyleReference = () => {
    try {
      window.localStorage.removeItem(STYLE_STORAGE_KEY)
    } catch {
      // ignore
    }
    setStyleReference(null)
  }

  const handleSave = () => {
    if (htmlContent && sessionUuid) {
      onSave(htmlContent, sessionUuid)
    }
    onClose()
  }

  const handlePreviewRevision = (revision: MagicBlockRevision | null) => {
    setPreviewingRevisionId(revision?.revision_uuid ?? null)
  }

  const handleRestoreRevision = (revision: MagicBlockRevision) => {
    setHtmlContent(revision.html)
    setPreviewingRevisionId(null)
    setSidebarTab('chat')
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ pointerEvents: 'none', zIndex: 'var(--z-toast)' }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            style={{ pointerEvents: 'auto' }}
          />

          <motion.div
            initial={{ y: 20, opacity: 0.3, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: 50, opacity: 0, filter: 'blur(25px)' }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
            }}
            style={{
              pointerEvents: 'auto',
              background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)',
            }}
            className="relative w-[95vw] max-w-[1400px] h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-inset ring-white/10 backdrop-blur-md min-h-0"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Image
                    className="outline outline-1 outline-neutral-200/20 rounded-lg"
                    width={24}
                    src={lrnaiIcon}
                    alt="Magic Block"
                  />
                  <span className="text-sm font-semibold text-white/70">{t('editor.blocks.magic_block_content.title')}</span>
                </div>
                <div className="bg-white/5 text-white/40 py-0.5 px-3 flex space-x-1 rounded-full items-center">
                  <Flask weight="duotone" size={14} />
                  <span className="text-xs font-semibold antialiased">{t('editor.blocks.magic_block_content.experimental')}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyStyle}
                  disabled={!displayedHtml}
                  title={t('editor.blocks.magic_block_content.copy_style_tooltip')}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all delay-75 ease-linear outline outline-1",
                    !displayedHtml
                      ? "bg-white/5 text-white/20 cursor-not-allowed outline-white/5"
                      : styleCopied
                        ? "bg-purple-500/20 text-purple-100 outline-purple-400/40"
                        : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10 outline-neutral-100/10 hover:outline-neutral-200/40"
                  )}
                >
                  {styleCopied ? <Check weight="duotone" className="w-3.5 h-3.5" /> : <Sparkle weight="duotone" className="w-3.5 h-3.5" />}
                  <span>
                    {styleCopied
                      ? t('editor.blocks.magic_block_content.copy_style_done')
                      : t('editor.blocks.magic_block_content.copy_style')}
                  </span>
                </button>
                <button
                  onClick={handlePasteStyle}
                  title={t('editor.blocks.magic_block_content.paste_style_tooltip')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all delay-75 ease-linear outline outline-1 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 outline-neutral-100/10 hover:outline-neutral-200/40"
                >
                  <Clipboard weight="duotone" className="w-3.5 h-3.5" />
                  <span>{t('editor.blocks.magic_block_content.paste_style')}</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={!htmlContent}
                  className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all delay-75 ease-linear outline outline-1",
                    htmlContent
                      ? "bg-white/5 text-white/60 hover:text-white hover:bg-white/10 outline-neutral-100/10 hover:outline-neutral-200/40"
                      : "bg-white/5 text-white/20 cursor-not-allowed outline-white/5"
                  )}
                >
                  <FloppyDisk weight="duotone" className="w-4 h-4" />
                  {t('editor.blocks.magic_block_content.save_and_close')}
                </button>
                <X
                  weight="duotone"
                  size={20}
                  className="text-white/50 hover:cursor-pointer bg-white/10 p-1 rounded-full items-center hover:bg-white/20 transition-colors"
                  onClick={onClose}
                />
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="px-6 py-3 bg-red-500/20 outline outline-1 outline-red-500 text-red-200 text-sm flex-shrink-0">
                {error}
              </div>
            )}

            {/* Preview-mode banner */}
            {previewedRevision && (
              <div className="px-6 py-2 bg-purple-500/20 outline outline-1 outline-purple-500/40 text-purple-100 text-xs flex items-center justify-between flex-shrink-0">
                <span>
                  {t('editor.blocks.magic_block_content.previewing_revision', { defaultValue: 'Previewing a past revision (read-only)' })}
                </span>
                <button
                  onClick={() => setPreviewingRevisionId(null)}
                  className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                >
                  {t('editor.blocks.magic_block_content.stop_preview')}
                </button>
              </div>
            )}

            {/* Style-reference banner */}
            {styleReference && (
              <div className="px-6 py-2 bg-purple-400/10 outline outline-1 outline-purple-400/30 text-purple-100 text-xs flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Sparkle weight="duotone" className="w-3.5 h-3.5 text-purple-300" />
                  <span>{t('editor.blocks.magic_block_content.style_ref_banner')}</span>
                </div>
                <button
                  onClick={handleClearStyleReference}
                  className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                >
                  {t('editor.blocks.magic_block_content.clear_style')}
                </button>
              </div>
            )}

            {/* Content - Two panel layout */}
            <div className="flex-1 flex min-h-0">
              {/* Left panel - Preview */}
              <div className="flex-1 border-r border-white/5 relative">
                <div className="absolute inset-0">
                  <MagicBlockPreview
                    htmlContent={displayedHtml}
                    isLoading={isLoading}
                    streamingContent={streamingContent}
                  />
                </div>
              </div>

              {/* Right panel - tabbed Chat / History */}
              <div className="w-[400px] flex flex-col min-h-0">
                <div className="flex border-b border-white/5 flex-shrink-0">
                  <button
                    onClick={() => setSidebarTab('chat')}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold transition-colors",
                      sidebarTab === 'chat'
                        ? "text-white/80 border-b-2 border-purple-400"
                        : "text-white/40 hover:text-white/60"
                    )}
                  >
                    <ChatCircle weight="duotone" className="w-3.5 h-3.5" />
                    {t('editor.blocks.magic_block_content.chat_tab')}
                  </button>
                  <button
                    onClick={() => setSidebarTab('history')}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold transition-colors relative",
                      sidebarTab === 'history'
                        ? "text-white/80 border-b-2 border-purple-400"
                        : "text-white/40 hover:text-white/60"
                    )}
                  >
                    <ClockCounterClockwise weight="duotone" className="w-3.5 h-3.5" />
                    {t('editor.blocks.magic_block_content.history_tab')}
                    {revisions.length > 0 && (
                      <span className="text-[10px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded-full">
                        {revisions.length}
                      </span>
                    )}
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  {sidebarTab === 'chat' ? (
                    <MagicBlockChat
                      messages={messages}
                      isLoading={isLoading}
                      onSendMessage={handleSendMessage}
                      styleReferenceActive={!!styleReference}
                      onClearStyleReference={handleClearStyleReference}
                    />
                  ) : (
                    <MagicBlockRevisions
                      revisions={revisions}
                      previewingRevisionId={previewingRevisionId}
                      onPreview={handlePreviewRevision}
                      onRestore={handleRestoreRevision}
                    />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default MagicBlockModal
