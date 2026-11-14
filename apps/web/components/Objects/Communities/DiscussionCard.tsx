'use client'
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import toast from 'react-hot-toast'
import {
  ArrowSquareOut,
  CaretDown,
  ChatCircleDots,
  CheckCircle,
  DotsThree,
  LinkSimple,
  LockSimple,
  LockSimpleOpen,
  PushPin,
  PushPinSlash,
  Trash,
} from '@phosphor-icons/react'
import {
  DiscussionWithAuthor,
  pinDiscussion,
  lockDiscussion,
  deleteDiscussion,
} from '@services/communities/discussions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Chip, ConfirmDialog, buttonClass, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { UpvoteButton } from './UpvoteButton'
import { ReactionButton } from './ReactionButton'
import { CommentSection } from './CommentSection'
import { ThreadActions, ThreadBody } from './DiscussionDetail'
import { AuthorAvatar, LabelChip, authorDisplayName, plainTextOf, shareLink, threadHref } from './communityUi'

interface DiscussionCardProps {
  discussion: DiscussionWithAuthor
  orgslug: string
  communityUuid: string
  onClick?: () => void
  /** Reply count; undefined when unknown. */
  commentCount?: number
  /** Latest reply date, for "active 2h ago". */
  lastActivity?: string | null
  canManage?: boolean
  onDiscussionUpdate?: (_updated: DiscussionWithAuthor) => void
  onDiscussionDelete?: (_discussionUuid: string) => void
  /** Inline reading: the thread opens inside the card instead of a new page. */
  expanded?: boolean
  /** Close without animating (another thread is opening, keep the list still). */
  collapseInstantly?: boolean
  onToggle?: () => void
  onEdit?: () => void
  allowRichContent?: boolean
}

const errorMessage = (err: any, fallback: string) =>
  (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
  (typeof err?.detail === 'string' && err.detail) ||
  err?.message ||
  fallback

// Below sm the card links to the full thread page instead of opening inline.
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches

/**
 * One thread in a community feed: votes on the start side, then author,
 * title, a short excerpt and the facts that help pick a thread. With
 * `onToggle` it reads like a mail client: a click opens the whole thread in
 * place (body, replies, reply box); a click on the header closes it.
 */
export function DiscussionCard({
  discussion,
  orgslug,
  communityUuid,
  onClick,
  commentCount,
  lastActivity,
  canManage = false,
  onDiscussionUpdate,
  onDiscussionDelete,
  expanded = false,
  collapseInstantly = false,
  onToggle,
  onEdit,
  allowRichContent = false,
}: DiscussionCardProps) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id
  const reduceMotion = useReducedMotion()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [settled, setSettled] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const href = threadHref(orgslug, communityUuid, discussion.discussion_uuid)
  const excerpt = plainTextOf(discussion.content, 180)
  const posted = formatRelative(discussion.creation_date, i18n.language)
  const active =
    lastActivity && new Date(lastActivity).getTime() > new Date(discussion.creation_date).getTime()
      ? formatRelative(lastActivity, i18n.language)
      : null
  const isOwner = discussion.author_id === currentUserId
  const answered = !!discussion.answer_comment_id
  const panelId = `thread-panel-${discussion.discussion_uuid}`

  // On open: keep the header in view and move focus into the thread.
  useEffect(() => {
    if (!expanded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettled(false)
      return
    }
    headerRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
    panelRef.current?.focus({ preventScroll: true })
  }, [expanded, reduceMotion])

  const handlePin = async () => {
    try {
      const updated = await pinDiscussion(discussion.discussion_uuid, !discussion.is_pinned, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (err: any) {
      toast.error(errorMessage(err, t('communities.discussion_card.pin_failed')))
    }
  }
  const handleLock = async () => {
    try {
      const updated = await lockDiscussion(discussion.discussion_uuid, !discussion.is_locked, accessToken)
      onDiscussionUpdate?.(updated)
    } catch (err: any) {
      toast.error(errorMessage(err, t('communities.discussion_card.lock_failed')))
    }
  }
  const handleDelete = async () => {
    try {
      await deleteDiscussion(discussion.discussion_uuid, accessToken)
      onDiscussionDelete?.(discussion.discussion_uuid)
    } catch (err: any) {
      toast.error(errorMessage(err, t('communities.discussion_card.delete_failed')))
    }
  }

  // Title click: open in place, unless the visitor asked for a new tab or is on a phone.
  const onTitleClick = (e: React.MouseEvent) => {
    onClick?.()
    if (!onToggle || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || isPhone()) return
    e.preventDefault()
    onToggle()
  }
  // Clicking the bare header (not a control inside it) also toggles.
  const onHeaderClick = (e: React.MouseEvent) => {
    if (!onToggle || isPhone()) return
    if ((e.target as HTMLElement).closest('a,button,input,textarea,[role="menuitem"],[role="dialog"]')) return
    onToggle()
  }

  const duration = reduceMotion ? 0 : 0.22

  return (
    <article
      data-kbd-item=""
      data-expanded={expanded || undefined}
      className={`group relative transition-colors ${
        expanded ? 'bg-white' : discussion.is_pinned ? 'bg-amber-50/40' : 'hover:bg-neutral-50/70'
      }`}
    >
      <div
        ref={headerRef}
        onClick={onHeaderClick}
        className={`flex gap-3 sm:gap-4 px-4 sm:px-5 py-4 scroll-mt-24 ${onToggle ? 'cursor-pointer' : ''} ${
          expanded ? 'border-b border-neutral-100' : ''
        }`}
      >
        {/* Content first in the DOM so keyboard list navigation lands on the title. */}
        <div className="min-w-0 flex-1 flex flex-col">
          <Link
            href={href}
            onClick={onTitleClick}
            aria-expanded={onToggle ? expanded : undefined}
            aria-controls={onToggle ? panelId : undefined}
            className="mt-1.5 block group/title rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
          >
            <h3
              className={`font-semibold text-neutral-900 leading-snug group-hover/title:underline underline-offset-2 ${
                expanded ? 'text-lg' : 'text-[15px] line-clamp-2'
              }`}
              dir="auto"
            >
              {discussion.emoji && <span className="me-1.5">{discussion.emoji}</span>}
              {discussion.title}
            </h3>
            {excerpt && !expanded && (
              <p className="mt-1 text-sm text-neutral-500 line-clamp-2 leading-relaxed" dir="auto">
                {excerpt}
              </p>
            )}
          </Link>

          <div className="order-first flex items-center gap-2 text-xs text-neutral-500 min-w-0">
            <AuthorAvatar author={discussion.author} size={20} />
            <span className="font-medium text-neutral-700 truncate">
              {authorDisplayName(discussion.author, t('common.unknown'))}
            </span>
            {posted && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0">{posted}</span>
              </>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-500">
            <LabelChip label={discussion.label} />
            {discussion.is_pinned && (
              <Chip tone="amber" icon={<PushPin size={12} weight="fill" />}>{t('communities.sidebar.pinned')}</Chip>
            )}
            {discussion.is_locked && (
              <Chip tone="neutral" icon={<LockSimple size={12} />}>{t('communities.sidebar.locked')}</Chip>
            )}
            {answered && (
              <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>{t('communities.learner.answered')}</Chip>
            )}
            {commentCount !== undefined && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ChatCircleDots size={14} className="text-neutral-400" />
                {t('communities.learner.replies', { count: commentCount })}
              </span>
            )}
            {active && <span className="text-neutral-400">{t('communities.learner.active', { time: active })}</span>}
          </div>
        </div>

        <div className="order-first shrink-0 pt-0.5">
          <UpvoteButton
            discussionUuid={discussion.discussion_uuid}
            initialVoteCount={discussion.upvote_count}
            initialHasVoted={discussion.has_voted}
            compact
          />
        </div>

        <div className="shrink-0 flex items-start gap-0.5">
          {onToggle && (
            <span
              aria-hidden
              className={`hidden sm:inline-flex h-8 w-8 items-center justify-center text-neutral-300 transition-transform ${
                expanded ? 'rotate-180 text-neutral-500' : ''
              }`}
            >
              <CaretDown size={16} />
            </span>
          )}
          {!expanded && (
            <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('communities.learner.thread_actions')}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors"
                  >
                    <DotsThree size={18} weight="bold" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                  <DropdownMenuItem
                    onSelect={() =>
                      shareLink(href, discussion.title, t('communities.learner.link_copied'), t('communities.learner.link_failed'))
                    }
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <LinkSimple size={15} /> {t('communities.learner.copy_link')}
                  </DropdownMenuItem>
                  {canManage && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={handlePin} className="flex items-center gap-2 cursor-pointer">
                        {discussion.is_pinned ? <PushPinSlash size={15} /> : <PushPin size={15} />}
                        {discussion.is_pinned
                          ? t('communities.discussion_card.unpin_discussion')
                          : t('communities.discussion_card.pin_discussion')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={handleLock} className="flex items-center gap-2 cursor-pointer">
                        {discussion.is_locked ? <LockSimpleOpen size={15} /> : <LockSimple size={15} />}
                        {discussion.is_locked
                          ? t('communities.discussion_card.unlock_discussion')
                          : t('communities.discussion_card.lock_discussion')}
                      </DropdownMenuItem>
                    </>
                  )}
                  {(canManage || isOwner) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setConfirmDelete(true)}
                        className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
                      >
                        <Trash size={15} /> {t('communities.discussion_card.delete_discussion')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {/* Closed by another thread opening: unmount at once (no exit animation)
          so the list can keep the new card's top where it was. */}
      <PanelPresence instant={collapseInstantly}>
        {expanded && (
          <motion.div
            key="panel"
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { duration, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ height: 0, opacity: 0, transition: { duration: collapseInstantly ? 0 : duration, ease: 'easeInOut' } }}
            onAnimationComplete={() => setSettled(true)}
            // Clipped while animating; afterwards the sticky reply box needs overflow visible.
            className={settled ? 'overflow-visible' : 'overflow-hidden'}
          >
            <div
              ref={panelRef}
              tabIndex={-1}
              role="region"
              aria-label={discussion.title}
              className="outline-none"
            >
              <div className="px-4 sm:px-5 sm:ps-[4.75rem] pt-4 pb-3 flex flex-col gap-4">
                <ThreadBody discussion={discussion} allowRichContent={allowRichContent} />
                <div className="flex flex-wrap items-center gap-2">
                  <ReactionButton discussionUuid={discussion.discussion_uuid} compact />
                  <div className="ms-auto">
                    <ThreadActions
                      discussion={discussion}
                      communityUuid={communityUuid}
                      orgslug={orgslug}
                      onEdit={onEdit}
                      onUpdated={(updated) => onDiscussionUpdate?.({ ...discussion, ...updated })}
                      onDeleted={() => onDiscussionDelete?.(discussion.discussion_uuid)}
                      extra={
                        <Link href={href} className={buttonClass('ghost', 'sm')}>
                          <ArrowSquareOut size={13} />
                          {t('communities.learner.open_full_page')}
                        </Link>
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="sm:ms-[3.75rem] border-t border-neutral-100">
                <CommentSection
                  discussionUuid={discussion.discussion_uuid}
                  communityUuid={communityUuid}
                  isLocked={discussion.is_locked}
                  discussionAuthorId={discussion.author_id}
                  answerCommentId={discussion.answer_comment_id}
                  onAnswerChange={(updated) =>
                    onDiscussionUpdate?.({ ...discussion, answer_comment_id: updated.answer_comment_id })
                  }
                  pageSize={5}
                />
              </div>
            </div>
          </motion.div>
        )}
      </PanelPresence>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('communities.discussion_card.delete_title')}
        message={t('communities.discussion_card.delete_confirm')}
        confirmLabel={t('communities.discussion_card.delete_discussion')}
        onConfirm={handleDelete}
      />
    </article>
  )
}

function PanelPresence({ instant, children }: { instant: boolean; children: React.ReactNode }) {
  return instant ? <>{children}</> : <AnimatePresence initial={false}>{children}</AnimatePresence>
}

export function DiscussionCardSkeleton() {
  return (
    <div className="flex gap-4 px-5 py-4 animate-pulse">
      <div className="w-10 h-14 rounded-xl bg-neutral-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-32 rounded bg-neutral-100" />
        <div className="h-4 w-2/3 rounded bg-neutral-100" />
        <div className="h-3 w-full rounded bg-neutral-100" />
        <div className="h-3 w-1/3 rounded bg-neutral-100" />
      </div>
    </div>
  )
}

export default DiscussionCard
