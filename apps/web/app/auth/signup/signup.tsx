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
  FormLabelAndMessage,
  Input,
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
    if (props.org.config) {
      setJoinMethod(
        props.org?.config?.config?.features.members.signup_mode
      )
    }
    if (inviteCodeParam) {
      setInviteCode(inviteCodeParam)
    }
  }, [props.org, inviteCodeParam])

  return (
    <AuthLayout org={props.org} welcomeText={t('auth.invited_to_join')}>
      {joinMethod == 'open' &&
        (session.status == 'authenticated' ? (
          <LoggedInJoinScreen inviteCode={inviteCode} org={props.org} />
        ) : (
          <div className="flex-1 flex flex-row">
            <OpenSignUpComponent />
          </div>
        ))}
      {joinMethod == 'inviteOnly' &&
        (inviteCode ? (
          session.status == 'authenticated' ? (
            <LoggedInJoinScreen inviteCode={inviteCode} org={props.org} />
          ) : (
            <div className="flex-1 flex flex-row">
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

      <div className="flex-1 flex flex-row">
        <div className="m-auto w-full max-w-sm px-6">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900">{t('auth.join_organization')}</h1>
            <p className="text-gray-500 mt-1">{t('auth.join_organization_desc')}</p>
          </div>

          {/* Join Card */}
          <div className="bg-white rounded-xl p-6 nice-shadow">
            <div className="flex flex-col items-center gap-6">
              {/* User Info */}
              <div className="flex items-center gap-3">
                <UserAvatar rounded="rounded-xl" border="border-2" width={48} />
                <div>
                  <p className="font-medium text-gray-900">{session.data?.user?.first_name} {session.data?.user?.last_name}</p>
                  <p className="text-sm text-gray-500">@{session.data?.user?.username}</p>
                </div>
              </div>

              {/* Organization Info */}
              <div className="w-full text-center py-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500 mb-1">{t('auth.joining')}</p>
                <p className="font-semibold text-gray-900 text-lg">{activeOrg?.name}</p>
              </div>

              {/* Join Button or Verification Warning */}
              {session.data?.user?.email_verified === false ? (
                <div className="w-full bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
                  <Mail size={24} className="mx-auto mb-2 text-amber-600" />
                  <p className="font-semibold text-amber-800 mb-1">{t('auth.email_verification_required')}</p>
                  <p className="text-sm text-amber-700">{t('auth.email_verification_required_join')}</p>
                </div>
              ) : (
                <button
                  onClick={join}
                  disabled={isSubmitting}
                  className="w-full bg-black text-white font-semibold text-center py-2.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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

      <div className="flex-1 flex flex-row">
        <div className="m-auto w-full max-w-sm px-6">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900">{t('auth.invite_required')}</h1>
            <p className="text-gray-500 mt-1">{t('auth.invite_required_desc', { org: activeOrg?.name })}</p>
          </div>

          {/* Invite Code Card */}
          <div className="bg-white rounded-xl p-6 nice-shadow">
            <FormLayout onSubmit={validateCode}>
              <FormField name="invite_code">
                <FormLabelAndMessage
                  label={t('auth.invite_code')}
                  message={undefined}
                />
                <Form.Control asChild>
                  <Input
                    onChange={(e) => setInviteCode(e.target.value)}
                    value={inviteCode}
                    type="text"
                    placeholder={t('auth.enter_invite_code')}
                    required
                  />
                </Form.Control>
              </FormField>

              <div className="pt-2">
                <Form.Submit asChild>
                  <button
                    disabled={isSubmitting || !inviteCode}
                    className="w-full bg-black text-white font-semibold text-center py-2.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
              </div>
            </FormLayout>
          </div>
        </div>
      </div>
    </>
  )
}

export default SignUpClient
