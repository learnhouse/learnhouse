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

      // Verify the state's signature server-side BEFORE trusting anything in
      // it. Only a state we issued may name a returnOrigin to bounce the code to.
      let returnOrigin: string | null = null
      try {
        const verifyRes = await fetch('/api/auth/google/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        })
        const verified = verifyRes.ok ? await verifyRes.json() : null
        if (!verified?.valid) throw new Error('invalid state')
        returnOrigin = typeof verified.returnOrigin === 'string' ? verified.returnOrigin : null
      } catch {
        setError('Invalid or expired authentication request. Please try again.')
        setStatus('csrf_error')
        return
      }

      // When OAuth was initiated from a custom domain, Google redirects to the
      // main domain; bounce code+state back so CSRF validation and cookies
      // happen on the right origin. Platform hosts are trusted as-is; a custom
      // domain must still resolve AND its live DNS must still point at us
      // (for_auth), or a repointed domain could harvest codes.
      if (returnOrigin) {
        let bounceOrigin: string | null = null
        try {
          const u = new URL(returnOrigin)
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            const host = u.hostname
            const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL()
            const isPlatformHost = !!topDomain && (host === topDomain || host.endsWith(`.${topDomain}`))
            if (isPlatformHost || u.origin === window.location.origin) {
              bounceOrigin = u.origin
            } else {
              try {
                const r = await fetch(
                  `${getAPIUrl()}orgs/resolve/domain/${encodeURIComponent(host)}?for_auth=1`,
                  { signal: AbortSignal.timeout(8000) },
                )
                if (r.ok) bounceOrigin = u.origin
              } catch {
                /* verification failed, do not bounce */
              }
            }
          }
        } catch {
          /* malformed returnOrigin: no bounce */
        }
        if (!bounceOrigin) {
          setError('This sign-in request could not be completed for this domain. Please try again.')
          setStatus('error')
          return
        }
        if (bounceOrigin !== window.location.origin) {
          const bounceUrl = new URL('/auth/callback/google', bounceOrigin)
          // Forward all search params (code, state, scope, etc.)
          searchParams.forEach((value, key) => {
            bounceUrl.searchParams.set(key, value)
          })
          window.location.href = bounceUrl.toString()
          return
        }
      }

      const stateValidation = validateOAuthState(state)
      if (!stateValidation.valid) {
        setError('Invalid or expired authentication request. Please try again.')
        setStatus('csrf_error')
        return
      }

      const callbackUrl = stateValidation.callbackUrl

      // Get org_id (and, for invite-only orgs, the invite code) from cookies if set
      let orgId: number | undefined
      let inviteCode: string | undefined
      try {
        const cookies = document.cookie.split(';')
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=')
          if (name === 'LH_oauth_org_id' && value) {
            orgId = parseInt(value, 10)
            if (isNaN(orgId)) {
              orgId = undefined
            }
          } else if (name === 'LH_oauth_invite_code' && value) {
            inviteCode = decodeURIComponent(value)
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
        for (const n of ['LH_oauth_org_id', 'LH_oauth_orgslug', 'LH_oauth_invite_code']) {
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
            state,
          }),
        })

        if (!tokenResponse.ok) {
          // Surface the real token-exchange error. (There is no
          // /api/auth/oauth/google/callback route; the old fallback here just
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
        const oauthParams = new URLSearchParams()
        if (orgId) oauthParams.set('org_id', String(orgId))
        if (orgId && inviteCode) oauthParams.set('invite_code', inviteCode)
        const oauthUrl = oauthParams.toString()
          ? `/api/auth/oauth?${oauthParams.toString()}`
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

        // A Google account with 2FA enrolled gets a pending challenge instead of
        // a session. Hand it to the login page, which owns the code form, the same
        // handoff the admin magic-link consume endpoint uses.
        if (data.mfa_required && data.mfa_token) {
          const mfaParams = new URLSearchParams({ mfa_token: data.mfa_token })
          const next = new URLSearchParams(window.location.search).get('next')
          if (next && /^\/(?!\/)/.test(next)) mfaParams.set('redirect_to', next)
          router.push(`/auth/login?${mfaParams.toString()}`)
          return
        }

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
