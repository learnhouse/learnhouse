'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Prohibit, ShieldSlash } from '@phosphor-icons/react'
import {
  Button,
  FieldLabel,
  INPUT,
  Modal,
  StatusPill,
  TEXTAREA,
  type Status,
} from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import {
  addGlobalSuppression,
  deliverabilityKeys,
  suspendOrgSending,
  type DeliverabilityOrg,
  type DeliverabilityThresholds,
  type SendingStatus,
} from '@services/ee/platform/deliverability'
import { useAccessToken } from '@components/Admin/hooks'

// Pieces of the deliverability page: rate formatting and threshold colors,
// the sending status pill, a risk score to sort orgs by, and the two dialogs
// that take a reason (suspend an org, suppress an address everywhere).

export const num = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString()

/** Rates come as fractions (0.012 = 1.2%). */
export function pct(v: number | null | undefined, digits = 2): string {
  const n = Number(v) || 0
  return `${(n * 100).toFixed(n === 0 ? 0 : digits)}%`
}

/** Over the threshold is danger, past half of it a warning; too few sends to judge is neutral. */
export function rateStatus(
  rate: number | null | undefined,
  threshold: number,
  sample?: number,
  minSample?: number
): Status {
  if (sample !== undefined && minSample !== undefined && sample < minSample)
    return 'neutral'
  const r = Number(rate) || 0
  if (!threshold) return 'neutral'
  if (r >= threshold) return 'danger'
  if (r >= threshold / 2) return 'warning'
  return 'success'
}

export const STATUS_TILE: Record<Status, string> = {
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-rose-50 text-rose-600',
  info: 'bg-sky-50 text-sky-600',
  neutral: 'bg-neutral-100 text-neutral-600',
  ai: 'bg-violet-50 text-violet-600',
}

export function RatePill({
  rate,
  threshold,
  sample,
  minSample,
}: {
  rate: number
  threshold: number
  sample?: number
  minSample?: number
}) {
  const { t } = useTranslation()
  const status = rateStatus(rate, threshold, sample, minSample)
  return (
    <StatusPill
      status={status}
      title={
        status === 'neutral' && sample !== undefined
          ? t('admin.deliverability.small_sample', { count: minSample ?? 0 })
          : t('admin.deliverability.threshold_title', {
              threshold: pct(threshold),
            })
      }
    >
      <span className="tabular-nums">{pct(rate)}</span>
    </StatusPill>
  )
}

const SENDING_STATUS: Record<SendingStatus, Status> = {
  active: 'success',
  review: 'info',
  paused: 'warning',
  suspended: 'danger',
}

export function SendingStatusPill({
  status,
}: {
  status: SendingStatus | string
}) {
  const { t } = useTranslation()
  return (
    <StatusPill
      status={SENDING_STATUS[status as SendingStatus] ?? 'neutral'}
      dot
    >
      {t(`admin.deliverability.status.${status}`, { defaultValue: status })}
    </StatusPill>
  )
}

/**
 * Higher = look first. Stopped orgs lead (suspended, then paused, then in
 * review), then the share of either threshold reached, then volume.
 */
export function riskScore(
  o: DeliverabilityOrg,
  th: DeliverabilityThresholds
): number {
  const statusWeight =
    o.status === 'suspended'
      ? 30
      : o.status === 'paused'
        ? 20
        : o.status === 'review'
          ? 10
          : 0
  const judged = (o.sent_30d ?? 0) >= (th.min_sample ?? 0)
  const ratio = judged
    ? Math.max(
        th.bounce_rate ? (o.bounce_rate_7d || 0) / th.bounce_rate : 0,
        th.complaint_rate ? (o.complaint_rate_7d || 0) / th.complaint_rate : 0
      )
    : 0
  return (
    statusWeight +
    Math.min(o.in_review ?? 0, 3) * 2 +
    Math.min(ratio, 5) * 2 +
    Math.log10(1 + (o.sent_24h || 0)) / 10
  )
}

export function useInvalidateDeliverability() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: deliverabilityKeys.all })
}

export function SuspendDialog({
  org,
  open,
  onOpenChange,
}: {
  org: DeliverabilityOrg | null
  open: boolean
  onOpenChange: (_o: boolean) => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const invalidate = useInvalidateDeliverability()
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) setReason('')
  }, [open])
  const run = async () => {
    if (!org || !reason.trim()) return
    setBusy(true)
    try {
      await suspendOrgSending(token, org.org_id, reason.trim())
      toast.success(
        t('admin.deliverability.suspended_toast', { name: org.name })
      )
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
      icon={<Prohibit size={18} />}
      dialogTitle={t('admin.deliverability.suspend_title', {
        name: org?.name ?? '',
      })}
      dialogDescription={t('admin.deliverability.suspend_desc')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={run}
            loading={busy}
            disabled={!reason.trim()}
          >
            {t('admin.deliverability.suspend')}
          </Button>
        </>
      }
      dialogContent={
        <div>
          <FieldLabel>{t('admin.deliverability.reason')}</FieldLabel>
          <textarea
            rows={3}
            maxLength={500}
            className={TEXTAREA}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.deliverability.suspend_reason_placeholder')}
            autoFocus
          />
          <p className="mt-2 text-xs text-neutral-500">
            {t('admin.deliverability.suspend_hint')}
          </p>
        </div>
      }
    />
  )
}

export function AddSuppressionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (_o: boolean) => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const invalidate = useInvalidateDeliverability()
  const [email, setEmail] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (open) {
      setEmail('')
      setReason('')
    }
  }, [open])
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && !!reason.trim()
  const run = async () => {
    if (!valid) return
    setBusy(true)
    try {
      await addGlobalSuppression(token, email.trim(), reason.trim())
      toast.success(
        t('admin.deliverability.suppressed_toast', { email: email.trim() })
      )
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
      icon={<ShieldSlash size={18} />}
      dialogTitle={t('admin.deliverability.add_suppression')}
      dialogDescription={t('admin.deliverability.add_suppression_desc')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={run}
            loading={busy}
            disabled={!valid}
          >
            {t('admin.deliverability.suppress')}
          </Button>
        </>
      }
      dialogContent={
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
        >
          <div>
            <FieldLabel>{t('admin.deliverability.email')}</FieldLabel>
            <input
              type="email"
              dir="ltr"
              className={`${INPUT} text-start`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>{t('admin.deliverability.reason')}</FieldLabel>
            <input
              className={INPUT}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(
                'admin.deliverability.suppression_reason_placeholder'
              )}
            />
          </div>
          <button type="submit" hidden />
        </form>
      }
    />
  )
}
