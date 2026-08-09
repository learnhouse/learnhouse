'use client'
import { useFormik } from 'formik'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import FormLayout, {
  FormField,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { AlertTriangle, Info, Mail, User } from 'lucide-react'
import Link from 'next/link'
import { signup, resendVerificationEmail } from '@services/auth/auth'
import { useOrg } from '@components/Contexts/OrgContext'
import { signIn } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, isOnCustomDomain } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useTranslation } from 'react-i18next'
import { PasswordStrengthIndicator, validatePasswordStrength } from '@components/Auth/PasswordStrengthIndicator'
import TurnstileWidget, { useTurnstileRequired, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getAllowedAuthMethods } from '@services/auth/authMethods'
import CustomSignupFields, {
  initialCustomFieldValues,
  validateCustomFields,
} from '@components/Auth/CustomSignupFields'
import { readSignupFields, type SignupFieldItem } from '@services/settings/org'

const validate = (values: any, t: any, customFields: SignupFieldItem[]) => {
  const errors: any = {}

  if (!values.email) {
    errors.email = t('validation.required')
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
    errors.email = t('validation.invalid_email')
  }

  if (!values.password) {
    errors.password = t('validation.required')
  } else {
    const passwordValidation = validatePasswordStrength(values.password)
    if (!passwordValidation.isValid) {
      errors.password = t('auth.password_requirements_not_met')
    }
  }

  if (!values.username) {
    errors.username = t('validation.required')
  } else if (values.username.length < 4) {
    errors.username = t('validation.username_min_length')
  }

  // Bio is optional - no validation required

  // The org's admin-defined fields. Client-side only; the server revalidates.
  const customFieldErrors = validateCustomFields(customFields, values.custom_fields, t)
  if (Object.keys(customFieldErrors).length > 0) {
    errors.custom_fields = customFieldErrors
  }

  return errors
}

interface OpenSignUpComponentProps {
  // On the org-less apex the OrgContext is empty, so the signup page resolves
  // the instance default org server-side and passes it down here. Prefer it over
  // the (possibly null) context so the POST always targets a real org_id.
  org?: any
}

function OpenSignUpComponent({ org: propOrg }: OpenSignUpComponentProps = {}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('public')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const contextOrg = useOrg() as any
  const org = (contextOrg && (contextOrg.id || contextOrg.slug)) ? contextOrg : propOrg
  const _router = useRouter()
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState<{ email_verified: boolean } | null>(null)
  const [resendState, setResendState] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const turnstileRef = React.useRef<TurnstileWidgetHandle>(null)
  const turnstileRequired = useTurnstileRequired()

  // The org's allowed sign-in methods also govern how an account may be
  // created: minting a password account for an org that refuses password
  // sign-in produces an account that can never be used. The backend refuses
  // both, so offering them here would only surface a 403.
  const allowedMethods = React.useMemo(() => getAllowedAuthMethods(org), [org])
  const passwordAllowed = allowedMethods.has('password')
  const googleAllowed = allowedMethods.has('google')

  // Field definitions ship with the org config the page already loaded, so no
  // extra request is needed to render them.
  const customFields = React.useMemo<SignupFieldItem[]>(
    () => readSignupFields(org),
    [org],
  )

  const formik = useFormik({
    initialValues: {
      org_slug: org?.slug,
      org_id: org?.id,
      email: '',
      password: '',
      username: '',
      bio: '',
      first_name: '',
      last_name: '',
      custom_fields: initialCustomFieldValues(customFields),
      turnstileToken: null as string | null,
    },
    validate: (values) => validate(values, t, customFields),
    enableReinitialize: true,
    onSubmit: async (values) => {
      setError('')
      setMessage(null)
      setIsSubmitting(true)
      track(AnalyticsEvent.SignupSubmitted, { invite_code_present: false, has_bio: !!values.bio })
      try {
        let res = await signup(values)
        let message = await res.json().catch(() => ({}))
        if (res.status == 200) {
          track(AnalyticsEvent.SignupSucceeded, { email_verified: message.email_verified })
          setMessage(message)
        } else {
          // Surface the backend's actual error detail for ANY non-2xx (incl. 409
          // already-exists, 422 validation, 503 email-service-down) instead of
          // masking everything past the handful of hardcoded statuses behind a
          // generic message. Fall back to a generic string only when the backend
          // gave us nothing readable.
          track(AnalyticsEvent.SignupFailed, { status_code: res.status })
          setError(getErrorMessage(message?.detail, t('common.something_went_wrong')))
          // Turnstile tokens are single-use — fetch a fresh one for the retry.
          turnstileRef.current?.reset()
        }
      } catch (err) {
        // A network throw must not leave the form permanently locked.
        setError(getErrorMessage((err as any)?.detail, t('common.something_went_wrong')))
        turnstileRef.current?.reset()
      } finally {
        setIsSubmitting(false)
      }
    },
  })

  useEffect(() => { }, [org])

  // Honor a sanitized ?next / ?redirect destination through the
  // cross-domain /redirect_from_auth handoff; default to /home.
  const buildCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('next') ?? params.get('redirect')
    const dest = raw && /^\/(?!\/)/.test(raw) ? raw : '/home'
    return `${window.location.origin}/redirect_from_auth?next=${encodeURIComponent(dest)}`
  }

  const handleGoogleSignIn = () => {
    track(AnalyticsEvent.SignupGoogleClicked)
    // Store org context in cookies before OAuth redirect
    if (org?.slug) {
      const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL();
      const isSecure = window.location.protocol === 'https:';
      const secureAttr = isSecure ? '; secure' : '';
      const baseAttributes = `; path=/; SameSite=Lax${secureAttr}`;
      // Host-only on custom domains (a .{platformTopDomain} cookie can't be set
      // from learn.acme.org → browser drops it → callback loses org context).
      const domainAttr = (topDomain === 'localhost' || isOnCustomDomain()) ? '' : `; domain=.${topDomain}`;
      document.cookie = `LH_oauth_orgslug=${org.slug}${baseAttributes}${domainAttr}`;
      document.cookie = `LH_oauth_org_id=${org.id}${baseAttributes}${domainAttr}`;
    }
    // Use absolute URL with current origin for custom domain support
    signIn('google', { callbackUrl: buildCallbackUrl() });
  };

  return (
    <div className="w-full max-w-[420px] py-10">
      {/* Header */}
      <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">{t('auth.create_account')}</h1>
      <p className="mt-2 text-black/45 text-[15px] font-medium">{t('auth.fill_in_details')}</p>

      <div className="mt-8">
        {/* Error/Success Messages */}
        {error && (
          <div className="flex justify-center bg-red-50 rounded-xl text-red-600 space-x-2 items-center p-4 mb-6 border border-red-100">
            <AlertTriangle size={18} className="shrink-0" />
            <div className="font-medium text-sm">{error}</div>
          </div>
        )}

        {message && message.email_verified === false && (
          <div className="flex flex-col gap-4 bg-green-50 rounded-xl text-green-700 p-4 mb-6 border border-green-100">
            <div className="flex items-center gap-2">
              <Mail size={18} />
              <div className="font-semibold text-sm">{t('auth.check_email_for_verification')}</div>
            </div>
            <p className="text-xs text-green-600">
              {t('auth.verification_email_sent_message')}
            </p>
            {/* Resend, so a user whose email doesn't arrive isn't stuck. */}
            {resendState === 'sent' ? (
              <p className="text-xs font-medium text-green-700">
                {t('auth.verification_email_resent', { defaultValue: 'Verification email sent again — check your inbox.' })}
              </p>
            ) : (
              <button
                type="button"
                disabled={resendState === 'sending'}
                onClick={async () => {
                  setResendState('sending')
                  // org?.id is undefined on the org-less apex — that's fine, the
                  // backend resends by email without an org.
                  const res = await resendVerificationEmail(formik.values.email, org?.id)
                  setResendState(res.success ? 'sent' : 'error')
                }}
                className="text-xs font-semibold text-green-800 hover:underline disabled:opacity-50 text-start w-fit"
              >
                {resendState === 'sending'
                  ? t('common.loading', { defaultValue: 'Sending…' })
                  : t('auth.resend_verification', { defaultValue: "Didn't get it? Resend email" })}
              </button>
            )}
            {resendState === 'error' && (
              <p className="text-xs text-red-500">{t('auth.resend_verification_failed', { defaultValue: 'Could not resend. Please try again shortly.' })}</p>
            )}
            <hr className="border-green-100" />
            <Link className="flex items-center gap-2 text-sm font-medium hover:underline" href="/login">
              <User size={14} />
              <span>{t('auth.login')}</span>
            </Link>
          </div>
        )}

        {message && message.email_verified && (
          <div className="flex flex-col gap-4 bg-green-50 rounded-xl text-green-700 p-4 mb-6 border border-green-100">
            <div className="flex items-center gap-2">
              <Mail size={18} />
              <div className="font-semibold text-sm">{t('auth.account_created_success')}</div>
            </div>
            <hr className="border-green-100" />
            <Link className="flex items-center gap-2 text-sm font-medium hover:underline" href="/login">
              <User size={14} />
              <span>{t('auth.login')}</span>
            </Link>
          </div>
        )}

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
                required
                className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
              />
            </Form.Control>
          </FormField>

          <div className="flex flex-row space-x-2">
            <FormField name="first_name">
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('user.first_name')}</Form.Label>
                {formik.touched.first_name && formik.errors.first_name && (
                  <span className="text-red-500 text-xs flex items-center space-x-1">
                    <Info size={11} />
                    <span>{formik.errors.first_name}</span>
                  </span>
                )}
              </div>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.first_name}
                  type="text"
                  className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                />
              </Form.Control>
            </FormField>
            <FormField name="last_name">
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('user.last_name')}</Form.Label>
                {formik.touched.last_name && formik.errors.last_name && (
                  <span className="text-red-500 text-xs flex items-center space-x-1">
                    <Info size={11} />
                    <span>{formik.errors.last_name}</span>
                  </span>
                )}
              </div>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.last_name}
                  type="text"
                  className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                />
              </Form.Control>
            </FormField>
          </div>

          <FormField name="password">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.password')}</Form.Label>
              {formik.touched.password && formik.errors.password && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.password}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.password}
                type="password"
                autoComplete="new-password"
                required
                className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
              />
            </Form.Control>
            <PasswordStrengthIndicator password={formik.values.password} />
          </FormField>

          <FormField name="username">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('user.username')}</Form.Label>
              {formik.touched.username && formik.errors.username && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.username}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.username}
                type="text"
                required
                className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
              />
            </Form.Control>
          </FormField>

          <FormField name="bio">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-black/70">{`${t('user.bio')} (${t('common.optional')})`}</Form.Label>
            </div>
            <Form.Control asChild>
              <textarea
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.bio}
                placeholder={t('user.bio_placeholder')}
                className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 py-3 border border-neutral-200 appearance-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm resize-none min-h-[80px]"
              />
            </Form.Control>
          </FormField>

          <CustomSignupFields fields={customFields} formik={formik} />

          <TurnstileWidget
            ref={turnstileRef}
            onToken={(token) => formik.setFieldValue('turnstileToken', token)}
            className="mt-2 flex justify-center"
          />

          <Form.Submit asChild>
            <button
              disabled={isSubmitting || !!message || (turnstileRequired && !formik.values.turnstileToken)}
              className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none mt-2 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="flex items-center space-x-2">
                  <span className="w-4 h-4 border-t-2 border-white rounded-full animate-spin" />
                  <span>{t('common.loading')}</span>
                </span>
              ) : (
                t('auth.create_account')
              )}
            </button>
          </Form.Submit>
        </FormLayout>
        )}

        {/* Divider — only earns its place between two sets of options. */}
        {passwordAllowed && googleAllowed && (
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 text-black/30 bg-white text-xs font-medium">{t('common.or')}</span>
            </div>
          </div>
        )}

        {/* Google Sign In */}
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

        {!passwordAllowed && !googleAllowed && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 flex items-start gap-3">
            <Info size={16} className="shrink-0 mt-0.5 text-black/40" />
            <p className="text-sm text-black/60">
              {t('auth.no_sign_up_method_available', {
                defaultValue:
                  'This organization has restricted how members sign in, so accounts can’t be created here. Contact an administrator.',
              })}
            </p>
          </div>
        )}

        {/* Login Link */}
        <p className="text-center text-sm text-black/35 mt-6">
          {t('auth.already_have_account')}{' '}
          <Link href="/login" className="text-black font-semibold hover:underline">
            {t('auth.login')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default OpenSignUpComponent
