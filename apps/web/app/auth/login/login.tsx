'use client'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { useFormik } from 'formik'
import React, { useState, useEffect } from 'react'
import { ArrowLeft, CircleNotch, Clock, EnvelopeSimple, EnvelopeSimpleOpen, LockSimple, PaperPlaneTilt, ShieldCheck } from '@phosphor-icons/react'
import { checkSSOEnabled, redirectToSSOLogin } from '@services/auth/sso'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@components/Contexts/AuthContext'
import { removeQueryParamsFromAddressBar } from '@services/utils/ts/scrubUrl'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, getDeploymentMode, isOnCustomDomain } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import { resendVerificationEmail } from '@services/auth/auth'
import { defaultPostAuthPath } from '@services/auth/redirects'
import AuthLayout from '@components/Auth/AuthLayout'
import {
  AUTH_INPUT,
  AUTH_LINK,
  AUTH_TEXT_BUTTON,
  AuthButton,
  AuthDivider,
  AuthFieldError,
  AuthFootnote,
  AuthHeading,
  AuthLabel,
  AuthNotice,
  AuthProviderButton,
  AuthStatus,
  GoogleMark,
} from '@components/Auth/AuthUI'
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


  // Error state with type information
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState<string | null>(null)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [isResendingVerification, setIsResendingVerification] = useState(false)
  const [verificationResent, setVerificationResent] = useState(false)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  // Second-factor challenge. When mfaToken is set the credentials form is
  // replaced in place by the code step. Same route, so the ?next redirect and
  // the org context survive without being threaded through a navigation.
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const arrivedWithMfaRef = React.useRef(false)
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

  // A sign-in link for a 2FA-enabled user lands here with a pending token in
  // the query string instead of a session (see /auth/magic).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('mfa_token')
    if (token) {
      arrivedWithMfaRef.current = true
      setMfaToken(token)
      removeQueryParamsFromAddressBar(['mfa_token'])
    }
  }, [])

  // A signed-in user has nothing to do on /login → bounce to the hub. The proxy
  // does this best-effort, but pages must self-handle it too (mirrors signup.tsx).
  // Guarded by !isSubmitting so a FRESH login (which flips the session to
  // authenticated) doesn't race the onSubmit's own post-login navigation.
  // Not while a second factor is pending: a sign-in link for another account
  // hands its 2FA step over here (see /auth/magic). The ref covers the render
  // before the mfaToken state lands.
  useEffect(() => {
    if (isAuthenticated && !isSubmitting && !mfaToken && !arrivedWithMfaRef.current) {
      router.replace(defaultPostAuthPath(props.org))
    }
  }, [isAuthenticated, isSubmitting, mfaToken, router, props.org])

  // Honor a post-login redirect via ?next / ?redirect, sanitized to an
  // internal same-origin path (no open-redirect), defaulting to the org's home
  // (or the hub on the org-less apex).
  // Forward it through the cross-domain /redirect_from_auth handoff.
  const buildCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    // `redirect_to` is what the magic-link consume endpoint forwards when it
    // bounces a 2FA-enabled user here instead of signing them straight in.
    const raw = params.get('next') ?? params.get('redirect') ?? params.get('redirect_to')
    const dest = raw && /^\/(?!\/)/.test(raw) ? raw : defaultPostAuthPath(props.org)
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
      // forward; keeping the code field up would let them retry forever
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

  // Auto-submit once six digits are in: every authenticator app produces
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
    // org?.id is undefined on the org-less apex; the backend resends by email
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
        // Single-use token was consumed by this attempt, so refresh for the retry.
        turnstileRef.current?.reset();
      } else {
        track(AnalyticsEvent.LoginSucceeded, { method: 'credentials' })
        // First signIn already authenticated and set cookies, so just redirect
        window.location.href = callbackUrl;
      }
    },
  })

  const retryMinutes = retryAfter ? Math.max(1, Math.ceil(retryAfter / 60)) : null
  const isGenericError =
    !!error && !verificationResent && errorType !== 'EMAIL_NOT_VERIFIED' && errorType !== 'ACCOUNT_LOCKED' && errorType !== 'RATE_LIMITED'
  const dismissError = () => {
    setShowErrorModal(false)
    if (verificationResent) setVerificationResent(false)
  }

  return (
    <AuthLayout
      org={props.org}
      welcomeText={t('auth.login_to')}
      title={t('auth.image_title_login', { defaultValue: 'Welcome back to LearnHouse.' })}
      subtitle={t('auth.image_subtitle_login', {
        defaultValue: 'Pick up where you left off. Your courses, students, and tools are waiting.',
      })}
    >
      {showErrorModal && (
        <div className="mb-6">
          {verificationResent ? (
            <AuthNotice tone="success" icon={<EnvelopeSimple size={16} weight="fill" />} onDismiss={dismissError}>
              {t('auth.verification_email_resent')} - {t('auth.check_inbox_message')}
            </AuthNotice>
          ) : errorType === 'EMAIL_NOT_VERIFIED' ? (
            <AuthNotice tone="warning" icon={<EnvelopeSimple size={16} weight="fill" />} onDismiss={dismissError}>
              <span>{t('auth.email_not_verified_message')}</span>{' '}
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={isResendingVerification}
                className="font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-50"
              >
                {isResendingVerification ? t('common.loading') : t('auth.resend_verification_email')}
              </button>
            </AuthNotice>
          ) : errorType === 'ACCOUNT_LOCKED' ? (
            <AuthNotice tone="danger" icon={<LockSimple size={16} weight="fill" />} onDismiss={dismissError}>
              {t('auth.account_locked')}
              {retryMinutes ? ` · ${t('auth.try_again_in', { minutes: retryMinutes })}` : ''}
            </AuthNotice>
          ) : errorType === 'RATE_LIMITED' ? (
            <AuthNotice tone="warning" icon={<Clock size={16} weight="fill" />} onDismiss={dismissError}>
              {t('auth.rate_limited')}
              {retryMinutes ? ` · ${t('auth.try_again_in', { minutes: retryMinutes })}` : ''}
            </AuthNotice>
          ) : isGenericError ? (
            <AuthNotice tone="danger" onDismiss={dismissError}>
              {error}
            </AuthNotice>
          ) : null}
        </div>
      )}

      {mfaToken ? (
        <>
          {/* Second-factor challenge */}
          <AuthHeading
            title={t('auth.mfa_title', { defaultValue: 'Two-step verification' })}
            description={
              useBackupCode
                ? t('auth.mfa_subtitle_backup', { defaultValue: 'Enter one of the backup codes you saved.' })
                : t('auth.mfa_subtitle', { defaultValue: 'Enter the 6-digit code from your authenticator app.' })
            }
          />

          <form onSubmit={handleMfaSubmit} className="mt-7">
            <label htmlFor="mfa-code" className="block text-[13px] font-medium text-neutral-700 mb-1.5">
              {useBackupCode
                ? t('auth.mfa_backup_code', { defaultValue: 'Backup code' })
                : t('auth.mfa_code', { defaultValue: 'Verification code' })}
            </label>
            <input
              id="mfa-code"
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
              aria-invalid={mfaError ? true : undefined}
              aria-describedby={mfaError ? 'mfa-code-error' : undefined}
              dir="ltr"
              className={`${AUTH_INPUT} h-12 text-center ${
                useBackupCode ? 'text-sm tracking-wider' : 'text-xl font-semibold tracking-[0.5em] tabular-nums'
              }`}
            />
            <div id="mfa-code-error">
              <AuthFieldError>{mfaError}</AuthFieldError>
            </div>

            <AuthButton
              loading={mfaSubmitting}
              disabled={!mfaCode.trim()}
              className="mt-4"
            >
              {t('auth.mfa_verify', { defaultValue: 'Verify' })}
            </AuthButton>
          </form>

          <div className="mt-6 flex flex-col items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setUseBackupCode(!useBackupCode)
                setMfaCode('')
                setMfaError('')
              }}
              disabled={mfaSubmitting}
              className={`${AUTH_TEXT_BUTTON} text-neutral-900`}
            >
              {useBackupCode
                ? t('auth.mfa_use_authenticator', { defaultValue: 'Use your authenticator app instead' })
                : t('auth.mfa_use_backup', { defaultValue: 'Use a backup code instead' })}
            </button>
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
              className={AUTH_TEXT_BUTTON}
            >
              <ArrowLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
              {t('auth.mfa_back_to_login', { defaultValue: 'Back to sign in' })}
            </button>
          </div>
        </>
      ) : magicMode ? (
        magicSent ? (
          <AuthStatus
            tone="success"
            icon={<EnvelopeSimpleOpen size={22} weight="duotone" />}
            title={t('auth.magic_sent_title', { defaultValue: 'Check your email' })}
            description={t('auth.magic_sent_body', {
              defaultValue:
                'If an account exists for {{email}}, we just sent it a secure link to sign in. It expires shortly, so use it soon.',
              email: magicEmail.trim(),
            })}
          >
            <button
              type="button"
              onClick={() => {
                setMagicMode(false)
                setMagicSent(false)
                setMagicError('')
              }}
              className={`${AUTH_TEXT_BUTTON} self-center`}
            >
              <ArrowLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
              {t('auth.magic_back_to_login', { defaultValue: 'Back to sign in' })}
            </button>
          </AuthStatus>
        ) : (
          <>
            {/* Passwordless "email me a link" step */}
            <AuthHeading
              title={t('auth.magic_title', { defaultValue: 'Sign in with a link' })}
              description={t('auth.magic_subtitle', {
                defaultValue: 'Enter your email and we’ll send you a link that signs you in, no password needed.',
              })}
            />
            <form onSubmit={handleMagicLinkRequest} className="mt-7">
              <label htmlFor="magic-email" className="block text-[13px] font-medium text-neutral-700 mb-1.5">
                {t('auth.email')}
              </label>
              <input
                id="magic-email"
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
                aria-invalid={magicError ? true : undefined}
                aria-describedby={magicError ? 'magic-email-error' : undefined}
                className={AUTH_INPUT}
              />
              <div id="magic-email-error">
                <AuthFieldError>{magicError}</AuthFieldError>
              </div>

              <AuthButton
                loading={magicSubmitting}
                disabled={!magicEmail.trim()}
                icon={<PaperPlaneTilt size={16} />}
                className="mt-4"
              >
                {t('auth.magic_send', { defaultValue: 'Email me a login link' })}
              </AuthButton>
            </form>

            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setMagicMode(false)
                  setMagicError('')
                }}
                disabled={magicSubmitting}
                className={AUTH_TEXT_BUTTON}
              >
                <ArrowLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                {t('auth.magic_use_password', { defaultValue: 'Sign in with a password instead' })}
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <AuthHeading
            title={t('auth.welcome_back')}
            description={
              passwordAllowed
                ? t('auth.enter_credentials')
                : t('auth.choose_sign_in_method', { defaultValue: 'Choose how you’d like to sign in.' })
            }
          />

          <div className="mt-7">
            {passwordAllowed && (
              <FormLayout onSubmit={formik.handleSubmit} className="flex flex-col gap-4">
                <Form.Field name="email" className="grid">
                  <AuthLabel error={formik.touched.email && formik.errors.email}>{t('auth.email')}</AuthLabel>
                  <Form.Control asChild>
                    <input
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values.email}
                      type="email"
                      autoComplete="email"
                      aria-invalid={formik.touched.email && formik.errors.email ? true : undefined}
                      className={AUTH_INPUT}
                    />
                  </Form.Control>
                </Form.Field>

                <Form.Field name="password" className="grid">
                  <AuthLabel
                    error={formik.touched.password && formik.errors.password}
                    end={
                      <Link href="/forgot" className="shrink-0 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20">
                        {t('auth.forgot_password')}
                      </Link>
                    }
                  >
                    {t('auth.password')}
                  </AuthLabel>
                  <Form.Control asChild>
                    <input
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values.password}
                      type="password"
                      autoComplete="current-password"
                      aria-invalid={formik.touched.password && formik.errors.password ? true : undefined}
                      className={AUTH_INPUT}
                    />
                  </Form.Control>
                </Form.Field>

                <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} className="flex justify-center empty:hidden" />

                <Form.Submit asChild>
                  <AuthButton
                    loading={isSubmitting}
                    disabled={turnstileRequired && !turnstileToken}
                    className="mt-1"
                  >
                    {t('auth.login')}
                  </AuthButton>
                </Form.Submit>
              </FormLayout>
            )}

            {/* Divider: only earns its place between two sets of options. */}
            {passwordAllowed && hasAlternativeMethods && <AuthDivider />}

            {/* Social & SSO Buttons */}
            {hasAlternativeMethods && (
              <div className="flex flex-col gap-2.5">
                {googleAllowed && (
                  <AuthProviderButton onClick={handleGoogleSignIn} disabled={isSubmitting} icon={<GoogleMark />}>
                    {t('auth.sign_in_with_google')}
                  </AuthProviderButton>
                )}

                {ssoEnabled && (
                  <AuthProviderButton
                    onClick={handleSSOLogin}
                    disabled={ssoLoading}
                    aria-busy={ssoLoading || undefined}
                    icon={ssoLoading ? <CircleNotch size={16} className="animate-spin" /> : <ShieldCheck size={16} weight="duotone" />}
                  >
                    {ssoLoading ? t('common.loading') : t('auth.sign_in_with_sso')}
                  </AuthProviderButton>
                )}

                {magicLoginAllowed && (
                  <AuthProviderButton onClick={openMagicMode} disabled={isSubmitting} icon={<EnvelopeSimple size={16} weight="duotone" />}>
                    {t('auth.magic_send', { defaultValue: 'Email me a login link' })}
                  </AuthProviderButton>
                )}
              </div>
            )}

            {/* Every method is off, or the only allowed one (SSO) is not set
                up yet. Say so instead of rendering an empty page. */}
            {!passwordAllowed && !hasAlternativeMethods && (
              <AuthNotice tone="info">
                {t('auth.no_sign_in_method_available', {
                  defaultValue:
                    'This organization has restricted how members sign in, and none of the allowed methods are available here. Contact an administrator.',
                })}
              </AuthNotice>
            )}

            <AuthFootnote>
              {t('auth.no_account')}{' '}
              <Link href="/signup" className={AUTH_LINK}>
                {t('auth.sign_up')}
              </Link>
            </AuthFootnote>
          </div>
        </>
      )}
    </AuthLayout>
  )
}

export default LoginClient
