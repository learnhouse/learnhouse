'use client'
import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  CaretUp,
  ChatCircleDots,
  LockSimple,
  LockSimpleOpen,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Trash,
  X,
} from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getDiscussion, type DiscussionWithAuthor } from '@services/communities/discussions'
import { DiscussionContent } from '@components/Objects/Communities/DiscussionContent'
import { CommentSection } from '@components/Objects/Communities/CommentSection'
import { Button, Chip, buttonClass, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { queryKeys } from '@/lib/query/keys'
import { AuthorAvatar, LabelChip, authorName } from './discussionUi'

// Below --z-dropdown (100) so the reused reply components' menus open above
// the panel, and below --z-modal so confirm dialogs stack on top of it.
const DRAWER_Z = 95

// Same parsing as the learner thread page: tiptap JSON, or legacy plain text.
function parseContent(content: string | null): any {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && parsed.type === 'doc' ? parsed : content
  } catch {
    return content
  }
}

type Props = {
  discussion: DiscussionWithAuthor | null
  communityUuid: string
  publicHref: string | null
  allowRichContent: boolean
  canModerate: boolean
  replyCount?: number
  onOpenChange: (_open: boolean) => void
  onTogglePin: (_discussion: DiscussionWithAuthor) => void
  onToggleLock: (_discussion: DiscussionWithAuthor) => void
  onEdit: (_discussion: DiscussionWithAuthor) => void
  onDelete: (_discussion: DiscussionWithAuthor) => void
}

// Side panel that reads a thread without leaving the list. Replies use the
// learner CommentSection as is, so an admin's reply posts exactly like a
// member's, and its own edit/delete controls apply to managers.
export default function DiscussionReader({
  discussion: listed,
  communityUuid,
  publicHref,
  allowRichContent,
  canModerate,
  replyCount,
  onOpenChange,
  onTogglePin,
  onToggleLock,
  onEdit,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const open = !!listed

  // The list row already has everything to paint the panel; the detail
  // fetch only refreshes it (e.g. after an edit elsewhere).
  const { data: fresh } = useQuery({
    queryKey: queryKeys.discussion.detail(listed?.discussion_uuid ?? ''),
    queryFn: () => getDiscussion(listed!.discussion_uuid, null, accessToken),
    enabled: open && !!accessToken,
    staleTime: 15_000,
  })
  const discussion =
    fresh && listed && fresh.discussion_uuid === listed.discussion_uuid
      ? { ...fresh, is_pinned: listed.is_pinned, is_locked: listed.is_locked }
      : listed

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          style={{ zIndex: DRAWER_Z - 1 }}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 end-0 w-full sm:w-[min(720px,92vw)] bg-[#f8f8f8] shadow-2xl flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right rtl:data-[state=closed]:slide-out-to-left duration-200"
          style={{ zIndex: DRAWER_Z }}
        >
          {discussion && (
            <>
              <header className="shrink-0 bg-white nice-shadow px-5 pt-4 pb-3 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                      <LabelChip label={discussion.label} />
                      {discussion.is_pinned && (
                        <Chip tone="amber" icon={<PushPin size={12} weight="fill" />}>{t('communities.dash.discussions.pinned')}</Chip>
                      )}
                      {discussion.is_locked && (
                        <Chip tone="neutral" icon={<LockSimple size={12} />}>{t('communities.dash.discussions.locked')}</Chip>
                      )}
                    </div>
                    <DialogPrimitive.Title className="text-lg font-semibold text-neutral-900 leading-snug break-words" dir="auto">
                      {discussion.emoji && <span className="me-1.5">{discussion.emoji}</span>}
                      {discussion.title}
                    </DialogPrimitive.Title>
                  </div>
                  <DialogPrimitive.Close
                    className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                    aria-label={t('common.close')}
                  >
                    <X size={16} weight="bold" />
                  </DialogPrimitive.Close>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 text-xs text-neutral-500">
                    <AuthorAvatar author={discussion.author} size={24} />
                    <span className="font-semibold text-neutral-800 truncate">{authorName(discussion.author, t('common.unknown'))}</span>
                    <span>·</span>
                    <span className="shrink-0">{formatRelative(discussion.creation_date, i18n.language)}</span>
                    <span className="hidden sm:inline-flex items-center gap-1 shrink-0">
                      · <CaretUp size={12} weight="bold" /> {discussion.upvote_count}
                    </span>
                    {replyCount !== undefined && (
                      <span className="hidden sm:inline-flex items-center gap-1 shrink-0">
                        · <ChatCircleDots size={12} /> {replyCount}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {canModerate && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={discussion.is_pinned ? <PushPinSlash size={13} /> : <PushPin size={13} />}
                          onClick={() => onTogglePin(discussion)}
                        >
                          {discussion.is_pinned ? t('communities.discussion_card.unpin_discussion') : t('communities.discussion_card.pin_discussion')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={discussion.is_locked ? <LockSimpleOpen size={13} /> : <LockSimple size={13} />}
                          onClick={() => onToggleLock(discussion)}
                        >
                          {discussion.is_locked ? t('communities.discussion_card.unlock_discussion') : t('communities.discussion_card.lock_discussion')}
                        </Button>
                        <Button size="sm" variant="ghost" icon={<PencilSimple size={13} />} onClick={() => onEdit(discussion)}>
                          {t('communities.dash.discussions.edit')}
                        </Button>
                        <Button size="sm" variant="danger-ghost" icon={<Trash size={13} />} onClick={() => onDelete(discussion)}>
                          {t('communities.discussion_card.delete_discussion')}
                        </Button>
                      </>
                    )}
                    {publicHref && (
                      <a href={publicHref} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
                        <ArrowSquareOut size={13} />
                        {t('communities.dash.discussions.open_public')}
                      </a>
                    )}
                  </div>
                </div>
              </header>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
                <section className="bg-white rounded-2xl nice-shadow px-5 py-4">
                  {discussion.content ? (
                    <div className="prose prose-sm prose-neutral max-w-none">
                      <DiscussionContent content={parseContent(discussion.content)} allowRichContent={allowRichContent} />
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-400 italic">{t('communities.discussion_detail.no_details')}</p>
                  )}
                </section>
                <section className="bg-white rounded-2xl nice-shadow overflow-hidden">
                  <h3 className="px-5 pt-4 pb-1 text-sm font-semibold text-neutral-900">
                    {t('communities.dash.discussions.replies')}
                  </h3>
                  {/* Keyed so switching threads starts a fresh reply box. */}
                  <CommentSection
                    key={discussion.discussion_uuid}
                    discussionUuid={discussion.discussion_uuid}
                    communityUuid={communityUuid}
                    isLocked={discussion.is_locked}
                    discussionAuthorId={discussion.author_id}
                    answerCommentId={discussion.answer_comment_id}
                  />
                </section>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
