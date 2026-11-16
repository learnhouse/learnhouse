'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  ClockCountdown,
  EnvelopeSimple,
  EnvelopeSimpleOpen,
  PaperPlaneTilt,
  Trash,
  UserPlus,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { inviteBatchUsers, removeInvitedUser } from '@services/organizations/invites'
import { apiFetch, asArray } from '@services/utils/ts/requests'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { queryKeys } from '@/lib/query/keys'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { ListPager, RowSkeleton } from '../usersUi'

// Everything about email invitations: the list of people invited, the form
// that sends new ones, and the modal the Users tab opens. The Invite tab and
// the Users tab's "Invited" view share these so both stay in sync.

export const invitedUsersKey = (orgId: number) => ['org', orgId, 'invitedUsers'] as const

export type InvitedUser = { email: string; pending?: boolean; email_sent?: boolean }

type InviteResult = { email: string; status: 'sent' | 'email_failed' | 'already_invited' }
type InviteSummary = { total: number; sent: number; failed: number; already_invited: number }

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

// Splits pasted text on commas, semicolons, spaces and new lines, the way
// people actually paste lists of addresses.
export function parseEmails(raw: string) {
  const parts = raw
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const valid = Array.from(new Set(parts.filter((p) => EMAIL_RE.test(p)).map((p) => p.toLowerCase())))
  const invalid = parts.filter((p) => !EMAIL_RE.test(p))
  return { valid, invalid }
}

export function useInvitedUsers() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  return useQuery({
    queryKey: invitedUsersKey(org?.id),
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org?.id}/invites/users`, access_token),
    select: (res: any) => asArray<InvitedUser>(res),
    enabled: !!org?.id && !!access_token,
    staleTime: 60_000,
  })
}

// Send state shared by the inline form and the modal.
function useInviteSender() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { handlePlanLimit } = useUpgradeModal()
  const { track } = useLHAnalytics('dashboard')

  const [text, setText] = React.useState('')
  const [code, setCode] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [results, setResults] = React.useState<InviteResult[] | null>(null)
  const [summary, setSummary] = React.useState<InviteSummary | null>(null)

  const { data: codes } = useQuery({
    queryKey: queryKeys.org.inviteCodes(org?.id),
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org?.id}/invites`, access_token),
    select: (res: any) => asArray<any>(res),
    enabled: !!org?.id && !!access_token,
    staleTime: 60_000,
  })

  const parsed = React.useMemo(() => parseEmails(text), [text])

  const reset = () => {
    setText('')
    setResults(null)
    setSummary(null)
  }

  const send = async () => {
    if (!parsed.valid.length) return
    setSending(true)
    setResults(null)
    setSummary(null)
    const toastId = toast.loading(t('dashboard.users.invite_members.toasts.sending'))
    try {
      // The API takes the same comma list the old textarea sent.
      const res = await inviteBatchUsers(org.id, parsed.valid.join(','), code || undefined, access_token)
      if (res.status == 200) {
        const data = res.data
        setResults(data.results || [])
        setSummary(data.summary || null)
        track(AnalyticsEvent.MembersBatchInvited, {
          total: data.summary?.total ?? 0,
          sent: data.summary?.sent ?? 0,
          failed: data.summary?.failed ?? 0,
        })
        queryClient.invalidateQueries({ queryKey: invitedUsersKey(org?.id) })
        setText('')
        if (data.summary?.failed > 0) {
          toast.error(
            t('dashboard.users.invite_members.toasts.partial', { sent: data.summary.sent, failed: data.summary.failed }),
            { id: toastId }
          )
        } else {
          toast.success(t('dashboard.users.invite_members.toasts.success'), { id: toastId })
        }
      } else {
        // A free org at its member limit gets the shared upgrade paywall.
        toast.dismiss(toastId)
        if (!handlePlanLimit(res, { source: 'member_invite', feature: 'members', requiredPlan: 'standard' })) {
          toast.error(getErrorMessage(res.data?.detail, t('dashboard.users.invite_members.toasts.error')))
        }
      }
    } catch (err) {
      toast.error(getErrorMessage((err as any)?.data?.detail, t('dashboard.users.invite_members.send_failed')), {
        id: toastId,
      })
    } finally {
      setSending(false)
    }
  }

  return { text, setText, code, setCode, codes: codes ?? [], parsed, sending, send, results, summary, reset }
}

type Sender = ReturnType<typeof useInviteSender>

function InviteFields({ sender, autoFocus }: { sender: Sender; autoFocus?: boolean }) {
  const { t } = useTranslation()
  const { text, setText, code, setCode, codes, parsed } = sender
  return (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel
          hint={
            parsed.valid.length > 0
              ? t('dashboard.users.dash.invites.valid_count', { count: parsed.valid.length })
              : t('dashboard.users.dash.invites.emails_hint')
          }
          error={
            parsed.invalid.length > 0
              ? t('dashboard.users.dash.invites.invalid_count', { count: parsed.invalid.length })
              : undefined
          }
        >
          {t('dashboard.users.dash.invites.emails_label')}
        </FieldLabel>
        <textarea
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sender.send()
          }}
          rows={5}
          aria-label={t('dashboard.users.dash.invites.emails_label')}
          placeholder={t('dashboard.users.dash.invites.emails_placeholder')}
          className={TEXTAREA}
        />
        {parsed.invalid.length > 0 && (
          <p className="mt-1.5 text-xs text-rose-600 truncate">
            {t('dashboard.users.dash.invites.invalid_list', { list: parsed.invalid.slice(0, 5).join(', ') })}
          </p>
        )}
      </div>
      <div>
        <FieldLabel hint={t('dashboard.users.dash.invites.code_hint')}>
          {t('dashboard.users.invite_members.invite_code_label')}
        </FieldLabel>
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label={t('dashboard.users.invite_members.invite_code_label')}
          className="w-full h-9 px-3 text-sm bg-white rounded-lg ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
        >
          <option value="">{t('dashboard.users.invite_members.no_invite_code') || 'None'}</option>
          {codes.map((invite: any) => (
            <option key={invite.invite_code_uuid} value={invite.invite_code_uuid}>
              {invite.invite_code}
              {invite.usergroup?.name ? ` · ${invite.usergroup.name}` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

const RESULT_TONE = {
  sent: { tone: 'emerald', icon: <CheckCircle size={12} weight="fill" /> },
  email_failed: { tone: 'rose', icon: <XCircle size={12} weight="fill" /> },
  already_invited: { tone: 'amber', icon: <Warning size={12} weight="fill" /> },
} as const

function InviteResults({ sender }: { sender: Sender }) {
  const { t } = useTranslation()
  const { results, summary } = sender
  if (!results?.length) return null
  return (
    <div className="flex flex-col gap-3">
      {summary && (
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.sent > 0 && (
            <Chip tone="emerald" icon={RESULT_TONE.sent.icon}>
              {t('dashboard.users.invite_members.results.sent_count', { count: summary.sent })}
            </Chip>
          )}
          {summary.failed > 0 && (
            <Chip tone="rose" icon={RESULT_TONE.email_failed.icon}>
              {t('dashboard.users.invite_members.results.failed_count', { count: summary.failed })}
            </Chip>
          )}
          {summary.already_invited > 0 && (
            <Chip tone="amber" icon={RESULT_TONE.already_invited.icon}>
              {t('dashboard.users.invite_members.results.skipped_count', { count: summary.already_invited })}
            </Chip>
          )}
        </div>
      )}
      <ul className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 max-h-64 overflow-y-auto">
        {results.map((r) => {
          const tone = RESULT_TONE[r.status] ?? RESULT_TONE.already_invited
          return (
            <li key={r.email} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
              <span className="truncate text-neutral-700">{r.email}</span>
              <Chip tone={tone.tone} icon={tone.icon}>
                {t(`dashboard.users.invite_members.results.status.${r.status}`)}
              </Chip>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Inline version for the Invite tab: the form, its send button and the
// results of the last send, all in one card body.
export function InviteForm() {
  const { t } = useTranslation()
  const sender = useInviteSender()
  return (
    <div className="flex flex-col gap-5">
      <InviteFields sender={sender} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-neutral-400">{t('dashboard.users.dash.invites.shortcut_hint')}</span>
        <Button
          variant="primary"
          icon={<PaperPlaneTilt size={14} />}
          loading={sender.sending}
          disabled={!sender.parsed.valid.length}
          onClick={sender.send}
        >
          {sender.parsed.valid.length > 0
            ? t('dashboard.users.dash.invites.send_count', { count: sender.parsed.valid.length })
            : t('dashboard.users.invite_members.send_button')}
        </Button>
      </div>
      <InviteResults sender={sender} />
    </div>
  )
}

// Modal version for the Users tab. After a send the modal shows what
// happened to each address and offers to invite more.
export function InviteMembersModal({ open, onOpenChange }: { open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const sender = useInviteSender()
  const done = !!sender.results?.length

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) sender.reset()
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={close}
      size="md"
      preventClose={sender.sending}
      icon={<UserPlus size={16} />}
      dialogTitle={done ? t('dashboard.users.dash.invites.sent_title') : t('dashboard.users.invite_members.title')}
      dialogDescription={done ? t('dashboard.users.dash.invites.sent_description') : t('dashboard.users.invite_members.subtitle')}
      dialogContent={done ? <InviteResults sender={sender} /> : <InviteFields sender={sender} autoFocus />}
      footer={
        done ? (
          <>
            <Button onClick={sender.reset}>{t('dashboard.users.dash.invites.invite_more')}</Button>
            <Button variant="primary" onClick={() => close(false)}>
              {t('dashboard.users.dash.done')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => close(false)} disabled={sender.sending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              icon={<PaperPlaneTilt size={14} />}
              loading={sender.sending}
              disabled={!sender.parsed.valid.length}
              onClick={sender.send}
            >
              {sender.parsed.valid.length > 0
                ? t('dashboard.users.dash.invites.send_count', { count: sender.parsed.valid.length })
                : t('dashboard.users.invite_members.send_button')}
            </Button>
          </>
        )
      }
    />
  )
}

const INVITE_PAGE = 10

// Pending and accepted invitations, filtered by `search`. Removing one
// drops it from the list at once and puts it back if the API refuses.
export function InvitationsList({
  search = '',
  onInvite,
}: {
  search?: string
  onInvite?: () => void
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { data: invited, isLoading } = useInvitedUsers()
  const [page, setPage] = React.useState(1)
  const [removing, setRemoving] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    const list = invited ?? []
    const q = search.trim().toLowerCase()
    return q ? list.filter((u) => u.email.toLowerCase().includes(q)) : list
  }, [invited, search])

  // Back to page one when the search changes (adjusted during render).
  const [lastSearch, setLastSearch] = React.useState(search)
  if (lastSearch !== search) {
    setLastSearch(search)
    setPage(1)
  }
  const shown = filtered.slice((page - 1) * INVITE_PAGE, page * INVITE_PAGE)

  const remove = async (email: string) => {
    const key = invitedUsersKey(org.id)
    const previous = queryClient.getQueryData(key)
    queryClient.setQueryData(key, (old: any) => {
      const list = asArray<InvitedUser>(old).filter((u) => u.email !== email)
      return Array.isArray(old) ? list : { ...(old || {}), data: list }
    })
    const res = await removeInvitedUser(org.id, email, access_token)
    if (res.status === 200) {
      toast.success(t('dashboard.users.invite_members.invited_users.remove_success'))
    } else {
      queryClient.setQueryData(key, previous)
      toast.error(t('dashboard.users.invite_members.invited_users.remove_error'))
    }
    queryClient.invalidateQueries({ queryKey: key })
  }

  if (isLoading && !invited) return <RowSkeleton rows={4} />

  if (!filtered.length) {
    return (
      <EmptyState
        icon={<EnvelopeSimple size={22} />}
        title={
          search
            ? t('dashboard.users.invite_members.invited_users.no_results')
            : t('dashboard.users.invite_members.invited_users.no_invites')
        }
        description={search ? undefined : t('dashboard.users.dash.invites.empty_description')}
        action={
          !search && onInvite ? (
            <Button variant="primary" icon={<UserPlus size={14} />} onClick={onInvite}>
              {t('dashboard.users.dash.members.invite')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <>
      <ul className="divide-y divide-neutral-100">
        {shown.map((u) => (
          <li key={u.email} className="group flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-neutral-50/70 transition-colors">
            <div className="w-9 h-9 rounded-full bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
              {u.pending ? <EnvelopeSimple size={16} /> : <EnvelopeSimpleOpen size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900 truncate">{u.email}</p>
              <p className="text-xs text-neutral-500">
                {u.email_sent
                  ? t('dashboard.users.invite_members.invited_users.email_status.sent')
                  : t('dashboard.users.invite_members.invited_users.email_status.no')}
              </p>
            </div>
            {u.pending ? (
              <Chip tone="amber" icon={<ClockCountdown size={12} />}>
                {t('dashboard.users.invite_members.invited_users.status.pending')}
              </Chip>
            ) : (
              <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>
                {t('dashboard.users.invite_members.invited_users.status.signed')}
              </Chip>
            )}
            <Button
              variant="danger-ghost"
              size="sm"
              icon={<Trash size={13} />}
              onClick={() => setRemoving(u.email)}
              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
            >
              <span className="hidden sm:inline">{t('dashboard.users.invite_members.invited_users.remove_button')}</span>
            </Button>
          </li>
        ))}
      </ul>
      <ListPager page={page} pageSize={INVITE_PAGE} total={filtered.length} onPage={setPage} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('dashboard.users.invite_members.invited_users.remove_title')}
        message={t('dashboard.users.invite_members.invited_users.remove_message', { email: removing })}
        confirmLabel={t('dashboard.users.invite_members.invited_users.remove_button')}
        onConfirm={() => removing && remove(removing)}
      />
    </>
  )
}
