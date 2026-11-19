'use client'
import React from 'react'
import { useFormik } from 'formik'
import Link from 'next/link'
import * as Form from '@radix-ui/react-form'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, ArrowRight, CircleNotch, EnvelopeSimple, LinkBreak, SignIn, SignOut } from '@phosphor-icons/react'
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
import { getUriWithOrg } from '@services/config/config'
import { resendVerificationEmail } from '@services/auth/auth'
import { readSignupFields, type SignupFieldItem } from '@services/settings/org'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import {
  acceptInviteLink,
  peekInviteLink,
  signupWithInviteLink,
  type InviteLinkInfo,
} from '@services/auth/inviteLinks'
import {
  acceptedInvitePhase,
  invitePeekOutcome,
  inviteSignInHref,
  isMemberLimitError,
  isOrgMember,
  rememberPostAuthNext,
  setLoginHint,
  splitFullName,
  takePostAuthNext,
  type InvitePeekOutcome,
} from '@/lib/auth/signup'
import { setOAuthContextCookies } from '@/lib/auth/oauthCookiesClient'
import { useRoleText } from '@components/Dashboard/Pages/Users/OrgUsersAdd/roleText'

/** Absolute URL on this host, for the full page loads after auth. */
function fullPageUrl(path: string): string {
  return `${window.location.origin}${path}`
}

type Phase =
  | 'loading'
  | 'invalid'
  | 'retry'
  | 'accepted'
  | 'to_org'
  | 'signup'
  | 'signin'
  | 'wrong_account'
  | 'joining'
  | 'error'

/** The link is gone (used, withdrawn, replaced or mangled). */
export function InviteLinkInvalid({ org: propOrg }: { org?: any }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const contextOrg = useOrg() as any
  const orgName = contextOrg?.name || propOrg?.name || ''
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
        {session?.status === 'authenticated' ? (
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
  // Peek answer: the invitation, or why there is none (gone, or worth a retry).
  const [peek, setPeek] = React.useState<{ outcome: InvitePeekOutcome; info: InviteLinkInfo | null } | null>(null)
  const [peekAttempt, setPeekAttempt] = React.useState(0)
  const info = peek?.info ?? null
  const [error, setError] = React.useState('')
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [resendState, setResendState] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [submitting, setSubmitting] = React.useState(false)
  const [verifySent, setVerifySent] = React.useState(false)
  const roleText = useRoleText()
  const joinStarted = React.useRef(false)

  // A full org is the admin's to fix: the invitee gets no upgrade wording.
  const inviteErrorMessage = (detail: unknown) =>
    isMemberLimitError(detail) ? t('auth.invite_link.org_full') : getErrorMessage(detail, t('common.something_went_wrong'), t)

  const sessionStatus: string = session?.status
  const sessionEmail: string = (session?.data?.user?.email || '').toLowerCase()
  const accessToken: string | undefined = session?.data?.tokens?.access_token

  React.useEffect(() => {
    let cancelled = false
    peekInviteLink(token).then((res) => {
      if (cancelled) return
      setPeek({ outcome: invitePeekOutcome(res), info: res.ok ? res.data : null })
    })
    return () => {
      cancelled = true
    }
  }, [token, peekAttempt])
  const retryPeek = () => {
    setPeek(null)
    setPeekAttempt((n) => n + 1)
  }

  // The invitation's org decides the form (sign-in methods, signup fields) and
  // the org a Google sign-in joins. The host's org is that org only when the
  // ids match (a renamed slug, the platform domain or another subdomain would
  // otherwise show the wrong form and send the wrong org_id).
  const inviteOrgId = info?.org.id
  const hostIsInviteOrg = !!org?.id && org.id === inviteOrgId
  const [fetchedOrg, setFetchedOrg] = React.useState<{ id: number; org: any } | null>(null)
  React.useEffect(() => {
    if (!info || hostIsInviteOrg) return
    let cancelled = false
    const want = info.org
    Promise.resolve()
      .then(() => getOrganizationContextInfo(want.slug, null))
      .then((o: any) => (o && o.id === want.id ? o : null))
      .catch(() => null)
      .then((o) => {
        // Unreadable: the invitation's own org summary (default methods, no fields).
        if (!cancelled) setFetchedOrg({ id: want.id, org: o || want })
      })
    return () => {
      cancelled = true
    }
  }, [info, hostIsInviteOrg])
  const inviteOrg: any = !info ? org : hostIsInviteOrg ? org : fetchedOrg?.id === inviteOrgId ? fetchedOrg?.org : null

  const orgName = info?.org.name || org?.name || ''
  const orgSlug = info?.org.slug || org?.slug || ''
  const goToOrg = React.useCallback(() => {
    window.location.assign(getUriWithOrg(orgSlug, '/'))
  }, [orgSlug])

  const signedIn = sessionStatus === 'authenticated'
  let phase: Phase = 'loading'
  if (peek?.outcome === 'retry') phase = 'retry'
  else if (peek && sessionStatus === 'loading') phase = 'loading'
  // Used already (by this person, typically right after joining with Google):
  // a member goes straight to the org; someone signed in who isn't one (removed
  // since, or another account) is told the link was used.
  else if (peek?.outcome === 'accepted') phase = acceptedInvitePhase(signedIn, session?.data?.roles, info?.org.id ?? org?.id)
  else if (peek?.outcome === 'invalid') phase = signedIn && isOrgMember(session?.data?.roles, org?.id) ? 'to_org' : 'invalid'
  else if (info) {
    if (signedIn) phase = sessionEmail === info.email.toLowerCase() ? 'joining' : 'wrong_account'
    // A copied link doesn't say whether the address has an account: offer
    // signup, with a way to sign in instead.
    else phase = info.account_exists ? 'signin' : 'signup'
  }
  // The invitation's org config is still on its way.
  if ((phase === 'signin' || phase === 'signup') && !inviteOrg) phase = 'loading'
  if (phase === 'joining' && error) phase = 'error'

  React.useEffect(() => {
    if (phase === 'to_org') goToOrg()
  }, [phase, goToOrg])

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
        setErrorCode(typeof res.detail?.code === 'string' ? res.detail.code : null)
        setError(inviteErrorMessage(res.detail))
      }
    })
  }, [phase, accessToken, token, session, goToOrg, t, track])

  const allowed = React.useMemo(() => getAllowedAuthMethods(inviteOrg), [inviteOrg])
  const passwordAllowed = allowed.has('password')
  const googleAllowed = allowed.has('google')
  const customFields = React.useMemo<SignupFieldItem[]>(() => readSignupFields(inviteOrg), [inviteOrg])
  const backHere = `/signup?invite=${token}`

  const continueWithGoogle = () => {
    track(AnalyticsEvent.SignupGoogleClicked)
    // The invitation token rides along: the sign-in itself joins the org and
    // accepts the invitation when the Google address is the invited one.
    setOAuthContextCookies({
      orgSlug: info?.org.slug || org?.slug,
      orgId: info?.org.id || org?.id,
      inviteToken: token,
    })
    // Back to this page once signed in, which then joins the org (the callback
    // goes to the org itself when the sign-in already accepted).
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
      // A copied link waits for the email to be verified: verifying (and the
      // sign-in after) comes back to this invitation.
      rememberPostAuthNext(backHere)
      const res = await signupWithInviteLink({
        token,
        password: values.password,
        ...splitFullName(values.name),
        ...(customFields.length ? { custom_fields: values.custom_fields } : {}),
      })
      if (!res.ok) {
        takePostAuthNext()
        track(AnalyticsEvent.SignupFailed, { status_code: res.status })
        setError(inviteErrorMessage(res.detail))
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
      takePostAuthNext()
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

  if (phase === 'loading' || phase === 'to_org' || (phase === 'joining' && !error)) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center" role="status" data-testid="invite-link-loading">
        <CircleNotch size={22} className="animate-spin text-neutral-400" aria-hidden="true" />
        {phase === 'joining' && (
          <p className="text-sm text-neutral-500">{t('auth.invite_link.joining', { org: orgName, defaultValue: 'Joining {{org}}…' })}</p>
        )}
      </div>
    )
  }

  if (phase === 'invalid') return <InviteLinkInvalid org={org} />

  // No answer (offline, rate limited, server busy): the link may well be fine.
  if (phase === 'retry') {
    return (
      <div data-testid="invite-link-retry">
        <AuthHeading title={t('auth.invite_link.retry_title')} description={t('auth.invite_link.retry_desc')} />
        <AuthButton type="button" className="mt-6" icon={<ArrowClockwise size={16} />} onClick={retryPeek}>
          {t('auth.invite_link.try_again')}
        </AuthButton>
      </div>
    )
  }

  if (!info) return null

  if (phase === 'accepted') {
    return (
      <div data-testid="invite-link-accepted">
        <AuthHeading
          title={t('auth.invite_link.accepted_title')}
          description={t('auth.invite_link.accepted_desc', { org: orgName })}
        />
        <a
          href="/login"
          onClick={() => info.email && setLoginHint(info.email)}
          className={authButtonClass('primary', 'mt-6')}
        >
          <SignIn size={16} aria-hidden="true" />
          <span>{t('auth.login')}</span>
        </a>
      </div>
    )
  }

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
        {/* Joining waits for a verified address: offer the email again. */}
        {errorCode === 'INVITE_VERIFY_EMAIL' && sessionEmail && (
          <div className="mt-3 text-[13px] text-neutral-500">
            {resendState === 'sent' ? (
              <p className="font-medium text-emerald-700">{t('auth.verification_email_resent')}</p>
            ) : (
              <button
                type="button"
                disabled={resendState === 'sending'}
                onClick={async () => {
                  setResendState('sending')
                  rememberPostAuthNext(backHere)
                  const res = await resendVerificationEmail(sessionEmail, info.org.id, backHere)
                  setResendState(res.success ? 'sent' : 'error')
                }}
                className="font-medium text-neutral-700 underline underline-offset-2 hover:no-underline disabled:opacity-50 text-start"
              >
                {resendState === 'sending' ? t('common.loading') : t('auth.resend_verification_email')}
              </button>
            )}
            {resendState === 'error' && <p className="mt-1 text-xs text-rose-600">{t('auth.resend_verification_failed')}</p>}
          </div>
        )}
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
