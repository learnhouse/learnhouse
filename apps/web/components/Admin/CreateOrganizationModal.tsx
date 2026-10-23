'use client'
import React, { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl, getDeploymentMode } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { X, Buildings } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export default function CreateOrganizationModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const router = useRouter()
  const isSaaS = getDeploymentMode() === 'saas'

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [email, setEmail] = useState('')
  const [description, setDescription] = useState('')
  const [plan, setPlan] = useState<string>('free')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setSlug('')
      setSlugTouched(false)
      setEmail('')
      setDescription('')
      setPlan('free')
      setError('')
      setSubmitting(false)
    }
  }, [open])

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  if (!open) return null

  const canSubmit = name.trim().length > 0 && slug.trim().length > 0 && email.trim().length > 0 && !submitting

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        slug: slug.trim(),
        email: email.trim(),
      }
      if (description.trim()) body.description = description.trim()
      if (isSaaS) body.plan = plan

      const res = await fetch(`${getAPIUrl()}ee/superadmin/organizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || t('admin.create_org.error_failed', { status: res.status }))
        return
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.superadmin.orgs() })
      onClose()
      if (data?.id) router.push(`/admin/organizations/${data.id}`)
    } catch {
      setError(t('admin.create_org.error_network'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#141415] border border-white/[0.08] rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Buildings size={18} weight="fill" className="text-white/70" />
            <h2 className="text-base font-semibold text-white">{t('admin.create_org.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/80 transition-colors"
            aria-label={t('admin.common.close')}
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <Field label={t('admin.create_org.field_name')} required>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Learning"
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          </Field>

          <Field
            label={t('admin.create_org.field_slug')}
            required
            hint={t('admin.create_org.field_slug_hint')}
          >
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(slugify(e.target.value))
              }}
              placeholder="acme-learning"
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 font-mono"
            />
          </Field>

          <Field label={t('admin.create_org.field_email')} required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@acme.com"
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          </Field>

          <Field label={t('admin.create_org.field_description')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('admin.create_org.field_description_placeholder')}
              rows={2}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 resize-none"
            />
          </Field>

          {isSaaS && (
            <Field label={t('admin.create_org.field_plan')}>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              >
                <option value="free">Free</option>
                <option value="standard">Standard</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </Field>
          )}

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3.5 py-2 text-sm text-white/60 hover:text-white/90 transition-colors disabled:opacity-40"
          >
            {t('admin.common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3.5 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? t('admin.create_org.submitting') : t('admin.create_org.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-xs text-white/50 uppercase tracking-wider block mb-1.5">
        {label} {required && <span className="text-red-400/70">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-white/30 mt-1">{hint}</p>}
    </div>
  )
}
