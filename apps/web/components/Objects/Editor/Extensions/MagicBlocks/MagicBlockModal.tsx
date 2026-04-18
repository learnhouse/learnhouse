import React from 'react'
import { createPortal } from 'react-dom'
import { X, Save, FlaskConical } from 'lucide-react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import MagicBlockPreview from './MagicBlockPreview'
import MagicBlockChat from './MagicBlockChat'
import { extractHtmlDocument } from './extractHtml'
import type { MagicBlockMessage, MagicBlockContext } from './types'
import {
  startMagicBlockSession,
  iterateMagicBlock,
} from '@services/ai/magicblocks'
import lrnaiIcon from 'public/lrnai_icon.png'
import { useTranslation } from 'react-i18next'

interface MagicBlockModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (htmlContent: string, sessionUuid: string, iterationCount: number) => void
  blockUuid: string
  activityUuid: string
  context: MagicBlockContext
  accessToken: string
  initialSessionUuid?: string | null
  initialHtmlContent?: string | null
  initialIterationCount?: number
  initialMessages?: MagicBlockMessage[]
}

const MAX_ITERATIONS = 6

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
  initialIterationCount = 0,
  initialMessages = [],
}: MagicBlockModalProps) {
  const { t } = useTranslation()
  const [sessionUuid, setSessionUuid] = React.useState<string | null>(initialSessionUuid)
  const [messages, setMessages] = React.useState<MagicBlockMessage[]>(initialMessages)
  const [iterationCount, setIterationCount] = React.useState(initialIterationCount)
  const [isLoading, setIsLoading] = React.useState(false)
  const [streamingContent, setStreamingContent] = React.useState('')
  const [htmlContent, setHtmlContent] = React.useState<string | null>(initialHtmlContent)
  const [error, setError] = React.useState<string | null>(null)

  // Reset all state only when the modal transitions from closed → open
  const wasOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setSessionUuid(initialSessionUuid)
      setMessages(initialMessages)
      setIterationCount(initialIterationCount)
      setHtmlContent(initialHtmlContent)
      setStreamingContent('')
      setError(null)
    }
    wasOpenRef.current = isOpen
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // When async messages load from the server, update them without touching other state
  React.useEffect(() => {
    if (isOpen && initialMessages.length > 0) {
      setMessages((current) => (current.length === 0 ? initialMessages : current))
    }
  }, [isOpen, initialMessages])

  const handleSendMessage = async (message: string) => {
    if (isLoading || iterationCount >= MAX_ITERATIONS) return

    setIsLoading(true)
    setError(null)
    setStreamingContent('')

    // Add user message immediately
    const userMessage: MagicBlockMessage = { role: 'user', content: message }
    setMessages((prev) => [...prev, userMessage])

    const onChunk = (chunk: string) => {
      setStreamingContent((prev) => prev + chunk)
    }

    const onComplete = (newSessionUuid: string) => {
      setSessionUuid(newSessionUuid)
      setIterationCount((prev) => prev + 1)

      setTimeout(() => {
        setStreamingContent((current) => {
          const cleaned = extractHtmlDocument(current) || current
          setHtmlContent(cleaned)
          const aiMessage: MagicBlockMessage = { role: 'model', content: cleaned }
          setMessages((prev) => [...prev, aiMessage])
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
        // Start new session
        await startMagicBlockSession(
          activityUuid,
          blockUuid,
          message,
          context,
          accessToken,
          onChunk,
          onComplete,
          onError
        )
      } else {
        // Continue existing session - pass current HTML for iteration context
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
          currentHtmlForIteration
        )
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleSave = () => {
    if (htmlContent && sessionUuid) {
      onSave(htmlContent, sessionUuid, iterationCount)
    }
    onClose()
  }

  // Use portal to render outside of editor DOM tree to avoid stacking context issues
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ pointerEvents: 'none', zIndex: 'var(--z-toast)' }}>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            style={{ pointerEvents: 'auto' }}
          />

          {/* Modal */}
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
                  <FlaskConical size={14} />
                  <span className="text-xs font-semibold antialiased">{t('editor.blocks.magic_block_content.experimental')}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
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
                  <Save className="w-4 h-4" />
                  {t('editor.blocks.magic_block_content.save_and_close')}
                </button>
                <X
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

            {/* Content - Two panel layout */}
            <div className="flex-1 flex min-h-0">
              {/* Left panel - Preview */}
              <div className="flex-1 border-r border-white/5 relative">
                <div className="absolute inset-0">
                  <MagicBlockPreview
                    htmlContent={htmlContent}
                    isLoading={isLoading}
                    streamingContent={streamingContent}
                  />
                </div>
              </div>

              {/* Right panel - Chat */}
              <div className="w-[400px] flex flex-col min-h-0">
                <MagicBlockChat
                  messages={messages}
                  iterationCount={iterationCount}
                  maxIterations={MAX_ITERATIONS}
                  isLoading={isLoading}
                  onSendMessage={handleSendMessage}
                />
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
