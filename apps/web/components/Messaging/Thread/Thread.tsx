'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowsOutSimple,
  Archive,
  BellSimple,
  BellSlash,
  BookOpen,
  DotsThreeVertical,
  Minus,
  NotePencil,
  PencilSimple,
  PushPin,
  SignOut,
  SpinnerGap,
  UserPlus,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { MessagesPage, messageOrder, messagingKeys, useMessaging } from '@components/Messaging/MessagingProvider'
import { useAgents, useConversations } from '@components/Messaging/hooks'
import { AvatarStack, ConversationAvatar, PersonAvatar } from '@components/Messaging/ui/Avatars'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import MessageItem, { LocalMessage } from '@components/Messaging/Thread/MessageItem'
import Composer, { ComposerSend } from '@components/Messaging/Thread/Composer'
import NewConversationDialog from '@components/Messaging/Dialogs/NewConversationDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import {
  Agent,
  ChatMessage,
  Conversation,
  CourseCard,
  addMembers,
  conversationTitle,
  deleteMessage,
  displayName,
  editMessage,
  getAgent,
  getConversation,
  leaveConversation,
  listMessages,
  markRead,
  otherMember,
  sendMessage,
  sendTyping,
  toggleReaction,
  updateConversation,
} from '@services/messaging/messaging'
import { getUriWithOrg } from '@services/config/config'
import { useTrackView, AnalyticsEvent } from '@services/analytics'
import { dayLabel, isGrouped, presenceLine, sameDay } from '@components/Messaging/utils'

const NEAR_BOTTOM_PX = 140

function TypingBar({ uuid }: { uuid: string }) {
  const { typing } = useMessaging()
  const names = (typing[uuid] || []).map((x) => x.user.first_name || x.user.username)
  return (
    <div className="h-6 px-5 flex items-center">
      <AnimatePresence>
        {names.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="flex items-center gap-2 text-xs text-gray-500"
          >
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-gray-400"
                  animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
            {names.length === 1
              ? `${names[0]} is typing…`
              : names.length === 2
                ? `${names[0]} and ${names[1]} are typing…`
                : `${names.length} people are typing…`}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AgentIntro({ agent, onPick, compact = false }: { agent: Agent | null; onPick: (text: string) => void; compact?: boolean }) {
  if (!agent) return null
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'pt-6 pb-4 px-2' : 'pt-10 pb-6 px-6'}`}>
      <AgentAvatar agent={agent} size={compact ? 44 : 56} />
      <h2 className="mt-3 text-lg font-bold text-gray-900">{agent.name}</h2>
      {agent.description && <p className="mt-1 max-w-md text-sm text-gray-500">{agent.description}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-1.5 text-xs text-gray-500">
        <span className="rounded-md bg-gray-100 px-2 py-0.5 capitalize">{agent.tone}</span>
        <span className="rounded-md bg-gray-100 px-2 py-0.5">
          {agent.knowledge_mode === 'general' ? 'Courses + general knowledge' : 'Answers from courses'}
        </span>
        {agent.is_default ? (
          <span className="rounded-md bg-gray-100 px-2 py-0.5">All courses</span>
        ) : (
          agent.course_uuids.length > 0 && (
            <span className="rounded-md bg-gray-100 px-2 py-0.5">{agent.course_uuids.length} course{agent.course_uuids.length > 1 ? 's' : ''}</span>
          )
        )}
      </div>
      {agent.starters.length > 0 && (
        <div className={`mt-6 grid gap-2 w-full max-w-xl ${compact ? '' : 'sm:grid-cols-2'}`}>
          {agent.starters.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-start text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Thread({
  uuid,
  orgslug,
  focusMessageUuid,
  initialCourse,
  onBack,
  onLeft,
  onOpenConversation,
  onEditAgent,
  onNewAgentChat,
  variant = 'page',
  onMinimize,
  onExpand,
  onClose,
}: {
  uuid: string
  orgslug: string
  focusMessageUuid?: string | null
  initialCourse?: CourseCard | null
  onBack: () => void
  onLeft: () => void
  onOpenConversation: (c: Conversation) => void
  onEditAgent: (agent: Agent) => void
  onNewAgentChat: (agentUuid: string) => void
  /** 'dock' is the small chat window at the bottom of every page. */
  variant?: 'page' | 'dock'
  onMinimize?: () => void
  onExpand?: () => void
  onClose?: () => void
}) {
  const dock = variant === 'dock'
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { token, userId, orgId, presence, agentProgress, markVisible } = useMessaging()
  const { data: conversations = [] } = useConversations()
  const { data: agents = [] } = useAgents()
  const listItem = conversations.find((c) => c.conversation_uuid === uuid)

  const { data: detail } = useQuery({
    queryKey: ['messaging', 'conversation', uuid],
    queryFn: () => getConversation(uuid, token!),
    enabled: Boolean(token),
    staleTime: 30_000,
  })
  const conversation: Conversation | undefined = useMemo(
    () =>
      detail
        ? {
            ...detail,
            ...(listItem
              ? {
                  unread_count: listItem.unread_count,
                  last_message: listItem.last_message,
                  last_read_message_id: listItem.last_read_message_id,
                  muted: listItem.muted,
                  pinned: listItem.pinned,
                  // Live read receipts land on the list item.
                  members: detail.members.map((m) => {
                    const live = listItem.members.find((x) => x.id === m.id)
                    return live ? { ...m, last_read_message_id: live.last_read_message_id } : m
                  }),
                }
              : {}),
          }
        : listItem,
    [detail, listItem]
  )

  const { data: page, isLoading } = useQuery<MessagesPage>({
    queryKey: messagingKeys.messages(uuid),
    queryFn: () => listMessages(uuid, token!),
    enabled: Boolean(token),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const messages = useMemo(() => (page?.messages || []) as LocalMessage[], [page])

  const agentUuid = conversation?.agent?.agent_uuid
  const { data: agent } = useQuery({
    queryKey: ['messaging', 'agent', agentUuid],
    queryFn: () => getAgent(agentUuid!, token!),
    enabled: Boolean(agentUuid && token),
    staleTime: 60_000,
  })

  // A chat with an agent (Copilot or a custom one) is the AI assistant. Both
  // the page and the dock mount one Thread per conversation, so this counts
  // one open per conversation shown.
  useTrackView(AnalyticsEvent.AiAssistantOpened, { surface: 'copilot' }, conversation?.kind === 'agent', 'learner')

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newBelow, setNewBelow] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const restore = useRef<{ height: number; top: number } | null>(null)
  const nearBottom = useRef(true)
  const lastCount = useRef(0)
  const didInitialScroll = useRef(false)

  // Unread divider: where unread started when the thread was opened.
  const [unreadFrom, setUnreadFrom] = useState<number | null>(null)
  useEffect(() => {
    didInitialScroll.current = false
    setReplyTo(null)
    setEditing(null)
    setNotice(null)
    setNewBelow(0)
    setUnreadFrom(null)
  }, [uuid])
  useEffect(() => {
    if (unreadFrom !== null || !conversation || !page) return
    const first = page.messages.find(
      (m) => m.id > conversation.last_read_message_id && !(m.sender?.type === 'user' && m.sender.id === userId) && m.kind !== 'system'
    )
    setUnreadFrom(first && conversation.unread_count > 0 ? first.id : -1)
  }, [conversation, page, unreadFrom, userId])

  useEffect(() => markVisible(uuid), [uuid, markVisible])

  // Mark read while visible.
  const lastId = messages.length ? messages[messages.length - 1].id : 0
  useEffect(() => {
    if (!token || !conversation || lastId <= 0) return
    if (lastId <= (conversation.last_read_message_id || 0) && !conversation.unread_count) return
    const run = () => {
      if (document.visibilityState !== 'visible') return
      markRead(uuid, token).catch(() => {})
      qc.setQueryData<Conversation[]>(messagingKeys.conversations(orgId ?? 0), (list) =>
        list?.map((c) => (c.conversation_uuid === uuid ? { ...c, unread_count: 0, last_read_message_id: lastId } : c))
      )
    }
    const id = setTimeout(run, 500)
    document.addEventListener('visibilitychange', run)
    return () => {
      clearTimeout(id)
      document.removeEventListener('visibilitychange', run)
    }
  }, [uuid, token, lastId, conversation?.last_read_message_id, conversation?.unread_count, qc, orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scrolling: initial position, keep position when older load, follow new.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !page) return
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
    } else if (!didInitialScroll.current && unreadFrom !== null) {
      didInitialScroll.current = true
      const divider = unreadFrom > 0 ? el.querySelector('[data-unread-divider]') : null
      if (divider) (divider as HTMLElement).scrollIntoView({ block: 'center' })
      else el.scrollTop = el.scrollHeight
    } else if (messages.length > lastCount.current) {
      const latest = messages[messages.length - 1]
      const mine = latest?.sender?.type === 'user' && latest.sender.id === userId
      if (nearBottom.current || mine) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      else setNewBelow((n) => n + (messages.length - lastCount.current))
    }
    lastCount.current = messages.length
  }, [page, messages, unreadFrom, userId])

  // Streaming agent text grows the last message; follow it.
  const lastContentLength = messages.length ? messages[messages.length - 1].content.length : 0
  useEffect(() => {
    const el = scroller.current
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight
  }, [lastContentLength])

  const loadOlder = useCallback(async () => {
    if (!token || !page?.has_more || loadingOlder || !page.messages.length) return
    const el = scroller.current
    setLoadingOlder(true)
    try {
      const older = await listMessages(uuid, token, page.messages[0].id)
      if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop }
      qc.setQueryData<MessagesPage>(messagingKeys.messages(uuid), (cur) =>
        cur ? { has_more: older.has_more, messages: [...older.messages.filter((m) => !cur.messages.some((x) => x.id === m.id)), ...cur.messages] } : cur
      )
      return older
    } finally {
      setLoadingOlder(false)
    }
  }, [token, page, loadingOlder, uuid, qc])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    if (nearBottom.current && newBelow) setNewBelow(0)
    if (el.scrollTop < 200) loadOlder()
  }

  const jumpTo = useCallback(
    async (messageUuid: string) => {
      for (let i = 0; i < 6; i++) {
        const node = document.getElementById(`msg-${messageUuid}`)
        if (node) {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' })
          setHighlight(messageUuid)
          setTimeout(() => setHighlight(null), 1800)
          return
        }
        const older = await loadOlder()
        if (!older) return
        await new Promise((r) => requestAnimationFrame(() => r(null)))
      }
    },
    [loadOlder]
  )

  useEffect(() => {
    if (focusMessageUuid && page) {
      const id = setTimeout(() => jumpTo(focusMessageUuid), 200)
      return () => clearTimeout(id)
    }
  }, [focusMessageUuid, page?.messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const setMessages = (fn: (list: LocalMessage[]) => LocalMessage[]) =>
    qc.setQueryData<MessagesPage>(messagingKeys.messages(uuid), (cur) => (cur ? { ...cur, messages: fn(cur.messages as LocalMessage[]) } : cur))

  const doSend = async (payload: ComposerSend, tempId?: number) => {
    if (!token) return
    const id = tempId ?? -Date.now()
    const me = conversation?.members.find((m) => m.id === userId)
    const temp: LocalMessage = {
      id,
      message_uuid: `local_${id}`,
      conversation_uuid: uuid,
      kind: payload.course ? 'course_share' : 'text',
      content: payload.content,
      attachment: payload.course ? { course: payload.course } : null,
      reply_to: replyTo
        ? { message_uuid: replyTo.message_uuid, content: replyTo.content, kind: replyTo.kind, deleted: false, sender: replyTo.sender }
        : null,
      sender: me ? { type: 'user', ...me } : null,
      reactions: [],
      status: 'complete',
      edited_at: null,
      deleted: false,
      creation_date: new Date().toISOString(),
      _local: 'pending',
      ...({ _payload: payload, _reply: replyTo?.message_uuid } as any),
    }
    setMessages((list) => [...list.filter((m) => m.id !== id), temp])
    const replyUuid = replyTo?.message_uuid
    setReplyTo(null)
    setNotice(null)
    nearBottom.current = true
    try {
      const res = await sendMessage(
        uuid,
        { content: payload.content, course_uuid: payload.course?.course_uuid, reply_to_uuid: replyUuid, agent_uuids: payload.agent_uuids },
        token
      )
      setMessages((list) => {
        const without = list.filter((m) => m.id !== id && m.id !== res.message.id)
        return [...without, res.message].sort(messageOrder)
      })
      if (res.agent_errors.length) setNotice(res.agent_errors.map((e) => (typeof e.detail === 'string' ? e.detail : (e.detail as any)?.message || 'The agent couldn’t answer.')).join(' · '))
    } catch (e: any) {
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, _local: 'failed', _error: e?.message } : m)))
    }
  }

  const retry = (m: LocalMessage) => {
    const payload = (m as any)._payload as ComposerSend | undefined
    if (payload) doSend(payload, m.id)
  }

  const react = async (m: ChatMessage, emoji: string) => {
    if (!token || !userId) return
    setMessages((list) =>
      list.map((x) => {
        if (x.id !== m.id) return x
        const existing = x.reactions.find((r) => r.emoji === emoji)
        let reactions = x.reactions
        if (existing?.me) {
          reactions = reactions
            .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, me: false, user_ids: r.user_ids.filter((u) => u !== userId) } : r))
            .filter((r) => r.count > 0)
        } else if (existing) {
          reactions = reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, me: true, user_ids: [...r.user_ids, userId] } : r))
        } else {
          reactions = [...reactions, { emoji, count: 1, me: true, user_ids: [userId] }]
        }
        return { ...x, reactions }
      })
    )
    try {
      const res = await toggleReaction(m.message_uuid, emoji, token)
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x)))
    } catch {
      qc.invalidateQueries({ queryKey: messagingKeys.messages(uuid) })
    }
  }

  const submitEdit = async (m: ChatMessage, content: string) => {
    if (!token) return
    setEditing(null)
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, content, edited_at: new Date().toISOString() } : x)))
    try {
      const updated = await editMessage(m.message_uuid, content, token)
      setMessages((list) => list.map((x) => (x.id === m.id ? updated : x)))
    } catch (e: any) {
      setNotice(e?.message || 'Could not edit')
      qc.invalidateQueries({ queryKey: messagingKeys.messages(uuid) })
    }
  }

  const remove = async (m: ChatMessage) => {
    if (!token) return
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true, content: '', attachment: null, reactions: [] } : x)))
    try {
      await deleteMessage(m.message_uuid, token)
    } catch (e: any) {
      setNotice(e?.message || 'Could not delete')
      qc.invalidateQueries({ queryKey: messagingKeys.messages(uuid) })
    }
  }

  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.sender?.type === 'user' && m.sender.id === userId && !m.deleted && m.kind === 'text' && !m._local)
    if (mine) setEditing(mine)
  }

  const onTyping = (on: boolean) => {
    if (!token) return
    sendTyping(uuid, on, token).catch(() => {})
  }

  const patchMine = async (patch: Partial<{ muted: boolean; pinned: boolean; archived: boolean }>) => {
    if (!token) return
    qc.setQueryData<Conversation[]>(messagingKeys.conversations(orgId ?? 0), (list) => list?.map((c) => (c.conversation_uuid === uuid ? { ...c, ...patch } : c)))
    await updateConversation(uuid, patch, token).catch(() => {})
    qc.invalidateQueries({ queryKey: ['messaging', 'conversation', uuid] })
  }

  const leave = async () => {
    if (!token) return
    await leaveConversation(uuid, token).catch(() => {})
    qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId ?? 0) })
    onLeft()
  }

  const members = useMemo(() => conversation?.members || [], [conversation])
  const nameOf = useCallback(
    (id: number) => (id === userId ? 'You' : displayName(members.find((m) => m.id === id) as any) || 'Someone'),
    [members, userId]
  )

  // Read receipts sit under your latest message.
  const myLast = useMemo(
    () => [...messages].reverse().find((m) => m.sender?.type === 'user' && m.sender.id === userId && !m._local),
    [messages, userId]
  )
  const others = useMemo(() => members.filter((m) => m.id !== userId), [members, userId])
  const readers = useMemo(
    () =>
      myLast && conversation?.kind === 'group'
        ? others.filter((m) => m.last_read_message_id !== null && (m.last_read_message_id || 0) >= myLast.id)
        : [],
    [myLast, others, conversation?.kind]
  )
  const dmSeen =
    conversation?.kind === 'dm' &&
    myLast !== undefined &&
    others[0]?.last_read_message_id !== null &&
    (others[0]?.last_read_message_id || 0) >= myLast.id

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <SpinnerGap className="animate-spin text-gray-300" size={22} />
      </div>
    )
  }

  const title = conversationTitle(conversation, userId)
  const other = otherMember(conversation, userId)
  const isOwner = conversation.my_role === 'owner' || conversation.my_role === 'admin'
  const disabledReason =
    conversation.kind === 'broadcast' && !isOwner
      ? t('messaging.broadcast_readonly', { defaultValue: 'Only the course team can post here. React to show you’ve seen it.' })
      : null

  let subtitle: React.ReactNode = null
  if (conversation.kind === 'dm' && other) subtitle = presenceLine(presence[other.id]) || 'Offline'
  else if (conversation.kind === 'group') subtitle = `${conversation.member_count} members`
  else if (conversation.kind === 'broadcast')
    subtitle = conversation.course ? (
      <Link href={getUriWithOrg(orgslug, `/course/${conversation.course.course_uuid.replace('course_', '')}`)} className="inline-flex items-center gap-1 hover:underline">
        <BookOpen size={12} /> {conversation.course.name} · {conversation.member_count} people
      </Link>
    ) : (
      `Organization announcements · ${conversation.member_count} people`
    )
  else if (conversation.kind === 'agent') subtitle = conversation.agent?.description || 'AI agent'

  const placeholder =
    conversation.kind === 'agent'
      ? t('messaging.ask_agent', { defaultValue: 'Ask {{name}} anything…', name: title })
      : t('messaging.message_to', { defaultValue: 'Message {{name}}', name: title })

  const showIntro = conversation.kind === 'agent' && !isLoading && messages.filter((m) => m.sender?.type === 'user').length === 0

  return (
    <div className="flex flex-col h-full min-w-0">
      <style>{`@keyframes lhflash{0%{background:rgba(250,204,21,.28)}100%{background:transparent}}.lh-msg-flash{animation:lhflash 1.8s ease-out;border-radius:16px}`}</style>
      {/* Header */}
      <div
        className={
          dock
            ? 'flex items-center gap-2 h-12 ps-2 pe-1 border-b border-gray-100 flex-shrink-0'
            : 'flex items-center gap-3 h-[60px] px-3 md:px-5 border-b border-gray-100 flex-shrink-0'
        }
      >
        {!dock && (
          <button onClick={onBack} className="md:hidden flex h-10 w-10 items-center justify-center -ms-2 rounded-lg text-gray-600 hover:bg-gray-100" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
        )}
        {dock ? (
          <button onClick={onMinimize} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-start hover:bg-gray-50">
            <ConversationAvatar conversation={conversation} viewerId={userId} size={30} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight text-gray-900">{title}</span>
              <span className="block truncate text-[11px] text-gray-500">{subtitle}</span>
            </span>
          </button>
        ) : (
          <>
            <ConversationAvatar conversation={conversation} viewerId={userId} size={36} />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-base text-gray-900 truncate leading-tight">{title}</p>
              <p className="text-xs text-gray-500 truncate">{subtitle}</p>
            </div>
          </>
        )}

        {!dock && conversation.kind === 'group' && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="hidden sm:flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-gray-100">
                <AvatarStack users={members} size={24} max={4} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1.5 rounded-lg">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{conversation.member_count} members</p>
              <div className="max-h-72 overflow-y-auto">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                    <PersonAvatar user={m} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {displayName(m)} {m.id === userId && <span className="text-gray-400 font-normal">(you)</span>}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">{presenceLine(presence[m.id]) || 'Offline'}</p>
                    </div>
                    {m.role === 'owner' && <span className="text-[10px] text-gray-400">Owner</span>}
                  </div>
                ))}
              </div>
              <button onClick={() => setAddOpen(true)} className="mt-1 w-full flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-gray-50">
                <UserPlus size={15} /> Add people
              </button>
            </PopoverContent>
          </Popover>
        )}

        {!dock && conversation.kind === 'agent' && agentUuid && (
          <button
            onClick={() => onNewAgentChat(agentUuid)}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <NotePencil size={14} /> New chat
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`${dock ? 'p-1.5' : 'p-2'} rounded-lg text-gray-500 hover:bg-gray-100`} aria-label="Conversation options">
              <DotsThreeVertical size={dock ? 16 : 18} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => patchMine({ pinned: !conversation.pinned })}>
              <PushPin size={14} className="me-2" /> {conversation.pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => patchMine({ muted: !conversation.muted })}>
              {conversation.muted ? <BellSimple size={14} className="me-2" /> : <BellSlash size={14} className="me-2" />}
              {conversation.muted ? 'Unmute' : 'Mute'}
            </DropdownMenuItem>
            {conversation.kind === 'group' && (
              <DropdownMenuItem onClick={() => setAddOpen(true)}>
                <UserPlus size={14} className="me-2" /> Add people
              </DropdownMenuItem>
            )}
            {conversation.kind === 'agent' && agent?.can_edit && (
              <DropdownMenuItem onClick={() => onEditAgent(agent)}>
                <PencilSimple size={14} className="me-2" /> Edit agent
              </DropdownMenuItem>
            )}
            {conversation.kind === 'agent' && agentUuid && (
              <DropdownMenuItem onClick={() => onNewAgentChat(agentUuid)}>
                <NotePencil size={14} className="me-2" /> New chat
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {conversation.kind === 'dm' || conversation.kind === 'agent' ? (
              <DropdownMenuItem onClick={leave}>
                <Archive size={14} className="me-2" /> Archive
              </DropdownMenuItem>
            ) : (
              conversation.kind === 'group' && (
                <DropdownMenuItem onClick={leave} className="text-red-600">
                  <SignOut size={14} className="me-2" /> Leave group
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {dock && (
          <>
            <button onClick={onMinimize} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Minimize" title="Minimize">
              <Minus size={16} weight="bold" />
            </button>
            <button onClick={onExpand} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Open in Messages" title="Open in Messages">
              <ArrowsOutSimple size={16} weight="bold" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Close chat" title="Close">
              <X size={16} weight="bold" />
            </button>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scroller} onScroll={onScroll} className={`h-full overflow-y-auto pb-2 ${dock ? 'px-2.5' : 'px-3 md:px-6'}`}>
          {page?.has_more && (
            <div className="flex justify-center py-3">
              {loadingOlder ? (
                <SpinnerGap className="animate-spin text-gray-300" />
              ) : (
                <button onClick={loadOlder} className="text-xs text-gray-400 hover:text-gray-700">
                  Load earlier messages
                </button>
              )}
            </div>
          )}
          {isLoading && (
            <div className="space-y-4 pt-6">
              {[48, 72, 36, 60].map((w, i) => (
                <div key={i} className={`flex gap-3 animate-pulse ${i % 2 ? 'flex-row-reverse' : ''}`}>
                  <div className="h-9 w-9 rounded-full bg-gray-100" />
                  <div className="h-10 rounded-xl bg-gray-100" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          )}
          {showIntro && <AgentIntro agent={agent || null} compact={dock} onPick={(s) => doSend({ content: s, agent_uuids: [] })} />}

          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = !prev || !sameDay(prev.creation_date, m.creation_date)
            const showUnread = unreadFrom !== null && unreadFrom > 0 && m.id === unreadFrom
            const mine = m.sender?.type === 'user' && m.sender.id === userId
            return (
              <React.Fragment key={m.id}>
                {newDay && (
                  <div className="flex items-center gap-3 py-3">
                    <span className="h-px flex-1 bg-gray-100" />
                    <span className="text-[11px] font-medium text-gray-400">{dayLabel(m.creation_date)}</span>
                    <span className="h-px flex-1 bg-gray-100" />
                  </div>
                )}
                {showUnread && (
                  <div data-unread-divider className="flex items-center gap-3 py-2">
                    <span className="h-px flex-1 bg-red-200" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-red-500">New</span>
                    <span className="h-px flex-1 bg-red-200" />
                  </div>
                )}
                <MessageItem
                  message={m}
                  grouped={!newDay && !showUnread && isGrouped(prev, m)}
                  mine={mine}
                  viewerId={userId}
                  orgslug={orgslug}
                  progress={agentProgress[m.id]}
                  highlighted={highlight === m.message_uuid}
                  canModerate={isOwner && conversation.kind !== 'dm'}
                  readers={m.id === myLast?.id ? readers : []}
                  showSeen={m.id === myLast?.id && dmSeen}
                  nameOf={nameOf}
                  onReact={react}
                  onReply={setReplyTo}
                  onEdit={setEditing}
                  onDelete={remove}
                  onJumpTo={jumpTo}
                  onFollowUp={(text) => doSend({ content: text, agent_uuids: [] })}
                  onRetry={retry}
                />
              </React.Fragment>
            )
          })}
          <div className="h-2" />
        </div>

        <AnimatePresence>
          {newBelow > 0 && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={() => {
                scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
                setNewBelow(0)
              }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
            >
              <ArrowDown size={12} weight="bold" /> {newBelow} new message{newBelow > 1 ? 's' : ''}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {notice && (
        <div className="mx-4 mb-1 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <WarningCircle size={14} />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      <TypingBar uuid={uuid} />
      <Composer
        orgslug={orgslug}
        placeholder={placeholder}
        disabledReason={disabledReason}
        agents={agents}
        members={others}
        replyTo={replyTo}
        editing={editing}
        initialCourse={initialCourse}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onSend={(p) => doSend(p)}
        onSubmitEdit={submitEdit}
        onEditLast={editLast}
        onTyping={onTyping}
        compact={dock}
      />

      <NewConversationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add people"
        excludeUserIds={members.map((m) => m.id)}
        onPickPeople={async (people) => {
          if (!token) return
          const updated = await addMembers(uuid, people.map((p) => p.user_uuid), token)
          qc.setQueryData(['messaging', 'conversation', uuid], updated)
          qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId ?? 0) })
        }}
        onCreated={onOpenConversation}
      />
    </div>
  )
}
