'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  AtlasChatSession,
  AtlasMessage,
  AtlasSession,
  deleteAtlasChatSession,
  listAtlasChatSessions,
  loadAtlasChatMessages,
  revokeAtlasSession,
  startAtlasSession,
  streamAtlasChat,
  updateAtlasChatSession,
} from '@services/ai/atlas'
import {
  AlertTriangle,
  Check,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Star,
  Trash2,
} from 'lucide-react'
import { GlobeStand } from '@phosphor-icons/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'

import PageContextBreadcrumb from './composer/PageContextBreadcrumb'
import QuickActionChips from './composer/QuickActionChips'
import ReferencePicker from './composer/ReferencePicker'

// ─── design tokens ────────────────────────────────────────────────────────

const ATLAS_GRADIENT =
  'linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.35) 100%), ' +
  'radial-gradient(120% 110% at 50% -5%, rgba(139, 92, 246, 0.18) 0%, rgba(0, 0, 0, 0) 55%), ' +
  'rgb(2 1 20 / 100%)'

// ─── types ────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: AtlasMessage['role']
  content: string
}

export type { ChatMessage }

export function persistedToChatMessages(loaded: AtlasMessage[]): ChatMessage[] {
  return loaded.map((m, i) => ({
    id: `p-${i}`,
    role: m.role,
    content: m.content || '',
  }))
}

function groupSessionsByAge(sessions: AtlasChatSession[]): { label: string; items: AtlasChatSession[] }[] {
  const now = Date.now()
  const buckets: { label: string; items: AtlasChatSession[] }[] = [
    { label: 'Favorites', items: [] },
    { label: 'Today', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ]
  const sorted = [...sessions].sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0
    const db = b.created_at ? new Date(b.created_at).getTime() : 0
    return db - da
  })
  for (const s of sorted) {
    if (s.favorite) {
      buckets[0].items.push(s)
      continue
    }
    const t = s.created_at ? new Date(s.created_at).getTime() : 0
    const ageDays = (now - t) / (1000 * 60 * 60 * 24)
    if (ageDays < 1) buckets[1].items.push(s)
    else if (ageDays < 7) buckets[2].items.push(s)
    else buckets[3].items.push(s)
  }
  return buckets.filter((b) => b.items.length > 0)
}

// ─── component ────────────────────────────────────────────────────────────

export default function AtlasChat() {
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const orgId: number | undefined = org?.id

  const [atlasSession, setAtlasSession] = useState<AtlasSession | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const [aichatUuid, setAichatUuid] = useState<string | null>(null)
  const [loadingChat, setLoadingChat] = useState(false)

  const queryClient = useQueryClient()
  const sessionsKey = orgId ? queryKeys.ai.atlasSessions(orgId) : (['ai', 'atlas', 'sessions', 'pending'] as const)
  const { data: chatSessions = [] } = useQuery<AtlasChatSession[]>({
    queryKey: sessionsKey,
    queryFn: () => listAtlasChatSessions(orgId!, accessToken!),
    enabled: !!orgId && !!accessToken,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const invalidateSessions = useCallback(() => {
    if (!orgId) return
    queryClient.invalidateQueries({ queryKey: queryKeys.ai.atlasSessions(orgId) })
  }, [queryClient, orgId])

  const patchSessionsCache = useCallback(
    (updater: (prev: AtlasChatSession[]) => AtlasChatSession[]) => {
      if (!orgId) return
      queryClient.setQueryData<AtlasChatSession[]>(
        queryKeys.ai.atlasSessions(orgId),
        (prev) => updater(prev ?? []),
      )
    },
    [queryClient, orgId],
  )

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // ── session-token lifecycle ────────────────────────────────────────────
  const refreshSession = useCallback(async () => {
    if (!orgId || !accessToken) return
    try {
      const next = await startAtlasSession(orgId, accessToken)
      setAtlasSession(next)
      setSessionError(null)
    } catch (err: any) {
      setSessionError(err?.message || 'Could not start Atlas session.')
    }
  }, [orgId, accessToken])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  useEffect(() => {
    if (!atlasSession?.expires_at) return
    const expiryMs = new Date(atlasSession.expires_at).getTime()
    const refreshAt = expiryMs - 2 * 60 * 1000
    const delay = Math.max(refreshAt - Date.now(), 10_000)
    const t = setTimeout(() => refreshSession(), delay)
    return () => clearTimeout(t)
  }, [atlasSession, refreshSession])

  useEffect(() => {
    return () => {
      if (atlasSession && accessToken) {
        revokeAtlasSession(atlasSession.token_uuid, accessToken).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // ── URL <-> chat sync (?chat=aichat_xxx) ───────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const param = url.searchParams.get('chat')
    if (param && param !== aichatUuid) {
      openChat(param)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncUrl = useCallback((uuid: string | null) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (uuid) url.searchParams.set('chat', uuid)
    else url.searchParams.delete('chat')
    window.history.replaceState({}, '', url.toString())
  }, [])

  const openChat = useCallback(
    async (uuid: string) => {
      if (!accessToken) return
      setLoadingChat(true)
      try {
        const loaded = await loadAtlasChatMessages(uuid, accessToken)
        setMessages(persistedToChatMessages(loaded))
        setAichatUuid(uuid)
        syncUrl(uuid)
      } catch (err: any) {
        setSessionError(err?.message || 'Could not load that chat.')
      } finally {
        setLoadingChat(false)
      }
    },
    [accessToken, syncUrl],
  )

  const startNewChat = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setMessages([])
    setAichatUuid(null)
    setInput('')
    setLoadingChat(false)
    setSessionError(null)
    syncUrl(null)
  }, [syncUrl])

  const removeChat = useCallback(
    async (uuid: string) => {
      if (!accessToken) return
      try {
        await deleteAtlasChatSession(uuid, accessToken)
      } catch {
        /* ignore */
      }
      patchSessionsCache((prev) => prev.filter((s) => s.aichat_uuid !== uuid))
      if (uuid === aichatUuid) {
        startNewChat()
      }
    },
    [accessToken, aichatUuid, startNewChat, patchSessionsCache],
  )

  const renameChat = useCallback(
    async (uuid: string, title: string) => {
      if (!accessToken) return
      await updateAtlasChatSession(uuid, { title }, accessToken)
      patchSessionsCache((prev) =>
        prev.map((s) => (s.aichat_uuid === uuid ? { ...s, title } : s)),
      )
    },
    [accessToken, patchSessionsCache],
  )

  const toggleFavorite = useCallback(
    async (uuid: string, favorite: boolean) => {
      if (!accessToken) return
      await updateAtlasChatSession(uuid, { favorite }, accessToken)
      patchSessionsCache((prev) =>
        prev.map((s) => (s.aichat_uuid === uuid ? { ...s, favorite } : s)),
      )
    },
    [accessToken, patchSessionsCache],
  )

  // ── sending ────────────────────────────────────────────────────────────
  const canSend = !!atlasSession && !!accessToken && !!orgId && !sending && input.trim().length > 0

  const sendMessage = useCallback(
    async (text: string) => {
      if (!atlasSession || !accessToken || !orgId) return
      setInput('')
      setSending(true)

      const controller = new AbortController()
      abortRef.current = controller

      const isNewChat = aichatUuid === null

      try {
        const stream = streamAtlasChat({
          orgId,
          sessionToken: atlasSession.token,
          message: text,
          aichatUuid: aichatUuid ?? undefined,
          accessToken,
          signal: controller.signal,
        })
        for await (const event of stream) {
          if (event.type === 'session') {
            setAichatUuid(event.aichat_uuid)
            syncUrl(event.aichat_uuid)
          }
          // Bubble/answer rendering removed — stream is drained while the
          // new chat UI is being rebuilt on top of this skeleton.
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setSessionError(err?.message || 'Stream failed.')
        }
      } finally {
        setSending(false)
        abortRef.current = null
        if (isNewChat) invalidateSessions()
      }
    },
    [accessToken, aichatUuid, atlasSession, orgId, invalidateSessions, syncUrl],
  )

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    sendMessage(input.trim())
  }

  const stop = () => abortRef.current?.abort()

  // ── layout ──────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-row w-full h-[100svh] text-white gap-3 p-3 md:gap-4 md:p-5"
      style={{ background: ATLAS_GRADIENT }}
    >
      <SessionSidebar
        sessions={chatSessions}
        activeUuid={aichatUuid}
        onOpen={openChat}
        onNew={startNewChat}
        onDelete={removeChat}
        onRename={renameChat}
        onToggleFavorite={toggleFavorite}
        disabled={sending || loadingChat}
      />

      <div
        className={`relative flex flex-col flex-1 min-w-0 bg-white/[0.02] ring-1 ring-inset ring-white/[0.04] rounded-2xl overflow-hidden shadow-xl shadow-black/30 ${
          sending ? 'atlas-loading-border' : ''
        }`}
      >
        {sessionError && (
          <div className="flex-none flex items-center gap-2 bg-rose-500/10 text-rose-200 px-5 py-2 text-xs border-b border-rose-500/20">
            <AlertTriangle size={14} />
            <span className="flex-1">{sessionError}</span>
            <button className="font-semibold underline hover:text-rose-100" onClick={() => refreshSession()}>
              Retry
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto scroll-smooth atlas-scroll"
        >
          {loadingChat ? (
            <div className="h-full min-h-[60vh] flex items-center justify-center text-white/40">
              <Loader2 size={18} className="animate-spin mr-2" />
              Loading chat…
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full min-h-[60vh] flex items-center justify-center">
              <EmptyState onPick={(p) => sendMessage(p)} disabled={!atlasSession} />
            </div>
          ) : (
            <div className="flex-1 min-h-0" />
          )}
        </div>

        <div className="flex-none border-t border-white/[0.04]">
          <PageContextBreadcrumb compact />

          {input.trim().length === 0 && !sending && (
            <QuickActionChips
              onPick={(p) => setInput(p)}
              disabled={!atlasSession}
            />
          )}

          <form onSubmit={onSubmit} className="px-5 py-3 flex items-end gap-2">
            <ReferencePicker />

            <div
              className={`flex-1 rounded-xl bg-white/[0.02] transition-all ${
                sending
                  ? 'atlas-composer-glow'
                  : 'ring-1 ring-inset ring-white/[0.06] focus-within:ring-violet-400/30 focus-within:bg-white/[0.04]'
              }`}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
                placeholder={atlasSession ? 'Ask Atlas to build, edit, or explore…' : 'Starting Atlas…'}
                rows={1}
                className="w-full resize-none bg-transparent outline-none text-sm text-white placeholder:text-white/30 px-3.5 py-2.5 min-h-[40px] max-h-48"
                disabled={!atlasSession}
              />
            </div>
            {sending ? (
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-white/80 ring-1 ring-inset ring-white/10 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors"
              >
                <Loader2 size={14} className="animate-spin" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-violet-400/30 disabled:ring-white/10 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors"
              >
                <Send size={14} />
                Send
              </button>
            )}
          </form>
        </div>
      </div>

      <style jsx>{`
        .atlas-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }
        .atlas-scroll::-webkit-scrollbar { width: 8px; }
        .atlas-scroll::-webkit-scrollbar-track { background: transparent; }
        .atlas-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .atlas-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.2);
        }
        .atlas-composer-glow {
          box-shadow:
            inset 0 0 0 1px rgba(167, 139, 250, 0.45),
            0 0 14px 0 rgba(167, 139, 250, 0.25),
            0 0 28px 0 rgba(167, 139, 250, 0.12);
          animation: atlas-composer-glow 2.4s ease-in-out infinite;
        }
        @keyframes atlas-composer-glow {
          0%, 100% {
            box-shadow:
              inset 0 0 0 1px rgba(167, 139, 250, 0.35),
              0 0 12px 0 rgba(167, 139, 250, 0.18),
              0 0 24px 0 rgba(167, 139, 250, 0.08);
          }
          50% {
            box-shadow:
              inset 0 0 0 1px rgba(167, 139, 250, 0.60),
              0 0 20px 0 rgba(167, 139, 250, 0.38),
              0 0 40px 0 rgba(167, 139, 250, 0.18);
          }
        }
      `}</style>
    </div>
  )
}

// ─── sessions sidebar ─────────────────────────────────────────────────────

function SessionSidebar({
  sessions,
  activeUuid,
  onOpen,
  onNew,
  onDelete,
  onRename,
  onToggleFavorite,
  disabled,
}: {
  sessions: AtlasChatSession[]
  activeUuid: string | null
  onOpen: (uuid: string) => void
  onNew: () => void
  onDelete: (uuid: string) => void
  onRename: (uuid: string, title: string) => Promise<void>
  onToggleFavorite: (uuid: string, favorite: boolean) => Promise<void>
  disabled: boolean
}) {
  const groups = useMemo(() => groupSessionsByAge(sessions), [sessions])
  return (
    <aside className="flex-none w-[260px] hidden md:flex flex-col bg-white/[0.02] ring-1 ring-inset ring-white/[0.04] rounded-2xl overflow-hidden shadow-xl shadow-black/30">
      <div className="flex-none px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-white/40">Chats</span>
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          className="flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/[0.06] rounded-md p-1.5 transition-colors"
          title="New chat"
          aria-label="New chat"
        >
          <Plus size={14} />
        </button>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto atlas-scroll px-2 pb-3">
        {groups.length === 0 ? (
          <p className="text-center text-xs text-white/30 py-6">
            No past chats yet. Say hi on the right to start one.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold px-2 pb-1.5">
                {group.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((s) => (
                  <SessionRow
                    key={s.aichat_uuid}
                    session={s}
                    active={s.aichat_uuid === activeUuid}
                    onOpen={() => onOpen(s.aichat_uuid)}
                    onDelete={() => onDelete(s.aichat_uuid)}
                    onRename={(title) => onRename(s.aichat_uuid, title)}
                    onToggleFavorite={() => onToggleFavorite(s.aichat_uuid, !s.favorite)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
      <style jsx>{`
        .atlas-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
        }
      `}</style>
    </aside>
  )
}

function SessionRow({
  session,
  active,
  onOpen,
  onDelete,
  onRename,
  onToggleFavorite,
}: {
  session: AtlasChatSession
  active: boolean
  onOpen: () => void
  onDelete: () => void
  onRename: (title: string) => Promise<void>
  onToggleFavorite: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)

  useEffect(() => {
    if (!editing) setDraft(session.title)
  }, [editing, session.title])

  const commitRename = async () => {
    const next = draft.trim()
    if (next && next !== session.title) {
      await onRename(next)
    }
    setEditing(false)
  }

  return (
    <li
      className={`group relative rounded-lg transition-colors ${
        active ? 'bg-violet-500/15 ring-1 ring-inset ring-violet-400/25' : 'hover:bg-white/[0.04]'
      }`}
    >
      {editing ? (
        <div className="flex items-center gap-1 px-2 py-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={commitRename}
            className="flex-1 bg-transparent text-sm text-white outline-none ring-1 ring-inset ring-white/10 rounded-md px-2 py-1"
          />
          <button
            className="p-1 text-white/60 hover:text-white"
            onMouseDown={(e) => {
              e.preventDefault()
              commitRename()
            }}
          >
            <Check size={12} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 pr-1">
          <button
            type="button"
            onClick={onOpen}
            className="flex-1 min-w-0 text-left flex items-center gap-2 px-2.5 py-2"
          >
            <MessageCircle
              size={13}
              className={`flex-none ${
                active ? 'text-violet-300' : 'text-white/30 group-hover:text-white/50'
              }`}
            />
            <span
              className={`text-sm truncate flex-1 ${
                active ? 'text-white' : 'text-white/70 group-hover:text-white/90'
              }`}
            >
              {session.title || 'Untitled'}
            </span>
            {session.favorite && !active && (
              <Star
                size={10}
                className="text-amber-300 flex-none group-hover:hidden"
                fill="currentColor"
              />
            )}
          </button>
          <div className="hidden group-hover:flex items-center gap-0.5 flex-none">
            <button
              type="button"
              onClick={onToggleFavorite}
              title={session.favorite ? 'Unfavorite' : 'Favorite'}
              className="p-1 text-white/40 hover:text-amber-300"
            >
              <Star
                size={12}
                fill={session.favorite ? 'currentColor' : 'none'}
                className={session.favorite ? 'text-amber-300' : ''}
              />
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Rename"
              className="p-1 text-white/40 hover:text-white/80"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete "${session.title}"?`)) onDelete()
              }}
              title="Delete"
              className="p-1 text-white/40 hover:text-rose-300"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// ─── empty state ──────────────────────────────────────────────────────────

export function EmptyState({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  const prompts = [
    'Create a course about Python fundamentals with 4 chapters.',
    'Publish every activity in my DNS course.',
    'Add a quiz about DNS records to the "What is DNS?" activity.',
    'Show me my 5 most recently updated courses.',
  ]
  return (
    <div className="flex flex-col items-center p-10 gap-6 text-center max-w-xl">
      <div className="bg-white/5 ring-1 ring-inset ring-white/10 p-4 rounded-2xl">
        <GlobeStand size={32} weight="duotone" className="text-violet-300" />
      </div>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-white/90 tracking-tight">
          Ask me to build or edit a course.
        </p>
        <p className="text-sm text-white/50 leading-relaxed max-w-sm mx-auto">
          I focus one course at a time and work by name — no UUIDs to copy.
          Creating, renaming, publishing, reordering, writing content, adding
          quizzes: just say it.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-md">
        {prompts.map((p) => (
          <button
            key={p}
            disabled={disabled}
            onClick={() => onPick(p)}
            className="text-left text-sm bg-white/[0.03] hover:bg-white/[0.06] ring-1 ring-inset ring-white/10 hover:ring-white/20 disabled:opacity-40 rounded-xl px-4 py-2.5 text-white/75 hover:text-white/95 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
