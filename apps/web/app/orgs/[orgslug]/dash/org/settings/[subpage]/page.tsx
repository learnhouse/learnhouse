'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config'
import { TextIcon, LucideIcon, LayoutDashboardIcon, CodeIcon, Palette, School, BarChart3, Menu as MenuIcon, AlertTriangle, Trophy, ToggleRight, ChartLine } from 'lucide-react'
import React, { useEffect, use } from 'react';
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { PlanLevel } from '@services/plans/plans'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import dynamic from 'next/dynamic'

// One chunk per tab: only the open tab's code is loaded.
const OrgEditGeneral = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditGeneral/OrgEditGeneral'))
const OrgEditBranding = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditBranding/OrgEditBranding'))
const OrgEditLanding = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditLanding/OrgEditLanding'))
const OrgEditOther = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditOther/OrgEditOther'))
const OrgEditFeatures = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditFeatures/OrgEditFeatures'))
const OrgEditAI = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI'))
const OrgEditAnalytics = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditAnalytics/OrgEditAnalytics'))
const OrgEditUsage = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditUsage/OrgEditUsage'))
const OrgEditMenu = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditMenu/OrgEditMenu'))
const OrgEditCourseEnd = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditCourseEnd/OrgEditCourseEnd'))
const OrgEditDangerZone = dynamic(() => import('@components/Dashboard/Pages/Org/OrgEditDangerZone/OrgEditDangerZone'))

// Security now lives with the people it governs, under Users, split across a
// two-factor tab and a sign-in-methods tab. The old single URL keeps working.
const MOVED_TO_USERS: Record<string, string> = {
  security: 'two-factor',
}

// Sections that moved to the top-level Developers dashboard. Old settings links
// (/dash/org/settings/{seo,api,domains,automations,sso}) redirect there.
const MOVED_TO_DEVELOPERS: Record<string, string> = {
  developers: 'api',
  api: 'api',
  automations: 'automations',
  domains: 'domains',
  seo: 'seo',
  sso: 'sso',
}

export type OrgParams = {
  subpage: string
  orgslug: string
}

interface TabConfig {
  id: string
  label: string
  icon?: LucideIcon
  customIcon?: string
  requiredPlan?: PlanLevel
}

const getSettingTabs = (t: any): TabConfig[] => [
  { id: 'general', label: t('dashboard.organization.settings.tabs.general'), icon: TextIcon },
  { id: 'features', label: t('dashboard.organization.settings.tabs.features'), icon: ToggleRight },
  { id: 'branding', label: t('dashboard.organization.settings.tabs.branding'), icon: Palette },
  { id: 'menu', label: t('dashboard.organization.settings.tabs.menu') || 'Menu', icon: MenuIcon },
  { id: 'landing', label: t('dashboard.organization.settings.tabs.landing'), icon: LayoutDashboardIcon },
  { id: 'course-end', label: t('dashboard.organization.settings.tabs.course_end'), icon: Trophy },
  { id: 'ai', label: t('dashboard.organization.settings.tabs.ai') || 'AI', customIcon: '/learnhouse_ai_simple_colored.png', requiredPlan: 'standard' },
  { id: 'analytics', label: t('dashboard.organization.settings.tabs.analytics'), icon: ChartLine },
  { id: 'usage', label: t('dashboard.organization.settings.tabs.usage') || 'Usage', icon: BarChart3 },
  { id: 'other', label: t('dashboard.organization.settings.tabs.other'), icon: CodeIcon },
  { id: 'danger', label: t('dashboard.organization.settings.tabs.danger') || 'Danger Zone', icon: AlertTriangle },
]

function OrgPage(props: { params: Promise<OrgParams> }) {
  const { t } = useTranslation()
  const router = useRouter()
  const params = use(props.params);
  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')
  const SETTING_TABS = getSettingTabs(t)

  // Redirect legacy developer subpages to the new top-level Developers dashboard.
  const movedTo = MOVED_TO_DEVELOPERS[params.subpage]
  const movedToUsers = MOVED_TO_USERS[params.subpage]
  useEffect(() => {
    if (movedTo) router.replace(`/dash/developers/${movedTo}`)
    else if (movedToUsers) router.replace(`/dash/users/settings/${movedToUsers}`)
  }, [movedTo, movedToUsers, router])

  function handleLabels() {
    if (params.subpage == 'general') {
      setH1Label(t('dashboard.organization.settings.pages.general.title'))
      setH2Label(t('dashboard.organization.settings.pages.general.subtitle'))
    } else if (params.subpage == 'features') {
      setH1Label(t('dashboard.organization.settings.pages.features.title'))
      setH2Label(t('dashboard.organization.settings.pages.features.subtitle'))
    } else if (params.subpage == 'branding') {
      setH1Label(t('dashboard.organization.settings.pages.branding.title'))
      setH2Label(t('dashboard.organization.settings.pages.branding.subtitle'))
    } else if (params.subpage == 'menu') {
      setH1Label(t('dashboard.organization.settings.pages.menu.title') || 'Public menu')
      setH2Label(t('dashboard.organization.settings.pages.menu.subtitle') || 'Choose and order the links shown in your public navigation')
    } else if (params.subpage == 'landing') {
      setH1Label(t('dashboard.organization.settings.pages.landing.title'))
      setH2Label(t('dashboard.organization.settings.pages.landing.subtitle'))
    } else if (params.subpage == 'course-end') {
      setH1Label(t('dashboard.organization.settings.pages.course_end.title'))
      setH2Label(t('dashboard.organization.settings.pages.course_end.subtitle'))
    } else if (params.subpage == 'ai') {
      setH1Label(t('dashboard.organization.settings.pages.ai.title') || 'AI Features')
      setH2Label(t('dashboard.organization.settings.pages.ai.subtitle') || 'Configure AI capabilities for your organization')
    } else if (params.subpage == 'analytics') {
      setH1Label(t('dashboard.organization.settings.pages.analytics.title'))
      setH2Label(t('dashboard.organization.settings.pages.analytics.subtitle'))
    } else if (params.subpage == 'usage') {
      setH1Label(t('dashboard.organization.settings.pages.usage.title') || 'Usage')
      setH2Label(t('dashboard.organization.settings.pages.usage.subtitle') || 'Monitor your organization\'s resource usage and plan limits')
    } else if (params.subpage == 'other') {
      setH1Label(t('dashboard.organization.settings.pages.other.title'))
      setH2Label(t('dashboard.organization.settings.pages.other.subtitle'))
    } else if (params.subpage == 'danger') {
      setH1Label(t('dashboard.organization.settings.pages.danger.title') || 'Danger Zone')
      setH2Label(t('dashboard.organization.settings.pages.danger.subtitle') || 'Irreversible and destructive actions for this organization')
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleLabels()
  }, [params.subpage, params, t])

  const tabs: DashTabItem[] = SETTING_TABS.map((tab) => ({
    key: tab.id,
    label: tab.label,
    icon: tab.customIcon
      ? <Image src={tab.customIcon} alt={tab.label} width={16} height={16} />
      : tab.icon
        ? <tab.icon size={16} />
        : null,
    href: getUriWithOrg(params.orgslug, '') + `/dash/org/settings/${tab.id}`,
    active: params.subpage === tab.id,
    requiresPlan: tab.requiredPlan,
  }))

  // Moved subpages redirect (above); render nothing while it happens.
  if (movedTo || movedToUsers) return null

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="ps-4 pe-4 sm:ps-10 sm:pe-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-4 pb-1 sm:pt-6 sm:pb-4">
          <Breadcrumbs items={[
            { label: t('common.organization'), href: '/dash/org/settings/general', icon: <School size={14} /> }
          ]} />
        </div>
        <div className="py-2 sm:my-2">
          <div className="w-full flex flex-col space-y-1 min-w-0">
            <div className="sm:pt-3 flex font-bold text-2xl sm:text-4xl tracking-tighter truncate">
              {H1Label}
            </div>
            <div className="hidden sm:flex font-medium text-gray-400 text-md truncate">
              {H2Label}
            </div>
          </div>
        </div>
        <DashTabBar tabs={tabs} />
      </div>
      <div className="h-6 flex-shrink-0"></div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="flex-1 overflow-y-auto"
      >
        {params.subpage == 'general' ? <OrgEditGeneral /> : ''}
        {params.subpage == 'features' ? <OrgEditFeatures /> : ''}
        {params.subpage == 'branding' ? <OrgEditBranding /> : ''}
        {params.subpage == 'menu' ? <OrgEditMenu /> : ''}
        {params.subpage == 'landing' ? <OrgEditLanding /> : ''}
        {params.subpage == 'course-end' ? <OrgEditCourseEnd /> : ''}
        {params.subpage == 'ai' ? <OrgEditAI /> : ''}
        {params.subpage == 'analytics' ? <OrgEditAnalytics /> : ''}
        {params.subpage == 'usage' ? <OrgEditUsage /> : ''}
        {params.subpage == 'other' ? <OrgEditOther /> : ''}
        {params.subpage == 'danger' ? <OrgEditDangerZone /> : ''}
      </motion.div>
    </div>
  )
}

export default OrgPage
