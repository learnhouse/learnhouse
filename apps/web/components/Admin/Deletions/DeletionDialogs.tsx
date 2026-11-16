'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CalendarX, Lifebuoy, Trash, XCircle } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, Modal, Skeleton, TEXTAREA } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { cancelDeletion, executeDeletion, opsKeys, scheduleDeletion } from '@services/ee/platform/ops'
import { useAccessToken } from '@components/Admin/hooks'
import { Switch } from '@components/Admin/Shared/AdminKit'
import { useTemplates } from '@components/Admin/Emails/emailUi'
import { GuardsList, useSignals } from './deletionUi'

// The three deletion flows, shared by the Deletions page and org detail:
// Keep (cancel a scheduled deletion), Schedule (owners, guarded, with a
// grace period) and Delete now (owners, guarded, the slug typed to confirm).

export interface DeletionTarget {
  id: number | string
  name: string
  slug: string
}

export function useInvalidateDeletion(orgId: number | string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: platformKeys.org(orgId) })
    qc.invalidateQueries({ queryKey: platformKeys.orgProfile(orgId) })
    qc.invalidateQueries({ queryKey: platformKeys.orgs() })
    qc.invalidateQueries({ queryKey: opsKeys.deletions() })
    qc.invalidateQueries({ queryKey: opsKeys.signals(orgId) })
  }
}

export function KeepDialog({ org, open, onOpenChange }: { org: DeletionTarget | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const invalidate = useInvalidateDeletion(org?.id ?? '')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) setReason('')
  }, [open])
  const run = async () => {
    if (!org) return
    setBusy(true)
    try {
      await cancelDeletion(token, org.id, reason.trim() || undefined)
      toast.success(t('admin.deletions.kept', { name: org.name }))
      invalidate()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      preventClose={busy}
      size="sm"
      icon={<Lifebuoy size={18} />}
      dialogTitle={t('admin.deletions.keep_title', { name: org?.name ?? '' })}
      dialogDescription={t('admin.deletions.keep_desc')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={run} loading={busy}>
            {t('admin.deletions.keep')}
          </Button>
        </>
      }
      dialogContent={
        <div>
          <FieldLabel hint={t('common.optional')}>{t('admin.deletions.reason')}</FieldLabel>
          <textarea rows={2} maxLength={300} className={TEXTAREA} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin.deletions.keep_reason_placeholder')} />
        </div>
      }
    />
  )
}

function Consequences() {
  const { t } = useTranslation()
  return (
    <ul className="space-y-1.5 rounded-xl bg-rose-50 px-3.5 py-3">
      {(['courses', 'members', 'files', 'domain', 'undo'] as const).map((k) => (
        <li key={k} className="flex items-start gap-2 text-xs text-rose-700">
          <XCircle size={13} weight="fill" className="mt-px shrink-0" />
          {t(`admin.deletions.consequence.${k}`)}
        </li>
      ))}
    </ul>
  )
}

export function DeleteNowDialog({ org, open, onOpenChange, onDeleted }: { org: DeletionTarget | null; open: boolean; onOpenChange: (o: boolean) => void; onDeleted?: () => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const invalidate = useInvalidateDeletion(org?.id ?? '')
  const signals = useSignals(org?.id, open)
  const [typed, setTyped] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) {
      setTyped('')
      setReason('')
    }
  }, [open])
  const guardsOk = !!signals.data?.guards?.ok
  const match = !!org && typed.trim() === org.slug
  const run = async () => {
    if (!org || !match) return
    setBusy(true)
    try {
      await executeDeletion(token, org.id, { confirm_slug: typed.trim(), reason: reason.trim() || undefined })
      toast.success(t('admin.deletions.deleted_toast', { name: org.name }))
      invalidate()
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      preventClose={busy}
      size="md"
      icon={<Trash size={18} />}
      dialogTitle={t('admin.deletions.delete_now_title', { name: org?.name ?? '' })}
      dialogDescription={t('admin.deletions.delete_now_desc')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" icon={<Trash size={14} />} onClick={run} disabled={!match || !guardsOk} loading={busy}>
            {t('admin.deletions.delete_now')}
          </Button>
        </>
      }
      dialogContent={
        <div className="space-y-4">
          <Consequences />
          {signals.isLoading ? <Skeleton className="h-5 w-56" /> : <GuardsList guards={signals.data?.guards} defaultOpen />}
          <div>
            <FieldLabel hint={t('common.optional')}>{t('admin.deletions.reason')}</FieldLabel>
            <input className={INPUT} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <FieldLabel>{t('admin.deletions.type_slug', { slug: org?.slug ?? '' })}</FieldLabel>
            <input className={`${INPUT} font-mono`} dir="ltr" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={org?.slug} disabled={!guardsOk} />
          </div>
        </div>
      }
    />
  )
}

export function ScheduleDialog({ org, open, onOpenChange, graceRange = [3, 30] }: { org: DeletionTarget | null; open: boolean; onOpenChange: (o: boolean) => void; graceRange?: number[] }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const invalidate = useInvalidateDeletion(org?.id ?? '')
  const signals = useSignals(org?.id, open)
  const { templates } = useTemplates(open)
  const [min, max] = [graceRange[0] ?? 3, graceRange[1] ?? 30]
  const [grace, setGrace] = React.useState('7')
  const [reason, setReason] = React.useState('')
  const [warn, setWarn] = React.useState(true)
  const [tpl, setTpl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setGrace('7')
    setReason('')
    setWarn(true)
    setTpl('')
  }, [open])
  const days = Number(grace)
  const graceOk = Number.isInteger(days) && days >= min && days <= max
  const guardsOk = !!signals.data?.guards?.ok
  const valid = graceOk && !!reason.trim() && guardsOk
  const when = graceOk ? new Date(Date.now() + days * 86_400_000).toLocaleDateString() : ''
  const run = async () => {
    if (!org || !valid) return
    setBusy(true)
    try {
      await scheduleDeletion(token, org.id, { grace_days: days, reason: reason.trim(), warn_admins: warn, warn_template_uuid: warn && tpl ? tpl : null })
      toast.success(t('admin.deletions.scheduled_toast', { name: org.name, date: when }))
      invalidate()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      preventClose={busy}
      size="md"
      icon={<CalendarX size={18} />}
      dialogTitle={t('admin.deletions.schedule_title', { name: org?.name ?? '' })}
      dialogDescription={t('admin.deletions.schedule_desc')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" icon={<CalendarX size={14} />} onClick={run} disabled={!valid} loading={busy}>
            {t('admin.deletions.schedule')}
          </Button>
        </>
      }
      dialogContent={
        <div className="space-y-4">
          {signals.isLoading ? <Skeleton className="h-5 w-56" /> : <GuardsList guards={signals.data?.guards} defaultOpen />}
          <div className="grid grid-cols-1 sm:grid-cols-[9rem_minmax(0,1fr)] gap-3">
            <div>
              <FieldLabel error={grace && !graceOk ? t('admin.deletions.grace_range', { min, max }) : undefined}>{t('admin.deletions.grace')}</FieldLabel>
              <input type="number" min={min} max={max} className={INPUT} value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^\d]/g, ''))} disabled={!guardsOk} />
            </div>
            <div>
              <FieldLabel>{t('admin.deletions.reason')}</FieldLabel>
              <input className={INPUT} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin.deletions.reason_placeholder')} disabled={!guardsOk} />
            </div>
          </div>
          {graceOk && <p className="-mt-2 text-xs text-neutral-500">{t('admin.deletions.will_delete_on', { date: when })}</p>}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-800">{t('admin.deletions.warn_admins')}</p>
              <p className="text-xs text-neutral-500">{t('admin.deletions.warn_admins_desc')}</p>
            </div>
            <Switch checked={warn} onChange={setWarn} label={t('admin.deletions.warn_admins')} disabled={!guardsOk} />
          </div>
          {warn && (
            <div>
              <FieldLabel hint={t('common.optional')}>{t('admin.deletions.warn_template')}</FieldLabel>
              <select className={INPUT} value={tpl} onChange={(e) => setTpl(e.target.value)} disabled={!guardsOk}>
                <option value="">{t('admin.deletions.default_warning')}</option>
                {templates.map((x) => (
                  <option key={x.template_uuid} value={x.template_uuid}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-neutral-500">{t('admin.deletions.auto_cancel_note')}</p>
        </div>
      }
    />
  )
}
