'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '@components/Contexts/AuthContext'

/**
 * Consumes a passwordless login link: reads ?token from the URL and hands it to
 * completeMagicLink(). Mirrors the loading/redirect pattern of the Google OAuth
 * callback page.
 *
 *   - 2FA account  → bounce to /login?mfa_token=… (the login page picks it up),
 *   - success      → forward through the same /redirect_from_auth handoff every
 *                    other flow uses,
 *   - expired/used → friendly "request a new one" state linking back to /login.
 *
 * The token is read from window.location (not useSearchParams) to stay off the
 * Suspense/CSR-bailout path, matching how the login page reads ?mfa_token.
 */
export default function MagicLinkConsumePage() {
  const { completeMagicLink } = useAuth()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const ranRef = useRef(false)

  // Honor a sanitized ?next / ?redirect through the cross-domain handoff — same
  // rule the login page applies (internal same-origin path only, default /home).
  const buildCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('next') ?? params.get('redirect') ?? params.get('redirect_to')
    const dest = raw && /^\/(?!\/)/.test(raw) ? raw : '/home'
    return `${window.location.origin}/redirect_from_auth?next=${encodeURIComponent(dest)}`
  }

  useEffect(() => {
    // Single-use link: never run the verify twice (React strict-mode double-mount).
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('token')

      if (!token) {
        setError('This link is missing its token. Request a new one to sign in.')
        setStatus('error')
        return
      }

      const callbackUrl = buildCallbackUrl()
      const res = await completeMagicLink(token, { callbackUrl, redirect: false })

      // 2FA account — the login page already knows how to finish from an mfa_token.
      if (res.mfa_required && res.mfa_token) {
        const raw =
          params.get('next') ?? params.get('redirect') ?? params.get('redirect_to')
        const loginUrl = new URL('/login', window.location.origin)
        loginUrl.searchParams.set('mfa_token', res.mfa_token)
        if (raw && /^\/(?!\/)/.test(raw)) loginUrl.searchParams.set('next', raw)
        window.location.href = loginUrl.toString()
        return
      }

      if (res.ok) {
        setStatus('success')
        window.location.href = callbackUrl
        return
      }

      let message = 'This link has expired or was already used. Request a new one to sign in.'
      try {
        const parsed = JSON.parse(res.error || '{}')
        if (parsed.message) message = parsed.message
      } catch {
        // keep the default message
      }
      setError(message)
      setStatus('error')
    }

    run()
  }, [completeMagicLink])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <AlertTriangle className="w-12 h-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            This link isn’t valid anymore
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="space-y-3">
            <Link
              href="/login"
              className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
            >
              Request a new link
            </Link>
            <Link
              href="/"
              className="block w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2 className="w-12 h-12 text-green-600 animate-spin" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Success!</h1>
          <p className="text-gray-500">Redirecting you now...</p>
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
        <h1 className="text-xl font-semibold text-gray-800 mb-2">Signing you in...</h1>
        <p className="text-gray-500">Please wait while we verify your link.</p>
      </div>
    </div>
  )
}
