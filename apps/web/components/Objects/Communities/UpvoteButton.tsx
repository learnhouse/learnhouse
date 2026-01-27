'use client'
import React, { useState, useCallback } from 'react'
import { ChevronUp } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { upvoteDiscussion, removeUpvote } from '@services/communities/discussions'
import { cn } from '@/lib/utils'

interface UpvoteButtonProps {
  discussionUuid: string
  initialVoteCount: number
  initialHasVoted: boolean
  onVoteChange?: (newCount: number, hasVoted: boolean) => void
  disabled?: boolean
  compact?: boolean
}

export function UpvoteButton({
  discussionUuid,
  initialVoteCount,
  initialHasVoted,
  onVoteChange,
  disabled = false,
  compact = false,
}: UpvoteButtonProps) {
  const session = useLHSession() as any
  const [voteCount, setVoteCount] = useState(initialVoteCount)
  const [hasVoted, setHasVoted] = useState(initialHasVoted)
  const [isLoading, setIsLoading] = useState(false)

  const isAuthenticated = session?.status === 'authenticated'
  const accessToken = session?.data?.tokens?.access_token

  const handleVote = useCallback(async () => {
    if (!isAuthenticated || isLoading || disabled) return

    setIsLoading(true)

    // Optimistic update
    const newHasVoted = !hasVoted
    const newVoteCount = newHasVoted ? voteCount + 1 : voteCount - 1
    setHasVoted(newHasVoted)
    setVoteCount(newVoteCount)
    onVoteChange?.(newVoteCount, newHasVoted)

    try {
      if (newHasVoted) {
        await upvoteDiscussion(discussionUuid, accessToken)
      } else {
        await removeUpvote(discussionUuid, accessToken)
      }
    } catch (error) {
      // Revert on error
      setHasVoted(!newHasVoted)
      setVoteCount(newHasVoted ? voteCount : voteCount + 1)
      onVoteChange?.(voteCount, hasVoted)
      console.error('Vote failed:', error)
    } finally {
      setIsLoading(false)
    }
  }, [hasVoted, voteCount, isAuthenticated, isLoading, disabled, discussionUuid, accessToken, onVoteChange])

  if (compact) {
    return (
      <button
        onClick={handleVote}
        disabled={!isAuthenticated || isLoading || disabled}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md transition-all duration-200 text-xs',
          hasVoted
            ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
            : 'bg-gray-50 text-gray-500 hover:bg-gray-100',
          (!isAuthenticated || disabled) && 'opacity-50 cursor-not-allowed',
          isLoading && 'opacity-70'
        )}
        title={isAuthenticated ? (hasVoted ? 'Remove upvote' : 'Upvote') : 'Sign in to vote'}
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

  return (
    <button
      onClick={handleVote}
      disabled={!isAuthenticated || isLoading || disabled}
      className={cn(
        'flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-all duration-200',
        hasVoted
          ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
        (!isAuthenticated || disabled) && 'opacity-50 cursor-not-allowed',
        isLoading && 'opacity-70'
      )}
      title={isAuthenticated ? (hasVoted ? 'Remove upvote' : 'Upvote') : 'Sign in to vote'}
    >
      <ChevronUp
        size={20}
        className={cn(
          'transition-transform',
          hasVoted && 'text-blue-600',
          isLoading && 'animate-pulse'
        )}
      />
      <span className="text-xs font-semibold">{voteCount}</span>
    </button>
  )
}

export default UpvoteButton
