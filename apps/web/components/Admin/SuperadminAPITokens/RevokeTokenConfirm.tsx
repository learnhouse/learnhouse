'use client'
import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Warning } from '@phosphor-icons/react'
import type { SuperadminToken } from '@components/Admin/SuperadminAPITokens/TokenList'
import { useTranslation } from 'react-i18next'

export default function RevokeTokenConfirm({
  token,
  onClose,
}: {
  token: SuperadminToken | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!token) return null

  const handleRevoke = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${getAPIUrl()}ee/superadmin/tokens/${token.token_uuid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.detail || t('admin.revoke_token.error_failed', { status: res.status }))
        return
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.superadmin.apiTokens() })
      onClose()
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
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <Warning size={18} weight="fill" className="text-red-400" />
            <h2 className="text-base font-semibold text-white">{t('admin.revoke_token.title')}</h2>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-white/70">
            {t('admin.revoke_token.desc_before')}<strong className="text-white">{token.name}</strong>{t('admin.revoke_token.desc_after')}
          </p>
          <p className="text-xs text-white/40">{t('admin.revoke_token.cannot_undo')}</p>
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
            onClick={handleRevoke}
            disabled={submitting}
            className="px-3.5 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? t('admin.revoke_token.submitting') : t('admin.revoke_token.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
