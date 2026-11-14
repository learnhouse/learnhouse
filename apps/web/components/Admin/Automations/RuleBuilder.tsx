'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, Plus, ShieldCheck, Trash } from '@phosphor-icons/react'
import { Button, INPUT, TEXTAREA } from '@/design'
import type { AutomationAction, AutomationCondition, AutomationSchema, SchemaActionParam, SchemaField } from '@services/ee/platform/types'
import { Switch } from '@components/Admin/Shared/AdminKit'
import { usePlatformMe } from '@components/Admin/hooks'
import { TAG_MAX, actionParams, previewTag } from './shared'

// Conditions (ANDed) and actions, built only from GET /automations/schema so
// the console never offers a field, operator or action the engine rejects.

const SELECT = `${INPUT} appearance-none pe-8 cursor-pointer`
const NO_VALUE_OPS = new Set(['is_true', 'is_false'])
const LIST_OPS = new Set(['in', 'not_in'])

function isNumeric(type?: string) {
  return type === 'number' || type === 'integer' || type === 'int'
}

/** Enum choices: `values` on the live API, `options` on older drafts. */
function fieldChoices(field?: SchemaField): string[] {
  const v = field?.values ?? field?.options
  return Array.isArray(v) ? v : []
}

export function Select({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
  className = '',
}: {
  value: string
  onChange: (_v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  ariaLabel: string
  className?: string
}) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${SELECT} truncate disabled:cursor-default disabled:bg-neutral-50`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown size={14} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400" />
    </div>
  )
}

/** Toggleable chips for picking several values from a fixed list. */
export function MultiPick({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: { value: string; label: string }[]
  value: string[]
  onChange: (_v: string[]) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={`h-7 px-2.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
              on ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

function defaultValue(field: SchemaField | undefined, op: string): unknown {
  if (!field || NO_VALUE_OPS.has(op)) return undefined
  if (LIST_OPS.has(op)) return []
  if (isNumeric(field.type)) return 0
  const choices = fieldChoices(field)
  if (choices.length) return choices[0]
  return ''
}

/** Tag text box that previews what the API will store (lowercase, hyphens, max 32). */
function TagInput({
  value,
  onChange,
  label,
  readOnly,
  invalid,
}: {
  value: unknown
  onChange: (_v: string) => void
  label: string
  readOnly?: boolean
  invalid?: boolean
}) {
  const { t } = useTranslation()
  const raw = String(value ?? '')
  const p = previewTag(raw)
  const bad = invalid || !p.valid
  return (
    <>
      <input
        aria-label={label}
        className={`${INPUT} ${bad ? 'ring-rose-400 focus:ring-rose-400/40' : ''}`}
        disabled={readOnly}
        value={raw}
        placeholder={t('admin.automations.builder.tag_placeholder')}
        onChange={(e) => onChange(e.target.value)}
      />
      {raw && (
        <span className="mt-1 flex items-start justify-between gap-3 text-[11px]">
          <span className="min-w-0 break-words">
            {!p.valid ? (
              <span className="text-rose-600">{t('admin.automations.builder.tag_invalid', { max: TAG_MAX })}</span>
            ) : p.changed ? (
              <span className="text-neutral-500">
                {t('admin.automations.builder.tag_saved_as')}{' '}
                <code className="font-mono text-neutral-900" dir="ltr">
                  {p.tag}
                </code>
              </span>
            ) : null}
          </span>
          <span className={`shrink-0 tabular-nums ${p.tag.length > TAG_MAX ? 'text-rose-600' : 'text-neutral-400'}`}>
            {p.tag.length}/{TAG_MAX}
          </span>
        </span>
      )}
    </>
  )
}

function ConditionValue({
  field,
  condition,
  onChange,
  readOnly,
  invalid,
}: {
  field?: SchemaField
  condition: AutomationCondition
  onChange: (_value: unknown) => void
  readOnly?: boolean
  invalid?: boolean
}) {
  const { t } = useTranslation()
  if (NO_VALUE_OPS.has(condition.op)) return null
  const label = t('admin.automations.builder.value')
  const opts = fieldChoices(field).map((o) => ({ value: o, label: t(`admin.automations.values.${o}`, { defaultValue: o }) }))
  if (LIST_OPS.has(condition.op)) {
    if (opts.length) return <MultiPick label={label} options={opts} value={toList(condition.value)} onChange={onChange} disabled={readOnly} />
    return (
      <input
        aria-label={label}
        className={INPUT}
        disabled={readOnly}
        value={toList(condition.value).join(', ')}
        placeholder={t('admin.automations.builder.comma_values')}
        onChange={(e) => onChange(toList(e.target.value))}
      />
    )
  }
  if (opts.length) {
    return <Select ariaLabel={label} value={String(condition.value ?? '')} onChange={onChange} options={opts} disabled={readOnly} />
  }
  if (isNumeric(field?.type)) {
    return (
      <input
        aria-label={label}
        type="number"
        className={`${INPUT} tabular-nums ${invalid ? 'ring-rose-400 focus:ring-rose-400/40' : ''}`}
        disabled={readOnly}
        value={condition.value === undefined || condition.value === null ? '' : String(condition.value)}
        onChange={(e) => onChange(e.target.value === '' || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))}
      />
    )
  }
  if (field?.type === 'list' || field?.type === 'tags') {
    return <TagInput label={label} value={condition.value} onChange={onChange} readOnly={readOnly} invalid={invalid} />
  }
  return (
    <input
      aria-label={label}
      className={`${INPUT} ${invalid ? 'ring-rose-400 focus:ring-rose-400/40' : ''}`}
      disabled={readOnly}
      value={String(condition.value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Data the picker params need, loaded once per editor. */
export interface PickerData {
  channels: { value: string; label: string }[]
  templates: { value: string; label: string }[]
  members: { value: string; label: string }[]
}

function useNum() {
  return (raw: string) => (raw === '' ? undefined : Number.isFinite(Number(raw)) ? Number(raw) : undefined)
}

function ParamInput({
  name,
  apiLabel,
  schema,
  value,
  onChange,
  readOnly,
  pickers,
  invalid,
}: {
  name: string
  apiLabel?: string
  schema: SchemaActionParam
  value: unknown
  onChange: (_v: unknown) => void
  readOnly?: boolean
  pickers: PickerData
  invalid?: boolean
}) {
  const { t } = useTranslation()
  const num = useNum()
  const label = t(`admin.automations.params.${name}`, { defaultValue: apiLabel || name.replace(/_/g, ' ') })
  const ring = invalid ? 'ring-rose-400 focus:ring-rose-400/40' : ''
  const none = { value: '', label: t('admin.automations.builder.none') }

  if (schema.type === 'channel') {
    const opts = pickers.channels
    const current = String(value ?? '')
    if (!opts.length && !current) {
      // No channel exists yet, so nothing can be picked: say how to create one.
      return (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('admin.automations.builder.create_channel_first')}{' '}
          <code className="font-mono" dir="ltr">
            POST /api/v1/ee/superadmin/notifications/channels
          </code>
        </p>
      )
    }
    return (
      <Select
        ariaLabel={label}
        value={current}
        onChange={(v) => onChange(v || undefined)}
        disabled={readOnly}
        options={[
          { value: '', label: opts.length ? t('admin.automations.builder.pick_channel') : t('admin.automations.builder.no_channels') },
          ...opts,
          ...(current && !opts.some((o) => o.value === current) ? [{ value: current, label: current }] : []),
        ]}
      />
    )
  }
  if (schema.type === 'email_template') {
    const opts = pickers.templates
    const current = String(value ?? '')
    return (
      <Select
        ariaLabel={label}
        value={current}
        onChange={(v) => onChange(v || undefined)}
        disabled={readOnly}
        options={[
          { value: '', label: opts.length ? t('admin.automations.builder.no_template') : t('admin.automations.builder.no_templates') },
          ...opts,
          ...(current && !opts.some((o) => o.value === current) ? [{ value: current, label: current }] : []),
        ]}
      />
    )
  }
  if (schema.type === 'user_ref') {
    const current = value === undefined || value === null ? '' : String(value)
    return (
      <Select
        ariaLabel={label}
        value={current}
        onChange={(v) => onChange(v === '' ? undefined : v === 'account_owner' ? v : Number(v))}
        disabled={readOnly}
        options={[
          none,
          { value: 'account_owner', label: t('admin.automations.builder.account_owner') },
          ...pickers.members,
          ...(current && current !== 'account_owner' && !pickers.members.some((o) => o.value === current)
            ? [{ value: current, label: t('admin.automations.user_id', { id: current }) }]
            : []),
        ]}
      />
    )
  }
  if (schema.type === 'user_ids') {
    const ids = (Array.isArray(value) ? value : []).map(String)
    if (!pickers.members.length) return <p className="text-xs text-neutral-400 py-2">{t('admin.automations.builder.no_members')}</p>
    return (
      <MultiPick
        label={label}
        options={pickers.members}
        value={ids}
        onChange={(v) => onChange(v.map(Number))}
        disabled={readOnly}
      />
    )
  }
  if (schema.enum?.length) {
    return (
      <Select
        ariaLabel={label}
        value={String(value ?? schema.enum[0])}
        onChange={onChange}
        options={schema.enum.map((o) => ({ value: o, label: t(`admin.automations.values.${o}`, { defaultValue: o }) }))}
        disabled={readOnly}
      />
    )
  }
  if (schema.type === 'boolean') {
    return <Switch checked={!!value} onChange={onChange} disabled={readOnly} label={label} />
  }
  if (schema.type === 'array') {
    const items = schema.items?.enum ?? []
    if (items.length) {
      return (
        <MultiPick
          label={label}
          options={items.map((o) => ({ value: o, label: t(`admin.roles.${o}`, { defaultValue: t(`admin.automations.values.${o}`, { defaultValue: o }) }) }))}
          value={toList(value)}
          onChange={onChange}
          disabled={readOnly}
        />
      )
    }
    return (
      <input
        aria-label={label}
        className={`${INPUT} ${ring}`}
        disabled={readOnly}
        value={toList(value).join(', ')}
        placeholder={t('admin.automations.builder.comma_values')}
        onChange={(e) => onChange(toList(e.target.value))}
      />
    )
  }
  if (isNumeric(schema.type)) {
    const hint =
      schema.min !== undefined && schema.max !== undefined ? t('admin.automations.builder.range', { min: schema.min, max: schema.max }) : undefined
    return (
      <input
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={schema.min}
        max={schema.max}
        placeholder={hint}
        className={`${INPUT} tabular-nums ${ring}`}
        disabled={readOnly}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(num(e.target.value))}
      />
    )
  }
  if (schema.type === 'tag') {
    return <TagInput label={label} value={value} onChange={onChange} readOnly={readOnly} invalid={invalid} />
  }
  if (isLongParam(name, schema)) {
    return (
      <textarea
        aria-label={label}
        rows={3}
        className={`${TEXTAREA} ${ring}`}
        disabled={readOnly}
        maxLength={schema.maxLength}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <input
      aria-label={label}
      className={`${INPUT} ${ring}`}
      disabled={readOnly}
      maxLength={schema.maxLength}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function isLongParam(name: string, schema: SchemaActionParam) {
  return schema.type === 'text' || (schema.maxLength ?? 0) > 200 || ['body', 'message'].includes(name)
}

function wideParam(name: string, schema: SchemaActionParam) {
  return isLongParam(name, schema) || schema.type === 'array' || schema.type === 'user_ids'
}

const DELETION_GUARDS = ['free_never_paid', 'not_demo', 'no_domain', 'small', 'no_course', 'idle', 'old_enough', 'no_poc', 'no_owner', 'not_kept'] as const

/** The server-side guards every scheduled deletion must pass (SPEC §11.2), shown next to the action. */
function DeletionGuards() {
  const { t } = useTranslation()
  return (
    <div className="sm:ps-7">
      <div className="flex items-start gap-2 text-xs text-neutral-600">
        <ShieldCheck size={15} weight="duotone" className="mt-px shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900">{t('admin.automations.guards.title')}</p>
          <ul className="mt-1 grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2 list-disc marker:text-neutral-300">
            {DELETION_GUARDS.map((g) => (
              <li key={g} className="ms-4">
                {t(`admin.automations.guards.${g}`)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-neutral-400">{t('admin.automations.guards.note')}</p>
        </div>
      </div>
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <span role="alert" className="mt-1 block text-xs font-medium text-rose-600">
      {message}
    </span>
  )
}

export function ConditionsEditor({
  schema,
  conditions,
  onChange,
  readOnly,
  errors = {},
}: {
  schema: AutomationSchema
  conditions: AutomationCondition[]
  onChange: (_c: AutomationCondition[]) => void
  readOnly?: boolean
  errors?: Record<number, string>
}) {
  const { t } = useTranslation()
  const fields = Array.isArray(schema.fields) ? schema.fields : []
  const fieldOpts = fields.map((f) => ({ value: f.key, label: t(`admin.automations.fields.${f.key}`, { defaultValue: f.label || f.key }) }))
  const set = (i: number, next: AutomationCondition) => onChange(conditions.map((c, j) => (j === i ? next : c)))
  const cap = schema.max_conditions && schema.max_conditions > 0 ? schema.max_conditions : 20
  const full = conditions.length >= cap

  const add = () => {
    const f = fields[0]
    if (!f) return
    const op = f.ops?.[0] ?? 'eq'
    onChange([...conditions, { field: f.key, op, value: defaultValue(f, op) }])
  }

  return (
    <div className="space-y-3">
      {conditions.length === 0 && <p className="text-sm text-neutral-500">{t('admin.automations.builder.no_conditions')}</p>}
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.key === c.field)
        const ops = field?.ops ?? [c.op]
        return (
          <div key={i} className="flex flex-col gap-2 border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 sm:w-14 sm:pt-2.5 shrink-0">
              {i === 0 ? t('admin.automations.builder.where') : t('admin.automations.builder.and')}
            </span>
            <div className="flex-1 min-w-0">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,1.3fr)]">
                <Select
                  ariaLabel={t('admin.automations.builder.field')}
                  value={c.field}
                  disabled={readOnly}
                  options={field ? fieldOpts : [{ value: c.field, label: c.field }, ...fieldOpts]}
                  onChange={(key) => {
                    const f = fields.find((x) => x.key === key)
                    const op = f?.ops?.includes(c.op) ? c.op : (f?.ops?.[0] ?? 'eq')
                    set(i, { field: key, op, value: defaultValue(f, op) })
                  }}
                />
                <Select
                  ariaLabel={t('admin.automations.builder.operator')}
                  value={c.op}
                  disabled={readOnly}
                  options={ops.map((o) => ({ value: o, label: t(`admin.automations.ops.${o}`, { defaultValue: o }) }))}
                  onChange={(op) => {
                    const keep = LIST_OPS.has(op) === LIST_OPS.has(c.op) && !NO_VALUE_OPS.has(op)
                    set(i, { ...c, op, value: keep ? c.value : defaultValue(field, op) })
                  }}
                />
                <div className="min-w-0">
                  <ConditionValue field={field} condition={c} readOnly={readOnly} invalid={!!errors[i]} onChange={(value) => set(i, { ...c, value })} />
                </div>
              </div>
              <FieldError message={errors[i]} />
            </div>
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('admin.automations.builder.remove_condition')}
                onClick={() => onChange(conditions.filter((_, j) => j !== i))}
                icon={<Trash size={14} />}
              />
            )}
          </div>
        )
      })}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" icon={<Plus size={13} weight="bold" />} onClick={add} disabled={!fields.length || full}>
            {t('admin.automations.builder.add_condition')}
          </Button>
          {full && <span className="text-xs text-neutral-400">{t('admin.automations.builder.max_conditions', { count: cap })}</span>}
        </div>
      )}
    </div>
  )
}

export function ActionsEditor({
  schema,
  actions,
  onChange,
  readOnly,
  pickers,
  errors = {},
}: {
  schema: AutomationSchema
  actions: AutomationAction[]
  onChange: (_a: AutomationAction[]) => void
  readOnly?: boolean
  pickers: PickerData
  /** action index → param key ('' = the whole action) → message */
  errors?: Record<number, Record<string, string>>
}) {
  const { t } = useTranslation()
  const types = Array.isArray(schema.actions) ? schema.actions : []
  const me = usePlatformMe()
  // Owner-only actions (schedule_org_deletion) are offered to owners; others
  // still see one that's already on the rule, marked as such.
  const isOwnerOnly = (a: object) => !!(a as { owner_only?: boolean }).owner_only
  const typeOpts = types
    .filter((a) => me.role === 'owner' || !isOwnerOnly(a) || actions.some((x) => x.type === a.type))
    .map((a) => {
      const label = t(`admin.automations.actions.${a.type}`, { defaultValue: a.label || a.type })
      return { value: a.type, label: isOwnerOnly(a) ? `${label} · ${t('admin.automations.deletion_gate.owners_only_tag')}` : label }
    })

  const defaultsFor = (type: string): Record<string, unknown> => {
    const def = types.find((a) => a.type === type)
    const out: Record<string, unknown> = {}
    for (const p of actionParams(def)) {
      if (p.schema.default !== undefined) out[p.name] = p.schema.default
      else if (p.schema.enum?.length) out[p.name] = p.schema.enum[0]
      else if (p.schema.type === 'array' || p.schema.type === 'user_ids') out[p.name] = []
      else if (p.schema.type === 'boolean') out[p.name] = false
    }
    return out
  }

  const set = (i: number, next: AutomationAction) => onChange(actions.map((a, j) => (j === i ? next : a)))
  const cap = schema.max_actions && schema.max_actions > 0 ? schema.max_actions : 10
  const full = actions.length >= cap

  return (
    <div className="space-y-3">
      {actions.length === 0 && <p className="text-sm text-neutral-500">{t('admin.automations.builder.no_actions')}</p>}
      {actions.map((a, i) => {
        const def = types.find((x) => x.type === a.type)
        const params = actionParams(def)
        const errs = errors[i] ?? {}
        return (
          <div key={i} className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 space-y-3 min-w-0">
            <div className="flex items-start gap-2 min-w-0">
              <span className="mt-2 h-5 min-w-5 px-1 shrink-0 rounded-md bg-sky-50 text-[11px] font-bold text-sky-600 flex items-center justify-center tabular-nums">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <Select
                  ariaLabel={t('admin.automations.builder.action')}
                  value={a.type}
                  disabled={readOnly}
                  options={def ? typeOpts : [{ value: a.type, label: a.type }, ...typeOpts]}
                  onChange={(type) => set(i, { type, params: defaultsFor(type) })}
                />
                {def?.description && <p className="mt-1 text-xs text-neutral-500">{def.description}</p>}
                <FieldError message={errs['']} />
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('admin.automations.builder.remove_action')}
                  onClick={() => onChange(actions.filter((_, j) => j !== i))}
                  icon={<Trash size={14} />}
                />
              )}
            </div>
            {a.type === 'schedule_org_deletion' && <DeletionGuards />}
            {params.length > 0 && (
              // minmax(0,1fr) tracks: a long option label must never widen the card.
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] sm:ps-7">
                {params.map((p) => (
                  <label key={p.name} className={`block min-w-0 ${wideParam(p.name, p.schema) ? 'sm:col-span-2' : ''}`}>
                    <span className="mb-1 block text-xs font-semibold text-neutral-700">
                      {t(`admin.automations.params.${p.name}`, { defaultValue: p.label || p.name.replace(/_/g, ' ') })}
                      {(p.required || (a.type === 'notify_channel' && p.schema.type === 'channel')) && <span className="text-rose-500"> *</span>}
                    </span>
                    <ParamInput
                      name={p.name}
                      apiLabel={p.label}
                      schema={p.schema}
                      readOnly={readOnly}
                      pickers={pickers}
                      invalid={!!errs[p.name]}
                      value={a.params?.[p.name]}
                      onChange={(v) => set(i, { ...a, params: { ...(a.params ?? {}), [p.name]: v } })}
                    />
                    <FieldError message={errs[p.name]} />
                    {p.schema.description && <span className="mt-1 block text-[11px] text-neutral-400">{p.schema.description}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            icon={<Plus size={13} weight="bold" />}
            disabled={!types.length || full}
            onClick={() => {
              const type = types[0]?.type
              if (type) onChange([...actions, { type, params: defaultsFor(type) }])
            }}
          >
            {t('admin.automations.builder.add_action')}
          </Button>
          {full && <span className="text-xs text-neutral-400">{t('admin.automations.builder.max_actions', { count: cap })}</span>}
        </div>
      )}
    </div>
  )
}
