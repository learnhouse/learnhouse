'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import {
  getAPIUrl,
  getUriWithOrg,
  getUriWithoutOrg,
} from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { ArrowRightCircle, Info } from 'lucide-react'
import { signOut } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { useEffect } from 'react'
import useSWR from 'swr'

function HomeClient() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { data: orgs } = useSWR(
    `${getAPIUrl()}orgs/user/page/1/limit/10`,
    (url) => swrFetcher(url, access_token)
  )

  useEffect(() => {}, [session, orgs])
  return (
    <div className="flex flex-col">
      <div className="mx-auto flex items-center space-x-4 rounded-b-2xl bg-black pt-16 text-3xl font-semibold">
        <Image
          quality={100}
          width={60}
          height={60}
          src={learnhouseIcon}
          alt=""
        />
      </div>

      <div className="mx-auto flex items-center space-x-4 pt-16 text-2xl font-semibold">
        <span>Hello,</span> <UserAvatar />{' '}
        <span className="capitalize">
          {session?.data?.user.first_name} {session?.data?.user.last_name}
        </span>
      </div>
      <div className="mx-auto mt-12 flex items-center space-x-4 rounded-md bg-slate-200 px-3 py-2 text-sm font-semibold text-gray-600 uppercase">
        Your Organizations
      </div>
      {orgs && orgs.length == 0 && (
        <div className="mx-auto my-5 flex space-x-3 rounded-lg bg-rose-200 px-3 py-2">
          <Info />
          <span>
            It seems you're not part of an organization yet, join one to be able
            to see it here{' '}
          </span>
        </div>
      )}
      <div className="mx-auto flex rounded-lg pt-10">
        {orgs &&
          orgs.map((org: any) => (
            <Link
              href={getUriWithOrg(org.slug, '/')}
              key={org.id}
              className="mx-auto flex w-fit items-center justify-between space-x-2 rounded-lg px-3 py-2 outline outline-1 outline-slate-200"
            >
              <div>{org.name}</div>
              <ArrowRightCircle />
            </Link>
          ))}
      </div>
      <div className="mx-auto flex cursor-pointer items-center space-x-4 pt-16 text-2xl font-semibold">
        <span
          onClick={() =>
            signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
          }
        >
          Sign out
        </span>
      </div>
    </div>
  )
}

export default HomeClient
