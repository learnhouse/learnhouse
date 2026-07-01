'use client'
import FormLayout, {
  FormField,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { useFormik } from 'formik'
import React, { useState, useEffect } from 'react'
import { AlertTriangle, Info, Lock, Mail, Shield, X, Clock } from 'lucide-react'
import { checkSSOEnabled, redirectToSSOLogin } from '@services/auth/sso'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, getDeploymentMode } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import { resendVerificationEmail } from '@services/auth/auth'
import AuthLayout from '@components/Auth/AuthLayout'
import TurnstileWidget, { useTurnstileRequired, verifyTurnstileToken, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface LoginClientProps {
  org: any
}

const LoginClient = (props: LoginClientProps) => {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const { track } = useLHAnalytics('public')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = React.useRef<TurnstileWidgetHandle>(null)
  const turnstileRequired = useTurnstileRequired()
  const _router = useRouter();
  const _session = useLHSession() as any;

  // Error state with type information
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState<string | null>(null)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [isResendingVerification, setIsResendingVerification] = useState(false)
  const [verificationResent, setVerificationResent] = useState(false)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  // Honor a post-login redirect via ?next / ?redirect, sanitized to an
  // internal same-origin path (no open-redirect), defaulting to /home.
  // Forward it through the cross-domain /redirect_from_auth handoff.
  const buildCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('next') ?? params.get('redirect')
    const dest = raw && /^\/(?!\/)/.test(raw) ? raw : '/home'
    return `${window.location.origin}/redirect_from_auth?next=${encodeURIComponent(dest)}`
  }

  const handleGoogleSignIn = () => {
    track(AnalyticsEvent.LoginGoogleClicked)
    // Store org context in cookies before OAuth redirect
    if (props.org?.slug) {
      const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL();
      const isSecure = window.location.protocol === 'https:';
      const secureAttr = isSecure ? '; secure' : '';
      const baseAttributes = `; path=/; SameSite=Lax${secureAttr}`;
      const domainAttr = topDomain === 'localhost' ? '' : `; domain=.${topDomain}`;
      document.cookie = `LH_oauth_orgslug=${props.org.slug}${baseAttributes}${domainAttr}`;
      document.cookie = `LH_oauth_org_id=${props.org.id}${baseAttributes}${domainAttr}`;
    }
    // Use absolute URL with current origin for custom domain support
    signIn('google', { callbackUrl: buildCallbackUrl() });
  };

  // Check if SSO is enabled for this organization (requires enterprise plan)
  useEffect(() => {
    const checkSSO = async () => {
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
  }, [props.org?.slug, props.org?.config?.config?.plan, props.org?.config?.config?.cloud?.plan]) // eslint-disable-line

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
    if (!unverifiedEmail || !props.org?.id) return

    setIsResendingVerification(true)
    try {
      const res = await resendVerificationEmail(unverifiedEmail, props.org.id)
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
      if (!(await verifyTurnstileToken(turnstileToken))) {
        setError(t('auth.turnstile_failed', { defaultValue: 'Verification failed. Please try again.' }))
        setSubmitting(false)
        setIsSubmitting(false)
        turnstileRef.current?.reset()
        return
      }

      // Use absolute URL with current origin for custom domain support;
      // forwards a sanitized ?next so the post-exchange landing honors it.
      const callbackUrl = buildCallbackUrl();

      const res = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
        callbackUrl
      });

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
            w-full px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
            ${errorType === 'EMAIL_NOT_VERIFIED' && !verificationResent ? 'bg-amber-500 text-white' : ''}
            ${verificationResent ? 'bg-green-500 text-white' : ''}
            ${errorType === 'ACCOUNT_LOCKED' ? 'bg-red-500 text-white' : ''}
            ${errorType === 'RATE_LIMITED' ? 'bg-orange-500 text-white' : ''}
            ${error && !verificationResent && errorType !== 'EMAIL_NOT_VERIFIED' && errorType !== 'ACCOUNT_LOCKED' && errorType !== 'RATE_LIMITED' ? 'bg-red-500 text-white' : ''}
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
              className="p-1 hover:bg-white/20 rounded transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
          <div className="w-full max-w-[420px] py-10">
            {/* Header */}
            <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">{t('auth.welcome_back')}</h1>
            <p className="mt-2 text-black/45 text-[15px] font-medium">{t('auth.enter_credentials')}</p>

            <div className="mt-8">
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

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-neutral-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 text-black/30 bg-white text-xs font-medium">{t('common.or')}</span>
                </div>
              </div>

              {/* Social & SSO Buttons */}
              <div className="space-y-2.5">
                <button
                  onClick={handleGoogleSignIn}
                  className="flex justify-center items-center w-full bg-white hover:bg-neutral-50 text-black space-x-3 font-medium p-3 rounded-lg border border-neutral-200 transition-all text-sm"
                >
                  <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="" className="w-4 h-4" />
                  <span>{t('auth.sign_in_with_google')}</span>
                </button>

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
              </div>

              {/* Sign Up Link */}
              <p className="text-center text-sm text-black/35 mt-6">
                {t('auth.no_account')}{' '}
                <Link href="/signup" className="text-black font-semibold hover:underline">
                  {t('auth.sign_up')}
                </Link>
              </p>
            </div>
          </div>
        </div>
    </AuthLayout>
  )
}

export default LoginClient
