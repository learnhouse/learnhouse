import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import DocPageEditorClient from './client'

type MetadataProps = {
  params: Promise<{ orgslug: string; spaceuuid: string; pageuuid: string }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return {
    title: 'Edit Doc Page — ' + org.name,
    robots: { index: false, follow: false },
  }
}

async function DocPageEditorPage(params: any) {
  const { orgslug, spaceuuid, pageuuid } = await params.params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return (
    <DocPageEditorClient
      org_id={org.id}
      orgslug={orgslug}
      spaceuuid={spaceuuid}
      pageuuid={pageuuid}
    />
  )
}

export default DocPageEditorPage
