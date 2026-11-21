'use client'
/*
 The review queue: each suggestion with its diff, the author's note, and
 where it lands on the page now. Accept (as a new page version), edit then
 accept, ask for changes, or reject with a reason. When the page changed
 since the suggestion, it is rebased if its blocks are still there; if they
 were rewritten, the reviewer compares and resolves with "Edit, then accept"
 on the current text.
*/
import React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ArrowSquareOut, ArrowsLeftRight, Check, GitMerge, PencilSimpleLine, Rows, Warning, X, ArrowBendUpLeft } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, FieldLabel, Modal, Panel, SegmentedControl, Skeleton, TEXTAREA, formatRelative } from '@/design'
import { getUriWithOrg } from '@services/config/config'
import {
  acceptSuggestion,
  listCourseSuggestions,
  rejectSuggestion,
  requestSuggestionChanges,
  ContributionsApiError,
  type Suggestion,
} from '@services/courses/contributions'
import ContributionDiff, { type DiffLayout } from '@components/Objects/Contributions/ContributionDiff'
import SuggestEditModal from '@components/Objects/Contributions/SuggestEditModal'
import { ContributorAvatars, contributorName } from '@components/Objects/Contributions/contributorUi'
import { STATUS_TONE } from '@components/Objects/Contributions/MyContributions'
import { contributionKeys } from './EditCourseContributions'

type Filter = 'open' | 'accepted' | 'rejected' | 'all'

function DecisionModal({
  open,
  kind,
  onClose,
  onSubmit,
}: {
  open: boolean
  kind: 'reject' | 'changes'
  onClose: () => void
  onSubmit: (note: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const required = kind === 'changes'
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      icon={kind === 'reject' ? <X size={18} /> : <ArrowBendUpLeft size={18} />}
      dialogTitle={t(`dashboard.courses.contributions.review.${kind}_title`)}
      dialogDescription={t(`dashboard.courses.contributions.review.${kind}_description`)}
      preventClose={saving}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={kind === 'reject' ? 'danger' : 'primary'}
            loading={saving}
            disabled={required && !note.trim()}
            onClick={async () => {
              setSaving(true)
              try {
                await onSubmit(note.trim())
                onClose()
              } finally {
                setSaving(false)
              }
            }}
          >
            {t(`dashboard.courses.contributions.review.${kind}_confirm`)}
          </Button>
        </div>
      }
      dialogContent={
        <label className="block">
          <FieldLabel hint={required ? undefined : t('contributions.suggest.note_optional')}>
            {t(`dashboard.courses.contributions.review.${kind}_label`)}
          </FieldLabel>
          <textarea className={TEXTAREA} rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      }
    />
  )
}

function SuggestionCard({
  s,
  orgslug,
  token,
  focused,
  onChanged,
}: {
  s: Suggestion
  orgslug: string
  token: string
  focused: boolean
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const [layout, setLayout] = React.useState<DiffLayout>('inline')
  const [editing, setEditing] = React.useState(false)
  const [decision, setDecision] = React.useState<null | 'reject' | 'changes'>(null)
  const [accepting, setAccepting] = React.useState(false)
  const open = s.status === 'pending' || s.status === 'changes_requested'
  const placement = s.placement
  const conflict = placement?.state === 'conflict'
  const activity = React.useMemo(() => ({ activity_uuid: s.activity_uuid }), [s.activity_uuid])
  const pageHref = getUriWithOrg(
    orgslug,
    `/course/${s.course_uuid.replace(/^course_/, '')}/activity/${s.activity_uuid.replace(/^activity_/, '')}`
  )
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])

  const fail = (e: any) => {
    if (e instanceof ContributionsApiError && e.code === 'conflict') toast.error(t('dashboard.courses.contributions.review.conflict_toast'))
    else if (e instanceof ContributionsApiError && e.code === 'revised') toast.error(t('dashboard.courses.contributions.review.revised_toast'))
    else toast.error(e?.message || t('contributions.errors.generic'))
  }

  const accept = async () => {
    setAccepting(true)
    try {
      await acceptSuggestion(s.suggestion_uuid, { expected_updated_at: s.updated_at }, token)
      toast.success(t('dashboard.courses.contributions.review.accepted'))
      onChanged()
    } catch (e) {
      fail(e)
      onChanged()
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div
      ref={ref}
      id={s.suggestion_uuid}
      className={`space-y-4 rounded-2xl bg-white p-5 nice-shadow ${focused ? 'ring-2 ring-sky-400' : ''}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        {s.author && <ContributorAvatars users={[s.author]} size={32} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-neutral-900">{contributorName(s.author) || t('contributions.someone')}</span>
            <span className="text-xs text-neutral-400">{formatRelative(s.created_at, i18n.language)}</span>
            <Chip tone={STATUS_TONE[s.status]}>{t(`contributions.status.${s.status}`)}</Chip>
            {s.auto_published && <Chip tone="teal">{t('dashboard.courses.contributions.review.auto_published')}</Chip>}
            {open && placement && (
              <Chip
                tone={conflict ? 'rose' : placement.state === 'moved' ? 'sky' : 'emerald'}
                icon={conflict ? <Warning size={12} /> : <GitMerge size={12} />}
                title={t(`dashboard.courses.contributions.placement.${placement.state}_hint`)}
              >
                {t(`dashboard.courses.contributions.placement.${placement.state}`)}
              </Chip>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-sm text-neutral-600">
            <span className="truncate">{s.summary}</span>
            <span className="text-neutral-300">·</span>
            <Link href={pageHref} target="_blank" className="inline-flex items-center gap-1 truncate font-medium text-neutral-700 hover:underline">
              {s.activity_name}
              <ArrowSquareOut size={12} />
            </Link>
          </div>
        </div>
        <SegmentedControl<DiffLayout>
          value={layout}
          onChange={setLayout}
          ariaLabel={t('contributions.diff.title')}
          options={[
            { key: 'inline', label: <Rows size={13} aria-label={t('contributions.diff.inline')} /> },
            { key: 'split', label: <ArrowsLeftRight size={13} aria-label={t('contributions.diff.split')} /> },
          ]}
        />
      </div>

      {s.note && (
        <blockquote className="rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          <span className="font-semibold">{t('dashboard.courses.contributions.review.note')}</span> {s.note}
        </blockquote>
      )}

      {conflict ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-inset ring-rose-600/10">
            {t('dashboard.courses.contributions.placement.conflict_explain')}
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl p-3 ring-1 ring-inset ring-neutral-200">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('dashboard.courses.contributions.placement.page_now')}</p>
              <ContributionDiff before={s.before} after={placement?.current ?? []} activity={activity} layout="inline" />
            </div>
            <div className="rounded-xl p-3 ring-1 ring-inset ring-neutral-200">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('dashboard.courses.contributions.placement.suggested')}</p>
              <ContributionDiff before={s.before} after={s.after} activity={activity} layout="inline" />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-neutral-50/60 p-4 ring-1 ring-inset ring-neutral-200/70">
          <ContributionDiff before={s.before} after={s.after} activity={activity} layout={layout} />
        </div>
      )}

      {s.review_note && !open && (
        <p className="text-sm text-neutral-600">
          <span className="font-semibold">{t('contributions.mine.reviewer_said', { name: contributorName(s.reviewer) })}</span> {s.review_note}
        </p>
      )}
      {s.status === 'changes_requested' && s.review_note && (
        <p className="text-sm text-sky-800">
          <span className="font-semibold">{t('dashboard.courses.contributions.review.asked')}</span> {s.review_note}
        </p>
      )}

      {open && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" icon={<X size={13} />} onClick={() => setDecision('reject')}>
            {t('dashboard.courses.contributions.review.reject')}
          </Button>
          <Button size="sm" icon={<ArrowBendUpLeft size={13} />} onClick={() => setDecision('changes')}>
            {t('dashboard.courses.contributions.review.request_changes')}
          </Button>
          <Button size="sm" icon={<PencilSimpleLine size={13} />} onClick={() => setEditing(true)} variant={conflict ? 'primary' : 'secondary'}>
            {t('dashboard.courses.contributions.review.edit_accept')}
          </Button>
          {!conflict && (
            <Button size="sm" variant="primary" icon={<Check size={13} weight="bold" />} loading={accepting} onClick={accept}>
              {t('dashboard.courses.contributions.review.accept')}
            </Button>
          )}
        </div>
      )}

      {editing && (
        <SuggestEditModal
          open
          onClose={() => setEditing(false)}
          activity={activity}
          before={conflict ? placement?.current ?? [] : s.before}
          initial={s.after}
          initialNote=""
          title={t('dashboard.courses.contributions.review.edit_title')}
          submitLabel={t('dashboard.courses.contributions.review.accept')}
          hint={conflict ? t('dashboard.courses.contributions.review.edit_conflict_hint') : t('dashboard.courses.contributions.review.edit_hint')}
          onSubmit={async (after, note) => {
            try {
              await acceptSuggestion(
                s.suggestion_uuid,
                {
                  after,
                  note,
                  expected_updated_at: s.updated_at,
                  ...(conflict && placement && placement.start_index !== null
                    ? { target: { start_index: placement.start_index, length: placement.current.length, version: placement.current_version } }
                    : {}),
                },
                token
              )
              toast.success(t('dashboard.courses.contributions.review.accepted'))
            } finally {
              onChanged()
            }
          }}
        />
      )}
      {decision && (
      <DecisionModal
        key={decision}
        open
        kind={decision}
        onClose={() => setDecision(null)}
        onSubmit={async (note) => {
          try {
            if (decision === 'reject') await rejectSuggestion(s.suggestion_uuid, note, token)
            else await requestSuggestionChanges(s.suggestion_uuid, note, token)
            toast.success(t(`dashboard.courses.contributions.review.${decision === 'reject' ? 'rejected' : 'changes_sent'}`))
            onChanged()
          } catch (e) {
            fail(e)
            throw e
          }
        }}
      />
      )}
    </div>
  )
}

export default function ReviewSuggestions({ orgslug, courseUuid, token }: { orgslug: string; courseUuid: string; token: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const focus = searchParams?.get('suggestion')
  const [filter, setFilter] = React.useState<Filter>('open')
  const { data, isLoading } = useQuery({
    queryKey: contributionKeys.suggestions(courseUuid, filter),
    queryFn: () => listCourseSuggestions(courseUuid, filter === 'all' ? null : filter, token),
    enabled: !!token,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['contributions'] })
  const items = data?.items ?? []
  return (
    <div className="space-y-4">
      <SegmentedControl<Filter>
        value={filter}
        onChange={setFilter}
        ariaLabel={t('dashboard.courses.contributions.tabs.suggestions')}
        options={(['open', 'accepted', 'rejected', 'all'] as Filter[]).map((key) => ({
          key,
          label: t(`dashboard.courses.contributions.filters.${key}`),
        }))}
      />
      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<PencilSimpleLine size={22} />}
            title={t(`dashboard.courses.contributions.empty.suggestions_${filter === 'open' ? 'open' : 'other'}`)}
            description={filter === 'open' ? t('dashboard.courses.contributions.empty.suggestions_hint') : undefined}
          />
        </Panel>
      ) : (
        items.map((s) => (
          <SuggestionCard key={s.suggestion_uuid} s={s} orgslug={orgslug} token={token} focused={focus === s.suggestion_uuid} onChanged={refresh} />
        ))
      )}
    </div>
  )
}
