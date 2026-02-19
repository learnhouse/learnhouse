'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NodeViewWrapper } from '@tiptap/react'
import { useBoardYdoc } from '../BoardYjsContext'
import {
  GripVertical,
  Sparkles,
  Pencil,
  Send,
  Loader2,
  X,
  Save,
  FlaskConical,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import NodeActions from './NodeActions'
import {
  startBoardsPlaygroundSession,
  iterateBoardsPlayground,
} from '@services/boards/playground'
import { useDragResize } from './useDragResize'

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 6

const SUGGESTION_CHIPS = [
  { label: 'Live Poll', prompt: 'Create a real-time live poll where users can vote on options and see results update instantly. Show each voter\'s name and color.' },
  { label: 'Shared Whiteboard', prompt: 'Create a simple collaborative drawing canvas where each user draws in their own color and everyone can see all drawings in real-time.' },
  { label: 'Quiz Game', prompt: 'Create a multiplayer quiz game with 5 trivia questions. Track scores per player and show a live leaderboard.' },
  { label: 'Reaction Board', prompt: 'Create a reaction board where users can click anywhere to place emoji reactions. Show who placed each reaction.' },
  { label: 'Brainstorm', prompt: 'Create a collaborative brainstorming tool where users can add sticky notes. Each note shows the author name in their color.' },
  { label: 'Tic Tac Toe', prompt: 'Create a multiplayer tic-tac-toe game that two users can play together in real-time with a score tracker.' },
]

// ─── Bridge script ───────────────────────────────────────────────────────────
// State lives in a Y.Map (`playground:{blockUuid}`) on the shared ydoc.
// iframe calls boardState.set() → postMessage to parent → parent writes to Y.Map →
// Yjs syncs to all users → Y.Map observer pushes update back to each iframe.

function makeBridgeScript(
  bid: string,
  initialState: string,
  initialMyself: string
): string {
  return `<script>
(function(){
  var BID="${bid}",state={},ls={},inited=false;
  try{state=${initialState}}catch(e){state={}}
  window._bMe=${initialMyself};

  function fireReady(){if(inited)return;inited=true;window.dispatchEvent(new Event("boardStateReady"))}

  window.boardState={
    get:function(k){return state[k]},
    set:function(k,v){
      state[k]=v;
      try{window.parent.postMessage({t:"bs:set",b:BID,k:k,v:JSON.parse(JSON.stringify(v))},"*")}catch(e){}
      (ls[k]||[]).forEach(function(fn){try{fn(v,k)}catch(e){}});
    },
    on:function(k,cb){
      if(!ls[k])ls[k]=[];ls[k].push(cb);
      return function(){ls[k]=ls[k].filter(function(f){return f!==cb})};
    },
    getAll:function(){return JSON.parse(JSON.stringify(state))},
    getMyself:function(){return window._bMe||{name:"User",color:"#958DF1"}}
  };

  window.addEventListener("message",function(ev){
    var d=ev.data;if(!d||!d.t)return;
    if(d.b&&d.b!==BID)return;
    if(d.t==="bs:upd"){
      state[d.k]=d.v;
      (ls[d.k]||[]).forEach(function(fn){try{fn(d.v,d.k)}catch(e){}});
    }else if(d.t==="bs:batch"){
      var s=d.s||{};for(var k in s){state[k]=s[k];(ls[k]||[]).forEach(function(fn){try{fn(s[k],k)}catch(e){}})}
    }
  });

  // Fire ready immediately — state is already pre-loaded
  setTimeout(fireReady,0);
})();
</script>`
}

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

function buildSrcdoc(
  rawHtml: string,
  bid: string,
  state: Record<string, any>,
  myself: { name: string; color: string }
): string {
  const html = extractHtml(rawHtml)
  const bridge = makeBridgeScript(
    bid,
    JSON.stringify(state),
    JSON.stringify(myself)
  )

  if (html.trim().toLowerCase().startsWith('<!doctype') || html.trim().toLowerCase().startsWith('<html')) {
    if (html.includes('</body>')) return html.replace('</body>', `${bridge}</body>`)
    return html + bridge
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
${bridge}
</body>
</html>`
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
  const { blockUuid, x, y, width, height, htmlContent, sessionUuid, iterationCount } = node.attrs

  const ydoc = useBoardYdoc()
  const stateMapRef = useRef<any>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

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

  const boardCtx = editor?.storage?.boardContext
  const accessToken: string = boardCtx?.accessToken || ''
  const username: string = boardCtx?.username || 'User'

  // ── Current user info (pre-loaded into iframe) ──────────────────────
  const getMyself = useCallback(() => {
    return { name: username, color: '#958DF1' }
  }, [username])

  // ── Native DOM event blocker ──────────────────────────────────────────
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const stop = (e: Event) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-drag-handle]') || target.closest('[data-resize-handle]')) return
      e.stopPropagation()
    }
    el.addEventListener('mousedown', stop, true)
    el.addEventListener('keydown', stop, true)
    el.addEventListener('keyup', stop, true)
    el.addEventListener('focus', stop, true)
    return () => {
      el.removeEventListener('mousedown', stop, true)
      el.removeEventListener('keydown', stop, true)
      el.removeEventListener('keyup', stop, true)
      el.removeEventListener('focus', stop, true)
    }
  }, [])

  // ── Yjs shared state — single map, blockUuid as key (same pattern as YouTube) ─
  useEffect(() => {
    if (!ydoc || !blockUuid) return
    const syncMap = ydoc.getMap('playground-sync')
    stateMapRef.current = syncMap

    const observer = () => {
      const cw = iframeRef.current?.contentWindow
      if (!cw) return
      const state = syncMap.get(blockUuid) as Record<string, any> | undefined
      cw.postMessage({ t: 'bs:batch', b: blockUuid, s: state || {} }, '*')
    }
    syncMap.observe(observer)
    observer()

    return () => { syncMap.unobserve(observer) }
  }, [ydoc, blockUuid])

  // ── Listen for boardState.set() from iframe → write to shared Y.Map ───
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const d = event.data
      if (!d || d.t !== 'bs:set' || d.b !== blockUuid) return
      const syncMap = stateMapRef.current
      if (!syncMap) return
      const current = (syncMap.get(blockUuid) as Record<string, any>) || {}
      syncMap.set(blockUuid, { ...current, [d.k]: d.v })
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [blockUuid])

  // ── Push full state when iframe finishes loading ──────────────────────
  const handleIframeLoad = useCallback(() => {
    const cw = iframeRef.current?.contentWindow
    const syncMap = stateMapRef.current
    if (!cw || !syncMap) return
    const state = (syncMap.get(blockUuid) as Record<string, any>) || {}
    cw.postMessage({ t: 'bs:batch', b: blockUuid, s: state }, '*')
  }, [blockUuid])

  // ── Build srcdoc — only when htmlContent changes ──────────────────────
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const htmlContentRef = useRef<string | null>(null)

  useEffect(() => {
    if (!htmlContent) { setSrcdoc(null); htmlContentRef.current = null; return }
    if (htmlContent === htmlContentRef.current) return
    htmlContentRef.current = htmlContent
    const syncMap = stateMapRef.current
    const initialState = syncMap ? ((syncMap.get(blockUuid) as Record<string, any>) || {}) : {}
    setSrcdoc(buildSrcdoc(htmlContent, blockUuid, initialState, getMyself()))
  }, [htmlContent, blockUuid]) // intentionally omit getMyself

  // ── Drag & Resize (smooth, commit on mouseUp only) ──────────────────
  const { handleDragStart, handleResizeStart } = useDragResize({
    x, y, width, height,
    minWidth: 300, minHeight: 200,
    updateAttributes,
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
      board_description: 'Collaborative real-time board with multiplayer support',
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
      // Clear shared state when saving new content
      if (stateMapRef.current) {
        stateMapRef.current.delete(blockUuid)
      }
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

  // ── Render: Empty State ───────────────────────────────────────────────
  if (!htmlContent) {
    return (
      <NodeViewWrapper as="div" data-playground-block>
        <div
          ref={wrapperRef}
          className={`absolute group rounded-xl nice-shadow bg-white ${selected ? 'ring-2 ring-blue-400' : ''}`}
          style={{ left: x, top: y, width, minHeight: 200 }}
        >
          <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
          <div
            data-drag-handle
            onMouseDown={handleDragStart}
            className="flex items-center justify-center h-6 cursor-grab active:cursor-grabbing bg-gray-50/80 border-b border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <GripVertical size={12} className="text-gray-400" />
          </div>
          <div className="flex flex-col items-center justify-center gap-4 p-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Sparkles size={22} className="text-white" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-neutral-800">Board Playground</p>
              <p className="text-xs text-neutral-500 mt-1 max-w-[280px]">
                Generate interactive multiplayer experiences powered by AI
              </p>
            </div>
            <button
              onClick={handleOpenModal}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
            >
              <Wand2 size={13} />
              Generate
            </button>
          </div>
          <div
            data-resize-handle
            onMouseDown={handleResizeStart}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <svg viewBox="0 0 16 16" className="w-full h-full text-gray-300">
              <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
          {isModalOpen && (
            <PlaygroundModal
              blockUuid={blockUuid}
              username={username}
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
          )}
        </div>
      </NodeViewWrapper>
    )
  }

  // ── Render: Content State ─────────────────────────────────────────────
  return (
    <NodeViewWrapper as="div" data-playground-block>
      <div
        ref={wrapperRef}
        className={`absolute group rounded-xl nice-shadow bg-white ${selected ? 'ring-2 ring-blue-400' : ''}`}
        style={{ left: x, top: y, width, height }}
      >
        <NodeActions selected={selected} deleteNode={deleteNode} editor={editor} getPos={getPos} />
        <div
          data-drag-handle
          onMouseDown={handleDragStart}
          className="flex items-center justify-between h-7 cursor-grab active:cursor-grabbing bg-gray-50/90 border-b border-gray-100 rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity px-2 relative z-10"
        >
          <div className="flex items-center gap-1.5">
            <GripVertical size={12} className="text-gray-400" />
            <div className="flex items-center gap-1">
              <Sparkles size={10} className="text-purple-500" />
              <span className="text-[10px] font-semibold text-gray-500">Board Playground</span>
            </div>
          </div>
          <button
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleOpenModal() }}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Pencil size={9} />
            Edit
          </button>
        </div>

        <div className="overflow-hidden rounded-b-xl" style={{ width: '100%', height: height - 28, overscrollBehavior: 'contain' }}>
          {srcdoc && (
            <iframe
              ref={iframeRef}
              srcDoc={srcdoc}
              onLoad={handleIframeLoad}
              className="w-full h-full bg-white block"
              style={{ border: 'none' }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
              title="Playground"
            />
          )}
        </div>

        <div
          data-resize-handle
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <svg viewBox="0 0 16 16" className="w-full h-full text-gray-300">
            <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>

        {isModalOpen && (
          <PlaygroundModal
            blockUuid={blockUuid}
            username={username}
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
        )}
      </div>
    </NodeViewWrapper>
  )
}

// ─── Generation Modal ────────────────────────────────────────────────────────

interface PlaygroundModalProps {
  blockUuid: string
  username: string
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
  username,
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
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [previewSrcdoc, setPreviewSrcdoc] = useState<string | null>(null)

  const canSend = !isLoading && localIterCount < MAX_ITERATIONS && chatInput.trim()
  const isExhausted = localIterCount >= MAX_ITERATIONS

  // Determine what preview state we're in
  const previewContent = streamingContent || localHtml
  const showLoading = isLoading && !streamingContent
  const showStreaming = isLoading && !!streamingContent
  const showPreview = !!previewContent && !showLoading

  useEffect(() => {
    if (!previewContent || showLoading) { setPreviewSrcdoc(null); return }
    const myself = { name: username || 'User', color: '#958DF1' }
    const doc = buildSrcdoc(previewContent, blockUuid, {}, myself)
    // Debounce during streaming so iframe doesn't reload on every chunk
    const timer = setTimeout(() => setPreviewSrcdoc(doc), streamingContent ? 800 : 0)
    return () => clearTimeout(timer)
  }, [previewContent, showLoading, blockUuid, username, streamingContent])

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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                <Sparkles size={13} className="text-white" />
              </div>
              <span className="text-sm font-semibold text-white/70">Board Playground</span>
            </div>
            <div className="bg-white/5 text-white/40 py-0.5 px-3 flex space-x-1 rounded-full items-center">
              <FlaskConical size={14} />
              <span className="text-xs font-semibold antialiased">Multiplayer</span>
            </div>
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
              Save & Close
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
          {/* Preview — mutually exclusive states */}
          <div className="flex-1 border-r border-white/5 relative">
            <div className="absolute inset-0 bg-black/20">
              {/* State 1: Loading spinner (no streaming yet) */}
              {showLoading && (
                <div className="flex items-center justify-center w-full h-full">
                  <div className="text-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400" />
                    <p className="text-sm text-white/50">Generating interactive content...</p>
                  </div>
                </div>
              )}

              {/* State 2: Preview iframe (streaming or final) */}
              {showPreview && previewSrcdoc && (
                <div className="relative w-full h-full">
                  {showStreaming && (
                    <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm ring-1 ring-inset ring-white/10">
                      <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                      <span className="text-xs text-white/70">Generating...</span>
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

              {/* State 3: Empty placeholder */}
              {!showLoading && !showPreview && (
                <div className="flex items-center justify-center w-full h-full border-2 border-dashed border-white/10 rounded-lg m-2">
                  <div className="text-center space-y-2 px-4">
                    <div className="text-4xl">🎮</div>
                    <p className="text-sm text-white/50">Describe a multiplayer experience and watch it come to life!</p>
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
                <span className="font-semibold text-sm text-white/70">Board Playground Chat</span>
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
                  <p className="text-sm text-white/50 text-center">Describe a multiplayer interactive experience</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {SUGGESTION_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        onClick={() => !isLoading && localIterCount < MAX_ITERATIONS && onSend(chip.prompt)}
                        className="px-4 py-1.5 text-xs font-semibold bg-white/5 text-white/40 rounded-xl hover:text-white/60 hover:bg-white/10 transition-all outline outline-1 outline-neutral-100/10 hover:outline-neutral-200/40"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                    msg.role === 'user' ? 'bg-purple-600/80 text-white rounded-br-md' : 'bg-white/5 text-white/80 rounded-bl-md ring-1 ring-inset ring-white/10'
                  )}>
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-white/50 font-medium">AI generated content</p>
                        <p className="text-white/60 text-xs">Check the preview on the left</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3 ring-1 ring-inset ring-white/10">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                      <span className="text-sm text-white/50">Creating magic...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-white/5 p-4">
              {isExhausted ? (
                <div className="text-center text-sm text-white/50 py-2">Maximum iterations reached. Save your work!</div>
              ) : (
                <form onSubmit={handleSubmit} className="relative">
                  <textarea
                    ref={inputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={messages.length === 0 ? 'Describe what you want to create...' : 'Describe changes or refinements...'}
                    disabled={isLoading}
                    rows={2}
                    className={cn(
                      'w-full resize-none rounded-lg ring-1 ring-inset ring-white/10 bg-gray-950/40 px-4 py-3 pr-12',
                      'text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-white/20',
                      isLoading ? 'opacity-30' : ''
                    )}
                  />
                  <button
                    type="submit"
                    disabled={!canSend}
                    className={cn(
                      'absolute right-3 bottom-3 p-2 rounded-lg transition-all',
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
