import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import { nextAuthOptions } from 'app/auth/options'
import { getServerSession } from 'next-auth'
import { getCommunities } from '@services/communities/communities'
import CommunitiesDashClient from './client'

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
    title: 'Communities — ' + org.name,
    description: `Manage communities for ${org.name}`,
    robots: {
      index: false,
      follow: false,
    },
  }
}

async function CommunitiesDashPage(params: any) {
  const orgslug = (await params.params).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const session = await getServerSession(nextAuthOptions)
  const access_token = session?.tokens?.access_token

  let communities = []
  try {
    communities = await getCommunities(
      org.id,
      1,
      100,
      { revalidate: 0, tags: ['communities'] },
      access_token ? access_token : undefined
    )
  } catch (error) {
    console.error('Failed to fetch communities:', error)
    communities = []
  }

  return (
    <CommunitiesDashClient
      org_id={org.id}
      orgslug={orgslug}
      communities={communities || []}
    />
  )
}

export default CommunitiesDashPage
