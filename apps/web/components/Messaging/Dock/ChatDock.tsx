'use client'

/**
 * The chat dock: small chat windows along the bottom of every page, with
 * minimized chats as round heads above the Messages launcher. Opening a chat
 * here uses the same Thread as the Messages page, agents included, so people
 * and agents are one click away wherever you are in the course.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowsOutSimple, ChatsCircle, MagnifyingGlass, NotePencil, Plus, X } from '@phosphor-icons/react'
import { messagingKeys, useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'
import { useAgents, useConversations } from '@components/Messaging/hooks'
import Thread from '@components/Messaging/Thread/Thread'
import { ConversationRow } from '@components/Messaging/Sidebar/ConversationSidebar'
import NewConversationDialog from '@components/Messaging/Dialogs/NewConversationDialog'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import { ConversationAvatar } from '@components/Messaging/ui/Avatars'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { usePodcastPlayer } from '@components/Contexts/PodcastPlayerContext'
import { getUriWithOrg } from '@services/config/config'
import { Conversation, conversationTitle, openAgentChat } from '@services/messaging/messaging'
import { DOCK_OPEN_EVENT, setDockMounted } from '@components/Messaging/Dock/dockBus'

const WINDOW_W = 340
const GAP = 12
const LAUNCHER = 52
const MAX_HEADS = 6

type DockState = { open: string[]; heads: string[] }

const EMPTY: DockState = { open: [], heads: [] }

function storageKey(orgId: number) {
  return `lh-chat-dock:${orgId}`
}

function load(orgId: number): DockState {
  try {
    const raw = window.localStorage.getItem(storageKey(orgId))
    if (!raw) return EMPTY
    const s = JSON.parse(raw)
    return {
      open: Array.isArray(s.open) ? s.open.filter((x: unknown) => typeof x === 'string') : [],
      heads: Array.isArray(s.heads) ? s.heads.filter((x: unknown) => typeof x === 'string') : [],
    }
  } catch {
    return EMPTY
  }
}

function save(orgId: number, state: DockState) {
  try {
    window.localStorage.setItem(storageKey(orgId), JSON.stringify(state))
  } catch {
    // Private windows can refuse storage; the dock still works for the visit.
  }
}

/** How many windows fit beside the launcher column. */
function slotsFor(width: number) {
  const room = width - 16 * 2 - LAUNCHER - GAP
  return Math.max(1, Math.min(3, Math.floor((room + GAP) / (WINDOW_W + GAP))))
}

/** Keep at most `slots` windows open; the oldest fold into heads. */
function fit(state: DockState, slots: number): DockState {
  if (state.open.length <= slots) return state
  const overflow = state.open.slice(0, state.open.length - slots)
  return {
    open: state.open.slice(-slots),
    heads: [...overflow.reverse(), ...state.heads.filter((h) => !overflow.includes(h))].slice(0, MAX_HEADS),
  }
}

export default function ChatDock({ orgslug }: { orgslug: string }) {
  const enabled = useMessagingEnabled()
  const { token, orgId, userId } = useMessaging()
  const pathname = usePathname() || ''
  const onMessagesPage = pathname.split('/').includes('messages')
  if (!enabled || !token || !orgId || !userId || onMessagesPage) return null
  return <Dock orgslug={orgslug} orgId={orgId} />
}

function Dock({ orgslug, orgId }: { orgslug: string; orgId: number }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { token, userId, unreadTotal, subscribe } = useMessaging()
  const { data: conversations = [] } = useConversations()
  const podcast = usePodcastPlayer()
  const [state, setState] = useState<DockState>(EMPTY)
  const [listOpen, setListOpen] = useState(false)
  const [slots, setSlots] = useState(3)
  const [ready, setReady] = useState(false)

  const byUuid = useMemo(() => new Map(conversations.map((c) => [c.conversation_uuid, c])), [conversations])

  // Restore the dock as it was on the last page.
  useEffect(() => {
    setState(load(orgId))
    setReady(true)
  }, [orgId])
  useEffect(() => {
    if (ready) save(orgId, state)
  }, [orgId, state, ready])

  useEffect(() => {
    const onResize = () => setSlots(slotsFor(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The chats list takes a slot while it's open.
  const windowSlots = Math.max(1, slots - (listOpen ? 1 : 0))
  useEffect(() => {
    setState((s) => fit(s, windowSlots))
  }, [windowSlots])

  const openChat = useCallback(
    (uuid: string) => {
      setListOpen(false)
      setState((s) =>
        fit({ open: [...s.open.filter((x) => x !== uuid), uuid], heads: s.heads.filter((x) => x !== uuid) }, slots)
      )
    },
    [slots]
  )
  const minimize = (uuid: string) =>
    setState((s) => ({ open: s.open.filter((x) => x !== uuid), heads: [uuid, ...s.heads.filter((x) => x !== uuid)].slice(0, MAX_HEADS) }))
  const close = (uuid: string) =>
    setState((s) => ({ open: s.open.filter((x) => x !== uuid), heads: s.heads.filter((x) => x !== uuid) }))
  const expand = (uuid: string) => {
    close(uuid)
    router.push(getUriWithOrg(orgslug, `/messages?c=${uuid}`))
  }
  const swap = (from: string, to: string) =>
    setState((s) => ({ open: s.open.map((x) => (x === from ? to : x)), heads: s.heads.filter((x) => x !== to) }))

  const openAgent = async (agentUuid: string, fresh = false) => {
    if (!token) return null
    const conv = await openAgentChat(agentUuid, token, fresh)
    if (fresh) qc.removeQueries({ queryKey: messagingKeys.messages(conv.conversation_uuid) })
    qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId) })
    return conv
  }

  // Others (notifications, profile buttons) open chats here.
  useEffect(() => {
    setDockMounted(true)
    const onOpen = (e: Event) => {
      const uuid = (e as CustomEvent<{ conversationUuid: string }>).detail?.conversationUuid
      if (uuid) openChat(uuid)
    }
    window.addEventListener(DOCK_OPEN_EVENT, onOpen)
    return () => {
      setDockMounted(false)
      window.removeEventListener(DOCK_OPEN_EVENT, onOpen)
    }
  }, [openChat])

  // A new message in a closed chat pops its head, like any messenger.
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type !== 'message.new') return
        const m = e.message
        if (m.status === 'streaming' || m.kind === 'system') return
        if (m.sender?.type === 'user' && m.sender.id === userId) return
        const conv = qc
          .getQueryData<Conversation[]>(messagingKeys.conversations(orgId))
          ?.find((c) => c.conversation_uuid === e.conversation_uuid)
        if (conv && (conv.muted || conv.kind === 'broadcast')) return
        const uuid = e.conversation_uuid
        setState((s) =>
          s.open.includes(uuid) || s.heads.includes(uuid) ? s : { ...s, heads: [uuid, ...s.heads].slice(0, MAX_HEADS) }
        )
      }),
    [subscribe, qc, orgId, userId]
  )

  const offset = podcast.state.isVisible ? (podcast.state.isMinimized ? 64 : 96) : 0
  const heads = state.heads.map((u) => byUuid.get(u)).filter(Boolean) as Conversation[]

  return (
    <div
      data-chat-dock
      className="pointer-events-none fixed end-4 z-40 hidden md:flex items-end"
      style={{ bottom: offset, gap: GAP }}
    >
      {state.open.map((uuid) => (
        <DockWindow key={uuid}>
          <Thread
            uuid={uuid}
            orgslug={orgslug}
            variant="dock"
            onBack={() => minimize(uuid)}
            onMinimize={() => minimize(uuid)}
            onExpand={() => expand(uuid)}
            onClose={() => close(uuid)}
            onLeft={() => close(uuid)}
            onOpenConversation={(c) => openChat(c.conversation_uuid)}
            onEditAgent={() => expand(uuid)}
            onNewAgentChat={async (agentUuid) => {
              const conv = await openAgent(agentUuid, true)
              if (conv) swap(uuid, conv.conversation_uuid)
            }}
          />
        </DockWindow>
      ))}

      {listOpen && (
        <DockWindow>
          <ChatList
            orgslug={orgslug}
            onClose={() => setListOpen(false)}
            onOpen={openChat}
            onOpenAgent={async (agentUuid) => {
              const conv = await openAgent(agentUuid)
              if (conv) openChat(conv.conversation_uuid)
            }}
          />
        </DockWindow>
      )}

      <div className="pointer-events-auto flex flex-col items-center gap-2.5 pb-4" style={{ width: LAUNCHER }}>
        {heads.map((c) => (
          <ChatHead key={c.conversation_uuid} conversation={c} viewerId={userId} onOpen={() => openChat(c.conversation_uuid)} onClose={() => close(c.conversation_uuid)} />
        ))}
        <button
          onClick={() => setListOpen((v) => !v)}
          aria-label={unreadTotal ? `Chats, ${unreadTotal} unread` : 'Chats'}
          aria-expanded={listOpen}
          className={`relative flex items-center justify-center rounded-full bg-white nice-shadow transition-colors ${
            listOpen ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
          }`}
          style={{ width: LAUNCHER, height: LAUNCHER }}
        >
          {listOpen ? <X size={20} weight="bold" /> : <ChatsCircle size={24} weight="fill" />}
          {!listOpen && unreadTotal > 0 && (
            <span className="absolute -top-0.5 -end-0.5 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold leading-5 text-center ring-2 ring-white tabular-nums">
              {unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}

function DockWindow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-auto flex flex-col overflow-hidden rounded-t-xl bg-white nice-shadow"
      style={{ width: WINDOW_W, height: 'min(500px, calc(100dvh - 96px))' }}
    >
      {children}
    </div>
  )
}

function ChatHead({
  conversation,
  viewerId,
  onOpen,
  onClose,
}: {
  conversation: Conversation
  viewerId: number | undefined
  onOpen: () => void
  onClose: () => void
}) {
  const title = conversationTitle(conversation, viewerId)
  const unread = conversation.muted ? 0 : conversation.unread_count
  return (
    <div className="group relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onOpen}
            aria-label={unread ? `${title}, ${unread} unread` : title}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white nice-shadow"
          >
            <ConversationAvatar conversation={conversation} viewerId={viewerId} size={44} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {title}
        </TooltipContent>
      </Tooltip>
      {unread > 0 && (
        <span className="pointer-events-none absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-[18px] text-center ring-2 ring-white tabular-nums">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      <button
        onClick={onClose}
        aria-label={`Close ${title}`}
        className="absolute -top-1 -start-1 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-gray-500 nice-shadow hover:text-gray-900 group-hover:flex"
      >
        <X size={10} weight="bold" />
      </button>
    </div>
  )
}

type ListFilter = 'all' | 'unread'

function ChatList({
  orgslug,
  onClose,
  onOpen,
  onOpenAgent,
}: {
  orgslug: string
  onClose: () => void
  onOpen: (uuid: string) => void
  onOpenAgent: (agentUuid: string) => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const { userId } = useMessaging()
  const { data: conversations = [], isLoading } = useConversations()
  const { data: agents = [] } = useAgents()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<ListFilter>('all')
  const [newOpen, setNewOpen] = useState(false)

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return conversations
      .filter((c) => !c.archived)
      .filter((c) => filter === 'all' || c.unread_count > 0)
      .filter((c) => !needle || conversationTitle(c, userId).toLowerCase().includes(needle))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }, [conversations, q, filter, userId])

  const shownAgents = agents.slice(0, 4)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 flex-shrink-0 items-center gap-1 border-b border-gray-100 ps-3.5 pe-1">
        <p className="flex-1 text-sm font-bold text-gray-900">{t('messaging.chats', { defaultValue: 'Chats' })}</p>
        <button onClick={() => setNewOpen(true)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="New message" title="New message">
          <NotePencil size={16} weight="bold" />
        </button>
        <button
          onClick={() => router.push(getUriWithOrg(orgslug, '/messages'))}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          aria-label="Open Messages"
          title="Open Messages"
        >
          <ArrowsOutSimple size={16} weight="bold" />
        </button>
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Close chats" title="Close">
          <X size={16} weight="bold" />
        </button>
      </div>

      <div className="flex-shrink-0 space-y-2.5 px-2.5 pt-2.5">
        <label className="flex items-center gap-2 rounded-lg bg-gray-100 px-2.5 py-1.5">
          <MagnifyingGlass size={14} className="text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('messaging.search_chats', { defaultValue: 'Search chats' })}
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
        </label>

        {shownAgents.length > 0 && !q && (
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {shownAgents.map((a) => (
              <button
                key={a.agent_uuid}
                onClick={() => onOpenAgent(a.agent_uuid)}
                className="flex w-14 flex-shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 hover:bg-gray-50"
                title={a.description || a.name}
              >
                <AgentAvatar agent={a} size={34} />
                <span className="w-full truncate px-0.5 text-center text-[11px] text-gray-600">{a.name}</span>
              </button>
            ))}
            <button
              onClick={() => router.push(getUriWithOrg(orgslug, '/messages?agents=1'))}
              className="flex w-14 flex-shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 hover:bg-gray-50"
              title="All agents"
            >
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400">
                <Plus size={14} weight="bold" />
              </span>
              <span className="text-[11px] text-gray-500">Agents</span>
            </button>
          </div>
        )}

        <div className="flex gap-1">
          {(['all', 'unread'] as ListFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {isLoading &&
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 px-2.5 py-2">
              <div className="h-10 w-10 rounded-full bg-gray-100" />
              <div className="h-3 flex-1 rounded bg-gray-100" />
            </div>
          ))}
        {!isLoading && visible.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-gray-400">
            {q ? 'No chats match.' : filter === 'unread' ? 'You’re all caught up.' : 'No chats yet.'}
          </p>
        )}
        {visible.map((c) => (
          <ConversationRow key={c.conversation_uuid} c={c} active={false} onClick={() => onOpen(c.conversation_uuid)} />
        ))}
      </div>

      <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(c) => onOpen(c.conversation_uuid)} />
    </div>
  )
}
