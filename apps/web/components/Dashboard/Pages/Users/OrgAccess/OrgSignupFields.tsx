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
  SIGNUP_PEOPLE_FIELDS,
  updateOrgSignupFieldsConfig,
  type SignupFieldItem,
  type SignupFieldType,
  type SignupPeopleField,
} from '@services/settings/org'
import { useResolvedFeature } from '@components/Hooks/useResolvedFeature'
import SignupBackfill from '@ee/components/HR/People/SignupBackfill'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { ArrowBendDownRight, CaretDown, CaretUp, Eye, Plus, ShieldCheck, Textbox, Trash, Warning } from '@phosphor-icons/react'
import {
  Button,
  EmptyState,
  FieldLabel,
  INPUT,
  SectionCard,
  StickySaveBar,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'

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

const fitsType = (target: SignupPeopleField, type: SignupFieldType) =>
  SIGNUP_PEOPLE_FIELDS.find((p) => p.value === target)?.types.includes(type) ?? false

/** Label of a people field ("Department", "Manager (by email)"...). */
function usePeopleFieldLabel() {
  const { t } = useTranslation()
  return (target: SignupPeopleField) => t(`hr.signup_mapping.targets.${target}`)
}

export default function OrgSignupFields() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { rights } = useAdminStatus()
  const canEdit = rights?.organizations?.action_update === true
  // Saving answers to people data comes with the people data feature (EE).
  const peopleData = useResolvedFeature('required_training').enabled
  const peopleFieldLabel = usePeopleFieldLabel()

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
    setFields((prev) =>
      prev.map((f) => {
        if (f.uid !== uid) return f
        const next = { ...f, ...patch }
        // A new type that no longer fits the people field drops the mapping.
        if (next.people_field && !fitsType(next.people_field, next.type)) next.people_field = null
        return next
      }),
    )
  }, [])

  /** Profile columns already taken by another field (one field each). */
  const takenTargets = useCallback(
    (uid: string) =>
      new Set(
        fields
          .filter((f) => f.uid !== uid && f.people_field && f.people_field !== 'attribute')
          .map((f) => f.people_field as SignupPeopleField),
      ),
    [fields],
  )
  const savedHasMapping = saved.some((f) => f.people_field)

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

  /** Only fill the key from the label while the field is still new; once it
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
    } catch (e: any) {
      // The server explains a refused people-field mapping; anything else gets
      // the generic message.
      const status = e?.status
      toast.error(
        (status === 400 || status === 403) && typeof e?.message === 'string'
          ? e.message
          : t('dashboard.users.signup_fields.save_error', {
              defaultValue: 'Could not save signup fields. Please try again.',
            }),
        { id: toastId },
      )
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setFields(toEditorFields(saved))
    setConfirmDelete(null)
  }

  return (
    <>
      <SectionCard
        icon={<Textbox size={18} />}
        title={t('dashboard.users.signup_fields.title', { defaultValue: 'Custom signup fields' })}
        description={t('dashboard.users.signup_fields.subtitle', {
          defaultValue: 'Extra questions asked when someone joins. Answers are saved on each member.',
        })}
        actions={
          <Button variant="secondary" icon={<Plus size={14} weight="bold" />} onClick={addField} disabled={!canEdit}>
            {t('dashboard.users.signup_fields.add', { defaultValue: 'Add field' })}
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-xs text-neutral-500 bg-neutral-50 ring-1 ring-inset ring-neutral-200 rounded-xl px-3.5 py-2.5">
            <Eye size={14} className="mt-0.5 shrink-0 text-neutral-400" />
            <p>
              {t('dashboard.users.signup_fields.public_notice', {
                defaultValue:
                  'Labels, help text and options appear on your public signup page, so anyone can read them. Do not put anything confidential here.',
              })}
            </p>
          </div>

          {peopleData && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-neutral-600 bg-sky-50/60 ring-1 ring-inset ring-sky-100 rounded-xl px-3.5 py-2.5">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-sky-600" />
                <p>{t('hr.signup_mapping.notice')}</p>
              </div>
              {savedHasMapping && <SignupBackfill blocked={dirty} />}
            </div>
          )}

          {fields.length === 0 && (
            <EmptyState
              icon={<Textbox size={22} />}
              title={t('dashboard.users.dash.signup_fields.empty_title')}
              description={t('dashboard.users.signup_fields.empty', {
                defaultValue: 'No custom fields. Your signup form asks only the standard questions.',
              })}
              action={
                canEdit ? (
                  <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={addField} className="mt-1">
                    {t('dashboard.users.signup_fields.add', { defaultValue: 'Add field' })}
                  </Button>
                ) : undefined
              }
            />
          )}

          {fields.map((field, index) => {
            const isSaved = savedKeys.has(field.key)
            const isOpen = expanded === field.uid
            const isConfirmingDelete = confirmDelete === field.uid
            return (
              <div
                key={field.uid}
                className={`rounded-xl ring-1 ring-inset transition-colors ${
                  isConfirmingDelete ? 'ring-rose-300 bg-rose-50/40' : 'ring-neutral-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap sm:flex-nowrap items-start gap-2 px-3 py-3">
                  <div className="flex flex-col text-neutral-300 shrink-0 pt-1">
                    <button
                      type="button"
                      onClick={() => move(field.uid, -1)}
                      disabled={index === 0 || !canEdit}
                      aria-label={t('common.move_up', { defaultValue: 'Move up' })}
                      className="hover:text-neutral-600 disabled:opacity-30"
                    >
                      <CaretUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(field.uid, 1)}
                      disabled={index === fields.length - 1 || !canEdit}
                      aria-label={t('common.move_down', { defaultValue: 'Move down' })}
                      className="hover:text-neutral-600 disabled:opacity-30"
                    >
                      <CaretDown size={14} />
                    </button>
                  </div>

                  <div className="flex-1 min-w-[180px]">
                    <input
                      id={`signup-field-label-${field.uid}`}
                      value={field.label}
                      onChange={(e) => onLabelChange(field, e.target.value)}
                      disabled={!canEdit}
                      placeholder={t('dashboard.users.signup_fields.label_placeholder', { defaultValue: 'Question label' })}
                      aria-label={t('dashboard.users.signup_fields.label_placeholder', { defaultValue: 'Question label' })}
                      className={INPUT}
                    />
                    <p className="text-[11px] text-neutral-400 mt-1 truncate">
                      <code>{field.key}</code>
                      {isSaved
                        ? ` · ${t('dashboard.users.signup_fields.badge_saved', { defaultValue: 'in use' })}`
                        : ` · ${t('dashboard.users.signup_fields.badge_new', { defaultValue: 'new' })}`}
                      {field.people_field && (
                        <span className="ms-1.5 inline-flex items-center gap-0.5 text-sky-700 font-medium">
                          <ArrowBendDownRight size={11} weight="bold" className="rtl:-scale-x-100" />
                          {peopleFieldLabel(field.people_field)}
                        </span>
                      )}
                    </p>
                  </div>

                  <select
                    value={field.type}
                    onChange={(e) => update(field.uid, { type: e.target.value as SignupFieldType })}
                    disabled={!canEdit}
                    aria-label={t('dashboard.users.signup_fields.type', { defaultValue: 'Field type' })}
                    className={`${INPUT} !w-36 shrink-0`}
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>
                        {t(ft.labelKey, { defaultValue: ft.labelDefault })}
                      </option>
                    ))}
                  </select>

                  <label
                    htmlFor={`signup-field-required-${field.uid}`}
                    className="flex items-center gap-1.5 h-9 text-xs font-medium text-neutral-600 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <input
                      id={`signup-field-required-${field.uid}`}
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => update(field.uid, { required: e.target.checked })}
                      disabled={!canEdit}
                      className="h-3.5 w-3.5 accent-neutral-900"
                    />
                    {t('dashboard.users.signup_fields.required', { defaultValue: 'Required' })}
                  </label>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(isOpen ? null : field.uid)}
                    aria-expanded={isOpen}
                    className="mt-1 shrink-0"
                    icon={<CaretDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                  >
                    {isOpen ? t('common.less', { defaultValue: 'Less' }) : t('common.more', { defaultValue: 'More' })}
                  </Button>

                  <button
                    type="button"
                    onClick={() => requestRemove(field)}
                    onBlur={() => isConfirmingDelete && setConfirmDelete(null)}
                    disabled={!canEdit}
                    aria-label={t('common.delete', { defaultValue: 'Delete' })}
                    className={`mt-1 h-7 w-7 inline-flex items-center justify-center rounded-md shrink-0 transition-colors disabled:opacity-30 ${
                      isConfirmingDelete ? 'text-rose-600 bg-rose-100' : 'text-neutral-400 hover:text-rose-600 hover:bg-rose-50'
                    }`}
                  >
                    <Trash size={15} />
                  </button>
                </div>

                {isConfirmingDelete && (
                  <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg bg-rose-50 ring-1 ring-inset ring-rose-200 px-3 py-2 text-xs text-rose-800">
                    <Warning size={14} className="mt-0.5 shrink-0" />
                    <span>
                      {t('dashboard.users.signup_fields.delete_confirm', {
                        defaultValue:
                          'Removing this field abandons the answers already collected under its key. Click the bin again to confirm.',
                      })}
                    </span>
                  </div>
                )}

                {duplicateKeys.has(field.key) && (
                  <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-3 py-2 text-xs text-amber-800">
                    <Warning size={14} className="mt-0.5 shrink-0" />
                    <span>
                      {t('dashboard.users.signup_fields.duplicate_key', {
                        defaultValue: 'Two fields share the same key. Give them different labels.',
                      })}
                    </span>
                  </div>
                )}

                {isOpen && (
                  <div className="px-3 pb-3 pt-3 space-y-3 border-t border-neutral-100">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <label className="block" htmlFor={`signup-field-key-${field.uid}`}>
                        <FieldLabel>{t('dashboard.users.signup_fields.key', { defaultValue: 'Key' })}</FieldLabel>
                        <input
                          id={`signup-field-key-${field.uid}`}
                          value={field.key}
                          disabled={isSaved || !canEdit}
                          onChange={(e) => update(field.uid, { key: slugify(e.target.value) })}
                          className={`${INPUT} disabled:bg-neutral-50 disabled:text-neutral-400`}
                        />
                        <p className="text-xs text-neutral-400 mt-1.5">
                          {isSaved
                            ? t('dashboard.users.signup_fields.key_locked', {
                                defaultValue: 'Locked: changing it would orphan the answers already collected.',
                              })
                            : t('dashboard.users.signup_fields.key_hint', {
                                defaultValue: 'Set automatically from the label.',
                              })}
                        </p>
                      </label>

                      <label className="block" htmlFor={`signup-field-help-${field.uid}`}>
                        <FieldLabel>{t('dashboard.users.signup_fields.help_text', { defaultValue: 'Help text' })}</FieldLabel>
                        <input
                          id={`signup-field-help-${field.uid}`}
                          value={field.help_text ?? ''}
                          onChange={(e) => update(field.uid, { help_text: e.target.value })}
                          disabled={!canEdit}
                          className={INPUT}
                        />
                      </label>
                    </div>

                    {(peopleData || field.people_field) && (
                      <PeopleFieldPicker
                        field={field}
                        taken={takenTargets(field.uid)}
                        disabled={!canEdit || !peopleData}
                        onChange={(people_field) => update(field.uid, { people_field })}
                      />
                    )}

                    {field.type === 'select' && (
                      <OptionsEditor
                        uid={field.uid}
                        options={field.options ?? []}
                        disabled={!canEdit}
                        onChange={(options) => update(field.uid, { options })}
                      />
                    )}

                    {(field.type === 'text' || field.type === 'textarea') && (
                      <label className="block w-40" htmlFor={`signup-field-maxlen-${field.uid}`}>
                        <FieldLabel>{t('dashboard.users.signup_fields.max_length', { defaultValue: 'Max length' })}</FieldLabel>
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
                          className={INPUT}
                        />
                      </label>
                    )}

                    {field.type === 'number' && (
                      <div className="flex gap-3">
                        <label className="block w-32" htmlFor={`signup-field-min-${field.uid}`}>
                          <FieldLabel>{t('dashboard.users.signup_fields.min_value', { defaultValue: 'Min' })}</FieldLabel>
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
                            className={INPUT}
                          />
                        </label>
                        <label className="block w-32" htmlFor={`signup-field-max-${field.uid}`}>
                          <FieldLabel>{t('dashboard.users.signup_fields.max_value', { defaultValue: 'Max' })}</FieldLabel>
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
                            className={INPUT}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      <StickySaveBar
        visible={dirty && canEdit}
        saving={saving}
        onSave={save}
        onDiscard={discard}
        saveLabel={t('dashboard.users.dash.signup_fields.save')}
      />
    </>
  )
}

/** "Save to people field": where else the answer goes (department, manager,
 *  a custom attribute...). Targets the field type can't fill, and profile
 *  columns another field already fills, are disabled. */
function PeopleFieldPicker({
  field,
  taken,
  disabled,
  onChange,
}: {
  field: EditorField
  taken: Set<SignupPeopleField>
  disabled: boolean
  onChange: (_target: SignupPeopleField | null) => void
}) {
  const { t } = useTranslation()
  const label = usePeopleFieldLabel()
  const target = field.people_field ?? null
  return (
    <div className="grid sm:grid-cols-2 gap-3 items-start">
      <label className="block" htmlFor={`signup-field-people-${field.uid}`}>
        <FieldLabel>{t('hr.signup_mapping.label')}</FieldLabel>
        <select
          id={`signup-field-people-${field.uid}`}
          value={target ?? ''}
          disabled={disabled}
          onChange={(e) => onChange((e.target.value || null) as SignupPeopleField | null)}
          className={INPUT}
        >
          <option value="">{t('hr.signup_mapping.none')}</option>
          {SIGNUP_PEOPLE_FIELDS.map((p) => {
            const wrongType = !p.types.includes(field.type)
            const isTaken = taken.has(p.value)
            return (
              <option key={p.value} value={p.value} disabled={wrongType || isTaken}>
                {label(p.value)}
                {isTaken
                  ? ` ${t('hr.signup_mapping.taken')}`
                  : wrongType
                    ? ` ${t('hr.signup_mapping.wrong_type')}`
                    : ''}
              </option>
            )
          })}
        </select>
      </label>
      {target && (
        <p className="text-xs text-neutral-500 sm:pt-7 leading-relaxed">
          {target === 'manager_email'
            ? t('hr.signup_mapping.hint_manager')
            : target === 'attribute'
              ? t('hr.signup_mapping.hint_attribute', { key: field.key })
              : t('hr.signup_mapping.hint_column', { field: label(target) })}
        </p>
      )}
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
      <label htmlFor={`signup-field-options-${uid}`}>
        <FieldLabel>
          {t('dashboard.users.signup_fields.options', {
            defaultValue: 'Options (one per line)',
          })}
        </FieldLabel>
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
        className={`${TEXTAREA} resize-y`}
      />
    </div>
  )
}
