'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckCircle, ShieldCheck, Trash, WarningCircle, XCircle } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, Modal, SegmentedControl, TEXTAREA } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import type { OrgProfile } from '@services/ee/platform/types'
import { cancelDeletion, executeDeletion, getSettings, getSignals, opsKeys, scheduleDeletion } from '@services/ee/platform/ops'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { Switch, daysUntil, formatDate } from '@components/Admin/Shared/AdminKit'
import { useInvalidateOrg } from './orgQueries'

// Guarded org deletion (SPEC §11.2). Owners only. The server re-checks every
// guard; the dialog shows them up front so nobody has to guess why it refuses.

function DeleteDialog({ open, onOpenChange, org }: { open: boolean; onOpenChange: (_o: boolean) => void; org: { id: number; name: string; slug: string } }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const router = useRouter()
  const invalidate = useInvalidateOrg(org.id)
  const signalsQ = useQuery({ queryKey: opsKeys.signals(org.id), queryFn: () => getSignals(token, org.id), enabled: open && !!token, retry: shouldRetry })
  const settingsQ = useQuery({ queryKey: opsKeys.settings(), queryFn: () => getSettings(token), enabled: open && !!token, retry: shouldRetry })
  const [mode, setMode] = React.useState<'schedule' | 'now'>('schedule')
  const [grace, setGrace] = React.useState('7')
  const [reason, setReason] = React.useState('')
  const [warn, setWarn] = React.useState(true)
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setMode('schedule')
    setGrace('7')
    setReason('')
    setWarn(true)
    setTyped('')
    setError('')
  }, [open])

  const guards = signalsQ.data?.guards
  const failures = Array.isArray(guards?.failures) ? guards!.failures : []
  const settings = settingsQ.data
  const turnedOff = settings ? !settings.auto_delete_effective : false
  const graceNum = Number(grace)
  const graceOk = Number.isInteger(graceNum) && graceNum >= 3 && graceNum <= 30
  const blocked = failures.length > 0 || turnedOff
  const canSubmit = !blocked && !busy && (mode === 'schedule' ? graceOk : typed.trim() === org.slug)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (mode === 'schedule') {
        await scheduleDeletion(token, org.id, { grace_days: graceNum, reason: reason.trim(), warn_admins: warn })
        toast.success(t('admin.org.deletion.scheduled_toast'))
        invalidate()
        onOpenChange(false)
      } else {
        await executeDeletion(token, org.id, { confirm_slug: typed.trim(), reason: reason.trim() || undefined })
        toast.success(t('admin.org.deletion.deleted_toast', { name: org.name }))
        onOpenChange(false)
        router.push('/admin/deletions')
      }
    } catch (err) {
      // 409s carry the exact guard that failed; show it as-is.
      setError(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="md"
      preventClose={busy}
      icon={<Trash size={16} />}
      dialogTitle={t('admin.org.deletion.title', { name: org.name })}
      dialogDescription={t('admin.org.deletion.desc')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={submit} disabled={!canSubmit} loading={busy}>
            {mode === 'schedule' ? t('admin.org.deletion.schedule_cta', { count: graceOk ? graceNum : 7 }) : t('admin.org.deletion.now_cta')}
          </Button>
        </div>
      }
      dialogContent={
        <div className="space-y-5">
          {turnedOff && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <WarningCircle size={16} className="mt-0.5 shrink-0" />
              <span>
                {settings?.env_kill_switch ? t('admin.org.deletion.kill_switch') : t('admin.org.deletion.turned_off')}{' '}
                {!settings?.env_kill_switch && (
                  <Link href="/admin/settings" className="font-semibold underline underline-offset-2">
                    {t('admin.org.deletion.open_settings')}
                  </Link>
                )}
              </span>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
              <ShieldCheck size={16} className="text-neutral-400" />
              {t('admin.org.deletion.guards')}
            </p>
            {signalsQ.isLoading ? (
              <p className="mt-2 text-sm text-neutral-400">{t('common.loading')}</p>
            ) : signalsQ.error ? (
              <p className="mt-2 text-sm text-rose-600">{errorMessage(signalsQ.error, t('admin.common.error_desc'))}</p>
            ) : failures.length === 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle size={15} weight="fill" />
                {t('admin.org.deletion.guards_ok')}
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs text-neutral-500">{t('admin.org.deletion.guards_blocked', { count: failures.length })}</p>
                <ul className="mt-2 space-y-1.5">
                  {failures.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-neutral-700">
                      <XCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-rose-600" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <SegmentedControl
            value={mode}
            onChange={setMode}
            ariaLabel={t('admin.org.deletion.mode')}
            options={[
              { key: 'schedule', label: t('admin.org.deletion.mode_schedule') },
              { key: 'now', label: t('admin.org.deletion.mode_now') },
            ]}
          />

          {mode === 'schedule' ? (
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">{t('admin.org.deletion.schedule_desc')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-[10rem_minmax(0,1fr)] gap-4">
                <div>
                  <FieldLabel error={!graceOk ? t('admin.org.deletion.grace_invalid') : undefined}>{t('admin.org.deletion.grace')}</FieldLabel>
                  <input type="number" min={3} max={30} value={grace} onChange={(e) => setGrace(e.target.value)} className={INPUT} />
                </div>
                <div className="flex items-end justify-between gap-3 pb-2">
                  <span className="text-sm text-neutral-700">{t('admin.org.deletion.warn')}</span>
                  <Switch checked={warn} onChange={setWarn} label={t('admin.org.deletion.warn')} />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-rose-700">{t('admin.org.deletion.now_desc')}</p>
              <div>
                <FieldLabel hint={org.slug}>{t('admin.org.deletion.type_slug')}</FieldLabel>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" autoComplete="off" className={`${INPUT} font-mono`} placeholder={org.slug} />
              </div>
            </div>
          )}

          <div>
            <FieldLabel hint={t('common.optional')}>{t('admin.pocs.reason')}</FieldLabel>
            <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={TEXTAREA} />
          </div>

          {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
        </div>
      }
    />
  )
}

/** Danger-zone row: only owners may delete. */
export function DeleteOrgRow({ org, render }: { org: { id: number; name: string; slug: string }; render: (_button: React.ReactNode) => React.ReactNode }) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const [open, setOpen] = React.useState(false)
  if (me.role !== 'owner') return null
  return (
    <>
      {render(
        <Button variant="danger" icon={<Trash size={14} />} onClick={() => setOpen(true)}>
          {t('admin.org.deletion.cta')}
        </Button>
      )}
      <DeleteDialog open={open} onOpenChange={setOpen} org={org} />
    </>
  )
}

/** Shown above the tabs while the org waits to be deleted. */
export function PendingDeletionBanner({ orgId, profile }: { orgId: number; profile?: OrgProfile }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateOrg(orgId)
  const [busy, setBusy] = React.useState(false)
  if (profile?.lifecycle !== 'pending_deletion') return null
  const left = daysUntil(profile.deletion_scheduled_at)

  const keep = async () => {
    setBusy(true)
    try {
      await cancelDeletion(token, orgId)
      toast.success(t('admin.org.deletion.kept_toast'))
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alert" className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl bg-rose-50 px-5 py-4 ring-1 ring-inset ring-rose-500/30">
      <Trash size={20} className="shrink-0 text-rose-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-rose-700">
          {profile.deletion_scheduled_at
            ? t('admin.org.deletion.banner', { date: formatDate(profile.deletion_scheduled_at, i18n.language), count: Math.max(0, left ?? 0) })
            : t('admin.org.deletion.banner_nodate')}
        </p>
        <p className="mt-0.5 text-xs text-neutral-600">
          {profile.deletion_reason ? t('admin.org.deletion.banner_reason', { reason: profile.deletion_reason }) : t('admin.org.deletion.banner_hint')}
        </p>
      </div>
      {me.can('notes.write') && (
        <Button variant="primary" onClick={keep} loading={busy} icon={<ShieldCheck size={14} />}>
          {t('admin.org.deletion.keep')}
        </Button>
      )}
    </div>
  )
}
