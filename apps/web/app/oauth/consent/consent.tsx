'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Eye, Loader2, PencilLine, ShieldCheck, UserCog } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import {
  MCP_SCOPE_ADMIN,
  MCP_SCOPE_READ,
  MCP_SCOPE_WRITE,
  MCPConsentRequest,
  getConsentRequest,
  submitConsent,
} from '@services/mcp/mcp'
import { cn } from '@/lib/utils'
import lrnLogo from 'public/lrn.svg'

type Access = 'admin' | 'write' | 'read'

const SCOPES_FOR: Record<Access, string> = {
  read: MCP_SCOPE_READ,
  write: `${MCP_SCOPE_READ} ${MCP_SCOPE_WRITE}`,
  admin: `${MCP_SCOPE_READ} ${MCP_SCOPE_WRITE} ${MCP_SCOPE_ADMIN}`,
}

export default function ConsentClient() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const searchParams = useSearchParams()
  const request = searchParams.get('request') || ''

  const [info, setInfo] = useState<MCPConsentRequest | null>(null)
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [orgId, setOrgId] = useState<number | null>(null)
  const [access, setAccess] = useState<Access>('write')
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const loadedRef = useRef(false)

  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const status: string | undefined = session?.status

  // Not signed in: go through the normal login, then come back here.
  useEffect(() => {
    if (status !== 'unauthenticated') return
    const back = `${window.location.pathname}${window.location.search}`
    window.location.replace(`/login?next=${encodeURIComponent(back)}`)
  }, [status])

  useEffect(() => {
    if (!accessToken || !request || loadedRef.current) return
    loadedRef.current = true
    getConsentRequest(request, accessToken)
      .then((data) => {
        setInfo(data)
        const usable = data.orgs.filter((o) => o.mcp_enabled)
        if (usable.length === 1) setOrgId(usable[0].id)
        if (!data.scopes.includes(MCP_SCOPE_WRITE)) setAccess('read')
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [accessToken, request])

  const canWrite = info?.scopes.includes(MCP_SCOPE_WRITE) ?? false
  const selectedOrg = useMemo(
    () => info?.orgs.find((o) => o.id === orgId) ?? null,
    [info, orgId]
  )
  // Admin access is offered only to admins and maintainers of the picked org.
  const canAdmin = Boolean(info?.scopes.includes(MCP_SCOPE_ADMIN) && selectedOrg?.can_admin)
  // Picking another org can take admin access away again.
  const chosen: Access = access === 'admin' && !canAdmin ? 'write' : access

  const answer = async (approve: boolean) => {
    if (!accessToken || busy) return
    setBusy(approve ? 'approve' : 'deny')
    setSubmitError('')
    try {
      const redirectTo = await submitConsent(
        {
          request,
          approve,
          org_id: approve ? (orgId ?? undefined) : undefined,
          scope: approve ? SCOPES_FOR[chosen] : undefined,
        },
        accessToken
      )
      window.location.assign(redirectTo)
    } catch (e: any) {
      setSubmitError(e?.message || t('oauth_consent.errors.generic'))
      setBusy(null)
    }
  }

  const error = request ? loadError : t('oauth_consent.errors.missing_request')
  if (error) {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <div className="p-3 bg-red-50 rounded-full">
            <AlertTriangle className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">{t('oauth_consent.errors.title')}</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <p className="text-sm text-gray-500">{t('oauth_consent.errors.start_again')}</p>
        </div>
      </Shell>
    )
  }

  if (!info) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </Shell>
    )
  }

  const usableOrgs = info.orgs.filter((o) => o.mcp_enabled)

  return (
    <Shell>
      <div className="flex flex-col items-center text-center gap-2 pb-5 border-b border-gray-100">
        {/* Apps register themselves, so their logo is not loaded: it would
            tell the app's server who is looking, and anyone can claim one. */}
        <div className="w-12 h-12 rounded-xl bg-gray-900 text-white flex items-center justify-center text-lg font-semibold">
          {(info.client.name || '?').slice(0, 1).toUpperCase()}
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          {t('oauth_consent.title', { client: info.client.name })}
        </h1>
        <p className="text-sm text-gray-500">
          {t('oauth_consent.signed_in_as', { user: info.user.email || info.user.username })}
        </p>
        <p className="text-xs text-gray-400" dir="ltr">
          {t('oauth_consent.redirects_to', { host: info.client.redirect_host })}
        </p>
        <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1">
          {t('oauth_consent.unverified')}
        </p>
      </div>

      <section className="pt-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{t('oauth_consent.pick_org')}</h2>
        {info.orgs.length === 0 && (
          <p className="text-sm text-gray-500">{t('oauth_consent.no_orgs')}</p>
        )}
        <div className="flex flex-col gap-2" role="radiogroup">
          {info.orgs.map((org) => {
            const selected = org.id === orgId
            return (
              <button
                key={org.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!org.mcp_enabled}
                onClick={() => setOrgId(org.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors',
                  selected ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300',
                  !org.mcp_enabled && 'opacity-50 cursor-not-allowed hover:border-gray-200'
                )}
              >
                {org.logo_image ? (
                          <img
                    src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
                    alt=""
                    className="w-8 h-8 rounded-md object-contain bg-white border border-gray-100"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-md bg-gray-100 text-gray-600 flex items-center justify-center text-sm font-semibold">
                    {org.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">{org.name}</span>
                  {!org.mcp_enabled && (
                    <span className="block text-xs text-gray-500">{t('oauth_consent.org_disabled')}</span>
                  )}
                </span>
                {selected && <Check className="w-4 h-4 text-gray-900" />}
              </button>
            )
          })}
        </div>
      </section>

      <section className="pt-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{t('oauth_consent.access_title')}</h2>
        <div className="flex flex-col gap-2">
          <AccessOption
            active={chosen === 'write'}
            disabled={!canWrite}
            onClick={() => setAccess('write')}
            icon={<PencilLine className="w-4 h-4" />}
            title={t('oauth_consent.access_write')}
            body={t('oauth_consent.access_write_body')}
          />
          <AccessOption
            active={chosen === 'read'}
            onClick={() => setAccess('read')}
            icon={<Eye className="w-4 h-4" />}
            title={t('oauth_consent.access_read')}
            body={t('oauth_consent.access_read_body')}
          />
          {canAdmin && (
            <AccessOption
              active={chosen === 'admin'}
              onClick={() => setAccess('admin')}
              icon={<UserCog className="w-4 h-4" />}
              title={t('oauth_consent.access_admin')}
              body={t('oauth_consent.access_admin_body')}
            />
          )}
        </div>
        <p className="flex items-start gap-2 mt-3 text-xs text-gray-500">
          <ShieldCheck className="w-4 h-4 flex-none text-gray-400" />
          <span>
            {t('oauth_consent.limits', { org: selectedOrg?.name || t('oauth_consent.the_org') })}
          </span>
        </p>
      </section>

      {submitError && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>
      )}

      <div className="flex gap-2 pt-6">
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={busy !== null}
          className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {busy === 'deny' ? <Loader2 className="w-4 h-4 mx-auto animate-spin" /> : t('oauth_consent.deny')}
        </button>
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={busy !== null || !orgId || usableOrgs.length === 0}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40"
        >
          {busy === 'approve' ? <Loader2 className="w-4 h-4 mx-auto animate-spin" /> : t('oauth_consent.allow')}
        </button>
      </div>
      <p className="pt-4 text-center text-xs text-gray-400">{t('oauth_consent.revoke_hint')}</p>
    </Shell>
  )
}

function AccessOption({
  active,
  disabled,
  onClick,
  icon,
  title,
  body,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-start transition-colors',
        active ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300',
        disabled && 'opacity-40 cursor-not-allowed hover:border-gray-200'
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
        {icon}
        {title}
      </span>
      <span className="text-xs text-gray-500">{body}</span>
    </button>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f8f8] flex flex-col items-center justify-center px-4 py-10">
      <Image src={lrnLogo} alt="LearnHouse" width={36} height={36} className="mb-6 opacity-90" />
      <div className="w-full max-w-md rounded-2xl bg-white nice-shadow p-6">{children}</div>
    </div>
  )
}
