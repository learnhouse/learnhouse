'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import {
  ArrowBendUpLeft,
  ArrowClockwise,
  ArrowSquareOut,
  Copy,
  Megaphone,
  PencilSimple,
  Smiley,
  Trash,
  WarningCircle,
  Bell,
} from '@phosphor-icons/react'
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

export type LocalMessage = ChatMessage & {
  _local?: 'pending' | 'failed'
  _error?: string
}

export function CourseShareCard({ course, orgslug, compact = false }: { course: CourseCard; orgslug: string; compact?: boolean }) {
  const href = getUriWithOrg(orgslug, `/course/${course.course_uuid.replace('course_', '')}`)
  return (
    <Link
      href={href}
      className="group/card flex items-stretch gap-3 rounded-lg bg-white nice-shadow p-2.5 pe-3 hover:bg-gray-50 transition-colors max-w-sm text-gray-900"
    >
      <CourseThumb course={course} size={compact ? 44 : 56} />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Course</p>
        <p className="text-sm font-semibold leading-snug line-clamp-1">{course.name}</p>
        {!compact && course.description && <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{course.description}</p>}
      </div>
      <ArrowSquareOut size={15} className="self-center text-gray-300 group-hover/card:text-gray-600 transition-colors" />
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
  if (!message.reactions.length) return null
  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${inverted ? 'justify-end' : ''}`}>
      {message.reactions.map((r) => (
        <Tooltip key={r.emoji}>
          <TooltipTrigger asChild>
            <button
              onClick={() => onReact(r.emoji)}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
                r.me ? 'border-gray-300 bg-gray-100 text-gray-900' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="text-sm leading-none">{r.emoji}</span>
              <span className="font-medium tabular-nums">{r.count}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-xs max-w-[220px]">
            {r.user_ids.map(nameOf).join(', ')} reacted {r.emoji}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
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
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <div
      className={`absolute -top-4 ${side === 'end' ? 'end-2' : 'start-12'} z-10 flex items-center gap-0.5 rounded-lg bg-white nice-shadow p-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 ${pickerOpen || confirm ? '!opacity-100' : ''} transition-opacity`}
    >
      {QUICK_REACTIONS.map((e) => (
        <button key={e} onClick={() => onReact(e)} className="h-7 w-7 rounded-md text-base hover:bg-gray-100">
          {e}
        </button>
      ))}
      <EmojiPickerPopover onPick={(e) => { onReact(e); setPickerOpen(false) }} open={pickerOpen} onOpenChange={setPickerOpen}>
        <button className="h-7 w-7 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100" title="More reactions">
          <Smiley size={16} />
        </button>
      </EmojiPickerPopover>
      <span className="w-px h-4 bg-gray-200 mx-0.5" />
      <button onClick={onReply} className="h-7 w-7 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Reply">
        <ArrowBendUpLeft size={15} />
      </button>
      <button onClick={onCopy} className="h-7 w-7 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Copy text">
        <Copy size={15} />
      </button>
      <RemindMeMenu message={message}>
        <button className="h-7 w-7 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Remind me">
          <Bell size={15} />
        </button>
      </RemindMeMenu>
      {mine && canEdit && (
        <button onClick={onEdit} className="h-7 w-7 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Edit">
          <PencilSimple size={15} />
        </button>
      )}
      {canDelete &&
        (confirm ? (
          <button
            onClick={() => { setConfirm(false); onDelete() }}
            onBlur={() => setConfirm(false)}
            autoFocus
            className="h-7 px-2 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-700"
          >
            Delete?
          </button>
        ) : (
          <button onClick={() => setConfirm(true)} className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-600" title="Delete">
            <Trash size={15} />
          </button>
        ))}
    </div>
  )
}

export default function MessageItem({
  message,
  grouped,
  mine,
  viewerId,
  orgslug,
  progress,
  highlighted,
  canModerate,
  readers,
  showSeen,
  nameOf,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onJumpTo,
  onFollowUp,
  onRetry,
}: {
  message: LocalMessage
  grouped: boolean
  mine: boolean
  viewerId: number | undefined
  orgslug: string
  progress?: AgentProgress
  highlighted: boolean
  canModerate: boolean
  readers: UserSummary[]
  showSeen: boolean
  nameOf: (id: number) => string
  onReact: (m: ChatMessage, emoji: string) => void
  onReply: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onJumpTo: (uuid: string) => void
  onFollowUp: (text: string) => void
  onRetry: (m: LocalMessage) => void
}) {
  if (message.kind === 'system') {
    return (
      <div className="flex justify-center py-1.5" id={`msg-${message.message_uuid}`}>
        <span className="text-xs text-gray-400">
          <span className="font-medium text-gray-500">{message.sender?.type === 'user' && message.sender.id === viewerId ? 'You' : senderName(message)}</span>{' '}
          {message.content} · {clockTime(message.creation_date)}
        </span>
      </div>
    )
  }

  const agent = message.sender?.type === 'agent' ? message.sender : null
  const local = message._local
  const reply = message.reply_to
  const copy = () => navigator.clipboard?.writeText(message.content).catch(() => {})

  const toolbar = !message.deleted && !local && (
    <HoverToolbar
      message={message}
      mine={mine}
      side={mine ? 'end' : 'start'}
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
      onClick={() => onJumpTo(reply.message_uuid)}
      className={`mb-1 flex max-w-full items-start gap-1.5 rounded-lg border-s-2 px-2 py-1 text-start text-xs transition-colors ${
        mine ? 'ms-auto border-gray-400 bg-gray-100 text-gray-500 hover:bg-gray-200/70' : 'border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100'
      }`}
    >
      <ArrowBendUpLeft size={12} className="mt-0.5 flex-shrink-0" />
      <span className="min-w-0">
        <span className="font-semibold text-gray-600">{reply.sender ? (reply.sender.type === 'agent' ? reply.sender.name : displayName(reply.sender)) : 'Someone'}</span>{' '}
        <span className="line-clamp-1">{reply.deleted ? 'Deleted message' : reply.content || (reply.kind === 'course_share' ? 'Shared a course' : '')}</span>
      </span>
    </button>
  )

  const hasText = Boolean(message.content) || message.status === 'streaming'
  const textBody = message.deleted ? (
    <span className="italic text-gray-400 text-sm">This message was deleted</span>
  ) : hasText ? (
    <RichMessageContent
      message={message}
      progress={agent ? progress : undefined}
      orgslug={orgslug}
      onFollowUp={onFollowUp}
      inverted={mine}
    />
  ) : null
  const courseCard =
    !message.deleted && message.attachment?.course ? (
      <CourseShareCard course={message.attachment.course} orgslug={orgslug} />
    ) : null
  const body = (
    <>
      {textBody}
      {courseCard && <div className={hasText ? 'mt-2' : ''}>{courseCard}</div>}
    </>
  )

  const meta = (
    <span className="text-[11px] text-gray-400 tabular-nums">
      {clockTime(message.creation_date)}
      {message.edited_at && !message.deleted ? ' · edited' : ''}
    </span>
  )

  // Reminder delivered by an agent.
  if (message.kind === 'reminder') {
    const source = message.attachment?.source
    return (
      <div id={`msg-${message.message_uuid}`} className={`group relative py-2 ${highlighted ? 'lh-msg-flash' : ''}`}>
        {toolbar}
        <div className="flex items-start gap-3 rounded-xl bg-white nice-shadow p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
            <Bell size={18} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Reminder</span>
              {agent && <span className="text-xs text-gray-500">from {agent.name}</span>}
              <span className="ms-auto">{meta}</span>
            </div>
            <p className="mt-0.5 text-sm text-gray-800">{message.content}</p>
            {source && (
              <Link
                href={getUriWithOrg(orgslug, `/messages?c=${source.conversation_uuid}&m=${source.message_uuid}`)}
                className="mt-2 block rounded-lg border-s-2 border-gray-300 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
              >
                {source.snippet || 'Open the message'}
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
      <div id={`msg-${message.message_uuid}`} className={`group relative py-2 ${highlighted ? 'lh-msg-flash' : ''}`}>
        {toolbar}
        <div className="rounded-xl bg-white nice-shadow p-4">
          <div className="flex items-center gap-2 mb-2">
            {message.sender?.type === 'user' && <PersonAvatar user={message.sender} size={26} />}
            <span className="text-sm font-semibold">{senderName(message)}</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-px text-[11px] font-medium text-gray-500">
              <Megaphone size={11} weight="fill" /> Announcement
            </span>
            <span className="ms-auto">{meta}</span>
          </div>
          <div className="text-sm text-gray-800">{body}</div>
        </div>
        <ReactionBar message={message} nameOf={nameOf} onReact={(e) => onReact(message, e)} inverted={false} />
      </div>
    )
  }

  // Agent replies: same bubble as people, wider for rich content.
  if (agent) {
    return (
      <div id={`msg-${message.message_uuid}`} className={`group relative flex gap-3 ${grouped ? 'pt-1' : 'pt-3'} ${highlighted ? 'lh-msg-flash' : ''}`}>
        {toolbar}
        <div className="w-9 flex-shrink-0">{!grouped && <AgentAvatar agent={agent} size={36} />}</div>
        <div className="min-w-0 flex-1 max-w-[760px]">
          {!grouped && (
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-sm font-semibold text-gray-800">{agent.name}</span>
              <span className="rounded-md bg-gray-100 px-1.5 py-px text-[11px] font-medium text-gray-500">Agent</span>
              {meta}
            </div>
          )}
          {replyBlock}
          <div className="rounded-xl rounded-ss-sm border border-gray-200/70 bg-white px-4 py-3 text-sm text-gray-800">
            {message.status === 'error' && (
              <p className="mb-1 flex items-center gap-1 text-xs text-red-600">
                <WarningCircle size={13} /> Reply failed
              </p>
            )}
            {body}
          </div>
          <ReactionBar message={message} nameOf={nameOf} onReact={(e) => onReact(message, e)} inverted={false} />
        </div>
      </div>
    )
  }

  // People.
  const sender = message.sender?.type === 'user' ? message.sender : null
  return (
    <div
      id={`msg-${message.message_uuid}`}
      className={`group relative flex gap-3 ${mine ? 'flex-row-reverse' : ''} ${grouped ? 'pt-0.5' : 'pt-3'} ${highlighted ? 'lh-msg-flash' : ''}`}
    >
      {toolbar}
      {!mine && <div className="w-9 flex-shrink-0">{!grouped && sender && <PersonAvatar user={sender} size={36} />}</div>}
      <div className={`min-w-0 max-w-[78%] md:max-w-[68%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {!grouped && !mine && (
          <div className="flex items-baseline gap-2 mb-1 px-1">
            <span className="text-sm font-semibold text-gray-800">{senderName(message)}</span>
            {meta}
          </div>
        )}
        {replyBlock}
        {(message.deleted || hasText) && (
        <motion.div
          initial={local === 'pending' ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: local === 'pending' ? 0.7 : 1, y: 0 }}
          title={mine ? clockTime(message.creation_date) : undefined}
          className={`px-3.5 py-2 text-sm leading-relaxed break-words ${
            message.deleted
              ? 'rounded-xl border border-dashed border-gray-200 bg-transparent'
              : mine
                ? `bg-gray-900 text-white rounded-xl rounded-se-sm`
                : 'bg-white border border-gray-200/70 text-gray-800 rounded-xl rounded-ss-sm'
          } ${local === 'failed' ? 'ring-2 ring-red-300' : ''}`}
        >
          {textBody}
        </motion.div>
        )}
        {courseCard && (
          <div className={`${hasText ? 'mt-1.5' : ''} ${local === 'pending' ? 'opacity-70' : ''}`}>{courseCard}</div>
        )}
        {local === 'failed' && (
          <button onClick={() => onRetry(message)} className="mt-1 flex items-center gap-1 text-[11px] text-red-600 hover:underline">
            <WarningCircle size={12} /> {message._error || 'Not sent'} · <ArrowClockwise size={11} /> Retry
          </button>
        )}
        {local === 'pending' && <span className="mt-0.5 text-[11px] text-gray-400">Sending…</span>}
        <ReactionBar message={message} nameOf={nameOf} onReact={(e) => onReact(message, e)} inverted={mine} />
        {mine && !local && (showSeen || readers.length > 0) && (
          <div className="mt-1 flex items-center gap-1 px-1">
            {readers.length > 0 ? (
              <span className="flex -space-x-1" title={`Seen by ${readers.map(displayName).join(', ')}`}>
                {readers.slice(0, 5).map((u) => (
                  <span key={u.id} className="rounded-full ring-1 ring-white">
                    <PersonAvatar user={u} size={14} showPresence={false} />
                  </span>
                ))}
              </span>
            ) : null}
            {showSeen && <span className="text-[11px] text-gray-400">Seen</span>}
          </div>
        )}
        {mine && grouped === false && !local && !showSeen && !readers.length && <span className="mt-0.5 px-1">{meta}</span>}
      </div>
    </div>
  )
}
