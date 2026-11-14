'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useEffect, useRef, useState } from 'react'
import { CircleNotch, EnvelopeSimple, Ticket, UserPlus } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import UserAvatar from '@components/Objects/UserAvatar'
import OpenSignUpComponent from './OpenSignup'
import InviteOnlySignUpComponent from './InviteOnlySignUp'
import { useRouter, useSearchParams } from 'next/navigation'
import { validateInviteCode } from '@services/organizations/invites'
import { joinOrg } from '@services/organizations/orgs'
import { getDeploymentMode, getUriWithOrg } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
import { AUTH_INPUT, AuthButton, AuthHeading, AuthLabel, AuthNotice } from '@components/Auth/AuthUI'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'

interface SignUpClientProps {
  org: any
}

function SignUpClient(props: SignUpClientProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const [joinMethod, setJoinMethod] = React.useState('open')
  const [inviteCode, setInviteCode] = React.useState('')
  const searchParams = useSearchParams()
  const inviteCodeParam = searchParams.get('inviteCode')

  const isAuthenticated = session.status === 'authenticated'
  // There is only an org to JOIN when we actually resolved one (a subdomain or an
  // invite). On the org-less apex (`learnhouse.io/signup`) props.org is null, so a
  // signed-in visitor has nothing to join; signing up there means they want their
  // own LearnHouse, so send them to create an organization.
  const hasOrgToJoin = !!props.org

  useEffect(() => {
    if (isAuthenticated && !hasOrgToJoin) {
      // /new only exists in SaaS; an invite code means they came to join, and
      // the hub forwards them to their school.
      router.replace(getDeploymentMode() === 'saas' && !inviteCodeParam ? '/new' : '/home')
    }
  }, [isAuthenticated, hasOrgToJoin, inviteCodeParam, router])

  useEffect(() => {
    // On the org-less apex (learn.io/signup) props.org is null; guard it and
    // fall back to open signup instead of crashing.
    if (props.org?.config) {
      const config = props.org?.config?.config
      const isV2 = config?.config_version?.startsWith('2')
      const signupMode = isV2
        ? config?.admin_toggles?.members?.signup_mode
        : config?.features?.members?.signup_mode
      setJoinMethod(signupMode || 'open')
    }
    if (inviteCodeParam) {
      setInviteCode(inviteCodeParam)
    }
  }, [props.org, inviteCodeParam])

  return (
    <AuthLayout
      org={props.org}
      welcomeText={t('auth.invited_to_join')}
      title={t('auth.image_title_signup', { defaultValue: 'Start teaching with LearnHouse.' })}
      subtitle={t('auth.image_subtitle_signup', {
        defaultValue: 'Create your account and launch your first course in minutes.',
      })}
    >
      {session.status === 'loading' && (
        // Don't flash the open/invite signup form while the session is still
        // resolving; a logged-in user would otherwise briefly see it.
        <div className="flex justify-center py-16" role="status" aria-label={t('common.loading')}>
          <CircleNotch size={22} className="animate-spin text-neutral-400" />
        </div>
      )}
      {session.status !== 'loading' && joinMethod == 'open' &&
        (isAuthenticated ? (
          hasOrgToJoin ? (
            <LoggedInJoinScreen inviteCode={inviteCode} org={props.org} />
          ) : (
            // Signed in on the org-less apex; the effect above redirects them.
            <div className="flex justify-center py-16" role="status" aria-label={t('common.loading')}>
              <CircleNotch size={22} className="animate-spin text-neutral-400" />
            </div>
          )
        ) : (
          <OpenSignUpComponent org={props.org} />
        ))}
      {session.status !== 'loading' && joinMethod == 'inviteOnly' &&
        (inviteCode ? (
          session.status == 'authenticated' ? (
            <LoggedInJoinScreen inviteCode={inviteCode} org={props.org} />
          ) : (
            <InviteOnlySignUpComponent inviteCode={inviteCode} org={props.org} />
          )
        ) : (
          <NoTokenScreen org={props.org} />
        ))}
    </AuthLayout>
  )
}

interface JoinScreenProps {
  inviteCode: string
  org: any
}

const LoggedInJoinScreen = ({ inviteCode, org }: JoinScreenProps) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const contextOrg = useOrg() as any
  const activeOrg = contextOrg || org
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showMessage, setShowMessage] = useState(false)
  const router = useRouter()
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current)
  }, [])

  const join = async () => {
    setIsSubmitting(true)
    setError('')
    setSuccess('')
    setShowMessage(false)

    try {
      const res = await joinOrg(
        { org_id: activeOrg.id, user_id: session?.data?.user?.user_uuid, invite_code: inviteCode },
        null,
        session.data?.tokens?.access_token
      )

      if (res.success) {
        setSuccess(typeof res.data === 'string' ? res.data : t('auth.join_organization_success'))
        setShowMessage(true)
        // Refresh session so the new org membership appears in session.data.roles
        await session.update?.(true)
        redirectTimeoutRef.current = setTimeout(() => {
          router.push(getUriWithOrg(activeOrg.slug, '/'))
        }, 2000)
      } else {
        setError(getErrorMessage(res.data?.detail, t('common.something_went_wrong')))
        setShowMessage(true)
      }
    } catch (err) {
      // A network/session throw must not leave the button spinning forever.
      setError(getErrorMessage((err as any)?.detail, t('common.something_went_wrong')))
      setShowMessage(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  const user = session.data?.user
  return (
    <>
      {showMessage && (error || success) && (
        <AuthNotice tone={error ? 'danger' : 'success'} onDismiss={() => setShowMessage(false)} className="mb-6">
          {error || success}
        </AuthNotice>
      )}

      <AuthHeading title={t('auth.join_organization')} description={t('auth.join_organization_desc')} />

      <div className="mt-7 rounded-2xl ring-1 ring-inset ring-neutral-200/80 overflow-hidden">
        <div className="flex items-center gap-3 p-4 min-w-0">
          <UserAvatar rounded="rounded-xl" width={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{user?.first_name} {user?.last_name}</p>
            <p className="truncate text-xs text-neutral-500">@{user?.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-neutral-100 bg-neutral-50/70 px-4 py-3 min-w-0">
          <span className="text-xs text-neutral-500 shrink-0">{t('auth.joining')}</span>
          <span className="ms-auto truncate text-sm font-semibold text-neutral-900">{activeOrg?.name}</span>
        </div>
      </div>

      <div className="mt-5">
        {user?.email_verified === false ? (
          <AuthNotice tone="warning" icon={<EnvelopeSimple size={16} weight="fill" />} title={t('auth.email_verification_required')}>
            {t('auth.email_verification_required_join')}
          </AuthNotice>
        ) : (
          <AuthButton type="button" onClick={join} loading={isSubmitting} icon={<UserPlus size={16} />}>
            {t('auth.join_organization')}
          </AuthButton>
        )}
      </div>
    </>
  )
}

interface NoTokenScreenProps {
  org: any
}

const NoTokenScreen = ({ org }: NoTokenScreenProps) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const contextOrg = useOrg() as any
  const activeOrg = contextOrg || org
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showMessage, setShowMessage] = useState(false)

  const validateCode = async (e: React.FormEvent) => {
    e.preventDefault()
    // No org context (e.g. the org-less apex) → there is nothing to validate an
    // invite against. Guard the undefined org id instead of silently failing.
    if (!activeOrg?.id) {
      setError(t('auth.invite_code_invalid'))
      setShowMessage(true)
      return
    }
    // A whitespace-only code isn't a real invite, so treat it as empty.
    const trimmedCode = inviteCode.trim()
    if (!trimmedCode) {
      setError(t('auth.invite_code_invalid'))
      setShowMessage(true)
      return
    }
    setIsSubmitting(true)
    setError('')
    setSuccess('')
    setShowMessage(false)

    try {
      const res = await validateInviteCode(activeOrg.id, trimmedCode, session?.data?.tokens?.access_token)

      if (res.success) {
        setSuccess(t('auth.invite_code_valid'))
        setShowMessage(true)
        setTimeout(() => {
          router.push(`/signup?inviteCode=${trimmedCode}`)
        }, 1500)
      } else {
        setError(getErrorMessage(res.data?.detail, t('auth.invite_code_invalid')))
        setShowMessage(true)
      }
    } catch (err) {
      // A network throw must not leave the button stuck spinning.
      setError(getErrorMessage((err as any)?.detail, t('auth.invite_code_invalid')))
      setShowMessage(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {showMessage && (error || success) && (
        <AuthNotice tone={error ? 'danger' : 'success'} onDismiss={() => setShowMessage(false)} className="mb-6">
          {error || success}
        </AuthNotice>
      )}

      <AuthHeading title={t('auth.invite_required')} description={t('auth.invite_required_desc', { org: activeOrg?.name })} />

      <FormLayout onSubmit={validateCode} className="mt-7 flex flex-col gap-4">
        <Form.Field name="invite_code" className="grid">
          <AuthLabel>{t('auth.invite_code')}</AuthLabel>
          <Form.Control asChild>
            <input
              onChange={(e) => setInviteCode(e.target.value)}
              value={inviteCode}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('auth.enter_invite_code')}
              required
              className={AUTH_INPUT}
            />
          </Form.Control>
        </Form.Field>

        <Form.Submit asChild>
          <AuthButton loading={isSubmitting} disabled={!inviteCode.trim()} icon={<Ticket size={16} />} className="mt-1">
            {t('auth.validate_invite')}
          </AuthButton>
        </Form.Submit>
      </FormLayout>
    </>
  )
}

export default SignUpClient
