'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config'
import { TextIcon, LucideIcon, Image as ImageIcon, Link2, Shield, MessagesSquare } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect, use } from 'react'
import { motion } from 'framer-motion'
import { useOrg } from '@components/Contexts/OrgContext'
import { CommunityProvider, useCommunity } from '@components/Contexts/CommunityContext'
import CommunityEditGeneral from '@components/Dashboard/Pages/Community/CommunityEditGeneral'
import CommunityEditThumbnail from '@components/Dashboard/Pages/Community/CommunityEditThumbnail'
import CommunityEditCourse from '@components/Dashboard/Pages/Community/CommunityEditCourse'
import CommunityEditModeration from '@components/Dashboard/Pages/Community/CommunityEditModeration'

export type CommunityParams = {
  subpage: string
  orgslug: string
  communityuuid: string
}

interface TabItem {
  id: string
  label: string
  icon: LucideIcon
}

const SETTING_TABS: TabItem[] = [
  { id: 'general', label: 'General', icon: TextIcon },
  { id: 'thumbnail', label: 'Thumbnail', icon: ImageIcon },
  { id: 'course', label: 'Linked Course', icon: Link2 },
  { id: 'moderation', label: 'Moderation', icon: Shield },
]

function TabLink({
  tab,
  isActive,
  orgslug,
  communityuuid,
}: {
  tab: TabItem
  isActive: boolean
  orgslug: string
  communityuuid: string
}) {
  return (
    <Link href={getUriWithOrg(orgslug, '') + `/dash/communities/${communityuuid}/${tab.id}`}>
      <div
        className={`py-2 w-fit text-center border-black transition-all ease-linear ${
          isActive ? 'border-b-4' : 'opacity-50'
        } cursor-pointer`}
      >
        <div className="flex items-center space-x-2.5 mx-2.5">
          <tab.icon size={16} />
          <div className="flex items-center">{tab.label}</div>
        </div>
      </div>
    </Link>
  )
}

function CommunitySettingsContent({ params }: { params: CommunityParams }) {
  const org = useOrg() as any
  const communityState = useCommunity()
  const community = communityState?.community

  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')

  function handleLabels() {
    if (params.subpage === 'general') {
      setH1Label('General Settings')
      setH2Label('Manage community name, description, and visibility')
    } else if (params.subpage === 'thumbnail') {
      setH1Label('Thumbnail')
      setH2Label('Update the community cover image')
    } else if (params.subpage === 'course') {
      setH1Label('Linked Course')
      setH2Label('Connect this community to a course')
    } else if (params.subpage === 'moderation') {
      setH1Label('Moderation')
      setH2Label('Configure content moderation settings')
    }
  }

  useEffect(() => {
    handleLabels()
  }, [params.subpage])

  if (!community) return null

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-10 pr-10 tracking-tight bg-[#fcfbfc] nice-shadow flex-shrink-0">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: 'Communities', href: '/dash/communities', icon: <MessagesSquare size={14} /> },
            { label: community.name }
          ]} />
        </div>
        <div className="my-2 py-2">
          <div className="w-100 flex flex-col space-y-1">
            <div className="pt-3 flex font-bold text-4xl tracking-tighter">{H1Label}</div>
            <div className="flex font-medium text-gray-400 text-md">{H2Label}</div>
          </div>
        </div>
        <div className="flex space-x-0.5 font-black text-sm">
          {SETTING_TABS.map((tab) => (
            <TabLink
              key={tab.id}
              tab={tab}
              isActive={params.subpage === tab.id}
              orgslug={params.orgslug}
              communityuuid={params.communityuuid}
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
        {params.subpage === 'general' && <CommunityEditGeneral />}
        {params.subpage === 'thumbnail' && <CommunityEditThumbnail />}
        {params.subpage === 'course' && <CommunityEditCourse />}
        {params.subpage === 'moderation' && <CommunityEditModeration />}
      </motion.div>
    </div>
  )
}

function CommunitySettingsPage(props: { params: Promise<CommunityParams> }) {
  const params = use(props.params)

  return (
    <CommunityProvider communityuuid={params.communityuuid}>
      <CommunitySettingsContent params={params} />
    </CommunityProvider>
  )
}

export default CommunitySettingsPage
