'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { DownloadSimple, FloppyDisk, Lock } from '@phosphor-icons/react'
import { Eye, Globe, ShieldAlert, UserX } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { usePlan } from '@components/Hooks/usePlan'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { Switch } from '@components/ui/switch'
import { Label } from '@components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { getUpgradeUrl } from '@services/config/config'
import type { PlanLevel } from '@services/plans/plans'
import { downloadBlob } from '@services/courses/transfer'
import {
  exportAnalyticsEvents,
  getAnalyticsSettings,
  updateAnalyticsSettings,
  type AnalyticsSettings,
  type AnalyticsSettingsUpdate,
} from '@services/analytics/settings'

const DEFAULT_RETENTION_DAYS = 365
const EXPORT_PERIODS = [30, 90, 365]
const RETENTION_LABEL_KEYS: Record<number, string> = {
  90: 'days_90',
  180: 'days_180',
  365: 'days_365',
  730: 'days_730',
  1095: 'days_1095',
  1825: 'days_1825',
  2555: 'days_2555',
}

type Draft = Required<AnalyticsSettingsUpdate>

const settingsKey = (orgId?: number) => ['analytics', orgId, 'settings'] as const

const OrgEditAnalytics: React.FC = () => {
  const { t } = useTranslation()
  const org = useOrg() as any
  const orgId: number | undefined = org?.id
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const plan = usePlan()
  const { rights } = useAdminStatus()
  const canEdit = rights?.organizations?.action_update === true

  const { data: settings, isLoading, isError } = useQuery<AnalyticsSettings>({
    queryKey: settingsKey(orgId),
    queryFn: () => getAnalyticsSettings(orgId as number, accessToken as string),
    enabled: !!(orgId && accessToken && canEdit),
    staleTime: 60_000,
  })

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportDays, setExportDays] = useState(30)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!settings) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({
      retention_days: settings.retention_days,
      track_anonymous: settings.track_anonymous,
      collect_location: settings.collect_location,
      exclude_staff: settings.exclude_staff,
    })
  }, [settings])

  const changes = useMemo<AnalyticsSettingsUpdate>(() => {
    if (!settings || !draft) return {}
    const diff: AnalyticsSettingsUpdate = {}
    for (const key of Object.keys(draft) as (keyof Draft)[]) {
      if (draft[key] !== settings[key]) (diff as any)[key] = draft[key]
    }
    return diff
  }, [settings, draft])
  const dirty = Object.keys(changes).length > 0

  const extendedAvailable = settings?.retention_options.extended_available ?? false
  const upgradeUrl = getUpgradeUrl(org?.slug || 'default', 'enterprise')

  const retentionLabel = (days: number) => {
    const key = RETENTION_LABEL_KEYS[days]
    const label = key
      ? t(`dashboard.organization.analytics_settings.retention_options.${key}`)
      : t('dashboard.organization.analytics_settings.retention_options.days_n', { count: days })
    return days === DEFAULT_RETENTION_DAYS
      ? t('dashboard.organization.analytics_settings.retention_default', { label })
      : label
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))

  const save = async () => {
    if (!orgId || !accessToken || !dirty) return
    setSaving(true)
    const tid = toast.loading(t('dashboard.organization.analytics_settings.saving'))
    try {
      const updated = await updateAnalyticsSettings(orgId, changes, accessToken)
      queryClient.setQueryData(settingsKey(orgId), updated)
      toast.success(t('dashboard.organization.analytics_settings.saved'), { id: tid })
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.organization.analytics_settings.error'), { id: tid })
    } finally {
      setSaving(false)
    }
  }

  const exportEvents = async () => {
    if (!orgId || !accessToken) return
    setExporting(true)
    const tid = toast.loading(t('dashboard.organization.analytics_settings.exporting'))
    try {
      const blob = await exportAnalyticsEvents(orgId, exportDays, accessToken)
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      downloadBlob(blob, `analytics-events-${org?.slug || orgId}-${date}.csv`)
      toast.success(t('dashboard.organization.analytics_settings.export_done'), { id: tid })
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.organization.analytics_settings.export_error'), { id: tid })
    } finally {
      setExporting(false)
    }
  }

  const controlsDisabled = !canEdit || !draft || saving
  const retentionOptions = settings
    ? [...settings.retention_options.standard, ...settings.retention_options.extended]
    : []
  // Export periods longer than the data kept would only return what's kept.
  // The "everything kept" option covers retention_days itself.
  const exportPeriods = EXPORT_PERIODS.filter((days) => !settings || days < settings.retention_days)

  return (
    <div className="sm:mx-10 mx-0 space-y-4 pb-10">
      {!canEdit && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200/80">
          <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800">{t('dashboard.organization.analytics_settings.admin_only')}</p>
        </div>
      )}

      <div className="bg-white rounded-xl nice-shadow">
        <div className="pt-0.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50 px-4 sm:px-5 py-3 mx-3 my-3 rounded-md">
            <div className="flex flex-col -space-y-1">
              <h1 className="font-bold text-xl text-gray-800">{t('dashboard.organization.analytics_settings.title')}</h1>
              <h2 className="text-gray-500 text-md">{t('dashboard.organization.analytics_settings.subtitle')}</h2>
            </div>
            <button
              onClick={save}
              disabled={controlsDisabled || !dirty}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-black px-4 py-2.5 sm:py-2 text-sm font-semibold text-white nice-shadow hover:bg-neutral-800 transition-colors disabled:opacity-40"
            >
              <FloppyDisk size={16} weight="bold" />
              <span>{t('dashboard.organization.analytics_settings.save')}</span>
            </button>
          </div>
        </div>

        {canEdit && isError && (
          <p className="px-5 pb-5 text-sm text-red-600">{t('dashboard.organization.analytics_settings.load_error')}</p>
        )}

        {canEdit && isLoading && (
          <div className="px-5 pb-5 space-y-3 animate-pulse">
            <div className="h-9 w-64 rounded-md bg-gray-100" />
            <div className="h-16 rounded-xl bg-gray-100" />
            <div className="h-16 rounded-xl bg-gray-100" />
          </div>
        )}

        {draft && settings && (
          <div className="p-4 pt-1 space-y-6">
            {/* Retention */}
            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">
                  {t('dashboard.organization.analytics_settings.retention_title')}
                </h3>
                <p className="text-xs text-gray-500">
                  {t('dashboard.organization.analytics_settings.retention_description')}
                </p>
              </div>
              <Label htmlFor="analytics-retention" className="sr-only">
                {t('dashboard.organization.analytics_settings.retention_title')}
              </Label>
              <Select
                value={String(draft.retention_days)}
                onValueChange={(value) => set('retention_days', Number(value))}
                disabled={controlsDisabled}
              >
                <SelectTrigger id="analytics-retention" className="w-full sm:w-72 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {retentionOptions.map((days) => {
                    const locked = settings.retention_options.extended.includes(days) && !extendedAvailable
                    return (
                      <SelectItem key={days} value={String(days)} disabled={locked}>
                        <span className="flex items-center gap-1.5">
                          {retentionLabel(days)}
                          {locked && <PlanBadge currentPlan={plan} requiredPlan="enterprise" alwaysShow noMargin />}
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">{t('dashboard.organization.analytics_settings.retention_note')}</p>
              {!extendedAvailable && (
                <LockedNotice
                  message={t('dashboard.organization.analytics_settings.extended_locked')}
                  plan={plan}
                  upgradeUrl={upgradeUrl}
                  upgradeLabel={`${t('common.plans.upgrade_to')} Enterprise`}
                />
              )}
            </section>

            {/* Privacy */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">
                {t('dashboard.organization.analytics_settings.privacy_title')}
              </h3>
              <ToggleRow
                icon={<Eye className="w-4 h-4" />}
                title={t('dashboard.organization.analytics_settings.track_anonymous')}
                description={t('dashboard.organization.analytics_settings.track_anonymous_description')}
                checked={draft.track_anonymous}
                onToggle={(checked) => set('track_anonymous', checked)}
                disabled={controlsDisabled}
              />
              <ToggleRow
                icon={<Globe className="w-4 h-4" />}
                title={t('dashboard.organization.analytics_settings.collect_location')}
                description={t('dashboard.organization.analytics_settings.collect_location_description')}
                checked={draft.collect_location}
                onToggle={(checked) => set('collect_location', checked)}
                disabled={controlsDisabled}
              />
              <ToggleRow
                icon={<UserX className="w-4 h-4" />}
                title={t('dashboard.organization.analytics_settings.exclude_staff')}
                description={t('dashboard.organization.analytics_settings.exclude_staff_description')}
                checked={draft.exclude_staff}
                onToggle={(checked) => set('exclude_staff', checked)}
                disabled={controlsDisabled}
              />
            </section>
          </div>
        )}
      </div>

      {/* Raw export (Enterprise) */}
      {settings && (
        <div className="bg-white rounded-xl nice-shadow p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-gray-800">
              {t('dashboard.organization.analytics_settings.export_title')}
            </h3>
            <PlanBadge currentPlan={plan} requiredPlan="enterprise" alwaysShow={!extendedAvailable} />
          </div>
          <p className="text-xs text-gray-500">{t('dashboard.organization.analytics_settings.export_description')}</p>
          {extendedAvailable ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Label htmlFor="analytics-export-days" className="sr-only">
                {t('dashboard.organization.analytics_settings.export_period')}
              </Label>
              <Select value={String(exportDays)} onValueChange={(value) => setExportDays(Number(value))}>
                <SelectTrigger id="analytics-export-days" className="w-full sm:w-56 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {exportPeriods.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {t('dashboard.organization.analytics_settings.export_last_days', { count: days })}
                    </SelectItem>
                  ))}
                  <SelectItem value={String(settings.retention_days)}>
                    {t('dashboard.organization.analytics_settings.export_all')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <button
                onClick={exportEvents}
                disabled={exporting}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700 nice-shadow hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                <DownloadSimple size={16} weight="bold" />
                <span>{t('dashboard.organization.analytics_settings.export_button')}</span>
              </button>
            </div>
          ) : (
            <LockedNotice
              message={t('dashboard.organization.analytics_settings.export_locked')}
              plan={plan}
              upgradeUrl={upgradeUrl}
              upgradeLabel={`${t('common.plans.upgrade_to')} Enterprise`}
            />
          )}
        </div>
      )}
    </div>
  )
}

function LockedNotice({ message, plan, upgradeUrl, upgradeLabel }: {
  message: string
  plan: PlanLevel
  upgradeUrl: string | null
  upgradeLabel: string
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-100">
      <div className="flex items-center gap-2 min-w-0">
        <Lock className="text-gray-400 flex-shrink-0" size={16} weight="bold" />
        <p className="text-xs text-gray-600">{message}</p>
        <PlanBadge currentPlan={plan} requiredPlan="enterprise" alwaysShow noMargin />
      </div>
      {upgradeUrl && (
        <a
          href={upgradeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start sm:self-auto whitespace-nowrap text-xs font-semibold text-gray-600 bg-white px-4 py-2 rounded-lg nice-shadow hover:bg-gray-50 transition-colors"
        >
          {upgradeLabel}
        </a>
      )}
    </div>
  )
}

function ToggleRow({ icon, title, description, checked, onToggle, disabled }: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onToggle: (_checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-white border border-gray-100">
      <div className="flex gap-3 min-w-0">
        <div className="flex-shrink-0 mt-0.5 text-gray-400">{icon}</div>
        <div className="space-y-0.5 min-w-0">
          <h4 className="text-sm font-medium text-gray-800">{title}</h4>
          <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        disabled={disabled}
        aria-label={title}
        className="flex-shrink-0 mt-0.5"
      />
    </div>
  )
}

export default OrgEditAnalytics
