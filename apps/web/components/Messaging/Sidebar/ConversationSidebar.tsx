'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  BellSlash,
  ChatsCircle,
  GearSix,
  MagnifyingGlass,
  Megaphone,
  NotePencil,
  Plus,
  PushPin,
  X,
} from '@phosphor-icons/react'
import { useMessaging } from '@components/Messaging/MessagingProvider'
import { useBroadcastTargets, useConversations } from '@components/Messaging/hooks'
import { ConversationAvatar, PersonAvatar } from '@components/Messaging/ui/Avatars'
import AgentsGallery from '@components/Messaging/Agents/AgentsGallery'
import { RemindersButton } from '@components/Messaging/Reminders/Reminders'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import {
  Availability,
  Conversation,
  conversationTitle,
  otherMember,
  searchMessages,
  updateMe,
} from '@services/messaging/messaging'
import { previewText, senderName, shortTime } from '@components/Messaging/utils'
import { AVAILABILITY } from '@components/Messaging/Dialogs/SettingsDialog'
import { useLHSession } from '@components/Contexts/LHSessionContext'

type Filter = 'all' | 'unread' | 'people' | 'groups' | 'courses' | 'agents'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'people', label: 'People' },
  { key: 'groups', label: 'Groups' },
  { key: 'courses', label: 'Courses' },
  { key: 'agents', label: 'Agents' },
]

function matchesFilter(c: Conversation, f: Filter) {
  switch (f) {
    case 'unread':
      return c.unread_count > 0
    case 'people':
      return c.kind === 'dm'
    case 'groups':
      return c.kind === 'group'
    case 'courses':
      return c.kind === 'broadcast'
    case 'agents':
      return c.kind === 'agent'
    default:
      return true
  }
}

export function ConversationRow({
  c,
  active,
  onClick,
}: {
  c: Conversation
  active: boolean
  onClick: () => void
}) {
  const { userId, typing, presence } = useMessaging()
  const title = conversationTitle(c, userId)
  const typers = (typing[c.conversation_uuid] || []).map((x) => x.user.first_name || x.user.username)
  const other = otherMember(c, userId)
  const status = other ? presence[other.id] : undefined
  const last = c.last_message
  const streaming = last?.status === 'streaming'

  let preview: React.ReactNode = previewText(last)
  if (typers.length) {
    preview = (
      <span className="text-gray-600 italic">
        {typers.length === 1 ? `${typers[0]} is typing…` : `${typers.length} people are typing…`}
      </span>
    )
  } else if (streaming) {
    preview = (
      <span className="text-gray-500 italic">
        Writing…
      </span>
    )
  } else if (last && c.kind !== 'dm' && c.kind !== 'agent' && last.kind !== 'system' && last.sender) {
    const mine = last.sender.type === 'user' && last.sender.id === userId
    preview = `${mine ? 'You' : senderName(last).split(' ')[0]}: ${previewText(last)}`
  } else if (last && last.sender?.type === 'user' && last.sender.id === userId) {
    preview = `You: ${previewText(last)}`
  }

  const unread = c.unread_count > 0
  return (
    <button
      onClick={onClick}
      aria-label={unread ? `${title}, ${c.unread_count} unread` : title}
      aria-current={active ? 'true' : undefined}
      data-conversation={c.conversation_uuid}
      className={`group w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-start transition-colors ${
        active ? 'bg-gray-100' : 'hover:bg-gray-50'
      }`}
    >
      <ConversationAvatar conversation={c} viewerId={userId} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={`truncate text-sm ${unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>
            {title}
          </p>
          {status?.status_emoji && <span className="text-xs" title={status.status_text}>{status.status_emoji}</span>}
          {c.pinned && <PushPin size={11} weight="fill" className="text-gray-300 flex-shrink-0" />}
          {c.muted && <BellSlash size={11} className="text-gray-300 flex-shrink-0" />}
          <span className={`ms-auto text-[11px] flex-shrink-0 ${unread ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
            {shortTime(c.last_message_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className={`truncate text-xs ${unread ? 'text-gray-700' : 'text-gray-500'}`}>{preview || ' '}</p>
          {unread &&
            (c.muted ? (
              <span className="ms-auto h-2 w-2 rounded-full bg-gray-300 flex-shrink-0" />
            ) : (
              <span className="ms-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-gray-900 text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                {c.unread_count > 99 ? '99+' : c.unread_count}
              </span>
            ))}
        </div>
      </div>
    </button>
  )
}

export default function ConversationSidebar({
  orgslug,
  selected,
  onSelect,
  onNewMessage,
  onAnnounce,
  onSettings,
  onNewAgent,
  onOpenAgentChat,
}: {
  orgslug: string
  selected: string | null
  onSelect: (uuid: string, focusMessageUuid?: string) => void
  onNewMessage: () => void
  onAnnounce: () => void
  onSettings: () => void
  onNewAgent: () => void
  onOpenAgentChat: (conversation: Conversation) => void
}) {
  const { t } = useTranslation()
  const { orgId, token, me, setMe, connected } = useMessaging()
  const session = useLHSession() as any
  const sessionUser = session?.data?.user
  const { data: conversations = [], isLoading } = useConversations()
  const { data: targets = [] } = useBroadcastTargets()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  const { data: hits = [] } = useQuery({
    queryKey: ['messaging', orgId, 'search', debounced],
    queryFn: () => searchMessages(orgId!, debounced, token!),
    enabled: Boolean(orgId && token && debounced.length >= 2),
    staleTime: 10_000,
  })

  const viewerId = sessionUser?.id
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations
      .filter((c) => !c.archived || c.conversation_uuid === selected)
      .filter((c) => matchesFilter(c, filter))
      .filter((c) => !q || conversationTitle(c, viewerId).toLowerCase().includes(q))
  }, [conversations, filter, query, selected, viewerId])

  const pinned = visible.filter((c) => c.pinned)
  const rest = visible.filter((c) => !c.pinned)
  const titleByUuid = useMemo(
    () => Object.fromEntries(conversations.map((c) => [c.conversation_uuid, conversationTitle(c, viewerId)])),
    [conversations, viewerId]
  )

  const setAvailability = async (a: Availability) => {
    if (!orgId || !token) return
    try {
      setMe(await updateMe(orgId, { availability: a }, token))
    } catch {
      // ignore
    }
  }
  const currentAvailability = AVAILABILITY.find((a) => a.key === (me?.availability || 'auto'))!

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white nice-shadow">
            <ChatsCircle size={16} weight="fill" className="text-black" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">{t('messaging.title', { defaultValue: 'Messages' })}</h1>
        </div>
        <div className="flex items-center gap-0.5">
          {targets.length > 0 && (
            <button
              onClick={onAnnounce}
              title={t('messaging.announce', { defaultValue: 'Message everyone in a course' })}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <Megaphone size={18} weight="fill" />
            </button>
          )}
          <RemindersButton onOpenConversation={(uuid) => onSelect(uuid)} />
          <button
            onClick={onSettings}
            title={t('messaging.settings', { defaultValue: 'Messages settings' })}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <GearSix size={18} weight="fill" />
          </button>
          <button
            onClick={onNewMessage}
            title={t('messaging.new_message', { defaultValue: 'New message' })}
            className="ms-1 p-2 rounded-lg bg-black text-white hover:bg-gray-800 transition-colors"
          >
            <NotePencil size={16} weight="bold" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-1 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-white nice-shadow px-3 py-2 focus-within:ring-2 focus-within:ring-gray-200 transition-shadow">
          <MagnifyingGlass size={16} className="text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('messaging.search', { defaultValue: 'Search conversations and messages' })}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-700">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 pb-2 flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {FILTERS.map((f) => {
          const count = f.key === 'unread' ? conversations.filter((c) => c.unread_count > 0).length : 0
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex-shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f.key ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {f.label}
              {count > 0 && <span className="ms-1 opacity-70">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2.5 py-2.5 animate-pulse">
              <div className="h-10 w-10 rounded-full bg-gray-100" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/2 rounded bg-gray-100" />
                <div className="h-2.5 w-3/4 rounded bg-gray-100" />
              </div>
            </div>
          ))}

        {pinned.length > 0 && (
          <>
            <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {t('messaging.pinned', { defaultValue: 'Pinned' })}
            </p>
            {pinned.map((c) => (
              <ConversationRow key={c.conversation_uuid} c={c} active={c.conversation_uuid === selected} onClick={() => onSelect(c.conversation_uuid)} />
            ))}
            <div className="h-px bg-gray-100 mx-2.5 my-1.5" />
          </>
        )}
        <AnimatePresence initial={false}>
          {rest.map((c) => (
            <motion.div key={c.conversation_uuid} layout="position" transition={{ duration: 0.18 }}>
              <ConversationRow c={c} active={c.conversation_uuid === selected} onClick={() => onSelect(c.conversation_uuid)} />
            </motion.div>
          ))}
        </AnimatePresence>

        {!isLoading && visible.length === 0 && !hits.length && (
          <div className="text-center py-10 px-6">
            <p className="text-sm font-medium text-gray-700">
              {query ? t('messaging.no_results', { defaultValue: 'No matches' }) : t('messaging.empty', { defaultValue: 'No conversations yet' })}
            </p>
            {!query && (
              <button onClick={onNewMessage} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800">
                <Plus size={12} weight="bold" /> {t('messaging.new_message', { defaultValue: 'New message' })}
              </button>
            )}
          </div>
        )}

        {hits.length > 0 && (
          <>
            <p className="px-2.5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {t('messaging.in_messages', { defaultValue: 'In messages' })}
            </p>
            {hits.map((m) => (
              <button
                key={m.message_uuid}
                onClick={() => onSelect(m.conversation_uuid, m.message_uuid)}
                className="w-full text-start rounded-lg px-2.5 py-2 hover:bg-gray-50"
              >
                <p className="text-xs text-gray-400 truncate">
                  {titleByUuid[m.conversation_uuid] || 'Conversation'} · {senderName(m)} · {shortTime(m.creation_date)}
                </p>
                <p className="text-sm text-gray-700 line-clamp-2">{previewText(m)}</p>
              </button>
            ))}
          </>
        )}

        {/* Agents */}
        {(filter === 'all' || filter === 'agents') && !query && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between px-2.5 pb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                {t('messaging.agents', { defaultValue: 'Agents' })}
              </p>
              <button onClick={onNewAgent} className="text-xs font-medium text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
                <Plus size={11} weight="bold" /> {t('messaging.new_agent', { defaultValue: 'New agent' })}
              </button>
            </div>
            <AgentsGallery orgslug={orgslug} compact onOpenChat={onOpenAgentChat} />
          </div>
        )}
      </div>

      {/* Me */}
      {sessionUser && (
        <div className="border-t border-gray-100 px-3 py-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-gray-50 transition-colors text-start">
                <span className="relative">
                  <PersonAvatar user={sessionUser} size={32} showPresence={false} />
                  <span className={`absolute bottom-0 end-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${connected ? currentAvailability.dot : 'bg-gray-300'}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {sessionUser.first_name} {sessionUser.last_name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {me?.status_text ? `${me.status_emoji} ${me.status_text}` : connected ? currentAvailability.label : t('messaging.connecting', { defaultValue: 'Connecting…' })}
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              <DropdownMenuLabel className="text-xs text-gray-400">{t('messaging.availability', { defaultValue: 'Availability' })}</DropdownMenuLabel>
              {AVAILABILITY.map((a) => (
                <DropdownMenuItem key={a.key} onClick={() => setAvailability(a.key)} className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 rounded-full ${a.dot}`} />
                  <span>
                    <span className="block text-sm">{a.label}</span>
                    <span className="block text-[11px] text-gray-500">{a.hint}</span>
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSettings}>
                <GearSix size={14} className="me-2" /> {t('messaging.set_status', { defaultValue: 'Status & notifications' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
