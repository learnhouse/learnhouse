'use client'

import React from 'react'
import { Megaphone } from '@phosphor-icons/react'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import { useOrg } from '@components/Contexts/OrgContext'
import { useMessaging } from '@components/Messaging/MessagingProvider'
import {
  Conversation,
  Presence,
  UserSummary,
  displayName,
  otherMember,
} from '@services/messaging/messaging'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { PRESENCE_DOT, avatarUrl, initials, seedColor, seedInk } from '@components/Messaging/utils'

export function PresenceDot({ presence, size = 10, className = '' }: { presence?: Presence; size?: number; className?: string }) {
  const state = presence?.state
  if (!state || state === 'offline') return null
  return (
    <span
      className={`absolute bottom-0 end-0 rounded-full ring-2 ring-white ${PRESENCE_DOT[state]} ${className}`}
      style={{ width: size, height: size }}
      aria-label={state}
    />
  )
}

export function PersonAvatar({
  user,
  size = 36,
  showPresence = true,
  rounded = 'rounded-full',
}: {
  user: Pick<UserSummary, 'id' | 'avatar_image' | 'user_uuid' | 'first_name' | 'last_name' | 'username'>
  size?: number
  showPresence?: boolean
  rounded?: string
}) {
  const { presence } = useMessaging()
  const url = avatarUrl(user)
  const name = displayName(user)
  return (
    <span className="relative inline-flex flex-shrink-0" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className={`${rounded} object-cover w-full h-full bg-neutral-100`} />
      ) : (
        <span
          className={`${rounded} w-full h-full flex items-center justify-center font-semibold select-none`}
          style={{ background: seedColor(user.id), color: seedInk(user.id), fontSize: Math.max(10, size * 0.38) }}
        >
          {initials(name)}
        </span>
      )}
      {showPresence && <PresenceDot presence={presence[user.id]} size={Math.max(8, Math.round(size * 0.28))} />}
    </span>
  )
}

export function AvatarStack({ users, size = 22, max = 3 }: { users: UserSummary[]; size?: number; max?: number }) {
  const shown = users.slice(0, max)
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((u) => (
        <span key={u.id} className="rounded-full ring-2 ring-white">
          <PersonAvatar user={u} size={size} showPresence={false} />
        </span>
      ))}
      {users.length > max && (
        <span
          className="rounded-full ring-2 ring-white bg-neutral-100 text-neutral-500 font-semibold flex items-center justify-center"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          +{users.length - max}
        </span>
      )}
    </span>
  )
}

export function CourseThumb({
  course,
  size = 36,
  className = '',
}: {
  course: { course_uuid: string; thumbnail_image: string; name: string } | null | undefined
  size?: number
  className?: string
}) {
  const org = useOrg() as any
  if (course?.thumbnail_image && org?.org_uuid) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)}
        alt={course.name}
        className={`rounded-lg object-cover flex-shrink-0 bg-neutral-100 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className={`rounded-lg flex items-center justify-center flex-shrink-0 bg-neutral-100 text-neutral-500 ${className}`}
      style={{ width: size, height: size }}
    >
      <Megaphone size={size * 0.5} weight="fill" />
    </span>
  )
}

/** The avatar a conversation row or header shows. */
export function ConversationAvatar({
  conversation,
  viewerId,
  size = 40,
}: {
  conversation: Conversation
  viewerId: number | undefined
  size?: number
}) {
  if (conversation.kind === 'agent' && conversation.agent) {
    return <AgentAvatar agent={conversation.agent} size={size} />
  }
  if (conversation.kind === 'dm') {
    const other = otherMember(conversation, viewerId)
    if (other) return <PersonAvatar user={other} size={size} />
  }
  if (conversation.kind === 'broadcast') {
    return <CourseThumb course={conversation.course} size={size} />
  }
  // Group: its emoji, else the first two members overlapped.
  if (conversation.emoji) {
    return (
      <span
        className="rounded-lg flex items-center justify-center flex-shrink-0 bg-neutral-100"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        {conversation.emoji}
      </span>
    )
  }
  const others = conversation.members.filter((m) => m.id !== viewerId).slice(0, 2)
  if (others.length < 2) {
    return others[0] ? <PersonAvatar user={others[0]} size={size} showPresence={false} /> : null
  }
  const inner = Math.round(size * 0.68)
  return (
    <span className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <span className="absolute top-0 start-0">
        <PersonAvatar user={others[0]} size={inner} showPresence={false} />
      </span>
      <span className="absolute bottom-0 end-0 rounded-full ring-2 ring-white">
        <PersonAvatar user={others[1]} size={inner} showPresence={false} />
      </span>
    </span>
  )
}
