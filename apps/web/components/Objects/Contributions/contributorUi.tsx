'use client'
// Small shared pieces: contributor names and avatars.
import React from 'react'
import { AvatarStack } from '@/design'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import type { ContributorUser } from '@services/courses/contributions'

export function contributorName(user: ContributorUser | null | undefined): string {
  if (!user) return ''
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
  return full || `@${user.username}`
}

export function contributorAvatar(user: ContributorUser | null | undefined): string {
  if (!user?.avatar_image) return ''
  if (/^https?:\/\//.test(user.avatar_image)) return user.avatar_image
  return getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
}

export function ContributorAvatars({ users, max = 3, size = 22 }: { users: ContributorUser[]; max?: number; size?: number }) {
  return (
    <AvatarStack
      max={max}
      size={size}
      people={users.map((u) => ({ key: u.user_uuid, src: contributorAvatar(u), label: contributorName(u) }))}
    />
  )
}
