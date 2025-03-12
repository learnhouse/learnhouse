'use client'
import React, { useEffect, use } from 'react';
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useMediaQuery } from 'usehooks-ts'
import { getUriWithOrg } from '@services/config/config'
import { Monitor, ScanEye, SquareUserRound, UserPlus, Users } from 'lucide-react'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import OrgUsers from '@components/Dashboard/Pages/Users/OrgUsers/OrgUsers'
import OrgAccess from '@components/Dashboard/Pages/Users/OrgAccess/OrgAccess'
import OrgUsersAdd from '@components/Dashboard/Pages/Users/OrgUsersAdd/OrgUsersAdd'
import OrgUserGroups from '@components/Dashboard/Pages/Users/OrgUserGroups/OrgUserGroups'

export type SettingsParams = {
  subpage: string
  orgslug: string
}

function UsersSettingsPage(props: { params: Promise<SettingsParams> }) {
  const params = use(props.params);
  const session = useLHSession() as any
  const org = useOrg() as any
  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')
  const isMobile = useMediaQuery('(max-width: 767px)')

  function handleLabels() {
    if (params.subpage == 'users') {
      setH1Label('Users')
      setH2Label('Manage your organization users, assign roles and permissions')
    }
    if (params.subpage == 'signups') {
      setH1Label('Signups & Invite Codes')
      setH2Label('Choose from where users can join your organization')
    }
    if (params.subpage == 'add') {
      setH1Label('Invite Members')
      setH2Label('Invite members to join your organization')
    }
    if (params.subpage == 'usergroups') {
      setH1Label('UserGroups')
      setH2Label('Create and manage user groups')
    }
  }

  useEffect(() => {
    handleLabels()
  }, [session, org, params.subpage, params])

  if (isMobile) {
    // TODO: Work on a better mobile experience
    return (
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-md text-center">
          <h2 className="text-xl font-bold mb-4">Desktop Only</h2>
          <Monitor className='mx-auto my-5' size={60} />
          <p>This page is only accessible from a desktop device.</p>
          <p>Please switch to a desktop to view and manage user settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr]">
      <div className="pl-10 pr-10  tracking-tight bg-[#fcfbfc] z-10 shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
        <BreadCrumbs type="orgusers"></BreadCrumbs>
        <div className="my-2  py-3">
          <div className="w-100 flex flex-col space-y-1">
            <div className="pt-3 flex font-bold text-4xl tracking-tighter">
              {H1Label}
            </div>
            <div className="flex font-medium text-gray-400 text-md">
              {H2Label}{' '}
            </div>
          </div>
        </div>
        <div className="flex space-x-5 font-black text-sm">
          <Link
            href={
              getUriWithOrg(params.orgslug, '') + `/dash/users/settings/users`
            }
          >
            <div
              className={`py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'users'
                  ? 'border-b-4'
                  : 'opacity-50'
                } cursor-pointer`}
            >
              <div className="flex items-center space-x-2.5 mx-2">
                <Users size={16} />
                <div>Users</div>
              </div>
            </div>
          </Link>
          <Link
            href={
              getUriWithOrg(params.orgslug, '') + `/dash/users/settings/usergroups`
            }
          >
            <div
              className={`py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'usergroups'
                  ? 'border-b-4'
                  : 'opacity-50'
                } cursor-pointer`}
            >
              <div className="flex items-center space-x-2.5 mx-2">
                <SquareUserRound size={16} />
                <div>UserGroups</div>
              </div>
            </div>
          </Link>
          <Link
            href={
              getUriWithOrg(params.orgslug, '') + `/dash/users/settings/signups`
            }
          >
            <div
              className={`py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'signups'
                  ? 'border-b-4'
                  : 'opacity-50'
                } cursor-pointer`}
            >
              <div className="flex items-center space-x-2.5 mx-2">
                <ScanEye size={16} />
                <div>Signups & Invite Codes</div>
              </div>
            </div>
          </Link>
          <Link
            href={
              getUriWithOrg(params.orgslug, '') + `/dash/users/settings/add`
            }
          >
            <div
              className={`py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'add'
                  ? 'border-b-4'
                  : 'opacity-50'
                } cursor-pointer`}
            >
              <div className="flex items-center space-x-2.5 mx-2">
                <UserPlus size={16} />
                <div>Invite Members</div>
              </div>
            </div>
          </Link>
          
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="h-full overflow-y-auto"
      >
        {params.subpage == 'users' ? <OrgUsers /> : ''}
        {params.subpage == 'signups' ? <OrgAccess /> : ''}
        {params.subpage == 'add' ? <OrgUsersAdd /> : ''}
        {params.subpage == 'usergroups' ? <OrgUserGroups /> : ''}
      </motion.div>
    </div>
  )
}

export default UsersSettingsPage
