'use client'

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useAuth, validateOAuthState } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_DOMAIN_VAL, getLEARNHOUSE_TOP_DOMAIN_VAL, getAPIUrl } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'

export default function GoogleCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'csrf_error'>('loading')

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code')
      const state = searchParams.get('state')
      const errorParam = searchParams.get('error')

      // Handle OAuth errors from Google
      if (errorParam) {
        setError(`Google authentication failed: ${errorParam}`)
        setStatus('error')
        return
      }

      if (!code) {
        setError('No authorization code received from Google')
        setStatus('error')
        return
      }

      if (!state) {
        setError('Missing state parameter - potential security issue')
        setStatus('csrf_error')
        return
      }

      // Check if we need to bounce to a custom domain origin.
      // When OAuth was initiated from a custom domain (e.g., learn.mozilla.org),
      // Google redirects to the main domain (dev.learnhouse.io). We detect this
      // via returnOrigin in the state and bounce the code+state to the custom domain
      // so CSRF validation and cookie-setting happen on the correct origin.
      try {
        const stateData = JSON.parse(atob(state))
        // Validate returnOrigin strictly before bouncing the OAuth code there.
        // Parse it as a URL and use ONLY its origin (drops any path/query
        // injection); require an http(s) scheme — rejects `javascript:`/`data:`,
        // protocol-relative `//evil`, and malformed values that would otherwise
        // be an open redirect / OAuth-code leak. (Full forgery protection needs
        // HMAC-signed state — tracked as a follow-up.)
        // Only bounce the OAuth code to a TRUSTED host: the platform apex / a
        // platform subdomain (sync), or a REGISTERED custom domain (verified
        // against the backend). A scheme check alone still allows any https host
        // (e.g. attacker.com) → open redirect / OAuth-code leak. Anything not
        // proven trusted is ignored; we fall through to CSRF validation on the
        // current origin. (HMAC-signed state is the fuller fix — follow-up.)
        let bounceOrigin: string | null = null
        if (typeof stateData.returnOrigin === 'string') {
          try {
            const u = new URL(stateData.returnOrigin)
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              const host = u.hostname
              const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL()
              const isPlatformHost = !!topDomain && (host === topDomain || host.endsWith(`.${topDomain}`))
              if (isPlatformHost) {
                bounceOrigin = u.origin
              } else {
                // Non-platform host: bounce ONLY if the backend confirms it is a
                // registered custom domain (200 = resolved to an org).
                try {
                  const r = await fetch(
                    `${getAPIUrl()}orgs/resolve/domain/${encodeURIComponent(host)}`,
                    { signal: AbortSignal.timeout(5000) },
                  )
                  if (r.ok) bounceOrigin = u.origin
                } catch {
                  /* verification failed — do not bounce */
                }
              }
            }
          } catch {
            /* malformed returnOrigin — ignore, fall through to CSRF validation */
          }
        }
        if (bounceOrigin && bounceOrigin !== window.location.origin) {
          const bounceUrl = new URL('/auth/callback/google', bounceOrigin)
          // Forward all search params (code, state, scope, etc.)
          searchParams.forEach((value, key) => {
            bounceUrl.searchParams.set(key, value)
          })
          window.location.href = bounceUrl.toString()
          return
        }
      } catch {
        // State parsing failed, continue to CSRF validation which will handle the error
      }

      const stateValidation = validateOAuthState(state)
      if (!stateValidation.valid) {
        setError('Invalid or expired authentication request. Please try again.')
        setStatus('csrf_error')
        return
      }

      const callbackUrl = stateValidation.callbackUrl

      // Get org_id from cookie if set
      let orgId: number | undefined
      try {
        const cookies = document.cookie.split(';')
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=')
          if (name === 'LH_oauth_org_id' && value) {
            orgId = parseInt(value, 10)
            if (isNaN(orgId)) {
              orgId = undefined
            }
            break
          }
        }
      } catch {
        // Ignore cookie parsing errors
      }

      // Consume the OAuth org-context cookies once read, so a stale org id can't
      // bleed into a later OAuth attempt (both domain-scoped and host-only).
      try {
        const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL()
        const domainAttr = topDomain && topDomain !== 'localhost' ? `; domain=.${topDomain}` : ''
        for (const n of ['LH_oauth_org_id', 'LH_oauth_orgslug']) {
          document.cookie = `${n}=; path=/; max-age=0`
          if (domainAttr) document.cookie = `${n}=; path=/; max-age=0${domainAttr}`
        }
      } catch {
        // best-effort cleanup
      }

      try {
        // redirect_uri must always match what was sent during authorization (main domain)
        const domain = getLEARNHOUSE_DOMAIN_VAL()
        const oauthRedirectUri = `${window.location.protocol}//${domain}/auth/callback/google`

        // Exchange code for tokens with our backend
        // First, we need to get Google's access token
        const tokenResponse = await fetch('/api/auth/google/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirect_uri: oauthRedirectUri,
          }),
        })

        if (!tokenResponse.ok) {
          // Surface the real token-exchange error. (There is no
          // /api/auth/oauth/google/callback route — the old fallback here just
          // 404'd and masked the actual error with a misleading one.)
          const err = await tokenResponse.json().catch(() => ({}))
          throw new Error(typeof err.error === 'string' && err.error ? err.error : getErrorMessage(err.detail, 'Failed to exchange the Google authorization code.'))
        }

        const tokenData = await tokenResponse.json()

        // Validate token response
        if (!tokenData.access_token) {
          throw new Error('Invalid token response from Google')
        }

        // Get user info from Google
        const userInfoResponse = await fetch(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
            },
          }
        )

        if (!userInfoResponse.ok) {
          throw new Error('Failed to get user info from Google')
        }

        const userInfo = await userInfoResponse.json()

        // Validate user info
        if (!userInfo.email) {
          throw new Error('Could not retrieve email from Google')
        }

        // Call Next.js API route to ensure cookies are set properly
        const oauthUrl = orgId
          ? `/api/auth/oauth?org_id=${orgId}`
          : '/api/auth/oauth'

        const oauthResponse = await fetch(oauthUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: userInfo.email,
            provider: 'google',
            access_token: tokenData.access_token,
          }),
          credentials: 'include',
        })

        if (!oauthResponse.ok) {
          const errorData = await oauthResponse.json().catch(() => ({}))
          throw new Error(getErrorMessage(errorData.detail, 'Failed to authenticate'))
        }

        const data = await oauthResponse.json()

        // Validate response structure
        if (!data.tokens?.access_token) {
          throw new Error('Invalid response from server')
        }

        // Sign in with the obtained tokens
        const result = await signIn('credentials', {
          redirect: false,
          sso: 'true',
          sso_access_token: data.tokens.access_token,
          sso_refresh_token: data.tokens.refresh_token,
          sso_user: JSON.stringify(data.user),
          sso_expiry: data.tokens.expiry,
          callbackUrl,
        })

        if (result && !result.ok) {
          throw new Error(result.error || 'Failed to complete sign in')
        }

        setStatus('success')
        router.push(callbackUrl)
      } catch (err: any) {
        console.error('Google OAuth callback error:', err)
        setError(err.message || 'Authentication failed')
        setStatus('error')
      }
    }

    handleCallback()
  }, [searchParams, router, signIn])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2 className="w-12 h-12 text-gray-600 animate-spin" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            Completing sign in...
          </h1>
          <p className="text-gray-500">Please wait while we authenticate you.</p>
        </div>
      </div>
    )
  }

  if (status === 'csrf_error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <ShieldAlert className="w-12 h-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            Security Check Failed
          </h1>
          <p className="text-gray-600 mb-2">{error}</p>
          <p className="text-gray-500 text-sm mb-6">
            This can happen if the login session expired or if you followed an old link.
            Please start the login process again.
          </p>
          <div className="space-y-3">
            <Link
              href="/login"
              className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
            >
              Go to Login
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

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-red-100 rounded-full">
              <AlertTriangle className="w-12 h-12 text-red-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            Authentication Failed
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="space-y-3">
            <Link
              href="/login"
              className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
            >
              Try Again
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

  // Success state - redirecting
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Loader2 className="w-12 h-12 text-green-600 animate-spin" />
        </div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          Success!
        </h1>
        <p className="text-gray-500">Redirecting you now...</p>
      </div>
    </div>
  )
}
