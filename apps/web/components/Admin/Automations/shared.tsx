'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { StatusPill, type Status } from '@/design'
import { listNotificationEvents } from '@services/ee/platform/api'
import type { AutomationAction, AutomationCondition, SchemaAction, SchemaActionParam } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'

// Bits the automations list, editor and run history share.

const RUN_STATUS: Record<string, Status> = { ok: 'success', partial: 'warning', failed: 'danger', skipped: 'neutral' }

export function RunStatusPill({ status }: { status?: string | null }) {
  const { t } = useTranslation()
  if (!status) return <span className="text-xs text-neutral-300">–</span>
  return (
    <StatusPill status={RUN_STATUS[status] ?? 'neutral'} dot>
      {t(`admin.automations.run_status.${status}`, { defaultValue: status })}
    </StatusPill>
  )
}

export function DryRunPill() {
  const { t } = useTranslation()
  return (
    <StatusPill status="info" title={t('admin.automations.dry_run_hint')}>
      {t('admin.automations.dry_run')}
    </StatusPill>
  )
}

export function useScheduleLabel() {
  const { t } = useTranslation()
  return (s?: string | null) => (s ? t(`admin.automations.schedule.${s}`, { defaultValue: s }) : '–')
}

/** Event key → readable label from GET /notifications/events (falls back to the key). */
export function useEventLabels(enabled = true) {
  const token = useAccessToken()
  const q = useQuery({
    queryKey: ['platform', 'notifications', 'events'],
    queryFn: () => listNotificationEvents(token),
    enabled: enabled && !!token,
    retry: shouldRetry,
    staleTime: 30 * 60_000,
  })
  const map = React.useMemo(() => new Map((Array.isArray(q.data) ? q.data : []).map((e) => [e.key, e.label || e.key])), [q.data])
  return { label: (key: string) => map.get(key) ?? key, keys: Array.from(map.keys()) }
}

/** "Daily" for scheduled rules, "On Organization created" for event rules. */
export function useTriggerLabel() {
  const { t } = useTranslation()
  const scheduleLabel = useScheduleLabel()
  const events = useEventLabels()
  return (rule: { trigger?: string | null; event_types?: string[] | null; schedule?: string | null }) => {
    if (rule.trigger === 'event') {
      const list = Array.isArray(rule.event_types) ? rule.event_types : []
      return t('admin.automations.on_events', { events: list.map(events.label).join(', ') || '–' })
    }
    return scheduleLabel(rule.schedule)
  }
}

export const TAG_MAX = 32
const TAG_RE = /^[a-z0-9][a-z0-9_-]*$/

/** The tag the API will store (lowercase, spaces → hyphens) and whether it is accepted. */
export function previewTag(raw: string): { tag: string; valid: boolean; changed: boolean } {
  const tag = raw.trim().toLowerCase().replace(/ /g, '-')
  return { tag, valid: !tag || (tag.length <= TAG_MAX && TAG_RE.test(tag)), changed: !!raw && tag !== raw }
}

/** Actions whose channel param is empty ("Post to a channel" needs one; there is no default). */
export function actionsMissingChannel(actions?: AutomationAction[] | null): number[] {
  return (Array.isArray(actions) ? actions : []).flatMap((a, i) => (a.type === 'notify_channel' && !a.params?.channel_uuid ? [i] : []))
}

/**
 * Normalises the action params shapes into one list with JSON-schema-ish
 * types (string, text, boolean, number, array+items.enum, enum):
 * - live API: `params: [{key, type, label, required, max_length?, values?}]`
 * - `params: {name: schema}` and `params: {properties, required}`.
 */
export function actionParams(
  action?: SchemaAction | null
): { name: string; schema: SchemaActionParam; required: boolean; label?: string }[] {
  const p = action?.params as any
  if (!p || typeof p !== 'object') return []
  if (Array.isArray(p)) {
    return (p as SchemaActionParam[])
      .filter((x) => x && typeof x.key === 'string')
      .map((x) => ({ name: x.key as string, schema: normalizeParam(x, x.key as string), required: !!x.required, label: x.label }))
  }
  if (p.properties && typeof p.properties === 'object') {
    const required: string[] = Array.isArray(p.required) ? p.required : []
    return Object.entries(p.properties as Record<string, SchemaActionParam>).map(([name, schema]) => ({
      name,
      schema: normalizeParam(schema ?? {}, name),
      required: required.includes(name),
      label: schema?.label,
    }))
  }
  return Object.entries(p as Record<string, SchemaActionParam>).map(([name, schema]) => {
    const sc = (schema && typeof schema === 'object' ? schema : {}) as SchemaActionParam
    return { name, schema: normalizeParam(sc, name), required: !!sc.required, label: sc.label }
  })
}

/**
 * Picker types the builder renders itself: `channel`, `user_ref`, `user_ids`
 * and `email_template` (any `*template*` param that holds a template uuid).
 */
function normalizeParam(x: SchemaActionParam, key = ''): SchemaActionParam {
  const values = Array.isArray(x.values) ? x.values : undefined
  const out: SchemaActionParam = { ...x, maxLength: x.maxLength ?? x.max_length }
  if (x.type === 'template' || x.type === 'email_template' || ((!x.type || x.type === 'string') && /(^|_)template(_uuid)?$/.test(key))) {
    out.type = 'email_template'
    return out
  }
  switch (x.type) {
    case 'bool':
      out.type = 'boolean'
      break
    case 'int':
      out.type = 'integer'
      break
    case 'roles':
      out.type = 'array'
      out.items = { enum: values ?? x.items?.enum ?? [] }
      break
    case 'tag':
      // Kept as its own type: the builder previews the normalised tag.
      out.type = 'tag'
      break
    case 'enum':
      out.enum = x.enum ?? values
      break
  }
  if (!out.enum && values && out.type !== 'array') out.enum = values
  return out
}

function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ')
  if (v === null || v === undefined || v === '') return '…'
  return String(v)
}

/** "plan in standard, pro" style one-liners for a rule summary. */
export function useRuleSummary() {
  const { t } = useTranslation()
  const condition = (c: AutomationCondition) => {
    const op = t(`admin.automations.ops.${c.op}`, { defaultValue: c.op })
    const field = t(`admin.automations.fields.${c.field}`, { defaultValue: c.field })
    if (c.op === 'is_true' || c.op === 'is_false') return `${field} ${op}`
    return `${field} ${op} ${valueText(c.value)}`
  }
  const action = (a: AutomationAction) => t(`admin.automations.actions.${a.type}`, { defaultValue: a.type })
  return { condition, action }
}
