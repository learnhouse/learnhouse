'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config'
import { Terminal, KeyIcon, Zap, Globe, Search, Shield, LucideIcon } from 'lucide-react'
import React, { useEffect, use } from 'react'
import { motion } from 'motion/react'
import OrgEditAPIAccess from '@components/Dashboard/Pages/Org/OrgEditAPIAccess/OrgEditAPIAccess'
import OrgEditAutomations from '@components/Dashboard/Pages/Org/OrgEditAutomations/OrgEditAutomations'
import OrgEditDomains from '@components/Dashboard/Pages/Org/OrgEditDomains/OrgEditDomains'
import OrgEditSEO from '@components/Dashboard/Pages/Org/OrgEditSEO/OrgEditSEO'
import OrgEditSSO from '@components/Dashboard/Pages/Org/OrgEditSSO/OrgEditSSO'
import { useTranslation } from 'react-i18next'
import { PlanLevel, isFeatureAvailable } from '@services/plans/plans'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'

export type DevParams = {
  subpage: string
  orgslug: string
}

interface TabConfig {
  id: string
  label: string
  icon: LucideIcon
  requiredPlan?: PlanLevel
}

const getDevTabs = (t: any): TabConfig[] => [
  { id: 'api', label: t('dashboard.organization.settings.tabs.api', { defaultValue: 'API Access' }), icon: KeyIcon, requiredPlan: 'pro' },
  { id: 'automations', label: t('dashboard.organization.settings.tabs.automations', { defaultValue: 'Automations' }), icon: Zap, requiredPlan: 'pro' },
  { id: 'domains', label: t('dashboard.organization.settings.tabs.domains', { defaultValue: 'Domains' }), icon: Globe, requiredPlan: 'pro' },
  { id: 'seo', label: 'SEO', icon: Search, requiredPlan: 'standard' },
  { id: 'sso', label: t('dashboard.organization.settings.tabs.sso', { defaultValue: 'SSO' }), icon: Shield, requiredPlan: 'enterprise' },
]

function DevelopersPage(props: { params: Promise<DevParams> }) {
  const { t } = useTranslation()
  const params = use(props.params)
  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')
  // Hide tabs whose feature is unavailable in the current deployment mode — in
  // OSS this drops the enterprise-only SSO tab (which would otherwise render a
  // dead "upgrade" card, since getUpgradeUrl() is null for OSS). EE/SaaS keep all
  // tabs (isFeatureAvailable returns true; per-plan gating is handled downstream).
  const DEV_TABS = getDevTabs(t).filter((tab) => isFeatureAvailable(tab.id))

  function handleLabels() {
    if (params.subpage == 'api') {
      setH1Label(t('dashboard.organization.settings.pages.api.title', { defaultValue: 'API Access' }))
      setH2Label(t('dashboard.organization.settings.pages.api.subtitle', { defaultValue: 'Manage API tokens and access' }))
    } else if (params.subpage == 'automations') {
      setH1Label(t('dashboard.organization.settings.tabs.automations', { defaultValue: 'Automations' }))
      setH2Label(t('dashboard.organization.automations.webhooks_subtitle', { defaultValue: 'Connect external services with webhooks' }))
    } else if (params.subpage == 'domains') {
      setH1Label(t('dashboard.organization.settings.pages.domains.title', { defaultValue: 'Custom Domains' }))
      setH2Label(t('dashboard.organization.settings.pages.domains.subtitle', { defaultValue: 'Configure custom domains for your organization' }))
    } else if (params.subpage == 'seo') {
      setH1Label('SEO')
      setH2Label(t('dashboard.organization.settings.pages.seo.subtitle', { defaultValue: 'Manage search engine optimization settings' }))
    } else if (params.subpage == 'sso') {
      setH1Label(t('dashboard.organization.settings.pages.sso.title', { defaultValue: 'Single Sign-On' }))
      setH2Label(t('dashboard.organization.settings.pages.sso.subtitle', { defaultValue: 'Configure SSO for your organization' }))
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleLabels()
  }, [params.subpage, params, t])

  const tabs: DashTabItem[] = DEV_TABS.map((tab) => ({
    key: tab.id,
    label: tab.label,
    icon: <tab.icon size={16} />,
    href: getUriWithOrg(params.orgslug, '') + `/dash/developers/${tab.id}`,
    active: params.subpage === tab.id,
    requiresPlan: tab.requiredPlan,
  }))

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' }), href: '/dash/developers/api', icon: <Terminal size={14} /> }
          ]} />
        </div>
        <div className="my-2 py-2">
          <div className="w-full flex flex-col space-y-1 min-w-0">
            <div className="pt-3 flex font-bold text-3xl sm:text-4xl tracking-tighter truncate">
              {H1Label}
            </div>
            <div className="flex font-medium text-gray-400 text-md truncate">
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
        {params.subpage == 'api' ? <OrgEditAPIAccess /> : ''}
        {params.subpage == 'automations' ? <OrgEditAutomations /> : ''}
        {params.subpage == 'domains' ? <OrgEditDomains /> : ''}
        {params.subpage == 'seo' ? <OrgEditSEO /> : ''}
        {params.subpage == 'sso' ? <OrgEditSSO /> : ''}
      </motion.div>
    </div>
  )
}

export default DevelopersPage
