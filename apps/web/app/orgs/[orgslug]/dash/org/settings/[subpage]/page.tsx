'use client'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import { getUriWithOrg } from '@services/config/config'
import { ImageIcon, TextIcon, LucideIcon, Share2Icon, LayoutDashboardIcon, CodeIcon } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect, use } from 'react';
import { motion } from 'framer-motion'
import OrgEditGeneral from '@components/Dashboard/Pages/Org/OrgEditGeneral/OrgEditGeneral'
import OrgEditImages from '@components/Dashboard/Pages/Org/OrgEditImages/OrgEditImages'
import OrgEditSocials from '@components/Dashboard/Pages/Org/OrgEditSocials/OrgEditSocials'
import OrgEditLanding from '@components/Dashboard/Pages/Org/OrgEditLanding/OrgEditLanding'
import OrgEditOther from '@components/Dashboard/Pages/Org/OrgEditOther/OrgEditOther'
import { useTranslation } from 'react-i18next'

export type OrgParams = {
  subpage: string
  orgslug: string
}

interface TabItem {
  id: string
  label: string
  icon: LucideIcon
}

const getSettingTabs = (t: any): TabItem[] => [
  { id: 'general', label: t('dashboard.organization.settings.tabs.general'), icon: TextIcon },
  { id: 'landing', label: t('dashboard.organization.settings.tabs.landing'), icon: LayoutDashboardIcon },
  { id: 'previews', label: t('dashboard.organization.settings.tabs.previews'), icon: ImageIcon },
  { id: 'socials', label: t('dashboard.organization.settings.tabs.socials'), icon: Share2Icon },
  { id: 'other', label: t('dashboard.organization.settings.tabs.other'), icon: CodeIcon },
]

function TabLink({ tab, isActive, orgslug }: { 
  tab: TabItem, 
  isActive: boolean, 
  orgslug: string 
}) {
  return (
    <Link href={getUriWithOrg(orgslug, '') + `/dash/org/settings/${tab.id}`}>
      <div
        className={`py-2 w-fit text-center border-black transition-all ease-linear ${
          isActive ? 'border-b-4' : 'opacity-50'
        } cursor-pointer`}
      >
        <div className="flex items-center space-x-2.5 mx-2.5">
          <tab.icon size={16} />
          <div>{tab.label}</div>
        </div>
      </div>
    </Link>
  )
}

function OrgPage(props: { params: Promise<OrgParams> }) {
  const { t } = useTranslation()
  const params = use(props.params);
  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')
  const SETTING_TABS = getSettingTabs(t)

  function handleLabels() {
    if (params.subpage == 'general') {
      setH1Label(t('dashboard.organization.settings.pages.general.title'))
      setH2Label(t('dashboard.organization.settings.pages.general.subtitle'))
    } else if (params.subpage == 'previews') {
      setH1Label(t('dashboard.organization.settings.pages.previews.title'))
      setH2Label(t('dashboard.organization.settings.pages.previews.subtitle'))
    } else if (params.subpage == 'socials') {
      setH1Label(t('dashboard.organization.settings.pages.socials.title'))
      setH2Label(t('dashboard.organization.settings.pages.socials.subtitle'))
    } else if (params.subpage == 'landing') {
      setH1Label(t('dashboard.organization.settings.pages.landing.title'))
      setH2Label(t('dashboard.organization.settings.pages.landing.subtitle'))
    } else if (params.subpage == 'other') {
      setH1Label(t('dashboard.organization.settings.pages.other.title'))
      setH2Label(t('dashboard.organization.settings.pages.other.subtitle'))
    }
  }

  useEffect(() => {
    handleLabels()
  }, [params.subpage, params, t])

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-10 pr-10 tracking-tight bg-[#fcfbfc] nice-shadow flex-shrink-0">
        <BreadCrumbs type="org"></BreadCrumbs>
        <div className="my-2  py-2">
          <div className="w-100 flex flex-col space-y-1">
            <div className="pt-3 flex font-bold text-4xl tracking-tighter">
              {H1Label}
            </div>
            <div className="flex font-medium text-gray-400 text-md">
              {H2Label}{' '}
            </div>
          </div>
        </div>
        <div className="flex space-x-0.5 font-black text-sm">
          {SETTING_TABS.map((tab) => (
            <TabLink
              key={tab.id}
              tab={tab}
              isActive={params.subpage === tab.id}
              orgslug={params.orgslug}
            />
          ))}
        </div>
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
        {params.subpage == 'previews' ? <OrgEditImages /> : ''}
        {params.subpage == 'socials' ? <OrgEditSocials /> : ''}
        {params.subpage == 'landing' ? <OrgEditLanding /> : ''}
        {params.subpage == 'other' ? <OrgEditOther /> : ''}
      </motion.div>
    </div>
  )
}

export default OrgPage
