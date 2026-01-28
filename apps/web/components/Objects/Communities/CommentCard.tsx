'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { MoreHorizontal, Pencil, Trash2, X, Check, Loader2, AlertCircle } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  DiscussionCommentWithAuthor,
  DiscussionAuthor,
  updateComment,
  deleteComment,
} from '@services/communities/discussions'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import UserAvatar from '@components/Objects/UserAvatar'
import { CommentUpvoteButton } from './CommentUpvoteButton'

dayjs.extend(relativeTime)

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

interface CommentCardProps {
  comment: DiscussionCommentWithAuthor
  onDeleted: (commentUuid: string) => void
  onUpdated: (comment: DiscussionCommentWithAuthor) => void
}

export function CommentCard({ comment, onDeleted, onUpdated }: CommentCardProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAuthor = currentUserId === comment.author_id
  const timeAgo = dayjs(comment.creation_date).fromNow()
  const authorName = comment.author
    ? `${comment.author.first_name} ${comment.author.last_name}`.trim() || comment.author.username
    : t('common.unknown')

  const handleEdit = async () => {
    if (!editContent.trim() || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const updated = await updateComment(
        comment.comment_uuid,
        { content: editContent.trim() },
        accessToken
      )
      onUpdated(updated)
      setIsEditing(false)
    } catch (err: any) {
      console.error('Failed to update reply:', err)
      if (err?.detail?.code === 'MODERATION_BLOCKED') {
        setError(err.detail.message || t('communities.comments.content_not_allowed'))
      } else if (typeof err?.detail === 'string') {
        setError(err.detail)
      } else {
        setError(t('communities.comments.failed_to_update'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      await deleteComment(comment.comment_uuid, accessToken)
      onDeleted(comment.comment_uuid)
    } catch (error) {
      console.error('Failed to delete reply:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancelEdit = () => {
    setEditContent(comment.content)
    setIsEditing(false)
    setError(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleEdit()
    }
    if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  return (
    <div
      className="group flex items-center gap-4 py-3 px-4 transition-colors border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Upvote Section */}
      <div className="flex-shrink-0 w-12">
        <CommentUpvoteButton
          commentUuid={comment.comment_uuid}
          initialVoteCount={comment.upvote_count || 0}
          initialHasVoted={comment.has_voted || false}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <UserAvatar
              width={32}
              rounded="rounded-full"
              avatar_url={getAvatarUrl(comment.author) || undefined}
              predefined_avatar={comment.author?.avatar_image ? undefined : 'empty'}
              showProfilePopup={true}
              userId={comment.author?.id?.toString()}
              shadow="shadow-none"
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-2">
                {error && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg text-red-700 text-sm">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <textarea
                  value={editContent}
                  onChange={(e) => {
                    setEditContent(e.target.value)
                    if (error) setError(null)
                  }}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  autoFocus
                  className={`w-full px-3 py-2 text-sm border rounded-lg outline-none transition-all resize-none ${
                    error ? 'border-red-300' : 'border-gray-200 focus:border-gray-300'
                  }`}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEdit}
                    disabled={!editContent.trim() || isSubmitting}
                    className="px-3 py-1 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : t('communities.comments.save')}
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={isSubmitting}
                    className="px-3 py-1 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    {t('communities.comments.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-gray-900 text-sm">{authorName}</span>
                  <span className="text-gray-400 text-xs">{timeAgo}</span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {comment.content}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions - Right side */}
      {isAuthor && !isEditing && (
        <div className={`flex-shrink-0 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 hover:bg-gray-100 rounded transition-colors">
                <MoreHorizontal size={16} className="text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t('communities.comments.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-red-600 focus:text-red-600 focus:bg-red-50"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('communities.comments.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

export default CommentCard
