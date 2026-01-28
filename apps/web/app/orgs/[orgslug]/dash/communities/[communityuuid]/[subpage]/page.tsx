'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config'
import { TextIcon, LucideIcon, Image as ImageIcon, Link2, Shield, MessagesSquare } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect, use } from 'react'
import { useTranslation } from 'react-i18next'
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
  labelKey: string
  icon: LucideIcon
}

const SETTING_TABS: TabItem[] = [
  { id: 'general', labelKey: 'dashboard.courses.communities.settings.tabs.general', icon: TextIcon },
  { id: 'thumbnail', labelKey: 'dashboard.courses.communities.settings.tabs.thumbnail', icon: ImageIcon },
  { id: 'course', labelKey: 'dashboard.courses.communities.settings.tabs.course', icon: Link2 },
  { id: 'moderation', labelKey: 'dashboard.courses.communities.settings.tabs.moderation', icon: Shield },
]

function TabLink({
  tab,
  isActive,
  orgslug,
  communityuuid,
  t,
}: {
  tab: TabItem
  isActive: boolean
  orgslug: string
  communityuuid: string
  t: (key: string) => string
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
          <div className="flex items-center">{t(tab.labelKey)}</div>
        </div>
      </div>
    </Link>
  )
}

function CommunitySettingsContent({ params }: { params: CommunityParams }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const communityState = useCommunity()
  const community = communityState?.community

  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')

  function handleLabels() {
    if (params.subpage === 'general') {
      setH1Label(t('dashboard.courses.communities.settings.general.title'))
      setH2Label(t('dashboard.courses.communities.settings.general.subtitle'))
    } else if (params.subpage === 'thumbnail') {
      setH1Label(t('dashboard.courses.communities.settings.thumbnail.title'))
      setH2Label(t('dashboard.courses.communities.settings.thumbnail.subtitle'))
    } else if (params.subpage === 'course') {
      setH1Label(t('dashboard.courses.communities.settings.course.title'))
      setH2Label(t('dashboard.courses.communities.settings.course.subtitle'))
    } else if (params.subpage === 'moderation') {
      setH1Label(t('dashboard.courses.communities.settings.moderation.title'))
      setH2Label(t('dashboard.courses.communities.settings.moderation.subtitle'))
    }
  }

  useEffect(() => {
    handleLabels()
  }, [params.subpage, t])

  if (!community) return null

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-10 pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: t('dashboard.courses.communities.title'), href: '/dash/communities', icon: <MessagesSquare size={14} /> },
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
              t={t}
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
