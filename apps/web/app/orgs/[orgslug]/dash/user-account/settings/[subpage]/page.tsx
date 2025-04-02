'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import UserEditGeneral from '@components/Dashboard/Pages/UserAccount/UserEditGeneral/UserEditGeneral'
import UserEditPassword from '@components/Dashboard/Pages/UserAccount/UserEditPassword/UserEditPassword'
import { getUriWithOrg } from '@services/config/config'
import { motion } from 'framer-motion'
import { Info, Lock } from 'lucide-react'
import Link from 'next/link'
import { useEffect, use } from 'react'

export type SettingsParams = {
  subpage: string
  orgslug: string
}

function SettingsPage(props: { params: Promise<SettingsParams> }) {
  const params = use(props.params)
  const session = useLHSession() as any

  useEffect(() => {}, [session])

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="z-10 bg-[#fcfbfc] pr-10 pl-10 tracking-tight shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
        <BreadCrumbs
          type="user"
          last_breadcrumb={session?.user?.username}
        ></BreadCrumbs>
        <div className="my-2 tracking-tighter">
          <div className="flex w-100 justify-between">
            <div className="flex pt-3 text-4xl font-bold">Account Settings</div>
          </div>
        </div>
        <div className="flex space-x-5 text-sm font-black">
          <Link
            href={
              getUriWithOrg(params.orgslug, '') +
              `/dash/user-account/settings/general`
            }
          >
            <div
              className={`w-fit border-black py-2 text-center transition-all ease-linear ${
                params.subpage.toString() === 'general'
                  ? 'border-b-4'
                  : 'opacity-50'
              } cursor-pointer`}
            >
              <div className="mx-2 flex items-center space-x-2.5">
                <Info size={16} />
                <div>General</div>
              </div>
            </div>
          </Link>
          <Link
            href={
              getUriWithOrg(params.orgslug, '') +
              `/dash/user-account/settings/security`
            }
          >
            <div
              className={`flex w-fit space-x-4 border-black py-2 text-center transition-all ease-linear ${
                params.subpage.toString() === 'security'
                  ? 'border-b-4'
                  : 'opacity-50'
              } cursor-pointer`}
            >
              <div className="mx-2 flex items-center space-x-2.5">
                <Lock size={16} />
                <div>Password</div>
              </div>
            </div>
          </Link>
        </div>
      </div>
      <div className="h-6"></div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="h-full overflow-y-auto"
      >
        {params.subpage == 'general' ? <UserEditGeneral /> : ''}
        {params.subpage == 'security' ? <UserEditPassword /> : ''}
      </motion.div>
    </div>
  )
}

export default SettingsPage
