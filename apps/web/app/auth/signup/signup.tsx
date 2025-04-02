'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { validateInviteCode } from '@services/organizations/invites'
import { joinOrg } from '@services/organizations/orgs'
import { MailWarning, Ticket, UserPlus } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { BarLoader } from 'react-spinners'
import InviteOnlySignUpComponent from './InviteOnlySignUp'
import OpenSignUpComponent from './OpenSignup'

interface SignUpClientProps {
  org: any
}

function SignUpClient(props: SignUpClientProps) {
  const session = useLHSession() as any
  const [joinMethod, setJoinMethod] = useState('open')
  const [inviteCode, setInviteCode] = useState('')
  const searchParams = useSearchParams()
  const inviteCodeParam = searchParams.get('inviteCode')

  useEffect(() => {
    if (props.org.config) {
      setJoinMethod(props.org?.config?.config?.features.members.signup_mode)
    }
    if (inviteCodeParam) {
      setInviteCode(inviteCodeParam)
    }
  }, [props.org, inviteCodeParam])

  return (
    <div className="grid h-screen grid-flow-col justify-stretch">
      <div
        className="right-login-part"
        style={{
          background:
            'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
        }}
      >
        <div className="login-topbar m-10">
          <Link prefetch href={getUriWithOrg(props.org.slug, '/')}>
            <Image
              quality={100}
              width={30}
              height={30}
              src={learnhouseIcon}
              alt=""
            />
          </Link>
        </div>
        <div className="ml-10 flex h-3/4 flex-row text-white">
          <div className="m-auto flex flex-wrap items-center space-x-4">
            <div>You've been invited to join </div>
            <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]">
              {props.org?.logo_image ? (
                <img
                  src={`${getOrgLogoMediaDirectory(
                    props.org.org_uuid,
                    props.org?.logo_image
                  )}`}
                  alt="LearnHouse"
                  style={{ width: 'auto', height: 70 }}
                  className="inset-0 rounded-xl bg-white shadow-xl ring-1 ring-black/10 ring-inset"
                />
              ) : (
                <Image
                  quality={100}
                  width={70}
                  height={70}
                  src={learnhouseIcon}
                  alt=""
                />
              )}
            </div>
            <div className="text-xl font-bold">{props.org?.name}</div>
          </div>
        </div>
      </div>
      <div className="left-join-part flex flex-row bg-white">
        {joinMethod == 'open' &&
          (session.status == 'authenticated' ? (
            <LoggedInJoinScreen inviteCode={inviteCode} />
          ) : (
            <OpenSignUpComponent />
          ))}
        {joinMethod == 'inviteOnly' &&
          (inviteCode ? (
            session.status == 'authenticated' ? (
              <LoggedInJoinScreen inviteCode={inviteCode} />
            ) : (
              <InviteOnlySignUpComponent inviteCode={inviteCode} />
            )
          ) : (
            <NoTokenScreen />
          ))}
      </div>
    </div>
  )
}

const LoggedInJoinScreen = (props: any) => {
  const session = useLHSession() as any
  const org = useOrg() as any
  const invite_code = props.inviteCode
  const [isLoading, setIsLoading] = useState(true)
  const [isSumbitting, setIsSubmitting] = useState(false)
  const router = useRouter()

  const join = async () => {
    setIsSubmitting(true)
    const res = await joinOrg(
      {
        org_id: org.id,
        user_id: session?.data?.user?.id,
        invite_code: props.inviteCode,
      },
      null,
      session.data?.tokens?.access_token
    )
    //wait for 1s
    if (res.success) {
      toast.success(res.data)
      setTimeout(() => {
        router.push(getUriWithOrg(org.slug, '/'))
      }, 2000)
      setIsSubmitting(false)
    } else {
      toast.error(res.data.detail)
      setIsLoading(false)
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (session && org) {
      setIsLoading(false)
    }
  }, [org, session])

  return (
    <div className="mx-auto flex flex-row items-center">
      <Toast />
      <div className="flex flex-col items-center justify-center space-y-7">
        <p className="flex items-center justify-center space-x-2 pt-3 text-2xl font-semibold text-black/70">
          <span className="items-center">Hi</span>
          <span className="flex items-center space-x-2 capitalize">
            <UserAvatar rounded="rounded-xl" border="border-4" width={35} />
            <span>{session.data.username},</span>
          </span>
          <span>join {org?.name} ?</span>
        </p>
        <button
          onClick={() => join()}
          className="text-md flex h-[35px] h-fit w-fit items-center space-x-2 rounded-lg bg-black px-6 py-2 font-semibold text-white shadow-md"
        >
          {isSumbitting ? (
            <BarLoader
              cssOverride={{ borderRadius: 60 }}
              width={60}
              color="#ffffff"
            />
          ) : (
            <>
              <UserPlus size={18} />
              <p>Join </p>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

const NoTokenScreen = (props: any) => {
  const session = useLHSession() as any
  const org = useOrg() as any
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [inviteCode, setInviteCode] = useState('')
  const [messsage, setMessage] = useState('bruh')

  const handleInviteCodeChange = (e: any) => {
    setInviteCode(e.target.value)
  }

  const validateCode = async () => {
    setIsLoading(true)
    const res = await validateInviteCode(
      org?.id,
      inviteCode,
      session?.user?.tokens.access_token
    )
    //wait for 1s
    if (res.success) {
      toast.success(
        "Invite code is valid, you'll be redirected to the signup page in a few seconds"
      )
      setTimeout(() => {
        router.push(
          getUriWithoutOrg(
            `/signup?inviteCode=${inviteCode}&orgslug=${org.slug}`
          )
        )
      }, 2000)
    } else {
      toast.error('Invite code is invalid')
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (session && org) {
      setIsLoading(false)
    }
  }, [org, session])

  return (
    <div className="mx-auto flex flex-row items-center">
      <Toast />
      {isLoading ? (
        <div className="flex w-[300px] flex-col items-center justify-center space-y-7">
          <PageLoading />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center space-y-7">
          <p className="flex items-center space-x-2 text-lg font-medium text-red-800">
            <MailWarning size={18} />
            <span>An invite code is required to join {org?.name}</span>
          </p>
          <input
            onChange={handleInviteCodeChange}
            className="h-[50px] w-[300px] rounded-lg bg-white px-5 outline outline-2 outline-gray-200"
            placeholder="Please enter an invite code"
            type="text"
          />
          <button
            onClick={validateCode}
            className="text-md flex h-fit w-fit items-center space-x-2 rounded-lg bg-black px-6 py-2 font-semibold text-white shadow-md"
          >
            <Ticket size={18} />
            <p>Submit </p>
          </button>
        </div>
      )}
    </div>
  )
}

export default SignUpClient
