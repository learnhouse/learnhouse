'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
import { Edit, Trash2, MoreVertical } from 'lucide-react'
import UserAvatar from '@components/Objects/UserAvatar'
import { useRouter } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config'
import { DiscussionWithAuthor, DiscussionAuthor, deleteDiscussion, getLabelInfo } from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { CommentSection } from './CommentSection'
import { DiscussionContent } from './DiscussionContent'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"

interface DiscussionDetailProps {
  discussion: DiscussionWithAuthor
  communityUuid: string
  orgslug: string
  onEdit?: () => void
}

/**
 * Parse discussion content - handles both JSON (tiptap) and plain text (legacy)
 */
function parseDiscussionContent(content: string | null): any {
  if (!content) return null

  // Try to parse as JSON (tiptap content)
  try {
    const parsed = JSON.parse(content)
    // Verify it looks like tiptap content
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return parsed
    }
    // Not tiptap format, return as string
    return content
  } catch {
    // Not JSON, return as plain text
    return content
  }
}

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

export function DiscussionDetail({
  discussion,
  communityUuid,
  orgslug,
  onEdit,
}: DiscussionDetailProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const communityId = communityUuid.replace('community_', '')
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id

  const timeAgo = dayjs(discussion.creation_date).fromNow()
  const isAuthor = currentUserId === discussion.author_id
  const labelInfo = getLabelInfo(discussion.label || 'general')

  const authorName = discussion.author
    ? `${discussion.author.first_name} ${discussion.author.last_name}`.trim() || discussion.author.username
    : t('common.unknown')

  const handleDelete = async () => {
    try {
      await deleteDiscussion(discussion.discussion_uuid, accessToken)
      router.push(getUriWithOrg(orgslug, `/community/${communityId}`))
      router.refresh()
    } catch (error) {
      console.error('Failed to delete discussion:', error)
    }
  }

  return (
    <div className="bg-white nice-shadow rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        {/* Title Row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 break-words flex items-start gap-3">
              {discussion.emoji && (
                <span className="text-3xl flex-shrink-0">{discussion.emoji}</span>
              )}
              <span>{discussion.title}</span>
            </h1>
          </div>

          {isAuthor && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <MoreVertical size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onEdit && (
                  <DropdownMenuItem onClick={onEdit}>
                    <Edit className="mr-2 h-4 w-4" />
                    {t('communities.discussion_detail.edit')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <ConfirmationModal
                    confirmationMessage={t('communities.discussion_detail.delete_confirm')}
                    confirmationButtonText={t('communities.discussion_detail.delete_button')}
                    dialogTitle={t('communities.discussion_detail.delete_title')}
                    dialogTrigger={
                      <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                        <Trash2 className="mr-2 h-4 w-4" /> {t('communities.discussion_detail.delete')}
                      </button>
                    }
                    functionToExecute={handleDelete}
                    status="warning"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Author info - Mobile only */}
        <div className="mt-4 flex items-center gap-3 md:hidden">
          <UserAvatar
            width={36}
            rounded="rounded-full"
            avatar_url={getAvatarUrl(discussion.author) || undefined}
            predefined_avatar={discussion.author?.avatar_image ? undefined : 'empty'}
            showProfilePopup={true}
            userId={discussion.author?.id?.toString()}
            shadow="shadow-none"
          />
          <div>
            <div className="text-sm font-medium text-gray-900">{authorName}</div>
            <div className="text-xs text-gray-500">{timeAgo}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {discussion.content ? (
          <div className="prose prose-gray max-w-none">
            <DiscussionContent content={parseDiscussionContent(discussion.content)} />
          </div>
        ) : (
          <p className="text-gray-500 italic">{t('communities.discussion_detail.no_details')}</p>
        )}
      </div>

      {/* Comments Section */}
      <div className="border-t border-gray-100">
        <CommentSection
          discussionUuid={discussion.discussion_uuid}
          isLocked={discussion.is_locked}
        />
      </div>
    </div>
  )
}

export default DiscussionDetail
