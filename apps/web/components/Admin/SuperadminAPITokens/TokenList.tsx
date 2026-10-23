'use client'
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Key, Plus, Trash, CircleNotch } from '@phosphor-icons/react'
import CreateTokenModal from '@components/Admin/SuperadminAPITokens/CreateTokenModal'
import TokenCreatedDialog, { CreatedToken } from '@components/Admin/SuperadminAPITokens/TokenCreatedDialog'
import RevokeTokenConfirm from '@components/Admin/SuperadminAPITokens/RevokeTokenConfirm'
import { useTranslation } from 'react-i18next'

export interface SuperadminToken {
  id: number
  token_uuid: string
  name: string
  description: string | null
  token_prefix: string
  created_by_user_id: number
  creation_date: string
  update_date: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
}

function tokenStatus(t: SuperadminToken): 'active' | 'revoked' | 'expired' {
  if (!t.is_active) return 'revoked'
  if (t.expires_at) {
    const exp = new Date(t.expires_at)
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return 'expired'
  }
  return 'active'
}

function fmtDate(s: string | null | undefined, naLabel: string): string {
  if (!s) return naLabel
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString()
}

export default function TokenList() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const [createOpen, setCreateOpen] = useState(false)
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null)
  const [revoking, setRevoking] = useState<SuperadminToken | null>(null)

  const { data, isLoading, isError } = useQuery<SuperadminToken[]>({
    queryKey: queryKeys.superadmin.apiTokens(),
    queryFn: () => apiFetch(`${getAPIUrl()}ee/superadmin/tokens/`, accessToken),
    enabled: !!accessToken,
  })

  const tokens = data ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-white/50">
          {tokens.length === 0 ? t('admin.token_list.none_yet') : t('admin.token_list.token_count', { count: tokens.length })}
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors"
        >
          <Plus size={14} weight="bold" />
          {t('admin.token_list.create_token')}
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-white/40 text-sm py-12 justify-center">
          <CircleNotch size={16} className="animate-spin" />
          {t('admin.token_list.loading')}
        </div>
      )}

      {isError && (
        <div className="text-sm text-red-400 py-8 text-center">
          {t('admin.token_list.load_failed')}
        </div>
      )}

      {!isLoading && !isError && tokens.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl py-16 text-center">
          <Key size={28} weight="fill" className="text-white/30 mx-auto mb-3" />
          <p className="text-white/60 text-sm">{t('admin.token_list.empty_title')}</p>
          <p className="text-white/30 text-xs mt-1">
            {t('admin.token_list.empty_hint')}
          </p>
        </div>
      )}

      {!isLoading && !isError && tokens.length > 0 && (
        <div className="overflow-hidden border border-white/[0.08] rounded-2xl bg-[#111112]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-white/40 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-start px-4 py-3 font-medium">{t('admin.token_list.col_name')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('admin.token_list.col_prefix')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('admin.token_list.col_status')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('admin.common.col_created')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('admin.token_list.col_expires')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('admin.token_list.col_last_used')}</th>
                <th className="text-end px-4 py-3 font-medium">{t('admin.token_list.col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {tokens.map((tok) => {
                const status = tokenStatus(tok)
                return (
                  <tr key={tok.token_uuid} className="text-white/80">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{tok.name}</div>
                      {tok.description && (
                        <div className="text-xs text-white/40 mt-0.5">{tok.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white/60">{tok.token_prefix}…</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">{fmtDate(tok.creation_date, t('admin.common.na'))}</td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      {tok.expires_at ? fmtDate(tok.expires_at, t('admin.common.na')) : t('admin.token_list.never')}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">{fmtDate(tok.last_used_at, t('admin.common.na'))}</td>
                    <td className="px-4 py-3 text-end">
                      {status === 'active' && (
                        <button
                          onClick={() => setRevoking(tok)}
                          className="text-red-400/80 hover:text-red-400 inline-flex items-center gap-1 text-xs"
                          title={t('admin.token_list.revoke')}
                        >
                          <Trash size={14} weight="fill" />
                          {t('admin.token_list.revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateTokenModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(t) => {
          setCreateOpen(false)
          setCreatedToken(t)
        }}
      />

      <TokenCreatedDialog
        token={createdToken}
        onClose={() => setCreatedToken(null)}
      />

      <RevokeTokenConfirm
        token={revoking}
        onClose={() => setRevoking(null)}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: 'active' | 'revoked' | 'expired' }) {
  const { t } = useTranslation()
  const cfg = {
    active: { label: t('admin.token_list.status_active'), cls: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20' },
    revoked: { label: t('admin.token_list.status_revoked'), cls: 'bg-white/[0.04] text-white/40 border-white/10' },
    expired: { label: t('admin.token_list.status_expired'), cls: 'bg-amber-400/10 text-amber-300 border-amber-400/20' },
  }[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}
