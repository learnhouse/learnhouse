'use client'
import React, { use } from 'react'
import { motion } from 'motion/react'
import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { EditorSkeleton } from '@components/Dashboard/Pages/Course/courseEditorUi'
import { usePreloadOnIdle } from '@components/Dashboard/Shared/usePreloadOnIdle'

// One chunk per tab: only the open tab's code is loaded. The skeleton keeps
// the body's shape while a tab's chunk arrives; the header lives in the
// layout and never unmounts.
const loading = () => <EditorSkeleton sections={1} rows={4} />
const OrgUsers = dynamic(() => import('@components/Dashboard/Pages/Users/OrgUsers/OrgUsers'), { loading })
const OrgAccess = dynamic(() => import('@components/Dashboard/Pages/Users/OrgAccess/OrgAccess'), { loading })
const OrgUsersAdd = dynamic(() => import('@components/Dashboard/Pages/Users/OrgUsersAdd/OrgUsersAdd'), { loading })
const OrgUserGroups = dynamic(() => import('@components/Dashboard/Pages/Users/OrgUserGroups/OrgUserGroups'), { loading })
const OrgRoles = dynamic(() => import('@components/Dashboard/Pages/Users/OrgRoles/OrgRoles'), { loading })
const OrgAuditLogs = dynamic(() => import('@components/Dashboard/Pages/Org/OrgAuditLogs/OrgAuditLogs'), { loading })
const OrgTwoFactorPolicy = dynamic(() => import('@components/Dashboard/Pages/Users/Security/OrgTwoFactorPolicy'), { loading })
const OrgSignInMethods = dynamic(() => import('@components/Dashboard/Pages/Users/Security/OrgSignInMethods'), { loading })
const ScimProvisioningPage = dynamic(() => import('@ee/components/HR/Provisioning/ScimProvisioningPage'), { loading })

// The other tabs' code, fetched while the browser is idle (see usePreloadOnIdle).
const TAB_CHUNKS = [
  () => import('@components/Dashboard/Pages/Users/OrgUsers/OrgUsers'),
  () => import('@components/Dashboard/Pages/Users/OrgAccess/OrgAccess'),
  () => import('@components/Dashboard/Pages/Users/OrgUsersAdd/OrgUsersAdd'),
  () => import('@components/Dashboard/Pages/Users/OrgUserGroups/OrgUserGroups'),
  () => import('@components/Dashboard/Pages/Users/OrgRoles/OrgRoles'),
  () => import('@components/Dashboard/Pages/Org/OrgAuditLogs/OrgAuditLogs'),
  () => import('@components/Dashboard/Pages/Users/Security/OrgTwoFactorPolicy'),
  () => import('@components/Dashboard/Pages/Users/Security/OrgSignInMethods'),
]

export type SettingsParams = {
  subpage: string
  orgslug: string
}

const PAGES: Record<string, React.ComponentType> = {
  users: OrgUsers,
  signups: OrgAccess,
  add: OrgUsersAdd,
  usergroups: OrgUserGroups,
  roles: OrgRoles,
  'audit-logs': OrgAuditLogs,
  'sign-in': OrgSignInMethods,
  'two-factor': OrgTwoFactorPolicy,
  provisioning: ScimProvisioningPage,
}

function UsersSettingsPage(props: { params: Promise<SettingsParams> }) {
  const params = use(props.params)
  const Page = PAGES[params.subpage]
  usePreloadOnIdle(TAB_CHUNKS)
  // People data lives on the Users tab now (columns, filters, import).
  if (params.subpage === 'people') redirect('/dash/users/settings/users')

  return (
    <motion.div
      key={params.subpage}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      className="px-4 sm:px-10 pt-6 sm:pt-8 pb-16"
    >
      {Page ? <Page /> : null}
    </motion.div>
  )
}

export default UsersSettingsPage
