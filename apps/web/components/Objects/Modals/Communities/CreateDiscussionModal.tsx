'use client'
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowSquareOut, ChatCenteredText, PencilSimpleLine, Warning } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { createDiscussion, getDiscussions } from '@services/communities/discussions'
import { useMutateDiscussions } from '@components/Hooks/useDiscussions'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, FieldLabel } from '@components/Dashboard/Shared/DashKit/DashKit'
import { BodyField, LabelChoice, TitleField, validateDiscussionTitle } from '@components/Objects/Communities/DiscussionForm'
import { readDraft, threadHref, writeDraft } from '@components/Objects/Communities/communityUi'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface CreateDiscussionModalProps {
  isOpen: boolean
  onClose: () => void
  communityUuid: string
  orgSlug: string
  allowRichContent?: boolean
}

type Draft = { title: string; content: any; label: string; emoji: string | null }
const EMPTY: Draft = { title: '', content: null, label: 'general', emoji: null }
const draftKey = (communityUuid: string) => `lh_community_draft_${communityUuid}`

const isEmptyDraft = (d: Draft) =>
  !d.title.trim() && !(d.content?.content?.length && JSON.stringify(d.content).includes('"text"')) && !d.emoji

// Words long enough to mean something, for the "similar discussions" hint.
const keywords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4)
  )

export function CreateDiscussionModal({
  isOpen,
  onClose,
  communityUuid,
  orgSlug,
  allowRichContent = false,
}: CreateDiscussionModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const { orgslug: ctxSlug } = useOrgMembership()
  const mutateDiscussions = useMutateDiscussions()
  const { track } = useLHAnalytics('learner')

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [restored, setRestored] = useState(false)
  const [touched, setTouched] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The editor reads its content once, so it is keyed to remount on restore/reset.
  const [editorKey, setEditorKey] = useState(0)

  // On each opening, pick up where the writer left off in this browser.
  const [wasOpen, setWasOpen] = useState(false)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      const saved = typeof window !== 'undefined' ? readDraft<Draft>(draftKey(communityUuid)) : null
      const next = saved ? { ...EMPTY, ...saved } : EMPTY
      setDraft(next)
      setRestored(!!saved && !isEmptyDraft(next))
      setTouched(false)
      setError(null)
      setEditorKey((k) => k + 1)
    }
  }

  // Keep the draft as it is typed (only while open, and never an empty one).
  useEffect(() => {
    if (!isOpen) return
    const id = window.setTimeout(() => writeDraft(draftKey(communityUuid), isEmptyDraft(draft) ? null : draft), 400)
    return () => window.clearTimeout(id)
  }, [draft, isOpen, communityUuid])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const titleError = validateDiscussionTitle(draft.title, t)

  // Recent threads of this community, to point at ones that may already answer.
  const { data: pool } = useQuery({
    queryKey: ['community', communityUuid, 'discussions', 'similar-pool'],
    queryFn: () => getDiscussions(communityUuid, 'recent', 1, 100, null, accessToken),
    enabled: isOpen && draft.title.trim().length >= 4,
    staleTime: 60_000,
  })
  const deferredTitle = React.useDeferredValue(draft.title)
  const similar = useMemo(() => {
    const words = keywords(deferredTitle)
    if (!words.size || !Array.isArray(pool)) return []
    return pool
      .map((d) => {
        const own = keywords(d.title)
        let score = 0
        words.forEach((w) => own.has(w) && score++)
        return { d, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.d)
  }, [deferredTitle, pool])

  const close = () => {
    if (!isSubmitting) onClose()
  }

  const discardDraft = () => {
    writeDraft(draftKey(communityUuid), null)
    setDraft(EMPTY)
    setRestored(false)
    setEditorKey((k) => k + 1)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (titleError) return

    setIsSubmitting(true)
    setError(null)
    try {
      const hasContent = !!draft.content?.content?.length
      const result = await createDiscussion(
        communityUuid,
        {
          title: draft.title.trim(),
          content: draft.content ? JSON.stringify(draft.content) : null,
          label: draft.label,
          emoji: draft.emoji,
        },
        accessToken
      )
      if (result) {
        track(AnalyticsEvent.DiscussionCreated, {
          label: draft.label,
          has_content: hasContent,
          title_length: draft.title.trim().length,
        })
        writeDraft(draftKey(communityUuid), null)
        mutateDiscussions(communityUuid)
        toast.success(t('communities.learner.compose.posted'))
        setDraft(EMPTY)
        onClose()
      }
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.create_discussion.failed_to_create')
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => !open && close()}
      icon={<PencilSimpleLine size={16} />}
      size="lg"
      preventClose={isSubmitting}
      closeOnOutsideClick={false}
      dialogTitle={t('communities.create_discussion.title')}
      dialogDescription={t('communities.create_discussion.description')}
      dialogContent={
        <form id="create-discussion-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
          {restored && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-sky-50 ring-1 ring-inset ring-sky-200/70 px-3.5 py-2.5 text-xs text-sky-800">
              <span>{t('communities.learner.compose.draft_restored')}</span>
              <button type="button" onClick={discardDraft} className="font-semibold hover:underline shrink-0">
                {t('communities.learner.compose.discard_draft')}
              </button>
            </div>
          )}

          <div>
            <FieldLabel>{t('communities.create_discussion.category_label')}</FieldLabel>
            <LabelChoice value={draft.label} onChange={(id) => set('label', id)} />
          </div>

          <TitleField
            title={draft.title}
            onTitleChange={(v) => set('title', v)}
            emoji={draft.emoji}
            onEmojiChange={(v) => set('emoji', v)}
            error={touched || draft.title.length > 0 ? titleError : null}
            autoFocus
            below={
              similar.length > 0 && (
                <div className="mt-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 p-3">
                  <p className="text-xs font-semibold text-neutral-700">{t('communities.learner.compose.similar')}</p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {similar.map((d) => (
                      <li key={d.discussion_uuid}>
                        <Link
                          href={threadHref(orgSlug || ctxSlug, communityUuid, d.discussion_uuid)}
                          target="_blank"
                          className="group flex items-center gap-2 text-sm text-neutral-700 hover:text-neutral-900"
                        >
                          <ChatCenteredText size={14} className="text-neutral-400 shrink-0" />
                          <span className="truncate group-hover:underline underline-offset-2" dir="auto">{d.title}</span>
                          <ArrowSquareOut size={12} className="text-neutral-300 shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            }
          />

          <BodyField
            key={editorKey}
            content={draft.content}
            onChange={(c) => set('content', c)}
            allowRichContent={allowRichContent}
          />

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-3.5 py-2.5 text-sm text-rose-700">
              <Warning size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>
      }
      footer={
        <>
          <span className="me-auto hidden sm:block text-xs text-neutral-400">{t('communities.learner.compose.draft_hint')}</span>
          <Button onClick={close} disabled={isSubmitting}>
            {t('communities.create_discussion.cancel')}
          </Button>
          <Button type="submit" form="create-discussion-form" variant="primary" loading={isSubmitting} disabled={!!titleError}>
            {t('communities.create_discussion.submit')}
          </Button>
        </>
      }
    />
  )
}

export default CreateDiscussionModal
