import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import { getServerSession } from '@/lib/auth/server'
import DocSpaceListClient from './client'

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
    title: 'Documentation — ' + org.name,
    description: `Manage documentation for ${org.name}`,
    robots: {
      index: false,
      follow: false,
    },
  }
}

async function DocsDashPage(params: any) {
  const orgslug = (await params.params).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return (
    <DocSpaceListClient
      org_id={org.id}
      orgslug={orgslug}
    />
  )
}

export default DocsDashPage
