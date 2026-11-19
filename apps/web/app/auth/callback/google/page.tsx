'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ShieldWarning, WarningCircle } from '@phosphor-icons/react'
import { AuthStatus, AuthStatusScreen, authButtonClass } from '@components/Auth/AuthUI'
import { useTranslation } from 'react-i18next'
import { decodeOAuthStatePayload, useAuth, validateOAuthState } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_DOMAIN_VAL, getAPIUrl } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { oauthBounceCheckUrl } from '@/lib/auth/oauthBounce'
import { readOAuthContextCookies } from '@/lib/auth/oauthCookies'
import { isMemberLimitError } from '@/lib/auth/signup'
import { clearOAuthContextCookies } from '@/lib/auth/oauthCookiesClient'
import {
  callbackHomeHref,
  callbackRetryHref,
  callbackTargets,
  callbackUrlToOrgRoot,
  isInviteEmailMismatch,
  mfaLoginHref,
} from '@/lib/auth/oauthCallback'

export default function GoogleCallbackPage() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'csrf_error'>('loading')
  // Where the error buttons lead: the sign-in's own site (and invitation page),
  // not this page's host, which is often the platform domain.
  const [linkContext, setLinkContext] = useState<{ callbackUrl: string | null; trustedOrigin: string | null }>({
    callbackUrl: null,
    trustedOrigin: null,
  })
  // Signed in with a Google account other than the invited one.
  const [inviteMismatch, setInviteMismatch] = useState(false)
  // The authorization code is single-use: a second run of the effect (React
  // StrictMode, or signIn changing identity) would redeem it again and fail.
  const handledRef = useRef<string | null>(null)

  useEffect(() => {
    const callbackKey = searchParams.toString()
    if (handledRef.current === callbackKey) return
    handledRef.current = callbackKey

    // Every way out of this page drops the org context cookies, so a stale org
    // or invitation can't ride along with a later sign-in.
    const fail = (message: string, kind: 'error' | 'csrf_error' = 'error') => {
      clearOAuthContextCookies()
      setError(message)
      setStatus(kind)
    }

    // Server check of the state's signature; null when it isn't ours.
    const verifyState = async (state: string): Promise<{ returnOrigin: string | null } | null> => {
      try {
        const verifyRes = await fetch('/api/auth/google/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        })
        const verified = verifyRes.ok ? await verifyRes.json() : null
        if (!verified?.valid) return null
        const returnOrigin = typeof verified.returnOrigin === 'string' ? verified.returnOrigin : null
        if (returnOrigin) setLinkContext((prev) => ({ ...prev, trustedOrigin: returnOrigin }))
        return { returnOrigin }
      } catch {
        return null
      }
    }

    const handleCallback = async () => {
      const code = searchParams.get('code')
      const state = searchParams.get('state')
      const errorParam = searchParams.get('error')

      // The buttons on an error screen point at the site the sign-in started
      // from. The state's callbackUrl is only used for an origin that checks
      // out (see callbackTargets).
      const statePayload = state ? decodeOAuthStatePayload(state) : null
      if (typeof statePayload?.callbackUrl === 'string') {
        setLinkContext((prev) => ({ ...prev, callbackUrl: statePayload.callbackUrl }))
      }

      // Handle OAuth errors from Google (cancelled, refused). A signed state
      // still says which custom domain the buttons should lead back to.
      if (errorParam) {
        if (state) await verifyState(state)
        fail(t('auth.google_callback.google_failed', { error: errorParam }))
        return
      }

      if (!code) {
        fail(t('auth.google_callback.no_code'))
        return
      }

      if (!state) {
        fail(t('auth.google_callback.missing_state'), 'csrf_error')
        return
      }

      // Verify the state's signature server-side BEFORE trusting anything in
      // it. Only a state we issued may name a returnOrigin to bounce the code to.
      const verified = await verifyState(state)
      if (!verified) {
        fail(t('auth.google_callback.invalid_request'), 'csrf_error')
        return
      }
      const returnOrigin = verified.returnOrigin

      // When OAuth was initiated from a custom domain, Google redirects to the
      // main domain; bounce code+state back so CSRF validation and cookies
      // happen on the right origin. Any other origin must be a configured org
      // host: an existing org's platform subdomain, or a verified custom domain
      // whose live DNS still points at us (for_auth), so neither an unrelated
      // platform subdomain nor a repointed domain can harvest codes.
      if (returnOrigin) {
        let bounceOrigin: string | null = null
        try {
          const u = new URL(returnOrigin)
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            if (u.origin === window.location.origin) {
              bounceOrigin = u.origin
            } else {
              try {
                const r = await fetch(
                  oauthBounceCheckUrl(u, getLEARNHOUSE_DOMAIN_VAL(), getAPIUrl()),
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
          fail(t('auth.google_callback.domain_failed'))
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
        fail(t('auth.google_callback.invalid_request'), 'csrf_error')
        return
      }

      const callbackUrl = stateValidation.callbackUrl
      setLinkContext((prev) => ({ ...prev, callbackUrl }))

      // Org context (and, for invitations, the invite code or personal link
      // token) from the cookies the sign-in page set.
      let orgId: number | undefined
      let inviteCode: string | undefined
      let inviteToken: string | undefined
      try {
        const ctx = readOAuthContextCookies(document.cookie)
        orgId = ctx.orgId
        inviteCode = ctx.inviteCode
        inviteToken = ctx.inviteToken
      } catch {
        // Ignore cookie parsing errors
      }

      // Consume the OAuth org-context cookies once read, so a stale org id can't
      // bleed into a later OAuth attempt (both domain-scoped and host-only).
      clearOAuthContextCookies()

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
          throw new Error(typeof err.error === 'string' && err.error ? err.error : getErrorMessage(err.detail, t('auth.google_callback.exchange_failed')))
        }

        const tokenData = await tokenResponse.json()

        // Validate token response
        if (!tokenData.access_token) {
          throw new Error(t('auth.google_callback.invalid_token_response'))
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
          throw new Error(t('auth.google_callback.userinfo_failed'))
        }

        const userInfo = await userInfoResponse.json()

        // Validate user info
        if (!userInfo.email) {
          throw new Error(t('auth.google_callback.no_email'))
        }

        // Call Next.js API route to ensure cookies are set properly
        const oauthParams = new URLSearchParams()
        if (orgId) oauthParams.set('org_id', String(orgId))
        if (orgId && inviteCode) oauthParams.set('invite_code', inviteCode)
        // A personal invitation link: the sign-in joins the org and accepts it
        // when the Google address is the invited one.
        if (inviteToken) oauthParams.set('invite_token', inviteToken)
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
          if (isInviteEmailMismatch(errorData.detail)) setInviteMismatch(true)
          throw new Error(
            isMemberLimitError(errorData.detail)
              ? t('auth.invite_link.org_full')
              : getErrorMessage(errorData.detail, t('auth.google_callback.authenticate_failed'), t),
          )
        }

        const data = await oauthResponse.json()

        // A Google account with 2FA enrolled gets a pending challenge instead of
        // a session. Hand it to the login page, which owns the code form, the same
        // handoff the admin magic-link consume endpoint uses.
        // The destination lives in the state's callbackUrl, and the sign-in
        // page is on the org's own site.
        if (data.mfa_required && data.mfa_token) {
          const targets = callbackTargets(callbackUrl, window.location.origin, getLEARNHOUSE_DOMAIN_VAL(), returnOrigin)
          window.location.href = mfaLoginHref(targets, data.mfa_token)
          return
        }

        // Validate response structure
        if (!data.tokens?.access_token) {
          throw new Error(t('auth.google_callback.invalid_server_response'))
        }

        // The sign-in accepted the invitation: straight to the org, not back to
        // the invitation page (which would only say the link was used).
        const destination =
          inviteToken && data.invite_accepted !== false
            ? callbackUrlToOrgRoot(callbackUrl, window.location.origin)
            : callbackUrl

        // Sign in with the obtained tokens
        const result = await signIn('credentials', {
          redirect: false,
          sso: 'true',
          sso_access_token: data.tokens.access_token,
          sso_user: JSON.stringify(data.user),
          sso_expiry: data.tokens.expiry,
          callbackUrl: destination,
        })

        if (result && !result.ok) {
          throw new Error(result.error || t('auth.google_callback.signin_failed'))
        }

        setStatus('success')
        router.push(destination)
      } catch (err: any) {
        console.error('Google OAuth callback error:', err)
        fail(err.message || t('auth.google_callback.auth_failed'))
      }
    }

    handleCallback()
  }, [searchParams, router, signIn, t])

  const targets = callbackTargets(
    linkContext.callbackUrl,
    typeof window === 'undefined' ? '' : window.location.origin,
    getLEARNHOUSE_DOMAIN_VAL(),
    linkContext.trustedOrigin,
  )
  const retryHref = callbackRetryHref(targets)
  const homeHref = callbackHomeHref(targets)

  if (status === 'loading') {
    return (
      <AuthStatusScreen>
        <AuthStatus loading title={t('auth.google_callback.completing')} description={t('auth.google_callback.please_wait')} />
      </AuthStatusScreen>
    )
  }

  if (status === 'csrf_error') {
    return (
      <AuthStatusScreen>
        <AuthStatus
          tone="warning"
          icon={<ShieldWarning size={22} weight="duotone" />}
          title={t('auth.google_callback.security_failed')}
          description={
            <>
              <p>{error}</p>
              <p className="mt-2 text-[13px] text-neutral-400">{t('auth.google_callback.security_hint')}</p>
            </>
          }
        >
          <a href={retryHref} className={authButtonClass('primary')}>
            {t('auth.google_callback.go_to_login')}
          </a>
          <a href={homeHref} className={authButtonClass('secondary')}>
            {t('auth.google_callback.go_home')}
          </a>
        </AuthStatus>
      </AuthStatusScreen>
    )
  }

  if (status === 'error') {
    return (
      <AuthStatusScreen>
        <AuthStatus
          tone="danger"
          icon={<WarningCircle size={22} weight="duotone" />}
          title={inviteMismatch ? t('auth.google_callback.invite_mismatch_title') : t('auth.google_callback.auth_failed')}
          description={error}
        >
          <a href={retryHref} className={authButtonClass('primary')}>
            {inviteMismatch ? t('auth.google_callback.use_another_account') : t('auth.google_callback.try_again')}
          </a>
          <a href={homeHref} className={authButtonClass('secondary')}>
            {t('auth.google_callback.go_home')}
          </a>
        </AuthStatus>
      </AuthStatusScreen>
    )
  }

  // Success state - redirecting
  return (
    <AuthStatusScreen>
      <AuthStatus tone="success" loading title={t('auth.google_callback.success')} description={t('auth.google_callback.redirecting')} />
    </AuthStatusScreen>
  )
}
