'use client'
import React, { use } from 'react'
import { PodcastProvider, usePodcast } from '@components/Contexts/PodcastContext'
import Link from 'next/link'
import { motion } from 'motion/react'
import { Info, ListMusic, Headphones, ArrowLeft, Rss } from 'lucide-react'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import EditPodcastGeneral from '@components/Dashboard/Pages/Podcast/EditPodcastGeneral/EditPodcastGeneral'
import EditPodcastEpisodes from '@components/Dashboard/Pages/Podcast/EditPodcastEpisodes/EditPodcastEpisodes'
import PodcastDistribution from '@components/Dashboard/Pages/Podcast/PodcastDistribution/PodcastDistribution'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'

export type PodcastOverviewParams = {
  orgslug: string
  podcastuuid: string
  subpage: string
}

function PodcastOverviewPage(props: { params: Promise<PodcastOverviewParams> }) {
  const { t } = useTranslation()
  const params = use(props.params)

  function getEntirePodcastUUID(podcastuuid: string) {
    return `podcast_${podcastuuid}`
  }

  const podcastuuid = getEntirePodcastUUID(params.podcastuuid)

  const tabs = [
    {
      key: 'general',
      label: t('podcasts.dashboard.tabs.general'),
      icon: Info,
      href: `/dash/podcasts/podcast/${params.podcastuuid}/general`,
    },
    {
      key: 'content',
      label: t('podcasts.dashboard.tabs.episodes'),
      icon: ListMusic,
      href: `/dash/podcasts/podcast/${params.podcastuuid}/content`,
    },
    {
      key: 'distribution',
      label: 'Distribution',
      icon: Rss,
      href: `/dash/podcasts/podcast/${params.podcastuuid}/distribution`,
    },
  ]

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1">
      <PodcastProvider podcastuuid={podcastuuid}>
        <PodcastOverviewHeader params={params} tabs={tabs} />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
          className="h-full overflow-y-auto"
        >
          <div>
            {params.subpage === 'general' && (
              <EditPodcastGeneral orgslug={params.orgslug} />
            )}
            {params.subpage === 'content' && (
              <EditPodcastEpisodes orgslug={params.orgslug} podcastuuid={podcastuuid} />
            )}
            {params.subpage === 'distribution' && (
              <PodcastDistribution orgslug={params.orgslug} podcastuuid={podcastuuid} />
            )}
          </div>
        </motion.div>
      </PodcastProvider>
    </div>
  )
}

function PodcastOverviewHeader({
  params,
  tabs,
}: {
  params: PodcastOverviewParams
  tabs: { key: string; label: string; icon: any; href: string }[]
}) {
  const { t } = useTranslation()
  const { podcast, isLoading } = usePodcast()

  if (isLoading) {
    return (
      <div className="pl-10 pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow relative animate-pulse">
        <div className="pt-6 pb-4">
          <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center space-x-4">
              <div className="w-9 h-9 bg-gray-200 rounded-lg" />
              <div className="h-7 w-48 bg-gray-200 rounded" />
              <div className="h-5 w-16 bg-gray-100 rounded-full" />
            </div>
            <div className="h-4 w-28 bg-gray-100 rounded" />
          </div>
        </div>
        <div className="flex space-x-3 pb-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-24 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="pl-4 pr-4 sm:pl-10 sm:pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow relative">
      <div className="pt-6 pb-4">
        <Breadcrumbs
          items={[
            {
              label: t('podcasts.podcasts'),
              href: '/dash/podcasts',
              icon: <Headphones size={14} />,
            },
            {
              label: podcast?.name || 'Podcast',
              href: `/dash/podcasts/podcast/${params.podcastuuid}/general`,
            },
          ]}
        />
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center space-x-4">
            <Link
              href={getUriWithOrg(params.orgslug, '/dash/podcasts')}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-2xl font-bold">
              {podcast?.name || 'Podcast'}
            </h1>
            {podcast && (
              <span
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full ${
                  podcast.published
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}
              >
                {podcast.published ? t('podcasts.published') : t('podcasts.unpublished')}
              </span>
            )}
          </div>
          {podcast && (
            <Link
              href={getUriWithOrg(params.orgslug, `/podcast/${params.podcastuuid}`)}
              target="_blank"
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              {t('podcasts.dashboard.view_podcast')} &rarr;
            </Link>
          )}
        </div>
      </div>
      <DashTabBar tabs={tabs.map((tab) => {
        const IconComponent = tab.icon
        return {
          key: tab.key,
          label: tab.label,
          icon: <IconComponent size={16} />,
          href: getUriWithOrg(params.orgslug, '') + tab.href,
          active: params.subpage === tab.key,
        } as DashTabItem
      })} />
    </div>
  )
}

export default PodcastOverviewPage
