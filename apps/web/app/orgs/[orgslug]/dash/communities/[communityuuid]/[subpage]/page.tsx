'use client'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config'
import { Image as ImageIcon, Link2, Shield, MessagesSquare, Users } from 'lucide-react'
import React, { useEffect, use } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { CommunityProvider, useCommunity } from '@components/Contexts/CommunityContext'
import CommunityEditGeneral from '@components/Dashboard/Pages/Community/CommunityEditGeneral'
import CommunityEditThumbnail from '@components/Dashboard/Pages/Community/CommunityEditThumbnail'
import CommunityEditCourse from '@components/Dashboard/Pages/Community/CommunityEditCourse'
import CommunityEditModeration from '@components/Dashboard/Pages/Community/CommunityEditModeration'
import CommunityEditAccess from '@components/Dashboard/Pages/Community/CommunityEditAccess'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'

export type CommunityParams = {
  subpage: string
  orgslug: string
  communityuuid: string
}

function CommunitySettingsContent({ params }: { params: CommunityParams }) {
  const { t } = useTranslation()
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
    } else if (params.subpage === 'access') {
      setH1Label(t('dashboard.courses.communities.settings.access.title'))
      setH2Label(t('dashboard.courses.communities.settings.access.subtitle'))
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

  const tabs: DashTabItem[] = [
    {
      key: 'general',
      label: t('dashboard.courses.communities.settings.tabs.general'),
      icon: <MessagesSquare size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/communities/${params.communityuuid}/general`,
      active: params.subpage === 'general',
    },
    {
      key: 'thumbnail',
      label: t('dashboard.courses.communities.settings.tabs.thumbnail'),
      icon: <ImageIcon size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/communities/${params.communityuuid}/thumbnail`,
      active: params.subpage === 'thumbnail',
    },
    {
      key: 'access',
      label: t('dashboard.courses.communities.settings.tabs.access'),
      icon: <Users size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/communities/${params.communityuuid}/access`,
      active: params.subpage === 'access',
    },
    {
      key: 'course',
      label: t('dashboard.courses.communities.settings.tabs.course'),
      icon: <Link2 size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/communities/${params.communityuuid}/course`,
      active: params.subpage === 'course',
    },
    {
      key: 'moderation',
      label: t('dashboard.courses.communities.settings.tabs.moderation'),
      icon: <Shield size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/communities/${params.communityuuid}/moderation`,
      active: params.subpage === 'moderation',
    },
  ]

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0 relative">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: t('dashboard.courses.communities.title'), href: '/dash/communities', icon: <MessagesSquare size={14} /> },
            { label: community.name }
          ]} />
        </div>
        <div className="my-2 py-2">
          <div className="w-full flex flex-col space-y-1 min-w-0">
            <div className="pt-3 flex font-bold text-3xl sm:text-4xl tracking-tighter truncate">{H1Label}</div>
            <div className="flex font-medium text-gray-400 text-md truncate">{H2Label}</div>
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
        {params.subpage === 'general' && <CommunityEditGeneral />}
        {params.subpage === 'thumbnail' && <CommunityEditThumbnail />}
        {params.subpage === 'access' && <CommunityEditAccess />}
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
