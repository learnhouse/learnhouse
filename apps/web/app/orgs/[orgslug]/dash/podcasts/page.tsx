import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import PodcastsDashClient from './client'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  return {
    title: 'Podcasts | ' + org.name,
    description: `Manage podcasts for ${org.name}`,
    robots: {
      index: false,
      follow: false,
    },
  }
}

// The list loads on the client (React Query), not here: a server fetch made
// every visit wait on the API before the page could even start to show, and
// its result could not be reused across visits.
async function PodcastsDashPage(params: any) {
  const orgslug = (await params.params).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  return <PodcastsDashClient org_id={org.id} orgslug={orgslug} />
}

export default PodcastsDashPage
