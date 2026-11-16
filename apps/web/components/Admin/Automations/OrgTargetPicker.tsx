'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Check, MagnifyingGlass, X } from '@phosphor-icons/react'
import { INPUT } from '@/design'
import { listOrgs } from '@services/ee/platform/api'
import { shouldRetry, useAccessToken, useDebounced } from '@components/Admin/hooks'
import { OrgLogo, PlanChip } from '@components/Admin/Shared/AdminKit'
import { Select } from './RuleBuilder'

// "Which organization (and which event)?" for running or previewing a rule by
// hand: event rules only ever act on the org in the event, so a manual run
// names that org.

export interface OrgTarget {
  org?: { id: number; name: string } | null
  eventKey?: string
}

export default function OrgTargetPicker({
  value,
  onChange,
  events,
  eventLabel,
  required,
}: {
  value: OrgTarget
  onChange: (_v: OrgTarget) => void
  /** The rule's event keys; an event select shows when there are any. */
  events?: string[]
  eventLabel?: (_key: string) => string
  required?: boolean
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const [q, setQ] = React.useState('')
  const debounced = useDebounced(q.trim(), 250)
  const orgs = useQuery({
    queryKey: ['platform', 'automations', 'org-target', debounced],
    queryFn: () => listOrgs(token, { q: debounced || undefined, limit: 8, page: 1 }),
    enabled: !!token && !value.org,
    retry: shouldRetry,
    staleTime: 30_000,
  })
  const items = Array.isArray(orgs.data?.items) ? orgs.data!.items : []
  const evs = Array.isArray(events) ? events : []

  return (
    <div className="space-y-3 min-w-0">
      <div className="min-w-0">
        <span className="mb-1 block text-xs font-semibold text-neutral-700">
          {t('admin.automations.target.org')}
          {required && <span className="text-rose-500"> *</span>}
        </span>
        {value.org ? (
          <div className="flex items-center gap-2 h-9 px-3 rounded-xl ring-1 ring-inset ring-neutral-200 min-w-0">
            <Check size={14} className="shrink-0 text-emerald-600" />
            <span className="flex-1 min-w-0 truncate text-sm text-neutral-900">{value.org.name}</span>
            <span className="text-xs text-neutral-400 tabular-nums">#{value.org.id}</span>
            <button
              type="button"
              onClick={() => onChange({ ...value, org: null })}
              aria-label={t('admin.automations.target.clear')}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <MagnifyingGlass size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('admin.automations.target.search')}
                aria-label={t('admin.automations.target.search')}
                className={`${INPUT} ps-8`}
              />
            </div>
            <div className="mt-1.5 max-h-56 overflow-y-auto divide-y divide-neutral-100 rounded-xl ring-1 ring-inset ring-neutral-100">
              {orgs.isLoading ? (
                <p className="px-3 py-2.5 text-xs text-neutral-400">{t('common.loading')}</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-2.5 text-xs text-neutral-400">{t('admin.automations.target.no_orgs')}</p>
              ) : (
                items.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onChange({ ...value, org: { id: o.id, name: o.name } })}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-start hover:bg-neutral-50 min-w-0"
                  >
                    <OrgLogo org={o} size={22} />
                    <span className="flex-1 min-w-0 truncate text-sm text-neutral-900">{o.name}</span>
                    <PlanChip plan={o.plan} />
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
      {evs.length > 0 && (
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-neutral-700">{t('admin.automations.target.event')}</span>
          <Select
            ariaLabel={t('admin.automations.target.event')}
            value={value.eventKey ?? ''}
            onChange={(v) => onChange({ ...value, eventKey: v || undefined })}
            options={[
              { value: '', label: t('admin.automations.target.any_event') },
              ...evs.map((k) => ({ value: k, label: eventLabel ? eventLabel(k) : k })),
            ]}
          />
        </label>
      )}
    </div>
  )
}
