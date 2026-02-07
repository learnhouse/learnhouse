import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import DocSpaceEditorClient from './client'

type MetadataProps = {
  params: Promise<{ orgslug: string; spaceuuid: string; subpage: string }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return {
    title: 'Edit DocSpace — ' + org.name,
    robots: { index: false, follow: false },
  }
}

async function DocSpaceEditorPage(params: any) {
  const { orgslug, spaceuuid, subpage } = await params.params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return (
    <DocSpaceEditorClient
      org_id={org.id}
      orgslug={orgslug}
      spaceuuid={spaceuuid}
      subpage={subpage}
    />
  )
}

export default DocSpaceEditorPage
