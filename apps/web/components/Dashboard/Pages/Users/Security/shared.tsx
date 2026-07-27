'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ExternalLink, ShieldAlert } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
  revalidateTags,
} from '@services/utils/ts/requests'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { queryKeys } from '@/lib/query/keys'

/**
 * Shared state for the two org security tabs (Users → Two-factor / Sign-in
 * methods). Both edit the same backend policy blob but save independently, so
 * the save is a PATCH: only the fields a tab owns are sent.
 *
 * Mirrors the backend payloads in src/routers/mfa.py.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceMember = {
  user_id: number
  email: string | null
  username: string | null
  first_name: string | null
  last_name: string | null
  signup_method: string | null
  mfa_enabled: boolean
  confirmed_at: string | null
}

export type ComplianceResponse = {
  total: number
  enabled: number
  members: ComplianceMember[]
}

export type OrgSecurityPolicy = {
  require_2fa: boolean
  require_2fa_grace_days: number
  require_2fa_enabled_at: string | null
  exempt_external_auth: boolean
  // Which sign-in methods this org accepts. The full set = unrestricted.
  allowed_auth_methods: string[]
  // When off, a central learnhouse.io session can't carry members into this org.
  allow_central_session_sharing: boolean
}

// The CALLING user's own compliance state — context only, not the policy.
export type SelfComplianceState = {
  required: boolean
  satisfied: boolean
  deadline: string | null
  days_remaining: number | null
  blocking: boolean
  exempt_reason: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Kept in sync with EXTERNAL_AUTH_METHODS in
// apps/api/src/services/orgs/mfa_policy.py. An unrecognised signup_method is
// deliberately treated as a local password account, i.e. subject to the policy.
const EXTERNAL_AUTH_METHODS = [
  'google',
  'sso',
  'saml',
  'oidc',
  'workos',
  'keycloak',
  'okta',
  'auth0',
]

export const GRACE_OPTIONS = [0, 7, 14, 30]

// The complete set of sign-in methods. Selecting all of them = unrestricted,
// which is also what an absent policy falls back to. Kept in sync with the
// backend's allowed_auth_methods contract.
export const ALL_AUTH_METHODS = ['password', 'magic_login', 'google', 'sso'] as const

export const AUTH_METHOD_OPTIONS: {
  key: string
  labelKey: string
  labelDefault: string
  hintKey: string
  hintDefault: string
}[] = [
  {
    key: 'password',
    labelKey: 'dashboard.organization.security.method_password',
    labelDefault: 'Email + password',
    hintKey: 'dashboard.organization.security.method_password_hint',
    hintDefault: 'Sign in with an email address and password.',
  },
  {
    key: 'magic_login',
    labelKey: 'dashboard.organization.security.method_magic_login',
    labelDefault: 'Magic login link',
    hintKey: 'dashboard.organization.security.method_magic_login_hint',
    hintDefault: 'Sign in through a one-time link sent by email.',
  },
  {
    key: 'google',
    labelKey: 'dashboard.organization.security.method_google',
    labelDefault: 'Google',
    hintKey: 'dashboard.organization.security.method_google_hint',
    hintDefault: 'Sign in with a Google account.',
  },
  {
    key: 'sso',
    labelKey: 'dashboard.organization.security.method_sso',
    labelDefault: 'SSO',
    hintKey: 'dashboard.organization.security.method_sso_hint',
    hintDefault: 'Sign in through your configured single sign-on provider.',
  },
]

export const DEFAULT_POLICY: OrgSecurityPolicy = {
  require_2fa: false,
  require_2fa_grace_days: 0,
  require_2fa_enabled_at: null,
  exempt_external_auth: true,
  allowed_auth_methods: [...ALL_AUTH_METHODS],
  allow_central_session_sharing: true,
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Two string sets are equal regardless of order/dupes. */
export const sameMethodSet = (a: string[], b: string[]): boolean => {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const v of sa) if (!sb.has(v)) return false
  return true
}

export const isExternalAuth = (signup_method: string | null): boolean =>
  EXTERNAL_AUTH_METHODS.includes((signup_method || '').toLowerCase())

export const memberName = (m: ComplianceMember): string => {
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
  return full || m.username || m.email || `#${m.user_id}`
}

export const formatDate = (value: string | null | undefined): string => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export const addDays = (days: number): Date => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

const normalizePolicy = (raw: any): OrgSecurityPolicy => ({
  require_2fa: !!raw?.require_2fa,
  require_2fa_grace_days: Math.max(0, Number(raw?.require_2fa_grace_days) || 0),
  require_2fa_enabled_at: raw?.require_2fa_enabled_at ?? null,
  exempt_external_auth: raw?.exempt_external_auth !== false,
  // Absent → unrestricted (all methods) + central sharing on.
  allowed_auth_methods: Array.isArray(raw?.allowed_auth_methods)
    ? raw.allowed_auth_methods
    : [...ALL_AUTH_METHODS],
  allow_central_session_sharing: raw?.allow_central_session_sharing !== false,
})

// ---------------------------------------------------------------------------
// Policy hook
// ---------------------------------------------------------------------------

export function useOrgSecurityPolicy() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id
  const org = useOrg() as any
  const orgId = org?.id
  const orgslug = org?.slug
  const queryClient = useQueryClient()

  // First paint only. The org payload is served from a slug-keyed cache and is
  // held by react-query for minutes after a save, so it is a hint, never the
  // answer — the authoritative policy is fetched below.
  const hintPolicy: OrgSecurityPolicy = React.useMemo(() => {
    const security = org?.config?.config?.admin_toggles?.security
    return security ? normalizePolicy(security) : DEFAULT_POLICY
  }, [org])

  const [policy, setPolicy] = React.useState<OrgSecurityPolicy>(hintPolicy)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  // Set when the backend refuses because the admin has no second factor of
  // their own — drives the "enable it on your account first" call to action.
  const [needsOwnMfa, setNeedsOwnMfa] = React.useState(false)
  // Bumped whenever an authoritative policy lands, so each tab knows to reset
  // its drafts to it.
  const [seedVersion, setSeedVersion] = React.useState(0)

  // Same call shape as the account-level two-factor section: getAPIUrl() +
  // RequestBodyWithAuthHeader + getResponseMetadata. Deliberately NOT apiFetch —
  // its errorHandling() turns a 401 into a global "session expired" event, and
  // we want to read the structured `detail.code` on 403 ourselves.
  const mfaFetch = React.useCallback(
    async (path: string, method: 'GET' | 'PUT' | 'POST', body?: any) => {
      const result = await fetch(
        `${getAPIUrl()}auth/mfa${path}`,
        RequestBodyWithAuthHeader(method, body ?? null, null, access_token)
      )
      return getResponseMetadata(result)
    },
    [access_token]
  )

  // The saved policy, straight from the database. Reading it here rather than
  // from the org payload is what stops a save from being followed by the old
  // values reappearing.
  const [policyLoading, setPolicyLoading] = React.useState(true)
  React.useEffect(() => {
    let cancelled = false
    if (!orgId || !access_token) return
    ;(async () => {
      try {
        const res = await mfaFetch(`/org-policy/${orgId}/settings`, 'GET')
        if (cancelled) return
        if (res.success) {
          setPolicy(normalizePolicy(res.data))
          setSeedVersion((v) => v + 1)
        }
      } catch {
        // Keep the hint from the org payload; the tabs stay usable and a save
        // still round-trips through the authoritative PUT response.
      } finally {
        if (!cancelled) setPolicyLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, access_token, mfaFetch])

  /**
   * Save only the fields this tab owns. The backend treats every field as
   * optional and leaves omitted ones untouched, so the other tab's settings
   * survive.
   */
  const savePolicy = React.useCallback(
    async (patch: Partial<OrgSecurityPolicy>): Promise<boolean> => {
      if (!orgId) return false
      setSaving(true)
      setSaveError(null)
      setNeedsOwnMfa(false)
      const loadingToast = toast.loading(
        t('dashboard.organization.security.saving', { defaultValue: 'Saving security policy…' })
      )
      try {
        const res = await mfaFetch(`/org-policy/${orgId}`, 'PUT', patch)

        if (!res.success) {
          const code = res.data?.detail?.code
          const message = getErrorMessage(
            res.data?.detail,
            t('dashboard.organization.security.save_error', {
              defaultValue: 'Could not save the security policy.',
            })
          )
          if (code === 'ADMIN_MFA_REQUIRED_FIRST') setNeedsOwnMfa(true)
          setSaveError(message)
          toast.error(message, { id: loadingToast })
          return false
        }

        setPolicy(normalizePolicy(res.data))
        setSeedVersion((v) => v + 1)

        if (orgslug) await revalidateTags(['organizations'], orgslug)
        if (orgslug) queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(orgslug) })
        toast.success(
          t('dashboard.organization.security.save_success', {
            defaultValue: 'Security policy updated',
          }),
          { id: loadingToast }
        )
        return true
      } catch {
        const message = t('dashboard.organization.security.save_error', {
          defaultValue: 'Could not save the security policy.',
        })
        setSaveError(message)
        toast.error(message, { id: loadingToast })
        return false
      } finally {
        setSaving(false)
      }
    },
    [orgId, orgslug, mfaFetch, t, queryClient]
  )

  return {
    orgId,
    orgslug,
    access_token,
    currentUserId,
    policy,
    policyLoading,
    seedVersion,
    mfaFetch,
    savePolicy,
    saving,
    saveError,
    setSaveError,
    needsOwnMfa,
    setNeedsOwnMfa,
  }
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const TILE_TONES: Record<string, string> = {
  green: 'bg-green-50 text-green-700 border-green-100',
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  red: 'bg-red-50 text-red-700 border-red-100',
  gray: 'bg-gray-50 text-gray-600 border-gray-100',
}

export function StatTile({
  tone,
  icon,
  value,
  label,
}: {
  tone: 'green' | 'blue' | 'red' | 'gray'
  icon: React.ReactNode
  value: number
  label: string
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${TILE_TONES[tone]}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xl font-bold tracking-tight">{value}</span>
      </div>
      <div className="text-xs mt-0.5 opacity-80">{label}</div>
    </div>
  )
}

const BADGE_TONES: Record<string, string> = {
  green: 'bg-green-50 text-green-700',
  blue: 'bg-blue-50 text-blue-700',
  red: 'bg-red-50 text-red-700',
}

export function Badge({
  tone,
  icon,
  children,
}: {
  tone: 'green' | 'blue' | 'red'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  )
}

// The one error that needs a way out, not just a message: the admin must enable
// two-factor on their OWN account before they can require it org-wide.
export function AdminMfaCallout({ href, message }: { href: string; message?: string | null }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200/80 px-4 py-3">
      <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="space-y-2">
        <p className="text-sm text-amber-900">
          {message ||
            t('dashboard.organization.security.admin_mfa_first', {
              defaultValue:
                'Enable two-factor on your own account before requiring it for the organization.',
            })}
        </p>
        <p className="text-xs text-amber-800/80 leading-relaxed">
          {t('dashboard.organization.security.admin_mfa_first_why', {
            defaultValue:
              'Otherwise the policy would lock you out of your own organization the moment it saves — and no admin would be left to turn it back off.',
          })}
        </p>
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
        >
          {t('dashboard.organization.security.admin_mfa_first_cta', {
            defaultValue: 'Set up two-factor on your account',
          })}
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  )
}

// Shared page-level states, so both tabs fail the same way.

export function SecuritySkeleton() {
  return (
    <div className="sm:mx-10 mx-0 space-y-4">
      <div className="bg-white rounded-xl nice-shadow p-6 animate-pulse space-y-4">
        <div className="h-4 w-48 bg-gray-200 rounded" />
        <div className="h-2 w-full bg-gray-100 rounded-full" />
        <div className="h-3 w-64 bg-gray-100 rounded" />
      </div>
      <div className="bg-white rounded-xl nice-shadow p-6 animate-pulse space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-gray-50 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

export function NotAdminNotice() {
  const { t } = useTranslation()
  return (
    <div className="sm:mx-10 mx-0">
      <div className="bg-white rounded-xl nice-shadow p-6 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="font-semibold text-gray-800">
            {t('dashboard.organization.security.not_admin_title', {
              defaultValue: 'You don’t have access to this setting',
            })}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {t('dashboard.organization.security.not_admin_body', {
              defaultValue:
                'Only organization admins can view or change the two-factor requirement.',
            })}
          </p>
        </div>
      </div>
    </div>
  )
}

export function ReadOnlyNotice() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200/80">
      <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
      <p className="text-sm text-amber-800">
        {t('dashboard.organization.security.read_only', {
          defaultValue:
            'You can review this page, but only an organization admin can change the policy.',
        })}
      </p>
    </div>
  )
}
