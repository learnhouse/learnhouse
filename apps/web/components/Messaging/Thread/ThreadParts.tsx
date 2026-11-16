'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  BellSimple,
  BellSlash,
  BookOpen,
  Books,
  GlobeSimple,
  LinkSimple,
  NotePencil,
  PencilSimple,
  PushPin,
  PushPinSlash,
  SignOut,
  UserPlus,
  X,
} from '@phosphor-icons/react'
import { Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useMessaging } from '@components/Messaging/MessagingProvider'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import { ConversationAvatar, CourseThumb, PersonAvatar } from '@components/Messaging/ui/Avatars'
import { IconButton } from '@components/Messaging/ui/kit'
import { Agent, ChatMessage, Conversation, CourseCard, UserSummary, conversationTitle, displayName } from '@services/messaging/messaging'
import { getUriWithOrg } from '@services/config/config'
import { dayLabel, presenceLine } from '@components/Messaging/utils'

/** Who's typing, as a small bubble with bouncing dots. Height is reserved so the list doesn't jump. */
export function TypingIndicator({ uuid, compact = false }: { uuid: string; compact?: boolean }) {
  const { t } = useTranslation()
  const { typing } = useMessaging()
  const names = (typing[uuid] || []).map((x) => x.user.first_name || x.user.username)
  const label =
    names.length === 1
      ? t('messaging.is_typing', { defaultValue: '{{name}} is typing…', name: names[0] })
      : names.length === 2
        ? t('messaging.two_typing', { defaultValue: '{{a}} and {{b}} are typing…', a: names[0], b: names[1] })
        : t('messaging.people_typing', { defaultValue: '{{count}} people are typing…', count: names.length })
  return (
    <div className={`flex h-6 items-center ${compact ? 'px-3' : 'px-4 md:px-6'}`} aria-live="polite">
      <AnimatePresence>
        {names.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="flex items-center gap-2 text-xs text-neutral-500"
          >
            <span className="flex h-5 items-center gap-0.5 rounded-full bg-neutral-100 px-2">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-neutral-400"
                  animate={{ y: [0, -2.5, 0], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
            <span className="truncate">{label}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Sticky day pill. Each day is its own section, so a pill only sticks while its day is on screen. */
export function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="pointer-events-none sticky top-2 z-[5] flex justify-center py-2">
      <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-500 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-neutral-200/80 backdrop-blur">
        {dayLabel(iso)}
      </span>
    </div>
  )
}

export function UnreadDivider() {
  const { t } = useTranslation()
  return (
    <div data-unread-divider className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-rose-200" />
      <span className="text-[11px] font-semibold text-rose-500">{t('messaging.new_messages', { defaultValue: 'New messages' })}</span>
      <span className="h-px flex-1 bg-rose-200" />
    </div>
  )
}

/** Placeholder bubbles while a thread loads. */
export function MessagesSkeleton({ compact = false }: { compact?: boolean }) {
  const rows: { mine: boolean; w: number; h?: number }[] = [
    { mine: false, w: 46 },
    { mine: false, w: 30 },
    { mine: true, w: 38 },
    { mine: false, w: 58, h: 56 },
    { mine: true, w: 26 },
  ]
  return (
    <div aria-hidden className="space-y-2.5 pt-6">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-end gap-2.5 ${r.mine ? 'flex-row-reverse' : ''}`}>
          {!r.mine && !compact && <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-neutral-100" />}
          <div
            className={`animate-pulse rounded-2xl ${r.mine ? 'bg-neutral-200/70' : 'bg-neutral-100'}`}
            style={{ width: `${r.w}%`, height: r.h ?? 36 }}
          />
        </div>
      ))}
    </div>
  )
}

/** Whole-thread placeholder: header plus bubbles. */
export function ThreadSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex h-full min-w-0 flex-col" aria-busy>
      <div className={`flex shrink-0 items-center gap-3 border-b border-neutral-100 ${compact ? 'h-12 px-3' : 'h-14 px-4 md:px-5'}`}>
        <div className={`${compact ? 'h-7 w-7' : 'h-9 w-9'} animate-pulse rounded-full bg-neutral-100`} />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-32 animate-pulse rounded bg-neutral-100" />
          <div className="h-2.5 w-20 animate-pulse rounded bg-neutral-100/70" />
        </div>
      </div>
      <div className={`flex-1 overflow-hidden ${compact ? 'px-3' : 'px-4 md:px-6'}`}>
        <MessagesSkeleton compact={compact} />
      </div>
    </div>
  )
}

export function AgentIntro({ agent, onPick, compact = false }: { agent: Agent | null; onPick: (text: string) => void; compact?: boolean }) {
  const { t } = useTranslation()
  if (!agent) return null
  const starters = Array.isArray(agent.starters) ? agent.starters : []
  const courses = Array.isArray(agent.course_uuids) ? agent.course_uuids.length : 0
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'px-2 pt-6 pb-4' : 'px-6 pt-12 pb-6'}`}>
      <AgentAvatar agent={agent} size={compact ? 44 : 60} />
      <h2 className="mt-3 text-lg font-bold tracking-tight text-neutral-900">{agent.name}</h2>
      {agent.description && <p className="mt-1 max-w-md text-sm text-neutral-500">{agent.description}</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {agent.tone && <Chip className="capitalize">{agent.tone}</Chip>}
        <Chip icon={agent.knowledge_mode === 'general' ? <GlobeSimple size={11} /> : <BookOpen size={11} />}>
          {agent.knowledge_mode === 'general'
            ? t('messaging.agent_general', { defaultValue: 'Courses + general knowledge' })
            : t('messaging.agent_courses_only', { defaultValue: 'Answers from courses' })}
        </Chip>
        <Chip icon={<Books size={11} />}>
          {agent.is_default || !courses
            ? t('messaging.agent_all_courses', { defaultValue: 'All courses' })
            : t('messaging.agent_course_count', { defaultValue: '{{count}} courses', count: courses })}
        </Chip>
      </div>
      {starters.length > 0 && (
        <div className={`mt-7 grid w-full max-w-xl gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-xl bg-white px-3.5 py-2.5 text-start text-sm text-neutral-700 ring-1 ring-inset ring-neutral-200 transition-all hover:bg-neutral-50 hover:ring-neutral-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const LINK_RE = /https?:\/\/[^\s<>()[\]"'`]+/g

/** Courses and links shared in the messages loaded so far, newest first. */
function useShared(messages: ChatMessage[]) {
  return useMemo(() => {
    const courses = new Map<string, CourseCard>()
    const links = new Map<string, string>()
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.deleted) continue
      const c = m.attachment?.course
      if (c && !courses.has(c.course_uuid)) courses.set(c.course_uuid, c)
      if (m.sender?.type === 'user') {
        for (const url of m.content.match(LINK_RE) || []) {
          const clean = url.replace(/[.,;:!?]+$/, '')
          if (!links.has(clean)) links.set(clean, m.message_uuid)
        }
      }
    }
    return { courses: [...courses.values()].slice(0, 6), links: [...links.keys()].slice(0, 8) }
  }, [messages])
}

function PanelSection({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <section className="border-t border-neutral-100 px-4 py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        {title}
        {count !== undefined && <span className="tabular-nums text-neutral-300">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

function ActionTile({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors ${
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
      }`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-full ${danger ? 'bg-rose-50' : 'bg-neutral-100'}`}>{icon}</span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

/** The details side panel: who's here, what's been shared, and the chat's settings. */
export function DetailsPanel({
  conversation,
  agent,
  members,
  messages,
  orgslug,
  onClose,
  onPatch,
  onAddPeople,
  onEditAgent,
  onNewAgentChat,
  onLeave,
  overlay,
}: {
  conversation: Conversation
  agent: Agent | undefined
  members: (UserSummary & { role?: string })[]
  messages: ChatMessage[]
  orgslug: string
  onClose: () => void
  onPatch: (patch: Partial<{ muted: boolean; pinned: boolean }>) => void
  onAddPeople: () => void
  onEditAgent: (a: Agent) => void
  onNewAgentChat: (agentUuid: string) => void
  onLeave: () => void
  /** Floats over the thread (narrow screens) instead of sitting beside it. */
  overlay: boolean
}) {
  const { t } = useTranslation()
  const { userId, presence } = useMessaging()
  const shared = useShared(messages)
  const title = conversationTitle(conversation, userId)
  const kind = conversation.kind
  const other = kind === 'dm' ? members.find((m) => m.id !== userId) : undefined

  let subtitle: React.ReactNode = null
  if (kind === 'dm' && other) subtitle = `@${other.username}`
  else if (kind === 'group') subtitle = t('messaging.members_count', { defaultValue: '{{count}} members', count: conversation.member_count })
  else if (kind === 'broadcast') subtitle = conversation.course?.name || t('messaging.org_announcements', { defaultValue: 'Organization announcements' })
  else if (kind === 'agent') subtitle = t('messaging.ai_agent', { defaultValue: 'AI agent' })

  const shownMembers = kind === 'group' ? members : []

  return (
    <motion.aside
      initial={overlay ? { opacity: 0, x: 16 } : false}
      animate={{ opacity: 1, x: 0 }}
      exit={overlay ? { opacity: 0, x: 16 } : undefined}
      transition={{ duration: 0.16 }}
      aria-label={t('messaging.details', { defaultValue: 'Details' })}
      className={`flex w-[300px] max-w-full shrink-0 flex-col bg-white ${
        overlay ? 'absolute inset-y-0 end-0 z-20 shadow-2xl ring-1 ring-black/5' : 'border-s border-neutral-100'
      }`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between ps-4 pe-2">
        <p className="text-sm font-semibold text-neutral-900">{t('messaging.details', { defaultValue: 'Details' })}</p>
        <IconButton label={t('messaging.close_details', { defaultValue: 'Close details' })} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col items-center px-4 pb-4 text-center">
          <ConversationAvatar conversation={conversation} viewerId={userId} size={64} />
          <p className="mt-3 max-w-full truncate text-base font-bold text-neutral-900">{title}</p>
          {subtitle && <p className="mt-0.5 max-w-full truncate text-xs text-neutral-500">{subtitle}</p>}
          {other && <p className="mt-1 text-xs text-neutral-400">{presenceLine(presence[other.id]) || t('messaging.offline', { defaultValue: 'Offline' })}</p>}
          {kind === 'agent' && conversation.agent?.description && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">{conversation.agent.description}</p>
          )}
        </div>

        <div className="flex gap-1 px-3 pb-3">
          <ActionTile
            icon={conversation.pinned ? <PushPinSlash size={15} /> : <PushPin size={15} />}
            label={conversation.pinned ? t('messaging.unpin', { defaultValue: 'Unpin' }) : t('messaging.pin', { defaultValue: 'Pin' })}
            onClick={() => onPatch({ pinned: !conversation.pinned })}
          />
          <ActionTile
            icon={conversation.muted ? <BellSimple size={15} /> : <BellSlash size={15} />}
            label={conversation.muted ? t('messaging.unmute', { defaultValue: 'Unmute' }) : t('messaging.mute', { defaultValue: 'Mute' })}
            onClick={() => onPatch({ muted: !conversation.muted })}
          />
          {kind === 'group' && (
            <ActionTile icon={<UserPlus size={15} />} label={t('messaging.add', { defaultValue: 'Add' })} onClick={onAddPeople} />
          )}
          {kind === 'agent' && conversation.agent && (
            <ActionTile
              icon={<NotePencil size={15} />}
              label={t('messaging.new_chat', { defaultValue: 'New chat' })}
              onClick={() => onNewAgentChat(conversation.agent!.agent_uuid)}
            />
          )}
          {kind === 'agent' && agent?.can_edit && (
            <ActionTile icon={<PencilSimple size={15} />} label={t('messaging.edit', { defaultValue: 'Edit' })} onClick={() => onEditAgent(agent)} />
          )}
        </div>

        {kind === 'broadcast' && conversation.course && (
          <PanelSection title={t('messaging.course', { defaultValue: 'Course' })}>
            <Link
              href={getUriWithOrg(orgslug, `/course/${conversation.course.course_uuid.replace('course_', '')}`)}
              className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-neutral-50"
            >
              <CourseThumb course={conversation.course} size={40} />
              <span className="min-w-0 flex-1 text-start">
                <span className="block truncate text-sm font-semibold text-neutral-900">{conversation.course.name}</span>
                <span className="block text-xs text-neutral-500">
                  {t('messaging.people_count', { defaultValue: '{{count}} people', count: conversation.member_count })}
                </span>
              </span>
            </Link>
          </PanelSection>
        )}

        {shownMembers.length > 0 && (
          <PanelSection title={t('messaging.members', { defaultValue: 'Members' })} count={conversation.member_count}>
            <div className="-mx-1.5 space-y-0.5">
              {shownMembers.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
                  <PersonAvatar user={m} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">
                      {displayName(m)}{' '}
                      {m.id === userId && <span className="font-normal text-neutral-400">({t('messaging.you_lower', { defaultValue: 'you' })})</span>}
                    </p>
                    <p className="truncate text-[11px] text-neutral-500">{presenceLine(presence[m.id]) || t('messaging.offline', { defaultValue: 'Offline' })}</p>
                  </div>
                  {m.role === 'owner' && <span className="text-[10px] font-medium text-neutral-400">{t('messaging.owner', { defaultValue: 'Owner' })}</span>}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onAddPeople}
              className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-dashed border-neutral-300 text-neutral-400">
                <UserPlus size={14} />
              </span>
              {t('messaging.add_people', { defaultValue: 'Add people' })}
            </button>
          </PanelSection>
        )}

        <PanelSection title={t('messaging.shared', { defaultValue: 'Shared in this chat' })}>
          {shared.courses.length === 0 && shared.links.length === 0 ? (
            <p className="text-xs text-neutral-400">
              {t('messaging.shared_empty', { defaultValue: 'Courses and links shared here show up in this list.' })}
            </p>
          ) : (
            <div className="-mx-1.5 space-y-0.5">
              {shared.courses.map((c) => (
                <Link
                  key={c.course_uuid}
                  href={getUriWithOrg(orgslug, `/course/${c.course_uuid.replace('course_', '')}`)}
                  className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-neutral-50"
                >
                  <CourseThumb course={c} size={30} />
                  <span className="truncate text-sm font-medium text-neutral-800">{c.name}</span>
                </Link>
              ))}
              {shared.links.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-neutral-50"
                >
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                    <LinkSimple size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-700" dir="ltr">
                    {url.replace(/^https?:\/\/(www\.)?/, '')}
                  </span>
                </a>
              ))}
            </div>
          )}
        </PanelSection>

        {(kind === 'dm' || kind === 'agent' || kind === 'group') && (
          <div className="border-t border-neutral-100 px-3 py-3">
            {kind === 'group' ? (
              <button
                type="button"
                onClick={onLeave}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
              >
                <SignOut size={15} /> {t('messaging.leave_group', { defaultValue: 'Leave group' })}
              </button>
            ) : (
              <button
                type="button"
                onClick={onLeave}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
              >
                <Archive size={15} /> {t('messaging.archive', { defaultValue: 'Archive' })}
              </button>
            )}
          </div>
        )}
      </div>
    </motion.aside>
  )
}
