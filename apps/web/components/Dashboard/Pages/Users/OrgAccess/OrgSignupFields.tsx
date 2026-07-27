'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  readSignupFields,
  updateOrgSignupFieldsConfig,
  type SignupFieldItem,
  type SignupFieldType,
} from '@services/settings/org'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Eye, Plus, Trash2 } from 'lucide-react'

const FIELD_TYPES: { value: SignupFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
]

/** Derive a stable JSON key from a label. The key is what every answer is
 *  stored under, so it is generated once and then locked. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function uniqueKey(base: string, taken: Set<string>): string {
  const seed = base || 'field'
  if (!taken.has(seed)) return seed
  let n = 2
  while (taken.has(`${seed}_${n}`)) n += 1
  return `${seed}_${n}`
}

// No width here on purpose: each usage sets its own. `w-full` in the shared
// class beat the `w-36` on the type select in the cascade, so the select ate the
// row and the label input next to it collapsed to a few pixels.
const INPUT_BASE =
  'bg-gray-50 text-gray-900 rounded-lg px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-400 transition-all'

const INPUT = `${INPUT_BASE} w-full`

export default function OrgSignupFields() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { rights } = useAdminStatus()
  const canEdit = rights?.organizations?.action_update === true

  const saved = useMemo<SignupFieldItem[]>(() => readSignupFields(org), [org])
  const [fields, setFields] = useState<SignupFieldItem[]>([])
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    setFields(saved)
  }, [saved])

  const dirty = useMemo(
    () => JSON.stringify(fields) !== JSON.stringify(saved),
    [fields, saved],
  )

  function update(index: number, patch: Partial<SignupFieldItem>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  function addField() {
    const taken = new Set(fields.map((f) => f.key))
    setFields((prev) => [
      ...prev,
      {
        key: uniqueKey('field', taken),
        label: '',
        type: 'text',
        required: false,
        enabled: true,
        order: prev.length,
        options: [],
      },
    ])
  }

  function removeField(index: number) {
    setFields((prev) =>
      prev.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i })),
    )
  }

  function move(index: number, delta: number) {
    setFields((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((f, i) => ({ ...f, order: i }))
    })
  }

  /** Only fill the key from the label while the field is still new — once it
   *  has been saved, renaming it would orphan every answer collected so far. */
  function onLabelChange(index: number, label: string) {
    const field = fields[index]
    const isSaved = saved.some((f) => f.key === field.key)
    const patch: Partial<SignupFieldItem> = { label }
    if (!isSaved) {
      const taken = new Set(fields.filter((_, i) => i !== index).map((f) => f.key))
      patch.key = uniqueKey(slugify(label), taken)
    }
    update(index, patch)
  }

  async function save() {
    if (!canEdit) {
      toast.error(
        t('dashboard.users.signup_fields.no_rights', {
          defaultValue: 'You do not have permission to change signup fields.',
        }),
      )
      return
    }

    const cleaned = fields.map((f, i) => ({ ...f, order: i }))

    if (cleaned.some((f) => !f.label.trim())) {
      toast.error(
        t('dashboard.users.signup_fields.label_required', {
          defaultValue: 'Every field needs a label.',
        }),
      )
      return
    }
    if (cleaned.some((f) => f.type === 'select' && (f.options ?? []).length === 0)) {
      toast.error(
        t('dashboard.users.signup_fields.options_required', {
          defaultValue: 'Dropdown fields need at least one option.',
        }),
      )
      return
    }

    setSaving(true)
    const toastId = toast.loading(
      t('dashboard.users.signup_fields.saving', { defaultValue: 'Saving signup fields…' }),
    )
    try {
      await updateOrgSignupFieldsConfig(org.id, { fields: cleaned }, access_token)
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(
        t('dashboard.users.signup_fields.saved', { defaultValue: 'Signup fields updated.' }),
        { id: toastId },
      )
    } catch {
      toast.error(
        t('dashboard.users.signup_fields.save_error', {
          defaultValue: 'Could not save signup fields. Please try again.',
        }),
        { id: toastId },
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-4 sm:mx-10 bg-white rounded-xl nice-shadow mt-6">
      <div className="px-4 sm:px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-bold text-xl text-gray-800">
            {t('dashboard.users.signup_fields.title', { defaultValue: 'Custom signup fields' })}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('dashboard.users.signup_fields.subtitle', {
              defaultValue:
                'Extra questions asked when someone joins. Answers are saved on each member.',
            })}
          </p>
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving || !canEdit}
          className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-black/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving
            ? t('common.saving', { defaultValue: 'Saving…' })
            : t('common.save', { defaultValue: 'Save' })}
        </button>
      </div>

      <div className="p-4 sm:p-6 space-y-3">
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2.5">
          <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>
            {t('dashboard.users.signup_fields.public_notice', {
              defaultValue:
                'Labels, help text and options appear on your public signup page — anyone can read them. Do not put anything confidential here.',
            })}
          </p>
        </div>

        {fields.length === 0 && (
          <p className="text-sm text-gray-400 py-6 text-center">
            {t('dashboard.users.signup_fields.empty', {
              defaultValue: 'No custom fields. Your signup form asks only the standard questions.',
            })}
          </p>
        )}

        {fields.map((field, index) => {
          const isSaved = saved.some((f) => f.key === field.key)
          const isOpen = expanded === field.key
          return (
            <div key={field.key} className="border border-gray-200 rounded-lg">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex flex-col">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={t('common.move_up', { defaultValue: 'Move up' })}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === fields.length - 1}
                    aria-label={t('common.move_down', { defaultValue: 'Move down' })}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <input
                  value={field.label}
                  onChange={(e) => onLabelChange(index, e.target.value)}
                  placeholder={t('dashboard.users.signup_fields.label_placeholder', {
                    defaultValue: 'Question label',
                  })}
                  aria-label={t('dashboard.users.signup_fields.label_placeholder', {
                    defaultValue: 'Question label',
                  })}
                  className={`${INPUT_BASE} flex-1 min-w-0`}
                />

                <select
                  value={field.type}
                  onChange={(e) =>
                    update(index, { type: e.target.value as SignupFieldType })
                  }
                  className={`${INPUT_BASE} w-36 shrink-0`}
                >
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft.value} value={ft.value}>
                      {ft.label}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => update(index, { required: e.target.checked })}
                    className="h-3.5 w-3.5 accent-black"
                  />
                  {t('dashboard.users.signup_fields.required', { defaultValue: 'Required' })}
                </label>

                <button
                  onClick={() => setExpanded(isOpen ? null : field.key)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-800 px-2"
                >
                  {isOpen
                    ? t('common.less', { defaultValue: 'Less' })
                    : t('common.more', { defaultValue: 'More' })}
                </button>

                <button
                  onClick={() => removeField(index)}
                  aria-label={t('common.delete', { defaultValue: 'Delete' })}
                  className="text-gray-300 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-gray-100">
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        {t('dashboard.users.signup_fields.key', { defaultValue: 'Key' })}
                      </label>
                      <input
                        value={field.key}
                        disabled={isSaved}
                        onChange={(e) => update(index, { key: slugify(e.target.value) })}
                        className={`${INPUT} mt-1 disabled:bg-gray-100 disabled:text-gray-400`}
                      />
                      <p className="text-[11px] text-gray-400 mt-1">
                        {isSaved
                          ? t('dashboard.users.signup_fields.key_locked', {
                              defaultValue:
                                'Locked — changing it would orphan the answers already collected.',
                            })
                          : t('dashboard.users.signup_fields.key_hint', {
                              defaultValue: 'Set automatically from the label.',
                            })}
                      </p>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        {t('dashboard.users.signup_fields.help_text', { defaultValue: 'Help text' })}
                      </label>
                      <input
                        value={field.help_text ?? ''}
                        onChange={(e) => update(index, { help_text: e.target.value })}
                        className={`${INPUT} mt-1`}
                      />
                    </div>
                  </div>

                  {field.type === 'select' && (
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        {t('dashboard.users.signup_fields.options', {
                          defaultValue: 'Options (one per line)',
                        })}
                      </label>
                      <textarea
                        value={(field.options ?? []).join('\n')}
                        onChange={(e) =>
                          update(index, {
                            options: e.target.value
                              .split('\n')
                              .map((o) => o.trim())
                              .filter(Boolean),
                          })
                        }
                        rows={4}
                        className={`${INPUT} mt-1 resize-y`}
                      />
                    </div>
                  )}

                  {(field.type === 'text' || field.type === 'textarea') && (
                    <div className="w-40">
                      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        {t('dashboard.users.signup_fields.max_length', {
                          defaultValue: 'Max length',
                        })}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={field.max_length ?? ''}
                        onChange={(e) =>
                          update(index, {
                            max_length: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className={`${INPUT} mt-1`}
                      />
                    </div>
                  )}

                  {field.type === 'number' && (
                    <div className="flex gap-2.5">
                      <div className="w-32">
                        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                          {t('dashboard.users.signup_fields.min_value', { defaultValue: 'Min' })}
                        </label>
                        <input
                          type="number"
                          value={field.min_value ?? ''}
                          onChange={(e) =>
                            update(index, {
                              min_value: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className={`${INPUT} mt-1`}
                        />
                      </div>
                      <div className="w-32">
                        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                          {t('dashboard.users.signup_fields.max_value', { defaultValue: 'Max' })}
                        </label>
                        <input
                          type="number"
                          value={field.max_value ?? ''}
                          onChange={(e) =>
                            update(index, {
                              max_value: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className={`${INPUT} mt-1`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <button
          onClick={addField}
          disabled={!canEdit}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-40"
        >
          <Plus className="w-4 h-4" />
          {t('dashboard.users.signup_fields.add', { defaultValue: 'Add field' })}
        </button>
      </div>
    </div>
  )
}
