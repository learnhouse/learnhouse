'use client'
import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Braces, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useAuth } from '@components/Contexts/AuthContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { queryKeys } from '@/lib/query/keys'
import {
  EditorVariable,
  EditorVariableVariant,
  createEditorVariable,
  deleteEditorVariable,
  updateEditorVariable,
} from '@services/courses/dynamicContent'
import { CUSTOM_PREFIX, RuleGroup, describeRules } from './dynamicRules'
import { useDynamicLookups } from './useDynamicLookups'

const KEY_PATTERN = /^[a-z][a-z_]{0,39}$/

interface Draft {
  uuid: string | null
  key: string
  label: string
  description: string
  default_value: string
  variants: EditorVariableVariant[]
}

const EMPTY: Draft = { uuid: null, key: '', label: '', description: '', default_value: '', variants: [] }

// "audience:<uuid>" or "group:<uuid>": the who of a variant, as one select.
function ruleFromChoice(choice: string): RuleGroup | null {
  const [kind, uuid] = choice.split(':')
  if (!uuid) return null
  if (kind === 'audience') return { match: 'all', conditions: [{ field: 'audience', op: 'is', value: uuid }] }
  if (kind === 'group') return { match: 'all', conditions: [{ field: 'user.groups', op: 'contains_any', value: [uuid] }] }
  return null
}

function choiceFromRule(rules: any): string {
  const condition = rules?.conditions?.length === 1 ? rules.conditions[0] : null
  if (condition?.field === 'audience' && condition.op === 'is') return `audience:${condition.value}`
  if (condition?.field === 'user.groups' && condition.op === 'contains_any' && condition.value?.length === 1) {
    return `group:${condition.value[0]}`
  }
  return 'custom'
}

function toKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

// Create and edit the org's custom variables: a default value, and optional
// variants for specific audiences or groups (first match wins).
export default function CustomVariablesModal({ onClose, onInsert }: { onClose: () => void; onInsert?: (path: string) => void }) {
  const { t } = useTranslation()
  const { accessToken } = useAuth()
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const lookups = useDynamicLookups()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.editorVariables.list(org?.id) })

  const edit = (variable: EditorVariable) =>
    setDraft({
      uuid: variable.variable_uuid,
      key: variable.key,
      label: variable.label,
      description: variable.description,
      default_value: variable.default_value,
      variants: variable.variants ?? [],
    })

  const save = async () => {
    if (!draft || !accessToken || !org?.id) return
    if (!draft.uuid && !KEY_PATTERN.test(draft.key)) {
      toast.error(t('editor.dynamic.custom.key_invalid', 'Use lowercase letters and underscores for the key, e.g. support_email'))
      return
    }
    setSaving(true)
    const body = {
      label: draft.label.trim(),
      description: draft.description.trim(),
      default_value: draft.default_value,
      variants: draft.variants.filter((v) => v.rules),
    }
    const res = draft.uuid
      ? await updateEditorVariable(draft.uuid, body, accessToken)
      : await createEditorVariable({ ...body, org_id: org.id, key: draft.key }, accessToken)
    setSaving(false)
    if (!res.success) {
      const detail = res.status === 403
        ? t('editor.dynamic.custom.no_rights', 'Only admins and maintainers can change a variable, because it changes every course that uses it.')
        : res.data?.detail
      toast.error(typeof detail === 'string' ? detail : t('editor.dynamic.custom.save_error', 'Could not save the variable'))
      return
    }
    await refresh()
    toast.success(t('editor.dynamic.custom.saved', 'Variable saved'))
    setDraft(null)
  }

  const remove = async (variable: EditorVariable) => {
    if (!accessToken) return
    if (!window.confirm(t('editor.dynamic.custom.delete_confirm', {
      key: `{{${CUSTOM_PREFIX}${variable.key}}}`,
      defaultValue: 'Delete {{key}}? Text using it shows its fallback, or nothing.',
    }))) return
    const res = await deleteEditorVariable(variable.variable_uuid, accessToken)
    if (!res.success) {
      toast.error(res.status === 403
        ? t('editor.dynamic.custom.no_rights', 'Only admins and maintainers can change a variable, because it changes every course that uses it.')
        : t('editor.dynamic.custom.delete_error', 'Could not delete the variable'))
      return
    }
    await refresh()
  }

  const whoOptions = [
    ...lookups.audienceOptions.map((a) => ({ value: `audience:${a.value}`, label: `${t('editor.dynamic.custom.audience', 'Audience')}: ${a.label}` })),
    ...lookups.usergroups.map((g) => ({ value: `group:${g.value}`, label: `${t('editor.dynamic.custom.group', 'Group')}: ${g.label}` })),
  ]

  const list = (
    <div className="space-y-2">
      {lookups.customVariables.length === 0 && (
        <div className="rounded-xl bg-violet-50 px-4 py-5 text-center text-sm text-violet-900">
          <Braces className="mx-auto mb-2 text-violet-400" size={22} />
          {t('editor.dynamic.custom.empty', 'Set a value once, use it in every course: a support email, a meeting link, a manager per team.')}
        </div>
      )}
      {lookups.customVariables.map((v) => (
        <div key={v.variable_uuid} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{v.label}</span>
              <span className="truncate font-mono text-xs text-violet-600">{`{{${CUSTOM_PREFIX}${v.key}}}`}</span>
            </div>
            <div className="truncate text-xs text-gray-500">
              {v.default_value || t('editor.dynamic.custom.no_default', '(empty by default)')}
              {v.variants.length > 0 && ` · ${t('editor.dynamic.custom.variant_count', { count: v.variants.length, defaultValue: '{{count}} audience values' })}`}
            </div>
          </div>
          {onInsert && (
            <button type="button" onClick={() => onInsert(`${CUSTOM_PREFIX}${v.key}`)} className="rounded-md px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50">
              {t('editor.dynamic.custom.insert', 'Insert')}
            </button>
          )}
          <button type="button" onClick={() => edit(v)} className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
            {t('editor.dynamic.custom.edit', 'Edit')}
          </button>
          <button type="button" onClick={() => remove(v)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={t('editor.templates.delete', 'Delete')}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setDraft({ ...EMPTY })}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50"
      >
        <Plus size={14} /> {t('editor.dynamic.custom.new', 'New variable')}
      </button>
    </div>
  )

  const form = draft && (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-gray-500">{t('editor.dynamic.custom.label', 'Name')}</span>
          <input
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
            value={draft.label}
            maxLength={80}
            placeholder={t('editor.dynamic.custom.label_placeholder', 'Support email')}
            onChange={(e) => {
              const label = e.target.value
              setDraft((d) => d && { ...d, label, key: d.uuid || d.key !== toKey(d.label) ? d.key : toKey(label) })
            }}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-gray-500">{t('editor.dynamic.custom.key', 'Key')}</span>
          <div className="flex items-center rounded-lg border border-gray-200 px-2 font-mono text-xs">
            <span className="text-gray-400">{`{{${CUSTOM_PREFIX}`}</span>
            <input
              className="w-full py-1.5 outline-none disabled:bg-transparent disabled:text-gray-500"
              value={draft.key}
              disabled={!!draft.uuid}
              maxLength={40}
              onChange={(e) => setDraft((d) => d && { ...d, key: e.target.value })}
            />
            <span className="text-gray-400">{'}}'}</span>
          </div>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-gray-500">{t('editor.dynamic.custom.default', 'Value')}</span>
        <input
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
          value={draft.default_value}
          maxLength={500}
          placeholder={t('editor.dynamic.custom.default_placeholder', 'help@example.com')}
          onChange={(e) => setDraft((d) => d && { ...d, default_value: e.target.value })}
        />
      </label>

      <div className="space-y-2 rounded-lg border border-dashed border-violet-200 p-2.5">
        <div className="text-xs font-semibold text-violet-700">
          {t('editor.dynamic.custom.variants', 'Different value for some learners (optional, first match wins)')}
        </div>
        {draft.variants.map((variant, index) => {
          const choice = choiceFromRule(variant.rules)
          return (
            <div key={index} className="flex items-center gap-2">
              {choice === 'custom' ? (
                <span className="flex-1 truncate rounded-lg bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
                  {describeRules(variant.rules, lookups.names)}
                </span>
              ) : (
                <select
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5"
                  value={choice}
                  onChange={(e) => {
                    const rules = ruleFromChoice(e.target.value)
                    setDraft((d) => d && { ...d, variants: d.variants.map((v, i) => (i === index ? { ...v, rules } : v)) })
                  }}
                >
                  <option value="">{t('editor.dynamic.custom.pick_who', 'Who…')}</option>
                  {whoOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              <input
                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5"
                value={variant.value}
                maxLength={500}
                placeholder={t('editor.dynamic.custom.variant_value', 'Their value')}
                onChange={(e) => {
                  const value = e.target.value
                  setDraft((d) => d && { ...d, variants: d.variants.map((v, i) => (i === index ? { ...v, value } : v)) })
                }}
              />
              <button
                type="button"
                onClick={() => setDraft((d) => d && { ...d, variants: d.variants.filter((_, i) => i !== index) })}
                className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                aria-label={t('editor.dynamic.remove_condition', 'Remove condition')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}
        {whoOptions.length === 0 ? (
          <p className="text-xs text-gray-400">{t('editor.dynamic.custom.no_who', 'Create a user group or a saved audience to give some learners a different value.')}</p>
        ) : (
          draft.variants.length < 20 && (
            <button
              type="button"
              onClick={() => setDraft((d) => d && { ...d, variants: [...d.variants, { rules: null, value: '' }] })}
              className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
            >
              <Plus size={12} /> {t('editor.dynamic.custom.add_variant', 'Add a value for a group or audience')}
            </button>
          )
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-100">
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={saving || !draft.label.trim() || !draft.key}
          onClick={save}
          className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : t('common.save', 'Save')}
        </button>
      </div>
    </div>
  )

  return (
    <Modal
      isDialogOpen
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('editor.dynamic.custom.title', 'Custom variables')}
      dialogDescription={t(
        'editor.dynamic.custom.description',
        'Values your organization defines once and uses in any course. Change one and every page using it updates.'
      )}
      minWidth="md"
      dialogContent={<div className="p-1">{form || list}</div>}
    />
  )
}
