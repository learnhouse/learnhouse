'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useMediaQuery } from 'usehooks-ts'
import {
  ArrowDown,
  ArrowLeft,
  ArrowsOutSimple,
  Archive,
  BellSimple,
  BellSlash,
  BookOpen,
  DotsThree,
  Info,
  Minus,
  NotePencil,
  PencilSimple,
  PushPin,
  SignOut,
  UserPlus,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { Button, buttonClass, useStoredState } from '@components/Dashboard/Shared/DashKit/DashKit'
import { MessagesPage, messageOrder, messagingKeys, useMessaging } from '@components/Messaging/MessagingProvider'
import { useAgents, useConversations } from '@components/Messaging/hooks'
import { AvatarStack, ConversationAvatar } from '@components/Messaging/ui/Avatars'
import { IconButton } from '@components/Messaging/ui/kit'
import MessageItem, { LocalMessage } from '@components/Messaging/Thread/MessageItem'
import {
  AgentIntro,
  DaySeparator,
  DetailsPanel,
  MessagesSkeleton,
  ThreadSkeleton,
  TypingIndicator,
  UnreadDivider,
} from '@components/Messaging/Thread/ThreadParts'
import Composer, { ComposerSend } from '@components/Messaging/Thread/Composer'
import NewConversationDialog from '@components/Messaging/Dialogs/NewConversationDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
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
import { isGrouped, presenceLine, sameDay } from '@components/Messaging/utils'

const NEAR_BOTTOM_PX = 140

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
  const [atBottom, setAtBottom] = useState(true)

  // Details panel: beside the thread on wide screens (remembered), floating
  // over it on narrower ones (per visit). Never in the dock.
  const wide = useMediaQuery('(min-width: 1280px)', { initializeWithValue: false })
  const [detailsPref, setDetailsPref] = useStoredState<'open' | 'closed'>('lh-msg-details', 'closed', ['open', 'closed'])
  const [overlayDetails, setOverlayDetails] = useState(false)
  const detailsOpen = !dock && (wide ? detailsPref === 'open' : overlayDetails)
  const toggleDetails = () => {
    if (dock) return
    if (wide) setDetailsPref(detailsPref === 'open' ? 'closed' : 'open')
    else setOverlayDetails((v) => !v)
  }
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
    if (nearBottom.current !== atBottom) setAtBottom(nearBottom.current)
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
    (id: number) =>
      id === userId
        ? t('messaging.you', { defaultValue: 'You' })
        : displayName(members.find((m) => m.id === id) as any) || t('messaging.someone', { defaultValue: 'Someone' }),
    [members, userId, t]
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

  // One section per day so each sticky day pill only sticks over its own day.
  const days = useMemo(() => {
    const out: { key: string; iso: string; idx: number[] }[] = []
    messages.forEach((m, i) => {
      const prev = messages[i - 1]
      if (!prev || !sameDay(prev.creation_date, m.creation_date)) out.push({ key: new Date(m.creation_date).toDateString(), iso: m.creation_date, idx: [] })
      out[out.length - 1].idx.push(i)
    })
    return out
  }, [messages])

  if (!conversation) return <ThreadSkeleton compact={dock} />

  const title = conversationTitle(conversation, userId)
  const other = otherMember(conversation, userId)
  const isOwner = conversation.my_role === 'owner' || conversation.my_role === 'admin'
  const disabledReason =
    conversation.kind === 'broadcast' && !isOwner
      ? t('messaging.broadcast_readonly', { defaultValue: 'Only the course team can post here. React to show you’ve seen it.' })
      : null

  let subtitle: React.ReactNode = null
  if (conversation.kind === 'dm' && other) subtitle = presenceLine(presence[other.id]) || t('messaging.offline', { defaultValue: 'Offline' })
  else if (conversation.kind === 'group') subtitle = t('messaging.members_count', { defaultValue: '{{count}} members', count: conversation.member_count })
  else if (conversation.kind === 'broadcast')
    subtitle = conversation.course ? (
      <Link
        href={getUriWithOrg(orgslug, `/course/${conversation.course.course_uuid.replace('course_', '')}`)}
        className="inline-flex items-center gap-1 hover:text-neutral-800 hover:underline"
      >
        <BookOpen size={12} /> {conversation.course.name} · {t('messaging.people_count', { defaultValue: '{{count}} people', count: conversation.member_count })}
      </Link>
    ) : (
      t('messaging.org_announcements_count', { defaultValue: 'Organization announcements · {{count}} people', count: conversation.member_count })
    )
  else if (conversation.kind === 'agent') subtitle = conversation.agent?.description || t('messaging.ai_agent', { defaultValue: 'AI agent' })

  const online = conversation.kind === 'dm' && other && presence[other.id]?.state === 'online'

  const placeholder =
    conversation.kind === 'agent'
      ? t('messaging.ask_agent', { defaultValue: 'Ask {{name}} anything…', name: title })
      : t('messaging.message_to', { defaultValue: 'Message {{name}}', name: title })

  const showIntro = conversation.kind === 'agent' && !isLoading && messages.filter((m) => m.sender?.type === 'user').length === 0

  const scrollToBottom = () => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
    setNewBelow(0)
  }

  const optionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('messaging.conversation_options', { defaultValue: 'Conversation options' })} size={dock ? 'sm' : 'md'}>
          <DotsThree size={dock ? 16 : 18} weight="bold" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => patchMine({ pinned: !conversation.pinned })}>
          <PushPin size={14} className="me-2" />{' '}
          {conversation.pinned ? t('messaging.unpin', { defaultValue: 'Unpin' }) : t('messaging.pin', { defaultValue: 'Pin' })}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => patchMine({ muted: !conversation.muted })}>
          {conversation.muted ? <BellSimple size={14} className="me-2" /> : <BellSlash size={14} className="me-2" />}
          {conversation.muted ? t('messaging.unmute', { defaultValue: 'Unmute' }) : t('messaging.mute', { defaultValue: 'Mute' })}
        </DropdownMenuItem>
        {conversation.kind === 'group' && (
          <DropdownMenuItem onClick={() => setAddOpen(true)}>
            <UserPlus size={14} className="me-2" /> {t('messaging.add_people', { defaultValue: 'Add people' })}
          </DropdownMenuItem>
        )}
        {conversation.kind === 'agent' && agent?.can_edit && (
          <DropdownMenuItem onClick={() => onEditAgent(agent)}>
            <PencilSimple size={14} className="me-2" /> {t('messaging.edit_agent', { defaultValue: 'Edit agent' })}
          </DropdownMenuItem>
        )}
        {conversation.kind === 'agent' && agentUuid && (
          <DropdownMenuItem onClick={() => onNewAgentChat(agentUuid)}>
            <NotePencil size={14} className="me-2" /> {t('messaging.new_chat', { defaultValue: 'New chat' })}
          </DropdownMenuItem>
        )}
        {!dock && (
          <DropdownMenuItem onClick={toggleDetails}>
            <Info size={14} className="me-2" />{' '}
            {detailsOpen ? t('messaging.hide_details', { defaultValue: 'Hide details' }) : t('messaging.show_details', { defaultValue: 'Show details' })}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {conversation.kind === 'dm' || conversation.kind === 'agent' ? (
          <DropdownMenuItem onClick={leave}>
            <Archive size={14} className="me-2" /> {t('messaging.archive', { defaultValue: 'Archive' })}
          </DropdownMenuItem>
        ) : (
          conversation.kind === 'group' && (
            <DropdownMenuItem onClick={leave} className="text-rose-600">
              <SignOut size={14} className="me-2" /> {t('messaging.leave_group', { defaultValue: 'Leave group' })}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="relative flex h-full min-w-0">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <style>{`@keyframes lhflash{0%{background:rgba(250,204,21,.22)}100%{background:transparent}}.lh-msg-flash{animation:lhflash 1.8s ease-out;border-radius:16px}`}</style>
        {/* Header */}
        <div
          className={
            dock
              ? 'flex h-12 shrink-0 items-center gap-1 border-b border-neutral-100 ps-1.5 pe-1'
              : 'flex h-14 shrink-0 items-center gap-2 border-b border-neutral-100 ps-2 pe-3 md:ps-5 md:pe-4'
          }
        >
          {!dock && (
            <button
              type="button"
              onClick={onBack}
              className="md:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100"
              aria-label={t('common.back', { defaultValue: 'Back' })}
            >
              <ArrowLeft size={20} className="rtl:rotate-180" />
            </button>
          )}
          {dock ? (
            <button
              type="button"
              onClick={onMinimize}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-start hover:bg-neutral-50"
            >
              <ConversationAvatar conversation={conversation} viewerId={userId} size={30} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold leading-tight text-neutral-900">{title}</span>
                <span className={`block truncate text-[11px] ${online ? 'text-emerald-600' : 'text-neutral-500'}`}>{subtitle}</span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleDetails}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pe-2 text-start md:-ms-1.5 md:ps-1.5 md:hover:bg-neutral-50"
              aria-label={t('messaging.show_details', { defaultValue: 'Show details' })}
            >
              <ConversationAvatar conversation={conversation} viewerId={userId} size={36} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold leading-tight text-neutral-900">{title}</span>
                  {conversation.muted && <BellSlash size={12} className="shrink-0 text-neutral-300" />}
                </span>
                <span className={`block truncate text-xs ${online ? 'text-emerald-600' : 'text-neutral-500'}`}>{subtitle}</span>
              </span>
            </button>
          )}

          {!dock && conversation.kind === 'group' && (
            <button
              type="button"
              onClick={toggleDetails}
              className="hidden sm:flex items-center rounded-lg px-1.5 py-1 hover:bg-neutral-100"
              aria-label={t('messaging.members', { defaultValue: 'Members' })}
            >
              <AvatarStack users={members} size={24} max={4} />
            </button>
          )}

          {!dock && conversation.kind === 'agent' && agentUuid && (
            <Button
              size="sm"
              className="hidden sm:inline-flex"
              icon={<NotePencil size={13} />}
              onClick={() => onNewAgentChat(agentUuid)}
            >
              {t('messaging.new_chat', { defaultValue: 'New chat' })}
            </Button>
          )}

          {!dock && (
            <IconButton
              label={detailsOpen ? t('messaging.hide_details', { defaultValue: 'Hide details' }) : t('messaging.show_details', { defaultValue: 'Show details' })}
              active={detailsOpen}
              onClick={toggleDetails}
            >
              <Info size={18} weight={detailsOpen ? 'fill' : 'regular'} />
            </IconButton>
          )}
          {optionsMenu}
          {dock && (
            <>
              <IconButton size="sm" label={t('messaging.minimize', { defaultValue: 'Minimize' })} onClick={onMinimize}>
                <Minus size={15} weight="bold" />
              </IconButton>
              <IconButton size="sm" label={t('messaging.open_in_messages', { defaultValue: 'Open in Messages' })} onClick={onExpand}>
                <ArrowsOutSimple size={15} weight="bold" />
              </IconButton>
              <IconButton size="sm" label={t('messaging.close_chat', { defaultValue: 'Close chat' })} onClick={onClose}>
                <X size={15} weight="bold" />
              </IconButton>
            </>
          )}
        </div>

        {/* Messages */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={scroller}
            onScroll={onScroll}
            className={`h-full overflow-y-auto overscroll-contain pb-2 ${dock ? 'px-3' : 'px-3 md:px-6'}`}
          >
            {page?.has_more && (
              <div className="flex justify-center py-3">
                {loadingOlder ? (
                  <div className="w-full">
                    <MessagesSkeleton compact={dock} />
                  </div>
                ) : (
                  <button type="button" onClick={loadOlder} className={buttonClass('ghost', 'sm', 'text-neutral-500')}>
                    {t('messaging.load_earlier', { defaultValue: 'Load earlier messages' })}
                  </button>
                )}
              </div>
            )}
            {isLoading && <MessagesSkeleton compact={dock} />}
            {showIntro && <AgentIntro agent={agent || null} compact={dock} onPick={(s) => doSend({ content: s, agent_uuids: [] })} />}

            {days.map((day) => (
              <section key={day.key}>
                <DaySeparator iso={day.iso} />
                {day.idx.map((i) => {
                  const m = messages[i]
                  const prev = messages[i - 1]
                  const next = messages[i + 1]
                  const first = day.idx[0] === i
                  const showUnread = unreadFrom !== null && unreadFrom > 0 && m.id === unreadFrom
                  const nextBreaks =
                    !next || !sameDay(m.creation_date, next.creation_date) || (unreadFrom !== null && unreadFrom > 0 && next.id === unreadFrom)
                  const mine = m.sender?.type === 'user' && m.sender.id === userId
                  return (
                    <React.Fragment key={m.id}>
                      {showUnread && <UnreadDivider />}
                      <MessageItem
                        message={m}
                        grouped={!first && !showUnread && isGrouped(prev, m)}
                        groupedNext={!nextBreaks && isGrouped(m, next)}
                        mine={mine}
                        viewerId={userId}
                        orgslug={orgslug}
                        progress={agentProgress[m.id]}
                        highlighted={highlight === m.message_uuid}
                        canModerate={isOwner && conversation.kind !== 'dm'}
                        readers={m.id === myLast?.id ? readers : []}
                        showSeen={m.id === myLast?.id && dmSeen}
                        nameOf={nameOf}
                        compact={dock}
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
              </section>
            ))}
            <div className="h-2" />
          </div>

          <AnimatePresence>
            {(newBelow > 0 || !atBottom) && messages.length > 0 && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                onClick={scrollToBottom}
                aria-label={t('messaging.jump_latest', { defaultValue: 'Jump to latest' })}
                className={
                  newBelow > 0
                    ? 'absolute bottom-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-black/10'
                    : 'absolute bottom-3 end-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-600 shadow-md ring-1 ring-neutral-200 hover:text-neutral-900'
                }
              >
                <ArrowDown size={newBelow > 0 ? 12 : 15} weight="bold" />
                {newBelow > 0 && t('messaging.new_below', { defaultValue: '{{count}} new messages', count: newBelow })}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {notice && (
          <div
            className={`${dock ? 'mx-2' : 'mx-3 md:mx-4'} mb-1 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/15`}
          >
            <WarningCircle size={14} className="shrink-0" />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label={t('common.close', { defaultValue: 'Close' })} className="rounded p-0.5 hover:bg-amber-100">
              <X size={12} />
            </button>
          </div>
        )}

        <TypingIndicator uuid={uuid} compact={dock} />
        <Composer
          orgslug={orgslug}
          placeholder={placeholder}
          disabledReason={disabledReason}
          agents={agents}
          members={others}
          replyTo={replyTo}
          editing={editing}
          initialCourse={initialCourse}
          draftKey={uuid}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSend={(p) => doSend(p)}
          onSubmitEdit={submitEdit}
          onEditLast={editLast}
          onTyping={onTyping}
          compact={dock}
        />
      </div>

      <AnimatePresence initial={false}>
        {detailsOpen && (
          <DetailsPanel
            key="details"
            conversation={conversation}
            agent={agent}
            members={members}
            messages={messages}
            orgslug={orgslug}
            overlay={!wide}
            onClose={toggleDetails}
            onPatch={patchMine}
            onAddPeople={() => setAddOpen(true)}
            onEditAgent={onEditAgent}
            onNewAgentChat={onNewAgentChat}
            onLeave={leave}
          />
        )}
      </AnimatePresence>

      <NewConversationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t('messaging.add_people', { defaultValue: 'Add people' })}
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
