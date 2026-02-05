'use client'

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { getAPIUrl } from '@services/config/config'
import { useAuth, validateOAuthState } from '@components/Contexts/AuthContext'

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

      // Validate CSRF state parameter
      if (!state) {
        setError('Missing state parameter - potential security issue')
        setStatus('csrf_error')
        return
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
          if (name === 'learnhouse_oauth_org_id' && value) {
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

      try {
        // Exchange code for tokens with our backend
        // First, we need to get Google's access token
        const tokenResponse = await fetch('/api/auth/google/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirect_uri: `${window.location.origin}/auth/callback/google`,
          }),
        })

        if (!tokenResponse.ok) {
          // If no token endpoint, exchange directly with backend OAuth endpoint
          // The backend will validate with Google
          const backendResponse = await fetch(
            `${getAPIUrl()}auth/oauth/google/callback?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(`${window.location.origin}/auth/callback/google`)}${orgId ? `&org_id=${orgId}` : ''}`,
            {
              method: 'GET',
              credentials: 'include',
            }
          )

          if (!backendResponse.ok) {
            const errorData = await backendResponse.json().catch(() => ({}))
            throw new Error(errorData.detail || 'Failed to authenticate with Google')
          }

          const data = await backendResponse.json()

          // Validate response structure
          if (!data.tokens?.access_token) {
            throw new Error('Invalid response from server')
          }

          // Sign in with the tokens from backend
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
          return
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

        // Call our backend OAuth endpoint
        const url = orgId
          ? `${getAPIUrl()}auth/oauth?org_id=${orgId}`
          : `${getAPIUrl()}auth/oauth`

        const oauthResponse = await fetch(url, {
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
          throw new Error(errorData.detail || 'Failed to authenticate')
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
