'use client'
import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleNotch, Lightning, Plus, Trash, UsersThree } from '@phosphor-icons/react'
import { Button, INPUT, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useDebounced } from '../usersUi'
import { personName, useRuleOptions, useUG, type Condition, type Rules } from './groupsApi'
import { Avatar } from './ugUi'

// Condition types, in the order the picker groups them.
const GROUPS: { key: string; types: string[] }[] = [
  { key: 'people', types: ['email_domain', 'role', 'signup_field', 'people_field', 'tag', 'company', 'scim_group', 'in_group'] },
  { key: 'learning', types: ['enrolled', 'completed', 'progress_at_least', 'progress_below', 'path_enrolled', 'path_completed'] },
  { key: 'dates', types: ['joined_after', 'joined_before', 'joined_within_days', 'active_within_days', 'inactive_days'] },
]
const DEFAULTS: Record<string, Partial<Condition>> = {
  email_domain: { values: [] },
  role: { role_ids: [] },
  progress_at_least: { pct: 50 },
  progress_below: { pct: 50 },
  joined_within_days: { days: 30 },
  active_within_days: { days: 14 },
  inactive_days: { days: 30 },
  people_field: { field: 'department', value: '' },
}

export function emptyRules(): Rules {
  return { match: 'all', conditions: [{ type: 'email_domain', values: [] }] }
}

/** Conditions that still miss a required value (not sent for preview). */
export function incomplete(c: Condition): boolean {
  switch (c.type) {
    case 'email_domain':
      return !(c.values || []).length
    case 'role':
      return !(c.role_ids || []).length
    case 'signup_field':
      return !c.key
    case 'enrolled':
    case 'completed':
    case 'progress_at_least':
    case 'progress_below':
      return !c.course_uuid
    case 'path_enrolled':
    case 'path_completed':
      return !c.path_uuid
    case 'company':
      return !c.company_uuid
    case 'scim_group':
      return !c.scim_id
    case 'in_group':
      return !c.usergroup_uuid
    case 'joined_after':
    case 'joined_before':
      return !c.date
    default:
      return false
  }
}

export default function RuleBuilder({
  value,
  onChange,
  groupId,
}: {
  value: Rules
  onChange: (_r: Rules) => void
  groupId?: number
}) {
  const { t } = useTranslation()
  const { data: options } = useRuleOptions()
  const { call, orgId } = useUG()
  const rules = value ?? emptyRules()
  const complete = useMemo(
    () => ({ match: rules.match, conditions: rules.conditions.filter((c) => !incomplete(c)) }),
    [rules]
  )
  const debounced = useDebounced(JSON.stringify(complete), 400)
  const body = JSON.parse(debounced)
  const { data: preview, isFetching: loading, isError } = useQuery({
    queryKey: ['usergroups', 'v2', orgId, 'rule-preview', groupId ?? 0, debounced],
    queryFn: () =>
      body.conditions.length
        ? call<{ count: number; sample: any[] }>('POST', `org/${orgId}/rules/preview`, { rules: body, usergroup_id: groupId })
        : Promise.resolve({ count: 0, sample: [] }),
    placeholderData: (p) => p,
    staleTime: 10_000,
  })

  const update = (i: number, patch: Partial<Condition>) =>
    onChange({ ...rules, conditions: rules.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const setType = (i: number, type: string) =>
    onChange({ ...rules, conditions: rules.conditions.map((c, j) => (j === i ? { type, ...(DEFAULTS[type] ?? {}) } : c)) })
  const remove = (i: number) => onChange({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) })
  const add = () => onChange({ ...rules, conditions: [...rules.conditions, { type: 'email_domain', values: [] }] })

  const available = (type: string) => {
    if (type === 'company') return (options?.companies ?? []).length > 0
    if (type === 'scim_group') return (options?.scim_groups ?? []).length > 0
    return true
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span>{t('groups.rules.match_prefix')}</span>
        <SegmentedControl<'all' | 'any'>
          value={rules.match}
          onChange={(m) => onChange({ ...rules, match: m })}
          options={[
            { key: 'all', label: t('groups.rules.match_all') },
            { key: 'any', label: t('groups.rules.match_any') },
          ]}
          ariaLabel={t('groups.rules.match_prefix')}
        />
        <span>{t('groups.rules.match_suffix')}</span>
      </div>

      <ul className="flex flex-col gap-2">
        {rules.conditions.map((c, i) => (
          <li key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 p-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-neutral-400 w-10 shrink-0 text-center">
                {i === 0 ? t('groups.rules.where') : rules.match === 'all' ? t('groups.rules.and') : t('groups.rules.or')}
              </span>
              <select
                aria-label={t('groups.rules.condition')}
                value={c.type}
                onChange={(e) => setType(i, e.target.value)}
                className={`${INPUT} sm:w-56 cursor-pointer`}
              >
                {GROUPS.map((g) => (
                  <optgroup key={g.key} label={t(`groups.rules.groups.${g.key}`)}>
                    {g.types.filter(available).map((type) => (
                      <option key={type} value={type}>
                        {t(`groups.rules.types.${type}`)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select
                aria-label={t('groups.rules.negate')}
                value={c.negate ? 'not' : 'is'}
                onChange={(e) => update(i, { negate: e.target.value === 'not' })}
                className={`${INPUT} w-24 shrink-0 cursor-pointer`}
              >
                <option value="is">{t('groups.rules.is')}</option>
                <option value="not">{t('groups.rules.is_not')}</option>
              </select>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <ConditionValue c={c} options={options} onChange={(patch) => update(i, patch)} />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={t('groups.rules.remove')}
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
              >
                <Trash size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" icon={<Plus size={13} />} onClick={add} disabled={rules.conditions.length >= 20}>
          {t('groups.rules.add')}
        </Button>
        <div className="flex items-center gap-2 rounded-xl bg-violet-50 ring-1 ring-inset ring-violet-600/10 px-3 py-1.5" aria-live="polite">
          {loading ? (
            <CircleNotch size={14} className="animate-spin text-violet-600" />
          ) : (
            <Lightning size={14} weight="fill" className="text-violet-600" />
          )}
          <span className="text-sm font-semibold text-violet-900 tabular-nums">
            {preview && !isError ? t('groups.rules.preview_count', { count: preview.count }) : t('groups.rules.preview_unknown')}
          </span>
          {preview && preview.sample.length > 0 && (
            <span className="flex items-center -space-x-1.5 rtl:space-x-reverse ms-1">
              {preview.sample.slice(0, 5).map((p: any) => (
                <span key={p.id} title={personName(p)} className="rounded-full ring-2 ring-violet-50">
                  <Avatar person={p} size={20} />
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      {rules.conditions.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-neutral-500">
          <UsersThree size={14} /> {t('groups.rules.empty_hint')}
        </p>
      )}
    </div>
  )
}

function ConditionValue({ c, options, onChange }: { c: Condition; options: any; onChange: (_p: Partial<Condition>) => void }) {
  const { t } = useTranslation()
  const select = (field: string, items: { value: string; label: string }[], placeholder: string) => (
    <select
      value={c[field] ?? ''}
      onChange={(e) => onChange({ [field]: e.target.value })}
      className={`${INPUT} cursor-pointer min-w-0`}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {items.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
  const number = (field: string, suffix: string, max: number) => (
    <span className="flex items-center gap-2 min-w-0">
      <input
        type="number"
        min={1}
        max={max}
        value={c[field] ?? ''}
        onChange={(e) => onChange({ [field]: e.target.value === '' ? '' : Number(e.target.value) })}
        className={`${INPUT} w-24`}
        aria-label={suffix}
      />
      <span className="text-sm text-neutral-500 whitespace-nowrap">{suffix}</span>
    </span>
  )
  const courses = (options?.courses ?? []).map((x: any) => ({ value: x.uuid, label: x.name }))
  const paths = (options?.paths ?? []).map((x: any) => ({ value: x.uuid, label: x.name }))

  switch (c.type) {
    case 'email_domain':
      return (
        <input
          className={INPUT}
          placeholder={t('groups.rules.placeholders.domains')}
          defaultValue={(c.values || []).join(', ')}
          onBlur={(e) => onChange({ values: e.target.value.split(/[\s,]+/).map((v) => v.trim().replace(/^@/, '')).filter(Boolean) })}
          aria-label={t('groups.rules.types.email_domain')}
        />
      )
    case 'role':
      return (
        <select
          value={String((c.role_ids || [])[0] ?? '')}
          onChange={(e) => onChange({ role_ids: e.target.value ? [Number(e.target.value)] : [] })}
          className={`${INPUT} cursor-pointer`}
          aria-label={t('groups.rules.placeholders.role')}
        >
          <option value="">{t('groups.rules.placeholders.role')}</option>
          {(options?.roles ?? []).map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )
    case 'signup_field':
      return (
        <span className="flex gap-2 flex-1 min-w-0">
          {select('key', (options?.signup_fields ?? []).map((f: any) => ({ value: f.key, label: f.label })), t('groups.rules.placeholders.field'))}
          <input
            className={INPUT}
            placeholder={t('groups.rules.placeholders.answer')}
            value={c.value ?? ''}
            onChange={(e) => onChange({ value: e.target.value })}
            aria-label={t('groups.rules.placeholders.answer')}
          />
        </span>
      )
    case 'people_field': {
      const values: string[] = options?.people_fields?.[c.field || 'department'] ?? []
      return (
        <span className="flex gap-2 flex-1 min-w-0">
          {select(
            'field',
            ['department', 'title', 'location', 'cost_center', 'employment_status'].map((f) => ({ value: f, label: t(`groups.rules.people_fields.${f}`) })),
            t('groups.rules.placeholders.field')
          )}
          <input
            className={INPUT}
            list={`pf-${c.field}`}
            placeholder={t('groups.rules.placeholders.value')}
            value={c.value ?? ''}
            onChange={(e) => onChange({ value: e.target.value })}
            aria-label={t('groups.rules.placeholders.value')}
          />
          <datalist id={`pf-${c.field}`}>
            {values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </span>
      )
    }
    case 'tag':
      return (
        <input className={INPUT} placeholder={t('groups.rules.placeholders.tag')} value={c.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} aria-label={t('groups.rules.types.tag')} />
      )
    case 'enrolled':
    case 'completed':
      return select('course_uuid', courses, t('groups.rules.placeholders.course'))
    case 'progress_at_least':
    case 'progress_below':
      return (
        <span className="flex gap-2 flex-1 min-w-0">
          {select('course_uuid', courses, t('groups.rules.placeholders.course'))}
          <input
            type="number"
            min={0}
            max={100}
            value={c.pct ?? ''}
            onChange={(e) => onChange({ pct: Number(e.target.value) })}
            className={`${INPUT} w-20 shrink-0`}
            aria-label="%"
          />
          <span className="self-center text-sm text-neutral-500">%</span>
        </span>
      )
    case 'path_enrolled':
    case 'path_completed':
      return select('path_uuid', paths, t('groups.rules.placeholders.path'))
    case 'company':
      return select('company_uuid', (options?.companies ?? []).map((x: any) => ({ value: x.uuid, label: x.name })), t('groups.rules.placeholders.company'))
    case 'scim_group':
      return select('scim_id', (options?.scim_groups ?? []).map((x: any) => ({ value: x.scim_id, label: x.name })), t('groups.rules.placeholders.scim'))
    case 'in_group':
      return select('usergroup_uuid', (options?.groups ?? []).map((x: any) => ({ value: x.uuid, label: x.name })), t('groups.rules.placeholders.group'))
    case 'joined_after':
    case 'joined_before':
      return <input type="date" className={INPUT} value={c.date ?? ''} onChange={(e) => onChange({ date: e.target.value })} aria-label={t(`groups.rules.types.${c.type}`)} />
    case 'joined_within_days':
    case 'active_within_days':
    case 'inactive_days':
      return number('days', t('groups.rules.days'), 3650)
    default:
      return null
  }
}
