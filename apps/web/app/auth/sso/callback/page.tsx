'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { handleSSOCallback, SSOError, getErrorMessage, ssoContinueUrl } from '@services/auth/sso'
import { useAuth } from '@components/Contexts/AuthContext'
import { Check, Copy, Info, WarningCircle } from '@phosphor-icons/react'
import { AuthNotice, AuthStatus, AuthStatusScreen, authButtonClass } from '@components/Auth/AuthUI'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

interface ErrorDetails {
  message: string
  errorCode: string
  errorDescription: string
  provider?: string
  technicalDetails?: string
}

export default function SSOCallbackPage() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState<ErrorDetails | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  // The IdP code and state are single-use: a second run of the effect (React
  // StrictMode, or a dependency changing identity) would spend the state again
  // and land on "invalid state" even though the first run succeeded.
  const handledRef = useRef<string | null>(null)

  useEffect(() => {
    const callbackKey = searchParams.toString()
    if (handledRef.current === callbackKey) return
    handledRef.current = callbackKey

    const handleCallback = async () => {
      // First, check for IdP error parameters in the URL
      const idpError = searchParams.get('error')
      const idpErrorDescription = searchParams.get('error_description')

      if (idpError) {
        // IdP returned an error (user denied consent, etc.)
        const errorMessage = getErrorMessage(idpError, idpErrorDescription || undefined)
        setError({
          message: errorMessage,
          errorCode: idpError,
          errorDescription: idpErrorDescription || errorMessage,
          technicalDetails: `IdP Error Code: ${idpError}${idpErrorDescription ? `\nDescription: ${idpErrorDescription}` : ''}`,
        })
        setStatus('error')
        return
      }

      const code = searchParams.get('code')
      const state = searchParams.get('state')

      if (!code || !state) {
        setError({
          message: getErrorMessage('missing_params'),
          errorCode: 'missing_params',
          errorDescription: 'Missing required parameters: code and state',
          technicalDetails: `code: ${code ? 'present' : 'missing'}\nstate: ${state ? 'present' : 'missing'}`,
        })
        setStatus('error')
        return
      }

      try {
        // Exchange code for user profile and tokens
        const result = await handleSSOCallback(code, state)

        // A 2FA-enabled account gets a pending challenge instead of a session.
        // Hand it to the login page, which owns the code form, exactly like the
        // Google callback does.
        if (result.mfa_required && result.mfa_token) {
          const mfaParams = new URLSearchParams({ mfa_token: result.mfa_token })
          // Without a usable redirect the login page falls back to its default.
          if (result.redirect_url) {
            try {
              const target = new URL(result.redirect_url, window.location.origin)
              const next = `${target.pathname}${target.search}`
              if (
                target.origin === window.location.origin &&
                target.pathname !== '/redirect_from_auth' &&
                /^\/(?!\/)/.test(next)
              ) {
                mfaParams.set('redirect_to', next)
              }
            } catch {
              // Malformed redirect: same default.
            }
          }
          router.push(`/auth/login?${mfaParams.toString()}`)
          return
        }

        // Use absolute URL with current origin for custom domain support
        const defaultRedirect = `${window.location.origin}/redirect_from_auth`
        const redirectUrl = result.redirect_url || defaultRedirect

        // Use the credentials provider with SSO tokens
        const signInResult = await signIn('credentials', {
          redirect: false,
          email: result.user.email,
          sso: 'true',
          sso_access_token: result.tokens.access_token,
          sso_user: JSON.stringify(result.user),
          sso_expiry: result.tokens.expiry ?? undefined,
          callbackUrl: redirectUrl,
        })

        if (signInResult?.error) {
          console.error('Sign-in failed:', signInResult.error)
          setError({
            message: t('auth.sso_callback.signin_failed'),
            errorCode: 'signin_failed',
            errorDescription: signInResult.error,
            technicalDetails: `Sign-in error: ${signInResult.error}`,
          })
          setStatus('error')
        } else if (signInResult?.ok) {
          setStatus('success')
          router.push(redirectUrl)
        } else {
          // No error but not ok either - likely a redirect happened
          setStatus('success')
          router.push(redirectUrl)
        }
      } catch (err: any) {
        console.error('SSO callback error:', err)

        if (err instanceof SSOError) {
          const continueUrl = ssoContinueUrl(err, window.location.protocol)
          if (continueUrl) {
            window.location.replace(continueUrl)
            return
          }
          setError({
            message: getErrorMessage(err.errorCode, err.errorDescription),
            errorCode: err.errorCode,
            errorDescription: err.errorDescription,
            provider: err.provider,
            technicalDetails: JSON.stringify({
              error: err.error,
              error_code: err.errorCode,
              error_description: err.errorDescription,
              provider: err.provider,
              details: err.details,
            }, null, 2),
          })
        } else {
          setError({
            message: err.message || t('auth.sso_callback.error'),
            errorCode: 'unknown_error',
            errorDescription: err.message || 'An unknown error occurred',
            technicalDetails: err.stack || err.message,
          })
        }
        setStatus('error')
      }
    }

    handleCallback()
  }, [searchParams, router, t, signIn])

  if (status === 'loading') {
    return (
      <AuthStatusScreen>
        <AuthStatus loading title={t('auth.sso_callback.authenticating')} description={t('auth.sso_callback.please_wait')} />
      </AuthStatusScreen>
    )
  }

  const copyToClipboard = async () => {
    if (error?.technicalDetails) {
      await navigator.clipboard.writeText(error.technicalDetails)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (status === 'error') {
    return (
      <AuthStatusScreen wide>
        <AuthStatus
          tone="danger"
          icon={<WarningCircle size={22} weight="duotone" />}
          title={t('auth.sso_callback.auth_failed')}
          description={error?.message}
        >
          {(error?.errorCode && error.errorCode !== 'unknown_error') || error?.provider ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              {error?.errorCode && error.errorCode !== 'unknown_error' && (
                <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 font-mono text-rose-700 ring-1 ring-inset ring-rose-600/10" dir="ltr">
                  {error.errorCode}
                </span>
              )}
              {error?.provider && (
                <span className="text-neutral-500">
                  {t('auth.sso_callback.provider')}: {error.provider}
                </span>
              )}
            </div>
          ) : null}

          {error?.technicalDetails && (
            <div className="text-start">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                aria-expanded={showTechnicalDetails}
                className="mx-auto flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
              >
                <Info size={14} aria-hidden="true" />
                {showTechnicalDetails ? t('auth.sso_callback.hide_details') : t('auth.sso_callback.show_details')}
              </button>

              {showTechnicalDetails && (
                <div className="relative mt-2 rounded-xl bg-neutral-50 p-3 pe-10 ring-1 ring-inset ring-neutral-900/[0.06]">
                  <button
                    type="button"
                    onClick={copyToClipboard}
                    className="absolute top-2 end-2 rounded-md p-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
                    title={copied ? t('auth.sso_callback.copied') : t('auth.sso_callback.copy_details')}
                    aria-label={copied ? t('auth.sso_callback.copied') : t('auth.sso_callback.copy_details')}
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                  <pre className="whitespace-pre-wrap break-all font-mono text-xs text-neutral-700" dir="ltr">
                    {error.technicalDetails}
                  </pre>
                </div>
              )}
            </div>
          )}

          {error?.errorCode === 'access_denied' && (
            <AuthNotice tone="warning" className="text-start">
              <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.access_denied')}
            </AuthNotice>
          )}

          {error?.errorCode === 'invalid_state' && (
            <AuthNotice tone="warning" className="text-start">
              <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.invalid_state')}
            </AuthNotice>
          )}

          {error?.errorCode === 'domain_not_allowed' && (
            <AuthNotice tone="warning" className="text-start">
              <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.domain_not_allowed')}
            </AuthNotice>
          )}

          {(error?.errorCode === 'auto_provision_disabled' || error?.errorCode === 'user_not_found') && (
            <AuthNotice tone="warning" className="text-start">
              <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.auto_provision_disabled')}
            </AuthNotice>
          )}

          {error?.errorCode === 'sso_misconfigured' && (
            <AuthNotice tone="warning" className="text-start">
              <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.sso_misconfigured')}
            </AuthNotice>
          )}

          <div className="mt-2 flex flex-col gap-2.5">
            <Link href="/login" className={authButtonClass('primary')}>
              {t('auth.sso_callback.try_again')}
            </Link>
            <Link href="/" className={authButtonClass('secondary')}>
              {t('auth.sso_callback.go_home')}
            </Link>
          </div>
        </AuthStatus>
      </AuthStatusScreen>
    )
  }

  // Success state - redirecting
  return (
    <AuthStatusScreen>
      <AuthStatus tone="success" loading title={t('auth.sso_callback.success')} description={t('auth.sso_callback.redirecting')} />
    </AuthStatusScreen>
  )
}
