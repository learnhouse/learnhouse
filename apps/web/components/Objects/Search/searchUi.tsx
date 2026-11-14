'use client'
import React from 'react'
import {
  Article,
  Books,
  Broadcast,
  ChatCircleText,
  ClipboardText,
  FilePdf,
  FileText,
  FolderSimple,
  Garage,
  Globe,
  Headphones,
  Lightning,
  MarkdownLogo,
  Package,
  PlayCircle,
  PuzzlePiece,
  User,
} from '@phosphor-icons/react'
import UserAvatar from '@components/Objects/UserAvatar'
import { highlightParts } from '@/lib/site-search/match'
import type { SiteResult, SiteResultType } from '@/lib/site-search/useSiteSearch'

// Pieces shared by the command palette and the full search page, so a
// result looks the same wherever it is listed.

export const TYPE_ICON: Record<SiteResultType, React.ComponentType<any>> = {
  course: Books,
  activity: FileText,
  folder: FolderSimple,
  community: Garage,
  discussion: ChatCircleText,
  playground: Lightning,
  podcast: Headphones,
  user: User,
}

/** The plural key the search page uses in its `type` URL param and in `search.types.*`. */
export const TYPE_PLURAL: Record<SiteResultType, string> = {
  course: 'courses',
  activity: 'activities',
  folder: 'folders',
  community: 'communities',
  discussion: 'discussions',
  playground: 'playgrounds',
  podcast: 'podcasts',
  user: 'users',
}

export const PLURAL_TO_TYPE: Record<string, SiteResultType> = Object.fromEntries(
  Object.entries(TYPE_PLURAL).map(([type, plural]) => [plural, type as SiteResultType]),
)

/** `search.types.<plural>`: the group name ("Lessons", "Members"…). */
export const typeGroupKey = (type: SiteResultType) => `search.types.${TYPE_PLURAL[type]}`

/** `search.v2.type_one.<type>`: one item's kind ("Lesson", "Member"…). */
export const typeOneKey = (type: SiteResultType) => `search.v2.type_one.${type}`

const ACTIVITY_KIND: Record<string, { icon: React.ComponentType<any>; key: string }> = {
  TYPE_VIDEO: { icon: PlayCircle, key: 'video' },
  TYPE_DOCUMENT: { icon: FilePdf, key: 'document' },
  TYPE_DYNAMIC: { icon: Article, key: 'page' },
  TYPE_ASSIGNMENT: { icon: ClipboardText, key: 'assignment' },
  TYPE_SCORM: { icon: Package, key: 'scorm' },
  TYPE_LIVE_SESSION: { icon: Broadcast, key: 'live' },
  TYPE_PLAY: { icon: Lightning, key: 'play' },
  TYPE_CUSTOM: { icon: PuzzlePiece, key: 'custom' },
}

/** What kind of lesson it is, for the lesson icon and label. */
export function activityKind(type?: string, subType?: string) {
  if (subType === 'SUBTYPE_DYNAMIC_MARKDOWN') return { icon: MarkdownLogo, key: 'search.v2.kinds.markdown' }
  if (subType === 'SUBTYPE_DYNAMIC_EMBED') return { icon: Globe, key: 'search.v2.kinds.embed' }
  const kind = (type && ACTIVITY_KIND[type]) || null
  return kind ? { icon: kind.icon, key: `search.v2.kinds.${kind.key}` } : null
}

/** The query's terms marked in `text`. */
export function Highlight({ text, query, className = '' }: { text?: string | null; query: string; className?: string }) {
  const parts = highlightParts(text, query)
  if (parts.length === 0) return null
  return (
    <span className={className} dir="auto">
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-[3px] bg-amber-100 text-inherit [box-decoration-break:clone] px-px -mx-px">
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </span>
  )
}

const THUMB_SIZES = {
  sm: { box: 'h-9 w-9 rounded-lg', icon: 17, emoji: 'text-base', avatar: 36 },
  md: { box: 'h-11 w-11 rounded-xl', icon: 20, emoji: 'text-lg', avatar: 44 },
} as const

/**
 * A result's picture: its thumbnail, a member's avatar, a post's emoji, or
 * the type icon on a soft tile when there is none. A lesson shows its kind
 * (video, quiz page…) as a small badge over its course's cover.
 */
export function ResultThumb({ result, size = 'sm' }: { result: SiteResult; size?: keyof typeof THUMB_SIZES }) {
  const s = THUMB_SIZES[size]
  const Icon = TYPE_ICON[result.type]
  const [broken, setBroken] = React.useState(false)

  if (result.type === 'user') {
    return (
      <span className="shrink-0">
        <UserAvatar
          width={s.avatar}
          avatar_url={result.imageUrl ?? ''}
          predefined_avatar={result.imageUrl ? undefined : 'empty'}
          userId={result.userId ?? result.id}
          showProfilePopup={false}
          rounded="rounded-full"
          backgroundColor="bg-gray-100"
        />
      </span>
    )
  }

  const kind = result.type === 'activity' ? activityKind(result.activityType, result.activitySubType) : null
  const KindIcon = kind?.icon

  return (
    <span className={`relative flex shrink-0 items-center justify-center bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-black/[0.04] ${s.box}`}>
      <span className={`flex h-full w-full items-center justify-center overflow-hidden ${s.box}`}>
        {result.imageUrl && !broken ? (
          <img src={result.imageUrl} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : result.emoji ? (
          <span className={`${s.emoji} leading-none`}>{result.emoji}</span>
        ) : (
          <Icon size={s.icon} weight="duotone" />
        )}
      </span>
      {KindIcon && result.imageUrl && !broken && (
        <span className="absolute -bottom-1 -end-1 flex h-[18px] w-[18px] items-center justify-center rounded-md bg-white text-neutral-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.08)]">
          <KindIcon size={11} weight="bold" />
        </span>
      )}
    </span>
  )
}

/** Shimmer rows for a list that is loading. */
export function SkeletonRows({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2.5 py-2">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-neutral-100 animate-pulse" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-3 rounded bg-neutral-100 animate-pulse" style={{ width: `${55 - i * 7}%` }} />
            <div className="h-2.5 rounded bg-neutral-100/80 animate-pulse" style={{ width: `${78 - i * 9}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
