'use client'
import React, { useState, useCallback } from 'react'
import { ChevronUp } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { upvoteComment, removeCommentUpvote } from '@services/communities/discussions'
import { cn } from '@/lib/utils'

interface CommentUpvoteButtonProps {
  commentUuid: string
  initialVoteCount: number
  initialHasVoted: boolean
  onVoteChange?: (newCount: number, hasVoted: boolean) => void
}

export function CommentUpvoteButton({
  commentUuid,
  initialVoteCount,
  initialHasVoted,
  onVoteChange,
}: CommentUpvoteButtonProps) {
  const session = useLHSession() as any
  const [voteCount, setVoteCount] = useState(initialVoteCount)
  const [hasVoted, setHasVoted] = useState(initialHasVoted)
  const [isLoading, setIsLoading] = useState(false)

  const isAuthenticated = session?.status === 'authenticated'
  const accessToken = session?.data?.tokens?.access_token

  const handleVote = useCallback(async () => {
    if (!isAuthenticated || isLoading) return

    setIsLoading(true)

    // Optimistic update
    const newHasVoted = !hasVoted
    const newVoteCount = newHasVoted ? voteCount + 1 : Math.max(0, voteCount - 1)
    setHasVoted(newHasVoted)
    setVoteCount(newVoteCount)
    onVoteChange?.(newVoteCount, newHasVoted)

    try {
      if (newHasVoted) {
        await upvoteComment(commentUuid, accessToken)
      } else {
        await removeCommentUpvote(commentUuid, accessToken)
      }
    } catch (error) {
      // Revert on error
      setHasVoted(!newHasVoted)
      setVoteCount(newHasVoted ? voteCount : voteCount + 1)
      onVoteChange?.(voteCount, hasVoted)
      console.error('Comment vote failed:', error)
    } finally {
      setIsLoading(false)
    }
  }, [hasVoted, voteCount, isAuthenticated, isLoading, commentUuid, accessToken, onVoteChange])

  return (
    <button
      onClick={handleVote}
      disabled={!isAuthenticated || isLoading}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-md transition-all duration-200 text-xs',
        hasVoted
          ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
          : 'bg-gray-50 text-gray-500 hover:bg-gray-100',
        !isAuthenticated && 'opacity-50 cursor-not-allowed',
        isLoading && 'opacity-70'
      )}
      title={isAuthenticated ? (hasVoted ? 'Remove upvote' : 'Upvote this reply') : 'Sign in to vote'}
    >
      <ChevronUp
        size={14}
        className={cn(
          'transition-transform',
          hasVoted && 'text-indigo-600',
          isLoading && 'animate-pulse'
        )}
      />
      <span className="font-medium">{voteCount}</span>
    </button>
  )
}

export default CommentUpvoteButton
