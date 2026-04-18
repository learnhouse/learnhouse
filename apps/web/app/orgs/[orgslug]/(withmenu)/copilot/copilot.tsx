'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  startRAGChatStream,
  sendRAGChatStream,
  StreamCallbacks,
  StreamSourceData,
  fetchRAGChatSessions,
  fetchRAGChatMessages,
  deleteRAGChatSession,
  updateRAGChatSession,
  RAGChatSession,
} from '@services/ai/ai'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useSWR from 'swr'
import {
  PaperPlaneRight,
  CaretDown,
  BookOpen,
  SpinnerGap,
  Sparkle,
  ArrowRight,
  CaretRight,
  Books,
  Plus,
  Trash,
  ChatCircleDots,
  List,
  X,
  Star,
  PencilSimple,
  Check,
  GlobeSimple,
} from '@phosphor-icons/react'
import Link from 'next/link'

export type CopilotProps = {
  orgslug: string
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  sources?: StreamSourceData['sources']
}

export default function Copilot({ orgslug }: CopilotProps) {
  return (
    <AuthenticatedClientElement checkMethod="authentication">
      <CopilotChat orgslug={orgslug} />
    </AuthenticatedClientElement>
  )
}

export function groupSessionsByDate(sessions: RAGChatSession[]) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const groups: { label: string; sessions: RAGChatSession[] }[] = [
    { label: 'Favorites', sessions: [] },
    { label: 'Today', sessions: [] },
    { label: 'Previous 7 days', sessions: [] },
    { label: 'Older', sessions: [] },
  ]

  for (const s of sessions) {
    if (s.favorite) {
      groups[0].sessions.push(s)
      continue
    }
    const d = new Date(s.created_at)
    if (d >= todayStart) groups[1].sessions.push(s)
    else if (d >= weekAgo) groups[2].sessions.push(s)
    else groups[3].sessions.push(s)
  }

  return groups.filter((g) => g.sessions.length > 0)
}

export function CopilotChat({ orgslug }: CopilotProps) {
  const session = useLHSession() as any
  const org = useOrg() as any
  const accessToken = session?.data?.tokens?.access_token
  const searchParams = useSearchParams()
  const initialChatUuid = searchParams.get('chat')

  // All messages including the current streaming one (appended live)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [aichatUuid, setAichatUuid] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null)
  const [followUps, setFollowUps] = useState<string[]>([])
  const [isLoadingFollowUps, setIsLoadingFollowUps] = useState(false)
  const [chatMode, setChatMode] = useState<'course_only' | 'general'>('course_only')
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isMobileRef = useRef(false)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null)
  const [currentSessionFavorite, setCurrentSessionFavorite] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // Index of the assistant message currently being streamed
  const streamingIndexRef = useRef<number>(-1)
  // Track whether this is a new chat (no session yet) so we can refresh sidebar after first response
  const isNewChatRef = useRef(true)

  // Sessions list via SWR
  const {
    data: sessionsData,
    mutate: mutateSessions,
  } = useSWR(
    accessToken && orgslug ? ['rag-sessions', orgslug] : null,
    () => fetchRAGChatSessions(accessToken, orgslug),
    { revalidateOnFocus: false }
  )
  const sessions: RAGChatSession[] = sessionsData || []

  const { data: coursesData } = useSWR(
    org?.slug ? `${getAPIUrl()}courses/org_slug/${org.slug}/page/1/limit/100` : null,
    (url: string) => swrFetcher(url, accessToken)
  )
  const courses = coursesData?.data || coursesData || []

  const selectedCourseName = selectedCourse
    ? courses.find?.((c: any) => c.course_uuid === selectedCourse)?.name || 'Selected Course'
    : 'All courses'

  // Track viewport size for mobile behavior
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768
      isMobileRef.current = mobile
      // Open sidebar by default on desktop only (on first mount)
      if (!mobile && !isMobileRef.current) setSidebarOpen(true)
    }
    checkMobile()
    // Open sidebar on desktop on mount
    if (window.innerWidth >= 768) setSidebarOpen(true)
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    if (messages.length > 0 && messagesContainerRef.current) {
      const container = messagesContainerRef.current
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCourseDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setAichatUuid(null)
    setFollowUps([])
    setError(null)
    setIsLoadingFollowUps(false)
    setCurrentSessionTitle(null)
    setCurrentSessionFavorite(false)
    setChatMode('course_only')
    isNewChatRef.current = true
    if (isMobileRef.current) setSidebarOpen(false)
    inputRef.current?.focus()
  }, [])

  const handleLoadSession = useCallback(async (sessionMeta: RAGChatSession) => {
    if (!accessToken || sessionMeta.aichat_uuid === aichatUuid) return

    setIsLoadingSession(true)
    setMessages([])
    setError(null)
    setFollowUps([])
    setIsLoadingFollowUps(false)
    setCurrentSessionTitle(sessionMeta.title)
    setCurrentSessionFavorite(sessionMeta.favorite || false)

    // Close sidebar on mobile when selecting a session
    if (isMobileRef.current) setSidebarOpen(false)

    try {
      const msgs = await fetchRAGChatMessages(sessionMeta.aichat_uuid, accessToken)
      const chatMessages: ChatMessage[] = msgs.map((m: any) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
        ...(m.sources ? { sources: m.sources } : {}),
      }))
      setMessages(chatMessages)
      setAichatUuid(sessionMeta.aichat_uuid)
      setSelectedCourse(sessionMeta.course_uuid || null)
      setChatMode(sessionMeta.mode || 'course_only')
      isNewChatRef.current = false
    } catch {
      setError('Failed to load session')
    } finally {
      setIsLoadingSession(false)
    }
  }, [accessToken, aichatUuid])

  // Auto-load session from ?chat= URL parameter
  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (initialLoadDone.current || !initialChatUuid || !accessToken || !sessions.length) return
    const target = sessions.find((s) => s.aichat_uuid === initialChatUuid)
    if (target) {
      initialLoadDone.current = true
      handleLoadSession(target)
    }
  }, [initialChatUuid, accessToken, sessions, handleLoadSession])

  const handleDeleteSession = useCallback(async (uuid: string) => {
    if (!accessToken) return
    await deleteRAGChatSession(uuid, accessToken)
    mutateSessions()
    // If deleting the active session, reset to new chat
    if (uuid === aichatUuid) {
      handleNewChat()
    }
  }, [accessToken, aichatUuid, mutateSessions, handleNewChat])

  const handleRenameSession = useCallback(async (newTitle: string) => {
    if (!accessToken || !aichatUuid || !newTitle.trim()) return
    const updated = await updateRAGChatSession(aichatUuid, accessToken, { title: newTitle.trim() })
    if (updated) {
      setCurrentSessionTitle(updated.title)
      mutateSessions()
    }
  }, [accessToken, aichatUuid, mutateSessions])

  const handleToggleFavorite = useCallback(async () => {
    if (!accessToken || !aichatUuid) return
    const newFav = !currentSessionFavorite
    const updated = await updateRAGChatSession(aichatUuid, accessToken, { favorite: newFav })
    if (updated) {
      setCurrentSessionFavorite(updated.favorite || false)
      mutateSessions()
    }
  }, [accessToken, aichatUuid, currentSessionFavorite, mutateSessions])

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim() || !accessToken) return

    setError(null)
    setFollowUps([])
    setIsLoadingFollowUps(false)

    // Add user message + empty assistant placeholder
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
      onStart: (data) => {
        setIsWaiting(false)
        if (data.aichat_uuid) setAichatUuid(data.aichat_uuid)
      },
      onChunk: (chunk) => {
        // Append chunk to the assistant placeholder message
        setMessages((prev) => {
          const idx = streamingIndexRef.current
          if (idx < 0 || idx >= prev.length) return prev
          const updated = [...prev]
          updated[idx] = { ...updated[idx], content: updated[idx].content + chunk }
          return updated
        })
      },
      onSources: (data) => {
        // Capture index NOW, before onComplete can reset it to -1
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
        // Refresh sidebar after first response in a new chat
        if (wasNewChat) {
          // Set title from first user message
          const firstMsg = message.length > 50 ? message.slice(0, 50) + '...' : message
          setCurrentSessionTitle(firstMsg)
          setCurrentSessionFavorite(false)
          mutateSessions()
        }
      },
      onFollowUps: (data) => {
        setIsLoadingFollowUps(false)
        if (data.follow_up_suggestions?.length) setFollowUps(data.follow_up_suggestions)
      },
      onSessionTitle: (title) => {
        setCurrentSessionTitle(title)
        mutateSessions()
      },
      onError: (errorMsg) => {
        setIsStreaming(false)
        setIsWaiting(false)
        setIsLoadingFollowUps(false)
        streamingIndexRef.current = -1
        setError(errorMsg)
      },
    }

    if (aichatUuid) {
      await sendRAGChatStream(message, aichatUuid, accessToken, callbacks, selectedCourse || undefined, chatMode, orgslug)
    } else {
      await startRAGChatStream(message, accessToken, callbacks, selectedCourse || undefined, chatMode, orgslug)
    }
  }, [accessToken, aichatUuid, selectedCourse, chatMode, mutateSessions, orgslug])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  // Input is only disabled while waiting for the first chunk or loading a past session.
  // Once streaming starts, the user can already type their next message.
  const isInputDisabled = isWaiting || isLoadingSession

  return (
    <div className="flex h-[calc(100vh-72px)] w-full max-w-(--breakpoint-2xl) mx-auto px-2 sm:px-4 md:px-6 lg:px-8">
      {/* Sidebar — overlay on mobile, inline on desktop */}
      {sidebarOpen && (
      <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
        <div className="fixed inset-y-0 start-0 z-50 w-[280px] p-3 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:my-5 md:me-3 md:p-0">
          <div className="flex flex-col h-full w-full bg-white dark:bg-neutral-900 rounded-2xl nice-shadow overflow-hidden md:mt-0 mt-[72px]">
            {/* Sidebar header */}
            <div className="flex items-center justify-between h-12 px-4 border-b border-neutral-100 dark:border-neutral-800/60">
              <button
                onClick={handleNewChat}
                className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
              >
                <Plus size={14} weight="bold" />
                <span>New Chat</span>
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
              >
                <X size={15} />
              </button>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                  <ChatCircleDots size={24} className="text-neutral-300 dark:text-neutral-600 mb-2" />
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">No conversations yet</p>
                </div>
              ) : (
                groupSessionsByDate(sessions).map((group) => (
                  <div key={group.label} className="mb-3">
                    <p className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider px-2 py-1.5">
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
          </div>
        </div>
      </>
      )}

      {/* Toggle sidebar button (when closed, desktop only — mobile uses top bar button) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="hidden md:flex flex-shrink-0 self-start mt-5 me-2 p-2 rounded-xl bg-white dark:bg-neutral-900 nice-shadow text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
        >
          <List size={16} />
        </button>
      )}

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0 my-3 md:my-5 bg-white dark:bg-neutral-900 rounded-2xl nice-shadow overflow-hidden">
        {/* Top bar */}
        {(aichatUuid && currentSessionTitle) ? (
          <ChatTopBar
            title={currentSessionTitle}
            isFavorite={currentSessionFavorite}
            onRename={handleRenameSession}
            onToggleFavorite={handleToggleFavorite}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            showMenuButton
          />
        ) : (
          <div className="flex items-center h-12 px-4 border-b border-neutral-100 dark:border-neutral-800/60 md:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
            >
              <List size={18} />
            </button>
          </div>
        )}

        {/* Scrollable messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 sm:px-6 lg:px-10 py-6 md:py-8 space-y-4">
          {/* Loading session */}
          {isLoadingSession && (
            <div className="flex flex-col items-center justify-center h-full">
              <SpinnerGap size={20} className="animate-spin text-violet-400 mb-2" />
              <span className="text-sm text-neutral-400 dark:text-neutral-500">Loading conversation...</span>
            </div>
          )}

          {/* Empty state */}
          {messages.length === 0 && !isLoadingSession && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-6 pb-10">
              <div className="flex items-center justify-center p-3 rounded-xl border border-violet-300 dark:border-violet-500/40">
              <svg width="40" height="22" viewBox="0 37 304 152" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="lrn-icon-grad" x1="152" y1="30" x2="152" y2="200" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#c4b5fd" />
                    <stop offset="1" stopColor="#7c3aed" />
                  </linearGradient>
                </defs>
                <path d="M152 37C152 56.9609 148.068 76.7264 140.43 95.1679C132.791 113.609 121.595 130.366 107.48 144.48C93.3657 158.595 76.6094 169.791 58.1679 177.43C39.7264 185.068 19.9609 189 0 189L3.19349e-06 115.941C10.3667 115.941 20.632 113.9 30.2096 109.932C39.7872 105.965 48.4896 100.15 55.82 92.82C63.1504 85.4896 68.9652 76.7872 72.9324 67.2096C76.8996 57.632 78.9414 47.3667 78.9414 37H152Z" fill="url(#lrn-icon-grad)" />
                <path d="M304 189C284.039 189 264.274 185.068 245.832 177.43C227.391 169.791 210.634 158.595 196.52 144.48C182.405 130.366 171.209 113.609 163.57 95.1679C155.932 76.7264 152 56.9609 152 37L225.059 37C225.059 47.3667 227.1 57.632 231.068 67.2096C235.035 76.7872 240.85 85.4896 248.18 92.82C255.51 100.15 264.213 105.965 273.79 109.932C283.368 113.9 293.633 115.941 304 115.941V189Z" fill="url(#lrn-icon-grad)" />
              </svg>
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-neutral-900 dark:text-white">Course Copilot</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-md leading-relaxed">
                  Ask questions about your courses and get answers grounded in course content, with references to the source material.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Mode toggle */}
                <div className="flex items-center rounded-xl bg-neutral-50 dark:bg-neutral-800 nice-shadow p-0.5">
                  <button
                    onClick={() => setChatMode('course_only')}
                    className={`flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-all ${
                      chatMode === 'course_only'
                        ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                        : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
                    }`}
                  >
                    <BookOpen size={15} weight="duotone" />
                    <span>Course Only</span>
                  </button>
                  <button
                    onClick={() => setChatMode('general')}
                    className={`flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-all ${
                      chatMode === 'general'
                        ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                        : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
                    }`}
                  >
                    <GlobeSimple size={15} weight="duotone" />
                    <span>General</span>
                  </button>
                </div>
                {/* Course picker */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setCourseDropdownOpen(!courseDropdownOpen)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium rounded-xl bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 nice-shadow transition-all"
                  >
                    {selectedCourse ? <Books size={17} weight="duotone" className="text-violet-500" /> : <Sparkle size={17} weight="duotone" className="text-violet-500" />}
                    <span>{selectedCourseName}</span>
                    <CaretDown size={13} className={`text-neutral-400 transition-transform ${courseDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {courseDropdownOpen && <CourseDropdown courses={courses} selectedCourse={selectedCourse} onSelect={(uuid) => { setSelectedCourse(uuid); setCourseDropdownOpen(false) }} />}
                </div>
              </div>
            </div>
          )}

          {/* All messages (user + assistant, including the live-streaming one) */}
          {!isLoadingSession && messages.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-se-sm px-4 py-2.5 bg-violet-600 text-white nice-shadow">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              )
            }

            const isThisStreaming = i === streamingIndexRef.current && isStreaming
            const showWaiting = isThisStreaming && isWaiting && !msg.content
            const showContent = msg.content.length > 0

            return (
              <AssistantMessage
                key={i}
                content={msg.content}
                sources={msg.sources || []}
                orgslug={orgslug}
                isStreaming={isThisStreaming && showContent}
                isWaiting={showWaiting}
              />
            )
          })}

          {/* Follow-ups */}
          {!isStreaming && !isWaiting && (isLoadingFollowUps || followUps.length > 0) && (
            <div className="space-y-2 pt-1">
              {followUps.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {followUps.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s)}
                      className="group flex items-center gap-2.5 w-fit max-w-full text-start px-3.5 py-2.5 text-[13px] rounded-xl text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-300 nice-shadow transition-all"
                    >
                      <ArrowRight size={13} weight="bold" className="flex-shrink-0 text-neutral-400 group-hover:text-violet-500 transition-colors rtl:-scale-x-100" />
                      <span className="truncate">{s}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 animate-pulse">
                      <div className="w-3 h-3 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                      <div className={`h-3 rounded-md bg-neutral-200 dark:bg-neutral-700 ${i === 1 ? 'w-48' : i === 2 ? 'w-56' : 'w-40'}`} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm nice-shadow">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-3 border-t border-neutral-100 dark:border-neutral-800/60">
          {/* Mode toggle */}
          <button
            onClick={() => setChatMode(chatMode === 'course_only' ? 'general' : 'course_only')}
            className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg transition-all ${
              chatMode === 'general'
                ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400'
                : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
            }`}
            title={chatMode === 'general' ? 'General Knowledge mode' : 'Course Only mode'}
          >
            {chatMode === 'general' ? <GlobeSimple size={13} weight="duotone" /> : <BookOpen size={13} weight="duotone" />}
            <span className="hidden sm:inline">{chatMode === 'general' ? 'General' : 'Course'}</span>
          </button>
          {messages.length > 0 && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setCourseDropdownOpen(!courseDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
              >
                {selectedCourse ? <Books size={13} weight="duotone" className="text-violet-500" /> : <Sparkle size={13} weight="duotone" className="text-violet-500" />}
                <CaretDown size={10} className={`text-neutral-400 transition-transform ${courseDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {courseDropdownOpen && <CourseDropdown courses={courses} selectedCourse={selectedCourse} onSelect={(uuid) => { setSelectedCourse(uuid); setCourseDropdownOpen(false) }} position="top" />}
            </div>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Ask about your courses"
            placeholder={isLoadingSession ? 'Loading conversation...' : isWaiting ? 'Thinking...' : chatMode === 'general' ? 'Ask anything...' : 'Ask about your courses...'}
            disabled={isInputDisabled}
            className="flex-1 bg-transparent outline-none text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 disabled:opacity-40"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isInputDisabled || !input.trim()}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-neutral-200 dark:disabled:bg-neutral-700 disabled:cursor-not-allowed text-white transition-colors"
          >
            <PaperPlaneRight size={14} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function ChatTopBar({ title, isFavorite, onRename, onToggleFavorite, onToggleSidebar, showMenuButton }: {
  title: string
  isFavorite: boolean
  onRename: (newTitle: string) => void
  onToggleFavorite: () => void
  onToggleSidebar?: () => void
  showMenuButton?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditValue(title)
  }, [title])

  useEffect(() => {
    if (isEditing) editInputRef.current?.focus()
  }, [isEditing])

  const handleSubmit = () => {
    if (editValue.trim() && editValue.trim() !== title) {
      onRename(editValue.trim())
    } else {
      setEditValue(title)
    }
    setIsEditing(false)
  }

  return (
    <div className="flex items-center gap-3 h-12 px-4 md:px-5 border-b border-neutral-100 dark:border-neutral-800/60">
      {showMenuButton && onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="md:hidden flex-shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
        >
          <List size={18} />
        </button>
      )}
      {isEditing ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') { setEditValue(title); setIsEditing(false) }
            }}
            onBlur={handleSubmit}
            className="flex-1 min-w-0 bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-900 dark:text-white outline-none ring-1 ring-violet-300 dark:ring-violet-500/40"
            maxLength={80}
          />
          <button
            onClick={handleSubmit}
            className="p-1 rounded-md text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-all"
          >
            <Check size={15} weight="bold" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1 min-w-0 group">
          <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
            {title}
          </h3>
          <button
            onClick={() => setIsEditing(true)}
            className="flex-shrink-0 p-1 rounded-md text-neutral-300 dark:text-neutral-600 opacity-0 group-hover:opacity-100 hover:text-neutral-500 dark:hover:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
          >
            <PencilSimple size={13} />
          </button>
        </div>
      )}

      <button
        onClick={onToggleFavorite}
        className={`flex-shrink-0 p-1.5 rounded-lg transition-all ${
          isFavorite
            ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10'
            : 'text-neutral-300 dark:text-neutral-600 hover:text-amber-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
        }`}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star size={16} weight={isFavorite ? 'fill' : 'regular'} />
      </button>
    </div>
  )
}

export function SessionItem({ session, isActive, onSelect, onDelete }: {
  session: RAGChatSession
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group w-full text-start px-3 py-2 rounded-xl text-sm transition-all flex items-center gap-2 ${
        isActive
          ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium'
          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/60'
      }`}
    >
      {session.favorite ? (
        <Star size={13} weight="fill" className="flex-shrink-0 text-amber-500" />
      ) : (
        <ChatCircleDots size={14} weight={isActive ? 'fill' : 'regular'} className="flex-shrink-0 text-neutral-400 dark:text-neutral-500" />
      )}
      <span className="truncate flex-1">{session.title}</span>
      {hovered && (
        <span
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="flex-shrink-0 p-1 rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
        >
          <Trash size={13} />
        </span>
      )}
    </button>
  )
}

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

export function AssistantMessage({ content, sources, orgslug, isStreaming, isWaiting }: {
  content: string
  sources: StreamSourceData['sources']
  orgslug: string
  isStreaming?: boolean
  isWaiting?: boolean
}) {
  const courseNames = [...new Set(sources.map((s) => s.course_name).filter(Boolean))]

  return (
    <div className="space-y-1.5">
      {/* Source course intro line */}
      {courseNames.length > 0 && !isWaiting && (
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 dark:text-neutral-500 font-medium">
          <BookOpen size={11} weight="bold" className="text-violet-400" />
          <span>Answering from {courseNames.join(', ')}</span>
        </div>
      )}

      {/* Message bubble — full width, relative for badge positioning */}
      <div className="relative rounded-2xl px-4 py-3 bg-neutral-50 dark:bg-neutral-800/60 nice-shadow">
        {isWaiting ? (
          <ThinkingIndicator />
        ) : (
          <CopilotMarkdown content={content} sources={sources} orgslug={orgslug} isStreaming={isStreaming} />
        )}
      </div>

      {/* Compact sources at bottom */}
      {sources.length > 0 && !isWaiting && (
        <SourcesCompact sources={sources} orgslug={orgslug} />
      )}
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
    </div>
  )
}

/**
 * Render a single citation badge [N] as a clickable link to the source activity.
 */
function CitationBadge({ num, sources, orgslug }: { num: number; sources: StreamSourceData['sources']; orgslug: string }) {
  const source = sources[num - 1]
  if (!source) {
    return (
      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-md bg-neutral-100 dark:bg-neutral-700 text-[10px] font-bold text-neutral-400 dark:text-neutral-500 align-middle mx-0.5">
        {num}
      </span>
    )
  }

  const courseId = source.course_uuid?.replace(/^course_/, '') || ''
  const activityId = source.activity_uuid?.replace(/^activity_/, '') || ''
  const href = activityId && courseId
    ? getUriWithOrg(orgslug, `/course/${courseId}/activity/${activityId}`)
    : null

  const badge = (
    <span
      className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-md bg-violet-100 dark:bg-violet-500/15 text-[10px] font-bold text-violet-600 dark:text-violet-400 align-middle mx-0.5 hover:bg-violet-200 dark:hover:bg-violet-500/25 cursor-pointer transition-colors"
      title={[source.course_name, source.chapter_name, source.activity_name].filter(Boolean).join(' > ')}
    >
      {num}
    </span>
  )

  if (href) {
    return <Link href={href} target="_blank" className="no-underline">{badge}</Link>
  }
  return badge
}

/**
 * Parse text content and replace [N] or [N, M] citation patterns with CitationBadge components.
 * Returns an array of strings and React elements.
 */
function renderCitationsInText(text: string, sources: StreamSourceData['sources'], orgslug: string): React.ReactNode[] {
  // Match [1], [2], [3, 1], [1,2,3], etc.
  const citationRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = citationRegex.exec(text)) !== null) {
    // Add text before the citation
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    // Parse the numbers inside brackets
    const nums = match[1].split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n))
    for (let i = 0; i < nums.length; i++) {
      parts.push(
        <CitationBadge key={`${match.index}-${nums[i]}`} num={nums[i]} sources={sources} orgslug={orgslug} />
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

export function CopilotMarkdown({ content, sources = [], orgslug, isStreaming = false }: {
  content: string
  sources?: StreamSourceData['sources']
  orgslug: string
  isStreaming?: boolean
}) {
  // Custom components to intercept text nodes and render citations
  const components = React.useMemo(() => {
    // Helper: wrap children, replacing any string children that contain [N] patterns
    function processChildren(children: React.ReactNode): React.ReactNode {
      return React.Children.map(children, (child) => {
        if (typeof child === 'string') {
          const rendered = renderCitationsInText(child, sources, orgslug)
          // If no citations found, return string as-is
          if (rendered.length === 1 && typeof rendered[0] === 'string') return child
          return <>{rendered}</>
        }
        return child
      })
    }

    return {
      p: ({ children, ...props }: any) => <p {...props}>{processChildren(children)}</p>,
      li: ({ children, ...props }: any) => <li {...props}>{processChildren(children)}</li>,
      td: ({ children, ...props }: any) => <td {...props}>{processChildren(children)}</td>,
      th: ({ children, ...props }: any) => <th {...props}>{processChildren(children)}</th>,
      strong: ({ children, ...props }: any) => <strong {...props}>{processChildren(children)}</strong>,
      em: ({ children, ...props }: any) => <em {...props}>{processChildren(children)}</em>,
      blockquote: ({ children, ...props }: any) => (
        <div className="not-prose my-2 px-3.5 py-2.5 rounded-lg bg-neutral-200/60 dark:bg-neutral-700/70 text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed" {...props}>
          {children}
        </div>
      ),
    }
  }, [sources, orgslug])

  return (
    <div className="relative z-10 prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:text-neutral-700 dark:prose-p:text-neutral-300 prose-headings:text-neutral-900 dark:prose-headings:text-white prose-a:text-violet-600 dark:prose-a:text-violet-400 prose-strong:text-neutral-900 dark:prose-strong:text-white prose-code:text-violet-700 dark:prose-code:text-violet-300 prose-code:bg-violet-50 dark:prose-code:bg-violet-500/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-0.5 h-4 bg-violet-500 ms-0.5 align-middle rounded-full animate-pulse" />
      )}
    </div>
  )
}

export function CourseDropdown({ courses, selectedCourse, onSelect, position = 'bottom' }: {
  courses: any[]
  selectedCourse: string | null
  onSelect: (uuid: string | null) => void
  position?: 'top' | 'bottom'
}) {
  const positionClass = position === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
  return (
    <div className={`absolute start-0 ${positionClass} w-72 max-h-72 overflow-y-auto rounded-xl bg-white dark:bg-neutral-900 nice-shadow z-50 py-1`}>
      <button
        onClick={() => onSelect(null)}
        className={`w-full text-start px-3.5 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2.5 ${
          !selectedCourse ? 'text-violet-600 dark:text-violet-400 font-medium bg-violet-50/60 dark:bg-violet-500/10' : 'text-neutral-700 dark:text-neutral-300'
        }`}
      >
        <Sparkle size={15} weight="duotone" className="text-violet-500 flex-shrink-0" />
        <span>All courses</span>
      </button>
      <div className="h-px bg-neutral-100 dark:bg-neutral-800 mx-2 my-1" />
      {Array.isArray(courses) && courses.map((course: any) => (
        <button
          key={course.course_uuid}
          onClick={() => onSelect(course.course_uuid)}
          className={`w-full text-start px-3.5 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2.5 ${
            selectedCourse === course.course_uuid
              ? 'text-violet-600 dark:text-violet-400 font-medium bg-violet-50/60 dark:bg-violet-500/10'
              : 'text-neutral-700 dark:text-neutral-300'
          }`}
        >
          <Books size={15} weight="duotone" className="text-neutral-400 flex-shrink-0" />
          <span className="truncate">{course.name}</span>
        </button>
      ))}
    </div>
  )
}

export function SourcesCompact({ sources, orgslug }: { sources: StreamSourceData['sources']; orgslug: string }) {
  return (
    <div className="relative z-10 flex flex-wrap gap-x-3 gap-y-1 px-1">
      {sources.map((source, i) => {
        const courseId = source.course_uuid?.replace(/^course_/, '') || ''
        const activityId = source.activity_uuid?.replace(/^activity_/, '') || ''
        const href = activityId && courseId
          ? getUriWithOrg(orgslug, `/course/${courseId}/activity/${activityId}`)
          : null

        const inner = (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 dark:text-neutral-500 hover:text-violet-600 dark:hover:text-violet-400 transition-colors group">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-violet-100 dark:bg-violet-500/15 text-[9px] font-bold text-violet-600 dark:text-violet-400 flex-shrink-0">
              {i + 1}
            </span>
            <span className="truncate max-w-xs font-medium text-neutral-500 dark:text-neutral-400 group-hover:text-violet-600 dark:group-hover:text-violet-400">
              {source.activity_name || 'Unknown'}
            </span>
          </span>
        )

        if (href) {
          return <Link key={i} href={href} target="_blank">{inner}</Link>
        }
        return <span key={i}>{inner}</span>
      })}
    </div>
  )
}
