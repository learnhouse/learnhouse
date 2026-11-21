'use client'
// Feedback left on the course's pages: answer in the thread, resolve.
import React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ArrowBendUpLeft, ArrowSquareOut, ChatCircleText, CheckCircle, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Button, EmptyState, Panel, SegmentedControl, Skeleton, TEXTAREA, formatRelative } from '@/design'
import { getUriWithOrg } from '@services/config/config'
import { listCourseFeedback, replyToFeedback, setFeedbackStatus, type Feedback } from '@services/courses/contributions'
import { FEEDBACK_ICONS, FEEDBACK_TONES } from '@components/Objects/Contributions/FeedbackModal'
import { ContributorAvatars, contributorName } from '@components/Objects/Contributions/contributorUi'
import { contributionKeys } from './EditCourseContributions'

type Filter = 'open' | 'resolved'

function FeedbackCard({ f, orgslug, token, focused, onChanged }: { f: Feedback; orgslug: string; token: string; focused: boolean; onChanged: () => void }) {
  const { t, i18n } = useTranslation()
  const [reply, setReply] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const Icon = FEEDBACK_ICONS[f.feedback_type] ?? FEEDBACK_ICONS.suggestion
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])
  const pageHref = getUriWithOrg(
    orgslug,
    `/course/${f.course_uuid.replace(/^course_/, '')}/activity/${f.activity_uuid.replace(/^activity_/, '')}`
  )
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await fn()
      if (done) toast.success(done)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || t('contributions.errors.generic'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div ref={ref} id={f.thread_uuid} className={`space-y-3 rounded-2xl bg-white p-5 nice-shadow ${focused ? 'ring-2 ring-sky-400' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {f.author && <ContributorAvatars users={[f.author]} size={28} />}
        <span className="text-sm font-semibold text-neutral-900">{contributorName(f.author) || t('contributions.someone')}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${FEEDBACK_TONES[f.feedback_type]}`}>
          <Icon size={13} />
          {t(`contributions.feedback.types.${f.feedback_type}`)}
        </span>
        <span className="text-xs text-neutral-400">{formatRelative(f.created_at, i18n.language)}</span>
        <Link href={pageHref} target="_blank" className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:underline">
          {f.activity_name}
          <ArrowSquareOut size={12} />
        </Link>
      </div>
      {f.quote && <blockquote className="border-s-2 border-neutral-300 ps-3 text-sm italic text-neutral-600">{f.quote}</blockquote>}
      <ul className="space-y-2">
        {f.comments.map((c) => (
          <li key={c.comment_uuid} className={`rounded-xl px-3 py-2 text-sm ${c.from_team ? 'bg-sky-50 text-sky-950' : 'bg-neutral-50 text-neutral-800'}`}>
            <div className="mb-0.5 text-xs font-semibold text-neutral-500">{contributorName(c.author)}</div>
            <p className="whitespace-pre-wrap break-words">{c.body}</p>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <textarea
          className={TEXTAREA}
          rows={2}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t('dashboard.courses.contributions.feedback.reply_placeholder')}
          aria-label={t('dashboard.courses.contributions.feedback.reply_placeholder')}
        />
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            icon={<ArrowBendUpLeft size={13} />}
            disabled={!reply.trim() || busy}
            onClick={() => run(async () => { await replyToFeedback(f.thread_uuid, reply.trim(), token); setReply('') }, t('dashboard.courses.contributions.feedback.replied'))}
          >
            {t('contributions.feedback.reply')}
          </Button>
          {f.status === 'open' ? (
            <Button size="sm" variant="primary" icon={<CheckCircle size={13} />} disabled={busy} onClick={() => run(() => setFeedbackStatus(f.thread_uuid, 'resolved', token))}>
              {t('dashboard.courses.contributions.feedback.resolve')}
            </Button>
          ) : (
            <Button size="sm" icon={<ArrowCounterClockwise size={13} />} disabled={busy} onClick={() => run(() => setFeedbackStatus(f.thread_uuid, 'open', token))}>
              {t('dashboard.courses.contributions.feedback.reopen')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ReviewFeedback({ orgslug, courseUuid, token }: { orgslug: string; courseUuid: string; token: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const focus = useSearchParams()?.get('feedback')
  const [filter, setFilter] = React.useState<Filter>('open')
  const { data, isLoading } = useQuery({
    queryKey: contributionKeys.feedback(courseUuid, filter),
    queryFn: () => listCourseFeedback(courseUuid, filter, token),
    enabled: !!token,
  })
  const items = data?.items ?? []
  return (
    <div className="space-y-4">
      <SegmentedControl<Filter>
        value={filter}
        onChange={setFilter}
        ariaLabel={t('dashboard.courses.contributions.tabs.feedback')}
        options={[
          { key: 'open', label: t('dashboard.courses.contributions.filters.open') },
          { key: 'resolved', label: t('dashboard.courses.contributions.filters.resolved') },
        ]}
      />
      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState icon={<ChatCircleText size={22} />} title={t(`dashboard.courses.contributions.empty.feedback_${filter}`)} />
        </Panel>
      ) : (
        items.map((f) => (
          <FeedbackCard
            key={f.thread_uuid}
            f={f}
            orgslug={orgslug}
            token={token}
            focused={focus === f.thread_uuid}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['contributions'] })}
          />
        ))
      )}
    </div>
  )
}
