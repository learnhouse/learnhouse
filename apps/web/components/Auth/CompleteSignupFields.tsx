'use client'
import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { apiFetch, RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import type { SignupFieldItem } from '@services/settings/org'

const INPUT =
  'w-full bg-neutral-50 text-black rounded-lg px-3 py-2.5 border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all'

/**
 * Asks a signed-in member for required custom signup fields they haven't
 * answered.
 *
 * Needed because Google sign-in never renders the signup form, so those users
 * arrive with required fields unset. It also catches members who joined before
 * an admin marked a field required.
 *
 * Renders nothing when there is nothing outstanding, which is the common case.
 */
export default function CompleteSignupFields() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const orgId = org?.id

  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  // The dialog ships with a close button, so let it actually close rather than
  // rendering a dead control. Unanswered fields are asked for again on the next
  // page load, so dismissing postpones rather than escapes.
  const [dismissed, setDismissed] = useState(false)

  const { data } = useQuery({
    queryKey: ['org', orgId, 'signup-fields', 'pending'],
    queryFn: () =>
      apiFetch(`${getAPIUrl()}orgs/${orgId}/signup-fields/pending`, access_token),
    enabled: isAuthenticated && !!orgId && !!access_token,
    staleTime: 5 * 60_000,
  })

  const fields = useMemo<SignupFieldItem[]>(() => data?.fields ?? [], [data])

  if (done || dismissed || fields.length === 0) return null

  function setValue(key: string, value: any) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function submit() {
    const nextErrors: Record<string, string> = {}
    for (const field of fields) {
      const value = answers[field.key]
      if (field.type === 'checkbox' ? !value : String(value ?? '').trim() === '') {
        nextErrors[field.key] = t('validation.required')
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        `${getAPIUrl()}orgs/${orgId}/signup-fields/complete`,
        RequestBodyWithAuthHeader('POST', answers, null, access_token),
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // The server validates against the org's declared fields, so surface
        // exactly which field it rejected rather than a generic failure.
        const detail = body?.detail
        if (detail?.field) {
          setErrors({ [detail.field]: detail.message ?? t('common.something_went_wrong') })
        } else {
          toast.error(
            typeof detail === 'string' ? detail : t('common.something_went_wrong'),
          )
        }
        return
      }
      setDone(true)
    } catch {
      toast.error(t('common.something_went_wrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && setDismissed(true)}>
      <DialogContent className="max-w-md p-0">
        <div className="px-6 py-6 space-y-4">
          <DialogTitle asChild>
            <div>
              <p className="text-[17px] font-bold text-black">
                {t('auth.complete_profile.title', {
                  defaultValue: 'Complete your profile',
                })}
              </p>
              <p className="text-[13px] text-black/45 mt-1 font-normal">
                {t('auth.complete_profile.subtitle', {
                  defaultValue: `${org?.name ?? 'This organization'} needs a little more information before you continue.`,
                  org: org?.name ?? '',
                })}
              </p>
            </div>
          </DialogTitle>

          <div className="space-y-3.5">
            {fields.map((field) => {
              const error = errors[field.key]
              const label = field.label || field.key
              return (
                <div key={field.key}>
                  {field.type !== 'checkbox' && (
                    <label className="block text-[13px] font-semibold text-black/70 mb-1.5">
                      {label}
                    </label>
                  )}

                  {field.type === 'textarea' && (
                    <textarea
                      value={answers[field.key] ?? ''}
                      onChange={(e) => setValue(field.key, e.target.value)}
                      placeholder={field.placeholder || ''}
                      maxLength={field.max_length ?? undefined}
                      className={`${INPUT} resize-none min-h-[80px]`}
                    />
                  )}

                  {field.type === 'select' && (
                    <select
                      value={answers[field.key] ?? ''}
                      onChange={(e) => setValue(field.key, e.target.value)}
                      className={INPUT}
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
                  )}

                  {field.type === 'checkbox' && (
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!answers[field.key]}
                        onChange={(e) => setValue(field.key, e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-black"
                      />
                      <span className="text-[13px] text-black/70 leading-snug">{label}</span>
                    </label>
                  )}

                  {(field.type === 'text' || field.type === 'number' || field.type === 'date') && (
                    <input
                      type={field.type === 'text' ? 'text' : field.type}
                      value={answers[field.key] ?? ''}
                      onChange={(e) => setValue(field.key, e.target.value)}
                      placeholder={field.placeholder || ''}
                      maxLength={field.type === 'text' ? field.max_length ?? undefined : undefined}
                      min={field.type === 'number' ? field.min_value ?? undefined : undefined}
                      max={field.type === 'number' ? field.max_value ?? undefined : undefined}
                      className={INPUT}
                    />
                  )}

                  {field.help_text && (
                    <p className="mt-1 text-[11px] text-black/35">{field.help_text}</p>
                  )}
                  {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-black/[0.05] bg-black/[0.01] flex justify-end">
          <button
            onClick={submit}
            disabled={saving}
            className="px-5 py-2 bg-black text-white rounded-xl text-[13px] font-semibold hover:bg-black/85 transition-colors disabled:opacity-50"
          >
            {saving
              ? t('common.saving', { defaultValue: 'Saving…' })
              : t('common.continue', { defaultValue: 'Continue' })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
