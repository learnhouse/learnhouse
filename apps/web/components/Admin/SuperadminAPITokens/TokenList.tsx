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

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString()
}

export default function TokenList() {
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
          {tokens.length === 0 ? 'No tokens yet' : `${tokens.length} token${tokens.length === 1 ? '' : 's'}`}
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors"
        >
          <Plus size={14} weight="bold" />
          Create token
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-white/40 text-sm py-12 justify-center">
          <CircleNotch size={16} className="animate-spin" />
          Loading tokens…
        </div>
      )}

      {isError && (
        <div className="text-sm text-red-400 py-8 text-center">
          Failed to load tokens.
        </div>
      )}

      {!isLoading && !isError && tokens.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl py-16 text-center">
          <Key size={28} weight="fill" className="text-white/30 mx-auto mb-3" />
          <p className="text-white/60 text-sm">No superadmin API tokens yet.</p>
          <p className="text-white/30 text-xs mt-1">
            Create one to automate org provisioning and feature toggling.
          </p>
        </div>
      )}

      {!isLoading && !isError && tokens.length > 0 && (
        <div className="overflow-hidden border border-white/[0.08] rounded-2xl bg-[#111112]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-white/40 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Prefix</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="text-left px-4 py-3 font-medium">Expires</th>
                <th className="text-left px-4 py-3 font-medium">Last used</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {tokens.map((t) => {
                const status = tokenStatus(t)
                return (
                  <tr key={t.token_uuid} className="text-white/80">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-white/40 mt-0.5">{t.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white/60">{t.token_prefix}…</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">{fmtDate(t.creation_date)}</td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      {t.expires_at ? fmtDate(t.expires_at) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">{fmtDate(t.last_used_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {status === 'active' && (
                        <button
                          onClick={() => setRevoking(t)}
                          className="text-red-400/80 hover:text-red-400 inline-flex items-center gap-1 text-xs"
                          title="Revoke token"
                        >
                          <Trash size={14} weight="fill" />
                          Revoke
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
  const cfg = {
    active: { label: 'Active', cls: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20' },
    revoked: { label: 'Revoked', cls: 'bg-white/[0.04] text-white/40 border-white/10' },
    expired: { label: 'Expired', cls: 'bg-amber-400/10 text-amber-300 border-amber-400/20' },
  }[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}
