'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChatCenteredText, Lock, Sparkle, Users } from '@phosphor-icons/react'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { Chip, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import type { Community, CommunitySummary } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { communityHref } from './communityUi'

/**
 * A community as a tile in the public catalog. Same family as CourseCard:
 * cover, name, description, then a footer with what makes a community worth
 * opening (people, threads, how lively it is).
 */
export default function CommunityTile({
  community,
  summary,
  orgslug,
  orgUuid,
  priority = false,
}: {
  community: Community
  /** Activity counts; undefined while loading, null when unavailable. */
  summary?: CommunitySummary | null
  orgslug: string
  orgUuid?: string
  priority?: boolean
}) {
  const { t, i18n } = useTranslation()
  const href = communityHref(orgslug, community.community_uuid)
  const cover =
    community.thumbnail_image && orgUuid
      ? getCommunityThumbnailMediaDirectory(orgUuid, community.community_uuid, community.thumbnail_image)
      : null
  const lastActive = summary?.last_activity_date ? formatRelative(summary.last_activity_date, i18n.language) : null

  return (
    <div
      data-kbd-item=""
      className="group relative flex flex-col bg-white rounded-2xl nice-shadow overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <Link prefetch={false} href={href} className="block relative aspect-video overflow-hidden bg-neutral-100">
        <ThumbnailImage
          src={cover}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute bottom-2.5 inset-x-2.5 flex flex-wrap items-center gap-1.5">
          {!community.public && (
            <Chip tone="violet" icon={<Lock size={12} />}>
              {t('communities.private')}
            </Chip>
          )}
          {!!community.course_id && (
            <Chip tone="emerald" icon={<BookOpen size={12} />}>
              {t('communities.learner.course_community')}
            </Chip>
          )}
          {!!summary?.new_discussions_week && (
            <Chip tone="amber" icon={<Sparkle size={12} weight="fill" />}>
              {t('communities.learner.new_this_week', { count: summary.new_discussions_week })}
            </Chip>
          )}
        </div>
      </Link>

      <div className="flex flex-col flex-1 p-4 gap-1">
        <Link
          prefetch={false}
          href={href}
          dir="auto"
          className="text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-1 hover:underline underline-offset-2"
        >
          {community.name}
        </Link>
        <p className="text-xs text-neutral-500 line-clamp-2 min-h-[2rem]" dir="auto">
          {community.description || t('communities.learner.no_description')}
        </p>
        <div className="mt-auto pt-3 flex items-center justify-between gap-2 text-xs text-neutral-500">
          {summary === undefined ? (
            <span className="h-3.5 w-32 rounded bg-neutral-100 animate-pulse" />
          ) : summary ? (
            <span className="flex items-center gap-3 min-w-0 tabular-nums">
              <span className="inline-flex items-center gap-1" title={t('communities.learner.participants_hint')}>
                <Users size={14} className="text-neutral-400" />
                {summary.participant_count}
              </span>
              <span className="inline-flex items-center gap-1">
                <ChatCenteredText size={14} className="text-neutral-400" />
                {t('communities.learner.threads', { count: summary.discussion_count })}
              </span>
            </span>
          ) : (
            <span />
          )}
          {lastActive && <span className="text-neutral-400 truncate">{lastActive}</span>}
        </div>
      </div>
    </div>
  )
}

export function CommunityTileSkeleton() {
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden animate-pulse">
      <div className="aspect-video bg-neutral-100" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-neutral-100 rounded w-3/4" />
        <div className="h-3 bg-neutral-100 rounded w-full" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
      </div>
    </div>
  )
}
