'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FlowArrow, Gauge, Robot, ShieldWarning, Trash, Warning } from '@phosphor-icons/react'
import { ConfirmDialog, DashPage, Skeleton, StatusPill, buttonClass } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { getSettings, opsKeys, updateSettings, type PlatformSettings } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, CopyLinkButton, NoAccess, QueryError, Switch } from '@components/Admin/Shared/AdminKit'
import { DetailRows, ToneCard } from '@components/Admin/Shared/OpsKit'

// Platform settings (owners only). Today: the automatic-deletion switch and
// the read-only safety limits that guard every deletion.

export default function SettingsPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const qc = useQueryClient()
  const isOwner = me.role === 'owner' || me.legacy
  const [confirm, setConfirm] = React.useState<boolean | null>(null)

  const q = useQuery({
    queryKey: opsKeys.settings(),
    queryFn: () => getSettings(token),
    enabled: !!token && isOwner,
    retry: shouldRetry,
  })

  if (!me.isLoading && !isOwner) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.settings.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const s = q.data
  const save = async (enabled: boolean) => {
    try {
      const next = await updateSettings(token, { auto_delete_enabled: enabled })
      qc.setQueryData<PlatformSettings>(opsKeys.settings(), next)
      qc.invalidateQueries({ queryKey: opsKeys.deletions() })
      toast.success(enabled ? t('admin.settings.enabled_toast') : t('admin.settings.disabled_toast'))
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  const limits = s?.limits ?? {}
  const grace = Array.isArray(limits.grace_days) ? limits.grace_days : []
  const num = (v?: number) => (v === undefined || v === null ? '–' : v.toLocaleString())

  return (
    <DashPage>
      <AdminHeader title={t('admin.settings.title')} subtitle={t('admin.settings.subtitle')} actions={<CopyLinkButton label="" />} />
      {q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <ToneCard
            className="lg:col-span-2"
            icon={<Robot size={18} />}
            tone="rose"
            title={t('admin.settings.auto_delete')}
            description={t('admin.settings.auto_delete_desc')}
            actions={
              s ? (
                <StatusPill status={s.auto_delete_effective ? 'danger' : 'neutral'} dot>
                  {s.auto_delete_effective ? t('admin.settings.state_on') : t('admin.settings.state_off')}
                </StatusPill>
              ) : undefined
            }
          >
            {!s ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-72" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900">{t('admin.settings.allow_auto_delete')}</p>
                    <p className="text-xs text-neutral-500">{t('admin.settings.allow_auto_delete_desc')}</p>
                  </div>
                  <Switch
                    checked={s.auto_delete_enabled}
                    disabled={s.env_kill_switch}
                    label={t('admin.settings.allow_auto_delete')}
                    onChange={(v) => (v ? setConfirm(true) : save(false))}
                  />
                </div>
                <div className="flex items-start gap-2.5 rounded-xl bg-rose-50 px-3.5 py-3 text-xs text-rose-700">
                  <Warning size={16} weight="fill" className="mt-px shrink-0" />
                  <div className="space-y-1">
                    <p className="font-semibold">{t('admin.settings.warning_title')}</p>
                    <p>{t('admin.settings.warning_body')}</p>
                  </div>
                </div>
                {s.env_kill_switch && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-xs text-amber-700">
                    <ShieldWarning size={16} weight="fill" className="mt-px shrink-0" />
                    <p>{t('admin.settings.kill_switch')}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link href="/admin/deletions" className={buttonClass('secondary', 'md')}>
                    <Trash size={14} />
                    {t('admin.settings.open_deletions')}
                  </Link>
                  <Link href="/admin/automations" className={buttonClass('secondary', 'md')}>
                    <FlowArrow size={14} />
                    {t('admin.settings.open_automations')}
                  </Link>
                </div>
              </div>
            )}
          </ToneCard>

          <ToneCard icon={<Gauge size={18} />} tone="amber" title={t('admin.settings.limits')} description={t('admin.settings.limits_desc')}>
            {!s ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <DetailRows
                rows={[
                  { label: t('admin.settings.limit.max_per_day'), value: num(limits.max_executions_per_day) },
                  { label: t('admin.settings.limit.max_per_run'), value: num(limits.max_schedules_per_run) },
                  { label: t('admin.settings.limit.grace'), value: grace.length === 2 ? t('admin.settings.limit.grace_value', { min: grace[0], max: grace[1] }) : '–' },
                  { label: t('admin.settings.limit.max_members'), value: num(limits.max_members) },
                  { label: t('admin.settings.limit.max_activities'), value: num(limits.max_activities) },
                  { label: t('admin.settings.limit.min_inactive'), value: t('admin.settings.limit.days', { count: limits.min_inactive_days ?? 0 }) },
                  { label: t('admin.settings.limit.min_age'), value: t('admin.settings.limit.days', { count: limits.min_age_days ?? 0 }) },
                  { label: t('admin.settings.limit.recent_notes'), value: t('admin.settings.limit.days', { count: limits.recent_note_days ?? 0 }) },
                ]}
              />
            )}
          </ToneCard>
        </div>
      )}

      <ConfirmDialog
        open={confirm === true}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('admin.settings.confirm_title')}
        message={t('admin.settings.confirm_body')}
        confirmLabel={t('admin.settings.confirm_cta')}
        onConfirm={() => save(true)}
      />
    </DashPage>
  )
}
