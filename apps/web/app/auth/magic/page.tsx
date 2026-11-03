'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation, Trans } from 'react-i18next'
import { Loader2, AlertTriangle, RefreshCw, UserRound } from 'lucide-react'
import { useAuth } from '@components/Contexts/AuthContext'
import { removeQueryParamsFromAddressBar } from '@services/utils/ts/scrubUrl'

/**
 * Consumes a sign-in link: reads ?token from the URL and hands it to
 * completeMagicLink(). Serves both the emailed login link and the link an org
 * issues through the admin API. Mirrors the loading/redirect pattern of the
 * Google OAuth callback page.
 *
 *   - 2FA account   → bounce to /login?mfa_token=… (the login page picks it up),
 *   - success       → forward through the same /redirect_from_auth handoff every
 *                     other flow uses,
 *   - expired/used  → friendly "request a new one" state linking back to /login,
 *   - server error  → "try again" with the same token (the link was not spent).
 *
 * The token is read from window.location (not useSearchParams) to stay off the
 * Suspense/CSR-bailout path, matching how the login page reads ?mfa_token.
 */

type PageState = 'waiting' | 'loading' | 'confirm' | 'success' | 'retry' | 'error'

// Waiting for the auth context matters (see below), but never strand the
// visitor on a spinner if it cannot settle. Generous, because redeeming while
// a previous session's refresh is still in flight is what the wait prevents.
const AUTH_SETTLE_TIMEOUT_MS = 15000

const isSafePath = (value: string | null | undefined): value is string =>
  !!value && /^\/(?!\/)/.test(value)

// The address the link was issued for, for display only. The JWT payload is
// readable without the key; the server verifies the signature on redemption.
function linkEmail(token: string): string | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const sub = JSON.parse(new TextDecoder().decode(bytes))?.sub
    return typeof sub === 'string' && sub ? sub : null
  } catch {
    return null
  }
}

export default function MagicLinkConsumePage() {
  const { t } = useTranslation()
  const { completeMagicLink, status: authStatus, session } = useAuth()
  const [state, setState] = useState<PageState>('waiting')
  const [error, setError] = useState<string | null>(null)
  const [authTimedOut, setAuthTimedOut] = useState(false)
  const [tokenRead, setTokenRead] = useState(false)
  const [targetEmail, setTargetEmail] = useState<string | null>(null)
  // Captured once and scrubbed from the address bar immediately. Refs survive
  // React strict mode's dev remount, so the second mount still has it.
  const tokenRef = useRef<string | null>(null)
  const nextRef = useRef<string | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    if (tokenRef.current === null) {
      const params = new URLSearchParams(window.location.search)
      tokenRef.current = params.get('token') ?? ''
      nextRef.current = params.get('next') ?? params.get('redirect') ?? params.get('redirect_to')
      removeQueryParamsFromAddressBar(['token'])
    }
    setTargetEmail(linkEmail(tokenRef.current))
    setTokenRead(true)
    const timer = setTimeout(() => setAuthTimedOut(true), AUTH_SETTLE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  const redeem = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    setState('loading')

    const res = await completeMagicLink(token, { callbackUrl: '/', redirect: false })

    // Honor a sanitized ?next (else the link's own redirect_to) through the
    // cross-domain handoff, the same rule the login page applies (internal
    // same-origin path only, default /home).
    const next = isSafePath(nextRef.current)
      ? nextRef.current
      : isSafePath(res.redirect_to)
        ? res.redirect_to
        : null

    // 2FA account: the login page already knows how to finish from an mfa_token.
    if (res.mfa_required && res.mfa_token) {
      const loginUrl = new URL('/login', window.location.origin)
      loginUrl.searchParams.set('mfa_token', res.mfa_token)
      if (next) loginUrl.searchParams.set('next', next)
      window.location.href = loginUrl.toString()
      return
    }

    if (res.ok) {
      setState('success')
      window.location.href = `${window.location.origin}/redirect_from_auth?next=${encodeURIComponent(next ?? '/home')}`
      return
    }

    let message = t('auth.magic.expired')
    try {
      const parsed = JSON.parse(res.error || '{}')
      if (parsed.message) message = parsed.message
    } catch {
      // keep the default message
    }
    setError(message)
    // Offer to try again only when the link was certainly not spent: the
    // server said it could not record the use, or the request never got an
    // answer. Any other failure may have come after the link was spent.
    let code: string | null = null
    try {
      code = JSON.parse(res.error || '{}').code ?? null
    } catch {
      code = null
    }
    const notSpent =
      code === 'SIGN_IN_UNAVAILABLE' || (res.status === 0 && code === 'NETWORK_ERROR')
    setState(notSpent ? 'retry' : 'error')
  }, [completeMagicLink, t])

  useEffect(() => {
    // Single-use link: never run the verify twice (React strict-mode double-mount).
    if (!tokenRead || ranRef.current) return

    if (!tokenRef.current) {
      ranRef.current = true
      setError(t('auth.magic.missing_token'))
      setState('error')
      return
    }

    // Redeem only once the auth context has settled. While it is still
    // restoring a previous session, its refresh would race this sign-in and
    // could land after it, putting the previous account's cookies back (or
    // clearing them all).
    if (authStatus === 'loading' && !authTimedOut) return

    // Someone else is signed in on this browser (a shared or classroom
    // device): switch accounts only when asked to.
    const current = session?.user?.email
    if (
      authStatus === 'authenticated' &&
      current &&
      targetEmail &&
      current.toLowerCase() !== targetEmail.toLowerCase()
    ) {
      setState('confirm')
      return
    }

    ranRef.current = true
    redeem()
  }, [tokenRead, authStatus, authTimedOut, session, targetEmail, redeem, t])

  const continueAsLinkUser = () => {
    ranRef.current = true
    redeem()
  }

  if (state === 'confirm') {
    const target = targetEmail
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-gray-100 rounded-full">
              <UserRound className="w-12 h-12 text-gray-700" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">{t('auth.magic.switch_account')}</h1>
          <p className="text-gray-600 mb-6">
            <Trans
              i18nKey="auth.magic.switch_account_desc"
              values={{ current: session?.user?.email, target }}
              components={{ b: <span className="font-medium" /> }}
            />
          </p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={continueAsLinkUser}
              className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
            >
              {t('auth.magic.continue_as', { email: target })}
            </button>
            <Link
              href="/home"
              className="block w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              {t('auth.magic.stay_signed_in_as', { email: session?.user?.email })}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'retry') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <RefreshCw className="w-12 h-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">{t('auth.magic.retry_title')}</h1>
          <p className="text-gray-600 mb-6">
            {t('auth.magic.retry_desc', { error })}
          </p>
          <button
            type="button"
            onClick={redeem}
            className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
          >
            {t('auth.magic.try_again')}
          </button>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <AlertTriangle className="w-12 h-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            {t('auth.magic.invalid_title')}
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="space-y-3">
            <Link
              href="/login"
              className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
            >
              {t('auth.magic.request_new_link')}
            </Link>
            <Link
              href="/"
              className="block w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              {t('auth.magic.go_home')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2 className="w-12 h-12 text-green-600 animate-spin" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">{t('auth.magic.success')}</h1>
          <p className="text-gray-500">{t('auth.magic.redirecting')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Loader2 className="w-12 h-12 text-gray-600 animate-spin" />
        </div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">{t('auth.magic.signing_in')}</h1>
        <p className="text-gray-500">{t('auth.magic.verifying')}</p>
      </div>
    </div>
  )
}
