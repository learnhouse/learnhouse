'use client'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import { getUriWithOrg } from '@services/config/config'
import { ImageIcon, Info, LockIcon, SearchIcon, TextIcon, LucideIcon, Share2Icon, LayoutDashboardIcon } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect, use } from 'react';
import { motion } from 'framer-motion'
import OrgEditGeneral from '@components/Dashboard/Pages/Org/OrgEditGeneral/OrgEditGeneral'
import OrgEditImages from '@components/Dashboard/Pages/Org/OrgEditImages/OrgEditImages'
import OrgEditSocials from '@components/Dashboard/Pages/Org/OrgEditSocials/OrgEditSocials'
import OrgEditLanding from '@components/Dashboard/Pages/Org/OrgEditLanding/OrgEditLanding'

export type OrgParams = {
  subpage: string
  orgslug: string
}

interface TabItem {
  id: string
  label: string
  icon: LucideIcon
}

const SETTING_TABS: TabItem[] = [
  { id: 'general', label: 'General', icon: TextIcon },
  { id: 'landing', label: 'Landing Page', icon: LayoutDashboardIcon },
  { id: 'previews', label: 'Images & Previews', icon: ImageIcon },
  { id: 'socials', label: 'Socials', icon: Share2Icon },
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
  const params = use(props.params);
  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')

  function handleLabels() {
    if (params.subpage == 'general') {
      setH1Label('General')
      setH2Label('Manage your organization settings')
    } else if (params.subpage == 'previews') {
      setH1Label('Previews')
      setH2Label('Manage your organization previews')
    } else if (params.subpage == 'socials') {
      setH1Label('Socials')
      setH2Label('Manage your organization social media links')
    } else if (params.subpage == 'landing') {
      setH1Label('Landing Page')
      setH2Label('Customize your organization landing page')
    }
  }

  useEffect(() => {
    handleLabels()
  }, [params.subpage, params])

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="pl-10 pr-10  tracking-tight bg-[#fcfbfc] nice-shadow">
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
      <div className="h-6"></div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
      >
        {params.subpage == 'general' ? <OrgEditGeneral /> : ''}
        {params.subpage == 'previews' ? <OrgEditImages /> : ''}
        {params.subpage == 'socials' ? <OrgEditSocials /> : ''}
        {params.subpage == 'landing' ? <OrgEditLanding /> : ''}
      </motion.div>
    </div>
  )
}

export default OrgPage
