'use client'
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Key, Plus, Trash } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, Panel, StatusPill, recipes, formatRelative } from '@/design'
import { listTokens } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { SuperadminToken } from '@services/ee/platform/types'
import { useAccessToken, shouldRetry } from '@components/Admin/hooks'
import { ListSkeleton, QueryError, RoleBadge, formatDate } from '@components/Admin/Shared/AdminKit'
import CreateTokenModal from '@components/Admin/SuperadminAPITokens/CreateTokenModal'
import TokenCreatedDialog from '@components/Admin/SuperadminAPITokens/TokenCreatedDialog'
import RevokeTokenConfirm from '@components/Admin/SuperadminAPITokens/RevokeTokenConfirm'
import type { CreatedToken } from '@services/ee/platform/types'

export type { SuperadminToken }

function tokenStatus(t: SuperadminToken): 'active' | 'revoked' | 'expired' {
  if (!t.is_active) return 'revoked'
  if (t.expires_at) {
    const exp = new Date(t.expires_at)
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return 'expired'
  }
  return 'active'
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_6rem_7rem_7rem_6rem] gap-x-4'

export default function TokenList() {
  const { t, i18n } = useTranslation()
  const accessToken = useAccessToken()

  const [createOpen, setCreateOpen] = useState(false)
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null)
  const [revoking, setRevoking] = useState<SuperadminToken | null>(null)

  const q = useQuery({
    queryKey: platformKeys.tokens(),
    queryFn: () => listTokens(accessToken),
    enabled: !!accessToken,
    retry: shouldRetry,
  })
  const all = Array.isArray(q.data) ? q.data : []
  // Revoked and expired tokens pile up; keep them out of the way by default.
  const [showInactive, setShowInactive] = React.useState(false)
  const inactiveCount = all.filter((tok) => tokenStatus(tok) !== 'active').length
  const tokens = showInactive ? all : all.filter((tok) => tokenStatus(tok) === 'active')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {q.isLoading ? t('admin.tokens.loading') : tokens.length === 0 ? t('admin.tokens.none_yet') : t('admin.tokens.count', { count: tokens.length })}
          {inactiveCount > 0 && (
            <button type="button" onClick={() => setShowInactive((v) => !v)} className="ms-2 text-xs font-semibold text-neutral-500 hover:text-neutral-900 underline-offset-2 hover:underline">
              {showInactive ? t('admin.tokens.hide_inactive') : t('admin.tokens.show_inactive', { count: inactiveCount })}
            </button>
          )}
        </p>
        <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setCreateOpen(true)}>
          {t('admin.tokens.create_token')}
        </Button>
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={3} avatar={false} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : tokens.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Key size={22} />}
            title={t('admin.tokens.empty_title')}
            description={t('admin.tokens.empty_desc')}
            action={
              <Button size="sm" variant="primary" icon={<Plus size={13} weight="bold" />} onClick={() => setCreateOpen(true)}>
                {t('admin.tokens.create_token')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel divided>
          <div className={`${recipes.tableHead} hidden md:grid ${GRID}`}>
            <span>{t('admin.tokens.col_name')}</span>
            <span>{t('admin.tokens.col_access')}</span>
            <span>{t('common.status')}</span>
            <span>{t('admin.tokens.col_expires')}</span>
            <span>{t('admin.tokens.col_last_used')}</span>
            <span className="text-end">{t('admin.tokens.col_actions')}</span>
          </div>
          {tokens.map((tok) => {
            const status = tokenStatus(tok)
            const scopes = Array.isArray(tok.scopes) && tok.scopes.length ? tok.scopes : ['api']
            return (
              <div key={tok.token_uuid} className={`${GRID} items-center gap-y-2 px-5 py-3.5 hover:bg-neutral-50/70`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 truncate">{tok.name}</p>
                  <p className="text-xs text-neutral-500 truncate">
                    <code className="font-mono" dir="ltr">
                      {tok.token_prefix}…
                    </code>
                    {tok.description ? ` · ${tok.description}` : ''}
                  </p>
                  <p className="text-[11px] text-neutral-400">{t('admin.tokens.created_on', { date: formatDate(tok.creation_date, i18n.language) })}</p>
                </div>
                <div className="hidden md:flex flex-wrap items-center gap-1 min-w-0">
                  {tok.role && <RoleBadge role={tok.role} />}
                  {scopes.map((s) => (
                    <Chip key={s} className="!font-mono !text-[11px]">
                      {s}
                    </Chip>
                  ))}
                </div>
                <div className="flex justify-end md:justify-start">
                  <StatusPill status={status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'neutral'} dot>
                    {t(`admin.tokens.status_${status}`)}
                  </StatusPill>
                </div>
                <span className="hidden md:block text-xs text-neutral-500">
                  {tok.expires_at ? formatDate(tok.expires_at, i18n.language) : t('admin.tokens.never')}
                </span>
                <span className="hidden md:block text-xs text-neutral-500" title={formatDate(tok.last_used_at, i18n.language, true)}>
                  {formatRelative(tok.last_used_at, i18n.language) ?? t('admin.tokens.never')}
                </span>
                <div className="col-span-2 md:col-span-1 flex items-center justify-between md:justify-end gap-2">
                  <div className="flex md:hidden flex-wrap items-center gap-1">
                    {tok.role && <RoleBadge role={tok.role} />}
                    {scopes.map((s) => (
                      <Chip key={s} className="!font-mono !text-[11px]">
                        {s}
                      </Chip>
                    ))}
                  </div>
                  {status === 'active' && (
                    <Button variant="danger-ghost" size="sm" icon={<Trash size={13} />} onClick={() => setRevoking(tok)}>
                      {t('admin.tokens.revoke')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </Panel>
      )}

      <CreateTokenModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false)
          setCreatedToken(created)
        }}
      />
      <TokenCreatedDialog token={createdToken} onClose={() => setCreatedToken(null)} />
      <RevokeTokenConfirm token={revoking} onClose={() => setRevoking(null)} />
    </div>
  )
}
