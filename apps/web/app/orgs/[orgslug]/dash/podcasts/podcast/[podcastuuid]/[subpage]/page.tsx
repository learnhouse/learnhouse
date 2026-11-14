'use client'
import React, { use } from 'react'
import EditPodcastGeneral from '@components/Dashboard/Pages/Podcast/EditPodcastGeneral/EditPodcastGeneral'
import EditPodcastEpisodes from '@components/Dashboard/Pages/Podcast/EditPodcastEpisodes/EditPodcastEpisodes'
import PodcastDistribution from '@components/Dashboard/Pages/Podcast/PodcastDistribution/PodcastDistribution'
import { PodcastSeoTab } from '@components/Dashboard/Shared/SEO/ResourceSeoTabs'

export type PodcastOverviewParams = {
  orgslug: string
  podcastuuid: string
  subpage: string
}

// The header, tabs and PodcastProvider come from ../layout.tsx, so this only
// renders the body of the active tab.
function PodcastOverviewPage(props: { params: Promise<PodcastOverviewParams> }) {
  const params = use(props.params)
  const podcastuuid = `podcast_${params.podcastuuid}`

  return (
    <>
      {params.subpage === 'general' && <EditPodcastGeneral orgslug={params.orgslug} />}
      {params.subpage === 'content' && <EditPodcastEpisodes orgslug={params.orgslug} podcastuuid={podcastuuid} />}
      {params.subpage === 'distribution' && <PodcastDistribution orgslug={params.orgslug} podcastuuid={podcastuuid} />}
      {params.subpage === 'seo' && <PodcastSeoTab orgslug={params.orgslug} />}
    </>
  )
}

export default PodcastOverviewPage
