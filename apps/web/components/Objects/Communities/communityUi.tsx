'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ChatCircle, Lightbulb, Megaphone, Question, Star } from '@phosphor-icons/react'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUriWithOrg } from '@services/config/config'
import { getLabelInfo, type DiscussionAuthor } from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'

// Small building blocks shared by the learner-facing community pages.

export const communityId = (uuid: string) => uuid.replace('community_', '')
export const discussionId = (uuid: string) => uuid.replace('discussion_', '')

export const communityHref = (orgslug: string, communityUuid: string) =>
  getUriWithOrg(orgslug, `/community/${communityId(communityUuid)}`)

export const threadHref = (orgslug: string, communityUuid: string, discussionUuid: string) =>
  getUriWithOrg(orgslug, `/community/${communityId(communityUuid)}/discussion/${discussionId(discussionUuid)}`)

export function authorDisplayName(author: DiscussionAuthor | null | undefined, fallback: string) {
  if (!author) return fallback
  return [author.first_name, author.last_name].filter(Boolean).join(' ').trim() || author.username || fallback
}

export function authorAvatarUrl(author: DiscussionAuthor | null | undefined): string | undefined {
  if (!author?.avatar_image) return undefined
  // External sign-in providers store a full URL.
  if (/^https?:\/\//.test(author.avatar_image)) return author.avatar_image
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

export function AuthorAvatar({ author, size = 32 }: { author: DiscussionAuthor | null | undefined; size?: number }) {
  return (
    <UserAvatar
      width={size}
      rounded="rounded-full"
      avatar_url={authorAvatarUrl(author)}
      predefined_avatar={author?.avatar_image ? undefined : 'empty'}
      showProfilePopup
      userId={author?.id?.toString()}
      shadow="shadow-none"
    />
  )
}

const LABEL_ICONS: Record<string, React.ElementType> = {
  HelpCircle: Question,
  Lightbulb,
  Megaphone,
  Star,
}

export function LabelIcon({ label, size = 14 }: { label?: string | null; size?: number }) {
  const info = getLabelInfo(label || 'general')
  const Icon = LABEL_ICONS[info.icon] || ChatCircle
  return <Icon size={size} weight="fill" style={{ color: info.color }} />
}

// Label shown as a soft chip with its colour dot.
export function LabelChip({ label, className = '' }: { label?: string | null; className?: string }) {
  const { t } = useTranslation()
  const info = getLabelInfo(label || 'general')
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-inset ring-neutral-900/10 bg-white whitespace-nowrap ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.color }} />
      {t(`communities.labels.${info.id}`, { defaultValue: info.name })}
    </span>
  )
}

// Copies an absolute link, using the native share sheet on phones.
export async function shareLink(path: string, title: string, copied: string, failed: string) {
  const url = /^https?:\/\//i.test(path) ? path : `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`
  try {
    const nav: any = navigator
    if (nav.share && window.matchMedia('(pointer: coarse)').matches) {
      await nav.share({ title, url })
      return
    }
    await navigator.clipboard.writeText(url)
    toast.success(copied)
  } catch (err: any) {
    // Closing the share sheet is not an error.
    if (err?.name !== 'AbortError') toast.error(failed)
  }
}

// A draft kept in this browser only. Storage can be blocked, so every
// access is guarded; losing a draft is better than breaking the page.
export function readDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeDraft(key: string, value: unknown | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

// First words of a post for list excerpts: tiptap JSON or legacy plain text.
export function plainTextOf(content: string | null | undefined, max = 220): string {
  if (!content) return ''
  let text = content
  try {
    const doc = JSON.parse(content)
    if (doc && typeof doc === 'object') {
      const parts: string[] = []
      const walk = (node: any) => {
        if (!node || parts.join(' ').length > max) return
        if (typeof node.text === 'string') parts.push(node.text)
        if (node.type === 'communityTag' && node.attrs?.label) parts.push(`#${node.attrs.label}`)
        if (Array.isArray(node.content)) node.content.forEach(walk)
      }
      walk(doc)
      text = parts.join(' ')
    }
  } catch {
    // legacy plain text
  }
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}
