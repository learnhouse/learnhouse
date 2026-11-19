'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Copy, Check, FileCsv, LinkSimple, EnvelopeSimple, Info } from '@phosphor-icons/react'
import { Button, SegmentedControl, TEXTAREA, INPUT } from '@/design'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { createInviteCode } from '@services/organizations/invites'
import { createInvitations } from '@services/organizations/invitations'
import { useInvitationOptions, useRoleText } from '@components/Dashboard/Pages/Users/OrgUsersAdd/invitationsKit'
import { apiFetch } from '@services/utils/ts/requests'
import { useQuery } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { recordOnboardingEvent } from '@services/onboarding/onboarding'
import { extractEmails } from '@/lib/onboarding'
import { copyTextFrom } from '@/lib/text/clipboard'

export type InviteTab = 'link' | 'email' | 'csv'

// Matches what the API accepts per request (INVITE_MAX_BATCH_SIZE).
const BATCH = 25
type Totals = { sent: number; skipped: number; failed: number }

function absolute(url: string) {
  if (typeof window === 'undefined' || /^https?:\/\//.test(url)) return url
  return `${window.location.origin}${url}`
}

/**
 * Bring people in, three ways: the org's join link, email invitations, or a
 * CSV of learners (any export with an email column). New free orgs can't send
 * invitation emails for their first days (spam protection, enforced by the
 * API); the dialog says so and points to the join link, which works at once.
 */
export default function InviteDialog({
  open,
  onOpenChange,
  orgId,
  orgSlug,
  initialTab = 'link',
  gate,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  orgId: number
  orgSlug: string
  initialTab?: InviteTab
  gate?: { gated: boolean; unlocks_at: string | null }
}) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const { track } = useLHAnalytics('dashboard')
  const [tab, setTab] = useState<InviteTab>(initialTab)
  const [text, setText] = useState('')
  const [csvEmails, setCsvEmails] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [sending, setSending] = useState(false)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [copied, setCopied] = useState(false)

  React.useEffect(() => {
    if (open) {
      setTab(initialTab)
      setTotals(null)
    }
  }, [open, initialTab])

  // An invite-only school's bare /signup asks for a code, a dead end for a
  // shared link. There the link carries one of the org's join codes (made on
  // demand), so it opens the org's own signup form directly.
  const org = useOrg() as any
  const orgConfig = org?.config?.config
  const inviteOnly =
    (orgConfig?.config_version?.startsWith('2')
      ? orgConfig?.admin_toggles?.members?.signup_mode
      : orgConfig?.features?.members?.signup_mode) === 'inviteOnly'
  const codes = useQuery({
    queryKey: ['org-invite-codes', orgId],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/invites`, token),
    enabled: open && inviteOnly && !!token,
    staleTime: 60_000,
  })
  const joinCode: string | undefined = (Array.isArray(codes.data) ? codes.data : []).find((c: any) => !c?.usergroup_id)?.invite_code
  const [creatingCode, setCreatingCode] = useState(false)
  const createJoinCode = async () => {
    setCreatingCode(true)
    const res = await createInviteCode(orgId, token).catch(() => null)
    setCreatingCode(false)
    if (!res?.success) {
      const detail = res?.data?.detail
      toast.error(typeof detail === 'string' ? detail : detail?.message ?? t('common.something_went_wrong'))
      return
    }
    await codes.refetch()
  }
  const needsCode = inviteOnly && !joinCode
  const joinUrl = absolute(getUriWithOrg(orgSlug, joinCode ? `/signup?inviteCode=${encodeURIComponent(joinCode)}` : '/signup'))
  const typed = useMemo(() => extractEmails(text), [text])
  // The role people join with, picked from the roles this admin may grant.
  const [roleId, setRoleId] = useState(4)
  const { data: options } = useInvitationOptions(open && tab !== 'link')
  const roleText = useRoleText()
  const grantable = (options?.roles ?? []).filter((r) => r.grantable)
  const gated = !!gate?.gated
  const unlockDate = gate?.unlocks_at
    ? new Date(gate.unlocks_at).toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' })
    : null

  const copy = async () => {
    // "Copied" only when it was; otherwise the field stays selectable.
    if (!(await copyTextFrom(joinUrl))) {
      toast.error(t('dashboard.users.dash.signups.copy_failed'))
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
    track(AnalyticsEvent.OnboardingInviteLinkCopied, {})
    recordOnboardingEvent(token, orgId, 'invite_link_copied').catch(() => {})
  }

  const send = async (emails: string[], source: 'email' | 'csv') => {
    if (!emails.length || sending) return
    setSending(true)
    const result: Totals = { sent: 0, skipped: 0, failed: 0 }
    for (let i = 0; i < emails.length; i += BATCH) {
      const chunk = emails.slice(i, i + BATCH)
      const res = await createInvitations(
        orgId,
        { emails: chunk, role_id: roleId, usergroup_ids: [], course_uuids: [], expires_in_days: 14, update_existing_members: false },
        token
      ).catch(() => null)
      if (!res?.success) {
        result.failed += chunk.length
        const detail = res?.data?.detail
        if (i === 0 && detail) toast.error(typeof detail === 'string' ? detail : detail?.message ?? t('onb2.invite.failed'))
        continue
      }
      const rows: any[] = Array.isArray(res.data) ? res.data : res.data?.results ?? []
      for (const r of rows) {
        if (r?.status === 'sent' || r?.status === 'resent') result.sent += 1
        else if (r?.status === 'already_member') result.skipped += 1
        else result.failed += 1
      }
    }
    setSending(false)
    setTotals(result)
    if (result.sent) {
      toast.success(t('onb2.invite.sent_toast', { count: result.sent }))
      if (source === 'csv') {
        track(AnalyticsEvent.OnboardingLearnersImported, { count: result.sent })
        recordOnboardingEvent(token, orgId, 'learners_imported').catch(() => {})
      }
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setCsvEmails(extractEmails(await file.text()))
    setTotals(null)
  }

  const gateNotice = gated && (
    <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
      <Info size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p>
          {unlockDate ? t('onb2.invite.gated_until', { date: unlockDate }) : t('onb2.invite.gated')}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setTab('link')}>
            {t('onb2.invite.use_link')}
          </button>
        </div>
      </div>
    </div>
  )

  const rolePicker = grantable.length > 1 && (
    <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="font-semibold text-neutral-800">{t('dashboard.users.invitations.fields.role')}</span>
      <select
        value={roleId}
        onChange={(e) => setRoleId(Number(e.target.value))}
        className={`${INPUT} w-auto min-w-48`}
        aria-label={t('dashboard.users.invitations.fields.role')}
      >
        {grantable.map((r) => (
          <option key={r.id} value={r.id}>
            {roleText(r).name}
          </option>
        ))}
      </select>
    </label>
  )

  const summary = totals && (
    <p className="text-xs text-neutral-500" role="status">
      {t('onb2.invite.summary', { sent: totals.sent, skipped: totals.skipped, failed: totals.failed })}
    </p>
  )

  const body = (
    <div className="flex flex-col gap-4 p-1">
      <SegmentedControl<InviteTab>
        value={tab}
        onChange={(v) => {
          setTab(v)
          setTotals(null)
        }}
        ariaLabel={t('onb2.invite.title')}
        options={[
          { key: 'link', label: t('onb2.invite.tabs.link') },
          { key: 'email', label: t('onb2.invite.tabs.email') },
          { key: 'csv', label: t('onb2.invite.tabs.csv') },
        ]}
      />

      {tab === 'link' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-500">{t('onb2.invite.link_desc')}</p>
          {needsCode ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3.5 py-3 ring-1 ring-inset ring-neutral-200/70">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-neutral-600">{t('onb2.invite.invite_only_create')}</p>
              <Button variant="primary" icon={<LinkSimple size={14} />} loading={creatingCode || codes.isLoading} onClick={createJoinCode}>
                {t('onb2.invite.create_link')}
              </Button>
            </div>
          ) : (
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <LinkSimple size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input readOnly value={joinUrl} onFocus={(e) => e.currentTarget.select()} className={`${INPUT} ps-8`} aria-label={t('onb2.invite.tabs.link')} />
            </div>
            <Button variant="primary" icon={copied ? <Check size={14} weight="bold" /> : <Copy size={14} />} onClick={copy}>
              {copied ? t('onb2.invite.copied') : t('onb2.invite.copy')}
            </Button>
          </div>
          )}
          <p className="text-xs text-neutral-400">{inviteOnly ? t('onb2.invite.invite_only_hint') : t('onb2.invite.link_hint')}</p>
        </div>
      )}

      {tab === 'email' && (
        <div className="flex flex-col gap-3">
          {gateNotice}
          {rolePicker}
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('onb2.invite.email_placeholder')}
            className={TEXTAREA}
            aria-label={t('onb2.invite.tabs.email')}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-neutral-400">{t('onb2.invite.count', { count: typed.length })}</span>
            <Button variant="primary" icon={<EnvelopeSimple size={14} />} loading={sending} disabled={gated || !typed.length} onClick={() => send(typed, 'email')}>
              {t('onb2.invite.send', { count: typed.length })}
            </Button>
          </div>
          {summary}
        </div>
      )}

      {tab === 'csv' && (
        <div className="flex flex-col gap-3">
          {gateNotice}
          {rolePicker}
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center hover:bg-neutral-100 transition-colors">
            <FileCsv size={24} className="text-neutral-400" />
            <span className="text-sm font-semibold text-neutral-800">{fileName || t('onb2.invite.csv_pick')}</span>
            <span className="text-xs text-neutral-400">{t('onb2.invite.csv_hint')}</span>
            <input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} data-testid="csv-input" />
          </label>
          {csvEmails.length > 0 && (
            <div className="rounded-xl bg-white p-3 nice-shadow">
              <p className="text-xs font-semibold text-neutral-700">{t('onb2.invite.csv_found', { count: csvEmails.length })}</p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-neutral-500">
                {csvEmails.slice(0, 5).map((e) => (
                  <li key={e} className="truncate">{e}</li>
                ))}
                {csvEmails.length > 5 && <li>{t('onb2.invite.csv_more', { count: csvEmails.length - 5 })}</li>}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="primary" loading={sending} disabled={gated || !csvEmails.length} onClick={() => send(csvEmails, 'csv')}>
              {t('onb2.invite.import', { count: csvEmails.length })}
            </Button>
          </div>
          {summary}
        </div>
      )}
    </div>
  )

  return <Modal isDialogOpen={open} onOpenChange={onOpenChange} size="md" dialogTitle={t('onb2.invite.title')} dialogContent={body} />
}
