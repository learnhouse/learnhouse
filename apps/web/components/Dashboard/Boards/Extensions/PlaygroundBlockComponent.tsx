'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Sparkles,
  Pencil,
  Send,
  Loader2,
  X,
  Save,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import BoardBlockWrapper from './BoardBlockWrapper'
import DragHandle from './DragHandle'
import ResizeHandle from './ResizeHandle'
import { useBoardSelection } from '../BoardSelectionContext'
import {
  startBoardsPlaygroundSession,
  iterateBoardsPlayground,
} from '@services/boards/playground'
import { useDragResize } from './useDragResize'

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 6

const SUGGESTION_CHIPS = [
  { labelKey: 'boards.playground_block.quiz', prompt: 'Create an interactive quiz with 5 multiple-choice questions about general knowledge. Show score at the end with confetti for a perfect score.' },
  { labelKey: 'boards.playground_block.flashcards', prompt: 'Create a set of 8 flashcards that flip on click. Show the term on the front and the definition on the back. Add navigation arrows and a progress counter.' },
  { labelKey: 'boards.playground_block.chart', prompt: 'Create an interactive bar chart that lets the user add, remove, and edit data points. Include labels and smooth animations when data changes.' },
  { labelKey: 'boards.playground_block.timeline', prompt: 'Create an interactive horizontal timeline with 6 events. Clicking an event expands it to show details. Include smooth scroll navigation.' },
  { labelKey: 'boards.playground_block.drawing', prompt: 'Create a simple drawing canvas with color picker, brush size control, and a clear button. Support freehand drawing with smooth lines.' },
  { labelKey: 'boards.playground_block.calculator', prompt: 'Create a clean scientific calculator with basic operations, trigonometric functions, and a history panel showing recent calculations.' },
]

// ─── HTML helpers ────────────────────────────────────────────────────────────

function extractHtml(raw: string): string {
  let html = raw
  if (html.includes('```html')) {
    const start = html.indexOf('```html') + 7
    const end = html.indexOf('```', start)
    if (end !== -1) html = html.slice(start, end).trim()
  } else if (html.includes('```')) {
    const start = html.indexOf('```') + 3
    const end = html.indexOf('```', start)
    if (end !== -1) html = html.slice(start, end).trim()
  }
  return html
}

function buildSrcdoc(rawHtml: string): string {
  const html = extractHtml(rawHtml)

  if (html.trim().toLowerCase().startsWith('<!doctype') || html.trim().toLowerCase().startsWith('<html')) {
    return html
  }

  return `<!DOCTYPE html>
<html style="height:100%;width:100%">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}</style>
</head>
<body>
${html}
</body>
</html>`
}

// ─── Sparkle illustration SVG ────────────────────────────────────────────────

function SparkleIllustration() {
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Main sparkle */}
      <path d="M32 6L35 18L44 22L35 26L32 38L29 26L20 22L29 18Z" fill="#e9d5ff" stroke="#c084fc" strokeWidth="1" />
      {/* Small sparkles */}
      <path d="M14 12L15.5 16L19 18L15.5 20L14 24L12.5 20L9 18L12.5 16Z" fill="#f3e8ff" stroke="#d8b4fe" strokeWidth="0.8" />
      <path d="M50 10L51.2 13.5L54 15L51.2 16.5L50 20L48.8 16.5L46 15L48.8 13.5Z" fill="#f3e8ff" stroke="#d8b4fe" strokeWidth="0.8" />
      <path d="M48 32L49 35L52 36L49 37L48 40L47 37L44 36L47 35Z" fill="#f3e8ff" stroke="#d8b4fe" strokeWidth="0.8" />
      {/* Dots */}
      <circle cx="10" cy="34" r="1.5" fill="#e9d5ff" />
      <circle cx="54" cy="26" r="1" fill="#e9d5ff" />
      <circle cx="22" cy="40" r="1" fill="#e9d5ff" />
    </svg>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'model'
  content: string
}

export default function PlaygroundBlockComponent({
  node,
  updateAttributes,
  selected,
  deleteNode,
  editor,
  getPos,
}: any) {
  const { t } = useTranslation()
  const { blockUuid, x, y, width, height, htmlContent, sessionUuid, iterationCount } = node.attrs

  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const streamRef = useRef('')
  const [streamingContent, setStreamingContent] = useState('')
  const [localHtml, setLocalHtml] = useState<string | null>(htmlContent)
  const [localSessionUuid, setLocalSessionUuid] = useState<string | null>(sessionUuid)
  const [localIterCount, setLocalIterCount] = useState(iterationCount || 0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { isSelected: isMultiSelected } = useBoardSelection()
  const multiSelected = getPos ? isMultiSelected(getPos()) : false
  const isBlockSelected = selected || multiSelected

  const boardCtx = editor?.storage?.boardContext
  const accessToken: string = boardCtx?.accessToken || ''

  // ── Build srcdoc ──────────────────────────────────────────────────────
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const htmlContentRef = useRef<string | null>(null)

  useEffect(() => {
    if (!htmlContent) { setSrcdoc(null); htmlContentRef.current = null; return }
    if (htmlContent === htmlContentRef.current) return
    htmlContentRef.current = htmlContent
    setSrcdoc(buildSrcdoc(htmlContent))
  }, [htmlContent])

  // ── Drag & Resize ─────────────────────────────────────────────────────
  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 300, minHeight: 200,
    updateAttributes,
    editor,
    getPos,
  })

  // ── AI Generation ─────────────────────────────────────────────────────
  const handleSendMessage = async (message: string) => {
    if (isLoading || localIterCount >= MAX_ITERATIONS || !accessToken) return
    setIsLoading(true)
    setError(null)
    streamRef.current = ''
    setStreamingContent('')
    setMessages((prev) => [...prev, { role: 'user', content: message }])

    const boardUuid = boardCtx?.boardUuid || ''
    const context = {
      board_name: boardCtx?.boardName || 'Board',
      board_description: 'Interactive board for educational content',
    }

    const onChunk = (chunk: string) => {
      streamRef.current += chunk
      setStreamingContent(streamRef.current)
    }
    const onComplete = (newSessionUuid: string) => {
      const finalHtml = streamRef.current
      setLocalSessionUuid(newSessionUuid)
      setLocalIterCount((prev: number) => prev + 1)
      setLocalHtml(finalHtml)
      setMessages((prev) => [...prev, { role: 'model', content: finalHtml }])
      setStreamingContent('')
      streamRef.current = ''
      setIsLoading(false)
    }
    const onError = (msg: string) => {
      setError(msg)
      setIsLoading(false)
      setStreamingContent('')
      streamRef.current = ''
    }

    try {
      if (!localSessionUuid) {
        await startBoardsPlaygroundSession(boardUuid, blockUuid, message, context, accessToken, onChunk, onComplete, onError)
      } else {
        await iterateBoardsPlayground(localSessionUuid, boardUuid, blockUuid, message, accessToken, onChunk, onComplete, onError, localHtml)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleSave = () => {
    if (localHtml) {
      updateAttributes({
        htmlContent: localHtml,
        sessionUuid: localSessionUuid,
        iterationCount: localIterCount,
      })
    }
    setIsModalOpen(false)
  }

  const handleOpenModal = () => {
    setLocalHtml(htmlContent)
    setLocalSessionUuid(sessionUuid)
    setLocalIterCount(iterationCount || 0)
    setMessages([])
    setStreamingContent('')
    streamRef.current = ''
    setError(null)
    setIsModalOpen(true)
  }

  const modal = isModalOpen ? (
    <PlaygroundModal
      blockUuid={blockUuid}
      isLoading={isLoading}
      streamingContent={streamingContent}
      localHtml={localHtml}
      messages={messages}
      chatInput={chatInput}
      setChatInput={setChatInput}
      error={error}
      localIterCount={localIterCount}
      onSend={handleSendMessage}
      onSave={handleSave}
      onClose={() => setIsModalOpen(false)}
    />
  ) : null

  // ── Render: Empty State ───────────────────────────────────────────────
  if (!htmlContent) {
    return (
      <BoardBlockWrapper
        selected={selected}
        deleteNode={deleteNode}
        editor={editor}
        getPos={getPos}
        x={x}
        y={y}
        width={width}
        className="rounded-2xl flex flex-col"
        style={{ minHeight: height }}
      >
        {/* Top gradient */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-purple-50/80 to-transparent rounded-t-2xl pointer-events-none z-0" />

        <DragHandle onMouseDown={handleDragStart} />

        {/* Header */}
        <div className="flex items-center px-4 pt-4 pb-0.5 relative z-[1]">
          <div className="flex items-center gap-1.5 flex-1">
            <div className="w-5 h-5 rounded-md bg-purple-100 flex items-center justify-center">
              <Sparkles size={10} className="text-purple-500" />
            </div>
            <span className="text-[9px] font-semibold tracking-wider uppercase select-none text-neutral-400">
              {t('boards.playground_block.title')}
            </span>
          </div>
        </div>

        {/* Centered content */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 py-6">
          <SparkleIllustration />
          <div className="text-center">
            <p className="text-sm font-semibold text-neutral-700">{t('boards.playground_block.title')}</p>
            <p className="text-[11px] text-neutral-400 mt-1 max-w-[260px]">
              {t('boards.playground_block.description')}
            </p>
          </div>
          <div className="w-12 h-px bg-neutral-200/80" />
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold rounded-xl bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
          >
            <Wand2 size={12} />
            {t('boards.playground_block.generate')}
          </button>
        </div>

        <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
        {modal}
      </BoardBlockWrapper>
    )
  }

  // ── Render: Content State ─────────────────────────────────────────────
  return (
    <BoardBlockWrapper
      selected={selected}
      deleteNode={deleteNode}
      editor={editor}
      getPos={getPos}
      x={x}
      y={y}
      width={width}
      height={height}
      className="rounded-2xl"
    >
      {/* Floating toolbar — appears on hover or when selected */}
      <div className={`absolute inset-x-0 top-0 z-20 flex justify-center pt-2.5 transition-opacity pointer-events-none ${isBlockSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/90 backdrop-blur-sm nice-shadow pointer-events-auto cursor-grab active:cursor-grabbing"
          onMouseDown={handleDragStart}
        >
          <Sparkles size={11} className="text-purple-500 shrink-0" />
          <span className="text-[10px] font-medium text-neutral-500">
            {t('boards.playground_block.title')}
          </span>
          <div className="w-px h-3.5 bg-neutral-200 mx-0.5" />
          <button
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleOpenModal() }}
            className="text-neutral-400 hover:text-neutral-600 transition-colors shrink-0 p-0.5 rounded hover:bg-neutral-100"
            title={t('boards.playground_block.edit')}
          >
            <Pencil size={11} />
          </button>
        </div>
      </div>

      {/* Full iframe */}
      <div
        className="bg-white overflow-hidden rounded-2xl relative w-full h-full"
        style={{ overscrollBehavior: 'contain', pointerEvents: isBlockSelected ? 'auto' : 'none' }}
      >
        {srcdoc && (
          <iframe
            ref={iframeRef}
            srcDoc={srcdoc}
            className="w-full h-full bg-white block"
            style={{ border: 'none' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            title="Playground"
          />
        )}
      </div>

      <ResizeHandle onMouseDown={handleResizeStart} selected={selected} />
      {modal}
    </BoardBlockWrapper>
  )
}

// ─── Generation Modal ────────────────────────────────────────────────────────

interface PlaygroundModalProps {
  blockUuid: string
  isLoading: boolean
  streamingContent: string
  localHtml: string | null
  messages: ChatMessage[]
  chatInput: string
  setChatInput: (v: string) => void
  error: string | null
  localIterCount: number
  onSend: (msg: string) => void
  onSave: () => void
  onClose: () => void
}

function PlaygroundModal({
  blockUuid,
  isLoading,
  streamingContent,
  localHtml,
  messages,
  chatInput,
  setChatInput,
  error,
  localIterCount,
  onSend,
  onSave,
  onClose,
}: PlaygroundModalProps) {
  const { t } = useTranslation()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [previewSrcdoc, setPreviewSrcdoc] = useState<string | null>(null)

  const canSend = !isLoading && localIterCount < MAX_ITERATIONS && chatInput.trim()
  const isExhausted = localIterCount >= MAX_ITERATIONS

  const previewContent = streamingContent || localHtml
  const showLoading = isLoading && !streamingContent
  const showStreaming = isLoading && !!streamingContent
  const showPreview = !!previewContent && !showLoading

  useEffect(() => {
    if (!previewContent || showLoading) { setPreviewSrcdoc(null); return }
    const doc = buildSrcdoc(previewContent)
    const timer = setTimeout(() => setPreviewSrcdoc(doc), streamingContent ? 800 : 0)
    return () => clearTimeout(timer)
  }, [previewContent, showLoading, blockUuid, streamingContent])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSend) { onSend(chatInput.trim()); setChatInput('') }
  }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ pointerEvents: 'none', zIndex: 9999 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        style={{ pointerEvents: 'auto' }}
      />
      <div
        className="relative w-[95vw] max-w-[1400px] h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-inset ring-white/10 backdrop-blur-md min-h-0"
        style={{
          pointerEvents: 'auto',
          background: 'linear-gradient(0deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0) 100%), rgb(2 1 25 / 98%)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Sparkles size={13} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-white/70">{t('boards.playground_block.title')}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onSave}
              disabled={!localHtml}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all outline outline-1',
                localHtml
                  ? 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10 outline-neutral-100/10 hover:outline-neutral-200/40'
                  : 'bg-white/5 text-white/20 cursor-not-allowed outline-white/5'
              )}
            >
              <Save className="w-4 h-4" />
              {t('boards.playground_block.save_close')}
            </button>
            <X
              size={20}
              className="text-white/50 hover:cursor-pointer bg-white/10 p-1 rounded-full items-center hover:bg-white/20 transition-colors"
              onClick={onClose}
            />
          </div>
        </div>

        {error && (
          <div className="px-6 py-3 bg-red-500/20 outline outline-1 outline-red-500 text-red-200 text-sm flex-shrink-0">
            {error}
          </div>
        )}

        <div className="flex-1 flex min-h-0">
          {/* Preview */}
          <div className="flex-1 border-e border-white/5 relative">
            <div className="absolute inset-0 bg-black/20">
              {showLoading && (
                <div className="flex items-center justify-center w-full h-full">
                  <div className="text-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400" />
                    <p className="text-sm text-white/50">{t('boards.playground_block.generating')}</p>
                  </div>
                </div>
              )}

              {showPreview && previewSrcdoc && (
                <div className="relative w-full h-full">
                  {showStreaming && (
                    <div className="absolute top-4 end-4 z-10 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm ring-1 ring-inset ring-white/10">
                      <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                      <span className="text-xs text-white/70">{t('boards.playground_block.streaming')}</span>
                    </div>
                  )}
                  <iframe
                    srcDoc={previewSrcdoc}
                    className="w-full h-full bg-white block"
                    style={{ border: 'none' }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                    title="Playground Preview"
                  />
                </div>
              )}

              {!showLoading && !showPreview && (
                <div className="flex items-center justify-center w-full h-full border-2 border-dashed border-white/10 rounded-lg m-2">
                  <div className="text-center space-y-2 px-4">
                    <div className="text-4xl">✨</div>
                    <p className="text-sm text-white/50">{t('boards.playground_block.empty_state')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chat */}
          <div className="w-[400px] flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-purple-400" />
                <span className="font-semibold text-sm text-white/70">{t('boards.playground_block.chat_header')}</span>
              </div>
              <div className={cn(
                'text-xs font-semibold px-3 py-1 rounded-full',
                isExhausted ? 'bg-red-500/20 text-red-300 outline outline-1 outline-red-500/30' : 'bg-white/5 text-white/40 outline outline-1 outline-neutral-100/10'
              )}>
                {localIterCount}/{MAX_ITERATIONS}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
              {messages.length === 0 && !isLoading && (
                <div className="space-y-4 pt-4">
                  <p className="text-sm text-white/50 text-center">{t('boards.playground_block.prompt_text')}</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {SUGGESTION_CHIPS.map((chip) => (
                      <button
                        key={chip.labelKey}
                        onClick={() => !isLoading && localIterCount < MAX_ITERATIONS && onSend(chip.prompt)}
                        className="px-4 py-1.5 text-xs font-semibold bg-white/5 text-white/40 rounded-xl hover:text-white/60 hover:bg-white/10 transition-all outline outline-1 outline-neutral-100/10 hover:outline-neutral-200/40"
                      >
                        {t(chip.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                    msg.role === 'user' ? 'bg-purple-600/80 text-white rounded-ee-md' : 'bg-white/5 text-white/80 rounded-es-md ring-1 ring-inset ring-white/10'
                  )}>
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-white/50 font-medium">{t('boards.playground_block.ai_content')}</p>
                        <p className="text-white/60 text-xs">{t('boards.playground_block.check_preview')}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/5 rounded-2xl rounded-es-md px-4 py-3 ring-1 ring-inset ring-white/10">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                      <span className="text-sm text-white/50">{t('boards.playground_block.creating')}</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-white/5 p-4">
              {isExhausted ? (
                <div className="text-center text-sm text-white/50 py-2">{t('boards.playground_block.max_iterations')}</div>
              ) : (
                <form onSubmit={handleSubmit} className="relative">
                  <textarea
                    ref={inputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={messages.length === 0 ? t('boards.playground_block.input_placeholder') : t('boards.playground_block.input_placeholder_refine')}
                    disabled={isLoading}
                    rows={2}
                    className={cn(
                      'w-full resize-none rounded-lg ring-1 ring-inset ring-white/10 bg-gray-950/40 px-4 py-3 pe-12',
                      'text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-white/20',
                      isLoading ? 'opacity-30' : ''
                    )}
                  />
                  <button
                    type="submit"
                    disabled={!canSend}
                    className={cn(
                      'absolute end-3 bottom-3 p-2 rounded-lg transition-all',
                      canSend ? 'bg-white/10 text-white/70 hover:text-white hover:bg-white/20 outline outline-1 outline-neutral-100/10 hover:outline-neutral-200/40' : 'bg-white/5 text-white/30 cursor-not-allowed'
                    )}
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
