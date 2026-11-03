import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import PathsDashClient from './client'

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
    title: 'Paths | ' + org.name,
    description: `Manage learning paths for ${org.name}`,
    robots: {
      index: false,
      follow: false,
    },
  }
}

async function PathsDashPage(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  return <PathsDashClient org_id={org.id} orgslug={orgslug} />
}

export default PathsDashPage
