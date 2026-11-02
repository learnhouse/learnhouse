import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import LiveSessionSettingsPage from '@ee/components/LiveSessions/Pages/LiveSessionSettingsPage'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  return {
    title: 'Live session settings | ' + org.name,
    robots: { index: false, follow: false },
  }
}

export default async function Page(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  return <LiveSessionSettingsPage orgslug={orgslug} />
}
