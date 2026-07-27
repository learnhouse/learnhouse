'use client'
import FormLayout, {
  FormField,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { useFormik } from 'formik'
import React, { useState, useEffect } from 'react'
import { AlertTriangle, Info, Lock, Mail, Shield, X, Clock, Send, CheckCircle2 } from 'lucide-react'
import { checkSSOEnabled, redirectToSSOLogin } from '@services/auth/sso'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, getDeploymentMode, isOnCustomDomain } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import { resendVerificationEmail } from '@services/auth/auth'
import AuthLayout from '@components/Auth/AuthLayout'
import TurnstileWidget, { useTurnstileRequired, verifyTurnstileToken, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getAllowedAuthMethods } from '@services/auth/authMethods'

interface LoginClientProps {
  org: any
}

const LoginClient = (props: LoginClientProps) => {
  const { t } = useTranslation()
  const { signIn, completeMfaLogin, requestMagicLink } = useAuth()
  const { track } = useLHAnalytics('public')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = React.useRef<TurnstileWidgetHandle>(null)
  const turnstileRequired = useTurnstileRequired()
  const router = useRouter();
  const session = useLHSession() as any;
  const isAuthenticated = session?.status === 'authenticated'

  // The org's allowed sign-in methods. Offering a method the org has turned off
  // only leads to a 403 from the backend, so it isn't offered at all.
  const allowedMethods = React.useMemo(
    () => getAllowedAuthMethods(props.org),
    [props.org]
  )
  const passwordAllowed = allowedMethods.has('password')
  const magicLoginAllowed = allowedMethods.has('magic_login')
  const googleAllowed = allowedMethods.has('google')
  const ssoAllowed = allowedMethods.has('sso')
  // SSO counts only once it is actually configured for the org (ssoEnabled).
  const hasAlternativeMethods = googleAllowed || magicLoginAllowed || (ssoAllowed && ssoEnabled)

  // A signed-in user has nothing to do on /login → bounce to the hub. The proxy
  // does this best-effort, but pages must self-handle it too (mirrors signup.tsx).
  // Guarded by !isSubmitting so a FRESH login (which flips the session to
  // authenticated) doesn't race the onSubmit's own post-login navigation.
  useEffect(() => {
    if (isAuthenticated && !isSubmitting) router.replace('/home')
  }, [isAuthenticated, isSubmitting, router])

  // Error state with type information
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState<string | null>(null)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [isResendingVerification, setIsResendingVerification] = useState(false)
  const [verificationResent, setVerificationResent] = useState(false)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  // Second-factor challenge. When mfaToken is set the credentials form is
  // replaced in place by the code step — same route, so the ?next redirect and
  // the org context survive without being threaded through a navigation.
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [mfaError, setMfaError] = useState('')
  const [mfaSubmitting, setMfaSubmitting] = useState(false)

  // Passwordless "email me a login link" affordance. Toggled in place next to
  // the credentials form; on success it flips to a "check your email"
  // confirmation. Kept entirely separate from the password/2FA state above.
  const [magicMode, setMagicMode] = useState(false)
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSubmitting, setMagicSubmitting] = useState(false)
  const [magicSent, setMagicSent] = useState(false)
  const [magicError, setMagicError] = useState('')

  const openMagicMode = () => {
    // Seed from whatever they already typed in the password form.
    setMagicEmail(formik.values.email)
    setMagicError('')
    setMagicSent(false)
    setMagicMode(true)
  }

  const handleMagicLinkRequest = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const email = magicEmail.trim()
    if (!email || magicSubmitting) return
    if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
      setMagicError(t('validation.invalid_email'))
      return
    }

    setMagicSubmitting(true)
    setMagicError('')

    const res = await requestMagicLink(email, props.org?.slug)
    setMagicSubmitting(false)

    if (res.rateLimited) {
      setMagicError(res.detail)
      return
    }
    // The backend answers generically whether or not the account exists, so a
    // non-rate-limited response always advances to the confirmation state.
    setMagicSent(true)
  }

  // An admin magic link for a 2FA-enabled user lands here with a pending token
  // in the query string instead of a session (see /admin/{org}/auth/magic-consume).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('mfa_token')
    if (token) setMfaToken(token)
  }, [])

  // Honor a post-login redirect via ?next / ?redirect, sanitized to an
  // internal same-origin path (no open-redirect), defaulting to /home.
  // Forward it through the cross-domain /redirect_from_auth handoff.
  const buildCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    // `redirect_to` is what the magic-link consume endpoint forwards when it
    // bounces a 2FA-enabled user here instead of signing them straight in.
    const raw = params.get('next') ?? params.get('redirect') ?? params.get('redirect_to')
    const dest = raw && /^\/(?!\/)/.test(raw) ? raw : '/home'
    return `${window.location.origin}/redirect_from_auth?next=${encodeURIComponent(dest)}`
  }

  const handleMfaSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!mfaToken || mfaSubmitting) return

    const code = mfaCode.trim()
    if (!code) return

    setMfaSubmitting(true)
    setMfaError('')

    const callbackUrl = buildCallbackUrl()
    const res = await completeMfaLogin(mfaToken, code, {
      isBackupCode: useBackupCode,
      callbackUrl,
      redirect: false,
    })

    if (res.ok) {
      track(AnalyticsEvent.LoginSucceeded, { method: 'credentials_mfa' })
      window.location.href = callbackUrl
      return
    }

    let code_ = null
    let message = t('auth.mfa_invalid_code', {
      defaultValue: "That code isn't right. Check your device's clock is set automatically, then try the next code.",
    })
    try {
      const parsed = JSON.parse(res.error || '{}')
      code_ = parsed.code ?? null
      if (parsed.message) message = parsed.message
    } catch {
      // keep the default message
    }

    track(AnalyticsEvent.LoginFailed, { method: 'credentials_mfa', error_type: code_ })

    if (code_ === 'MFA_SESSION_EXPIRED') {
      // The pending token died. Returning to the password step is the only way
      // forward — keeping the code field up would let them retry forever
      // against a token that can never be accepted.
      setMfaToken(null)
      setMfaCode('')
      setUseBackupCode(false)
      setErrorType('MFA_SESSION_EXPIRED')
      setError(message)
      setShowErrorModal(true)
      turnstileRef.current?.reset()
    } else {
      setMfaError(message)
      setMfaCode('')
    }

    setMfaSubmitting(false)
  }

  // Auto-submit once six digits are in — every authenticator app produces
  // exactly six, so making the user reach for a button is pure friction.
  // Backup codes are excluded: they are variable-shaped and pasted.
  useEffect(() => {
    if (mfaToken && !useBackupCode && !mfaSubmitting && mfaCode.length === 6) {
      handleMfaSubmit()
    }
  }, [mfaCode, useBackupCode, mfaSubmitting, mfaToken]) // eslint-disable-line

  const handleGoogleSignIn = () => {
    track(AnalyticsEvent.LoginGoogleClicked)
    // Store org context in cookies before OAuth redirect
    if (props.org?.slug) {
      const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL();
      const isSecure = window.location.protocol === 'https:';
      const secureAttr = isSecure ? '; secure' : '';
      const baseAttributes = `; path=/; SameSite=Lax${secureAttr}`;
      // Host-only on custom domains: a `.{platformTopDomain}` cookie can't be set
      // from learn.acme.org (Domain not a suffix of host) → the browser drops it
      // and the callback loses org context. Omit the Domain there.
      const domainAttr = (topDomain === 'localhost' || isOnCustomDomain()) ? '' : `; domain=.${topDomain}`;
      document.cookie = `LH_oauth_orgslug=${props.org.slug}${baseAttributes}${domainAttr}`;
      document.cookie = `LH_oauth_org_id=${props.org.id}${baseAttributes}${domainAttr}`;
    }
    // Use absolute URL with current origin for custom domain support
    signIn('google', { callbackUrl: buildCallbackUrl() });
  };

  // Check if SSO is enabled for this organization (requires enterprise plan)
  useEffect(() => {
    const checkSSO = async () => {
      // The org can switch SSO off as a sign-in method regardless of its plan.
      if (!ssoAllowed) {
        setSsoEnabled(false)
        return
      }
      // SSO is only available for enterprise plan (requires EE or SaaS/enterprise)
      const orgConfig = props.org?.config?.config
      const plan = orgConfig?.plan ?? orgConfig?.cloud?.plan
      const mode = getDeploymentMode()
      if (mode === 'oss' || (mode === 'saas' && plan !== 'enterprise')) {
        setSsoEnabled(false)
        return
      }

      if (props.org?.slug) {
        try {
          const result = await checkSSOEnabled(props.org.slug)
          setSsoEnabled(result.sso_enabled)
        } catch (error) {
          // SSO not available, silently ignore
          console.debug('SSO check failed:', error)
        }
      }
    }
    checkSSO()
  }, [props.org?.slug, props.org?.config?.config?.plan, props.org?.config?.config?.cloud?.plan, ssoAllowed]) // eslint-disable-line

  const handleSSOLogin = async () => {
    track(AnalyticsEvent.LoginSsoClicked)
    setSsoLoading(true)
    try {
      await redirectToSSOLogin(props.org.slug)
    } catch (error: any) {
      setError(error.message || t('auth.sso_error'))
      setSsoLoading(false)
    }
  }

  const validate = (values: any) => {
    const errors: any = {}

    if (!values.email) {
      errors.email = t('validation.required')
    } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
      errors.email = t('validation.invalid_email')
    }

    if (!values.password) {
      errors.password = t('validation.required')
    } else if (values.password.length < 8) {
      errors.password = t('validation.password_min_length')
    }

    return errors
  }

  const handleResendVerification = async () => {
    // org?.id is undefined on the org-less apex — the backend resends by email
    // without an org, so we only require the email here.
    if (!unverifiedEmail) return

    setIsResendingVerification(true)
    try {
      const res = await resendVerificationEmail(unverifiedEmail, props.org?.id)
      if (res.success) {
        setVerificationResent(true)
      } else {
        setError(res.error || t('auth.resend_verification_failed'))
      }
    } catch (_err) {
      setError(t('auth.resend_verification_failed'))
    } finally {
      setIsResendingVerification(false)
    }
  }

  const formik = useFormik({
    initialValues: {
      email: '',
      password: '',
    },
    validate,
    validateOnBlur: true,
    validateOnChange: true,
    onSubmit: async (values, {validateForm, setErrors, setSubmitting}) => {
      setIsSubmitting(true)
      setError('')
      setErrorType(null)
      setUnverifiedEmail(null)
      setVerificationResent(false)
      setShowErrorModal(false)
      setRetryAfter(null)

      const errors = await validateForm(values);
      if (Object.keys(errors).length > 0) {
        setErrors(errors);
        setSubmitting(false);
        setIsSubmitting(false);
        return;
      }

      track(AnalyticsEvent.LoginSubmitted, { has_sso_enabled: ssoEnabled })

      // Bot check before attempting credentials (blocks credential-stuffing).
      let botOk = false
      try {
        botOk = await verifyTurnstileToken(turnstileToken)
      } catch {
        botOk = false
      }
      if (!botOk) {
        setError(t('auth.turnstile_failed', { defaultValue: 'Verification failed. Please try again.' }))
        setSubmitting(false)
        setIsSubmitting(false)
        turnstileRef.current?.reset()
        return
      }

      // Use absolute URL with current origin for custom domain support;
      // forwards a sanitized ?next so the post-exchange landing honors it.
      const callbackUrl = buildCallbackUrl();

      let res: any = null
      try {
        res = await signIn('credentials', {
          redirect: false,
          email: values.email,
          password: values.password,
          // Bind the session to this org when the login page is org-scoped, so
          // the org's session/auth-method policy can enforce against it.
          orgSlug: props.org?.slug,
          callbackUrl
        });
      } catch {
        // Transport-level failure (offline, DNS/TLS): next-auth THROWS rather than
        // returning res.error. Without this, isSubmitting stays true and the submit
        // button is permanently disabled with a spinning loader until a reload.
        track(AnalyticsEvent.LoginFailed, { method: 'credentials', error_type: 'exception' })
        setError(t('auth.wrong_email_password'))
        setShowErrorModal(true)
        setSubmitting(false)
        setIsSubmitting(false)
        turnstileRef.current?.reset()
        return
      }

      // Password accepted, second factor outstanding. Must be checked before
      // the res.error branch below: this result carries error === null, so it
      // would otherwise fall through to the success path and redirect an
      // unauthenticated user.
      if (res && res.mfa_required && res.mfa_token) {
        track(AnalyticsEvent.LoginSubmitted, { has_sso_enabled: ssoEnabled, mfa_required: true })
        setMfaToken(res.mfa_token)
        setMfaCode('')
        setMfaError('')
        setIsSubmitting(false)
        setSubmitting(false)
        return
      }

      if (res && res.error) {
        let loginErrorType: string | null = null
        // Try to parse the error message for error codes
        try {
          // The error from next-auth might contain our structured error
          const errorData = JSON.parse(res.error);
          if (errorData.code) {
            loginErrorType = errorData.code;
            setErrorType(errorData.code);
            setError(errorData.message || t('auth.wrong_email_password'));
            if (errorData.code === 'EMAIL_NOT_VERIFIED') {
              setUnverifiedEmail(errorData.email || values.email);
            }
            if (errorData.retry_after) {
              setRetryAfter(errorData.retry_after);
            }
          } else {
            setError(t('auth.wrong_email_password'));
          }
        } catch {
          // If parsing fails, check for specific error strings
          if (res.error.includes('EMAIL_NOT_VERIFIED')) {
            loginErrorType = 'EMAIL_NOT_VERIFIED';
            setErrorType('EMAIL_NOT_VERIFIED');
            setError(t('auth.email_not_verified_message'));
            setUnverifiedEmail(values.email);
          } else if (res.error.includes('ACCOUNT_LOCKED')) {
            loginErrorType = 'ACCOUNT_LOCKED';
            setErrorType('ACCOUNT_LOCKED');
            setError(t('auth.account_locked_message'));
          } else if (res.error.includes('RATE_LIMITED')) {
            loginErrorType = 'RATE_LIMITED';
            setErrorType('RATE_LIMITED');
            setError(t('auth.rate_limited_message'));
          } else {
            setError(t('auth.wrong_email_password'));
          }
        }
        track(AnalyticsEvent.LoginFailed, { method: 'credentials', error_type: loginErrorType })
        setShowErrorModal(true);
        setIsSubmitting(false);
        // Single-use token was consumed by this attempt — refresh for the retry.
        turnstileRef.current?.reset();
      } else {
        track(AnalyticsEvent.LoginSucceeded, { method: 'credentials' })
        // First signIn already authenticated and set cookies — just redirect
        window.location.href = callbackUrl;
      }
    },
  })

  return (
    <AuthLayout
      org={props.org}
      welcomeText={t('auth.login_to')}
      title={t('auth.image_title_login', { defaultValue: 'Welcome back to LearnHouse.' })}
      subtitle={t('auth.image_subtitle_login', {
        defaultValue: 'Pick up where you left off — your courses, students, and tools are waiting.',
      })}
    >
        {/* Error Top Bar */}
        {showErrorModal && (
          <div className={`
            mx-6 md:mx-12 lg:mx-20 mt-6 rounded-xl border px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
            ${errorType === 'EMAIL_NOT_VERIFIED' && !verificationResent ? 'bg-amber-50 text-amber-700 border-amber-100' : ''}
            ${verificationResent ? 'bg-green-50 text-green-700 border-green-100' : ''}
            ${errorType === 'ACCOUNT_LOCKED' ? 'bg-red-50 text-red-700 border-red-100' : ''}
            ${errorType === 'RATE_LIMITED' ? 'bg-orange-50 text-orange-700 border-orange-100' : ''}
            ${error && !verificationResent && errorType !== 'EMAIL_NOT_VERIFIED' && errorType !== 'ACCOUNT_LOCKED' && errorType !== 'RATE_LIMITED' ? 'bg-red-50 text-red-700 border-red-100' : ''}
          `}>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {errorType === 'EMAIL_NOT_VERIFIED' && !verificationResent && <Mail size={18} className="shrink-0" />}
              {verificationResent && <Mail size={18} className="shrink-0" />}
              {errorType === 'ACCOUNT_LOCKED' && <Lock size={18} className="shrink-0" />}
              {errorType === 'RATE_LIMITED' && <Clock size={18} className="shrink-0" />}
              {error && !verificationResent && errorType !== 'EMAIL_NOT_VERIFIED' && errorType !== 'ACCOUNT_LOCKED' && errorType !== 'RATE_LIMITED' && <AlertTriangle size={18} className="shrink-0" />}

              <div className="flex-1 min-w-0">
                {errorType === 'EMAIL_NOT_VERIFIED' && !verificationResent && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{t('auth.email_not_verified_message')}</span>
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={isResendingVerification}
                      className="text-sm underline hover:no-underline disabled:opacity-50"
                    >
                      {isResendingVerification ? t('common.loading') : t('auth.resend_verification_email')}
                    </button>
                  </div>
                )}
                {verificationResent && (
                  <span className="text-sm font-medium">{t('auth.verification_email_resent')} - {t('auth.check_inbox_message')}</span>
                )}
                {errorType === 'ACCOUNT_LOCKED' && (
                  <span className="text-sm font-medium">
                    {t('auth.account_locked')}
                    {retryAfter ? ` · ${t('auth.try_again_in', { minutes: Math.max(1, Math.ceil(retryAfter / 60)) })}` : ''}
                  </span>
                )}
                {errorType === 'RATE_LIMITED' && (
                  <span className="text-sm font-medium">
                    {t('auth.rate_limited')}
                    {retryAfter ? ` · ${t('auth.try_again_in', { minutes: Math.max(1, Math.ceil(retryAfter / 60)) })}` : ''}
                  </span>
                )}
                {error && !verificationResent && errorType !== 'EMAIL_NOT_VERIFIED' && errorType !== 'ACCOUNT_LOCKED' && errorType !== 'RATE_LIMITED' && (
                  <span className="text-sm font-medium">{error}</span>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                setShowErrorModal(false)
                if (verificationResent) setVerificationResent(false)
              }}
              className="p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0 opacity-60 hover:opacity-100"
            >
              <X size={18} />
            </button>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
          <div className="w-full max-w-[420px] py-10">
            {mfaToken ? (
              <>
                {/* Second-factor challenge */}
                <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">
                  {t('auth.mfa_title', { defaultValue: 'Two-step verification' })}
                </h1>
                <p className="mt-2 text-black/45 text-[15px] font-medium">
                  {useBackupCode
                    ? t('auth.mfa_subtitle_backup', { defaultValue: 'Enter one of the backup codes you saved.' })
                    : t('auth.mfa_subtitle', { defaultValue: 'Enter the 6-digit code from your authenticator app.' })}
                </p>

                <form onSubmit={handleMfaSubmit} className="mt-8">
                  <label className="block text-[13px] font-semibold text-black/70 mb-1.5">
                    {useBackupCode
                      ? t('auth.mfa_backup_code', { defaultValue: 'Backup code' })
                      : t('auth.mfa_code', { defaultValue: 'Verification code' })}
                  </label>
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(e) => {
                      setMfaCode(
                        useBackupCode
                          ? e.target.value.toUpperCase()
                          : e.target.value.replace(/\D/g, '').slice(0, 6)
                      )
                      if (mfaError) setMfaError('')
                    }}
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode={useBackupCode ? 'text' : 'numeric'}
                    placeholder={useBackupCode ? 'XXXXX-XXXXX' : '000000'}
                    disabled={mfaSubmitting}
                    className={`box-border w-full bg-neutral-50 text-black rounded-lg px-4 border inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 transition-all placeholder:text-black/25 disabled:opacity-50 ${
                      useBackupCode
                        ? 'text-sm tracking-normal'
                        : 'text-lg tracking-[0.4em] font-semibold'
                    } ${mfaError ? 'border-red-300 focus:border-red-400' : 'border-neutral-200 focus:border-neutral-400'}`}
                  />

                  {mfaError && (
                    <p className="mt-2 text-red-600 text-xs flex items-start gap-1.5">
                      <Info size={12} className="shrink-0 mt-0.5" />
                      <span>{mfaError}</span>
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={mfaSubmitting || !mfaCode.trim()}
                    className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none mt-4 transition-all disabled:opacity-50"
                  >
                    {mfaSubmitting ? (
                      <span className="flex items-center space-x-2">
                        <span className="w-4 h-4 border-t-2 border-white rounded-full animate-spin" />
                        <span>{t('common.loading')}</span>
                      </span>
                    ) : (
                      t('auth.mfa_verify', { defaultValue: 'Verify' })
                    )}
                  </button>
                </form>

                <div className="mt-6 space-y-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setUseBackupCode(!useBackupCode)
                      setMfaCode('')
                      setMfaError('')
                    }}
                    disabled={mfaSubmitting}
                    className="text-sm text-black font-semibold hover:underline disabled:opacity-50"
                  >
                    {useBackupCode
                      ? t('auth.mfa_use_authenticator', { defaultValue: 'Use your authenticator app instead' })
                      : t('auth.mfa_use_backup', { defaultValue: 'Use a backup code instead' })}
                  </button>
                  <p>
                    <button
                      type="button"
                      onClick={() => {
                        setMfaToken(null)
                        setMfaCode('')
                        setMfaError('')
                        setUseBackupCode(false)
                        turnstileRef.current?.reset()
                      }}
                      disabled={mfaSubmitting}
                      className="text-sm text-black/35 hover:text-black/60 disabled:opacity-50"
                    >
                      {t('auth.mfa_back_to_login', { defaultValue: 'Back to sign in' })}
                    </button>
                  </p>
                </div>
              </>
            ) : magicMode ? (
              <>
                {/* Passwordless "email me a link" step */}
                <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">
                  {t('auth.magic_title', { defaultValue: 'Sign in with a link' })}
                </h1>
                {magicSent ? (
                  <>
                    <div className="mt-8 flex flex-col items-center text-center">
                      <div className="p-3 rounded-2xl bg-green-50 text-green-600">
                        <CheckCircle2 size={28} />
                      </div>
                      <h2 className="mt-4 text-lg font-bold text-black">
                        {t('auth.magic_sent_title', { defaultValue: 'Check your email' })}
                      </h2>
                      <p className="mt-2 text-black/45 text-[15px] font-medium max-w-sm">
                        {t('auth.magic_sent_body', {
                          defaultValue:
                            'If an account exists for {{email}}, we just sent it a secure link to sign in. It expires shortly, so use it soon.',
                          email: magicEmail.trim(),
                        })}
                      </p>
                    </div>
                    <div className="mt-8 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setMagicMode(false)
                          setMagicSent(false)
                          setMagicError('')
                        }}
                        className="text-sm text-black/35 hover:text-black/60"
                      >
                        {t('auth.magic_back_to_login', { defaultValue: 'Back to sign in' })}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-black/45 text-[15px] font-medium">
                      {t('auth.magic_subtitle', {
                        defaultValue:
                          'Enter your email and we’ll send you a link that signs you in — no password needed.',
                      })}
                    </p>
                    <form onSubmit={handleMagicLinkRequest} className="mt-8">
                      <label className="block text-[13px] font-semibold text-black/70 mb-1.5">
                        {t('auth.email')}
                      </label>
                      <input
                        type="email"
                        value={magicEmail}
                        onChange={(e) => {
                          setMagicEmail(e.target.value)
                          if (magicError) setMagicError('')
                        }}
                        autoFocus
                        autoComplete="email"
                        placeholder="you@example.com"
                        disabled={magicSubmitting}
                        className={`box-border w-full bg-neutral-50 text-black rounded-lg px-4 border inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 transition-all placeholder:text-black/25 text-sm disabled:opacity-50 ${
                          magicError
                            ? 'border-red-300 focus:border-red-400'
                            : 'border-neutral-200 focus:border-neutral-400'
                        }`}
                      />

                      {magicError && (
                        <p className="mt-2 text-red-600 text-xs flex items-start gap-1.5">
                          <Info size={12} className="shrink-0 mt-0.5" />
                          <span>{magicError}</span>
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={magicSubmitting || !magicEmail.trim()}
                        className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none mt-4 transition-all disabled:opacity-50"
                      >
                        {magicSubmitting ? (
                          <span className="flex items-center space-x-2">
                            <span className="w-4 h-4 border-t-2 border-white rounded-full animate-spin" />
                            <span>{t('common.loading')}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Send size={15} />
                            {t('auth.magic_send', { defaultValue: 'Email me a login link' })}
                          </span>
                        )}
                      </button>
                    </form>

                    <div className="mt-6 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setMagicMode(false)
                          setMagicError('')
                        }}
                        disabled={magicSubmitting}
                        className="text-sm text-black/35 hover:text-black/60 disabled:opacity-50"
                      >
                        {t('auth.magic_use_password', {
                          defaultValue: 'Sign in with a password instead',
                        })}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
            {/* Header */}
            <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">{t('auth.welcome_back')}</h1>
            <p className="mt-2 text-black/45 text-[15px] font-medium">
              {passwordAllowed
                ? t('auth.enter_credentials')
                : t('auth.choose_sign_in_method', {
                    defaultValue: 'Choose how you’d like to sign in.',
                  })}
            </p>

            <div className="mt-8">
              {passwordAllowed && (
              <FormLayout onSubmit={formik.handleSubmit}>
                <FormField name="email">
                  <div className="flex items-center space-x-2 mb-1.5">
                    <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.email')}</Form.Label>
                    {formik.touched.email && formik.errors.email && (
                      <span className="text-red-500 text-xs flex items-center space-x-1">
                        <Info size={11} />
                        <span>{formik.errors.email}</span>
                      </span>
                    )}
                  </div>
                  <Form.Control asChild>
                    <input
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values.email}
                      type="email"
                      className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                    />
                  </Form.Control>
                </FormField>

                <FormField name="password">
                  <div className="flex items-center space-x-2 mb-1.5">
                    <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.password')}</Form.Label>
                    {formik.touched.password && formik.errors.password && (
                      <span className="text-red-500 text-xs flex items-center space-x-1">
                        <Info size={11} />
                        <span>{formik.errors.password}</span>
                      </span>
                    )}
                    <Link
                      href="/forgot"
                      className="text-xs text-black/60 hover:text-black font-semibold transition-colors"
                    >
                      {t('auth.forgot_password')}
                    </Link>
                  </div>
                  <Form.Control asChild>
                    <input
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values.password}
                      type="password"
                      autoComplete="current-password"
                      className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                    />
                  </Form.Control>
                </FormField>

                <TurnstileWidget
                  ref={turnstileRef}
                  onToken={setTurnstileToken}
                  className="mt-2 flex justify-center"
                />

                <Form.Submit asChild>
                  <button
                    disabled={isSubmitting || (turnstileRequired && !turnstileToken)}
                    className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none mt-2 transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center space-x-2">
                        <span className="w-4 h-4 border-t-2 border-white rounded-full animate-spin" />
                        <span>{t('common.loading')}</span>
                      </span>
                    ) : (
                      t('auth.login')
                    )}
                  </button>
                </Form.Submit>
              </FormLayout>
              )}

              {/* Divider — only earns its place between two sets of options. */}
              {passwordAllowed && hasAlternativeMethods && (
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-neutral-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-3 text-black/30 bg-white text-xs font-medium">{t('common.or')}</span>
                  </div>
                </div>
              )}

              {/* Social & SSO Buttons */}
              <div className="space-y-2.5">
                {googleAllowed && (
                <button
                  onClick={handleGoogleSignIn}
                  disabled={isSubmitting}
                  className="flex justify-center items-center w-full bg-white hover:bg-neutral-50 text-black space-x-3 font-medium p-3 rounded-lg border border-neutral-200 transition-all text-sm disabled:opacity-50"
                >
                  <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="" className="w-4 h-4" />
                  <span>{t('auth.sign_in_with_google')}</span>
                </button>
                )}

                {ssoEnabled && (
                  <button
                    onClick={handleSSOLogin}
                    disabled={ssoLoading}
                    className="flex justify-center items-center w-full bg-white hover:bg-neutral-50 text-black space-x-3 font-medium p-3 rounded-lg border border-neutral-200 transition-all text-sm disabled:opacity-50"
                  >
                    <Shield size={16} />
                    <span>{ssoLoading ? t('common.loading') : t('auth.sign_in_with_sso')}</span>
                  </button>
                )}

                {magicLoginAllowed && (
                <button
                  type="button"
                  onClick={openMagicMode}
                  disabled={isSubmitting}
                  className="flex justify-center items-center w-full bg-white hover:bg-neutral-50 text-black space-x-3 font-medium p-3 rounded-lg border border-neutral-200 transition-all text-sm disabled:opacity-50"
                >
                  <Mail size={16} />
                  <span>{t('auth.magic_send', { defaultValue: 'Email me a login link' })}</span>
                </button>
                )}
              </div>

              {/* Every method is off, or the only allowed one (SSO) is not set
                  up yet. Say so instead of rendering an empty page. */}
              {!passwordAllowed && !hasAlternativeMethods && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 flex items-start gap-3">
                  <Info size={16} className="shrink-0 mt-0.5 text-black/40" />
                  <p className="text-sm text-black/60">
                    {t('auth.no_sign_in_method_available', {
                      defaultValue:
                        'This organization has restricted how members sign in, and none of the allowed methods are available here. Contact an administrator.',
                    })}
                  </p>
                </div>
              )}

              {/* Sign Up Link */}
              <p className="text-center text-sm text-black/35 mt-6">
                {t('auth.no_account')}{' '}
                <Link href="/signup" className="text-black font-semibold hover:underline">
                  {t('auth.sign_up')}
                </Link>
              </p>
            </div>
              </>
            )}
          </div>
        </div>
    </AuthLayout>
  )
}

export default LoginClient
