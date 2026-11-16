'use client'
import React, { useState, useCallback } from 'react'
import { CaretUp } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { upvoteComment, removeCommentUpvote } from '@services/communities/discussions'
import { cn } from '@/lib/utils'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface CommentUpvoteButtonProps {
  commentUuid: string
  initialVoteCount: number
  initialHasVoted: boolean
  onVoteChange?: (_newCount: number, _hasVoted: boolean) => void
}

export function CommentUpvoteButton({
  commentUuid,
  initialVoteCount,
  initialHasVoted,
  onVoteChange,
}: CommentUpvoteButtonProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { track } = useLHAnalytics('learner')
  const [voteCount, setVoteCount] = useState(initialVoteCount)
  const [hasVoted, setHasVoted] = useState(initialHasVoted)
  const [isLoading, setIsLoading] = useState(false)

  const isAuthenticated = session?.status === 'authenticated'
  const canVote = isAuthenticated && isUserPartOfTheOrg
  const accessToken = session?.data?.tokens?.access_token

  const handleVote = useCallback(async () => {
    if (!canVote || isLoading) return

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
      track(AnalyticsEvent.CommentUpvoted, {
        action: newHasVoted ? 'upvote' : 'remove',
        new_vote_count: newVoteCount,
      })
    } catch (err: any) {
      // Revert on error
      setHasVoted(!newHasVoted)
      setVoteCount(newHasVoted ? voteCount : voteCount + 1)
      onVoteChange?.(voteCount, hasVoted)
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        'Failed to vote.'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [hasVoted, voteCount, canVote, isLoading, commentUuid, accessToken, onVoteChange, track])

  return (
    <button
      onClick={handleVote}
      disabled={!canVote || isLoading}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 min-w-10 px-2 py-1.5 rounded-xl ring-1 ring-inset transition-colors duration-150 text-xs',
        hasVoted
          ? 'bg-neutral-900 text-white ring-neutral-900'
          : 'bg-white text-neutral-500 ring-neutral-200 hover:ring-neutral-300 hover:text-neutral-900',
        !canVote && 'opacity-50 cursor-not-allowed',
        isLoading && 'opacity-70'
      )}
      title={canVote ? (hasVoted ? t('communities.remove_upvote') : t('communities.upvote_reply')) : t('communities.join_to_vote')}
    >
      <CaretUp
        size={14}
        weight="bold"
        className={cn(
          'transition-transform',
          hasVoted && 'text-white',
          isLoading && 'animate-pulse'
        )}
      />
      <span className="font-semibold tabular-nums">{voteCount}</span>
    </button>
  )
}

export default CommentUpvoteButton
