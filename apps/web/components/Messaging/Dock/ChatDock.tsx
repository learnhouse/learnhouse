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
import { ConversationListSkeleton, ConversationRow } from '@components/Messaging/Sidebar/ConversationSidebar'
import { IconButton } from '@components/Messaging/ui/kit'
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
  const { t } = useTranslation()
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
          type="button"
          onClick={() => setListOpen((v) => !v)}
          aria-label={
            unreadTotal
              ? t('messaging.chats_unread', { defaultValue: 'Chats, {{count}} unread', count: unreadTotal })
              : t('messaging.chats', { defaultValue: 'Chats' })
          }
          aria-expanded={listOpen}
          className={`relative flex items-center justify-center rounded-full transition-all active:scale-95 ${
            listOpen
              ? 'bg-neutral-900 text-white shadow-[0_6px_20px_rgba(0,0,0,0.18)]'
              : 'bg-white text-neutral-700 shadow-[0_6px_20px_rgba(0,0,0,0.1)] ring-1 ring-neutral-900/[0.06] hover:text-neutral-900 hover:shadow-[0_8px_24px_rgba(0,0,0,0.14)]'
          }`}
          style={{ width: LAUNCHER, height: LAUNCHER }}
        >
          {listOpen ? <X size={20} weight="bold" /> : <ChatsCircle size={24} weight="fill" />}
          {!listOpen && unreadTotal > 0 && (
            <span className="absolute -top-0.5 -end-0.5 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-semibold leading-5 text-center ring-2 ring-white tabular-nums">
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
      className="pointer-events-auto flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-neutral-900/[0.06]"
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
            type="button"
            onClick={onOpen}
            aria-label={unread ? `${title}, ${unread} unread` : title}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.12)] ring-1 ring-neutral-900/[0.06] transition-transform hover:scale-105"
          >
            <ConversationAvatar conversation={conversation} viewerId={viewerId} size={44} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {title}
        </TooltipContent>
      </Tooltip>
      {unread > 0 && (
        <span className="pointer-events-none absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-[18px] text-center ring-2 ring-white tabular-nums">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${title}`}
        className="absolute -top-1 -start-1 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-neutral-500 shadow-sm ring-1 ring-neutral-900/10 hover:text-neutral-900 group-hover:flex"
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

  const shownAgents = (Array.isArray(agents) ? agents : []).slice(0, 4)
  const unreadCount = conversations.filter((c) => !c.archived && c.unread_count > 0).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-neutral-100 ps-4 pe-1.5">
        <p className="flex-1 text-sm font-bold text-neutral-900">{t('messaging.chats', { defaultValue: 'Chats' })}</p>
        <IconButton size="sm" label={t('messaging.new_message', { defaultValue: 'New message' })} onClick={() => setNewOpen(true)}>
          <NotePencil size={15} weight="bold" />
        </IconButton>
        <IconButton size="sm" label={t('messaging.open_messages', { defaultValue: 'Open Messages' })} onClick={() => router.push(getUriWithOrg(orgslug, '/messages'))}>
          <ArrowsOutSimple size={15} weight="bold" />
        </IconButton>
        <IconButton size="sm" label={t('messaging.close_chats', { defaultValue: 'Close chats' })} onClick={onClose}>
          <X size={15} weight="bold" />
        </IconButton>
      </div>

      <div className="shrink-0 space-y-2.5 px-3 pt-3">
        <label className="relative block">
          <MagnifyingGlass size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('messaging.search_chats', { defaultValue: 'Search chats' })}
            className="h-8 w-full rounded-lg bg-neutral-100/80 ps-8 pe-3 text-sm outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
          />
        </label>

        {shownAgents.length > 0 && !q && (
          <div className="-mx-1 flex gap-0.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {shownAgents.map((a) => (
              <button
                key={a.agent_uuid}
                type="button"
                onClick={() => onOpenAgent(a.agent_uuid)}
                className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-xl py-1.5 hover:bg-neutral-50"
                title={a.description || a.name}
              >
                <AgentAvatar agent={a} size={34} />
                <span className="w-full truncate px-0.5 text-center text-[11px] text-neutral-600">{a.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => router.push(getUriWithOrg(orgslug, '/messages?agents=1'))}
              className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-xl py-1.5 hover:bg-neutral-50"
              title={t('messaging.all_agents', { defaultValue: 'All agents' })}
            >
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-400">
                <Plus size={14} weight="bold" />
              </span>
              <span className="text-[11px] text-neutral-500">{t('messaging.agents', { defaultValue: 'Agents' })}</span>
            </button>
          </div>
        )}

        <div className="inline-flex items-center rounded-lg bg-neutral-100 p-0.5" role="tablist">
          {(['all', 'unread'] as ListFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`inline-flex h-6 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                filter === f ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)]' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              {f === 'all' ? t('messaging.filters.all', { defaultValue: 'All' }) : t('messaging.filters.unread', { defaultValue: 'Unread' })}
              {f === 'unread' && unreadCount > 0 && <span className="tabular-nums text-neutral-400">{unreadCount}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5">
        {isLoading && <ConversationListSkeleton rows={4} />}
        {!isLoading && visible.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-neutral-400">
            {q
              ? t('messaging.no_chats_match', { defaultValue: 'No chats match.' })
              : filter === 'unread'
                ? t('messaging.all_caught_up', { defaultValue: 'You’re all caught up' })
                : t('messaging.no_chats', { defaultValue: 'No chats yet.' })}
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
