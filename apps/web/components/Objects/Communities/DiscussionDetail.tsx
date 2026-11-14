'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  CheckCircle,
  DotsThree,
  LinkSimple,
  LockSimple,
  LockSimpleOpen,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Trash,
} from '@phosphor-icons/react'
import {
  DiscussionWithAuthor,
  deleteDiscussion,
  lockDiscussion,
  pinDiscussion,
} from '@services/communities/discussions'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCommunityRights } from '@components/Hooks/useCommunityRights'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button, Chip, ConfirmDialog, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { CommentSection } from './CommentSection'
import { DiscussionContent } from './DiscussionContent'
import { UpvoteButton } from './UpvoteButton'
import { ReactionButton } from './ReactionButton'
import { AuthorAvatar, LabelChip, authorDisplayName, communityHref, shareLink, threadHref } from './communityUi'

/** Tiptap JSON, or legacy plain text. */
export function parseDiscussionContent(content: string | null): any {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && parsed.type === 'doc' ? parsed : content
  } catch {
    return content
  }
}

const errorMessage = (err: any, fallback: string) =>
  (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
  (typeof err?.detail === 'string' && err.detail) ||
  err?.message ||
  fallback

/** The post body, kept to a readable measure inside a full-width card. */
export function ThreadBody({
  discussion,
  allowRichContent,
}: {
  discussion: DiscussionWithAuthor
  allowRichContent: boolean
}) {
  const { t } = useTranslation()
  return discussion.content ? (
    <div className="prose prose-neutral max-w-3xl prose-p:leading-relaxed">
      <DiscussionContent content={parseDiscussionContent(discussion.content)} allowRichContent={allowRichContent} />
    </div>
  ) : (
    <p className="text-sm text-neutral-400 italic">{t('communities.discussion_detail.no_details')}</p>
  )
}

/**
 * Share, edit and the author/moderator menu (pin, lock, delete). One copy for
 * the full thread page and the thread expanded in the feed, so both behave
 * the same.
 */
export function ThreadActions({
  discussion,
  communityUuid,
  orgslug,
  onEdit,
  onUpdated,
  onDeleted,
  extra,
}: {
  discussion: DiscussionWithAuthor
  communityUuid: string
  orgslug: string
  onEdit?: () => void
  onUpdated?: (_discussion: DiscussionWithAuthor) => void
  /** After a delete; defaults to going back to the community. */
  onDeleted?: () => void
  /** Leading items, e.g. "Open full page". */
  extra?: React.ReactNode
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id
  const { canManageCommunity } = useCommunityRights(communityUuid)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isAuthor = currentUserId === discussion.author_id

  const handleDelete = async () => {
    try {
      await deleteDiscussion(discussion.discussion_uuid, accessToken)
      if (onDeleted) onDeleted()
      else {
        router.push(communityHref(orgslug, communityUuid))
        router.refresh()
      }
    } catch (err: any) {
      toast.error(errorMessage(err, t('communities.discussion_detail.delete_failed')))
    }
  }
  const togglePin = async () => {
    try {
      onUpdated?.(await pinDiscussion(discussion.discussion_uuid, !discussion.is_pinned, accessToken))
    } catch (err: any) {
      toast.error(errorMessage(err, t('communities.discussion_card.pin_failed')))
    }
  }
  const toggleLock = async () => {
    try {
      onUpdated?.(await lockDiscussion(discussion.discussion_uuid, !discussion.is_locked, accessToken))
    } catch (err: any) {
      toast.error(errorMessage(err, t('communities.discussion_card.lock_failed')))
    }
  }
  const share = () =>
    shareLink(
      threadHref(orgslug, communityUuid, discussion.discussion_uuid),
      discussion.title,
      t('communities.learner.link_copied'),
      t('communities.learner.link_failed')
    )

  return (
    <div className="flex flex-wrap items-center gap-1">
      {extra}
      <Button size="sm" variant="ghost" icon={<LinkSimple size={13} />} onClick={share}>
        {t('communities.learner.share')}
      </Button>
      {isAuthor && onEdit && (
        <Button size="sm" variant="ghost" icon={<PencilSimple size={13} />} onClick={onEdit}>
          {t('communities.discussion_detail.edit')}
        </Button>
      )}
      {(isAuthor || canManageCommunity) && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('communities.learner.thread_actions')}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors"
            >
              <DotsThree size={18} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
            {canManageCommunity && (
              <>
                <DropdownMenuItem onSelect={togglePin} className="flex items-center gap-2 cursor-pointer">
                  {discussion.is_pinned ? <PushPinSlash size={15} /> : <PushPin size={15} />}
                  {discussion.is_pinned
                    ? t('communities.discussion_card.unpin_discussion')
                    : t('communities.discussion_card.pin_discussion')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleLock} className="flex items-center gap-2 cursor-pointer">
                  {discussion.is_locked ? <LockSimpleOpen size={15} /> : <LockSimple size={15} />}
                  {discussion.is_locked
                    ? t('communities.discussion_card.unlock_discussion')
                    : t('communities.discussion_card.lock_discussion')}
                </DropdownMenuItem>
                {!isAuthor && onEdit && (
                  <DropdownMenuItem onSelect={onEdit} className="flex items-center gap-2 cursor-pointer">
                    <PencilSimple size={15} /> {t('communities.discussion_detail.edit')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onSelect={() => setConfirmDelete(true)}
              className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
            >
              <Trash size={15} /> {t('communities.discussion_detail.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('communities.discussion_detail.delete_title')}
        message={t('communities.discussion_detail.delete_confirm')}
        confirmLabel={t('communities.discussion_detail.delete_button')}
        onConfirm={handleDelete}
      />
    </div>
  )
}

interface DiscussionDetailProps {
  discussion: DiscussionWithAuthor
  communityUuid: string
  orgslug: string
  onEdit?: () => void
  allowRichContent?: boolean
  /** Called when the thread changes here (answer, pin, lock). */
  onUpdated?: (_discussion: DiscussionWithAuthor) => void
}

/**
 * A thread on its own page: the post as an article with its actions, then
 * the replies. Long text keeps a readable line length.
 */
export function DiscussionDetail({
  discussion,
  communityUuid,
  orgslug,
  onEdit,
  allowRichContent = false,
  onUpdated,
}: DiscussionDetailProps) {
  const { t, i18n } = useTranslation()
  const posted = formatRelative(discussion.creation_date, i18n.language)
  const edited = (discussion.edit_count ?? 0) > 0

  return (
    <div className="flex flex-col gap-5">
      <article className="bg-white rounded-2xl nice-shadow overflow-hidden">
        <header className="px-5 sm:px-7 pt-5 sm:pt-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <LabelChip label={discussion.label} />
            {discussion.is_pinned && (
              <Chip tone="amber" icon={<PushPin size={12} weight="fill" />}>{t('communities.sidebar.pinned')}</Chip>
            )}
            {discussion.is_locked && (
              <Chip tone="neutral" icon={<LockSimple size={12} />}>{t('communities.sidebar.locked')}</Chip>
            )}
            {!!discussion.answer_comment_id && (
              <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>{t('communities.learner.answered')}</Chip>
            )}
          </div>
          <h1 className="mt-3 text-2xl sm:text-[28px] font-bold tracking-tight text-neutral-900 leading-tight break-words" dir="auto">
            {discussion.emoji && <span className="me-2">{discussion.emoji}</span>}
            {discussion.title}
          </h1>
          <div className="mt-4 flex items-center gap-3">
            <AuthorAvatar author={discussion.author} size={36} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-900 truncate">
                {authorDisplayName(discussion.author, t('common.unknown'))}
              </p>
              <p className="text-xs text-neutral-500">
                {posted}
                {edited && ` · ${t('communities.learner.thread.edited')}`}
              </p>
            </div>
          </div>
        </header>

        <div className="px-5 sm:px-7 py-5">
          <ThreadBody discussion={discussion} allowRichContent={allowRichContent} />
        </div>

        <footer className="px-5 sm:px-7 py-3 border-t border-neutral-100 flex flex-wrap items-center gap-2">
          <UpvoteButton
            discussionUuid={discussion.discussion_uuid}
            initialVoteCount={discussion.upvote_count}
            initialHasVoted={discussion.has_voted}
            compact
          />
          <ReactionButton discussionUuid={discussion.discussion_uuid} compact />
          <div className="ms-auto">
            <ThreadActions
              discussion={discussion}
              communityUuid={communityUuid}
              orgslug={orgslug}
              onEdit={onEdit}
              onUpdated={onUpdated}
            />
          </div>
        </footer>
      </article>

      <section className="bg-white rounded-2xl nice-shadow" aria-label={t('communities.learner.thread.replies')}>
        <h2 className="px-5 sm:px-7 pt-4 pb-1 text-sm font-semibold text-neutral-900">{t('communities.learner.thread.replies')}</h2>
        <CommentSection
          discussionUuid={discussion.discussion_uuid}
          communityUuid={communityUuid}
          isLocked={discussion.is_locked}
          discussionAuthorId={discussion.author_id}
          answerCommentId={discussion.answer_comment_id}
          onAnswerChange={(updated) => onUpdated?.({ ...discussion, answer_comment_id: updated.answer_comment_id })}
        />
      </section>
    </div>
  )
}

export default DiscussionDetail
