'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Copy, Check, FileCsv, LinkSimple, EnvelopeSimple, Info } from '@phosphor-icons/react'
import { Button, SegmentedControl, TEXTAREA, INPUT } from '@/design'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getUriWithOrg } from '@services/config/config'
import { inviteBatchUsers } from '@services/organizations/invites'
import { recordOnboardingEvent } from '@services/onboarding/onboarding'
import { extractEmails } from '@/lib/onboarding'

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

  const joinUrl = absolute(getUriWithOrg(orgSlug, '/signup'))
  const typed = useMemo(() => extractEmails(text), [text])
  const gated = !!gate?.gated
  const unlockDate = gate?.unlocks_at
    ? new Date(gate.unlocks_at).toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' })
    : null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
    } catch {
      /* the field stays selectable */
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
      const res = await inviteBatchUsers(orgId, chunk.join(','), undefined, token).catch(() => null)
      if (!res?.success) {
        result.failed += chunk.length
        const detail = res?.data?.detail
        if (i === 0 && detail) toast.error(typeof detail === 'string' ? detail : detail?.message ?? t('onb2.invite.failed'))
        continue
      }
      const rows: any[] = Array.isArray(res.data) ? res.data : res.data?.results ?? []
      for (const r of rows) {
        if (r?.status === 'sent') result.sent += 1
        else if (r?.status === 'already_invited' || r?.status === 'already_member') result.skipped += 1
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
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <LinkSimple size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input readOnly value={joinUrl} onFocus={(e) => e.currentTarget.select()} className={`${INPUT} ps-8`} aria-label={t('onb2.invite.tabs.link')} />
            </div>
            <Button variant="primary" icon={copied ? <Check size={14} weight="bold" /> : <Copy size={14} />} onClick={copy}>
              {copied ? t('onb2.invite.copied') : t('onb2.invite.copy')}
            </Button>
          </div>
          <p className="text-xs text-neutral-400">{t('onb2.invite.link_hint')}</p>
        </div>
      )}

      {tab === 'email' && (
        <div className="flex flex-col gap-3">
          {gateNotice}
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
