'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CircleNotch, LockSimple, WarningCircle } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { errorMessage, startImpersonation } from '@services/ee/platform/api'
import { usePlatformMe } from '@components/Admin/hooks'
import { consoleUrl, isPlatformContext } from '@/lib/auth/impersonation'

// Platform staff opening an org they don't belong to go straight in: the
// impersonation starts at once as the org's owner (full access when they may
// make changes, read-only otherwise) and the very URL they opened reloads as
// them. Staff without the permission get a plain "no access" page. Members of
// the org are just themselves and never see any of this.

const EXEMPT = /^\/(login|signup|reset|forgot|verify-email|auth|home|new|redirect_from_auth|embed|oauth|payments|admin)(\/|$)/
// Started this recently and still not impersonating: show the error, don't loop.
const RETRY_GUARD_MS = 20_000

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1]
  return raw ? decodeURIComponent(raw) : null
}

export default function ImpersonationAutoEntry() {
  const session = useLHSession() as any
  const [where, setWhere] = React.useState<{ slug: string | null; path: string; platform: boolean } | null>(null)

  React.useEffect(() => {
    setWhere({ slug: readCookie('LH_org'), path: window.location.pathname, platform: isPlatformContext() })
  }, [])

  const data = session?.data
  const roles: any[] = Array.isArray(data?.roles) ? data.roles : []
  const applies =
    session?.status === 'authenticated' &&
    data?.user?.is_superadmin === true &&
    !data?.impersonation &&
    !!where &&
    !where.platform &&
    !!where.slug &&
    !EXEMPT.test(where.path) &&
    !roles.some((r) => r?.org?.slug === where.slug)

  if (!applies) return null
  return <Entry slug={where!.slug!} token={data?.tokens?.access_token} />
}

function Entry({ slug, token }: { slug: string; token?: string }) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const allowed = me.can('impersonation.readonly')
  const [error, setError] = React.useState('')
  const startedRef = React.useRef(false)

  const orgQ = useQuery({
    queryKey: ['impersonation-entry', 'org', slug],
    queryFn: async () => {
      const res = await fetch(`${getAPIUrl()}orgs/slug/${encodeURIComponent(slug)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
    retry: false,
  })
  const org = orgQ.data

  const start = React.useCallback(async () => {
    if (!org?.id) return
    setError('')
    try {
      sessionStorage.setItem(`lh:imp-entry:${slug}`, String(Date.now()))
    } catch {
      /* storage blocked */
    }
    try {
      await startImpersonation(token, { org_id: org.id, return_url: null })
      window.location.reload()
    } catch (err) {
      setError(errorMessage(err, t('admin.common.error_desc')))
    }
  }, [org?.id, slug, token, t])

  React.useEffect(() => {
    if (startedRef.current || me.isLoading || !allowed || !org?.id) return
    startedRef.current = true
    let recent = false
    try {
      recent = Date.now() - Number(sessionStorage.getItem(`lh:imp-entry:${slug}`) || 0) < RETRY_GUARD_MS
    } catch {
      recent = false
    }
    if (recent) {
      setError(t('impersonation.entry_failed'))
      return
    }
    void start()
  }, [me.isLoading, allowed, org?.id, slug, start, t])

  const back = consoleUrl(org?.id ? `/admin/organizations/${org.id}` : '/admin', readCookie('LH_frontend_domain'))
  const blocked = !me.isLoading && !allowed
  const failed = !!error || orgQ.isError

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      // Inline scrim colour: a dark utility class here would switch the dark
      // theme's palette off for everything inside (see styles/dark.css).
      style={{ zIndex: 'calc(var(--z-max) - 1)' as any, background: blocked || failed ? 'rgba(10,10,12,0.55)' : 'rgba(10,10,12,0.25)' }}
      data-testid="impersonation-entry"
    >
      {blocked || failed ? (
        <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 text-start text-neutral-700 shadow-[0_24px_60px_rgba(0,0,0,0.28)] ring-1 ring-black/5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-600">
              {blocked ? <LockSimple size={18} /> : <WarningCircle size={18} />}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-neutral-900" data-testid={blocked ? 'impersonation-no-access' : 'impersonation-entry-error'}>
                {blocked ? t('impersonation.no_access_title', { org: org?.name ?? slug }) : t('impersonation.entry_failed')}
              </p>
              <p className="mt-0.5 text-[13px] text-neutral-600">{blocked ? t('impersonation.no_access_desc') : error}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <a href={back} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-700 hover:text-neutral-900">
              <ArrowLeft size={14} className="rtl:rotate-180" />
              {t('impersonation.back_to_console')}
            </a>
            {!blocked && (
              <button type="button" onClick={() => void start()} className="rounded-xl bg-neutral-950 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-neutral-800">
                {t('impersonation.retry')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div role="status" className="flex items-center gap-2 rounded-full bg-neutral-950/95 px-3.5 py-2 text-[13px] font-medium text-white shadow-lg ring-1 ring-white/15">
          <CircleNotch size={14} className="animate-spin text-amber-400" />
          {t('impersonation.entering', { org: org?.name ?? slug })}
        </div>
      )}
    </div>
  )
}
