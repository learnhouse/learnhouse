'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarBlank, CaretUp, ChatCircleDots, CheckCircle, Garage } from '@phosphor-icons/react'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { useOrg } from '@components/Contexts/OrgContext'
import { formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Community } from '@services/communities/communities'
import { DiscussionWithAuthor } from '@services/communities/discussions'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { useDiscussionActivity } from './DiscussionList'
import { AuthorAvatar, authorDisplayName, communityHref } from './communityUi'

interface DiscussionSidebarProps {
  discussion: DiscussionWithAuthor
  community: Community
  orgslug: string
}

/** Side column of a thread: who asked, the thread in numbers, and the way back. */
export function DiscussionSidebar({ discussion, community, orgslug }: DiscussionSidebarProps) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const { data: activity } = useDiscussionActivity(community.community_uuid)
  const stats = activity?.find((a) => a.discussion_uuid === discussion.discussion_uuid)
  const cover =
    community.thumbnail_image && org?.org_uuid
      ? getCommunityThumbnailMediaDirectory(org.org_uuid, community.community_uuid, community.thumbnail_image)
      : null
  const created = new Date(discussion.creation_date)
  const createdLabel = isNaN(created.getTime())
    ? null
    : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(created)
  const lastReply = stats?.last_comment_date ? formatRelative(stats.last_comment_date, i18n.language) : null

  const fact = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="inline-flex items-center gap-2 text-neutral-500 min-w-0 truncate">
        {icon}
        {label}
      </span>
      <span className="font-medium text-neutral-800 tabular-nums text-end whitespace-nowrap shrink-0">{value}</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl nice-shadow p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          {t('communities.sidebar.posted_by')}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <AuthorAvatar author={discussion.author} size={40} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900 truncate">
              {authorDisplayName(discussion.author, t('common.unknown'))}
            </p>
            {discussion.author?.username && (
              <p className="text-xs text-neutral-500 truncate">@{discussion.author.username}</p>
            )}
          </div>
        </div>
        <div className="mt-3 pt-1 border-t border-neutral-100 divide-y divide-neutral-100">
          {createdLabel && fact(<CalendarBlank size={15} />, t('communities.sidebar.created'), createdLabel)}
          {fact(<CaretUp size={15} weight="bold" />, t('communities.sidebar.upvotes'), discussion.upvote_count)}
          {stats && fact(<ChatCircleDots size={15} />, t('communities.learner.thread.replies'), stats.comment_count)}
          {lastReply && fact(<ChatCircleDots size={15} />, t('communities.learner.thread.last_reply'), lastReply)}
          {!!discussion.answer_comment_id &&
            fact(
              <CheckCircle size={15} className="text-emerald-600" weight="fill" />,
              t('communities.learner.answered'),
              <span className="text-emerald-700">{t('communities.learner.thread.solved')}</span>
            )}
        </div>
      </div>

      <Link
        href={communityHref(orgslug, community.community_uuid)}
        className="group bg-white rounded-2xl nice-shadow overflow-hidden flex items-center gap-3 p-3 transition-shadow hover:shadow-lg"
      >
        <span className="w-14 aspect-video rounded-lg overflow-hidden bg-neutral-100 shrink-0 relative">
          {cover ? (
            <ThumbnailImage src={cover} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-neutral-400">
              <Garage size={18} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {t('communities.sidebar.community')}
          </span>
          <span className="block text-sm font-semibold text-neutral-900 truncate" dir="auto">{community.name}</span>
        </span>
        <ArrowLeft size={16} className="text-neutral-300 group-hover:text-neutral-600 transition-colors rtl:rotate-180" />
      </Link>
    </div>
  )
}

export default DiscussionSidebar
