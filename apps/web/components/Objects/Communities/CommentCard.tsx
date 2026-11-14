'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { CheckCircle, DotsThree, PencilSimple, Trash, Warning, XCircle } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { DiscussionCommentWithAuthor, updateComment, deleteComment } from '@services/communities/discussions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button, Chip, ConfirmDialog, TEXTAREA, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { CommentUpvoteButton } from './CommentUpvoteButton'
import HashtagText from './Tags/HashtagText'
import { AuthorAvatar, authorDisplayName } from './communityUi'

interface CommentCardProps {
  comment: DiscussionCommentWithAuthor
  canManage?: boolean
  onDeleted: (commentUuid: string) => void
  onUpdated: (comment: DiscussionCommentWithAuthor) => void
  /** This reply is the accepted answer. */
  isAnswer?: boolean
  /** Written by the person who started the thread. */
  byThreadAuthor?: boolean
  /** Viewer may mark or unmark the answer (thread author or moderator). */
  canChooseAnswer?: boolean
  onToggleAnswer?: () => void
}

const errorMessage = (err: any, fallback: string) =>
  (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
  (typeof err?.detail === 'string' && err.detail) ||
  err?.message ||
  fallback

export function CommentCard({
  comment,
  canManage = false,
  onDeleted,
  onUpdated,
  isAnswer = false,
  byThreadAuthor = false,
  canChooseAnswer = false,
  onToggleAnswer,
}: CommentCardProps) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAuthor = currentUserId === comment.author_id
  const canDelete = isAuthor || canManage
  const showMenu = isAuthor || canManage || (canChooseAnswer && !!onToggleAnswer)
  const posted = formatRelative(comment.creation_date, i18n.language)
  // Dates come in two string shapes, so compare instants; a minute of slack
  // ignores the write that happens right after creation.
  const edited =
    !!comment.update_date &&
    new Date(comment.update_date).getTime() - new Date(comment.creation_date).getTime() > 60_000

  const handleEdit = async () => {
    if (!editContent.trim() || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    try {
      const updated = await updateComment(comment.comment_uuid, { content: editContent.trim() }, accessToken)
      onUpdated(updated)
      setIsEditing(false)
    } catch (err: any) {
      const message = errorMessage(err, t('communities.comments.failed_to_update'))
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteComment(comment.comment_uuid, accessToken)
      onDeleted(comment.comment_uuid)
    } catch (err: any) {
      toast.error(errorMessage(err, t('communities.comments.failed_to_delete')))
    }
  }

  const cancelEdit = () => {
    setEditContent(comment.content)
    setIsEditing(false)
    setError(null)
  }

  return (
    <div
      className={`group flex gap-3 sm:gap-4 px-4 sm:px-5 py-4 transition-colors ${
        isAnswer ? 'bg-emerald-50/50' : 'hover:bg-neutral-50/60'
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <CommentUpvoteButton
          commentUuid={comment.comment_uuid}
          initialVoteCount={comment.upvote_count || 0}
          initialHasVoted={comment.has_voted || false}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <AuthorAvatar author={comment.author} size={24} />
          <span className="text-sm font-semibold text-neutral-900 truncate">
            {authorDisplayName(comment.author, t('common.unknown'))}
          </span>
          {byThreadAuthor && (
            <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
              {t('communities.learner.thread.op')}
            </span>
          )}
          {posted && (
            <span className="text-xs text-neutral-400" title={comment.creation_date}>
              {posted}
              {edited && ` · ${t('communities.learner.thread.edited')}`}
            </span>
          )}
          {isAnswer && (
            <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />} className="ms-auto">
              {t('communities.learner.thread.answer')}
            </Chip>
          )}
        </div>

        {isEditing ? (
          <div className="mt-2 space-y-2">
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <Warning size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <textarea
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
              rows={3}
              autoFocus
              aria-label={t('communities.comments.edit')}
              className={TEXTAREA}
              dir="auto"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={handleEdit} loading={isSubmitting} disabled={!editContent.trim()}>
                {t('communities.comments.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={isSubmitting}>
                {t('communities.comments.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1.5 text-[15px] leading-relaxed text-neutral-700 whitespace-pre-wrap break-words" dir="auto">
            <HashtagText text={comment.content} />
          </p>
        )}

        {/* The answer action sits in reach, not only in a menu. */}
        {canChooseAnswer && onToggleAnswer && !isEditing && !isAnswer && (
          <button
            type="button"
            onClick={onToggleAnswer}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-neutral-400 hover:text-emerald-700 transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
          >
            <CheckCircle size={14} />
            {t('communities.learner.thread.mark_answer')}
          </button>
        )}
      </div>

      {showMenu && !isEditing && (
        <div className="shrink-0 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('communities.comments.actions')}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors"
              >
                <DotsThree size={18} weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
              {canChooseAnswer && onToggleAnswer && (
                <DropdownMenuItem onSelect={onToggleAnswer} className="flex items-center gap-2 cursor-pointer">
                  {isAnswer ? <XCircle size={15} /> : <CheckCircle size={15} />}
                  {isAnswer ? t('communities.learner.thread.unmark_answer') : t('communities.learner.thread.mark_answer')}
                </DropdownMenuItem>
              )}
              {isAuthor && (
                <DropdownMenuItem onSelect={() => setIsEditing(true)} className="flex items-center gap-2 cursor-pointer">
                  <PencilSimple size={15} />
                  {t('communities.comments.edit')}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setConfirmDelete(true)}
                    className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
                  >
                    <Trash size={15} />
                    {t('communities.comments.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('communities.learner.thread.delete_reply_title')}
        message={t('communities.learner.thread.delete_reply_message')}
        confirmLabel={t('communities.comments.delete')}
        onConfirm={handleDelete}
      />
    </div>
  )
}

export default CommentCard
