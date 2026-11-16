'use client'

import React, { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { WarningCircle } from '@phosphor-icons/react'
import { AuthStatus, AuthStatusScreen, authButtonClass } from '@components/Auth/AuthUI'
import { safeInternalPath } from '@services/security/url'
import { useTranslation } from 'react-i18next'

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

// Only allow same-origin paths, so the `?redirect=` param cannot become an open
// redirect after a successful exchange.
function sanitizeRedirect(raw: string | null): string {
  return safeInternalPath(raw || null, '/dash')
}

function TokenExchangeInner() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleExchange = async () => {
      const code = searchParams.get('code')
      const redirect = sanitizeRedirect(searchParams.get('redirect'))

      if (!code) {
        setError(t('auth.token_exchange.missing_code_error'))
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
            (errCode && ERROR_MESSAGES[errCode] && t(`auth.token_exchange.errors.${errCode}`, { defaultValue: ERROR_MESSAGES[errCode] })) ||
              body?.error ||
              t('auth.token_exchange.failed_default')
          )
          return
        }

        // Full page reload so AuthContext initializes fresh with the new cookies
        window.location.href = redirect
      } catch {
        setError(t('auth.token_exchange.generic_error'))
      }
    }

    handleExchange()
  }, [searchParams, t])

  if (error) {
    return (
      <AuthStatusScreen>
        <AuthStatus
          tone="danger"
          icon={<WarningCircle size={22} weight="duotone" />}
          title={t('auth.token_exchange.title')}
          description={error}
        >
          <a href="/login" className={authButtonClass('primary')}>
            {t('auth.token_exchange.go_to_login')}
          </a>
        </AuthStatus>
      </AuthStatusScreen>
    )
  }

  return (
    <AuthStatusScreen>
      <AuthStatus loading title={t('auth.token_exchange.signing_in')} description={t('auth.token_exchange.setting_up')} />
    </AuthStatusScreen>
  )
}

function TokenExchangeFallback() {
  const { t } = useTranslation()
  return (
    <AuthStatusScreen>
      <AuthStatus loading title={t('auth.token_exchange.signing_in')} />
    </AuthStatusScreen>
  )
}

export default function TokenExchangePage() {
  return (
    <Suspense
      fallback={
        <TokenExchangeFallback />
      }
    >
      <TokenExchangeInner />
    </Suspense>
  )
}
