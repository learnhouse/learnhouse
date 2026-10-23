'use client'
import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Key, X } from '@phosphor-icons/react'
import type { CreatedToken } from '@components/Admin/SuperadminAPITokens/TokenCreatedDialog'
import { useTranslation } from 'react-i18next'

export default function CreateTokenModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (_token: CreatedToken) => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [neverExpires, setNeverExpires] = useState(true)
  const [expiresAt, setExpiresAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setNeverExpires(true)
      setExpiresAt('')
      setError('')
      setSubmitting(false)
    }
  }, [open])

  if (!open) return null

  const canSubmit = name.trim().length > 0 && !submitting && (neverExpires || expiresAt.length > 0)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const body: Record<string, unknown> = { name: name.trim() }
      if (description.trim()) body.description = description.trim()
      if (!neverExpires && expiresAt) {
        // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm"; send as ISO.
        body.expires_at = new Date(expiresAt).toISOString()
      }

      const res = await fetch(`${getAPIUrl()}ee/superadmin/tokens/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || t('admin.create_token.error_failed', { status: res.status }))
        return
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.superadmin.apiTokens() })
      onCreated(data as CreatedToken)
    } catch {
      setError(t('admin.common.error_network'))
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
            <Key size={18} weight="fill" className="text-white/70" />
            <h2 className="text-base font-semibold text-white">{t('admin.create_token.title')}</h2>
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
          <Field label={t('admin.create_token.field_name')} required hint={t('admin.create_token.field_name_hint')}>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="acme-automation"
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          </Field>

          <Field label={t('admin.create_token.field_description')}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('admin.create_token.field_description_placeholder')}
              rows={2}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 resize-none"
            />
          </Field>

          <Field label={t('admin.create_token.field_expiration')}>
            <label className="flex items-center gap-2 text-sm text-white/80 mb-2">
              <input
                type="checkbox"
                checked={neverExpires}
                onChange={(e) => setNeverExpires(e.target.checked)}
                className="accent-white/80"
              />
              {t('admin.create_token.never_expires')}
            </label>
            {!neverExpires && (
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              />
            )}
          </Field>

          <div className="rounded-lg bg-amber-400/[0.06] border border-amber-400/20 px-3 py-2.5 text-xs text-amber-200/90">
            {t('admin.create_token.warning_before')} <em>{t('admin.create_token.warning_every')}</em> <code className="font-mono">/ee/superadmin/*</code> {t('admin.create_token.warning_after')}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
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
            {submitting ? t('admin.create_token.submitting') : t('admin.create_token.submit')}
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
