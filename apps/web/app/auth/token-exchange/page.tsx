'use client'

import React, { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, AlertTriangle } from 'lucide-react'

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'No sign-in code was provided.',
  code_expired: 'This sign-in link has expired or already been used. Please return to the dashboard and click "Visit Site" again.',
  platform_unreachable: 'We could not reach the main platform. Please try again in a moment.',
  platform_bad_response: 'The platform returned an unexpected response. Please try again.',
  no_tokens: 'The sign-in link did not contain any credentials.',
  no_refresh_token: 'The sign-in link is missing a refresh token. Please return to the dashboard and click "Visit Site" again.',
  no_access_token: 'Could not obtain a valid session token.',
  session_invalid: 'Your account is not recognized on this organization. Please sign in directly.',
  user_not_in_tenant: 'Your account is not a member of this organization. Please sign in directly.',
  backend_unreachable: 'We could not reach the backend. Please try again.',
  bad_origin: 'This request was rejected by the server.',
  bad_content_type: 'This request was rejected by the server.',
  unexpected: 'Something unexpected went wrong. Please try again.',
}

// Only allow same-origin relative paths. Rejects `//evil.com`, `https://evil.com`,
// and backslash tricks — prevents the `?redirect=` param from becoming an open
// redirect after a successful exchange.
function sanitizeRedirect(raw: string | null): string {
  const fallback = '/dash'
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  if (/[\r\n]/.test(raw)) return fallback
  return raw
}

function TokenExchangeInner() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleExchange = async () => {
      const code = searchParams.get('code')
      const redirect = sanitizeRedirect(searchParams.get('redirect'))

      if (!code) {
        setError('Missing authentication code')
        return
      }

      try {
        // Call our own API which server-side exchanges the code for tokens
        const res = await fetch('/api/auth/token-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          credentials: 'include',
        })

        if (!res.ok) {
          const body = await res.json().catch(() => null)
          const errCode = body?.code as string | undefined
          setError(
            (errCode && ERROR_MESSAGES[errCode]) ||
              body?.error ||
              'Authentication failed. Please try logging in again.'
          )
          return
        }

        // Full page reload so AuthContext initializes fresh with the new cookies
        window.location.href = redirect
      } catch {
        setError('Something went wrong. Please try again.')
      }
    }

    handleExchange()
  }, [searchParams])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-red-100 rounded-full">
              <AlertTriangle className="w-10 h-10 text-red-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Authentication Failed</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <a
            href="/login"
            className="inline-block px-6 py-2.5 bg-black text-white rounded-lg hover:bg-black/90 transition-colors text-sm font-semibold"
          >
            Go to Login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Loader2 className="w-10 h-10 text-gray-600 animate-spin" />
        </div>
        <h1 className="text-lg font-semibold text-gray-800 mb-1">Signing you in...</h1>
        <p className="text-gray-500 text-sm">Please wait while we set up your session.</p>
      </div>
    </div>
  )
}

export default function TokenExchangePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <Loader2 className="w-10 h-10 text-gray-600 animate-spin" />
        </div>
      }
    >
      <TokenExchangeInner />
    </Suspense>
  )
}
