'use client'
/*
 "Your contributions" on this page: my suggestions (status, the reviewer's
 note, revise or withdraw) and my feedback threads (the team's replies, and
 a reply box). Opened from the page or a notification
 (?contribution=… / ?feedback=…).
*/
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ArrowBendUpLeft, HandHeart, PencilSimpleLine } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, Modal, SegmentedControl, TEXTAREA, formatRelative, type ChipTone } from '@/design'
import {
  listMyFeedback,
  listMySuggestions,
  replyToFeedback,
  reviseSuggestion,
  withdrawSuggestion,
  type Feedback,
  type Suggestion,
  type SuggestionStatus,
} from '@services/courses/contributions'
import ContributionDiff from './ContributionDiff'
import SuggestEditModal from './SuggestEditModal'
import { FEEDBACK_ICONS, FEEDBACK_TONES } from './FeedbackModal'
import { contributorName } from './contributorUi'

export const STATUS_TONE: Record<SuggestionStatus, ChipTone> = {
  pending: 'amber',
  accepted: 'emerald',
  rejected: 'rose',
  changes_requested: 'sky',
  withdrawn: 'neutral',
}

function FeedbackThread({ item, token, onChanged, locale }: { item: Feedback; token: string; onChanged: () => void; locale: string }) {
  const { t } = useTranslation()
  const [reply, setReply] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const Icon = FEEDBACK_ICONS[item.feedback_type] ?? FEEDBACK_ICONS.suggestion
  const send = async () => {
    if (!reply.trim()) return
    setSending(true)
    try {
      await replyToFeedback(item.thread_uuid, reply.trim(), token)
      setReply('')
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || t('contributions.errors.generic'))
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-neutral-200" id={item.thread_uuid}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${FEEDBACK_TONES[item.feedback_type]}`}>
          <Icon size={13} />
          {t(`contributions.feedback.types.${item.feedback_type}`)}
        </span>
        <Chip tone={item.status === 'resolved' ? 'emerald' : 'neutral'}>{t(`contributions.feedback.status.${item.status}`)}</Chip>
        <span className="text-xs text-neutral-400">{formatRelative(item.created_at, locale)}</span>
      </div>
      {item.quote && <blockquote className="line-clamp-2 border-s-2 border-neutral-200 ps-3 text-xs italic text-neutral-500">{item.quote}</blockquote>}
      <ul className="space-y-2">
        {item.comments.map((c) => (
          <li key={c.comment_uuid} className={`rounded-xl px-3 py-2 text-sm ${c.from_team ? 'bg-sky-50 text-sky-950' : 'bg-neutral-50 text-neutral-800'}`}>
            <div className="mb-0.5 text-xs font-semibold text-neutral-500">
              {c.from_team ? t('contributions.feedback.team', { name: contributorName(c.author) }) : t('contributions.feedback.you')}
            </div>
            <p className="whitespace-pre-wrap break-words">{c.body}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <textarea
          className={TEXTAREA}
          rows={1}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t('contributions.feedback.reply_placeholder')}
          aria-label={t('contributions.feedback.reply_placeholder')}
        />
        <Button size="sm" icon={<ArrowBendUpLeft size={13} />} onClick={send} loading={sending} disabled={!reply.trim()}>
          {t('contributions.feedback.reply')}
        </Button>
      </div>
    </div>
  )
}

export default function MyContributions({
  open,
  onClose,
  activity,
  courseUuid,
  orgUuid,
  token,
  focus,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  activity: any
  courseUuid?: string
  orgUuid?: string
  token: string
  focus?: string | null
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const activityUuid: string = activity.activity_uuid
  const [tab, setTab] = React.useState<'suggestions' | 'feedback'>(focus?.startsWith('thread_') ? 'feedback' : 'suggestions')
  const [revising, setRevising] = React.useState<Suggestion | null>(null)
  const sKey = ['contributions', 'mine', 'suggestions', activityUuid]
  const fKey = ['contributions', 'mine', 'feedback', activityUuid]
  const { data: suggestions } = useQuery({ queryKey: sKey, queryFn: () => listMySuggestions(activityUuid, token), enabled: open })
  const { data: feedback } = useQuery({ queryKey: fKey, queryFn: () => listMyFeedback(activityUuid, token), enabled: open })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: sKey })
    queryClient.invalidateQueries({ queryKey: fKey })
    onChanged()
  }

  React.useEffect(() => {
    if (!focus) return
    const el = document.getElementById(focus)
    el?.scrollIntoView({ block: 'center' })
  }, [focus, suggestions, feedback, tab])

  const withdraw = async (s: Suggestion) => {
    try {
      await withdrawSuggestion(s.suggestion_uuid, token)
      toast.success(t('contributions.toasts.withdrawn'))
      refresh()
    } catch (e: any) {
      toast.error(e?.message || t('contributions.errors.generic'))
    }
  }

  const items = suggestions?.items ?? []
  const threads = feedback?.items ?? []

  return (
    <>
      <Modal
        isDialogOpen={open && !revising}
        onOpenChange={(o) => !o && onClose()}
        size="lg"
        icon={<HandHeart size={18} />}
        dialogTitle={t('contributions.mine.title')}
        dialogDescription={t('contributions.mine.description')}
        dialogContent={
          <div className="space-y-4">
            <SegmentedControl
              value={tab}
              onChange={setTab}
              ariaLabel={t('contributions.mine.title')}
              options={[
                { key: 'suggestions', label: t('contributions.mine.suggestions'), count: items.length },
                { key: 'feedback', label: t('contributions.mine.feedback'), count: threads.length },
              ]}
            />
            {tab === 'suggestions' ? (
              items.length === 0 ? (
                <EmptyState icon={<PencilSimpleLine size={22} />} title={t('contributions.mine.no_suggestions')} />
              ) : (
                <div className="space-y-3">
                  {items.map((s) => (
                    <div key={s.suggestion_uuid} id={s.suggestion_uuid} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-neutral-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={STATUS_TONE[s.status]}>{t(`contributions.status.${s.status}`)}</Chip>
                        <span className="min-w-0 truncate text-sm font-medium text-neutral-800">{s.summary}</span>
                        <span className="ms-auto text-xs text-neutral-400">{formatRelative(s.updated_at, i18n.language)}</span>
                      </div>
                      {s.review_note && (
                        <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950">
                          <span className="font-semibold">{t('contributions.mine.reviewer_said', { name: contributorName(s.reviewer) })}</span> {s.review_note}
                        </p>
                      )}
                      <div className="rounded-xl bg-neutral-50/70 p-3 ring-1 ring-inset ring-neutral-200/70">
                        <ContributionDiff before={s.before} after={s.after} activity={activity} />
                      </div>
                      {(s.status === 'pending' || s.status === 'changes_requested') && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" onClick={() => withdraw(s)}>
                            {t('contributions.mine.withdraw')}
                          </Button>
                          <Button size="sm" variant="primary" icon={<PencilSimpleLine size={13} />} onClick={() => setRevising(s)}>
                            {t('contributions.mine.revise')}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : threads.length === 0 ? (
              <EmptyState icon={<HandHeart size={22} />} title={t('contributions.mine.no_feedback')} />
            ) : (
              <div className="space-y-3">
                {threads.map((f) => (
                  <FeedbackThread key={f.thread_uuid} item={f} token={token} onChanged={refresh} locale={i18n.language} />
                ))}
              </div>
            )}
          </div>
        }
      />
      {revising && (
        <SuggestEditModal
          open
          onClose={() => setRevising(null)}
          activity={activity}
          courseUuid={courseUuid}
          orgUuid={orgUuid}
          before={revising.before}
          initial={revising.after}
          initialNote={revising.note}
          title={t('contributions.mine.revise_title')}
          submitLabel={t('contributions.suggest.send')}
          onSubmit={async (after, note) => {
            await reviseSuggestion(revising.suggestion_uuid, { after, note }, token)
            toast.success(t('contributions.toasts.suggested'))
            refresh()
          }}
        />
      )}
    </>
  )
}
