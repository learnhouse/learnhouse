'use client'
import React, { useMemo, useState } from 'react'
import { Code2, Plus, Trash2, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Condition,
  FIELDS,
  OPS,
  OP_LABELS,
  ROLES,
  RuleGroup,
  RuleSyntaxError,
  RuleValue,
  defaultCondition,
  defaultValue,
  describeRules,
  fieldDef,
  isFlatGroup,
  isGroup,
  parseRules,
  stringifyRules,
} from './dynamicRules'
import type { LookupOption, useDynamicLookups } from './useDynamicLookups'

interface RuleBuilderProps {
  rules: RuleGroup
  label: string
  hiddenMessage: string
  lookups: ReturnType<typeof useDynamicLookups>
  onSave: (rules: RuleGroup, meta: { label: string; hiddenMessage: string }) => void
  onClose: () => void
}

type Mode = 'visual' | 'code'

export default function RuleBuilder({ rules, label, hiddenMessage, lookups, onSave, onClose }: RuleBuilderProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<RuleGroup>(() => structuredClone(rules))
  const [draftLabel, setDraftLabel] = useState(label)
  const [draftMessage, setDraftMessage] = useState(hiddenMessage)
  // Nested groups can only be written in code mode.
  const [mode, setMode] = useState<Mode>(isFlatGroup(rules) ? 'visual' : 'code')
  const [code, setCode] = useState(() => stringifyRules(rules))
  const [codeError, setCodeError] = useState<string | null>(null)

  const switchMode = (next: Mode) => {
    if (next === mode) return
    if (next === 'code') {
      setCode(stringifyRules(draft))
      setCodeError(null)
      setMode('code')
      return
    }
    try {
      const parsed = parseRules(code)
      if (!isFlatGroup(parsed)) {
        setCodeError(t('editor.dynamic.nested_needs_code', 'Nested groups can only be edited in code mode.'))
        return
      }
      setDraft(parsed)
      setMode('visual')
    } catch (e) {
      setCodeError(e instanceof RuleSyntaxError ? e.message : String(e))
    }
  }

  const save = () => {
    const meta = { label: draftLabel.trim(), hiddenMessage: draftMessage.trim() }
    if (mode === 'visual') return onSave(draft, meta)
    try {
      onSave(parseRules(code), meta)
    } catch (e) {
      setCodeError(e instanceof RuleSyntaxError ? e.message : String(e))
    }
  }

  const previewRules = useMemo(() => {
    if (mode === 'visual') return draft
    try {
      return parseRules(code)
    } catch {
      return null
    }
  }, [mode, draft, code])

  const updateCondition = (index: number, next: Condition) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, i) => (i === index ? next : c)) }))

  const content = (
    <div className="space-y-4 p-1 text-sm">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2"
          value={draftLabel}
          maxLength={80}
          placeholder={t('editor.dynamic.label_placeholder', 'Name this block (only authors see it), e.g. Advanced track')}
          onChange={(e) => setDraftLabel(e.target.value)}
        />
        <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
          <ModeTab active={mode === 'visual'} onClick={() => switchMode('visual')}>
            <Wand2 size={13} /> {t('editor.dynamic.visual', 'Visual')}
          </ModeTab>
          <ModeTab active={mode === 'code'} onClick={() => switchMode('code')}>
            <Code2 size={13} /> {t('editor.dynamic.code', 'Code')}
          </ModeTab>
        </div>
      </div>

      {mode === 'visual' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-gray-600">
            <select
              className="rounded-lg border border-gray-200 px-2 py-1.5"
              value={draft.negate ? 'hide' : 'show'}
              onChange={(e) => setDraft((d) => ({ ...d, negate: e.target.value === 'hide' }))}
            >
              <option value="show">{t('editor.dynamic.show_when', 'Show this content when')}</option>
              <option value="hide">{t('editor.dynamic.hide_when', 'Hide this content when')}</option>
            </select>
            <select
              className="rounded-lg border border-gray-200 px-2 py-1.5"
              value={draft.match ?? 'all'}
              onChange={(e) => setDraft((d) => ({ ...d, match: e.target.value as 'all' | 'any' }))}
            >
              <option value="all">{t('editor.dynamic.match_all', 'all of these are true')}</option>
              <option value="any">{t('editor.dynamic.match_any', 'any of these is true')}</option>
            </select>
          </div>

          {draft.conditions.length === 0 && (
            <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-gray-400">
              {t('editor.dynamic.no_conditions', 'No conditions yet: everyone sees this content.')}
            </p>
          )}

          {draft.conditions.map((condition, index) =>
            isGroup(condition) ? null : (
              <ConditionRow
                key={index}
                condition={condition}
                lookups={lookups}
                onChange={(next) => updateCondition(index, next)}
                onRemove={() =>
                  setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, i) => i !== index) }))
                }
              />
            )
          )}

          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, conditions: [...d.conditions, defaultCondition()] }))}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-violet-700 hover:bg-violet-50"
          >
            <Plus size={14} /> {t('editor.dynamic.add_condition', 'Add condition')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            className="h-40 w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs"
            value={code}
            spellCheck={false}
            onChange={(e) => {
              setCode(e.target.value)
              setCodeError(null)
            }}
            placeholder={'user.groups contains_any ["usergroup_…"] and progress.percent gte 50'}
          />
          {codeError && <p className="text-xs text-red-600">{codeError}</p>}
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer">{t('editor.dynamic.code_reference', 'Fields and operators')}</summary>
            <ul className="mt-2 space-y-1 font-mono">
              {FIELDS.map((f) => (
                <li key={f.field}>
                  <span className="text-violet-700">{f.field}</span> {OPS[f.type].join(' | ')}
                </li>
              ))}
              <li className="pt-1 font-sans">
                {t('editor.dynamic.code_combine', 'Combine with and, or, not and parentheses. Values: "text", 12, ["a", "b"], "2026-01-31".')}
              </li>
            </ul>
          </details>
        </div>
      )}

      <div className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
        <span className="font-semibold">{t('editor.dynamic.visible_to', 'Visible to')}:</span>{' '}
        {previewRules ? describeRules(previewRules, lookups.names) : '…'}
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">
          {t('editor.dynamic.hidden_message', 'Message for everyone else (optional)')}
        </label>
        <input
          className="w-full rounded-lg border border-gray-200 px-3 py-2"
          value={draftMessage}
          maxLength={300}
          placeholder={t('editor.dynamic.hidden_message_placeholder', 'e.g. This section unlocks after your first week.')}
          onChange={(e) => setDraftMessage(e.target.value)}
        />
        <p className="mt-1 text-xs text-gray-400">
          {t('editor.dynamic.hidden_message_hint', 'Shown as a note in place of the block. Variables work here too.')}
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-100">
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700"
        >
          {t('common.save', 'Save')}
        </button>
      </div>
    </div>
  )

  return (
    <Modal
      isDialogOpen
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('editor.dynamic.rules_title', 'Who sees this content?')}
      dialogDescription={t(
        'editor.dynamic.rules_description',
        'Rules run on the server: learners who do not match never receive this content.'
      )}
      minWidth="md"
      dialogContent={content}
    />
  )
}

function ModeTab(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${
        props.active ? 'bg-white font-semibold text-gray-900 shadow-sm' : 'text-gray-500'
      }`}
    >
      {props.children}
    </button>
  )
}

function ConditionRow(props: {
  condition: Condition
  lookups: RuleBuilderProps['lookups']
  onChange: (next: Condition) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const { condition, onChange } = props
  const def = fieldDef(condition.field) ?? FIELDS[0]
  const ops = OPS[def.type]

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2">
      <select
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5"
        value={def.field}
        onChange={(e) => onChange(defaultCondition(e.target.value))}
      >
        {FIELDS.map((f) => (
          <option key={f.field} value={f.field}>
            {t(`editor.dynamic.fields.${f.field.replace('.', '_')}`, f.label)}
          </option>
        ))}
      </select>
      <select
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5"
        value={condition.op}
        onChange={(e) => {
          const op = e.target.value
          const keepValue = (op === 'between') === (condition.op === 'between')
          onChange({ ...condition, op, value: keepValue ? condition.value : defaultValue(def.type, op) })
        }}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {t(`editor.dynamic.ops.${op}`, OP_LABELS[op] ?? op)}
          </option>
        ))}
      </select>
      <div className="min-w-[180px] flex-1">
        <ValueInput
          field={def.field}
          type={def.type}
          picker={def.picker}
          op={condition.op}
          value={condition.value}
          lookups={props.lookups}
          onChange={(value) => onChange({ ...condition, value })}
        />
      </div>
      <button
        type="button"
        onClick={props.onRemove}
        className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
        aria-label={t('editor.dynamic.remove_condition', 'Remove condition')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function ValueInput(props: {
  field: string
  type: string
  picker?: string
  op: string
  value: RuleValue
  lookups: RuleBuilderProps['lookups']
  onChange: (value: RuleValue) => void
}) {
  const { t } = useTranslation()
  const { type, picker, op, value, onChange } = props

  if (type === 'bool') return null

  if (op === 'between') {
    const pair = Array.isArray(value) && value.length === 2 ? value : defaultValue(type as any, op)
    const [a, b] = pair as Array<string | number>
    const inputType = type === 'date' ? 'date' : 'number'
    const cast = (v: string) => (type === 'date' ? v : Number(v))
    return (
      <div className="flex items-center gap-2">
        <input type={inputType} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" value={a}
          onChange={(e) => onChange([cast(e.target.value), b] as any)} />
        <span className="text-gray-400">{t('editor.dynamic.and', 'and')}</span>
        <input type={inputType} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" value={b}
          onChange={(e) => onChange([a, cast(e.target.value)] as any)} />
      </div>
    )
  }

  if (type === 'number') {
    return (
      <input type="number" className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
        value={typeof value === 'number' ? value : 0} min={0}
        max={props.field === 'user.bucket' ? 99 : props.field === 'progress.percent' ? 100 : undefined}
        onChange={(e) => onChange(Number(e.target.value))} />
    )
  }

  if (type === 'date') {
    return (
      <input type="date" className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)} />
    )
  }

  const selected = Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : []
  const options: LookupOption[] =
    picker === 'usergroups'
      ? props.lookups.usergroups
      : picker === 'activities'
        ? props.lookups.activities
        : picker === 'roles'
          ? ROLES.map((r) => ({ value: r, label: t(`editor.dynamic.roles.${r}`, r) }))
          : []

  if (options.length > 0 || picker) {
    return <MultiPicker options={options} selected={selected} onChange={onChange} />
  }

  // Free text list (languages): "fr, de"
  return (
    <input
      className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
      value={selected.join(', ')}
      placeholder={props.field === 'user.email_domain' ? 'acme.com, partner.org' : 'fr, de, pt-BR'}
      onChange={(e) =>
        onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
      }
    />
  )
}

function MultiPicker(props: { options: LookupOption[]; selected: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation()
  const known = new Set(props.options.map((o) => o.value))
  // Keep uuids that no longer resolve visible so they can be removed.
  const options = [
    ...props.options,
    ...props.selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })),
  ]
  if (options.length === 0) {
    return <p className="py-1.5 text-xs text-gray-400">{t('editor.dynamic.nothing_to_pick', 'Nothing to pick yet.')}</p>
  }
  const toggle = (v: string) =>
    props.onChange(props.selected.includes(v) ? props.selected.filter((s) => s !== v) : [...props.selected, v])
  return (
    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto py-0.5">
      {options.map((o) => {
        const active = props.selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              active ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
