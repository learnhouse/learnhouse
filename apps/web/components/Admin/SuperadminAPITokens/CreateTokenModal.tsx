'use client'
import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Key, Warning } from '@phosphor-icons/react'
import { Trans, useTranslation } from 'react-i18next'
import { Button, FieldLabel, INPUT, Modal, TEXTAREA } from '@/design'
import { createToken, errorMessage } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { PLATFORM_ROLES, TOKEN_SCOPES, type CreatedToken, type TokenScope } from '@services/ee/platform/types'
import { useAccessToken, usePlatformMe } from '@components/Admin/hooks'

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, support: 2, sales: 3, viewer: 4 }

export default function CreateTokenModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (_token: CreatedToken) => void
}) {
  const { t, i18n } = useTranslation()
  const accessToken = useAccessToken()
  const me = usePlatformMe()
  const queryClient = useQueryClient()

  // A token can never outrank its creator.
  const myRank = ROLE_RANK[me.role] ?? 4
  const roles = PLATFORM_ROLES.filter((r) => ROLE_RANK[r] >= myRank)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [neverExpires, setNeverExpires] = useState(true)
  const [expiresAt, setExpiresAt] = useState('')
  const [role, setRole] = useState<string>(me.role)
  const [scopes, setScopes] = useState<TokenScope[]>(['api'])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setNeverExpires(true)
      setExpiresAt('')
      setRole(roles.includes(me.role as any) ? me.role : roles[0] ?? 'viewer')
      setScopes(['api'])
      setError('')
      setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggleScope = (s: TokenScope, on: boolean) => {
    setScopes((cur) => {
      let next = on ? Array.from(new Set([...cur, s])) : cur.filter((x) => x !== s)
      // mcp:write only makes sense on top of mcp.
      if (s === 'mcp:write' && on && !next.includes('mcp')) next = [...next, 'mcp']
      if (s === 'mcp' && !on) next = next.filter((x) => x !== 'mcp:write')
      return TOKEN_SCOPES.filter((x) => next.includes(x))
    })
  }

  // Viewer tokens are read-only (spec §1): no MCP writes. An expiry must be
  // in the future, or the token would be born dead.
  const viewerWrite = role === 'viewer' && scopes.includes('mcp:write')
  const expiryInPast = !neverExpires && !!expiresAt && new Date(expiresAt).getTime() <= Date.now()
  const canSubmit =
    name.trim().length > 0 && scopes.length > 0 && !submitting && (neverExpires || expiresAt.length > 0) && !viewerWrite && !expiryInPast

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const body: { name: string; description?: string; expires_at?: string; role?: string; scopes?: string[] } = {
        name: name.trim(),
        role,
        scopes,
      }
      if (description.trim()) body.description = description.trim()
      if (!neverExpires && expiresAt) {
        // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm"; send as ISO.
        body.expires_at = new Date(expiresAt).toISOString()
      }
      const data = await createToken(accessToken, body)
      queryClient.invalidateQueries({ queryKey: platformKeys.tokens() })
      onCreated(data)
    } catch (e) {
      const msg = errorMessage(e, t('admin.tokens.failed_create', { status: (e as any)?.status ?? '' }))
      // Rate limits come back as "… in 1891 seconds"; say it the human way.
      const secs = /(\d+)\s*seconds?/i.exec(msg)
      if ((e as any)?.status === 429 && secs) {
        const minutes = Math.max(1, Math.round(Number(secs[1]) / 60))
        setError(t('admin.tokens.rate_limited', { when: new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(minutes, 'minute') }))
      } else {
        setError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      icon={<Key size={18} />}
      dialogTitle={t('admin.tokens.new_token')}
      preventClose={submitting}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={submitting} disabled={!canSubmit} onClick={handleSubmit}>
            {t('admin.tokens.create_token')}
          </Button>
        </div>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel hint={t('admin.tokens.name_hint')}>{t('admin.tokens.name')}</FieldLabel>
            <input autoFocus className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-automation" />
          </div>
          <div>
            <FieldLabel hint={t('common.optional')}>{t('admin.tokens.description')}</FieldLabel>
            <textarea className={TEXTAREA} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('admin.tokens.description_placeholder')} />
          </div>

          <div>
            <FieldLabel hint={t('admin.tokens.role_hint')}>{t('admin.tokens.role')}</FieldLabel>
            <select
              className={INPUT}
              value={role}
              onChange={(e) => {
                setRole(e.target.value)
                if (e.target.value === 'viewer') setScopes((cur) => cur.filter((x) => x !== 'mcp:write'))
              }}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.roles.${r}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel>{t('admin.tokens.scopes')}</FieldLabel>
            <div className="flex flex-col gap-2">
              {TOKEN_SCOPES.map((s) => (
                <label key={s} className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-neutral-900"
                    checked={scopes.includes(s)}
                    onChange={(e) => toggleScope(s, e.target.checked)}
                    disabled={s === 'mcp:write' && role === 'viewer'}
                  />
                  <span className="min-w-0">
                    <code className="block text-[13px] font-semibold text-neutral-900 font-mono" dir="ltr">
                      {s}
                    </code>
                    <span className="block text-xs text-neutral-500">{t(`admin.tokens.scope_desc.${s.replace(':', '_')}`)}</span>
                  </span>
                </label>
              ))}
            </div>
            {role === 'viewer' && <p className="mt-1.5 text-xs text-neutral-500">{t('admin.tokens.viewer_read_only')}</p>}
          </div>

          <div>
            <FieldLabel>{t('admin.tokens.expiration')}</FieldLabel>
            <label className="flex items-center gap-2 text-sm text-neutral-700 mb-2">
              <input type="checkbox" className="accent-neutral-900" checked={neverExpires} onChange={(e) => setNeverExpires(e.target.checked)} />
              {t('admin.tokens.never_expires')}
            </label>
            {!neverExpires && (
              <input
                type="datetime-local"
                className={INPUT}
                value={expiresAt}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            )}
            {expiryInPast && <p className="mt-1.5 text-xs font-medium text-rose-600">{t('admin.tokens.expiry_past')}</p>}
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/10">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              {role === 'owner' || role === 'admin' ? (
                <Trans i18nKey="admin.tokens.warning" components={{ em: <em />, code: <code className="font-mono" /> }} />
              ) : (
                t('admin.tokens.warning_role', { role: t(`admin.roles.${role}`) })
              )}
            </span>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      }
    />
  )
}
