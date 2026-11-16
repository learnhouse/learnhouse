'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowCounterClockwise, CalendarPlus, Trophy, XCircle } from '@phosphor-icons/react'
import { Button, ConfirmDialog, FieldLabel, INPUT, TEXTAREA, SegmentedControl } from '@/design'
import { convertPoc, endPoc, errorMessage, extendPoc, reopenOrg } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, usePlatformMe } from '@components/Admin/hooks'
import { daysUntil, formatDate } from '@components/Admin/Shared/AdminKit'

// Extend / convert / end / reopen a POC. Shared by the POCs board and the
// org detail POC tab. Every dialog says exactly what will happen.

export type PocActionKind = 'extend' | 'convert' | 'end' | 'reopen'

export interface PocTarget {
  id: number
  name: string
  plan?: string | null
  poc_plan?: string | null
  poc_previous_plan?: string | null
  poc_ends_at?: string | null
  lifecycle?: string | null
}

const PAID_PLANS = ['standard', 'pro', 'enterprise'] as const

export function PocActionDialog({
  kind,
  org,
  onClose,
}: {
  kind: PocActionKind | null
  org: PocTarget | null
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const qc = useQueryClient()
  const [days, setDays] = React.useState('14')
  const [plan, setPlan] = React.useState<string>('standard')
  const [outcome, setOutcome] = React.useState<'lost' | 'expired'>('lost')
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (!kind) return
    setDays('14')
    setPlan(org?.poc_plan && PAID_PLANS.includes(org.poc_plan as any) ? org.poc_plan : 'standard')
    setOutcome('lost')
    setReason('')
    // Reset only when a dialog opens for an org, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, org?.id])

  if (!org) return null
  const restorePlan = org.poc_previous_plan || 'free'
  const planLabel = (p: string) => t(`admin.plans.${p}`, { defaultValue: p })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: platformKeys.pocsAll() })
    qc.invalidateQueries({ queryKey: platformKeys.org(org.id) })
    qc.invalidateQueries({ queryKey: platformKeys.orgs() })
  }

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn()
      toast.success(okMsg)
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const daysNum = Number(days)
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 90
  const left = daysUntil(org.poc_ends_at)
  const base = org.poc_ends_at && left !== null && left > 0 ? new Date(org.poc_ends_at) : new Date()
  const newEnd = daysValid ? new Date(base.getTime() + daysNum * 86_400_000).toISOString() : null

  const open = (k: PocActionKind) => kind === k
  const onOpenChange = (o: boolean) => {
    if (!o) onClose()
  }

  return (
    <>
      <ConfirmDialog
        open={open('extend')}
        onOpenChange={onOpenChange}
        tone="info"
        title={t('admin.pocs.extend_title', { name: org.name })}
        confirmLabel={t('admin.pocs.extend')}
        onConfirm={() => (daysValid ? run(() => extendPoc(token, org.id, daysNum), t('admin.pocs.extended')) : toast.error(t('admin.pocs.days_invalid_extend')))}
        message={
          <div className="space-y-3 pt-1">
            <p>{t('admin.pocs.extend_desc')}</p>
            <div>
              <FieldLabel hint={t('admin.pocs.days_hint_extend')} error={!daysValid ? t('admin.pocs.days_invalid_extend') : undefined}>
                {t('admin.pocs.days')}
              </FieldLabel>
              <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className={INPUT} />
            </div>
            {newEnd && <p className="text-xs text-neutral-500">{t('admin.pocs.new_end', { date: formatDate(newEnd, i18n.language) })}</p>}
          </div>
        }
      />

      <ConfirmDialog
        open={open('convert')}
        onOpenChange={onOpenChange}
        tone="info"
        title={t('admin.pocs.convert_title', { name: org.name })}
        confirmLabel={t('admin.pocs.convert_confirm', { plan: planLabel(plan) })}
        onConfirm={() => run(() => convertPoc(token, org.id, plan), t('admin.pocs.converted'))}
        message={
          <div className="space-y-3 pt-1">
            <p>{t('admin.pocs.convert_desc', { plan: planLabel(plan) })}</p>
            <SegmentedControl
              value={plan}
              onChange={setPlan}
              ariaLabel={t('admin.pocs.plan')}
              options={PAID_PLANS.map((p) => ({ key: p, label: planLabel(p) }))}
            />
          </div>
        }
      />

      <ConfirmDialog
        open={open('end')}
        onOpenChange={onOpenChange}
        tone="danger"
        title={t('admin.pocs.end_title', { name: org.name })}
        confirmLabel={t('admin.pocs.end_confirm')}
        onConfirm={() => run(() => endPoc(token, org.id, outcome, reason.trim() || undefined), t('admin.pocs.ended_toast'))}
        message={
          <div className="space-y-3 pt-1">
            {/* A paying customer before the POC goes back to that plan and stays active (API_NOTES §4). */}
            <p>
              {PAID_PLANS.includes(restorePlan as (typeof PAID_PLANS)[number])
                ? t('admin.pocs.end_desc_paid', { plan: planLabel(restorePlan) })
                : t('admin.pocs.end_desc', { plan: planLabel(restorePlan) })}
            </p>
            <SegmentedControl
              value={outcome}
              onChange={setOutcome}
              ariaLabel={t('admin.pocs.outcome')}
              options={[
                { key: 'lost', label: t('admin.pocs.outcome_lost') },
                { key: 'expired', label: t('admin.pocs.outcome_expired') },
              ]}
            />
            <div>
              <FieldLabel hint={t('common.optional')}>{t('admin.pocs.reason')}</FieldLabel>
              <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={TEXTAREA} placeholder={t('admin.pocs.reason_placeholder')} />
            </div>
          </div>
        }
      />

      <ConfirmDialog
        open={open('reopen')}
        onOpenChange={onOpenChange}
        tone="info"
        title={t('admin.pocs.reopen_title', { name: org.name })}
        confirmLabel={t('admin.pocs.reopen')}
        onConfirm={() => run(() => reopenOrg(token, org.id), t('admin.pocs.reopened'))}
        message={<p className="pt-1">{t('admin.pocs.reopen_desc', { plan: planLabel(org.plan || 'free') })}</p>}
      />
    </>
  )
}

/** The action buttons for one POC, in the order they are usually needed. */
export function PocActionButtons({
  org,
  onAction,
  size = 'sm',
}: {
  org: PocTarget & { poc_outcome?: string | null }
  onAction: (_kind: PocActionKind) => void
  size?: 'sm' | 'md'
}) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const isLive = org.lifecycle === 'poc'
  // Reopen is a lifecycle change: the API wants orgs.lifecycle, not pocs.manage.
  const isClosed = org.lifecycle === 'closed' && me.can('orgs.lifecycle')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isLive && (
        <>
          <Button size={size} icon={<CalendarPlus size={13} />} onClick={() => onAction('extend')}>
            {t('admin.pocs.extend')}
          </Button>
          <Button size={size} icon={<Trophy size={13} />} onClick={() => onAction('convert')}>
            {t('admin.pocs.convert')}
          </Button>
          <Button size={size} variant="danger-ghost" icon={<XCircle size={13} />} onClick={() => onAction('end')}>
            {t('admin.pocs.end')}
          </Button>
        </>
      )}
      {isClosed && (
        <Button size={size} icon={<ArrowCounterClockwise size={13} />} onClick={() => onAction('reopen')}>
          {t('admin.pocs.reopen')}
        </Button>
      )}
    </div>
  )
}
