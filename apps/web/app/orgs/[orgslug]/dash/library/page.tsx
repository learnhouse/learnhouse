import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import LibraryHome from './client'

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
    title: 'Library | ' + org.name,
    description: `Manage the library for ${org.name}`,
    robots: {
      index: false,
      follow: false,
    },
  }
}

// Folders load on the client (SWR), not here: a server fetch made every
// visit wait on the API before the page could even start to show.
async function LibraryPage(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  return <LibraryHome orgslug={orgslug} org_id={org.id} />
}

export default LibraryPage
