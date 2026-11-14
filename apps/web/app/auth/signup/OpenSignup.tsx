'use client'
import { useFormik } from 'formik'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { EnvelopeSimple, User } from '@phosphor-icons/react'
import { AUTH_INPUT, AUTH_LINK, AUTH_TEXTAREA, AuthButton, AuthDivider, AuthFootnote, AuthHeading, AuthLabel, AuthNotice, AuthProviderButton, GoogleMark } from '@components/Auth/AuthUI'
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
import { defaultPostAuthPath } from '@services/auth/redirects'
import CustomSignupFields, {
  initialCustomFieldValues,
  validateCustomFields,
} from '@components/Auth/CustomSignupFields'
import { readSignupFields, type SignupFieldItem } from '@services/settings/org'

// On the platform's own signup page (no org: someone starting their own
// LearnHouse) the username and bio are not asked: the username is made from
// the email, and the profile can be filled in later.
export function usernameFromEmail(email: string): string {
  const base = (email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const padded = base.length >= 4 ? base : `${base}user`.slice(0, 8)
  return `${padded}${Math.floor(1000 + Math.random() * 9000)}`
}

const validate = (values: any, t: any, customFields: SignupFieldItem[], platformSignup = false) => {
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

  if (platformSignup) {
    // Made from the email at submit.
  } else if (!values.username) {
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
  const platformSignup = !org
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
    validate: (values) => validate(values, t, customFields, platformSignup),
    enableReinitialize: true,
    onSubmit: async (values) => {
      setError('')
      setMessage(null)
      setIsSubmitting(true)
      track(AnalyticsEvent.SignupSubmitted, { invite_code_present: false, has_bio: !!values.bio })
      try {
        let res = await signup(platformSignup && !values.username ? { ...values, username: usernameFromEmail(values.email) } : values)
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
          // Turnstile tokens are single-use, so fetch a fresh one for the retry.
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
  // cross-domain /redirect_from_auth handoff; default to the org's home (or the
  // hub on the org-less apex).
  const buildCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('next') ?? params.get('redirect')
    const dest = raw && /^\/(?!\/)/.test(raw) ? raw : defaultPostAuthPath(org)
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
    <div className="w-full">
      <AuthHeading title={t('auth.create_account')} description={t('auth.fill_in_details')} />

      <div className="mt-7">
      {error && (
        <AuthNotice tone="danger" className="mb-6">
          {error}
        </AuthNotice>
      )}

      {message && message.email_verified === false && (
        <AuthNotice tone="success" icon={<EnvelopeSimple size={16} weight="fill" />} title={t('auth.check_email_for_verification')} className="mb-6">
          <p>{t('auth.verification_email_sent_message')}</p>
            {/* Resend, so a user whose email doesn't arrive isn't stuck. */}
            <div className="mt-2">
              {resendState === 'sent' ? (
                <p className="text-xs font-medium">
                  {t('auth.verification_email_resent', { defaultValue: 'Verification email sent again. Check your inbox.' })}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={resendState === 'sending'}
                  onClick={async () => {
                    setResendState('sending')
                    // org?.id is undefined on the org-less apex; that's fine, the
                    // backend resends by email without an org.
                    const res = await resendVerificationEmail(formik.values.email, org?.id)
                    setResendState(res.success ? 'sent' : 'error')
                  }}
                  className="text-xs font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-50 text-start"
                >
                  {resendState === 'sending'
                    ? t('common.loading', { defaultValue: 'Sending…' })
                    : t('auth.resend_verification', { defaultValue: "Didn't get it? Resend email" })}
                </button>
              )}
              {resendState === 'error' && (
                <p className="mt-1 text-xs text-rose-600">{t('auth.resend_verification_failed', { defaultValue: 'Could not resend. Please try again shortly.' })}</p>
              )}
            </div>
          <div className="mt-3 pt-3 border-t border-emerald-600/10">
            <Link className="inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline" href="/login">
              <User size={14} aria-hidden="true" />
              <span>{t('auth.login')}</span>
            </Link>
          </div>
        </AuthNotice>
      )}

      {message && message.email_verified && (
        <AuthNotice tone="success" icon={<EnvelopeSimple size={16} weight="fill" />} title={t('auth.account_created_success')} className="mb-6">
          <div className="mt-1">
            <Link className="inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline" href="/login">
              <User size={14} aria-hidden="true" />
              <span>{t('auth.login')}</span>
            </Link>
          </div>
        </AuthNotice>
      )}
        {passwordAllowed && (
        <FormLayout onSubmit={formik.handleSubmit} className="flex flex-col gap-4">
            <Form.Field name="email" className="grid min-w-0">
              <AuthLabel error={formik.touched.email && formik.errors.email}>{t('auth.email')}</AuthLabel>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.email}
                  type="email"
                  autoComplete="email"
                  required
                  aria-invalid={formik.touched.email && formik.errors.email ? true : undefined}
                  className={AUTH_INPUT}
                />
              </Form.Control>
            </Form.Field>

          <div className="grid grid-cols-2 gap-3">
            <Form.Field name="first_name" className="grid min-w-0">
              <AuthLabel error={formik.touched.first_name && formik.errors.first_name}>{t('user.first_name')}</AuthLabel>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.first_name}
                  type="text"
                  autoComplete="given-name"
                  aria-invalid={formik.touched.first_name && formik.errors.first_name ? true : undefined}
                  className={AUTH_INPUT}
                />
              </Form.Control>
            </Form.Field>
            <Form.Field name="last_name" className="grid min-w-0">
              <AuthLabel error={formik.touched.last_name && formik.errors.last_name}>{t('user.last_name')}</AuthLabel>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.last_name}
                  type="text"
                  autoComplete="family-name"
                  aria-invalid={formik.touched.last_name && formik.errors.last_name ? true : undefined}
                  className={AUTH_INPUT}
                />
              </Form.Control>
            </Form.Field>
          </div>

            <Form.Field name="password" className="grid min-w-0">
              <AuthLabel error={formik.touched.password && formik.errors.password}>{t('auth.password')}</AuthLabel>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.password}
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-invalid={formik.touched.password && formik.errors.password ? true : undefined}
                  className={AUTH_INPUT}
                />
              </Form.Control>
              <PasswordStrengthIndicator password={formik.values.password} />
            </Form.Field>

            {!platformSignup && (
            <Form.Field name="username" className="grid min-w-0">
              <AuthLabel error={formik.touched.username && formik.errors.username}>{t('user.username')}</AuthLabel>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.username}
                  type="text"
                  autoComplete="username"
                  required
                  aria-invalid={formik.touched.username && formik.errors.username ? true : undefined}
                  className={AUTH_INPUT}
                />
              </Form.Control>
            </Form.Field>

            )}

            {!platformSignup && (
            <Form.Field name="bio" className="grid">
              <AuthLabel>{`${t('user.bio')} (${t('common.optional')})`}</AuthLabel>
              <Form.Control asChild>
                <textarea
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.bio}
                  placeholder={t('user.bio_placeholder')}
                  className={AUTH_TEXTAREA}
                />
              </Form.Control>
            </Form.Field>
            )}

            <CustomSignupFields fields={customFields} formik={formik} />

            <TurnstileWidget
              ref={turnstileRef}
              onToken={(token) => formik.setFieldValue('turnstileToken', token)}
              className="flex justify-center empty:hidden"
            />

            <Form.Submit asChild>
              <AuthButton
                loading={isSubmitting}
                disabled={!!message || (turnstileRequired && !formik.values.turnstileToken)}
                className="mt-1"
              >
                {t('auth.create_account')}
              </AuthButton>
            </Form.Submit>
          </FormLayout>
        )}

        {/* Divider: only earns its place between two sets of options. */}
        {passwordAllowed && googleAllowed && <AuthDivider />}

        {googleAllowed && (
          <AuthProviderButton onClick={handleGoogleSignIn} disabled={isSubmitting} icon={<GoogleMark />}>
            {t('auth.sign_in_with_google')}
          </AuthProviderButton>
        )}

        {!passwordAllowed && !googleAllowed && (
          <AuthNotice tone="info">
            {t('auth.no_sign_up_method_available', {
              defaultValue:
                'This organization has restricted how members sign in, so accounts can’t be created here. Contact an administrator.',
            })}
          </AuthNotice>
        )}

      <AuthFootnote>
        {t('auth.already_have_account')}{' '}
        <Link href="/login" className={AUTH_LINK}>
          {t('auth.login')}
        </Link>
      </AuthFootnote>
      </div>
    </div>
  )
}

export default OpenSignUpComponent
