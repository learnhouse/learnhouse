'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
import {
  MessageSquare,
  Check,
  Pin,
  Lock,
  MoreVertical,
  Trash2,
  HelpCircle,
  Lightbulb,
  Megaphone,
  Star,
} from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import {
  DiscussionWithAuthor,
  DiscussionAuthor,
  getLabelInfo,
  pinDiscussion,
  lockDiscussion,
  deleteDiscussion,
} from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { UpvoteButton } from './UpvoteButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import UserAvatar from '@components/Objects/UserAvatar'

/**
 * Get the proper avatar URL for a user
 */
function getAvatarUrl(author: DiscussionAuthor | null): string | null {
  if (!author?.avatar_image) return null

  // If it's already a full URL (external auth like Google), use directly
  if (author.avatar_image.startsWith('http://') || author.avatar_image.startsWith('https://')) {
    return author.avatar_image
  }

  // Otherwise construct the media URL
  return getUserAvatarMediaDirectory(author.user_uuid, author.avatar_image)
}

// Get the icon component for a label
function getLabelIcon(iconName: string, size: number = 12) {
  switch (iconName) {
    case 'HelpCircle':
      return <HelpCircle size={size} />
    case 'Lightbulb':
      return <Lightbulb size={size} />
    case 'Megaphone':
      return <Megaphone size={size} />
    case 'Star':
      return <Star size={size} />
    default:
      return <MessageSquare size={size} />
  }
}

interface DiscussionCardProps {
  discussion: DiscussionWithAuthor
  orgslug: string
  communityUuid: string
  onClick?: () => void
  commentCount?: number
  isSelectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
  canManage?: boolean
  onDiscussionUpdate?: (updated: DiscussionWithAuthor) => void
  onDiscussionDelete?: (discussionUuid: string) => void
}

const removeDiscussionPrefix = (discussionId: string) => {
  return discussionId.replace('discussion_', '')
}

export function DiscussionCard({
  discussion,
  orgslug,
  communityUuid,
  onClick,
  commentCount = 0,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  canManage = false,
  onDiscussionUpdate,
  onDiscussionDelete,
}: DiscussionCardProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id

  const discussionId = removeDiscussionPrefix(discussion.discussion_uuid)
  const communityId = communityUuid.replace('community_', '')

  const timeAgo = dayjs(discussion.creation_date).fromNow()

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  const discussionLink = getUriWithOrg(orgslug, `/community/${communityId}/discussion/${discussionId}`)

  const labelInfo = getLabelInfo(discussion.label || 'general')
  const isOwner = discussion.author_id === currentUserId
  const showActions = canManage || isOwner

  const handleClick = (e: React.MouseEvent) => {
    if (isSelectMode && onToggleSelect) {
      e.preventDefault()
      onToggleSelect()
    }
  }

  const handlePin = async () => {
    if (!accessToken) return
    try {
      const updated = await pinDiscussion(discussion.discussion_uuid, !discussion.is_pinned, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (error) {
      console.error('Failed to pin discussion:', error)
    }
  }

  const handleLock = async () => {
    if (!accessToken) return
    try {
      const updated = await lockDiscussion(discussion.discussion_uuid, !discussion.is_locked, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (error) {
      console.error('Failed to lock discussion:', error)
    }
  }

  const handleDelete = async () => {
    if (!accessToken) return
    try {
      await deleteDiscussion(discussion.discussion_uuid, accessToken)
      onDiscussionDelete?.(discussion.discussion_uuid)
    } catch (error) {
      console.error('Failed to delete discussion:', error)
    }
  }

  return (
    <div
      onClick={isSelectMode ? handleClick : undefined}
      className={`flex items-center gap-4 py-3 px-4 transition-colors border-b border-gray-100 last:border-b-0 ${
        isSelectMode ? 'cursor-pointer' : ''
      } ${
        isSelected
          ? 'bg-indigo-50/50'
          : discussion.is_pinned
          ? 'bg-amber-50/30'
          : 'hover:bg-gray-50/50'
      }`}
    >
      {/* Checkbox for Select Mode */}
      {isSelectMode && (
        <div className="flex-shrink-0">
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-indigo-600 border-indigo-600'
                : 'border-gray-300 bg-white'
            }`}
          >
            {isSelected && <Check size={12} className="text-white" />}
          </div>
        </div>
      )}

      {/* Upvote Section */}
      {!isSelectMode && (
        <div className="flex-shrink-0 w-12">
          <UpvoteButton
            discussionUuid={discussion.discussion_uuid}
            initialVoteCount={discussion.upvote_count}
            initialHasVoted={discussion.has_voted}
            compact
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3">
          {/* Discussion Icon - Custom emoji or Label icon */}
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
            style={{ backgroundColor: discussion.emoji ? '#f3f4f6' : `${labelInfo.color}15` }}
          >
            {discussion.emoji ? (
              <span className="text-base">{discussion.emoji}</span>
            ) : (
              <span style={{ color: labelInfo.color }}>
                {getLabelIcon(labelInfo.icon, 14)}
              </span>
            )}
          </div>

          {/* Title and Meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {/* Pinned indicator */}
              {discussion.is_pinned && (
                <Pin size={12} className="text-amber-500 flex-shrink-0" />
              )}
              {/* Locked indicator */}
              {discussion.is_locked && (
                <Lock size={12} className="text-gray-400 flex-shrink-0" />
              )}

              {isSelectMode ? (
                <h3 className="text-sm font-medium text-gray-900 line-clamp-1">
                  {discussion.title}
                </h3>
              ) : (
                <Link
                  href={discussionLink}
                  onClick={onClick}
                  className="block group flex-1 min-w-0"
                >
                  <h3 className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                    {discussion.title}
                  </h3>
                </Link>
              )}
            </div>

            <div className="mt-1 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
              {/* Label badge */}
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: `${labelInfo.color}15`,
                  color: labelInfo.color,
                }}
              >
                {t(`communities.labels.${discussion.label || 'general'}`)}
              </span>
              {isSelectMode ? (
                <span>{authorName}</span>
              ) : (
                <Link href={discussionLink} className="hover:text-gray-700 hover:underline">
                  {authorName}
                </Link>
              )}
              <span className="text-gray-300">·</span>
              <span>{timeAgo}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Author Avatar & Comment Count */}
      {!isSelectMode && (
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Author Avatar */}
          <div className="hidden sm:block">
            <UserAvatar
              width={24}
              rounded="rounded-full"
              avatar_url={getAvatarUrl(discussion.author) || undefined}
              predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
              showProfilePopup={true}
              userId={discussion.author?.id?.toString()}
              shadow="shadow-none"
              border="border-2"
              borderColor="border-white"
            />
          </div>

          {/* Comment Count */}
          <div className="flex items-center gap-1 text-gray-400 min-w-[40px] justify-end">
            <MessageSquare size={14} />
            <span className="text-xs">{commentCount}</span>
          </div>

          {/* Actions Menu */}
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={16} className="text-gray-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canManage && (
                  <>
                    <DropdownMenuItem onClick={handlePin} className="cursor-pointer">
                      <Pin size={14} className="me-2" />
                      {discussion.is_pinned ? t('communities.discussion_card.unpin_discussion') : t('communities.discussion_card.pin_discussion')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLock} className="cursor-pointer">
                      <Lock size={14} className="me-2" />
                      {discussion.is_locked ? t('communities.discussion_card.unlock_discussion') : t('communities.discussion_card.lock_discussion')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <ConfirmationModal
                  confirmationMessage={t('communities.discussion_card.delete_confirm')}
                  confirmationButtonText={t('communities.comments.delete')}
                  dialogTitle={t('communities.discussion_card.delete_title')}
                  dialogTrigger={
                    <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-sm transition-colors cursor-pointer">
                      <Trash2 size={14} className="me-2" />
                      {t('communities.discussion_card.delete_discussion')}
                    </button>
                  }
                  functionToExecute={handleDelete}
                  status="warning"
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Show upvote count in select mode */}
      {isSelectMode && (
        <div className="flex items-center gap-1 text-gray-400 flex-shrink-0">
          <span className="text-xs">{discussion.upvote_count} {t('communities.discussion_card.votes')}</span>
        </div>
      )}
    </div>
  )
}

export default DiscussionCard
