'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { DeviceMobile, EnvelopeSimple, Bell } from '@phosphor-icons/react'
import { Panel, SegmentedControl, Skeleton } from '@/design'
import { Switch } from '@components/ui/switch'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import {
  ADMIN_CATEGORIES,
  PERSONAL_CATEGORIES,
  type EmailDigest,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
  getPreferences,
  updatePreferences,
} from '@services/notifications/notifications'
import { categoryIcon } from './look'
import { useNotificationSession } from './useNotificationSession'

const CHANNELS: { key: NotificationChannel; Icon: typeof Bell }[] = [
  { key: 'in_app', Icon: Bell },
  { key: 'email', Icon: EnvelopeSimple },
  { key: 'push', Icon: DeviceMobile },
]

function CategoryMatrix({
  title,
  description,
  categories,
  prefs,
  onToggle,
}: {
  title: string
  description: string
  categories: readonly NotificationCategory[]
  prefs: NotificationPreferences
  onToggle: (_category: NotificationCategory, _channel: NotificationChannel, _on: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-neutral-100 px-5 py-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
        </div>
        <div className="hidden shrink-0 grid-cols-3 gap-2 sm:grid">
          {CHANNELS.map(({ key, Icon }) => (
            <span key={key} className="flex w-16 flex-col items-center gap-1 text-[11px] font-semibold text-neutral-500">
              <Icon size={15} />
              {t(`notifications.channels.${key}`)}
            </span>
          ))}
        </div>
      </div>
      <div className="divide-y divide-neutral-100">
        {categories.map((c) => {
          const Icon = categoryIcon(c)
          const row = prefs.channels[c] || { in_app: true, email: false, push: true }
          return (
            <div key={c} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center" data-testid={`notif-pref-${c}`}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900">{t(`notifications.categories.${c}`)}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{t(`notifications.category_hints.${c}`)}</p>
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-2 ps-11 sm:ps-0">
                {CHANNELS.map(({ key, Icon: ChIcon }) => {
                  const disabled = key !== 'in_app' && !row.in_app
                  return (
                    <label key={key} className="flex w-16 flex-col items-center gap-1">
                      <span className="flex items-center gap-1 text-[10.5px] font-semibold text-neutral-400 sm:hidden">
                        <ChIcon size={12} />
                        {t(`notifications.channels.${key}`)}
                      </span>
                      <Switch
                        checked={disabled ? false : !!row[key]}
                        disabled={disabled}
                        onCheckedChange={(on) => onToggle(c, key, on)}
                        aria-label={`${t(`notifications.categories.${c}`)}: ${t(`notifications.channels.${key}`)}`}
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** Account → Notifications: per category × channel switches, the email digest, push on/off. */
export default function NotificationSettings() {
  const { t } = useTranslation()
  const { token } = useNotificationSession()
  const { isAdmin } = useAdminStatus()
  const qc = useQueryClient()
  const key = ['notifications', 'preferences']
  const { data: prefs, isLoading } = useQuery({
    queryKey: key,
    enabled: !!token,
    queryFn: () => getPreferences(token!),
  })

  const save = async (body: Parameters<typeof updatePreferences>[1], optimistic: (_p: NotificationPreferences) => NotificationPreferences) => {
    if (!token || !prefs) return
    const before = prefs
    qc.setQueryData(key, optimistic(prefs))
    try {
      const next = await updatePreferences(token, body)
      qc.setQueryData(key, next)
      toast.success(t('notifications.settings_saved'), { id: 'notif-prefs' })
    } catch {
      qc.setQueryData(key, before)
      toast.error(t('notifications.settings_error'), { id: 'notif-prefs' })
    }
  }

  const toggle = (category: NotificationCategory, channel: NotificationChannel, on: boolean) =>
    save({ channels: { [category]: { [channel]: on } } }, (p) => ({
      ...p,
      channels: { ...p.channels, [category]: { ...p.channels[category], [channel]: on } },
    }))

  if (isLoading || !prefs) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4" data-testid="notification-settings">
      <Panel padded>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-neutral-900">{t('notifications.digest.title')}</h3>
            <p className="mt-0.5 text-xs text-neutral-500">{t('notifications.digest.description')}</p>
          </div>
          <SegmentedControl
            ariaLabel={t('notifications.digest.title')}
            value={prefs.email_digest}
            onChange={(v: EmailDigest) => save({ email_digest: v }, (p) => ({ ...p, email_digest: v }))}
            options={(['off', 'daily', 'weekly'] as const).map((k) => ({ key: k, label: t(`notifications.digest.${k}`) }))}
          />
        </div>
        <div className="mt-4 flex items-start justify-between gap-6 border-t border-neutral-100 pt-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900">{t('notifications.push.title')}</h3>
            <p className="mt-0.5 text-xs text-neutral-500">{t('notifications.push.description')}</p>
          </div>
          <Switch
            checked={prefs.push_enabled}
            onCheckedChange={(on) => save({ push_enabled: on }, (p) => ({ ...p, push_enabled: on }))}
            aria-label={t('notifications.push.title')}
          />
        </div>
      </Panel>
      <CategoryMatrix
        title={t('notifications.settings_personal')}
        description={t('notifications.settings_personal_hint')}
        categories={PERSONAL_CATEGORIES}
        prefs={prefs}
        onToggle={toggle}
      />
      {isAdmin && (
        <CategoryMatrix
          title={t('notifications.settings_admin')}
          description={t('notifications.settings_admin_hint')}
          categories={ADMIN_CATEGORIES}
          prefs={prefs}
          onToggle={toggle}
        />
      )}
    </div>
  )
}
