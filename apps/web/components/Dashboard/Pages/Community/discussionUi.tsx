'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getLabelInfo, type DiscussionAuthor } from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'

// Small pieces shared by the moderation list and the thread reader.

export function authorName(author: DiscussionAuthor | null | undefined, fallback: string) {
  if (!author) return fallback
  return [author.first_name, author.last_name].filter(Boolean).join(' ').trim() || author.username || fallback
}

function avatarUrl(author: DiscussionAuthor | null | undefined): string | null {
  if (!author?.avatar_image) return null
  // External sign-in providers store a full URL.
  if (/^https?:\/\//.test(author.avatar_image)) return author.avatar_image
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

export function AuthorAvatar({ author, size = 24 }: { author: DiscussionAuthor | null | undefined; size?: number }) {
  const src = avatarUrl(author)
  const initial = (author?.first_name || author?.username || '?').slice(0, 1)
  return src ? (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size }}
      className="rounded-full object-cover bg-neutral-100 ring-1 ring-black/5 shrink-0"
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="rounded-full bg-neutral-200 text-neutral-600 text-[10px] font-bold flex items-center justify-center uppercase shrink-0"
    >
      {initial}
    </span>
  )
}

export function LabelChip({ label }: { label?: string | null }) {
  const { t } = useTranslation()
  const info = getLabelInfo(label || 'general')
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-inset ring-neutral-900/10 bg-white whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.color }} />
      {t(`communities.labels.${info.id}`, { defaultValue: info.name })}
    </span>
  )
}
