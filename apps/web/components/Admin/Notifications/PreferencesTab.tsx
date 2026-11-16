'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Buildings, CalendarCheck, FlowArrow, Handshake, Key, ShieldWarning, Eye, UsersThree, HardDrives, EnvelopeSimple } from '@phosphor-icons/react'
import { SegmentedControl, Skeleton } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { getPreferences, opsKeys, updatePreferences, type Preferences } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'
import { QueryError, Switch } from '@components/Admin/Shared/AdminKit'
import { IconTile, ToneCard, type Tone } from '@components/Admin/Shared/OpsKit'

// Personal preferences: for each event group, inbox / email / off, plus a
// daily digest email. Every change saves right away (optimistic).

const GROUPS: { key: string; icon: React.ReactNode; tone: Tone }[] = [
  { key: 'org', icon: <Buildings size={16} weight="fill" />, tone: 'blue' },
  { key: 'poc', icon: <Handshake size={16} weight="fill" />, tone: 'violet' },
  { key: 'automation', icon: <FlowArrow size={16} weight="fill" />, tone: 'amber' },
  { key: 'team', icon: <UsersThree size={16} weight="fill" />, tone: 'orange' },
  { key: 'token', icon: <Key size={16} weight="fill" />, tone: 'teal' },
  { key: 'security', icon: <ShieldWarning size={16} weight="fill" />, tone: 'rose' },
  { key: 'follow', icon: <Eye size={16} weight="fill" />, tone: 'indigo' },
  { key: 'system', icon: <HardDrives size={16} weight="fill" />, tone: 'neutral' },
]

export default function PreferencesTab() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: opsKeys.preferences(), queryFn: () => getPreferences(token), enabled: !!token, retry: shouldRetry })
  const prefs = q.data
  const values = Array.isArray(prefs?.values) && prefs!.values.length ? prefs!.values : ['inbox', 'email', 'off']

  const save = async (patch: Partial<Pick<Preferences, 'groups' | 'daily_digest'>>) => {
    const prev = queryClient.getQueryData<Preferences>(opsKeys.preferences())
    if (prev) {
      queryClient.setQueryData<Preferences>(opsKeys.preferences(), {
        ...prev,
        ...patch,
        groups: { ...prev.groups, ...(patch.groups ?? {}) },
      })
    }
    try {
      const body = patch.groups ? { ...patch, groups: { ...(prev?.groups ?? {}), ...patch.groups } } : patch
      const next = await updatePreferences(token, body)
      if (next && typeof next === 'object' && 'groups' in next) queryClient.setQueryData(opsKeys.preferences(), next)
      toast.success(t('admin.notifications.prefs.saved'), { id: 'notif-prefs' })
    } catch (err) {
      if (prev) queryClient.setQueryData(opsKeys.preferences(), prev)
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  if (q.error) return <QueryError error={q.error} onRetry={() => q.refetch()} />

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <ToneCard
        className="xl:col-span-2"
        icon={<CalendarCheck size={18} weight="fill" />}
        tone="rose"
        title={t('admin.notifications.prefs.title')}
        description={t('admin.notifications.prefs.desc')}
        bodyClassName="px-5 pb-3 pt-3"
      >
        <div className="divide-y divide-neutral-100">
          {GROUPS.map((g) => (
            <div key={g.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <IconTile icon={g.icon} tone={g.tone} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{t(`admin.notifications.groups.${g.key}`)}</p>
                  <p className="text-xs text-neutral-500">{t(`admin.notifications.prefs.group_desc.${g.key}`)}</p>
                </div>
              </div>
              {!prefs ? (
                <Skeleton className="h-9 w-48 rounded-xl" />
              ) : (
                <SegmentedControl
                  ariaLabel={t(`admin.notifications.groups.${g.key}`)}
                  value={String(prefs.groups?.[g.key] ?? 'inbox')}
                  onChange={(v) => save({ groups: { [g.key]: v } })}
                  options={values.map((v) => ({ key: v, label: t(`admin.notifications.prefs.values.${v}`, { defaultValue: v }) }))}
                />
              )}
            </div>
          ))}
        </div>
      </ToneCard>

      <ToneCard icon={<EnvelopeSimple size={18} weight="fill" />} tone="sky" title={t('admin.notifications.prefs.digest_title')} description={t('admin.notifications.prefs.digest_desc')}>
        <label className="flex items-center justify-between gap-3 text-sm text-neutral-700">
          <span>{t('admin.notifications.prefs.digest_toggle')}</span>
          {!prefs ? (
            <Skeleton className="h-5 w-9 rounded-full" />
          ) : (
            <Switch checked={!!prefs.daily_digest} onChange={(v) => save({ daily_digest: v })} label={t('admin.notifications.prefs.digest_toggle')} />
          )}
        </label>
      </ToneCard>
    </div>
  )
}
