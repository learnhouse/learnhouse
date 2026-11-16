'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import {
  ArrowBendUpLeft,
  ArrowClockwise,
  ArrowSquareOut,
  Bell,
  Check,
  Checks,
  Copy,
  Megaphone,
  PencilSimple,
  Smiley,
  SmileyWink,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import RichMessageContent from '@components/Messaging/Rich/RichMessageContent'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import { AgentProgress } from '@components/Messaging/MessagingProvider'
import { CourseThumb, PersonAvatar } from '@components/Messaging/ui/Avatars'
import EmojiPickerPopover from '@components/Messaging/ui/EmojiPicker'
import { RemindMeMenu } from '@components/Messaging/Reminders/Reminders'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { ChatMessage, CourseCard, UserSummary, displayName } from '@services/messaging/messaging'
import { getUriWithOrg } from '@services/config/config'
import { QUICK_REACTIONS, clockTime, senderName } from '@components/Messaging/utils'
import { coursePath } from '@/lib/seo/paths'

/** Quotes show plain text, not markdown syntax. */
export function stripMd(text: string): string {
  return text.replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim()
}

export type LocalMessage = ChatMessage & {
  _local?: 'pending' | 'failed'
  _error?: string
}

export function CourseShareCard({ course, orgslug, compact = false }: { course: CourseCard; orgslug: string; compact?: boolean }) {
  const { t } = useTranslation()
  const href = getUriWithOrg(orgslug, coursePath(course))
  return (
    <Link
      href={href}
      className="group/card flex max-w-sm items-stretch gap-3 rounded-2xl bg-white p-2.5 pe-3 text-neutral-900 nice-shadow transition-colors hover:bg-neutral-50"
    >
      <CourseThumb course={course} size={compact ? 44 : 56} />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{t('messaging.course', { defaultValue: 'Course' })}</p>
        <p className="line-clamp-1 text-sm font-semibold leading-snug">{course.name}</p>
        {!compact && course.description && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{course.description}</p>}
      </div>
      <ArrowSquareOut size={15} className="self-center text-neutral-300 transition-colors group-hover/card:text-neutral-600 rtl:-scale-x-100" />
    </Link>
  )
}

function ReactionBar({
  message,
  nameOf,
  onReact,
  inverted,
}: {
  message: ChatMessage
  nameOf: (id: number) => string
  onReact: (emoji: string) => void
  inverted: boolean
}) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  if (!message.reactions.length) return null
  return (
    <div className={`mt-1 flex flex-wrap items-center gap-1 ${inverted ? 'justify-end' : ''}`}>
      {message.reactions.map((r) => (
        <Tooltip key={r.emoji}>
          <TooltipTrigger asChild>
            <motion.button
              type="button"
              layout
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={() => onReact(r.emoji)}
              aria-pressed={r.me}
              className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs ring-1 ring-inset transition-colors ${
                r.me
                  ? 'bg-neutral-900/[0.06] text-neutral-900 ring-neutral-900/25'
                  : 'bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50 hover:ring-neutral-300'
              }`}
            >
              <span className="text-[13px] leading-none">{r.emoji}</span>
              <span className="font-semibold tabular-nums">{r.count}</span>
            </motion.button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px] text-xs">
            {t('messaging.reacted_with', { defaultValue: '{{names}} reacted {{emoji}}', names: r.user_ids.map(nameOf).join(', '), emoji: r.emoji })}
          </TooltipContent>
        </Tooltip>
      ))}
      <EmojiPickerPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(e) => {
          onReact(e)
          setPickerOpen(false)
        }}
      >
        <button
          type="button"
          aria-label={t('messaging.add_reaction', { defaultValue: 'Add reaction' })}
          className={`h-6 w-7 items-center justify-center rounded-full bg-white text-neutral-400 ring-1 ring-inset ring-neutral-200 hover:text-neutral-700 ${
            pickerOpen ? 'inline-flex' : 'hidden group-hover:inline-flex group-focus-within:inline-flex'
          }`}
        >
          <SmileyWink size={13} />
        </button>
      </EmojiPickerPopover>
    </div>
  )
}

const TOOL_BTN = 'flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900'

function ToolTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  )
}

function HoverToolbar({
  message,
  mine,
  canDelete,
  canEdit,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onCopy,
  side,
  compact,
}: {
  message: ChatMessage
  mine: boolean
  canDelete: boolean
  canEdit: boolean
  onReact: (e: string) => void
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onCopy: () => void
  side: 'start' | 'end'
  compact: boolean
}) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const pinned = pickerOpen || confirm
  const quick = compact ? QUICK_REACTIONS.slice(0, 3) : QUICK_REACTIONS
  return (
    <div
      className={`absolute -top-4 ${side === 'end' ? 'end-1' : compact ? 'start-8' : 'start-10'} z-10 flex items-center gap-0.5 rounded-xl bg-white p-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.08)] ring-1 ring-neutral-900/[0.06] transition-opacity ${
        pinned ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
      }`}
    >
      {quick.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onReact(e)}
          className="h-7 w-7 rounded-lg text-[15px] transition-transform hover:scale-110 hover:bg-neutral-100"
          aria-label={t('messaging.react_with', { defaultValue: 'React with {{emoji}}', emoji: e })}
        >
          {e}
        </button>
      ))}
      <EmojiPickerPopover
        onPick={(e) => {
          onReact(e)
          setPickerOpen(false)
        }}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      >
        <button type="button" className={TOOL_BTN} aria-label={t('messaging.more_reactions', { defaultValue: 'More reactions' })}>
          <Smiley size={16} />
        </button>
      </EmojiPickerPopover>
      <span className="mx-0.5 h-4 w-px bg-neutral-200" />
      <ToolTip label={t('messaging.reply', { defaultValue: 'Reply' })}>
        <button type="button" onClick={onReply} className={TOOL_BTN} aria-label={t('messaging.reply', { defaultValue: 'Reply' })}>
          <ArrowBendUpLeft size={15} />
        </button>
      </ToolTip>
      <ToolTip label={copied ? t('messaging.copied', { defaultValue: 'Copied' }) : t('messaging.copy_text', { defaultValue: 'Copy text' })}>
        <button
          type="button"
          onClick={() => {
            onCopy()
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className={TOOL_BTN}
          aria-label={t('messaging.copy_text', { defaultValue: 'Copy text' })}
        >
          {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
        </button>
      </ToolTip>
      {!compact && (
        <RemindMeMenu message={message}>
          <button type="button" className={TOOL_BTN} aria-label={t('messaging.remind_me', { defaultValue: 'Remind me' })} title={t('messaging.remind_me', { defaultValue: 'Remind me' })}>
            <Bell size={15} />
          </button>
        </RemindMeMenu>
      )}
      {mine && canEdit && (
        <ToolTip label={t('messaging.edit', { defaultValue: 'Edit' })}>
          <button type="button" onClick={onEdit} className={TOOL_BTN} aria-label={t('messaging.edit', { defaultValue: 'Edit' })}>
            <PencilSimple size={15} />
          </button>
        </ToolTip>
      )}
      {canDelete &&
        (confirm ? (
          <button
            type="button"
            onClick={() => {
              setConfirm(false)
              onDelete()
            }}
            onBlur={() => setConfirm(false)}
            autoFocus
            className="h-7 rounded-lg bg-rose-600 px-2 text-xs font-semibold text-white hover:bg-rose-700"
          >
            {t('messaging.delete_confirm', { defaultValue: 'Delete?' })}
          </button>
        ) : (
          <ToolTip label={t('messaging.delete', { defaultValue: 'Delete' })}>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className={`${TOOL_BTN} hover:!bg-rose-50 hover:!text-rose-600`}
              aria-label={t('messaging.delete', { defaultValue: 'Delete' })}
            >
              <Trash size={15} />
            </button>
          </ToolTip>
        ))}
    </div>
  )
}

export default function MessageItem({
  message,
  grouped,
  groupedNext = false,
  mine,
  viewerId,
  orgslug,
  progress,
  highlighted,
  canModerate,
  readers,
  showSeen,
  nameOf,
  compact = false,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onJumpTo,
  onFollowUp,
  onRetry,
}: {
  message: LocalMessage
  /** Same sender as the message above: no name or avatar. */
  grouped: boolean
  /** Same sender continues below: tighten the bubble corner and hold the timestamp. */
  groupedNext?: boolean
  mine: boolean
  viewerId: number | undefined
  orgslug: string
  progress?: AgentProgress
  highlighted: boolean
  canModerate: boolean
  readers: UserSummary[]
  showSeen: boolean
  nameOf: (id: number) => string
  compact?: boolean
  onReact: (m: ChatMessage, emoji: string) => void
  onReply: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onJumpTo: (uuid: string) => void
  onFollowUp: (text: string) => void
  onRetry: (m: LocalMessage) => void
}) {
  const { t } = useTranslation()

  if (message.kind === 'system') {
    return (
      <div className="flex justify-center py-2" id={`msg-${message.message_uuid}`}>
        <span className="text-center text-xs text-neutral-400">
          <span className="font-medium text-neutral-500">
            {message.sender?.type === 'user' && message.sender.id === viewerId ? t('messaging.you', { defaultValue: 'You' }) : senderName(message)}
          </span>{' '}
          {message.content} · {clockTime(message.creation_date)}
        </span>
      </div>
    )
  }

  const agent = message.sender?.type === 'agent' ? message.sender : null
  const local = message._local
  const reply = message.reply_to
  const copy = () => navigator.clipboard?.writeText(message.content).catch(() => {})
  const avatarSize = compact ? 28 : 32
  const gutter = compact ? 'w-7' : 'w-8'

  const toolbar = !message.deleted && !local && (
    <HoverToolbar
      message={message}
      mine={mine}
      side={mine ? 'end' : 'start'}
      compact={compact}
      canEdit={message.kind === 'text' || message.kind === 'course_share'}
      canDelete={mine || canModerate}
      onReact={(e) => onReact(message, e)}
      onReply={() => onReply(message)}
      onEdit={() => onEdit(message)}
      onDelete={() => onDelete(message)}
      onCopy={copy}
    />
  )

  const replyBlock = reply && (
    <button
      type="button"
      onClick={() => onJumpTo(reply.message_uuid)}
      className={`mb-1 flex max-w-full items-start gap-1.5 rounded-xl border-s-2 border-neutral-300 bg-neutral-50 px-2.5 py-1.5 text-start text-xs text-neutral-500 ring-1 ring-inset ring-neutral-200/60 transition-colors hover:bg-neutral-100 ${
        mine ? 'ms-auto' : ''
      }`}
    >
      <ArrowBendUpLeft size={12} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="font-semibold text-neutral-700">
          {reply.sender
            ? reply.sender.type === 'agent'
              ? reply.sender.name
              : displayName(reply.sender)
            : t('messaging.someone', { defaultValue: 'Someone' })}
        </span>{' '}
        <span className="line-clamp-1">
          {reply.deleted
            ? t('messaging.deleted_message', { defaultValue: 'Deleted message' })
            : stripMd(reply.content) || (reply.kind === 'course_share' ? t('messaging.shared_course', { defaultValue: 'Shared a course' }) : '')}
        </span>
      </span>
    </button>
  )

  const hasText = Boolean(message.content) || message.status === 'streaming'
  const textBody = message.deleted ? (
    <span className="text-sm italic text-neutral-400">
      {t('messaging.message_deleted', { defaultValue: 'This message was deleted' })}
    </span>
  ) : hasText ? (
    <RichMessageContent message={message} progress={agent ? progress : undefined} orgslug={orgslug} onFollowUp={onFollowUp} inverted={mine} />
  ) : null
  const courseCard = !message.deleted && message.attachment?.course ? <CourseShareCard course={message.attachment.course} orgslug={orgslug} compact={compact} /> : null
  const body = (
    <>
      {textBody}
      {courseCard && <div className={hasText ? 'mt-2' : ''}>{courseCard}</div>}
    </>
  )

  const edited = message.edited_at && !message.deleted ? ` · ${t('messaging.edited', { defaultValue: 'edited' })}` : ''
  const meta = (
    <span className="text-[11px] tabular-nums text-neutral-400">
      {clockTime(message.creation_date)}
      {edited}
    </span>
  )
  const flash = highlighted ? 'lh-msg-flash' : ''

  // Reminder delivered by an agent.
  if (message.kind === 'reminder') {
    const source = message.attachment?.source
    return (
      <div id={`msg-${message.message_uuid}`} tabIndex={-1} className={`group relative py-2 outline-none ${flash}`}>
        {toolbar}
        <div className="flex items-start gap-3 rounded-2xl bg-white p-4 nice-shadow">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
            <Bell size={17} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="text-sm font-semibold text-neutral-900">{t('messaging.reminder', { defaultValue: 'Reminder' })}</span>
              {agent && <span className="text-xs text-neutral-500">{t('messaging.from_name', { defaultValue: 'from {{name}}', name: agent.name })}</span>}
              <span className="ms-auto">{meta}</span>
            </div>
            <p className="mt-0.5 text-sm text-neutral-800">{message.content}</p>
            {source && (
              <Link
                href={getUriWithOrg(orgslug, `/messages?c=${source.conversation_uuid}&m=${source.message_uuid}`)}
                className="mt-2 block rounded-xl border-s-2 border-neutral-300 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
              >
                {source.snippet || t('messaging.open_message', { defaultValue: 'Open the message' })}
              </Link>
            )}
          </div>
        </div>
        <ReactionBar message={message} nameOf={nameOf} onReact={(e) => onReact(message, e)} inverted={false} />
      </div>
    )
  }

  // Announcement: a highlighted card.
  if (message.kind === 'announcement') {
    return (
      <div id={`msg-${message.message_uuid}`} tabIndex={-1} className={`group relative py-2 outline-none ${flash}`}>
        {toolbar}
        <div className="rounded-2xl bg-white p-4 nice-shadow">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {message.sender?.type === 'user' && <PersonAvatar user={message.sender} size={26} />}
            <span className="text-sm font-semibold text-neutral-900">{senderName(message)}</span>
            <Chip tone="amber" icon={<Megaphone size={11} weight="fill" />} className="!px-2 !py-0.5 !text-[11px]">
              {t('messaging.announcement', { defaultValue: 'Announcement' })}
            </Chip>
            <span className="ms-auto">{meta}</span>
          </div>
          <div className="text-sm text-neutral-800">{body}</div>
        </div>
        <ReactionBar message={message} nameOf={nameOf} onReact={(e) => onReact(message, e)} inverted={false} />
      </div>
    )
  }

  // Agent replies: flat, full width, so quizzes, charts and code have room.
  if (agent) {
    return (
      <div
        id={`msg-${message.message_uuid}`}
        tabIndex={-1}
        className={`group relative flex gap-2.5 outline-none ${grouped ? 'pt-1' : 'pt-4'} ${flash}`}
      >
        {toolbar}
        <div className={`${gutter} shrink-0`}>{!grouped && <AgentAvatar agent={agent} size={avatarSize} />}</div>
        <div className="min-w-0 max-w-[760px] flex-1">
          {!grouped && (
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-sm font-semibold text-neutral-900">{agent.name}</span>
              <span className="rounded-md bg-neutral-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                {t('messaging.agent', { defaultValue: 'Agent' })}
              </span>
              {meta}
            </div>
          )}
          {replyBlock}
          <div className="text-sm text-neutral-800">
            {message.status === 'error' && (
              <p className="mb-1 flex items-center gap-1 text-xs text-rose-600">
                <WarningCircle size={13} /> {t('messaging.reply_failed', { defaultValue: 'Reply failed' })}
              </p>
            )}
            {body}
          </div>
          <ReactionBar message={message} nameOf={nameOf} onReact={(e) => onReact(message, e)} inverted={false} />
        </div>
      </div>
    )
  }

  // People: bubbles. Consecutive messages stack with tighter inner corners.
  const sender = message.sender?.type === 'user' ? message.sender : null
  const corners = mine
    ? `rounded-[18px] ${grouped ? 'rounded-se-md' : ''} ${groupedNext ? 'rounded-ee-md' : ''}`
    : `rounded-[18px] ${grouped ? 'rounded-ss-md' : ''} ${groupedNext ? 'rounded-es-md' : ''}`
  const lastOfGroup = !groupedNext
  return (
    <div
      id={`msg-${message.message_uuid}`}
      tabIndex={-1}
      className={`group relative flex gap-2.5 outline-none ${mine ? 'flex-row-reverse' : ''} ${grouped ? 'pt-0.5' : 'pt-3'} ${flash}`}
    >
      {toolbar}
      {!mine && (
        <div className={`${gutter} flex shrink-0 justify-center`}>
          {!grouped && sender ? (
            <PersonAvatar user={sender} size={avatarSize} />
          ) : (
            // Grouped rows show their time in the gutter on hover, like Slack.
            <span className="mt-2.5 hidden text-[10px] tabular-nums text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 md:block">
              {clockTime(message.creation_date)}
            </span>
          )}
        </div>
      )}
      <div className={`flex min-w-0 flex-col ${compact ? 'max-w-[85%]' : 'max-w-[80%] md:max-w-[68%]'} ${mine ? 'items-end' : 'items-start'}`}>
        {!grouped && !mine && (
          <div className="mb-1 flex items-baseline gap-2 px-1">
            <span className="text-[13px] font-semibold text-neutral-800">{senderName(message)}</span>
            {meta}
          </div>
        )}
        {replyBlock}
        {(message.deleted || hasText) && (
          <motion.div
            initial={local === 'pending' ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: local === 'pending' ? 0.65 : 1, y: 0 }}
            transition={{ duration: 0.16 }}
            title={clockTime(message.creation_date)}
            className={`break-words px-3.5 py-2 text-sm leading-relaxed ${corners} ${
              message.deleted
                ? 'border border-dashed border-neutral-200 bg-transparent'
                : mine
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-900'
            } ${local === 'failed' ? 'ring-2 ring-rose-300' : ''}`}
          >
            {textBody}
          </motion.div>
        )}
        {courseCard && <div className={`${hasText ? 'mt-1' : ''} ${local === 'pending' ? 'opacity-70' : ''}`}>{courseCard}</div>}
        {local === 'failed' && (
          <button type="button" onClick={() => onRetry(message)} className="mt-1 flex items-center gap-1 px-1 text-[11px] font-medium text-rose-600 hover:underline">
            <WarningCircle size={12} /> {message._error || t('messaging.not_sent', { defaultValue: 'Not sent' })} · <ArrowClockwise size={11} />{' '}
            {t('messaging.retry', { defaultValue: 'Retry' })}
          </button>
        )}
        {local === 'pending' && lastOfGroup && (
          <span className="mt-0.5 px-1 text-[11px] text-neutral-400">{t('messaging.sending', { defaultValue: 'Sending…' })}</span>
        )}
        <ReactionBar message={message} nameOf={nameOf} onReact={(e) => onReact(message, e)} inverted={mine} />
        {mine && !local && (showSeen || readers.length > 0) ? (
          <div className="mt-1 flex items-center gap-1.5 px-1">
            {readers.length > 0 && (
              <span className="flex -space-x-1" title={t('messaging.seen_by', { defaultValue: 'Seen by {{names}}', names: readers.map(displayName).join(', ') })}>
                {readers.slice(0, 5).map((u) => (
                  <span key={u.id} className="rounded-full ring-1 ring-white">
                    <PersonAvatar user={u} size={14} showPresence={false} />
                  </span>
                ))}
              </span>
            )}
            {showSeen && (
              <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400">
                <Checks size={12} weight="bold" className="text-sky-500" /> {t('messaging.seen', { defaultValue: 'Seen' })}
              </span>
            )}
            <span className="text-[11px] tabular-nums text-neutral-300">{clockTime(message.creation_date)}</span>
          </div>
        ) : (
          mine && lastOfGroup && !local && <span className="mt-0.5 px-1">{meta}</span>
        )}
      </div>
    </div>
  )
}
