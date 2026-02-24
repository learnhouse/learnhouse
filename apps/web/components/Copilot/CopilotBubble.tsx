'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  startRAGChatStream,
  sendRAGChatStream,
  StreamCallbacks,
  StreamSourceData,
  fetchRAGChatSessions,
  fetchRAGChatMessages,
  deleteRAGChatSession,
  RAGChatSession,
} from '@services/ai/ai'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR from 'swr'
import {
  ChatCircle,
  X,
  Plus,
  PaperPlaneRight,
  SpinnerGap,
  BookOpen,
  GlobeSimple,
  Books,
  Sparkle,
  CaretDown,
  ArrowRight,
  ChatCircleDots,
  List,
} from '@phosphor-icons/react'
import {
  AssistantMessage,
  CourseDropdown,
  SessionItem,
  groupSessionsByDate,
} from '@/app/orgs/[orgslug]/(withmenu)/copilot/copilot'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  sources?: StreamSourceData['sources']
}

interface CopilotBubbleProps {
  orgslug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionToLoad?: string | null
}

export default function CopilotBubble(props: CopilotBubbleProps) {
  const org = useOrg() as any
  const isCopilotEnabled =
    org?.config?.config?.features?.ai?.enabled !== false &&
    org?.config?.config?.features?.ai?.copilot_enabled !== false

  if (!isCopilotEnabled) return null

  return (
    <AuthenticatedClientElement checkMethod="authentication">
      <BubbleInner {...props} />
    </AuthenticatedClientElement>
  )
}

function BubbleInner({ orgslug, open, onOpenChange, sessionToLoad }: CopilotBubbleProps) {
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token

  const [showSessions, setShowSessions] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [aichatUuid, setAichatUuid] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null)
  const [chatMode, setChatMode] = useState<'course_only' | 'general'>('course_only')
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [followUps, setFollowUps] = useState<string[]>([])
  const [isLoadingFollowUps, setIsLoadingFollowUps] = useState(false)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const streamingIndexRef = useRef<number>(-1)
  const isNewChatRef = useRef(true)
  const loadedSessionRef = useRef<string | null>(null)

  const { data: sessionsData, mutate: mutateSessions } = useSWR(
    accessToken ? 'bubble-rag-sessions' : null,
    () => fetchRAGChatSessions(accessToken),
    { revalidateOnFocus: false }
  )
  const sessions: RAGChatSession[] = sessionsData || []

  const { data: coursesData } = useSWR(
    org?.slug ? `${getAPIUrl()}courses/org_slug/${org.slug}/page/1/limit/100` : null,
    (url: string) => swrFetcher(url, accessToken)
  )
  const courses = coursesData?.data || coursesData || []

  useEffect(() => {
    if (messages.length > 0 && messagesContainerRef.current) {
      const c = messagesContainerRef.current
      c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCourseDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open && !showSessions) {
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open, showSessions])

  const handleLoadSession = useCallback(async (s: RAGChatSession) => {
    if (!accessToken || s.aichat_uuid === aichatUuid) { setShowSessions(false); return }
    setIsLoadingSession(true)
    setMessages([])
    setError(null)
    setFollowUps([])
    setIsLoadingFollowUps(false)
    setShowSessions(false)
    try {
      const msgs = await fetchRAGChatMessages(s.aichat_uuid, accessToken)
      setMessages(msgs.map((m: any) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
        ...(m.sources ? { sources: m.sources } : {}),
      })))
      setAichatUuid(s.aichat_uuid)
      setSelectedCourse(s.course_uuid || null)
      setChatMode(s.mode || 'course_only')
      isNewChatRef.current = false
    } catch { setError('Failed to load session') }
    finally { setIsLoadingSession(false) }
  }, [accessToken, aichatUuid])

  // Auto-load session when sessionToLoad changes (triggered from OrgMenu)
  useEffect(() => {
    if (!sessionToLoad || !accessToken || !sessions.length) return
    if (loadedSessionRef.current === sessionToLoad) return
    const target = sessions.find((s) => s.aichat_uuid === sessionToLoad)
    if (target) {
      loadedSessionRef.current = sessionToLoad
      handleLoadSession(target)
    }
  }, [sessionToLoad, accessToken, sessions, handleLoadSession])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setAichatUuid(null)
    setFollowUps([])
    setError(null)
    setIsLoadingFollowUps(false)
    setChatMode('course_only')
    isNewChatRef.current = true
    loadedSessionRef.current = null
    setShowSessions(false)
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  const handleDeleteSession = useCallback(async (uuid: string) => {
    if (!accessToken) return
    await deleteRAGChatSession(uuid, accessToken)
    mutateSessions()
    if (uuid === aichatUuid) handleNewChat()
  }, [accessToken, aichatUuid, mutateSessions, handleNewChat])

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim() || !accessToken) return
    setError(null)
    setFollowUps([])
    setIsLoadingFollowUps(false)

    setMessages((prev) => {
      const next = [
        ...prev,
        { role: 'user' as const, content: message },
        { role: 'assistant' as const, content: '', sources: [] },
      ]
      streamingIndexRef.current = next.length - 1
      return next
    })
    setInput('')
    setIsWaiting(true)
    setIsStreaming(true)
    const wasNewChat = isNewChatRef.current

    const callbacks: StreamCallbacks = {
      onStart: (data) => { setIsWaiting(false); if (data.aichat_uuid) setAichatUuid(data.aichat_uuid) },
      onChunk: (chunk) => {
        setMessages((prev) => {
          const idx = streamingIndexRef.current
          if (idx < 0 || idx >= prev.length) return prev
          const updated = [...prev]
          updated[idx] = { ...updated[idx], content: updated[idx].content + chunk }
          return updated
        })
      },
      onSources: (data) => {
        const capturedIdx = streamingIndexRef.current
        setMessages((prev) => {
          if (capturedIdx < 0 || capturedIdx >= prev.length) return prev
          const updated = [...prev]
          updated[capturedIdx] = { ...updated[capturedIdx], sources: data.sources }
          return updated
        })
      },
      onComplete: (data) => {
        setIsStreaming(false)
        setIsWaiting(false)
        setIsLoadingFollowUps(true)
        streamingIndexRef.current = -1
        if (data.aichat_uuid) setAichatUuid(data.aichat_uuid)
        isNewChatRef.current = false
        if (wasNewChat) mutateSessions()
      },
      onFollowUps: (data) => {
        setIsLoadingFollowUps(false)
        if (data.follow_up_suggestions?.length) setFollowUps(data.follow_up_suggestions)
      },
      onSessionTitle: () => { mutateSessions() },
      onError: (msg) => {
        setIsStreaming(false)
        setIsWaiting(false)
        setIsLoadingFollowUps(false)
        streamingIndexRef.current = -1
        setError(msg)
      },
    }

    if (aichatUuid) {
      await sendRAGChatStream(message, aichatUuid, accessToken, callbacks, selectedCourse || undefined, chatMode)
    } else {
      await startRAGChatStream(message, accessToken, callbacks, selectedCourse || undefined, chatMode)
    }
  }, [accessToken, aichatUuid, selectedCourse, chatMode, mutateSessions])

  const isInputDisabled = isWaiting || isLoadingSession

  // Animate panel in/out with blur + scale
  const [panelMounted, setPanelMounted] = useState(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      setPanelMounted(true)
      const raf = requestAnimationFrame(() => setPanelVisible(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setPanelVisible(false)
      closeTimerRef.current = setTimeout(() => setPanelMounted(false), 220)
    }
  }, [open])

  return (
    <>
      {/* Floating panel */}
      {panelMounted && (
        <div
          className="fixed bottom-[72px] right-4 z-[9998] flex flex-col bg-white dark:bg-neutral-900 rounded-2xl overflow-hidden nice-shadow"
          style={{
            width: 'min(340px, calc(100vw - 24px))',
            height: 'min(480px, calc(100vh - 110px))',
            opacity: panelVisible ? 1 : 0,
            transform: panelVisible ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(10px)',
            filter: panelVisible ? 'blur(0px)' : 'blur(6px)',
            transformOrigin: 'bottom right',
            transition: 'opacity 0.2s ease, transform 0.2s ease, filter 0.2s ease',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 h-11 border-b border-neutral-100 dark:border-neutral-800/60 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowSessions(!showSessions)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
                title="Conversations"
              >
                <List size={14} />
              </button>
              <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Course Copilot
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleNewChat}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-all"
                title="New chat"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => onOpenChange(false)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Sessions drawer */}
          {showSessions ? (
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <button
                onClick={handleNewChat}
                className="flex items-center gap-2 w-full px-3 py-2 mb-2 text-xs font-semibold rounded-xl bg-violet-600 hover:bg-violet-700 text-white transition-colors"
              >
                <Plus size={13} weight="bold" />
                New Chat
              </button>
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                  <ChatCircleDots size={20} className="text-neutral-300 dark:text-neutral-600 mb-2" />
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">No conversations yet</p>
                </div>
              ) : (
                groupSessionsByDate(sessions).map((group) => (
                  <div key={group.label} className="mb-3">
                    <p className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider px-2 py-1">
                      {group.label}
                    </p>
                    {group.sessions.map((s) => (
                      <SessionItem
                        key={s.aichat_uuid}
                        session={s}
                        isActive={s.aichat_uuid === aichatUuid}
                        onSelect={() => handleLoadSession(s)}
                        onDelete={() => handleDeleteSession(s.aichat_uuid)}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              {/* Messages */}
              <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {isLoadingSession && (
                  <div className="flex flex-col items-center justify-center h-full">
                    <SpinnerGap size={18} className="animate-spin text-violet-400 mb-2" />
                    <span className="text-xs text-neutral-400">Loading...</span>
                  </div>
                )}

                {messages.length === 0 && !isLoadingSession && (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-3 pb-4">
                    <div className="flex items-center justify-center p-2 rounded-xl border border-violet-200 dark:border-violet-500/30">
                      <svg width="28" height="16" viewBox="0 37 304 152" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <linearGradient id="bubble-lrn-grad" x1="152" y1="30" x2="152" y2="200" gradientUnits="userSpaceOnUse">
                            <stop stopColor="#c4b5fd" />
                            <stop offset="1" stopColor="#7c3aed" />
                          </linearGradient>
                        </defs>
                        <path d="M152 37C152 56.9609 148.068 76.7264 140.43 95.1679C132.791 113.609 121.595 130.366 107.48 144.48C93.3657 158.595 76.6094 169.791 58.1679 177.43C39.7264 185.068 19.9609 189 0 189L3.19349e-06 115.941C10.3667 115.941 20.632 113.9 30.2096 109.932C39.7872 105.965 48.4896 100.15 55.82 92.82C63.1504 85.4896 68.9652 76.7872 72.9324 67.2096C76.8996 57.632 78.9414 47.3667 78.9414 37H152Z" fill="url(#bubble-lrn-grad)" />
                        <path d="M304 189C284.039 189 264.274 185.068 245.832 177.43C227.391 169.791 210.634 158.595 196.52 144.48C182.405 130.366 171.209 113.609 163.57 95.1679C155.932 76.7264 152 56.9609 152 37L225.059 37C225.059 47.3667 227.1 57.632 231.068 67.2096C235.035 76.7872 240.85 85.4896 248.18 92.82C255.51 100.15 264.213 105.965 273.79 109.932C283.368 113.9 293.633 115.941 304 115.941V189Z" fill="url(#bubble-lrn-grad)" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Course Copilot</p>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1 leading-relaxed max-w-[230px]">
                        Ask questions about your courses.
                      </p>
                    </div>
                  </div>
                )}

                {!isLoadingSession && messages.map((msg, i) => {
                  if (msg.role === 'user') {
                    return (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 bg-violet-600 text-white">
                          <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    )
                  }
                  const isThisStreaming = i === streamingIndexRef.current && isStreaming
                  return (
                    <AssistantMessage
                      key={i}
                      content={msg.content}
                      sources={msg.sources || []}
                      orgslug={orgslug}
                      isStreaming={isThisStreaming && !!msg.content}
                      isWaiting={isThisStreaming && isWaiting && !msg.content}
                    />
                  )
                })}

                {!isStreaming && !isWaiting && followUps.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {followUps.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(s)}
                        className="group flex items-center gap-1.5 w-fit max-w-full text-left px-2.5 py-1.5 text-[11px] rounded-xl text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:text-violet-700 transition-all"
                      >
                        <ArrowRight size={10} weight="bold" className="flex-shrink-0 text-neutral-400 group-hover:text-violet-500" />
                        <span className="truncate">{s}</span>
                      </button>
                    ))}
                  </div>
                )}

                {error && (
                  <div className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 text-xs">
                    {error}
                  </div>
                )}
              </div>

              {/* Input bar */}
              <div className="flex items-center gap-1 px-2.5 py-2 border-t border-neutral-100 dark:border-neutral-800/60 flex-shrink-0">
                <button
                  onClick={() => setChatMode(chatMode === 'course_only' ? 'general' : 'course_only')}
                  className={`flex items-center gap-1 px-1.5 py-1.5 text-xs rounded-lg transition-all flex-shrink-0 ${
                    chatMode === 'general'
                      ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-600'
                      : 'text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                  }`}
                  title={chatMode === 'general' ? 'General mode' : 'Course only'}
                >
                  {chatMode === 'general' ? <GlobeSimple size={13} weight="duotone" /> : <BookOpen size={13} weight="duotone" />}
                </button>

                {messages.length > 0 && (
                  <div className="relative flex-shrink-0" ref={dropdownRef}>
                    <button
                      onClick={() => setCourseDropdownOpen(!courseDropdownOpen)}
                      className="flex items-center gap-0.5 px-1.5 py-1.5 text-xs rounded-lg text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
                    >
                      {selectedCourse ? <Books size={13} weight="duotone" className="text-violet-500" /> : <Sparkle size={13} weight="duotone" className="text-violet-500" />}
                      <CaretDown size={8} className={`text-neutral-400 transition-transform ${courseDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {courseDropdownOpen && (
                      <CourseDropdown
                        courses={courses}
                        selectedCourse={selectedCourse}
                        onSelect={(uuid) => { setSelectedCourse(uuid); setCourseDropdownOpen(false) }}
                        position="top"
                      />
                    )}
                  </div>
                )}

                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
                  }}
                  placeholder={isLoadingSession ? 'Loading...' : isWaiting ? 'Thinking...' : 'Ask about your courses...'}
                  disabled={isInputDisabled}
                  className="flex-1 min-w-0 bg-transparent outline-none text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 disabled:opacity-40"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={isInputDisabled || !input.trim()}
                  className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-neutral-200 dark:disabled:bg-neutral-700 disabled:cursor-not-allowed text-white transition-colors"
                >
                  <PaperPlaneRight size={12} weight="fill" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => onOpenChange(!open)}
        className="fixed bottom-4 right-4 z-[9999] flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-700 text-white transition-all duration-200 hover:scale-105 active:scale-95 nice-shadow"
        style={{ width: 44, height: 44 }}
        aria-label="Open Copilot"
      >
        {open ? <X size={18} weight="bold" /> : <ChatCircle size={20} weight="fill" />}
      </button>
    </>
  )
}
