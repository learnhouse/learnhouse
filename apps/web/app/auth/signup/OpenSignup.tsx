'use client'
import { useFormik } from 'formik'
import React from 'react'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { EnvelopeSimple, SignIn } from '@phosphor-icons/react'
import { AUTH_INPUT, AUTH_LINK, AuthButton, AuthDivider, AuthFootnote, AuthHeading, AuthLabel, AuthNotice, AuthProviderButton, authButtonClass, GoogleMark } from '@components/Auth/AuthUI'
import Link from 'next/link'
import { signup, signUpWithInviteCode, resendVerificationEmail } from '@services/auth/auth'
import { useOrg } from '@components/Contexts/OrgContext'
import { signIn } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, isOnCustomDomain } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useTranslation } from 'react-i18next'
import { PasswordStrengthIndicator, validatePasswordStrength } from '@components/Auth/PasswordStrengthIndicator'
import PasswordInput from '@components/Auth/PasswordInput'
import TurnstileWidget, { useTurnstileRequired, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getAllowedAuthMethods } from '@services/auth/authMethods'
import { defaultPostAuthPath } from '@services/auth/redirects'
import CustomSignupFields, {
  initialCustomFieldValues,
  validateCustomFields,
} from '@components/Auth/CustomSignupFields'
import { readSignupFields, type SignupFieldItem } from '@services/settings/org'
import { rememberPostAuthNext, splitFullName, usernameFromEmail } from '@/lib/auth/signup'
import { readNextParam, useForwardedNextHref } from '@/lib/auth/nextParam'

export { usernameFromEmail }

// One screen, as few fields as possible: email, password (with a show toggle
// and the rules ticking inline), an optional name, and only the extra fields
// the org itself requires. No username (made from the email) and no bio (the
// profile can be filled in later).
const validate = (values: any, t: any, customFields: SignupFieldItem[]) => {
  const errors: any = {}

  if (!values.email) {
    errors.email = t('validation.required')
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email.trim())) {
    errors.email = t('validation.invalid_email')
  }

  if (!values.password) {
    errors.password = t('validation.required')
  } else if (!validatePasswordStrength(values.password).isValid) {
    errors.password = t('auth.password_requirements_not_met')
  }

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
  /** Invite-only org: the code from the invite link or the code screen. */
  inviteCode?: string
}

function OpenSignUpComponent({ org: propOrg, inviteCode }: OpenSignUpComponentProps = {}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('public')
  // Keep ?next when switching to login (e.g. back to the course they tried to start).
  const loginHref = useForwardedNextHref('/login')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const contextOrg = useOrg() as any
  const org = (contextOrg && (contextOrg.id || contextOrg.slug)) ? contextOrg : propOrg
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
      name: '',
      custom_fields: initialCustomFieldValues(customFields),
      turnstileToken: null as string | null,
    },
    validate: (values) => validate(values, t, customFields),
    enableReinitialize: true,
    onSubmit: async (values) => {
      setError('')
      setMessage(null)
      setIsSubmitting(true)
      track(AnalyticsEvent.SignupSubmitted, { invite_code_present: !!inviteCode, has_bio: false })
      const { name, ...rest } = values
      const email = values.email.trim()
      // Keep where they were headed (a course they tried to start) through the
      // verification email: sent with the signup (stored with the token) and
      // remembered on this host as a fallback.
      const next = readNextParam(window.location.search)
      rememberPostAuthNext(next)
      const body = { ...rest, ...splitFullName(name), email, username: usernameFromEmail(email), next }
      try {
        const res = inviteCode ? await signUpWithInviteCode(body, inviteCode) : await signup(body)
        const data = await res.json().catch(() => ({}))
        if (res.status == 200) {
          track(AnalyticsEvent.SignupSucceeded, { email_verified: data.email_verified })
          setMessage(data)
        } else {
          // Surface the backend's actual error detail for ANY non-2xx (incl. 409
          // already-exists, 422 validation, 503 email-service-down) instead of
          // masking everything behind a generic message.
          track(AnalyticsEvent.SignupFailed, { status_code: res.status })
          setError(getErrorMessage(data?.detail, t('common.something_went_wrong')))
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
      // Invite-only orgs need the invite code itself, not just the org: the
      // OAuth callback joins through /users/{org_id}/invite/{code}. Without it
      // a Google sign-up through an invite link is refused.
      if (inviteCode) {
        document.cookie = `LH_oauth_invite_code=${encodeURIComponent(inviteCode)}${baseAttributes}${domainAttr}`;
      }
    }
    // Use absolute URL with current origin for custom domain support. On
    // success this navigates to Google; a failure used to be swallowed, which
    // left people clicking a button that did nothing.
    setError('')
    signIn('google', { callbackUrl: buildCallbackUrl() }).then((res) => {
      if (res && !res.ok) {
        track(AnalyticsEvent.SignupFailed, { method: 'google', status_code: res.status })
        setError(res.error || t('common.something_went_wrong'))
      }
    });
  };

  // Account created, inbox to confirm: the form steps aside for one clear
  // next step instead of a notice stacked above a used-up form.
  if (message) {
    const verified = message.email_verified !== false
    return (
      <div className="w-full" data-testid="signup-done">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <EnvelopeSimple size={22} weight="duotone" aria-hidden="true" />
        </div>
        <AuthHeading
          title={verified ? t('auth.account_created_success') : t('auth.check_email_for_verification')}
          description={verified ? undefined : t('auth.verification_sent_to', {
            email: formik.values.email.trim(),
            defaultValue: 'We sent a confirmation link to {{email}}. Open it to start using your account.',
          })}
        />
        {!verified && (
          <div className="mt-4 text-[13px] text-neutral-500">
            {resendState === 'sent' ? (
              <p className="font-medium text-emerald-700">
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
                  const res = await resendVerificationEmail(formik.values.email.trim(), org?.id, readNextParam(window.location.search))
                  setResendState(res.success ? 'sent' : 'error')
                }}
                className="font-medium text-neutral-700 underline underline-offset-2 hover:no-underline disabled:opacity-50 text-start"
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
        )}
        <Link href={loginHref} className={authButtonClass(verified ? 'primary' : 'secondary', 'mt-6')}>
          <SignIn size={16} aria-hidden="true" />
          <span>{t('auth.login')}</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full">
      <AuthHeading title={t('auth.create_account')} description={t('auth.signup_one_step', { defaultValue: 'It takes less than a minute.' })} />

      <div className="mt-7">
        {error && (
          <AuthNotice tone="danger" className="mb-6">
            {error}
          </AuthNotice>
        )}

        {/* Google first: one click, nothing to type. */}
        {googleAllowed && (
          <AuthProviderButton onClick={handleGoogleSignIn} disabled={isSubmitting} icon={<GoogleMark />}>
            {t('auth.sign_in_with_google')}
          </AuthProviderButton>
        )}

        {passwordAllowed && googleAllowed && <AuthDivider />}

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
                  inputMode="email"
                  required
                  autoFocus
                  aria-invalid={formik.touched.email && formik.errors.email ? true : undefined}
                  className={AUTH_INPUT}
                />
              </Form.Control>
            </Form.Field>

            <Form.Field name="password" className="grid min-w-0">
              <AuthLabel error={formik.touched.password && formik.errors.password}>{t('auth.password')}</AuthLabel>
              <Form.Control asChild>
                <PasswordInput
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.password}
                  autoComplete="new-password"
                  required
                  aria-invalid={formik.touched.password && formik.errors.password ? true : undefined}
                />
              </Form.Control>
              <PasswordStrengthIndicator password={formik.values.password} />
            </Form.Field>

            <Form.Field name="name" className="grid min-w-0">
              <AuthLabel>{`${t('auth.your_name', { defaultValue: 'Your name' })} (${t('common.optional')})`}</AuthLabel>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.name}
                  type="text"
                  autoComplete="name"
                  maxLength={100}
                  className={AUTH_INPUT}
                />
              </Form.Control>
            </Form.Field>

            <CustomSignupFields fields={customFields} formik={formik} />

            <TurnstileWidget
              ref={turnstileRef}
              onToken={(token) => formik.setFieldValue('turnstileToken', token)}
              className="flex justify-center empty:hidden"
            />

            <Form.Submit asChild>
              <AuthButton
                loading={isSubmitting}
                disabled={turnstileRequired && !formik.values.turnstileToken}
                className="mt-1"
              >
                {t('auth.create_account')}
              </AuthButton>
            </Form.Submit>
          </FormLayout>
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
          <Link href={loginHref} className={AUTH_LINK}>
            {t('auth.login')}
          </Link>
        </AuthFootnote>
      </div>
    </div>
  )
}

export default OpenSignUpComponent
