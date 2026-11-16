'use client'
import React from 'react'
import { useFormik } from 'formik'
import Link from 'next/link'
import * as Form from '@radix-ui/react-form'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CircleNotch, EnvelopeSimple, LinkBreak, SignIn, SignOut } from '@phosphor-icons/react'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import {
  AUTH_INPUT,
  AuthButton,
  AuthDivider,
  AuthHeading,
  AuthLabel,
  AuthNotice,
  AuthProviderButton,
  authButtonClass,
  GoogleMark,
} from '@components/Auth/AuthUI'
import PasswordInput from '@components/Auth/PasswordInput'
import { PasswordStrengthIndicator, validatePasswordStrength } from '@components/Auth/PasswordStrengthIndicator'
import CustomSignupFields, { initialCustomFieldValues, validateCustomFields } from '@components/Auth/CustomSignupFields'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { signIn, signOut, useAuth } from '@components/Contexts/AuthContext'
import { getAllowedAuthMethods } from '@services/auth/authMethods'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, getUriWithOrg, isOnCustomDomain } from '@services/config/config'
import { readSignupFields, type SignupFieldItem } from '@services/settings/org'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import {
  acceptInviteLink,
  peekInviteLink,
  signupWithInviteLink,
  type InviteLinkInfo,
} from '@services/auth/inviteLinks'
import { inviteSignInHref, setLoginHint, splitFullName } from '@/lib/auth/signup'
import { useRoleText } from '@components/Dashboard/Pages/Users/OrgUsersAdd/roleText'

/** Absolute URL on this host, for the full page loads after auth. */
function fullPageUrl(path: string): string {
  return `${window.location.origin}${path}`
}

type Phase = 'loading' | 'invalid' | 'signup' | 'signin' | 'wrong_account' | 'joining' | 'error'

/**
 * The page behind the button in an invitation email: the org's own signup page
 * (its branding comes from AuthLayout), the invited address filled in and
 * fixed. Someone new picks a password and is in the org; someone with an
 * account signs in on this page and joins; someone signed in as the invited
 * address joins at once. Never the LearnHouse org picker.
 */
export default function InviteLinkSignup({ token, org: propOrg }: { token: string; org?: any }) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('public')
  const session = useLHSession() as any
  // Credentials sign-in needs the auth context (the bare signIn only does OAuth).
  const auth = useAuth()
  const contextOrg = useOrg() as any
  const org = contextOrg && (contextOrg.id || contextOrg.slug) ? contextOrg : propOrg
  const [info, setInfo] = React.useState<InviteLinkInfo | null>(null)
  const [peeked, setPeeked] = React.useState(false)
  const [error, setError] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [verifySent, setVerifySent] = React.useState(false)
  const roleText = useRoleText()
  const joinStarted = React.useRef(false)

  const sessionStatus: string = session?.status
  const sessionEmail: string = (session?.data?.user?.email || '').toLowerCase()
  const accessToken: string | undefined = session?.data?.tokens?.access_token

  React.useEffect(() => {
    let cancelled = false
    peekInviteLink(token).then((res) => {
      if (cancelled) return
      setInfo(res.ok ? res.data : null)
      setPeeked(true)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const orgName = info?.org.name || org?.name || ''
  const orgSlug = info?.org.slug || org?.slug || ''
  const goToOrg = React.useCallback(() => {
    window.location.assign(getUriWithOrg(orgSlug, '/'))
  }, [orgSlug])

  let phase: Phase = 'loading'
  if (peeked && !info) phase = 'invalid'
  else if (info && sessionStatus !== 'loading') {
    if (sessionStatus === 'authenticated') phase = sessionEmail === info.email.toLowerCase() ? 'joining' : 'wrong_account'
    // A copied link doesn't say whether the address has an account: offer
    // signup, with a way to sign in instead.
    else phase = info.account_exists ? 'signin' : 'signup'
  }
  if (phase === 'joining' && error) phase = 'error'

  // Signed in as the invited address: join straight away.
  React.useEffect(() => {
    if (phase !== 'joining' || joinStarted.current || !accessToken) return
    joinStarted.current = true
    acceptInviteLink(token, accessToken).then(async (res) => {
      if (res.ok) {
        track(AnalyticsEvent.SignupSucceeded, { email_verified: true })
        await session.update?.(true)
        goToOrg()
      } else {
        setError(getErrorMessage(res.detail, t('common.something_went_wrong')))
      }
    })
  }, [phase, accessToken, token, session, goToOrg, t, track])

  const allowed = React.useMemo(() => getAllowedAuthMethods(org), [org])
  const passwordAllowed = allowed.has('password')
  const googleAllowed = allowed.has('google')
  const customFields = React.useMemo<SignupFieldItem[]>(() => readSignupFields(org), [org])
  const backHere = `/signup?invite=${token}`

  const continueWithGoogle = () => {
    track(AnalyticsEvent.SignupGoogleClicked)
    if (org?.slug) {
      const top = getLEARNHOUSE_TOP_DOMAIN_VAL()
      const secure = window.location.protocol === 'https:' ? '; secure' : ''
      const domain = top === 'localhost' || isOnCustomDomain() ? '' : `; domain=.${top}`
      document.cookie = `LH_oauth_orgslug=${org.slug}; path=/; SameSite=Lax${secure}${domain}`
      document.cookie = `LH_oauth_org_id=${org.id}; path=/; SameSite=Lax${secure}${domain}`
    }
    // Back to this page once signed in, which then joins the org.
    setError('')
    signIn('google', { callbackUrl: `${window.location.origin}/redirect_from_auth?next=${encodeURIComponent(backHere)}` }).then((res) => {
      if (res && !res.ok) {
        track(AnalyticsEvent.SignupFailed, { method: 'google', status_code: res.status })
        setError(res.error || t('common.something_went_wrong'))
      }
    })
  }

  const formik = useFormik({
    initialValues: { password: '', name: '', custom_fields: initialCustomFieldValues(customFields) },
    enableReinitialize: true,
    validate: (values) => {
      const errors: any = {}
      if (!values.password) errors.password = t('validation.required')
      else if (!validatePasswordStrength(values.password).isValid) errors.password = t('auth.password_requirements_not_met')
      const custom = validateCustomFields(customFields, values.custom_fields, t)
      if (Object.keys(custom).length) errors.custom_fields = custom
      return errors
    },
    onSubmit: async (values) => {
      if (!info) return
      setSubmitting(true)
      setError('')
      track(AnalyticsEvent.SignupSubmitted, { invite_code_present: true, has_bio: false })
      const res = await signupWithInviteLink({
        token,
        password: values.password,
        ...splitFullName(values.name),
        ...(customFields.length ? { custom_fields: values.custom_fields } : {}),
      })
      if (!res.ok) {
        track(AnalyticsEvent.SignupFailed, { status_code: res.status })
        setError(getErrorMessage(res.detail, t('common.something_went_wrong')))
        setSubmitting(false)
        return
      }
      if (res.data.verification_required) {
        // A copied link proves nothing about the inbox: the account exists,
        // and the invitation applies once the email is verified.
        track(AnalyticsEvent.SignupSucceeded, { email_verified: false })
        setVerifySent(true)
        setSubmitting(false)
        return
      }
      track(AnalyticsEvent.SignupSucceeded, { email_verified: true })
      // The link proved the inbox, so the new account can sign in right away.
      const signed: any = await auth.signIn('credentials', {
        redirect: false,
        email: info.email,
        password: values.password,
        orgSlug: info.org.slug,
      }).catch(() => null)
      // Full page loads: the new session and membership must be read fresh.
      if (signed && !signed.error && !signed.mfa_required) {
        window.location.assign(fullPageUrl(`/redirect_from_auth?next=${encodeURIComponent('/')}`))
        return
      }
      setLoginHint(info.email)
      window.location.assign(fullPageUrl('/login'))
    },
  })

  if (phase === 'loading' || (phase === 'joining' && !error)) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center" role="status" data-testid="invite-link-loading">
        <CircleNotch size={22} className="animate-spin text-neutral-400" aria-hidden="true" />
        {phase === 'joining' && (
          <p className="text-sm text-neutral-500">{t('auth.invite_link.joining', { org: orgName, defaultValue: 'Joining {{org}}…' })}</p>
        )}
      </div>
    )
  }

  if (phase === 'invalid') {
    return (
      <div data-testid="invite-link-invalid">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
          <LinkBreak size={22} weight="duotone" aria-hidden="true" />
        </div>
        <AuthHeading
          title={t('auth.invite_link.invalid_title', { defaultValue: 'This invitation link has expired' })}
          description={t('auth.invite_link.invalid_desc', {
            defaultValue: 'It was already used, withdrawn, or replaced by a newer invitation. Ask the person who invited you to send a new one.',
          })}
        />
        <div className="mt-6 flex flex-col gap-2.5">
          {sessionStatus === 'authenticated' ? (
            <a href="/" className={authButtonClass('primary')}>
              <span>{t('auth.invite_link.go_to_org', { org: orgName, defaultValue: 'Go to {{org}}' })}</span>
              <ArrowRight size={16} aria-hidden="true" data-dir-flip="" />
            </a>
          ) : (
            <Link href="/login" className={authButtonClass('primary')}>
              <SignIn size={16} aria-hidden="true" />
              <span>{t('auth.login')}</span>
            </Link>
          )}
        </div>
      </div>
    )
  }

  if (!info) return null

  if (phase === 'wrong_account') {
    return (
      <div data-testid="invite-link-wrong-account">
        <AuthHeading
          title={t('auth.invite_link.wrong_account_title', { defaultValue: 'This invitation is for another address' })}
          description={t('auth.invite_link.wrong_account_desc', {
            current: session?.data?.user?.email,
            email: info.email,
            defaultValue: "You're signed in as {{current}}, but the invitation was sent to {{email}}.",
          })}
        />
        <AuthButton
          type="button"
          className="mt-6"
          icon={<SignOut size={16} />}
          onClick={() => signOut({ redirect: true, callbackUrl: window.location.href })}
        >
          {t('auth.invite_link.switch_account', { defaultValue: 'Sign out and continue' })}
        </AuthButton>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div data-testid="invite-link-error">
        <AuthNotice tone="danger">{error}</AuthNotice>
        <a href="/" className={authButtonClass('secondary', 'mt-4')}>
          {t('auth.invite_link.go_to_org', { org: orgName, defaultValue: 'Go to {{org}}' })}
        </a>
      </div>
    )
  }

  const details = info.invitation
  // Built-in roles read in the visitor's language ("Learner", not "User").
  const roleLabel = details?.role ? roleText({ role_uuid: details.role.role_uuid, name: details.role.name }).name : ''
  const copiedLink = details ? details.proves_inbox === false : false

  if (verifySent) {
    return (
      <div data-testid="invite-link-verify">
        <AuthHeading
          title={t('auth.invite_link.verify_title')}
          description={t('auth.invite_link.verify_desc', { email: info.email, org: orgName })}
        />
      </div>
    )
  }
  const joiningAs = (
    <>
      <div className="mt-6 flex items-center gap-2.5 rounded-xl bg-neutral-50 px-3.5 py-2.5 ring-1 ring-inset ring-neutral-200/80 min-w-0">
        <EnvelopeSimple size={16} className="shrink-0 text-neutral-400" aria-hidden="true" />
        <span className="truncate text-sm text-neutral-800" data-testid="invite-email">{info.email}</span>
      </div>
      {details && (details.role || details.message || details.courses.length > 0 || details.usergroups.length > 0 || copiedLink) && (
        <div className="mt-3 rounded-xl px-3.5 py-3 ring-1 ring-inset ring-neutral-200/80 text-[13px] leading-relaxed text-neutral-600" data-testid="invite-details">
          {details.role && (
            <p>
              {details.invited_by
                ? t('auth.invite_link.details.role_by', { name: details.invited_by, role: roleLabel })
                : t('auth.invite_link.details.role', { role: roleLabel })}
            </p>
          )}
          {details.message && (
            <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 italic text-neutral-700 whitespace-pre-line" dir="auto">
              {details.message}
            </p>
          )}
          {details.usergroups.length > 0 && (
            <p className="mt-2">{t('auth.invite_link.details.groups', { names: details.usergroups.join(', ') })}</p>
          )}
          {details.courses.length > 0 && (
            <p className="mt-1">{t('auth.invite_link.details.courses', { names: details.courses.join(', ') })}</p>
          )}
          {copiedLink && <p className="mt-2 text-neutral-500">{t('auth.invite_link.details.verify_note')}</p>}
        </div>
      )}
    </>
  )

  if (phase === 'signin') {
    return (
      <div data-testid="invite-link-signin">
        <AuthHeading
          title={t('auth.invite_link.signin_title', { org: orgName, defaultValue: 'Join {{org}}' })}
          description={t('auth.invite_link.signin_desc', {
            defaultValue: 'You already have an account. Sign in and you will join right away.',
          })}
        />
        {joiningAs}
        <div className="mt-5 flex flex-col gap-2.5">
          <a
            href={inviteSignInHref(token)}
            onClick={() => setLoginHint(info.email)}
            className={authButtonClass('primary')}
          >
            <SignIn size={16} aria-hidden="true" />
            <span>{t('auth.invite_link.signin_cta', { defaultValue: 'Sign in to join' })}</span>
          </a>
          {googleAllowed && (
            <AuthProviderButton onClick={continueWithGoogle} icon={<GoogleMark />}>
              {t('auth.sign_in_with_google')}
            </AuthProviderButton>
          )}
        </div>
      </div>
    )
  }

  // New here: one password and they're in.
  return (
    <div data-testid="invite-link-signup">
      <AuthHeading
        title={t('auth.invite_link.signup_title', { org: orgName, defaultValue: 'Join {{org}}' })}
        description={t('auth.invite_link.signup_desc', {
          defaultValue: "You've been invited. Choose a password and you're in.",
        })}
      />
      {joiningAs}

      {error && (
        <AuthNotice tone="danger" className="mt-5">
          {error}
        </AuthNotice>
      )}

      {googleAllowed && (
        <>
          <AuthProviderButton onClick={continueWithGoogle} disabled={submitting} icon={<GoogleMark />} className="mt-5">
            {t('auth.sign_in_with_google')}
          </AuthProviderButton>
          {passwordAllowed && <AuthDivider />}
        </>
      )}

      {passwordAllowed && (
        <FormLayout onSubmit={formik.handleSubmit} className={`flex flex-col gap-4 ${googleAllowed ? '' : 'mt-5'}`}>
          {/* Lets password managers save the login under the right address. */}
          <input type="email" name="username" value={info.email} autoComplete="username" readOnly hidden />
          <Form.Field name="password" className="grid min-w-0">
            <AuthLabel error={formik.touched.password && formik.errors.password}>
              {t('auth.invite_link.choose_password', { defaultValue: 'Choose a password' })}
            </AuthLabel>
            <Form.Control asChild>
              <PasswordInput
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.password}
                autoComplete="new-password"
                autoFocus
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
                value={formik.values.name}
                type="text"
                autoComplete="name"
                maxLength={100}
                className={AUTH_INPUT}
              />
            </Form.Control>
          </Form.Field>

          <CustomSignupFields fields={customFields} formik={formik} />

          <Form.Submit asChild>
            <AuthButton loading={submitting} className="mt-1">
              {t('auth.invite_link.create_and_join', { org: orgName, defaultValue: 'Join {{org}}' })}
            </AuthButton>
          </Form.Submit>
        </FormLayout>
      )}

      {!passwordAllowed && !googleAllowed && (
        <AuthNotice tone="info" className="mt-5">
          {t('auth.no_sign_up_method_available')}
        </AuthNotice>
      )}

      {/* A copied link doesn't say whether the address has an account. */}
      {info.account_exists === undefined && (
        <p className="mt-5 text-center text-[13px] text-neutral-500">
          <a href={inviteSignInHref(token)} onClick={() => setLoginHint(info.email)} className="font-semibold text-neutral-800 hover:underline">
            {t('auth.invite_link.signin_cta', { defaultValue: 'Sign in to join' })}
          </a>
        </p>
      )}
    </div>
  )
}
