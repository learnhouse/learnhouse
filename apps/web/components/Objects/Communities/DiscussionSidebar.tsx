'use client'
import React from 'react'
import Link from 'next/link'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  MessageCircle,
  Pin,
  Lock,
} from 'lucide-react'
import { Community } from '@services/communities/communities'
import { DiscussionWithAuthor, DiscussionAuthor, getLabelInfo } from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { UpvoteButton } from './UpvoteButton'
import { ReactionButton } from './ReactionButton'
import UserAvatar from '@components/Objects/UserAvatar'

dayjs.extend(relativeTime)

interface DiscussionSidebarProps {
  discussion: DiscussionWithAuthor
  community: Community
  orgslug: string
}

function getAvatarUrl(author: DiscussionAuthor | null): string | null {
  if (!author?.avatar_image) return null
  if (author.avatar_image.startsWith('http://') || author.avatar_image.startsWith('https://')) {
    return author.avatar_image
  }
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

export function DiscussionSidebar({
  discussion,
  community,
  orgslug,
}: DiscussionSidebarProps) {
  const communityId = community.community_uuid.replace('community_', '')
  const timeAgo = dayjs(discussion.creation_date).fromNow()
  const createdDate = dayjs(discussion.creation_date).format('MMM D, YYYY')
  const labelInfo = getLabelInfo(discussion.label || 'general')

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : 'Unknown'

  return (
    <div className="space-y-4">
      {/* Author Card */}
      <div className="bg-white nice-shadow rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            Posted by
          </div>
          <div className="flex items-center gap-3">
            <UserAvatar
              width={44}
              rounded="rounded-full"
              avatar_url={getAvatarUrl(discussion.author) || undefined}
              predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
              showProfilePopup={true}
              userId={discussion.author?.id?.toString()}
              shadow="shadow-none"
            />
            <div className="min-w-0">
              <div className="font-medium text-gray-900 truncate">{authorName}</div>
              <div className="text-xs text-gray-500">{timeAgo}</div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 py-3 space-y-3">
          {/* Upvotes */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Upvotes</span>
            <UpvoteButton
              discussionUuid={discussion.discussion_uuid}
              initialVoteCount={discussion.upvote_count}
              initialHasVoted={discussion.has_voted}
              compact
            />
          </div>

          {/* Label */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Category</span>
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: `${labelInfo.color}15`,
                color: labelInfo.color,
              }}
            >
              {labelInfo.name}
            </span>
          </div>

          {/* Date */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Created</span>
            <span className="text-sm text-gray-900">{createdDate}</span>
          </div>

          {/* Status badges */}
          {(discussion.is_pinned || discussion.is_locked) && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              {discussion.is_pinned && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                  <Pin size={10} />
                  Pinned
                </span>
              )}
              {discussion.is_locked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                  <Lock size={10} />
                  Locked
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reactions Card */}
      <div className="bg-white nice-shadow rounded-lg overflow-hidden p-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
          Reactions
        </div>
        <ReactionButton discussionUuid={discussion.discussion_uuid} />
      </div>

      {/* Community Link */}
      <div className="bg-white nice-shadow rounded-lg overflow-hidden p-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          Community
        </div>
        <Link
          href={getUriWithOrg(orgslug, `/community/${communityId}`)}
          className="group flex items-center gap-2 text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
        >
          <MessageCircle size={14} className="text-gray-400 group-hover:text-indigo-500" />
          {community.name}
        </Link>
      </div>
    </div>
  )
}

export default DiscussionSidebar
