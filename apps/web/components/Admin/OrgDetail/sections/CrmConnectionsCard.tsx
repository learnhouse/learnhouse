'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Plugs } from '@phosphor-icons/react'
import { Chip, SectionCard, Skeleton, formatRelative, type ChipTone } from '@/design'
import { getOrgCrm } from '@services/ee/platform/api'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'

const TONE: Record<string, ChipTone> = { healthy: 'emerald', warning: 'amber', error: 'rose', paused: 'neutral', setup: 'sky' }

/** The org's CRM connections (HubSpot, Salesforce): status only, no tokens. */
export default function CrmConnectionsCard({ orgId }: { orgId: string }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const q = useQuery({
    queryKey: ['superadmin', 'org', String(orgId), 'crm'],
    queryFn: () => getOrgCrm(token, orgId),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
  })
  // Without EE the route doesn't exist: nothing to show.
  if ((!me.isLoading && !me.can('platform.read')) || q.isError) return null
  const items = Array.isArray(q.data?.items) ? q.data!.items : []
  return (
    <SectionCard icon={<Plugs size={18} />} title={t('admin.crm.title')} description={t('admin.crm.description')} bodyClassName="p-0 pt-4">
      {q.isLoading ? (
        <div className="p-5"><Skeleton className="h-16 w-full" /></div>
      ) : items.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-neutral-500">{t('admin.crm.none')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
          {items.map((c) => (
            <li key={c.provider} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-900">{c.provider === 'hubspot' ? 'HubSpot' : 'Salesforce'}</span>
                  <Chip tone={TONE[c.health] ?? 'neutral'}>{t(`crm.status.${c.health}`)}</Chip>
                  {c.environment === 'sandbox' && <Chip tone="amber">{t('crm.environment.sandbox')}</Chip>}
                </div>
                <p className="mt-0.5 text-xs text-neutral-500 truncate" dir="auto">
                  {c.account_name}
                  {c.uses_own_app ? ` · ${t('crm.connection.own_app')}` : ''}
                </p>
                {c.last_error && <p className="mt-1 text-xs text-rose-700 break-words">{c.last_error}</p>}
              </div>
              <div className="text-xs text-neutral-500 text-end tabular-nums">
                <p>{t('admin.crm.contacts', { count: c.records?.contact?.ok ?? 0 })}</p>
                <p>
                  {t('admin.crm.queued_failed', { queued: c.queued, failed: c.failed })}
                  {c.last_sync_at ? ` · ${formatRelative(c.last_sync_at, i18n.language)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
