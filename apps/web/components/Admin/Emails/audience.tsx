'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  At,
  BookOpen,
  CalendarBlank,
  CheckSquareOffset,
  CreditCard,
  CurrencyCircleDollar,
  Eye,
  Globe,
  Heartbeat,
  Hourglass,
  Moon,
  Pulse,
  Tag,
  UserCircle,
  Users,
} from '@phosphor-icons/react'
import { getDeploymentMode } from '@services/config/config'
import { LIFECYCLES } from '@services/ee/platform/types'
import type { CampaignAudience } from '@services/ee/platform/ops'
import { resolveDate, type FilterDef, type FilterValues } from '@components/Admin/Shared/FilterBar'
import { useTeamList } from '@components/Admin/Shared/OpsKit'

// A campaign's audience is built with the same filters as the Organizations
// list (only the keys the campaigns API accepts). The FilterBar works on
// strings; the API wants numbers and real booleans, and a typo there must
// never widen a mass email, so conversion is strict both ways.

export const AUDIENCE_KEYS = [
  'q',
  'plan',
  'lifecycle',
  'tag',
  'created_since',
  'created_until',
  'members_min',
  'members_max',
  'courses_min',
  'courses_max',
  'health_min',
  'health_max',
  'has_custom_domain',
  'poc_ending_within_days',
  'inactive_days_min',
  'account_owner_user_id',
  'email_domain',
  'has_payments',
  'followers_min',
  'has_open_tasks',
] as const

const INT_KEYS = new Set([
  'members_min',
  'members_max',
  'courses_min',
  'courses_max',
  'health_min',
  'health_max',
  'poc_ending_within_days',
  'inactive_days_min',
  'account_owner_user_id',
  'followers_min',
])
const BOOL_KEYS = new Set(['has_custom_domain', 'has_payments', 'has_open_tasks'])

/** FilterBar strings → the API's typed `audience.filters` (unknown keys dropped). */
export function valuesToFilters(values: FilterValues): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const k of AUDIENCE_KEYS) {
    const v = values[k]?.trim()
    if (!v) continue
    if (BOOL_KEYS.has(k)) {
      if (v === 'true' || v === 'false') out[k] = v === 'true'
    } else if (INT_KEYS.has(k)) {
      const n = Number(v)
      if (Number.isInteger(n) && n >= 0) out[k] = n
    } else if (k === 'created_since' || k === 'created_until') {
      // Presets (7d…) are pinned to a date when the campaign is saved.
      const d = resolveDate(v, k === 'created_until')
      if (d) out[k] = d.slice(0, 10)
    } else out[k] = v
  }
  return out
}

/** The reverse, to edit a saved campaign's audience in the FilterBar. */
export function filtersToValues(audience?: CampaignAudience | null): FilterValues {
  const out: FilterValues = {}
  const f = audience?.filters ?? {}
  for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '') out[k] = String(v)
  return out
}

export function useAudienceDefs(): FilterDef[] {
  const { t } = useTranslation()
  const team = useTeamList()
  const isSaaS = getDeploymentMode() === 'saas'
  return React.useMemo<FilterDef[]>(
    () => [
      {
        kind: 'select',
        key: 'plan',
        label: t('admin.orgs.filters.plan'),
        icon: <CreditCard size={14} />,
        hidden: !isSaaS,
        options: ['free', 'paid', 'standard', 'pro', 'enterprise'].map((p) => ({ value: p, label: t(`admin.org_list.plan_${p}`) })),
      },
      {
        kind: 'select',
        key: 'lifecycle',
        label: t('admin.orgs.filters.lifecycle'),
        icon: <Pulse size={14} />,
        options: LIFECYCLES.map((l) => ({ value: l, label: t(`admin.lifecycle.${l}`) })),
      },
      { kind: 'text', key: 'tag', label: t('admin.orgs.filters.tag'), icon: <Tag size={14} />, placeholder: t('admin.orgs.filters.tag_placeholder') },
      { kind: 'range', key: 'members', minKey: 'members_min', maxKey: 'members_max', label: t('admin.orgs.filters.members'), icon: <Users size={14} /> },
      { kind: 'range', key: 'courses', minKey: 'courses_min', maxKey: 'courses_max', label: t('admin.orgs.filters.courses'), icon: <BookOpen size={14} /> },
      { kind: 'range', key: 'health', minKey: 'health_min', maxKey: 'health_max', label: t('admin.common.health'), icon: <Heartbeat size={14} /> },
      { kind: 'boolean', key: 'has_custom_domain', label: t('admin.orgs.filters.custom_domain'), icon: <Globe size={14} /> },
      {
        kind: 'number',
        key: 'poc_ending_within_days',
        label: t('admin.orgs.filters.poc_ending'),
        icon: <Hourglass size={14} />,
        min: 0,
        suffix: t('admin.orgs.filters.days'),
        placeholder: '7',
      },
      { kind: 'number', key: 'inactive_days_min', label: t('admin.orgs.filters.inactive'), icon: <Moon size={14} />, min: 1, suffix: t('admin.orgs.filters.days'), placeholder: '30' },
      {
        kind: 'select',
        key: 'account_owner_user_id',
        label: t('admin.orgs.col_owner'),
        icon: <UserCircle size={14} />,
        options: team.members.map((m) => ({ value: String(m.user_id), label: m.username })),
      },
      { kind: 'date', key: 'created', sinceKey: 'created_since', untilKey: 'created_until', label: t('admin.orgs.filters.created'), icon: <CalendarBlank size={14} /> },
      { kind: 'text', key: 'email_domain', label: t('admin.orgs.filters.email_domain'), icon: <At size={14} />, placeholder: 'acme.com' },
      { kind: 'boolean', key: 'has_payments', label: t('admin.orgs.filters.has_payments'), icon: <CurrencyCircleDollar size={14} /> },
      { kind: 'number', key: 'followers_min', label: t('admin.emails.audience.followers_min'), icon: <Eye size={14} />, min: 1, placeholder: '1' },
      { kind: 'boolean', key: 'has_open_tasks', label: t('admin.emails.audience.has_open_tasks'), icon: <CheckSquareOffset size={14} /> },
    ],
    [t, team.members, isSaaS]
  )
}
