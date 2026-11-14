'use client'
/*
 Readable rule chips for the conditional block: "Course progress ≥ 50",
 "User group is any of Team Leads". Each chip opens a small popover to edit
 that one condition; the change is committed once, when the popover closes
 (never per keystroke), so collaborators get one update per edit.
*/
import React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useTranslation } from 'react-i18next'
import { Plus, Trash } from '@phosphor-icons/react'
import { FIELD_CLASS } from '../../Blocks/ui/BlockChrome'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import {
  Condition,
  FIELDS,
  FieldType,
  OPS,
  OP_LABELS,
  ROLES,
  RuleValue,
  defaultCondition,
  defaultValue,
  fieldDef,
} from './dynamicRules'
import type { LookupOption, useDynamicLookups } from './useDynamicLookups'

export type Lookups = ReturnType<typeof useDynamicLookups>

export function useRuleText() {
  const { t } = useTranslation()
  const field = (f: string) => t(`editor.dynamic.fields.${f.replace('.', '_')}`, fieldDef(f)?.label ?? f)
  const op = (o: string) => t(`editor.dynamic.ops.${o}`, OP_LABELS[o] ?? o)
  return { field, op }
}

/** Human value for a chip: names for uuids, roles translated, ranges joined. */
export function useValueText(lookups: Lookups) {
  const { t } = useTranslation()
  return (c: Condition): string => {
    const def = fieldDef(c.field)
    if (def?.type === 'bool') return ''
    const name = (v: string | number) => {
      const key = String(v)
      if (c.field === 'user.groups') return lookups.names.usergroups[key] ?? key
      if (c.field === 'progress.completed_activities') return lookups.names.activities[key] ?? key
      if (c.field === 'assignments.submitted') return lookups.names.assignments[key] ?? key
      if (c.field === 'community.active_in') return lookups.names.communities[key] ?? key
      if (c.field === 'user.role') return t(`editor.dynamic.roles.${key}`, key)
      return key
    }
    if (c.op === 'between' && Array.isArray(c.value)) {
      return `${name(c.value[0] as any)} – ${name(c.value[1] as any)}`
    }
    const list = Array.isArray(c.value) ? c.value : c.value === undefined || c.value === null ? [] : [c.value]
    if (list.length === 0) return t('editor.blocks_v2.conditional.pick_value', 'pick…')
    const names = list.map((v) => name(v as any))
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
  }
}

const POPOVER_CONTENT =
  'max-w-[calc(100vw-24px)] rounded-xl bg-white p-3 text-[13px] text-neutral-700 shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.08)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'

/**
 * A popover that keeps a draft and hands it back once, on close. Escape
 * discards the draft instead.
 */
export function DraftPopover<T>({
  value,
  onCommit,
  trigger,
  children,
  width = 320,
  defaultOpen = false,
  onOpenChange,
}: {
  value: T
  onCommit: (_next: T) => void
  trigger: React.ReactElement
  children: (_draft: T, _setDraft: (_next: T) => void, _close: (_final?: T) => void, _cancel: () => void) => React.ReactNode
  width?: number
  defaultOpen?: boolean
  onOpenChange?: (_open: boolean) => void
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const [draft, setDraft] = React.useState<T>(value)
  // `final` lets a button commit the draft it is setting in the same click.
  const change = (next: boolean, opts: { cancel?: boolean; final?: T } = {}) => {
    if (next) setDraft(value)
    else {
      const out = opts.final ?? draft
      if (!opts.cancel && JSON.stringify(out) !== JSON.stringify(value)) onCommit(out)
    }
    setOpen(next)
    onOpenChange?.(next)
  }
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(o) => change(o)}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-popover)', width }}
          className={POPOVER_CONTENT}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            change(false, { cancel: true })
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {children(draft, setDraft, (final?: T) => change(false, { final }), () => change(false, { cancel: true }))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** Field, operator and value for one condition. */
export function ConditionEditor({
  condition,
  onChange,
  lookups,
}: {
  condition: Condition
  onChange: (_next: Condition) => void
  lookups: Lookups
}) {
  const { t } = useTranslation()
  const text = useRuleText()
  const def = fieldDef(condition.field) ?? FIELDS[0]
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500">{t('editor.blocks_v2.conditional.field', 'When the learner’s…')}</span>
        <select
          className={FIELD_CLASS}
          value={def.field}
          onChange={(e) => onChange(defaultCondition(e.target.value))}
        >
          {FIELDS.map((f) => (
            <option key={f.field} value={f.field}>
              {text.field(f.field)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('editor.blocks_v2.conditional.operator', 'Operator')}>
        {OPS[def.type].map((op) => (
          <button
            key={op}
            type="button"
            role="radio"
            aria-checked={condition.op === op}
            onClick={() => {
              const keep = (op === 'between') === (condition.op === 'between')
              onChange({ ...condition, op, value: keep ? condition.value : defaultValue(def.type, op) })
            }}
            className={cn(
              'h-7 rounded-lg px-2.5 text-xs font-medium transition-colors',
              condition.op === op ? 'bg-violet-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/70',
            )}
          >
            {text.op(op)}
          </button>
        ))}
      </div>
      <ValueInput
        field={def.field}
        type={def.type}
        picker={def.picker}
        op={condition.op}
        value={condition.value}
        lookups={lookups}
        onChange={(value) => onChange({ ...condition, value })}
      />
    </div>
  )
}

export function ValueInput(props: {
  field: string
  type: FieldType
  picker?: string
  op: string
  value: RuleValue
  lookups: Lookups
  onChange: (_value: RuleValue) => void
}) {
  const { t } = useTranslation()
  const { type, picker, op, value, onChange } = props
  if (type === 'bool') return null

  if (op === 'between') {
    const pair = Array.isArray(value) && value.length === 2 ? value : (defaultValue(type, op) as Array<string | number>)
    const [a, b] = pair as Array<string | number>
    const inputType = type === 'date' ? 'date' : 'number'
    const cast = (v: string) => (type === 'date' ? v : Number(v))
    return (
      <div className="flex items-center gap-2">
        <input type={inputType} className={FIELD_CLASS} value={a} aria-label={t('editor.blocks_v2.conditional.from', 'From')}
          onChange={(e) => onChange([cast(e.target.value), b] as any)} />
        <span className="text-xs text-neutral-400">{t('editor.dynamic.and', 'and')}</span>
        <input type={inputType} className={FIELD_CLASS} value={b} aria-label={t('editor.blocks_v2.conditional.to', 'To')}
          onChange={(e) => onChange([a, cast(e.target.value)] as any)} />
      </div>
    )
  }

  if (type === 'number') {
    return (
      <input
        type="number"
        className={FIELD_CLASS}
        aria-label={t('editor.blocks_v2.conditional.value', 'Value')}
        value={typeof value === 'number' ? value : 0}
        min={0}
        max={props.field === 'user.bucket' ? 99 : props.field === 'progress.percent' ? 100 : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  }

  if (type === 'date') {
    return (
      <input type="date" className={FIELD_CLASS} aria-label={t('editor.blocks_v2.conditional.value', 'Value')}
        value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    )
  }

  const selected = Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : []
  const options: LookupOption[] =
    picker === 'usergroups'
      ? props.lookups.usergroups
      : picker === 'activities'
        ? props.lookups.activities
        : picker === 'assignments'
          ? props.lookups.assignments
          : picker === 'communities'
            ? props.lookups.communities
            : picker === 'roles'
              ? ROLES.map((r) => ({ value: r, label: t(`editor.dynamic.roles.${r}`, r) }))
              : []

  if (options.length > 0 || picker) {
    return <MultiPicker options={options} selected={selected} onChange={onChange} />
  }

  // Free text list (languages, email domains): "fr, de"
  return (
    <FreeList
      value={selected}
      placeholder={props.field === 'user.email_domain' ? 'acme.com, partner.org' : 'fr, de, pt-BR'}
      onChange={onChange}
    />
  )
}

function FreeList({ value, placeholder, onChange }: { value: string[]; placeholder: string; onChange: (_v: string[]) => void }) {
  const { t } = useTranslation()
  // Keep the raw text while typing so "fr, " doesn't lose its comma.
  const [text, setText] = React.useState(value.join(', '))
  return (
    <input
      className={FIELD_CLASS}
      value={text}
      placeholder={placeholder}
      aria-label={t('editor.blocks_v2.conditional.value', 'Value')}
      onChange={(e) => {
        setText(e.target.value)
        onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
      }}
    />
  )
}

export function MultiPicker(props: { options: LookupOption[]; selected: string[]; onChange: (_v: string[]) => void }) {
  const { t } = useTranslation()
  const known = new Set(props.options.map((o) => o.value))
  // Keep uuids that no longer resolve visible so they can be removed.
  const options = [...props.options, ...props.selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))]
  if (options.length === 0) {
    return <p className="py-1.5 text-xs text-neutral-400">{t('editor.dynamic.nothing_to_pick', 'Nothing to pick yet.')}</p>
  }
  const toggle = (v: string) =>
    props.onChange(props.selected.includes(v) ? props.selected.filter((s) => s !== v) : [...props.selected, v])
  return (
    <div className="flex max-h-36 flex-wrap gap-1 overflow-y-auto py-0.5">
      {options.map((o) => {
        const active = props.selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(o.value)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs transition-colors',
              active ? 'bg-violet-600 text-white' : 'bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** One condition as a chip; click to edit it in place. */
export function ConditionChip({
  condition,
  lookups,
  onCommit,
  onRemove,
  readOnly,
}: {
  condition: Condition
  lookups: Lookups
  onCommit: (_next: Condition) => void
  onRemove: () => void
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const text = useRuleText()
  const valueText = useValueText(lookups)
  const chip = (draft: Condition) => (
    <>
      <span className="font-semibold text-violet-900">{text.field(draft.field)}</span>
      <span className="text-violet-700/70">{text.op(draft.op)}</span>
      {fieldDef(draft.field)?.type !== 'bool' && <span className="max-w-[14rem] truncate font-semibold text-violet-900">{valueText(draft)}</span>}
    </>
  )
  const cls =
    'inline-flex h-7 max-w-full items-center gap-1 rounded-lg bg-white px-2 text-[12px] shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(124,58,237,0.22)] transition-colors'
  if (readOnly) return <span className={cn(cls, 'opacity-80')}>{chip(condition)}</span>
  return (
    <DraftPopover
      value={condition}
      onCommit={onCommit}
      trigger={
        <button type="button" className={cn(cls, 'hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40')} data-testid="rule-chip">
          {chip(condition)}
        </button>
      }
    >
      {(draft, setDraft, close, cancel) => (
        <div className="flex flex-col gap-3">
          <ConditionEditor condition={draft} onChange={setDraft} lookups={lookups} />
          <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-2.5">
            <button
              type="button"
              onClick={() => {
                cancel()
                onRemove()
              }}
              className={buttonClass('danger-ghost', 'sm')}
            >
              <Trash size={13} />
              {t('editor.dynamic.remove_condition', 'Remove condition')}
            </button>
            <button type="button" onClick={() => close()} className={buttonClass("primary", "sm")}>
              {t('editor.blocks_v2.conditional.done', 'Done')}
            </button>
          </div>
        </div>
      )}
    </DraftPopover>
  )
}

/** "+ Add rule": edit a new condition, added on close. */
export function AddConditionChip({
  lookups,
  onAdd,
  label,
  defaultOpen,
  onOpenChange,
  extra,
}: {
  lookups: Lookups
  onAdd: (_c: Condition) => void
  label: string
  defaultOpen?: boolean
  onOpenChange?: (_open: boolean) => void
  /** Shown above the editor (quick-start presets); gets a function that closes without adding. */
  extra?: (_cancel: () => void) => React.ReactNode
}) {
  const { t } = useTranslation()
  const [fresh] = React.useState(() => ({ ...defaultCondition(), _new: true }) as Condition & { _new?: boolean })
  return (
    <DraftPopover<Condition & { _new?: boolean }>
      value={fresh}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      onCommit={(c) => {
        const { _new, ...rest } = c
        void _new
        onAdd(rest)
      }}
      trigger={
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-violet-700 hover:bg-violet-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
          data-testid="rule-add"
        >
          <Plus size={12} weight="bold" />
          {label}
        </button>
      }
    >
      {(draft, setDraft, close, cancel) => (
        <div className="flex flex-col gap-3">
          {extra?.(cancel)}
          <ConditionEditor condition={draft} onChange={(c) => setDraft({ ...c, _new: false })} lookups={lookups} />
          <div className="flex justify-end border-t border-neutral-100 pt-2.5">
            <button
              type="button"
              onClick={() => {
                // An untouched default still counts: "Add" means add it.
                close({ ...draft, _new: false })
              }}
              className={buttonClass('primary', 'sm')}
            >
              {t('editor.dynamic.add_condition', 'Add condition')}
            </button>
          </div>
        </div>
      )}
    </DraftPopover>
  )
}
