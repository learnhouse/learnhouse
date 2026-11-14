'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  BellSimple,
  BellSlash,
  ChatsCircle,
  Checks,
  DotsThree,
  GearSix,
  MagnifyingGlass,
  Megaphone,
  NotePencil,
  Plus,
  PushPin,
  PushPinSlash,
} from '@phosphor-icons/react'
import { Button, SearchInput } from '@components/Dashboard/Shared/DashKit/DashKit'
import { messagingKeys, useMessaging } from '@components/Messaging/MessagingProvider'
import { useBroadcastTargets, useConversations } from '@components/Messaging/hooks'
import { ConversationAvatar, PersonAvatar } from '@components/Messaging/ui/Avatars'
import { IconButton, Kbd, UnreadBadge, isTypingTarget, overlayOpen, readDraft } from '@components/Messaging/ui/kit'
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
  markRead,
  otherMember,
  searchMessages,
  updateConversation,
  updateMe,
} from '@services/messaging/messaging'
import { previewText, senderName, shortTime } from '@components/Messaging/utils'
import { AVAILABILITY } from '@components/Messaging/Dialogs/SettingsDialog'
import { useLHSession } from '@components/Contexts/LHSessionContext'

type Filter = 'all' | 'unread' | 'people' | 'groups' | 'courses' | 'agents'

const FILTERS: Filter[] = ['all', 'unread', 'people', 'groups', 'courses', 'agents']
const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  unread: 'Unread',
  people: 'People',
  groups: 'Groups',
  courses: 'Courses',
  agents: 'Agents',
}

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

/** Pin, mute and mark read without opening the chat. */
function RowMenu({ c }: { c: Conversation }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { orgId, token } = useMessaging()
  const patch = async (p: Partial<Pick<Conversation, 'pinned' | 'muted'>>) => {
    if (!token) return
    qc.setQueryData<Conversation[]>(messagingKeys.conversations(orgId ?? 0), (list) =>
      list?.map((x) => (x.conversation_uuid === c.conversation_uuid ? { ...x, ...p } : x))
    )
    await updateConversation(c.conversation_uuid, p, token).catch(() => {
      qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId ?? 0) })
    })
  }
  const read = async () => {
    if (!token) return
    qc.setQueryData<Conversation[]>(messagingKeys.conversations(orgId ?? 0), (list) =>
      list?.map((x) =>
        x.conversation_uuid === c.conversation_uuid ? { ...x, unread_count: 0, last_read_message_id: x.last_message?.id ?? x.last_read_message_id } : x
      )
    )
    await markRead(c.conversation_uuid, token).catch(() => {})
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('messaging.conversation_options', { defaultValue: 'Conversation options' })}
          className="absolute end-2 top-1/2 -translate-y-1/2 hidden h-7 w-7 items-center justify-center rounded-lg bg-white text-neutral-500 shadow-[0_1px_1px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.07)] hover:text-neutral-900 md:group-hover:flex data-[state=open]:flex"
        >
          <DotsThree size={16} weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => patch({ pinned: !c.pinned })}>
          {c.pinned ? <PushPinSlash size={14} className="me-2" /> : <PushPin size={14} className="me-2" />}
          {c.pinned ? t('messaging.unpin', { defaultValue: 'Unpin' }) : t('messaging.pin', { defaultValue: 'Pin' })}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => patch({ muted: !c.muted })}>
          {c.muted ? <BellSimple size={14} className="me-2" /> : <BellSlash size={14} className="me-2" />}
          {c.muted ? t('messaging.unmute', { defaultValue: 'Unmute' }) : t('messaging.mute', { defaultValue: 'Mute' })}
        </DropdownMenuItem>
        {c.unread_count > 0 && (
          <DropdownMenuItem onClick={read}>
            <Checks size={14} className="me-2" /> {t('messaging.mark_read', { defaultValue: 'Mark as read' })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ConversationRow({
  c,
  active,
  onClick,
  menu = false,
}: {
  c: Conversation
  active: boolean
  onClick: () => void
  /** Show the hover menu (pin, mute, mark read). */
  menu?: boolean
}) {
  const { t } = useTranslation()
  const { userId, typing, presence } = useMessaging()
  const title = conversationTitle(c, userId)
  const typers = (typing[c.conversation_uuid] || []).map((x) => x.user.first_name || x.user.username)
  const other = otherMember(c, userId)
  const status = other ? presence[other.id] : undefined
  const last = c.last_message
  const streaming = last?.status === 'streaming'
  const you = t('messaging.you', { defaultValue: 'You' })
  // Read on render only: drafts change while typing in another pane, and the
  // list re-renders often enough (presence, new messages) to stay current.
  const draft = active ? '' : readDraft(c.conversation_uuid)

  let preview: React.ReactNode = previewText(last)
  if (typers.length) {
    preview = (
      <span className="text-emerald-600">
        {typers.length === 1
          ? t('messaging.is_typing', { defaultValue: '{{name}} is typing…', name: typers[0] })
          : t('messaging.people_typing', { defaultValue: '{{count}} people are typing…', count: typers.length })}
      </span>
    )
  } else if (streaming) {
    preview = <span className="text-neutral-500 italic">{t('messaging.writing', { defaultValue: 'Writing…' })}</span>
  } else if (draft) {
    preview = (
      <>
        <span className="font-medium text-rose-600">{t('messaging.draft', { defaultValue: 'Draft' })}:</span> {draft}
      </>
    )
  } else if (last && c.kind !== 'dm' && c.kind !== 'agent' && last.kind !== 'system' && last.sender) {
    const mine = last.sender.type === 'user' && last.sender.id === userId
    preview = `${mine ? you : senderName(last).split(' ')[0]}: ${previewText(last)}`
  } else if (last && last.sender?.type === 'user' && last.sender.id === userId) {
    preview = `${you}: ${previewText(last)}`
  }

  const unread = c.unread_count > 0
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={unread ? `${title}, ${c.unread_count} unread` : title}
        aria-current={active ? 'true' : undefined}
        data-conversation={c.conversation_uuid}
        className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 md:py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15 ${
          active ? 'bg-neutral-100' : 'hover:bg-neutral-50 active:bg-neutral-100'
        }`}
      >
        <ConversationAvatar conversation={c} viewerId={userId} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className={`truncate text-[15px] md:text-sm ${unread ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-800'}`}>
              {title}
            </p>
            {status?.status_emoji && (
              <span className="text-xs" title={status.status_text}>
                {status.status_emoji}
              </span>
            )}
            {c.muted && <BellSlash size={11} className="shrink-0 text-neutral-300" />}
            <span
              className={`ms-auto shrink-0 text-[11px] tabular-nums ${unread ? 'font-semibold text-neutral-900' : 'text-neutral-400'} ${menu ? 'md:group-hover:invisible' : ''}`}
            >
              {shortTime(c.last_message_at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className={`truncate text-[13px] md:text-xs ${unread ? 'text-neutral-700' : 'text-neutral-500'}`}>{preview || ' '}</p>
            <span className="ms-auto flex items-center gap-1">
              {c.pinned && !unread && <PushPin size={11} weight="fill" className="shrink-0 text-neutral-300" />}
              <UnreadBadge count={c.unread_count} muted={c.muted} />
            </span>
          </div>
        </div>
      </button>
      {menu && <RowMenu c={c} />}
    </div>
  )
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2.5 pt-3 pb-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{children}</p>
      {action}
    </div>
  )
}

export function ConversationListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div aria-hidden className="px-0.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-neutral-100" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between gap-6">
              <div className="h-3 animate-pulse rounded bg-neutral-100" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
              <div className="h-2.5 w-8 animate-pulse rounded bg-neutral-100" />
            </div>
            <div className="h-2.5 animate-pulse rounded bg-neutral-100/70" style={{ width: `${55 + ((i * 23) % 35)}%` }} />
          </div>
        </div>
      ))}
    </div>
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
  const { data: conversationsData, isLoading } = useConversations()
  const conversations = useMemo(() => (Array.isArray(conversationsData) ? conversationsData : []), [conversationsData])
  const { data: targets = [] } = useBroadcastTargets()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  const { data: hits = [], isFetching: searching } = useQuery({
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
  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>
    for (const f of FILTERS) out[f] = conversations.filter((c) => !c.archived && matchesFilter(c, f)).length
    return out
  }, [conversations])

  // j/k (or Alt+↑/↓ from anywhere, composer included) walks the list in the
  // order it's shown, pinned first.
  const ordered = useMemo(() => [...pinned, ...rest].map((c) => c.conversation_uuid), [pinned, rest])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || overlayOpen()) return
      const alt = e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      const plain = !e.altKey && !e.shiftKey && (e.key === 'j' || e.key === 'k') && !isTypingTarget(e.target)
      if (!alt && !plain || !ordered.length) return
      e.preventDefault()
      const down = e.key === 'ArrowDown' || e.key === 'j'
      const i = selected ? ordered.indexOf(selected) : -1
      const next = i < 0 ? (down ? 0 : ordered.length - 1) : Math.min(ordered.length - 1, Math.max(0, i + (down ? 1 : -1)))
      if (ordered[next] && ordered[next] !== selected) {
        onSelect(ordered[next])
        listRef.current?.querySelector(`[data-conversation="${ordered[next]}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, selected, onSelect])

  const setAvailability = async (a: Availability) => {
    if (!orgId || !token) return
    try {
      setMe(await updateMe(orgId, { availability: a }, token))
    } catch {
      // ignore
    }
  }
  const currentAvailability = AVAILABILITY.find((a) => a.key === (me?.availability || 'auto')) ?? AVAILABILITY[0]

  const row = (c: Conversation) => (
    <ConversationRow key={c.conversation_uuid} c={c} menu active={c.conversation_uuid === selected} onClick={() => onSelect(c.conversation_uuid)} />
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-lg font-bold tracking-tight text-neutral-900">{t('messaging.title', { defaultValue: 'Messages' })}</h1>
          {!connected && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-400" title={t('messaging.connecting', { defaultValue: 'Connecting…' })}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {targets.length > 0 && (
            <IconButton label={t('messaging.announce', { defaultValue: 'Message everyone in a course' })} onClick={onAnnounce}>
              <Megaphone size={17} />
            </IconButton>
          )}
          <RemindersButton onOpenConversation={(uuid) => onSelect(uuid)} />
          <IconButton label={t('messaging.settings', { defaultValue: 'Messages settings' })} onClick={onSettings}>
            <GearSix size={17} />
          </IconButton>
          <Button
            variant="primary"
            size="sm"
            className="ms-1"
            icon={<NotePencil size={14} weight="bold" />}
            onClick={onNewMessage}
            aria-label={t('messaging.new_message', { defaultValue: 'New message' })}
          >
            <span className="hidden sm:inline md:hidden lg:inline">{t('messaging.new', { defaultValue: 'New' })}</span>
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('messaging.search', { defaultValue: 'Search conversations and messages' })}
          className="[&_input]:text-base md:[&_input]:text-sm"
        />
      </div>

      {/* Filters */}
      <div className="px-3 pb-2">
        <div
          role="tablist"
          aria-label={t('messaging.filter', { defaultValue: 'Filter conversations' })}
          className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {FILTERS.filter((f) => f === 'all' || f === 'unread' || counts[f] > 0 || filter === f).map((f) => {
            const active = filter === f
            const count = f === 'unread' ? counts.unread : 0
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-neutral-900 text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)]'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
              >
                {t(`messaging.filters.${f}`, { defaultValue: FILTER_LABELS[f] })}
                {count > 0 && <span className={`tabular-nums ${active ? 'text-white/60' : 'text-neutral-400'}`}>{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {isLoading && <ConversationListSkeleton />}

        {pinned.length > 0 && (
          <>
            <SectionLabel>{t('messaging.pinned', { defaultValue: 'Pinned' })}</SectionLabel>
            {pinned.map(row)}
            {rest.length > 0 && <SectionLabel>{t('messaging.recent', { defaultValue: 'Recent' })}</SectionLabel>}
          </>
        )}
        <AnimatePresence initial={false}>
          {rest.map((c) => (
            <motion.div key={c.conversation_uuid} layout="position" transition={{ duration: 0.18 }}>
              {row(c)}
            </motion.div>
          ))}
        </AnimatePresence>

        {!isLoading && visible.length === 0 && !hits.length && !(searching && debounced) && (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              {query ? <MagnifyingGlass size={18} /> : filter === 'unread' ? <Checks size={18} /> : <ChatsCircle size={18} weight="fill" />}
            </span>
            <p className="text-sm font-semibold text-neutral-800">
              {query
                ? t('messaging.no_results', { defaultValue: 'No matches' })
                : filter === 'unread'
                  ? t('messaging.all_caught_up', { defaultValue: 'You’re all caught up' })
                  : t('messaging.empty', { defaultValue: 'No conversations yet' })}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {query
                ? t('messaging.no_results_desc', { defaultValue: 'Try another name or a word from the message.' })
                : filter === 'unread'
                  ? t('messaging.all_caught_up_desc', { defaultValue: 'New messages will show up here.' })
                  : t('messaging.empty_list_desc', { defaultValue: 'Start a chat with a classmate or teacher.' })}
            </p>
            {!query && filter === 'all' && (
              <Button variant="primary" size="sm" className="mt-3" icon={<Plus size={12} weight="bold" />} onClick={onNewMessage}>
                {t('messaging.new_message', { defaultValue: 'New message' })}
              </Button>
            )}
            {filter !== 'all' && !query && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setFilter('all')}>
                {t('messaging.show_all', { defaultValue: 'Show all conversations' })}
              </Button>
            )}
          </div>
        )}

        {debounced.length >= 2 && (hits.length > 0 || searching) && (
          <>
            <SectionLabel>{t('messaging.in_messages', { defaultValue: 'In messages' })}</SectionLabel>
            {searching && !hits.length && (
              <div className="space-y-2 px-2.5 py-2" aria-hidden>
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-neutral-100" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-100" />
              </div>
            )}
            {hits.map((m) => (
              <button
                key={m.message_uuid}
                type="button"
                onClick={() => onSelect(m.conversation_uuid, m.message_uuid)}
                className="w-full rounded-xl px-2.5 py-2 text-start hover:bg-neutral-50"
              >
                <p className="truncate text-[11px] text-neutral-400">
                  <span className="font-semibold text-neutral-600">{titleByUuid[m.conversation_uuid] || t('messaging.conversation', { defaultValue: 'Conversation' })}</span> ·{' '}
                  {senderName(m)} · {shortTime(m.creation_date)}
                </p>
                <p className="line-clamp-2 text-sm text-neutral-700">{previewText(m)}</p>
              </button>
            ))}
          </>
        )}

        {/* Agents */}
        {(filter === 'all' || filter === 'agents') && !query && (
          <div className="mt-2 border-t border-neutral-100 pt-1">
            <SectionLabel
              action={
                <button
                  type="button"
                  onClick={onNewAgent}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                >
                  <Plus size={11} weight="bold" /> {t('messaging.new_agent', { defaultValue: 'New agent' })}
                </button>
              }
            >
              {t('messaging.agents', { defaultValue: 'Agents' })}
            </SectionLabel>
            <AgentsGallery orgslug={orgslug} compact onOpenChat={onOpenAgentChat} />
          </div>
        )}
      </div>

      {/* Shortcuts hint, desktop only */}
      <div className="hidden lg:flex items-center gap-3 border-t border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-400">
        <span className="inline-flex items-center gap-1">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> {t('messaging.kbd_move', { defaultValue: 'move' })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>/</Kbd> {t('messaging.kbd_search', { defaultValue: 'search' })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Esc</Kbd> {t('messaging.kbd_close', { defaultValue: 'close' })}
        </span>
      </div>

      {/* Me */}
      {sessionUser && (
        <div className="border-t border-neutral-100 px-2.5 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-start transition-colors hover:bg-neutral-50">
                <span className="relative">
                  <PersonAvatar user={sessionUser} size={32} showPresence={false} />
                  <span
                    className={`absolute bottom-0 end-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${connected ? currentAvailability.dot : 'bg-neutral-300'}`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">
                    {sessionUser.first_name} {sessionUser.last_name}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {me?.status_text
                      ? `${me.status_emoji} ${me.status_text}`
                      : connected
                        ? currentAvailability.label
                        : t('messaging.connecting', { defaultValue: 'Connecting…' })}
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              <DropdownMenuLabel className="text-xs text-neutral-400">{t('messaging.availability', { defaultValue: 'Availability' })}</DropdownMenuLabel>
              {AVAILABILITY.map((a) => (
                <DropdownMenuItem key={a.key} onClick={() => setAvailability(a.key)} className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 rounded-full ${a.dot}`} />
                  <span>
                    <span className="block text-sm">{a.label}</span>
                    <span className="block text-[11px] text-neutral-500">{a.hint}</span>
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
