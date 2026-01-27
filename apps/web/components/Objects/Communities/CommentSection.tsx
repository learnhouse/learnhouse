'use client'
import React, { useState, useEffect, useRef } from 'react'
import { MessageSquare, Send, Loader2, User, AlertCircle, Lock } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  getComments,
  createComment,
  DiscussionCommentWithAuthor,
} from '@services/communities/discussions'
import { CommentCard } from './CommentCard'
import UserAvatar from '@components/Objects/UserAvatar'

interface CommentSectionProps {
  discussionUuid: string
  isLocked?: boolean
}

export function CommentSection({ discussionUuid, isLocked = false }: CommentSectionProps) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const currentUser = session?.data?.user

  const [comments, setComments] = useState<DiscussionCommentWithAuthor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const fetchComments = async () => {
    setIsLoading(true)
    try {
      const result = await getComments(discussionUuid, 1, 100, null, accessToken)
      setComments(result || [])
    } catch (error) {
      console.error('Failed to fetch replies:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchComments()
  }, [discussionUuid])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim() || !isAuthenticated || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const comment = await createComment(
        discussionUuid,
        { content: newComment.trim() },
        accessToken
      )
      setComments((prev) => [...prev, comment])
      setNewComment('')
      setIsFocused(false)
    } catch (err: any) {
      console.error('Failed to post reply:', err)
      // Handle moderation error
      if (err?.detail?.code === 'MODERATION_BLOCKED') {
        setError(err.detail.message || 'Your reply contains content that is not allowed.')
      } else if (typeof err?.detail === 'string') {
        setError(err.detail)
      } else {
        setError('Failed to post reply. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e)
    }
  }

  const handleCommentDeleted = (commentUuid: string) => {
    setComments((prev) => prev.filter((c) => c.comment_uuid !== commentUuid))
  }

  const handleCommentUpdated = (updatedComment: DiscussionCommentWithAuthor) => {
    setComments((prev) =>
      prev.map((c) =>
        c.comment_uuid === updatedComment.comment_uuid ? updatedComment : c
      )
    )
  }

  return (
    <div>
      {/* Replies List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={18} className="animate-spin text-gray-400" />
        </div>
      ) : comments.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-gray-400 text-sm">No replies yet</p>
        </div>
      ) : (
        <>
          {comments.map((comment) => (
            <CommentCard
              key={comment.comment_uuid}
              comment={comment}
              onDeleted={handleCommentDeleted}
              onUpdated={handleCommentUpdated}
            />
          ))}
        </>
      )}

      {/* Reply Input */}
      <div className="p-4 border-t border-gray-100">
        {isLocked ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-md">
            <Lock size={14} className="text-amber-600" />
            <p className="text-sm text-amber-700">This discussion is locked</p>
          </div>
        ) : isAuthenticated ? (
          <div>
            {error && (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-red-50 rounded-md text-red-700 text-sm">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className={`rounded-md border transition-all ${
                error
                  ? 'border-red-300'
                  : isFocused
                    ? 'border-gray-300'
                    : 'border-gray-200'
              }`}>
                <textarea
                  ref={textareaRef}
                  value={newComment}
                  onChange={(e) => {
                    setNewComment(e.target.value)
                    if (error) setError(null)
                  }}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => !newComment && setIsFocused(false)}
                  onKeyDown={handleKeyDown}
                  placeholder="Write a reply..."
                  rows={isFocused || newComment ? 2 : 1}
                  className="w-full px-3 py-2 text-sm bg-transparent outline-none resize-none placeholder:text-gray-400"
                />

                {(isFocused || newComment) && (
                  <div className="flex items-center justify-end px-2 py-2 border-t border-gray-100">
                    <button
                      type="submit"
                      disabled={!newComment.trim() || isSubmitting}
                      className="px-3 py-1 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      {isSubmitting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        'Reply'
                      )}
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-md">
            <User size={14} className="text-gray-400" />
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">Sign in</span> to reply
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default CommentSection
