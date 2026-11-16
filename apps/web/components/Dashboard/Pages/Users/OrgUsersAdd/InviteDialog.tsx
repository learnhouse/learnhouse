'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  ClockCountdown,
  EnvelopeSimple,
  Info,
  PaperPlaneTilt,
  UserCircleCheck,
  UserPlus,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { Button, Chip, FieldLabel, TEXTAREA, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import {
  createInvitations,
  parseEmailList,
  previewInvitations,
  type InvitationPreview,
  type InviteOutcome,
  type InviteResultStatus,
} from '@services/organizations/invitations'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import {
  CapacityMeter,
  CourseIcon,
  EXPIRY_CHOICES,
  GroupIcon,
  MultiPicker,
  RolePickerGrid,
  formatDate,
  invitationKeys,
  useCourseItems,
  useGroupItems,
  useInvitationAuth,
  useInvitationOptions,
  useRoleText,
} from './invitationsKit'

const MESSAGE_MAX = 1000

const RESULT_LOOK: Record<InviteResultStatus, { tone: 'emerald' | 'rose' | 'amber' | 'sky' | 'neutral'; icon: React.ReactNode }> = {
  sent: { tone: 'emerald', icon: <CheckCircle size={12} weight="fill" /> },
  resent: { tone: 'sky', icon: <PaperPlaneTilt size={12} weight="fill" /> },
  email_failed: { tone: 'rose', icon: <XCircle size={12} weight="fill" /> },
  already_member: { tone: 'neutral', icon: <UserCircleCheck size={12} weight="fill" /> },
  member_updated: { tone: 'emerald', icon: <UserCircleCheck size={12} weight="fill" /> },
  member_update_failed: { tone: 'amber', icon: <Warning size={12} weight="fill" /> },
  invalid_email: { tone: 'rose', icon: <Warning size={12} weight="fill" /> },
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** The one place admins invite people: emails, a role, groups, courses, a
 * note and an expiry, with a live summary and plan limits before sending. */
export default function InviteDialog({
  open,
  onOpenChange,
  initialEmails = '',
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  initialEmails?: string
}) {
  const { t, i18n } = useTranslation()
  const { orgId, token } = useInvitationAuth()
  const queryClient = useQueryClient()
  const { handlePlanLimit } = useUpgradeModal()
  const { track } = useLHAnalytics('dashboard')
  const roleText = useRoleText()
  const { data: options, isLoading: optionsLoading, error: optionsError } = useInvitationOptions(open)
  const groupItems = useGroupItems(open)
  const courseItems = useCourseItems(open)

  const [text, setText] = React.useState(initialEmails)
  const [roleId, setRoleId] = React.useState(4)
  const [groups, setGroups] = React.useState<string[]>([])
  const [courses, setCourses] = React.useState<string[]>([])
  const [message, setMessage] = React.useState('')
  const [expiry, setExpiry] = React.useState(14)
  const [updateExisting, setUpdateExisting] = React.useState(false)
  const [preview, setPreview] = React.useState<InvitationPreview | null>(null)
  const [sending, setSending] = React.useState(false)
  const [outcome, setOutcome] = React.useState<InviteOutcome | null>(null)

  React.useEffect(() => {
    if (open) setText(initialEmails)
  }, [open, initialEmails])
  React.useEffect(() => {
    if (options?.default_role_id) setRoleId((current) => (current === 4 ? options.default_role_id : current))
  }, [options?.default_role_id])

  const parsed = React.useMemo(() => parseEmailList(text), [text])
  const role = options?.roles.find((r) => r.id === roleId)
  const roleName = role ? roleText(role).name : ''
  const tooMany = options ? parsed.valid.length > options.max_batch_size : false

  // Live preview: who is new, already invited or a member, and plan room.
  const previewKey = useDebounced(JSON.stringify([parsed.valid, roleId, updateExisting]), 350)
  React.useEffect(() => {
    if (!open || !orgId || !token) return
    const [emails, rid, upd] = JSON.parse(previewKey) as [string[], number, boolean]
    if (!emails.length) {
      setPreview(null)
      return
    }
    let cancelled = false
    previewInvitations(orgId, { emails, role_id: rid, update_existing_members: upd }, token).then((res) => {
      if (!cancelled && res.success) setPreview(res.data as InvitationPreview)
    })
    return () => {
      cancelled = true
    }
  }, [previewKey, open, orgId, token])

  const reset = () => {
    setText('')
    setGroups([])
    setCourses([])
    setMessage('')
    setExpiry(options?.expiry.default_days ?? 14)
    setUpdateExisting(false)
    setPreview(null)
    setOutcome(null)
    setRoleId(options?.default_role_id ?? 4)
  }

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) setTimeout(reset, 200)
  }

  const memberCount = preview?.counts.member ?? 0
  const newCount = preview ? preview.counts.new + preview.counts.pending : parsed.valid.length
  const blocked = preview?.blocked ?? null
  const sendable = parsed.valid.length > 0 && !tooMany && !blocked && (newCount > 0 || (updateExisting && memberCount > 0))

  const send = async () => {
    if (!sendable) return
    setSending(true)
    try {
      const res = await createInvitations(
        orgId,
        {
          emails: parsed.valid,
          role_id: roleId,
          usergroup_ids: groups.map(Number),
          course_uuids: courses,
          message: message.trim() || null,
          expires_in_days: expiry,
          update_existing_members: updateExisting,
        },
        token
      )
      if (res.success) {
        const data = res.data as InviteOutcome
        setOutcome(data)
        track(AnalyticsEvent.MembersBatchInvited, {
          total: data.summary.total ?? 0,
          sent: (data.summary.sent ?? 0) + (data.summary.resent ?? 0),
          failed: data.summary.email_failed ?? 0,
        })
        queryClient.invalidateQueries({ queryKey: invitationKeys.all(orgId) })
        queryClient.invalidateQueries({ queryKey: ['org', orgId, 'invitedUsers'] })
        if (data.summary.member_updated) queryClient.invalidateQueries({ queryKey: ['org', orgId, 'users'] })
        if (data.summary.email_failed) toast.error(t('dashboard.users.invitations.toasts.some_failed', { count: data.summary.email_failed }))
        else toast.success(t('dashboard.users.invitations.toasts.sent'))
      } else if (!handlePlanLimit(res, { source: 'member_invite', feature: 'members', requiredPlan: 'standard' })) {
        toast.error(getErrorMessage(res.data?.detail, t('dashboard.users.invitations.toasts.error')))
      }
    } finally {
      setSending(false)
    }
  }

  const done = !!outcome
  const groupNames = groups.map((id) => groupItems.find((g) => g.id === id)?.label).filter(Boolean) as string[]
  const expiresOn = new Date(Date.now() + expiry * 86_400_000).toISOString()

  const summaryParts: string[] = []
  if (groupNames.length) summaryParts.push(t('dashboard.users.invitations.summary.groups', { count: groupNames.length, names: groupNames.join(', ') }))
  if (courses.length) summaryParts.push(t('dashboard.users.invitations.summary.courses', { count: courses.length }))

  const body = done ? (
    <InviteOutcomeView outcome={outcome!} />
  ) : optionsError ? (
    <div className="flex items-start gap-2 rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-3.5 py-3 text-sm text-rose-800">
      <Warning size={16} className="shrink-0 mt-0.5" />
      {getErrorMessage((optionsError as any)?.detail, t('dashboard.users.invitations.toasts.error'))}
    </div>
  ) : (
    <div className="flex flex-col gap-6">
      {/* People */}
      <section>
        <FieldLabel
          hint={parsed.valid.length ? t('dashboard.users.invitations.fields.valid_count', { count: parsed.valid.length }) : t('dashboard.users.invitations.fields.emails_hint')}
          error={
            tooMany
              ? t('dashboard.users.invitations.fields.too_many', { max: options?.max_batch_size })
              : parsed.invalid.length
                ? t('dashboard.users.invitations.fields.invalid_count', { count: parsed.invalid.length })
                : undefined
          }
        >
          {t('dashboard.users.invitations.fields.emails')}
        </FieldLabel>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send()
          }}
          rows={4}
          aria-label={t('dashboard.users.invitations.fields.emails')}
          placeholder={t('dashboard.users.invitations.fields.emails_placeholder')}
          className={TEXTAREA}
        />
        {parsed.invalid.length > 0 && (
          <p className="mt-1.5 text-xs text-rose-600 truncate" dir="ltr">
            {parsed.invalid.slice(0, 5).join(', ')}
          </p>
        )}
        {preview && (preview.counts.pending > 0 || memberCount > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {preview.counts.new > 0 && (
              <Chip tone="emerald" icon={<EnvelopeSimple size={12} />}>
                {t('dashboard.users.invitations.preview.new', { count: preview.counts.new })}
              </Chip>
            )}
            {preview.counts.pending > 0 && (
              <Chip tone="sky" icon={<ClockCountdown size={12} />}>
                {t('dashboard.users.invitations.preview.pending', { count: preview.counts.pending })}
              </Chip>
            )}
            {memberCount > 0 && (
              <Chip tone="neutral" icon={<UserCircleCheck size={12} />}>
                {t('dashboard.users.invitations.preview.members', { count: memberCount })}
              </Chip>
            )}
          </div>
        )}
        {memberCount > 0 && (
          <label className="mt-3 flex items-start gap-2.5 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 px-3.5 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(e) => setUpdateExisting(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-neutral-900"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-neutral-800">
                {t('dashboard.users.invitations.fields.update_existing', { count: memberCount })}
              </span>
              <span className="block text-xs text-neutral-500 mt-0.5">{t('dashboard.users.invitations.fields.update_existing_hint')}</span>
            </span>
          </label>
        )}
      </section>

      {/* Role */}
      <section>
        <FieldLabel hint={t('dashboard.users.invitations.fields.role_hint')}>{t('dashboard.users.invitations.fields.role')}</FieldLabel>
        {optionsLoading || !options ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 animate-pulse">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[74px] rounded-xl bg-neutral-100" />
            ))}
          </div>
        ) : (
          <RolePickerGrid roles={options.roles} value={roleId} onChange={setRoleId} />
        )}
      </section>

      {/* Access */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="min-w-0">
          <FieldLabel hint={t('common.optional')}>{t('dashboard.users.invitations.fields.groups')}</FieldLabel>
          <MultiPicker
            items={groupItems}
            value={groups}
            onChange={setGroups}
            icon={<GroupIcon />}
            label={t('dashboard.users.invitations.fields.groups')}
            placeholder={t('dashboard.users.invitations.fields.groups_placeholder')}
            emptyText={t('dashboard.users.invitations.fields.no_groups')}
          />
        </div>
        <div className="min-w-0">
          <FieldLabel hint={t('common.optional')}>{t('dashboard.users.invitations.fields.courses')}</FieldLabel>
          <MultiPicker
            items={courseItems}
            value={courses}
            onChange={setCourses}
            icon={<CourseIcon />}
            label={t('dashboard.users.invitations.fields.courses')}
            placeholder={t('dashboard.users.invitations.fields.courses_placeholder')}
            emptyText={t('dashboard.users.invitations.fields.no_courses')}
          />
        </div>
      </section>

      {/* Note + expiry */}
      <section className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4">
        <div className="min-w-0">
          <FieldLabel hint={`${message.length}/${MESSAGE_MAX}`}>{t('dashboard.users.invitations.fields.message')}</FieldLabel>
          <textarea
            value={message}
            maxLength={MESSAGE_MAX}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            aria-label={t('dashboard.users.invitations.fields.message')}
            placeholder={t('dashboard.users.invitations.fields.message_placeholder')}
            className={TEXTAREA}
          />
        </div>
        <div className="min-w-0">
          <FieldLabel>{t('dashboard.users.invitations.fields.expiry')}</FieldLabel>
          <select
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
            aria-label={t('dashboard.users.invitations.fields.expiry')}
            className={INPUT}
          >
            {EXPIRY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {t('dashboard.users.invitations.fields.days', { count: d })}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-neutral-400">{t('dashboard.users.invitations.fields.expires_on', { date: formatDate(expiresOn, i18n.language) })}</p>
        </div>
      </section>

      {/* Summary */}
      {parsed.valid.length > 0 && (
        <section className="rounded-2xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/80 p-4 flex flex-col gap-3" aria-live="polite">
          <div className="flex items-start gap-2.5">
            <Info size={16} className="shrink-0 mt-0.5 text-neutral-400" />
            <p className="text-sm text-neutral-700 leading-relaxed">
              <span className="font-semibold text-neutral-900">
                {t('dashboard.users.invitations.summary.people', { count: newCount, role: roleName })}
              </span>
              {summaryParts.length > 0 && <>{t('dashboard.users.invitations.summary.and')}{summaryParts.join(t('dashboard.users.invitations.summary.and'))}</>}
              {updateExisting && memberCount > 0 && <> {t('dashboard.users.invitations.summary.updated', { count: memberCount })}</>}
            </p>
          </div>
          {preview && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CapacityMeter
                label={t('dashboard.users.invitations.capacity.members')}
                used={preview.capacity.members.used}
                pending={preview.capacity.members.pending}
                limit={preview.capacity.members.limit}
                extra={preview.counts.new}
              />
              {preview.occupies_seat && (
                <CapacityMeter
                  label={t('dashboard.users.invitations.capacity.admin_seats')}
                  used={preview.capacity.admin_seats.used}
                  pending={preview.capacity.admin_seats.pending}
                  limit={preview.capacity.admin_seats.limit}
                  extra={preview.counts.new + (updateExisting ? memberCount : 0)}
                />
              )}
            </div>
          )}
          {blocked && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-3 py-2.5 text-xs text-rose-800">
              <Warning size={14} className="shrink-0 mt-0.5" />
              <span>
                {blocked.code === 'ADMIN_SEAT_LIMIT_REACHED'
                  ? t('dashboard.users.invitations.capacity.seats_blocked', { limit: blocked.limit })
                  : t('dashboard.users.invitations.capacity.members_blocked', { limit: blocked.limit })}
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={close}
      size="lg"
      preventClose={sending}
      icon={<UserPlus size={16} />}
      dialogTitle={done ? t('dashboard.users.invitations.dialog.done_title') : t('dashboard.users.invitations.dialog.title')}
      dialogDescription={done ? t('dashboard.users.invitations.dialog.done_description') : t('dashboard.users.invitations.dialog.description')}
      dialogContent={body}
      footer={
        done ? (
          <>
            <Button onClick={reset}>{t('dashboard.users.invitations.dialog.invite_more')}</Button>
            <Button variant="primary" onClick={() => close(false)}>
              {t('dashboard.users.dash.done')}
            </Button>
          </>
        ) : (
          <>
            <span className="hidden sm:inline text-xs text-neutral-400 me-auto">{t('dashboard.users.dash.invites.shortcut_hint')}</span>
            <Button onClick={() => close(false)} disabled={sending}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon={<PaperPlaneTilt size={14} />} loading={sending} disabled={!sendable} onClick={send}>
              {newCount > 0
                ? t('dashboard.users.invitations.dialog.send_count', { count: newCount })
                : updateExisting && memberCount > 0
                  ? t('dashboard.users.invitations.dialog.update_count', { count: memberCount })
                  : t('dashboard.users.invitations.dialog.send')}
            </Button>
          </>
        )
      }
    />
  )
}

export function InviteOutcomeView({ outcome }: { outcome: InviteOutcome }) {
  const { t } = useTranslation()
  const counts = (Object.keys(RESULT_LOOK) as InviteResultStatus[]).filter((k) => (outcome.summary[k] ?? 0) > 0)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {counts.map((k) => (
          <Chip key={k} tone={RESULT_LOOK[k].tone} icon={RESULT_LOOK[k].icon}>
            {t(`dashboard.users.invitations.results.count.${k}`, { count: outcome.summary[k] })}
          </Chip>
        ))}
      </div>
      <ul className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 max-h-72 overflow-y-auto">
        {outcome.results.map((r) => {
          const look = RESULT_LOOK[r.status] ?? RESULT_LOOK.invalid_email
          return (
            <li key={`${r.email}-${r.status}`} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-neutral-700" dir="ltr">
                  {r.email}
                </span>
                {r.reason && <span className="block truncate text-xs text-neutral-400">{r.reason}</span>}
              </span>
              <Chip tone={look.tone} icon={look.icon}>
                {t(`dashboard.users.invitations.results.status.${r.status}`)}
              </Chip>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
