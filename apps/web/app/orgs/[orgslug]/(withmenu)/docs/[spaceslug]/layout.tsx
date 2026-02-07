import React from 'react'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getServerSession } from '@/lib/auth/server'
import { getDocSpaceMetaBySlug } from '@services/docs/docspaces'
import DocSpaceLayoutClient from '@components/Objects/Docs/DocSpaceLayoutClient'

type LayoutParams = Promise<{ orgslug: string; spaceslug: string }>

export default async function DocSpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: LayoutParams
}) {
  const { orgslug, spaceslug } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  let meta = null
  try {
    meta = await getDocSpaceMetaBySlug(
      orgslug,
      spaceslug,
      { revalidate: 0, tags: ['docs'] },
      access_token ?? undefined
    )
  } catch {
    // Space not found or not accessible
  }

  return (
    <DocSpaceLayoutClient
      meta={meta}
      spaceslug={spaceslug}
      orgslug={orgslug}
    >
      {children}
    </DocSpaceLayoutClient>
  )
}
