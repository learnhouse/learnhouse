'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Buildings, CreditCard } from '@phosphor-icons/react'
import { resolveDate, type FilterDef, type FilterValues } from '@components/Admin/Shared/FilterBar'
import { listOrgs } from '@services/ee/platform/api'
import { PLANS, type AutomationRun, type RunMini } from '@services/ee/platform/types'
import { useAccessToken } from '@components/Admin/hooks'

// Filters for run lists (a rule's run history, the recent runs card). Their
// URL keys carry a prefix so they never collide with the page's own params.

export const RUN_STATUSES = ['ok', 'partial', 'failed', 'skipped'] as const
export const RUN_TRIGGERS = ['schedule', 'manual', 'preview'] as const
const KEYS = ['status', 'trigger', 'dry', 'since', 'until', 'org', 'plan'] as const

export interface RunParams {
  status?: string
  trigger?: string
  dry_run?: string
  since?: string
  until?: string
  org_id?: string
  org_plan?: string
}

export function useRunFilterDefs(prefix: string): FilterDef[] {
  const { t } = useTranslation()
  const token = useAccessToken()
  return [
    {
      key: `${prefix}status`,
      kind: 'select',
      label: t('admin.automations.filter_status'),
      options: RUN_STATUSES.map((s) => ({ value: s, label: t(`admin.automations.run_status.${s}`) })),
    },
    {
      key: `${prefix}trigger`,
      kind: 'select',
      label: t('admin.automations.filter_trigger'),
      options: RUN_TRIGGERS.map((s) => ({ value: s, label: t(`admin.automations.trigger.${s}`) })),
    },
    { key: `${prefix}dry`, kind: 'boolean', label: t('admin.automations.dry_run') },
    {
      key: `${prefix}org`,
      kind: 'async',
      label: t('admin.automations.filter_org'),
      icon: <Buildings size={14} />,
      placeholder: t('admin.automations.filter_org_search'),
      describe: (v) => `#${v}`,
      load: async (q) => {
        const res = await listOrgs(token, { q, limit: 10, page: 1 })
        return (Array.isArray(res?.items) ? res.items : []).map((o) => ({ value: String(o.id), label: o.name }))
      },
    },
    {
      key: `${prefix}plan`,
      kind: 'select',
      label: t('admin.automations.filter_org_plan'),
      icon: <CreditCard size={14} />,
      options: [
        ...PLANS.map((p) => ({ value: p, label: t(`admin.plans.${p}`) })),
        { value: 'paid', label: t('admin.org_list.plan_paid') },
      ],
    },
    { key: `${prefix}started`, kind: 'date', label: t('admin.automations.filter_started'), sinceKey: `${prefix}since`, untilKey: `${prefix}until` },
  ]
}

/** The API params for the run filters currently in the URL. */
export function runParams(values: FilterValues, prefix: string): RunParams {
  return {
    status: values[`${prefix}status`] || undefined,
    trigger: values[`${prefix}trigger`] || undefined,
    dry_run: values[`${prefix}dry`] || undefined,
    since: resolveDate(values[`${prefix}since`]),
    until: resolveDate(values[`${prefix}until`], true),
    org_id: values[`${prefix}org`] || undefined,
    org_plan: values[`${prefix}plan`] || undefined,
  }
}

/** The same params as a stable cache key (presets stay as `7d`, not a moving timestamp). */
export function runKey(values: FilterValues, prefix: string) {
  return KEYS.map((k) => values[`${prefix}${k}`] ?? '')
}

/** Every URL key the run filters write, for "clear filters". */
export function runUrlKeys(prefix: string): string[] {
  return KEYS.map((k) => `${prefix}${k}`)
}

/**
 * Client-side fallback for APIs that ignore the filters. Org filters can only
 * be checked when the run carries its per-org results.
 */
export function matchRun(run: RunMini | AutomationRun, p: RunParams): boolean {
  if (p.status && !p.status.split(',').includes(run.status)) return false
  if (p.trigger && !p.trigger.split(',').includes(run.trigger)) return false
  if (p.dry_run && String(!!run.dry_run) !== p.dry_run) return false
  const at = new Date(run.started_at).getTime()
  if (p.since && !(at >= new Date(p.since).getTime())) return false
  if (p.until && !(at <= new Date(p.until).getTime())) return false
  const results = (run as AutomationRun).results
  if (Array.isArray(results)) {
    if (p.org_id && !results.some((r) => String(r.org_id) === p.org_id)) return false
    if (p.org_plan) {
      const plans = p.org_plan.split(',')
      const ok = results.some((r) => {
        const plan = (r as { plan?: string }).plan
        return !!plan && (plans.includes(plan) || (plans.includes('paid') && plan !== 'free'))
      })
      if (!ok) return false
    }
  }
  return true
}

export function hasRunFilters(p: RunParams): boolean {
  return !!(p.status || p.trigger || p.dry_run || p.since || p.until || p.org_id || p.org_plan)
}
