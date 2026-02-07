import React from 'react'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getServerSession } from '@/lib/auth/server'
import { getDocSpaceMetaBySlug } from '@services/docs/docspaces'
import { redirect } from 'next/navigation'
import { Metadata } from 'next'

type PageParams = Promise<{ orgslug: string; spaceslug: string }>

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return {
    title: `Docs — ${org?.name || 'Organization'}`,
    robots: { index: true, follow: true },
  }
}

export default async function DocSpacePage({ params }: { params: PageParams }) {
  const { orgslug, spaceslug } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  let meta = null
  try {
    meta = await getDocSpaceMetaBySlug(
      orgslug,
      spaceslug,
      { revalidate: 0, tags: ['docs'] },
      access_token ?? undefined
    )
  } catch {
    // Fall through to empty state
  }

  // Redirect to first section's first page — must be outside try/catch
  if (meta?.sections?.length > 0) {
    const firstSection = meta.sections[0]
    const firstPage =
      firstSection.pages?.[0] ||
      firstSection.groups?.[0]?.pages?.[0]
    if (firstPage) {
      redirect(`/docs/${spaceslug}/${firstSection.slug}/${firstPage.slug}`)
    } else {
      redirect(`/docs/${spaceslug}/${firstSection.slug}`)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center text-gray-400">
        <p className="text-lg font-medium">This documentation space is empty</p>
        <p className="text-sm mt-1">No sections have been added yet.</p>
      </div>
    </div>
  )
}
