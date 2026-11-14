'use client'

import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { WarningCircle } from '@phosphor-icons/react'
import { EmptyState, Panel, Skeleton, StickySaveBar } from '@/design'
import { type RoleGroup, getOrgRouting, updateOrgRouting } from '@services/notifications/notifications'
import { useNotificationSession } from './useNotificationSession'

const GROUPS: RoleGroup[] = ['admins', 'maintainers', 'course_authors']

/** Dashboard → Notifications → Who's notified: role groups per admin event. */
export default function OrgRoutingPanel() {
  const { t } = useTranslation()
  const { token, orgId } = useNotificationSession()
  const qc = useQueryClient()
  const key = ['notifications', orgId ?? 0, 'routing']
  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    enabled: !!token && !!orgId,
    queryFn: () => getOrgRouting(orgId!, token!),
    retry: false,
  })
  // Edits on top of the saved routing; cleared on save or discard.
  const [edits, setEdits] = useState<Record<string, RoleGroup[]>>({})
  const [saving, setSaving] = useState(false)
  const draft = useMemo<Record<string, RoleGroup[]>>(
    () => ({ ...Object.fromEntries(Object.entries(data?.types || {}).map(([k, v]) => [k, v.roles])), ...edits }),
    [data, edits]
  )
  const dirty = useMemo(
    () => !!data && Object.entries(draft).some(([k, v]) => [...v].sort().join() !== [...(data.types[k]?.roles || [])].sort().join()),
    [data, draft]
  )

  if (isLoading) return <Skeleton className="h-96 w-full" />
  if (isError || !data) {
    return (
      <Panel>
        <EmptyState icon={<WarningCircle size={22} />} title={t('notifications.routing.forbidden_title')} description={t('notifications.routing.forbidden_body')} />
      </Panel>
    )
  }

  const toggle = (type: string, group: RoleGroup, on: boolean) =>
    setEdits((e) => {
      const cur = draft[type] || []
      return { ...e, [type]: on ? [...new Set([...cur, group])] : cur.filter((g) => g !== group) }
    })

  const save = async () => {
    if (!token || !orgId) return
    setSaving(true)
    try {
      const next = await updateOrgRouting(orgId, draft, token)
      qc.setQueryData(key, next)
      setEdits({})
      toast.success(t('notifications.settings_saved'))
    } catch {
      toast.error(t('notifications.settings_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="notification-routing">
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-neutral-100 px-5 py-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-neutral-900">{t('notifications.routing.title')}</h3>
            <p className="mt-0.5 text-xs text-neutral-500">{t('notifications.routing.description')}</p>
          </div>
          <div className="hidden shrink-0 grid-cols-3 gap-2 sm:grid">
            {GROUPS.map((g) => (
              <span key={g} className="w-24 text-center text-[11px] font-semibold text-neutral-500">
                {t(`notifications.routing.groups.${g}`)}
              </span>
            ))}
          </div>
        </div>
        <div className="divide-y divide-neutral-100">
          {Object.entries(data.types).map(([type, meta]) => {
            const roles = draft[type] || []
            return (
              <div key={type} className="flex flex-col gap-2.5 px-5 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-neutral-900">{t(`notifications.types.${type}`)}</p>
                    <p className="text-[11.5px] text-neutral-500">
                      {t(`notifications.categories.${meta.category}`)}
                      {meta.priority === 'important' && <> · {t('notifications.important')}</>}
                    </p>
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-3 gap-2 ps-5 sm:ps-0">
                  {GROUPS.map((g) => (
                    <label key={g} className="flex w-24 flex-col items-center gap-1 text-[10.5px] font-semibold text-neutral-400">
                      <span className="sm:hidden">{t(`notifications.routing.groups.${g}`)}</span>
                      <input
                        type="checkbox"
                        className="size-4 accent-neutral-900"
                        checked={roles.includes(g)}
                        onChange={(e) => toggle(type, g, e.target.checked)}
                        aria-label={`${t(`notifications.types.${type}`)}: ${t(`notifications.routing.groups.${g}`)}`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>
      <StickySaveBar
        visible={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => setEdits({})}
      />
    </div>
  )
}
