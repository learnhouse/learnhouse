'use client'
import React, { use } from 'react'
import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { EditorSkeleton } from '@components/Dashboard/Pages/Course/courseEditorUi'
import { usePreloadOnIdle } from '@components/Dashboard/Shared/usePreloadOnIdle'

// One chunk per tab: only the open tab's code is loaded. The skeleton keeps
// the body's shape while a tab's chunk arrives; the header lives in the
// layout and never unmounts.
const loading = () => <EditorSkeleton sections={1} rows={4} />
// The Users tab is a list, not a form: its placeholder has the tab's own shape
// (stat cards, search, rows), so the tab replaces it without a jump.
const listLoading = () => (
  <div className="flex flex-col gap-5 animate-pulse" aria-busy="true">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 bg-white nice-shadow rounded-2xl px-4 py-3.5">
          <div className="w-9 h-9 rounded-xl bg-neutral-100 shrink-0" />
          <div className="space-y-1.5 min-w-0">
            <div className="h-3 w-16 rounded bg-neutral-100" />
            <div className="h-5 w-8 rounded bg-neutral-200" />
          </div>
        </div>
      ))}
    </div>
    <div className="h-9 w-full sm:w-72 rounded-lg bg-white nice-shadow" />
    <div className="bg-white nice-shadow rounded-2xl divide-y divide-neutral-100">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
          <div className="w-9 h-9 rounded-full bg-neutral-100 shrink-0" />
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="h-3.5 w-40 max-w-full rounded bg-neutral-100" />
            <div className="h-3 w-56 max-w-full rounded bg-neutral-100/70" />
          </div>
        </div>
      ))}
    </div>
  </div>
)
const OrgUsers = dynamic(() => import('@components/Dashboard/Pages/Users/OrgUsers/OrgUsers'), { loading: listLoading })
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
    // No fade-in from transparent: on arrival it blanked the pane between the
    // route skeleton and the tab's own placeholder.
    <div key={params.subpage} className="px-4 sm:px-10 pt-6 sm:pt-8 pb-16">
      {Page ? <Page /> : null}
    </div>
  )
}

export default UsersSettingsPage
