'use client'

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { handleSSOCallback, SSOError, getErrorMessage } from '@services/auth/sso'
import { useAuth } from '@components/Contexts/AuthContext'
import { Shield, AlertTriangle, Loader2, Info, Copy, Check } from 'lucide-react'
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

  useEffect(() => {
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

        // Use absolute URL with current origin for custom domain support
        const defaultRedirect = `${window.location.origin}/redirect_from_auth`
        const redirectUrl = result.redirect_url || defaultRedirect

        // Use the credentials provider with SSO tokens
        const signInResult = await signIn('credentials', {
          redirect: false,
          email: result.user.email,
          sso: 'true',
          sso_access_token: result.tokens.access_token,
          sso_refresh_token: result.tokens.refresh_token,
          sso_user: JSON.stringify(result.user),
          sso_expiry: result.tokens.expiry ?? undefined,
          callbackUrl: redirectUrl,
        })

        if (signInResult?.error) {
          console.error('Sign-in failed:', signInResult.error)
          setError({
            message: 'Failed to complete sign-in after SSO authentication',
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <Shield className="w-16 h-16 text-indigo-600" />
              <Loader2 className="w-6 h-6 text-indigo-600 absolute -bottom-1 -end-1 animate-spin" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            {t('auth.sso_callback.authenticating')}
          </h1>
          <p className="text-gray-500">
            {t('auth.sso_callback.please_wait')}
          </p>
        </div>
      </div>
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-lg mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-red-100 rounded-full">
              <AlertTriangle className="w-12 h-12 text-red-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            {t('auth.sso_callback.auth_failed')}
          </h1>

          {/* Main error message */}
          <p className="text-gray-600 mb-4">{error?.message}</p>

          {/* Error code badge */}
          {error?.errorCode && error.errorCode !== 'unknown_error' && (
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm mb-4">
              <span className="font-mono">{error.errorCode}</span>
            </div>
          )}

          {/* Provider info */}
          {error?.provider && (
            <p className="text-sm text-gray-500 mb-4">
              Provider: {error.provider}
            </p>
          )}

          {/* Technical details expandable */}
          {error?.technicalDetails && (
            <div className="mb-6">
              <button
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <Info className="w-4 h-4" />
                {showTechnicalDetails ? 'Hide' : 'Show'} technical details
              </button>

              {showTechnicalDetails && (
                <div className="mt-2 p-3 bg-gray-100 rounded-md text-start relative">
                  <button
                    onClick={copyToClipboard}
                    className="absolute top-2 end-2 p-1 text-gray-400 hover:text-gray-600"
                    title={t('auth.sso_callback.copy_details')}
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap overflow-x-auto">
                    {error.technicalDetails}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Helpful tips based on error code */}
          {error?.errorCode === 'access_denied' && (
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-md text-start">
              <p className="text-sm text-amber-800">
                <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.access_denied')}
              </p>
            </div>
          )}

          {error?.errorCode === 'invalid_state' && (
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-md text-start">
              <p className="text-sm text-amber-800">
                <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.invalid_state')}
              </p>
            </div>
          )}

          {error?.errorCode === 'domain_not_allowed' && (
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-md text-start">
              <p className="text-sm text-amber-800">
                <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.domain_not_allowed')}
              </p>
            </div>
          )}

          {(error?.errorCode === 'auto_provision_disabled' || error?.errorCode === 'user_not_found') && (
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-md text-start">
              <p className="text-sm text-amber-800">
                <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.user_not_found')}
              </p>
            </div>
          )}

          {error?.errorCode === 'sso_misconfigured' && (
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-md text-start">
              <p className="text-sm text-amber-800">
                <strong>{t('auth.sso_callback.tip_label')}</strong> {t('auth.sso_callback.tips.sso_misconfigured')}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <Link
              href="/auth/login"
              className="block w-full py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              {t('auth.sso_callback.try_again')}
            </Link>
            <Link
              href="/"
              className="block w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              {t('auth.sso_callback.go_home')}
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
          <Shield className="w-16 h-16 text-green-600" />
        </div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          {t('auth.sso_callback.success')}
        </h1>
        <p className="text-gray-500">
          {t('auth.sso_callback.redirecting')}
        </p>
      </div>
    </div>
  )
}
