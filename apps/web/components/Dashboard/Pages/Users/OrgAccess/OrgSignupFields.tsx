'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { AlertTriangle, ChevronDown, ChevronUp, Eye, GripVertical, Plus, Trash2 } from 'lucide-react'

const FIELD_TYPES: { value: SignupFieldType; labelKey: string; labelDefault: string }[] = [
  { value: 'text', labelKey: 'dashboard.users.signup_fields.type_text', labelDefault: 'Text' },
  { value: 'textarea', labelKey: 'dashboard.users.signup_fields.type_textarea', labelDefault: 'Long text' },
  { value: 'select', labelKey: 'dashboard.users.signup_fields.type_select', labelDefault: 'Dropdown' },
  { value: 'checkbox', labelKey: 'dashboard.users.signup_fields.type_checkbox', labelDefault: 'Checkbox' },
  { value: 'number', labelKey: 'dashboard.users.signup_fields.type_number', labelDefault: 'Number' },
  { value: 'date', labelKey: 'dashboard.users.signup_fields.type_date', labelDefault: 'Date' },
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

// Width belongs to each usage, never to the shared class: `w-full` here beat the
// `w-36` on the type select in the cascade, which let the select eat the whole
// row and collapsed the label input beside it to a few pixels.
const INPUT_BASE =
  'bg-gray-50 text-gray-900 rounded-lg px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-400 transition-all'

const INPUT = `${INPUT_BASE} w-full`

const FIELD_LABEL = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wider'

/**
 * A row's identity in React must NOT be its JSON key: the key is re-derived from
 * the label on every keystroke while a field is new, so using it as the `key`
 * prop remounted the row on each character and the input lost focus after one
 * letter. `uid` is client-only and never saved.
 */
type EditorField = SignupFieldItem & { uid: string }

let uidCounter = 0
const nextUid = () => `f${(uidCounter += 1)}`

const toEditorFields = (items: SignupFieldItem[]): EditorField[] =>
  items.map((f) => ({ ...f, uid: nextUid() }))

const stripUid = (f: EditorField): SignupFieldItem => {
  const { uid: _uid, ...rest } = f
  return rest
}

export default function OrgSignupFields() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { rights } = useAdminStatus()
  const canEdit = rights?.organizations?.action_update === true

  const saved = useMemo<SignupFieldItem[]>(() => readSignupFields(org), [org])
  const [fields, setFields] = useState<EditorField[]>([])
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Re-seed only when the saved set actually changes, so a re-render mid-edit
  // never throws away what is being typed.
  const savedSignature = JSON.stringify(saved)
  const seededSignature = useRef<string | null>(null)
  useEffect(() => {
    if (seededSignature.current === savedSignature) return
    seededSignature.current = savedSignature
    setFields(toEditorFields(saved))
  }, [savedSignature, saved])

  const savedKeys = useMemo(() => new Set(saved.map((f) => f.key)), [saved])

  const dirty = useMemo(
    () => JSON.stringify(fields.map(stripUid)) !== savedSignature,
    [fields, savedSignature],
  )

  const update = useCallback((uid: string, patch: Partial<SignupFieldItem>) => {
    setFields((prev) => prev.map((f) => (f.uid === uid ? { ...f, ...patch } : f)))
  }, [])

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        uid: nextUid(),
        key: uniqueKey('field', new Set(prev.map((f) => f.key))),
        label: '',
        type: 'text',
        required: false,
        enabled: true,
        order: prev.length,
        options: [],
      },
    ])
  }

  function removeField(uid: string) {
    setFields((prev) =>
      prev.filter((f) => f.uid !== uid).map((f, i) => ({ ...f, order: i })),
    )
    setConfirmDelete(null)
  }

  /** Deleting a field that has already been saved abandons every answer stored
   *  under its key, so it takes a second click. New fields go straight away. */
  function requestRemove(field: EditorField) {
    if (!savedKeys.has(field.key)) {
      removeField(field.uid)
      return
    }
    setConfirmDelete((current) => (current === field.uid ? null : field.uid))
  }

  function move(uid: string, delta: number) {
    setFields((prev) => {
      const index = prev.findIndex((f) => f.uid === uid)
      const target = index + delta
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((f, i) => ({ ...f, order: i }))
    })
  }

  /** Only fill the key from the label while the field is still new — once it
   *  has been saved, renaming it would orphan every answer collected so far. */
  function onLabelChange(field: EditorField, label: string) {
    const patch: Partial<SignupFieldItem> = { label }
    if (!savedKeys.has(field.key)) {
      const taken = new Set(fields.filter((f) => f.uid !== field.uid).map((f) => f.key))
      patch.key = uniqueKey(slugify(label), taken)
    }
    update(field.uid, patch)
  }

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of fields) counts.set(f.key, (counts.get(f.key) ?? 0) + 1)
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [fields])

  async function save() {
    if (!canEdit) {
      toast.error(
        t('dashboard.users.signup_fields.no_rights', {
          defaultValue: 'You do not have permission to change signup fields.',
        }),
      )
      return
    }

    const cleaned = fields.map((f, i) => ({ ...stripUid(f), order: i }))

    if (cleaned.some((f) => !f.label.trim())) {
      toast.error(
        t('dashboard.users.signup_fields.label_required', {
          defaultValue: 'Every field needs a label.',
        }),
      )
      return
    }
    if (duplicateKeys.size > 0) {
      toast.error(
        t('dashboard.users.signup_fields.duplicate_key', {
          defaultValue: 'Two fields share the same key. Give them different labels.',
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
          const isSaved = savedKeys.has(field.key)
          const isOpen = expanded === field.uid
          const isConfirmingDelete = confirmDelete === field.uid
          return (
            <div
              key={field.uid}
              className={`border rounded-lg transition-colors ${
                isConfirmingDelete ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex flex-col text-gray-300 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(field.uid, -1)}
                    disabled={index === 0 || !canEdit}
                    aria-label={t('common.move_up', { defaultValue: 'Move up' })}
                    className="hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(field.uid, 1)}
                    disabled={index === fields.length - 1 || !canEdit}
                    aria-label={t('common.move_down', { defaultValue: 'Move down' })}
                    className="hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <GripVertical className="w-4 h-4 text-gray-200 shrink-0 hidden sm:block" />

                <div className="flex-1 min-w-0">
                  <input
                    id={`signup-field-label-${field.uid}`}
                    value={field.label}
                    onChange={(e) => onLabelChange(field, e.target.value)}
                    disabled={!canEdit}
                    placeholder={t('dashboard.users.signup_fields.label_placeholder', {
                      defaultValue: 'Question label',
                    })}
                    aria-label={t('dashboard.users.signup_fields.label_placeholder', {
                      defaultValue: 'Question label',
                    })}
                    className={`${INPUT_BASE} w-full`}
                  />
                  <p className="text-[11px] text-gray-400 mt-1 truncate">
                    <code>{field.key}</code>
                    {isSaved
                      ? ` · ${t('dashboard.users.signup_fields.badge_saved', { defaultValue: 'in use' })}`
                      : ` · ${t('dashboard.users.signup_fields.badge_new', { defaultValue: 'new' })}`}
                  </p>
                </div>

                <select
                  value={field.type}
                  onChange={(e) => update(field.uid, { type: e.target.value as SignupFieldType })}
                  disabled={!canEdit}
                  aria-label={t('dashboard.users.signup_fields.type', { defaultValue: 'Field type' })}
                  className={`${INPUT_BASE} w-36 shrink-0 self-start`}
                >
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft.value} value={ft.value}>
                      {t(ft.labelKey, { defaultValue: ft.labelDefault })}
                    </option>
                  ))}
                </select>

                <label
                  htmlFor={`signup-field-required-${field.uid}`}
                  className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap shrink-0 self-start mt-2.5 cursor-pointer"
                >
                  <input
                    id={`signup-field-required-${field.uid}`}
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => update(field.uid, { required: e.target.checked })}
                    disabled={!canEdit}
                    className="h-3.5 w-3.5 accent-black"
                  />
                  {t('dashboard.users.signup_fields.required', { defaultValue: 'Required' })}
                </label>

                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : field.uid)}
                  aria-expanded={isOpen}
                  className="text-xs font-medium text-gray-500 hover:text-gray-800 px-2 shrink-0 self-start mt-2"
                >
                  {isOpen
                    ? t('common.less', { defaultValue: 'Less' })
                    : t('common.more', { defaultValue: 'More' })}
                </button>

                <button
                  type="button"
                  onClick={() => requestRemove(field)}
                  onBlur={() => isConfirmingDelete && setConfirmDelete(null)}
                  disabled={!canEdit}
                  aria-label={t('common.delete', { defaultValue: 'Delete' })}
                  className={`shrink-0 self-start mt-2 transition-colors disabled:opacity-30 ${
                    isConfirmingDelete ? 'text-red-600' : 'text-gray-300 hover:text-red-600'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {isConfirmingDelete && (
                <div className="mx-3 mb-2.5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200/80 px-3 py-2 text-xs text-red-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    {t('dashboard.users.signup_fields.delete_confirm', {
                      defaultValue:
                        'Removing this field abandons the answers already collected under its key. Click the bin again to confirm.',
                    })}
                  </span>
                </div>
              )}

              {duplicateKeys.has(field.key) && (
                <div className="mx-3 mb-2.5 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200/80 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    {t('dashboard.users.signup_fields.duplicate_key', {
                      defaultValue: 'Two fields share the same key. Give them different labels.',
                    })}
                  </span>
                </div>
              )}

              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-gray-100">
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className={FIELD_LABEL} htmlFor={`signup-field-key-${field.uid}`}>
                        {t('dashboard.users.signup_fields.key', { defaultValue: 'Key' })}
                      </label>
                      <input
                        id={`signup-field-key-${field.uid}`}
                        value={field.key}
                        disabled={isSaved || !canEdit}
                        onChange={(e) => update(field.uid, { key: slugify(e.target.value) })}
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
                      <label className={FIELD_LABEL} htmlFor={`signup-field-help-${field.uid}`}>
                        {t('dashboard.users.signup_fields.help_text', { defaultValue: 'Help text' })}
                      </label>
                      <input
                        id={`signup-field-help-${field.uid}`}
                        value={field.help_text ?? ''}
                        onChange={(e) => update(field.uid, { help_text: e.target.value })}
                        disabled={!canEdit}
                        className={`${INPUT} mt-1`}
                      />
                    </div>
                  </div>

                  {field.type === 'select' && (
                    <OptionsEditor
                      uid={field.uid}
                      options={field.options ?? []}
                      disabled={!canEdit}
                      onChange={(options) => update(field.uid, { options })}
                    />
                  )}

                  {(field.type === 'text' || field.type === 'textarea') && (
                    <div className="w-40">
                      <label className={FIELD_LABEL} htmlFor={`signup-field-maxlen-${field.uid}`}>
                        {t('dashboard.users.signup_fields.max_length', {
                          defaultValue: 'Max length',
                        })}
                      </label>
                      <input
                        id={`signup-field-maxlen-${field.uid}`}
                        type="number"
                        min={1}
                        value={field.max_length ?? ''}
                        onChange={(e) =>
                          update(field.uid, {
                            max_length: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        disabled={!canEdit}
                        className={`${INPUT} mt-1`}
                      />
                    </div>
                  )}

                  {field.type === 'number' && (
                    <div className="flex gap-2.5">
                      <div className="w-32">
                        <label className={FIELD_LABEL} htmlFor={`signup-field-min-${field.uid}`}>
                          {t('dashboard.users.signup_fields.min_value', { defaultValue: 'Min' })}
                        </label>
                        <input
                          id={`signup-field-min-${field.uid}`}
                          type="number"
                          value={field.min_value ?? ''}
                          onChange={(e) =>
                            update(field.uid, {
                              // '' clears it; 0 is a legitimate bound and must not
                              // be swallowed by a truthiness check.
                              min_value: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          disabled={!canEdit}
                          className={`${INPUT} mt-1`}
                        />
                      </div>
                      <div className="w-32">
                        <label className={FIELD_LABEL} htmlFor={`signup-field-max-${field.uid}`}>
                          {t('dashboard.users.signup_fields.max_value', { defaultValue: 'Max' })}
                        </label>
                        <input
                          id={`signup-field-max-${field.uid}`}
                          type="number"
                          value={field.max_value ?? ''}
                          onChange={(e) =>
                            update(field.uid, {
                              max_value: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          disabled={!canEdit}
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
          type="button"
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

/**
 * Dropdown options, edited as free text.
 *
 * The previous version derived the textarea's value from `options.join('\n')`
 * and wrote back a filtered array on every keystroke, so pressing Enter created
 * an empty line that was immediately stripped and the caret jumped back: you
 * could not type a second option at all. The raw text lives here instead, and
 * only the parsed result is published upward.
 */
function OptionsEditor({
  uid,
  options,
  disabled,
  onChange,
}: {
  uid: string
  options: string[]
  disabled: boolean
  onChange: (_options: string[]) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(() => options.join('\n'))

  // Re-sync only when the parsed value diverges from what this buffer produces,
  // so an outside change lands but ordinary typing is never clobbered.
  useEffect(() => {
    const parsed = text.split('\n').map((o) => o.trim()).filter(Boolean)
    if (JSON.stringify(parsed) !== JSON.stringify(options)) {
      setText(options.join('\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(options)])

  return (
    <div>
      <label className={FIELD_LABEL} htmlFor={`signup-field-options-${uid}`}>
        {t('dashboard.users.signup_fields.options', {
          defaultValue: 'Options (one per line)',
        })}
      </label>
      <textarea
        id={`signup-field-options-${uid}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.split('\n').map((o) => o.trim()).filter(Boolean))
        }}
        disabled={disabled}
        rows={4}
        placeholder={t('dashboard.users.signup_fields.options_placeholder', {
          defaultValue: 'First option\nSecond option',
        })}
        className={`${INPUT} mt-1 resize-y`}
      />
    </div>
  )
}
