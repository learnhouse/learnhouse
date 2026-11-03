'use client'

/**
 * One live connection per tab for Messages: holds the SSE stream, keeps the
 * react-query caches for conversations and messages in sync with events, and
 * tracks the ephemeral bits (presence, typing, agent progress) that never hit
 * the cache. Mounted once per org page tree; renders children untouched when
 * messaging is off for the org.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { TooltipProvider } from '@components/ui/tooltip'
import {
  AgentSource,
  ChatMessage,
  Conversation,
  MessagingEvent,
  MyStatus,
  Presence,
  UserSummary,
  conversationTitle,
  displayName,
  listConversations,
  openMessagingStream,
} from '@services/messaging/messaging'
import { openInDock } from '@components/Messaging/Dock/dockBus'

export const messagingKeys = {
  all: (orgId: number) => ['messaging', orgId] as const,
  conversations: (orgId: number) => ['messaging', orgId, 'conversations'] as const,
  messages: (uuid: string) => ['messaging', 'messages', uuid] as const,
  agents: (orgId: number) => ['messaging', orgId, 'agents'] as const,
  me: (orgId: number) => ['messaging', orgId, 'me'] as const,
  directory: (orgId: number, q: string) => ['messaging', orgId, 'directory', q] as const,
}

export type MessagesPage = { messages: ChatMessage[]; has_more: boolean }

export type AgentProgress = {
  phase: 'searching' | 'found' | 'writing'
  courses?: number
  sources?: AgentSource[]
  query?: string
}

type TypingEntry = { user: UserSummary; until: number }

type Listener = (event: MessagingEvent) => void

type MessagingContextValue = {
  enabled: boolean
  connected: boolean
  orgId: number | undefined
  userId: number | undefined
  token: string | undefined
  me: MyStatus | null
  setMe: (me: MyStatus) => void
  presence: Record<number, Presence>
  onlineIds: Set<number>
  typing: Record<string, TypingEntry[]>
  agentProgress: Record<number, AgentProgress>
  unreadTotal: number
  /** Mark a conversation as on screen (page or dock window); returns the release. */
  markVisible: (uuid: string) => () => void
  subscribe: (fn: Listener) => () => void
}

const MessagingContext = createContext<MessagingContextValue | null>(null)

export function useMessagingEnabled(): boolean {
  const org = useOrg() as any
  return Boolean(org?.config?.config?.resolved_features?.messaging?.enabled)
}

export function useMessaging(): MessagingContextValue {
  const ctx = useContext(MessagingContext)
  if (!ctx) {
    return {
      enabled: false,
      connected: false,
      orgId: undefined,
      userId: undefined,
      token: undefined,
      me: null,
      setMe: () => {},
      presence: {},
      onlineIds: new Set(),
      typing: {},
      agentProgress: {},
      unreadTotal: 0,
      markVisible: () => () => {},
      subscribe: () => () => {},
    }
  }
  return ctx
}

/* ------------------------------------------------------------------------ */
/* Cache updates                                                            */
/* ------------------------------------------------------------------------ */

/** Server ids ascending; optimistic (negative id) messages stay at the end. */
export function messageOrder(a: ChatMessage, b: ChatMessage) {
  const key = (m: ChatMessage) => (m.id < 0 ? Number.MAX_SAFE_INTEGER + m.id : m.id)
  return key(a) - key(b)
}

function upsertMessage(qc: QueryClient, uuid: string, message: ChatMessage) {
  qc.setQueryData<MessagesPage>(messagingKeys.messages(uuid), (page) => {
    if (!page) return page
    const idx = page.messages.findIndex((m) => m.id === message.id)
    if (idx === -1) {
      // The live echo of a message this tab is still sending replaces its
      // optimistic copy, so it never shows twice.
      const senderId = message.sender?.type === 'user' ? message.sender.id : null
      let replaced = false
      const kept = page.messages.filter((m) => {
        if (replaced || m.id >= 0 || senderId === null) return true
        const sameAuthor = m.sender?.type === 'user' && m.sender.id === senderId
        if (sameAuthor && m.content === message.content && !(m as any)._local?.startsWith?.('failed')) {
          replaced = true
          return false
        }
        return true
      })
      const messages = [...kept, message].sort(messageOrder)
      return { ...page, messages }
    }
    const messages = page.messages.slice()
    messages[idx] = message
    return { ...page, messages }
  })
}

function patchMessage(qc: QueryClient, uuid: string, match: (m: ChatMessage) => boolean, patch: (m: ChatMessage) => ChatMessage) {
  qc.setQueryData<MessagesPage>(messagingKeys.messages(uuid), (page) => {
    if (!page) return page
    let changed = false
    const messages = page.messages.map((m) => {
      if (!match(m)) return m
      changed = true
      return patch(m)
    })
    return changed ? { ...page, messages } : page
  })
}

function patchConversation(qc: QueryClient, orgId: number, uuid: string, patch: (c: Conversation) => Conversation): boolean {
  let found = false
  qc.setQueryData<Conversation[]>(messagingKeys.conversations(orgId), (list) => {
    if (!list) return list
    const next = list.map((c) => {
      if (c.conversation_uuid !== uuid) return c
      found = true
      return patch(c)
    })
    next.sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''))
    return next
  })
  return found
}

/* ------------------------------------------------------------------------ */
/* Notifications                                                            */
/* ------------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null

function playPing() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)()
    const t = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t)
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(t)
    osc.stop(t + 0.26)
  } catch {
    // Audio is a nicety.
  }
}

/* ------------------------------------------------------------------------ */
/* Provider                                                                 */
/* ------------------------------------------------------------------------ */

export function MessagingProvider({ children, orgslug }: { children: React.ReactNode; orgslug?: string }) {
  const enabled = useMessagingEnabled()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const userId: number | undefined = session?.data?.user?.id
  const orgId: number | undefined = org?.id
  const qc = useQueryClient()
  const live = enabled && Boolean(token && orgId && userId)

  const [connected, setConnected] = useState(false)
  const [me, setMe] = useState<MyStatus | null>(null)
  const [presence, setPresence] = useState<Record<number, Presence>>({})
  const [typing, setTyping] = useState<Record<string, TypingEntry[]>>({})
  const [agentProgress, setAgentProgress] = useState<Record<number, AgentProgress>>({})
  // Conversations on screen right now: the Messages page and any dock windows.
  const visibleRef = useRef(new Map<string, number>())
  const markVisible = useCallback((uuid: string) => {
    const map = visibleRef.current
    map.set(uuid, (map.get(uuid) || 0) + 1)
    return () => {
      const n = (map.get(uuid) || 1) - 1
      if (n <= 0) map.delete(uuid)
      else map.set(uuid, n)
    }
  }, [])
  const meRef = useRef<MyStatus | null>(null)
  meRef.current = me
  const listeners = useRef(new Set<Listener>())

  const { data: conversations } = useQuery({
    queryKey: messagingKeys.conversations(orgId ?? 0),
    queryFn: () => listConversations(orgId!, token!),
    enabled: live,
    staleTime: 30_000,
  })

  const unreadTotal = useMemo(
    () => (conversations || []).reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0),
    [conversations]
  )

  // Tab title badge, like every chat app.
  useEffect(() => {
    if (!live || typeof document === 'undefined') return
    const base = document.title.replace(/^\(\d+\)\s/, '')
    document.title = unreadTotal > 0 ? `(${unreadTotal}) ${base}` : base
  }, [unreadTotal, live])

  const notify = useCallback(
    (conversationUuid: string, message: ChatMessage) => {
      const prefs = meRef.current
      if (!prefs || prefs.availability === 'dnd') return
      const conv = qc
        .getQueryData<Conversation[]>(messagingKeys.conversations(orgId ?? 0))
        ?.find((c) => c.conversation_uuid === conversationUuid)
      if (conv?.muted) return
      const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
      const looking = visible && visibleRef.current.has(conversationUuid)
      if (looking) return
      if (prefs.sounds) playPing()
      if (
        prefs.desktop_notifications &&
        !visible &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        const sender = message.sender
        const who = sender?.type === 'agent' ? sender.name : displayName(sender as any)
        const title = conv ? conversationTitle(conv, userId) : who
        const body =
          message.kind === 'course_share'
            ? `${who} shared ${message.attachment?.course?.name ?? 'a course'}`
            : `${conv?.kind === 'dm' ? '' : who + ': '}${message.content.slice(0, 140)}`
        try {
          const n = new Notification(title, { body, tag: conversationUuid })
          n.onclick = () => {
            window.focus()
            if (!openInDock(conversationUuid) && orgslug) {
              window.location.href = getUriWithOrg(orgslug, `/messages?c=${conversationUuid}`)
            }
          }
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
    },
    [qc, orgId, userId, orgslug]
  )

  const handle = useCallback(
    (event: MessagingEvent) => {
      if (!orgId) return
      switch (event.type) {
        case 'hello': {
          setMe(event.me)
          setConnected(true)
          setPresence((prev) => {
            const next = { ...prev }
            for (const id of event.online_user_ids) {
              next[id] = { ...(next[id] || { user_id: id, status_emoji: '', status_text: '', last_seen_at: null }), online: true, state: next[id]?.state && next[id].state !== 'offline' ? next[id].state : 'online' }
            }
            return next
          })
          // Anything that happened while disconnected.
          qc.invalidateQueries({ queryKey: messagingKeys.all(orgId) })
          qc.invalidateQueries({ queryKey: ['messaging', 'messages'] })
          qc.invalidateQueries({ queryKey: ['messaging', 'conversation'] })
          break
        }
        case 'message.new': {
          const { conversation_uuid: uuid, message } = event
          upsertMessage(qc, uuid, message)
          const mine = message.sender?.type === 'user' && message.sender.id === userId
          const looking =
            typeof document !== 'undefined' && document.visibilityState === 'visible' && visibleRef.current.has(uuid)
          const found = patchConversation(qc, orgId, uuid, (c) => ({
            ...c,
            last_message: message,
            last_message_at: message.creation_date,
            archived: false,
            unread_count: mine || looking || message.status === 'streaming' ? c.unread_count : c.unread_count + 1,
          }))
          if (!found) qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId) })
          // Someone who sent a message has stopped typing.
          if (message.sender?.type === 'user') {
            const sid = message.sender.id
            setTyping((prev) => ({ ...prev, [uuid]: (prev[uuid] || []).filter((t) => t.user.id !== sid) }))
          }
          if (message.kind === 'reminder') qc.invalidateQueries({ queryKey: ['messaging', orgId, 'reminders'] })
          if (!mine && message.status !== 'streaming' && message.kind !== 'system') notify(uuid, message)
          break
        }
        case 'message.updated': {
          const { conversation_uuid: uuid, message } = event
          upsertMessage(qc, uuid, message)
          patchConversation(qc, orgId, uuid, (c) =>
            c.last_message?.id === message.id ? { ...c, last_message: message } : c
          )
          if (message.status !== 'streaming') {
            setAgentProgress((prev) => {
              if (!(message.id in prev)) return prev
              const next = { ...prev }
              delete next[message.id]
              return next
            })
            if (message.attachment?.reminders?.length) {
              qc.invalidateQueries({ queryKey: ['messaging', orgId, 'reminders'] })
            }
            // A finished agent reply is the moment to ping, not its placeholder.
            if (message.sender?.type === 'agent' && message.status === 'complete') notify(uuid, message)
          }
          break
        }
        case 'message.deleted': {
          patchMessage(qc, event.conversation_uuid, (m) => m.message_uuid === event.message_uuid, (m) => ({
            ...m,
            deleted: true,
            content: '',
            attachment: null,
            reactions: [],
          }))
          break
        }
        case 'message.delta': {
          patchMessage(qc, event.conversation_uuid, (m) => m.id === event.message_id, (m) => ({
            ...m,
            content: m.content + event.delta,
          }))
          break
        }
        case 'agent.status': {
          setAgentProgress((prev) => ({
            ...prev,
            [event.message_id]: {
              ...prev[event.message_id],
              phase: event.phase,
              ...(event.courses !== undefined ? { courses: event.courses } : {}),
              ...(event.sources ? { sources: event.sources } : {}),
              ...(event.query ? { query: event.query } : {}),
            },
          }))
          break
        }
        case 'reaction': {
          patchMessage(qc, event.conversation_uuid, (m) => m.message_uuid === event.message_uuid, (m) => ({
            ...m,
            reactions: event.reactions.map((r) => ({ ...r, me: userId !== undefined && r.user_ids.includes(userId) })),
          }))
          break
        }
        case 'typing': {
          const { conversation_uuid: uuid, user, is_typing } = event
          setTyping((prev) => {
            const others = (prev[uuid] || []).filter((t) => t.user.id !== user.id)
            return { ...prev, [uuid]: is_typing ? [...others, { user, until: Date.now() + 6000 }] : others }
          })
          break
        }
        case 'read': {
          patchConversation(qc, orgId, event.conversation_uuid, (c) => ({
            ...c,
            last_read_message_id: event.user_id === userId ? event.message_id : c.last_read_message_id,
            unread_count: event.user_id === userId ? 0 : c.unread_count,
            members: c.members.map((m) =>
              m.id === event.user_id ? { ...m, last_read_message_id: event.message_id } : m
            ),
          }))
          break
        }
        case 'presence': {
          const { type: _t, ...p } = event
          setPresence((prev) => ({ ...prev, [p.user_id]: p }))
          break
        }
        case 'conversation.new':
        case 'conversation.updated': {
          qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId) })
          qc.invalidateQueries({ queryKey: ['messaging', 'conversation', event.conversation_uuid] })
          break
        }
      }
      listeners.current.forEach((fn) => fn(event))
    },
    [qc, orgId, userId, notify]
  )

  // The stream, with backoff reconnects.
  useEffect(() => {
    if (!live) return
    const controller = new AbortController()
    let attempt = 0
    let stopped = false
    const run = async () => {
      while (!stopped) {
        try {
          await openMessagingStream(orgId!, token!, (e) => {
            attempt = 0
            handle(e)
          }, controller.signal)
        } catch (err: any) {
          if (stopped || err?.name === 'AbortError') return
          if (err?.status === 401 || err?.status === 403) {
            setConnected(false)
            return
          }
        }
        setConnected(false)
        if (stopped) return
        attempt += 1
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))))
      }
    }
    run()
    return () => {
      stopped = true
      controller.abort()
      setConnected(false)
    }
  }, [live, orgId, token, handle])

  // Expire typing indicators whose sender went quiet.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setTyping((prev) => {
        let changed = false
        const next: Record<string, TypingEntry[]> = {}
        for (const [k, list] of Object.entries(prev)) {
          const kept = list.filter((t) => t.until > now)
          if (kept.length !== list.length) changed = true
          next[k] = kept
        }
        return changed ? next : prev
      })
    }, 2000)
    return () => clearInterval(id)
  }, [])

  const onlineIds = useMemo(
    () => new Set(Object.values(presence).filter((p) => p.online).map((p) => p.user_id)),
    [presence]
  )

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  const value = useMemo<MessagingContextValue>(
    () => ({
      enabled,
      connected,
      orgId,
      userId,
      token,
      me,
      setMe,
      presence,
      onlineIds,
      typing,
      agentProgress,
      unreadTotal,
      markVisible,
      subscribe,
    }),
    [enabled, connected, orgId, userId, token, me, presence, onlineIds, typing, agentProgress, unreadTotal, markVisible, subscribe]
  )

  // Message reactions, read receipts and the agent UI use Radix tooltips.
  return (
    <MessagingContext.Provider value={value}>
      <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
    </MessagingContext.Provider>
  )
}
