import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import { getServerSession } from '@/lib/auth/server'
import { getFolderById } from '@services/folders/folders'
import FolderView from './client'

type MetadataProps = {
  params: Promise<{ orgslug: string; folderid: string }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  return {
    title: 'Library — ' + org.name,
    robots: { index: false, follow: false },
  }
}

async function FolderPage(props: { params: Promise<{ orgslug: string; folderid: string }> }) {
  const { orgslug, folderid } = await props.params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  let folder: any = null
  try {
    folder = await getFolderById('folder_' + folderid, access_token ?? undefined, { revalidate: 0, tags: ['folders'] })
  } catch (error) {
    console.error('Failed to fetch folder:', error)
    folder = null
  }

  return (
    <FolderView
      orgslug={orgslug}
      org_id={org.id}
      folderid={folderid}
      initialFolder={folder}
    />
  )
}

export default FolderPage
