import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import LiveSessionsDashPage from '@ee/components/LiveSessions/Pages/LiveSessionsDashPage'

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
    title: 'Live sessions | ' + org.name,
    description: `Manage live sessions for ${org.name}`,
    robots: {
      index: false,
      follow: false,
    },
  }
}

async function Page(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  return <LiveSessionsDashPage orgslug={orgslug} />
}

export default Page
