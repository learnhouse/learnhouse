'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChatCircleDots, LockSimple, PaperPlaneRight, SignIn, UserPlus, Warning } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import {
  getComments,
  createComment,
  setDiscussionAnswer,
  DiscussionCommentWithAuthor,
  DiscussionWithAuthor,
} from '@services/communities/discussions'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import { queryKeys } from '@/lib/query/keys'
import { CommentCard } from './CommentCard'
import { readDraft, writeDraft } from './communityUi'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface CommentSectionProps {
  discussionUuid: string
  communityUuid?: string
  isLocked?: boolean
  /** Who started the thread: their replies get an "author" tag and they may choose the answer. */
  discussionAuthorId?: number
  /** Reply currently marked as the answer. */
  answerCommentId?: number | null
  /** Called with the updated thread after the answer changes. */
  onAnswerChange?: (_discussion: DiscussionWithAuthor) => void
  /** Show this many replies first, then a "show more" button. All when unset. */
  pageSize?: number
}

const replyDraftKey = (discussionUuid: string) => `lh_reply_draft_${discussionUuid}`

/**
 * Replies of a thread and the box to add one. Used on the learner thread page
 * and in the dashboard's thread reader, so a reply posts the same way from
 * both. The composer sticks to the bottom of its scroll area to stay in reach.
 */
export function CommentSection({
  discussionUuid,
  communityUuid,
  isLocked = false,
  discussionAuthorId,
  answerCommentId,
  onAnswerChange,
  pageSize,
}: CommentSectionProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const currentUserId = session?.data?.user?.id
  const queryClient = useQueryClient()
  const { isUserPartOfTheOrg } = useOrgMembership()
  const { canManageCommunity } = useCommunityRights(communityUuid || '')
  const { track } = useLHAnalytics('learner')
  const canComment = isAuthenticated && isUserPartOfTheOrg

  const commentsKey = queryKeys.discussion.comments(discussionUuid, 1)
  const { data, isLoading } = useQuery({
    queryKey: commentsKey,
    queryFn: () => getComments(discussionUuid, 1, 100, null, accessToken),
    enabled: !!discussionUuid && session?.status !== 'loading',
    staleTime: 15_000,
  })
  const comments: DiscussionCommentWithAuthor[] = useMemo(() => (Array.isArray(data) ? data : []), [data])
  const setComments = (fn: (_c: DiscussionCommentWithAuthor[]) => DiscussionCommentWithAuthor[]) =>
    queryClient.setQueryData<DiscussionCommentWithAuthor[]>(commentsKey, (old) => fn(Array.isArray(old) ? old : []))

  // Answer state follows the prop but updates at once when changed here.
  const [answerId, setAnswerId] = useState<number | null>(answerCommentId ?? null)
  const [answerProp, setAnswerProp] = useState(answerCommentId)
  if (answerCommentId !== answerProp) {
    setAnswerProp(answerCommentId)
    setAnswerId(answerCommentId ?? null)
  }
  const isThreadAuthor = discussionAuthorId !== undefined && currentUserId === discussionAuthorId
  const canChooseAnswer = canManageCommunity || (isThreadAuthor && !isLocked)

  // The answer reads first; the rest keep their order.
  const ordered = useMemo(() => {
    if (!answerId) return comments
    const answer = comments.find((c) => c.id === answerId)
    return answer ? [answer, ...comments.filter((c) => c.id !== answerId)] : comments
  }, [comments, answerId])

  const [shown, setShown] = useState(pageSize ?? Infinity)
  const visibleComments = ordered.slice(0, shown)
  const hiddenCount = ordered.length - visibleComments.length

  const toggleAnswer = async (comment: DiscussionCommentWithAuthor) => {
    const next = answerId === comment.id ? null : comment.id
    const previous = answerId
    setAnswerId(next)
    try {
      const updated = await setDiscussionAnswer(discussionUuid, next ? comment.comment_uuid : null, accessToken)
      onAnswerChange?.(updated)
      toast.success(next ? t('communities.learner.thread.answer_marked') : t('communities.learner.thread.answer_cleared'))
      if (communityUuid) queryClient.invalidateQueries({ queryKey: ['community', communityUuid, 'discussions'] })
    } catch (err: any) {
      setAnswerId(previous)
      toast.error(
        (typeof err?.detail === 'string' && err.detail) || err?.message || t('communities.learner.thread.answer_failed')
      )
    }
  }

  // ---- composer, with a per-thread draft kept in this browser ----
  const [newComment, setNewComment] = useState('')
  // Loaded after mount: the page is server-rendered and storage is client-only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewComment(readDraft<string>(replyDraftKey(discussionUuid)) ?? '')
  }, [discussionUuid])
  useEffect(() => {
    const id = window.setTimeout(() => writeDraft(replyDraftKey(discussionUuid), newComment.trim() ? newComment : null), 400)
    return () => window.clearTimeout(id)
  }, [newComment, discussionUuid])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!newComment.trim() || !canComment || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    try {
      const comment = await createComment(discussionUuid, { content: newComment.trim() }, accessToken)
      track(AnalyticsEvent.CommentPosted, { existing_comment_count: comments.length, is_locked: isLocked })
      setComments((prev) => [...prev, comment])
      setNewComment('')
      writeDraft(replyDraftKey(discussionUuid), null)
      if (communityUuid) {
        queryClient.invalidateQueries({ queryKey: ['community', communityUuid, 'discussions', 'activity'] })
      }
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.comments.failed_to_post')
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const composer = isLocked ? (
    <div className="flex items-center gap-2 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200/70 px-3.5 py-2.5 text-sm text-amber-800">
      <LockSimple size={15} className="shrink-0" />
      {t('communities.comments.locked')}
    </div>
  ) : canComment ? (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <Warning size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl bg-white ring-1 ring-inset ring-neutral-200 focus-within:ring-2 focus-within:ring-neutral-900/15 p-1.5 ps-3 transition-shadow">
        <textarea
          dir="auto"
          ref={textareaRef}
          value={newComment}
          onChange={(e) => {
            setNewComment(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
          aria-label={t('communities.comments.write_reply')}
          placeholder={t('communities.comments.write_reply')}
          rows={Math.min(6, Math.max(1, newComment.split('\n').length))}
          className="flex-1 min-w-0 py-1.5 text-base sm:text-sm bg-transparent outline-none resize-none placeholder:text-neutral-400 max-h-40"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<PaperPlaneRight size={14} className="rtl:-scale-x-100" />}
          loading={isSubmitting}
          disabled={!newComment.trim()}
        >
          <span className="hidden sm:inline">{t('communities.comments.reply')}</span>
        </Button>
      </div>
      {newComment.trim() && (
        <p className="text-[11px] text-neutral-400 px-1">{t('communities.learner.thread.composer_hint')}</p>
      )}
    </form>
  ) : isAuthenticated && !isUserPartOfTheOrg ? (
    <div className="flex items-center gap-2 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-200/70 px-3.5 py-2.5 text-sm text-amber-800">
      <UserPlus size={15} className="shrink-0" />
      {t('communities.comments.join_org_to_reply')}
    </div>
  ) : (
    <div className="flex items-center gap-2 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 px-3.5 py-2.5 text-sm text-neutral-600">
      <SignIn size={15} className="shrink-0" />
      <span>
        <span className="font-semibold text-neutral-800">{t('communities.comments.sign_in_to_reply')}</span>{' '}
        {t('communities.comments.to_reply')}
      </span>
    </div>
  )

  return (
    <div>
      {isLoading ? (
        <div className="divide-y divide-neutral-100 animate-pulse">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-4 px-5 py-4">
              <div className="w-10 h-12 rounded-xl bg-neutral-100" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 rounded bg-neutral-100" />
                <div className="h-3 w-3/4 rounded bg-neutral-100" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
          <span className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-400 flex items-center justify-center">
            <ChatCircleDots size={20} />
          </span>
          <p className="text-sm font-medium text-neutral-600">{t('communities.comments.no_replies')}</p>
          {canComment && !isLocked && (
            <p className="text-xs text-neutral-400">{t('communities.learner.thread.first_reply')}</p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-neutral-100">
          {visibleComments.map((comment) => (
            <CommentCard
              key={comment.comment_uuid}
              comment={comment}
              canManage={canManageCommunity}
              isAnswer={answerId === comment.id}
              byThreadAuthor={discussionAuthorId !== undefined && comment.author_id === discussionAuthorId}
              canChooseAnswer={canChooseAnswer}
              onToggleAnswer={() => toggleAnswer(comment)}
              onDeleted={(uuid) => {
                setComments((prev) => prev.filter((c) => c.comment_uuid !== uuid))
                if (comment.id === answerId) setAnswerId(null)
                if (communityUuid) {
                  queryClient.invalidateQueries({ queryKey: ['community', communityUuid, 'discussions'] })
                }
              }}
              onUpdated={(updated) =>
                setComments((prev) => prev.map((c) => (c.comment_uuid === updated.comment_uuid ? updated : c)))
              }
            />
          ))}
          {hiddenCount > 0 && (
            <div className="px-5 py-3 flex justify-center">
              <Button size="sm" onClick={() => setShown((n) => n + (pageSize ?? 10))}>
                {t('communities.learner.thread.more_replies', { count: hiddenCount })}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="sticky bottom-0 z-[1] border-t border-neutral-100 bg-white/95 backdrop-blur p-3 sm:p-4">{composer}</div>
    </div>
  )
}

export default CommentSection
