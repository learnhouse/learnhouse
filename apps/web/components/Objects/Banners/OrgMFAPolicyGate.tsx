'use client'
import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck, X, LogOut, ArrowRight, LogIn } from 'lucide-react'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { signOut } from '@components/Contexts/AuthContext'
import { getAPIUrl, getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

/**
 * End-user surface for the org-wide "two-factor is mandatory" policy.
 *
 * Renders NOTHING in the overwhelmingly common case (policy off, or the user is
 * already compliant/exempt). To keep that case cheap it:
 *   - never runs on the server and never blocks first paint (it returns null
 *     until the query resolves),
 *   - fetches the compliance state once per org per session (staleTime/gcTime
 *     Infinity, no refetch on mount/focus/reconnect),
 *   - fails OPEN — a network/API error renders nothing rather than locking
 *     someone out of an org over a failed request.
 *
 * Two states are user-visible:
 *   - inside the grace window  → dismissible countdown banner,
 *   - deadline passed          → full-page blocking interstitial.
 *
 * The interstitial deliberately does NOT trap the user: it is mounted below the
 * org navigation in the stacking order (so the profile menu and its sign-out
 * stay clickable), it is never rendered on the /account/* routes that contain
 * the security page which unblocks them, and it carries its own explicit
 * "Set up two-factor" and "Sign out" actions.
 */

export interface MFAComplianceState {
  required: boolean
  satisfied: boolean
  deadline: string | null
  days_remaining: number | null
  blocking: boolean
  exempt_reason: string | null
}

// The new org-scoped auth policy can refuse this request outright. When it does,
// the org-policy endpoint answers 403 with one of these codes — we surface a
// scoped "sign in to this org" call-to-action rather than failing fully open.
export interface OrgAuthPolicyBlock {
  code: 'AUTH_METHOD_NOT_ALLOWED' | 'SESSION_NOT_BOUND_TO_ORG'
  message: string
  allowed_methods?: string[]
}

// The compliance query result, optionally carrying an auth-policy block.
export type OrgPolicyState = MFAComplianceState & { authBlock?: OrgAuthPolicyBlock }

const COMPLIANT: MFAComplianceState = {
  required: false,
  satisfied: true,
  deadline: null,
  days_remaining: null,
  blocking: false,
  exempt_reason: null,
}

async function getOrgMFACompliance(
  org_id: number,
  access_token?: string
): Promise<OrgPolicyState> {
  const result = await fetch(
    `${getAPIUrl()}auth/mfa/org-policy/${org_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  // Fail open on purpose: this endpoint only drives an advisory banner/blocker,
  // and `errorHandling()` would additionally force a sign-out on a spurious 401.
  if (!result.ok) {
    // A 403 from the new auth-method / session-binding policy is NOT a spurious
    // error — it's the org telling us this session can't be here. Surface it as a
    // scoped re-sign-in prompt (still failing open for every other error).
    if (result.status === 403) {
      try {
        const body = await result.json()
        const detail = body?.detail
        if (
          detail?.code === 'AUTH_METHOD_NOT_ALLOWED' ||
          detail?.code === 'SESSION_NOT_BOUND_TO_ORG'
        ) {
          return {
            ...COMPLIANT,
            authBlock: {
              code: detail.code,
              message:
                typeof detail.message === 'string' && detail.message
                  ? detail.message
                  : 'You need to sign in to this organization to continue.',
              allowed_methods: Array.isArray(detail.allowed_methods)
                ? detail.allowed_methods
                : undefined,
            },
          }
        }
      } catch {
        /* unparseable 403 — fall through to fail-open */
      }
    }
    return COMPLIANT
  }
  return (await result.json()) as OrgPolicyState
}

/** Cached per org, for the lifetime of the session. */
function useOrgMFACompliance(org_id?: number) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  return useQuery<OrgPolicyState>({
    queryKey: ['mfa', 'org-policy', org_id],
    queryFn: () => getOrgMFACompliance(org_id as number, access_token),
    enabled: session?.status === 'authenticated' && !!org_id && !!access_token,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
}

const dismissKey = (org_id: number) => `lh_mfa_policy_banner_dismissed_${org_id}`

function CountdownBanner({
  orgName,
  orgslug,
  org_id,
  days,
  overdue = false,
}: {
  orgName: string
  orgslug: string
  org_id: number
  days: number | null
  /** Deadline already passed — the reminder can no longer be dismissed. */
  overdue?: boolean
}) {
  const { t } = useTranslation()
  // sessionStorage is only read after mount so the server/client markup match,
  // and using sessionStorage (not localStorage) means the reminder comes back
  // on the next session — nobody can permanently silence it.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (overdue) {
      setDismissed(false)
      return
    }
    try {
      setDismissed(window.sessionStorage.getItem(dismissKey(org_id)) === '1')
    } catch {
      setDismissed(false)
    }
  }, [org_id, overdue])

  const dismiss = () => {
    setDismissed(true)
    try {
      window.sessionStorage.setItem(dismissKey(org_id), '1')
    } catch {
      // Private mode / storage disabled — the banner simply reappears.
    }
  }

  if (dismissed) return null

  const message = overdue
    ? t('mfa.policy.banner_message_overdue', {
        defaultValue:
          '{{org}} requires two-factor authentication and the deadline has passed. Enable it below to regain access.',
        org: orgName,
      })
    : days === null || days <= 0
      ? t('mfa.policy.banner_message_today', {
          defaultValue:
            '{{org}} requires two-factor authentication. You need to set it up today.',
          org: orgName,
        })
      : days === 1
        ? t('mfa.policy.banner_message_one_day', {
            defaultValue:
              '{{org}} requires two-factor authentication. You have 1 day left to set it up.',
            org: orgName,
          })
        : t('mfa.policy.banner_message', {
            defaultValue:
              '{{org}} requires two-factor authentication. You have {{days}} days left to set it up.',
            org: orgName,
            days,
          })

  return (
    <div className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white">
      <div className="w-full max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3">
        <ShieldAlert size={20} className="flex-shrink-0" />
        <p className="text-sm font-medium flex-1">{message}</p>
        <a
          href={getUriWithOrg(orgslug, '/account/security')}
          className="flex items-center gap-1 text-sm font-bold bg-white/20 hover:bg-white/30 transition-colors rounded-lg px-3 py-1.5 whitespace-nowrap"
        >
          {t('mfa.policy.set_up_now', { defaultValue: 'Set up now' })}
          <ArrowRight size={14} />
        </a>
        {!overdue && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
            className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  )
}

function BlockingInterstitial({
  orgName,
  orgslug,
}: {
  orgName: string
  orgslug: string
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const email = session?.data?.user?.email

  return (
    <section
      aria-labelledby="mfa-policy-block-title"
      className="fixed inset-0 bg-slate-50/95 backdrop-blur-md flex items-start justify-center overflow-y-auto px-4 pt-[100px] pb-12"
      // Below --z-nav (50) on purpose: the org navigation — and the profile
      // menu's sign-out inside it — must stay reachable above this overlay.
      style={{ zIndex: 'var(--z-interactive)' }}
    >
      <div className="w-full max-w-lg bg-white rounded-2xl nice-shadow outline outline-1 outline-neutral-200/40 p-8 flex flex-col items-center text-center space-y-5">
        <div className="bg-amber-100 p-3 rounded-2xl">
          <ShieldAlert className="text-amber-700" size={34} />
        </div>

        <div className="space-y-2">
          <h1
            id="mfa-policy-block-title"
            className="text-2xl font-bold text-gray-900"
          >
            {t('mfa.policy.blocked_title', {
              defaultValue: 'Two-factor authentication is required',
            })}
          </h1>
          <p className="text-gray-600 text-sm max-w-prose">
            {t('mfa.policy.blocked_description', {
              defaultValue:
                'The deadline set by {{org}} for enabling two-factor authentication has passed. To keep using {{org}}, add a second factor to your account — it only takes a minute.',
              org: orgName,
            })}
          </p>
          <p className="text-gray-400 text-xs max-w-prose">
            {t('mfa.policy.blocked_scope_note', {
              defaultValue:
                'This only affects {{org}}. Your other organizations are unaffected.',
              org: orgName,
            })}
          </p>
        </div>

        <a
          href={getUriWithOrg(orgslug, '/account/security')}
          className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-sm rounded-xl px-5 py-3 transition-colors"
        >
          <ShieldCheck size={18} />
          {t('mfa.policy.set_up_2fa', {
            defaultValue: 'Set up two-factor authentication',
          })}
        </a>

        <div className="w-full pt-1 border-t border-gray-100 flex flex-col items-center gap-1.5 text-xs text-gray-400">
          {email && (
            <span>
              {t('mfa.policy.signed_in_as', {
                defaultValue: 'Signed in as {{email}}',
                email,
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
            }
            className="flex items-center gap-1.5 font-semibold text-gray-500 hover:text-gray-900 transition-colors"
          >
            <LogOut size={13} />
            {t('common.sign_out', { defaultValue: 'Sign out' })}
          </button>
        </div>
      </div>
    </section>
  )
}

// This org's policy refused the current session (wrong auth method, or a central
// learnhouse.io session that isn't bound to this org). Send the user to THIS
// org's own login page — never a global logout, since they may belong to other
// orgs that are perfectly happy with their session.
function OrgAuthMethodBanner({
  message,
  orgslug,
}: {
  message: string
  orgslug: string
}) {
  const { t } = useTranslation()
  return (
    <div className="w-full bg-gradient-to-r from-indigo-500 to-violet-500 text-white">
      <div className="w-full max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3">
        <ShieldAlert size={20} className="flex-shrink-0" />
        <p className="text-sm font-medium flex-1">{message}</p>
        <a
          href={getUriWithOrg(orgslug, '/login')}
          className="flex items-center gap-1 text-sm font-bold bg-white/20 hover:bg-white/30 transition-colors rounded-lg px-3 py-1.5 whitespace-nowrap"
        >
          <LogIn size={14} />
          {t('mfa.policy.sign_in_to_org', {
            defaultValue: 'Sign in to this organization',
          })}
        </a>
      </div>
    </div>
  )
}

export function OrgMFAPolicyGate() {
  const { org, orgslug } = useOrgMembership()
  const pathname = usePathname()
  const { data } = useOrgMFACompliance(org?.id)

  if (!data) return null

  const orgName = org?.name || orgslug

  // The org's auth policy refused this session — prompt a scoped re-sign-in.
  // Shown everywhere EXCEPT the org's own login route (where they fix it).
  if (data.authBlock) {
    const segments = (pathname || '').split('/').filter(Boolean)
    const onLoginRoute = segments.includes('login')
    if (onLoginRoute) return null
    return <OrgAuthMethodBanner message={data.authBlock.message} orgslug={orgslug} />
  }

  // Nothing to show: policy off, or the user is compliant/exempt.
  if (!data.required || data.satisfied) return null

  if (!data.blocking) {
    return (
      <CountdownBanner
        orgName={orgName}
        orgslug={orgslug}
        org_id={org.id}
        days={data.days_remaining}
      />
    )
  }

  // NEVER block the routes the user needs to unblock themselves. The account
  // area holds the security page where two-factor is enrolled; blocking it
  // would leave them with no way out but signing out.
  const segments = (pathname || '').split('/').filter(Boolean)
  const isEscapeRoute = ['account', 'login', 'logout', 'signup'].some((s) =>
    segments.includes(s)
  )
  if (isEscapeRoute) {
    return (
      <CountdownBanner
        orgName={orgName}
        orgslug={orgslug}
        org_id={org.id}
        days={0}
        overdue
      />
    )
  }

  return <BlockingInterstitial orgName={orgName} orgslug={orgslug} />
}

export default OrgMFAPolicyGate
