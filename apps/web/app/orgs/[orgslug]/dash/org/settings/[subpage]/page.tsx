'use client'
import React, { useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import dynamic from 'next/dynamic'
import { EditorSkeleton } from '@components/Dashboard/Pages/Course/courseEditorUi'
import { usePreloadOnIdle } from '@components/Dashboard/Shared/usePreloadOnIdle'
import { MOVED_TO_COURSES, MOVED_TO_DEVELOPERS, MOVED_TO_USERS, MOVED_TO_WEBSITE, RENAMED_IN_SETTINGS, renamedSettingsUrl } from '../settingsTabs'

// One chunk per tab: only the open tab's code is loaded. The skeleton keeps
// the body's shape while a tab's chunk arrives; the header lives in the
// layout and never unmounts.
const loading = () => <EditorSkeleton sections={2} rows={3} />
const OrgEditGeneral = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditGeneral/OrgEditGeneral'), { loading })
const OrgEditBranding = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditBranding/OrgEditBranding'), { loading })
const OrgEditOther = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditOther/OrgEditOther'), { loading })
const OrgEditAI = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI'), { loading })
const OrgEditAnalytics = dynamic(() => import('@ee/components/Analytics/Settings/OrgEditAnalytics'), { loading })
const OrgEditIntegrations = dynamic(() => import('@ee/components/Integrations/OrgEditIntegrations'), { loading })
const OrgOverview = dynamic(() => import('@components/Dashboard/Pages/Org/OrgOverview/OrgOverview'), { loading })
const OrgEditMenu = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditMenu/OrgEditMenu'), { loading })
const OrgEditDangerZone = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditDangerZone/OrgEditDangerZone'), { loading })

// The other tabs' code, fetched while the browser is idle (see usePreloadOnIdle).
const TAB_CHUNKS = [
  () => import('@components/Dashboard/Pages/Org/OrgEditGeneral/OrgEditGeneral'),
  () => import('@components/Dashboard/Pages/Org/OrgEditBranding/OrgEditBranding'),
  () => import('@components/Dashboard/Pages/Org/OrgEditOther/OrgEditOther'),
  () => import('@components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI'),
  () => import('@components/Dashboard/Pages/Org/OrgOverview/OrgOverview'),
  () => import('@components/Dashboard/Pages/Org/OrgEditMenu/OrgEditMenu'),
  () => import('@components/Dashboard/Pages/Org/OrgEditDangerZone/OrgEditDangerZone'),
]

export type OrgParams = {
  subpage: string
  orgslug: string
}

const PAGES: Record<string, React.ComponentType> = {
  overview: OrgOverview,
  general: OrgEditGeneral,
  branding: OrgEditBranding,
  menu: OrgEditMenu,
  ai: OrgEditAI,
  analytics: OrgEditAnalytics,
  integrations: OrgEditIntegrations,
  other: OrgEditOther,
  danger: OrgEditDangerZone,
}

function OrgPage(props: { params: Promise<OrgParams> }) {
  const router = useRouter()
  const params = use(props.params)
  usePreloadOnIdle(TAB_CHUNKS)

  // Redirect legacy developer subpages to the new top-level Developers dashboard.
  const movedTo = MOVED_TO_DEVELOPERS[params.subpage]
  const movedToUsers = MOVED_TO_USERS[params.subpage]
  const movedToCourses = MOVED_TO_COURSES[params.subpage] || MOVED_TO_WEBSITE[params.subpage]
  const renamedTo = RENAMED_IN_SETTINGS[params.subpage]
  useEffect(() => {
    if (movedTo) router.replace(`/dash/developers/${movedTo}`)
    else if (movedToUsers) router.replace(`/dash/users/settings/${movedToUsers}`)
    else if (movedToCourses) router.replace(movedToCourses)
    // Keep ?section= and friends: old links (Usage, Plan & usage, Features) land on the same view.
    else if (renamedTo) router.replace(renamedSettingsUrl(params.subpage, window.location.search, window.location.hash) as string)
  }, [movedTo, movedToUsers, movedToCourses, renamedTo, params.subpage, router])

  // Moved subpages redirect (above); render nothing while it happens.
  if (movedTo || movedToUsers || movedToCourses || renamedTo) return null

  const Page = PAGES[params.subpage]

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

export default OrgPage
