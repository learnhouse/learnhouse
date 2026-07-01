'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, Mail, Ticket, UserPlus, X } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import UserAvatar from '@components/Objects/UserAvatar'
import OpenSignUpComponent from './OpenSignup'
import InviteOnlySignUpComponent from './InviteOnlySignUp'
import { useRouter, useSearchParams } from 'next/navigation'
import { validateInviteCode } from '@services/organizations/invites'
import { joinOrg } from '@services/organizations/orgs'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
import FormLayout, {
  FormField,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'

interface SignUpClientProps {
  org: any
}

function SignUpClient(props: SignUpClientProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const [joinMethod, setJoinMethod] = React.useState('open')
  const [inviteCode, setInviteCode] = React.useState('')
  const searchParams = useSearchParams()
  const inviteCodeParam = searchParams.get('inviteCode')

  useEffect(() => {
    // On the org-less apex (learn.io/signup) props.org is null — guard it and
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
      {joinMethod == 'open' &&
        (session.status == 'authenticated' ? (
          <LoggedInJoinScreen inviteCode={inviteCode} org={props.org} />
        ) : (
          <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
            <OpenSignUpComponent org={props.org} />
          </div>
        ))}
      {joinMethod == 'inviteOnly' &&
        (inviteCode ? (
          session.status == 'authenticated' ? (
            <LoggedInJoinScreen inviteCode={inviteCode} org={props.org} />
          ) : (
            <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
              <InviteOnlySignUpComponent inviteCode={inviteCode} />
            </div>
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

  const join = async () => {
    setIsSubmitting(true)
    setError('')
    setSuccess('')
    setShowMessage(false)

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
      setTimeout(() => {
        router.push(getUriWithOrg(activeOrg.slug, '/'))
      }, 2000)
    } else {
      const detail = res.data?.detail
      let errorMsg = t('common.something_went_wrong')
      if (typeof detail === 'string') {
        errorMsg = detail
      } else if (Array.isArray(detail) && detail.length > 0) {
        errorMsg = detail[0]?.msg || t('common.something_went_wrong')
      }
      setError(errorMsg)
      setShowMessage(true)
    }
    setIsSubmitting(false)
  }

  return (
    <>
      {/* Message Top Bar */}
      {showMessage && (error || success) && (
        <div className={`
          w-full px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
          ${error ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}
        `}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {error ? <AlertTriangle size={18} className="shrink-0" /> : <CheckCircle size={18} className="shrink-0" />}
            <span className="text-sm font-medium">{error || success}</span>
          </div>
          <button
            onClick={() => setShowMessage(false)}
            className="p-1 hover:bg-white/20 rounded transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
        <div className="w-full max-w-[420px] py-10">
          {/* Header */}
          <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">{t('auth.join_organization')}</h1>
          <p className="mt-2 text-black/45 text-[15px] font-medium">{t('auth.join_organization_desc')}</p>

          {/* Join Card */}
          <div className="mt-8 flex flex-col items-center gap-6">
            {/* User Info */}
            <div className="flex items-center gap-3">
              <UserAvatar rounded="rounded-xl" border="border-2" width={48} />
              <div>
                <p className="font-semibold text-black">{session.data?.user?.first_name} {session.data?.user?.last_name}</p>
                <p className="text-sm text-black/45">@{session.data?.user?.username}</p>
              </div>
            </div>

            {/* Organization Info */}
            <div className="w-full text-center py-4 bg-neutral-50 rounded-lg border border-neutral-200">
              <p className="text-sm text-black/45 mb-1">{t('auth.joining')}</p>
              <p className="font-semibold text-black text-lg">{activeOrg?.name}</p>
            </div>

            {/* Join Button or Verification Warning */}
            {session.data?.user?.email_verified === false ? (
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <Mail size={24} className="mx-auto mb-2 text-amber-600" />
                <p className="font-semibold text-amber-800 mb-1">{t('auth.email_verification_required')}</p>
                <p className="text-sm text-amber-700">{t('auth.email_verification_required_join')}</p>
              </div>
            ) : (
              <button
                onClick={join}
                disabled={isSubmitting}
                className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none transition-all disabled:opacity-50 gap-2"
              >
                {isSubmitting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <UserPlus size={18} />
                    {t('auth.join_organization')}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
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
    setIsSubmitting(true)
    setError('')
    setSuccess('')
    setShowMessage(false)

    const res = await validateInviteCode(activeOrg?.id, inviteCode, session?.data?.tokens?.access_token)

    if (res.success) {
      setSuccess(t('auth.invite_code_valid'))
      setShowMessage(true)
      setTimeout(() => {
        router.push(`/signup?inviteCode=${inviteCode}`)
      }, 1500)
    } else {
      setError(t('auth.invite_code_invalid'))
      setShowMessage(true)
    }
    setIsSubmitting(false)
  }

  return (
    <>
      {/* Message Top Bar */}
      {showMessage && (error || success) && (
        <div className={`
          w-full px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
          ${error ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}
        `}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {error ? <AlertTriangle size={18} className="shrink-0" /> : <CheckCircle size={18} className="shrink-0" />}
            <span className="text-sm font-medium">{error || success}</span>
          </div>
          <button
            onClick={() => setShowMessage(false)}
            className="p-1 hover:bg-white/20 rounded transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
        <div className="w-full max-w-[420px] py-10">
          {/* Header */}
          <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight">{t('auth.invite_required')}</h1>
          <p className="mt-2 text-black/45 text-[15px] font-medium">{t('auth.invite_required_desc', { org: activeOrg?.name })}</p>

          {/* Invite Code Form */}
          <div className="mt-8">
            <FormLayout onSubmit={validateCode}>
              <FormField name="invite_code">
                <div className="flex items-center space-x-2 mb-1.5">
                  <Form.Label className="grow text-[13px] font-semibold text-black/70">{t('auth.invite_code')}</Form.Label>
                </div>
                <Form.Control asChild>
                  <input
                    onChange={(e) => setInviteCode(e.target.value)}
                    value={inviteCode}
                    type="text"
                    placeholder={t('auth.enter_invite_code')}
                    required
                    className="box-border w-full bg-neutral-50 text-black rounded-lg px-4 border border-neutral-200 inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-neutral-400 transition-all placeholder:text-black/25 text-sm"
                  />
                </Form.Control>
              </FormField>

              <Form.Submit asChild>
                <button
                  disabled={isSubmitting || !inviteCode}
                  className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none mt-2 transition-all disabled:opacity-50 gap-2"
                >
                  {isSubmitting ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      <Ticket size={18} />
                      {t('auth.validate_invite')}
                    </>
                  )}
                </button>
              </Form.Submit>
            </FormLayout>
          </div>
        </div>
      </div>
    </>
  )
}

export default SignUpClient
