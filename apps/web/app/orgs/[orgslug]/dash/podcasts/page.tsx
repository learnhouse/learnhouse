import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import { nextAuthOptions } from 'app/auth/options'
import { getServerSession } from 'next-auth'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import PodcastsDashClient from './client'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return {
    title: 'Podcasts — ' + org.name,
    description: `Manage podcasts for ${org.name}`,
    robots: {
      index: false,
      follow: false,
    },
  }
}

async function PodcastsDashPage(params: any) {
  const orgslug = (await params.params).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const session = await getServerSession(nextAuthOptions)
  const access_token = session?.tokens?.access_token

  let podcasts = []
  try {
    podcasts = await getOrgPodcasts(
      orgslug,
      { revalidate: 0, tags: ['podcasts'] },
      access_token ? access_token : undefined,
      true // include_unpublished for dashboard
    )
  } catch (error) {
    console.error('Failed to fetch podcasts:', error)
    podcasts = []
  }

  return (
    <PodcastsDashClient
      org_id={org.id}
      orgslug={orgslug}
      podcasts={podcasts || []}
    />
  )
}

export default PodcastsDashPage
