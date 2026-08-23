'use client'
import React from 'react'
import * as Form from '@radix-ui/react-form'
import { Info } from 'lucide-react'
import { FormField } from '@components/Objects/StyledElements/Form/Form'
import { useTranslation } from 'react-i18next'
import type { SignupFieldItem } from '@services/settings/org'

const INPUT_CLASS =
  'box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm'

const TEXTAREA_CLASS =
  'box-border w-full bg-neutral-50 text-black rounded-lg px-4 py-3 border border-neutral-200 appearance-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm resize-none min-h-[80px]'

/** Formik field name for a custom field's answer. */
export function customFieldName(key: string): string {
  return `custom_fields.${key}`
}

/** Seed values for `initialValues` so every declared field is controlled. */
export function initialCustomFieldValues(
  fields: SignupFieldItem[],
): Record<string, any> {
  const values: Record<string, any> = {}
  for (const field of fields) {
    values[field.key] = field.type === 'checkbox' ? false : ''
  }
  return values
}

/**
 * Client-side validation for the org's custom fields.
 *
 * UX only — the server revalidates every value against the org's declared
 * fields, since the signup endpoint is public and cannot trust this.
 */
export function validateCustomFields(
  fields: SignupFieldItem[],
  values: Record<string, any> | undefined,
  t: any,
): Record<string, string> {
  const errors: Record<string, string> = {}
  const answers = values ?? {}

  for (const field of fields) {
    const value = answers[field.key]

    if (field.type === 'checkbox') {
      if (field.required && !value) {
        errors[field.key] = t('validation.required')
      }
      continue
    }

    const isBlank = value === undefined || value === null || String(value).trim() === ''
    if (isBlank) {
      if (field.required) errors[field.key] = t('validation.required')
      continue
    }

    if (field.type === 'number') {
      const num = Number(value)
      if (Number.isNaN(num)) {
        errors[field.key] = t('validation.invalid_number', { defaultValue: 'Must be a number' })
      } else if (field.min_value != null && num < field.min_value) {
        errors[field.key] = t('validation.min_value', {
          defaultValue: `Must be at least ${field.min_value}`,
          value: field.min_value,
        })
      } else if (field.max_value != null && num > field.max_value) {
        errors[field.key] = t('validation.max_value', {
          defaultValue: `Must be at most ${field.max_value}`,
          value: field.max_value,
        })
      }
    } else if (field.type === 'select') {
      if (!(field.options ?? []).includes(String(value))) {
        errors[field.key] = t('validation.invalid_option', {
          defaultValue: 'Choose one of the available options',
        })
      }
    } else if (field.max_length != null && String(value).length > field.max_length) {
      errors[field.key] = t('validation.too_long', {
        defaultValue: `Must be ${field.max_length} characters or fewer`,
        max: field.max_length,
      })
    }
  }

  return errors
}

/**
 * Renders an organization's admin-defined signup fields.
 *
 * Shared by the open and invite-only signup forms so the two stay identical.
 * Renders nothing when the org declares no fields, leaving the form exactly as
 * it was before the feature existed.
 */
export default function CustomSignupFields({
  fields,
  formik,
}: {
  fields: SignupFieldItem[]
  formik: any
}) {
  const { t } = useTranslation()
  if (!fields || fields.length === 0) return null

  const answers = formik.values.custom_fields ?? {}
  const errors = (formik.errors.custom_fields ?? {}) as Record<string, string>
  const touched = (formik.touched.custom_fields ?? {}) as Record<string, boolean>

  return (
    <>
      {fields.map((field) => {
        const name = customFieldName(field.key)
        const value = answers[field.key]
        const error = touched[field.key] ? errors[field.key] : undefined
        const label = field.label || field.key

        return (
          <FormField key={field.key} name={name}>
            {field.type !== 'checkbox' && (
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-black/70">
                  {field.required ? label : `${label} (${t('common.optional')})`}
                </Form.Label>
                {error && (
                  <span className="text-red-500 text-xs flex items-center space-x-1">
                    <Info size={11} />
                    <span>{error}</span>
                  </span>
                )}
              </div>
            )}

            {field.type === 'textarea' && (
              <Form.Control asChild>
                <textarea
                  name={name}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={value ?? ''}
                  placeholder={field.placeholder || ''}
                  maxLength={field.max_length ?? undefined}
                  className={TEXTAREA_CLASS}
                />
              </Form.Control>
            )}

            {field.type === 'select' && (
              <Form.Control asChild>
                <select
                  name={name}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={value ?? ''}
                  className={INPUT_CLASS}
                >
                  <option value="">
                    {field.placeholder || t('common.select', { defaultValue: 'Select…' })}
                  </option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Form.Control>
            )}

            {field.type === 'checkbox' && (
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Form.Control asChild>
                  <input
                    name={name}
                    type="checkbox"
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    checked={!!value}
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-black"
                  />
                </Form.Control>
                <span className="text-[13px] text-black/70 leading-snug">
                  {label}
                  {error && (
                    <span className="ms-2 text-red-500 text-xs">{error}</span>
                  )}
                </span>
              </label>
            )}

            {(field.type === 'text' || field.type === 'number' || field.type === 'date') && (
              <Form.Control asChild>
                <input
                  name={name}
                  type={field.type === 'text' ? 'text' : field.type}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={value ?? ''}
                  placeholder={field.placeholder || ''}
                  maxLength={field.type === 'text' ? field.max_length ?? undefined : undefined}
                  min={field.type === 'number' ? field.min_value ?? undefined : undefined}
                  max={field.type === 'number' ? field.max_value ?? undefined : undefined}
                  className={INPUT_CLASS}
                />
              </Form.Control>
            )}

            {field.help_text && (
              <p className="mt-1 text-[11px] text-black/35">{field.help_text}</p>
            )}
          </FormField>
        )
      })}
    </>
  )
}
