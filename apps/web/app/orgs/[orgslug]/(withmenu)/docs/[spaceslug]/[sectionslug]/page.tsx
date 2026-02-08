import React from 'react'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getServerSession } from '@/lib/auth/server'
import { getDocSpaceMetaBySlug } from '@services/docs/docspaces'
import { redirect } from 'next/navigation'
import { Metadata } from 'next'

type PageParams = Promise<{ orgslug: string; spaceslug: string; sectionslug: string }>

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

export default async function DocSectionPage({ params }: { params: PageParams }) {
  const { orgslug, spaceslug, sectionslug } = await params
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

  // Redirect to first page — must be outside try/catch
  const section = meta?.sections?.find((s: any) => s.slug === sectionslug)
  if (section) {
    const firstPage =
      section.pages?.[0] ||
      section.groups?.[0]?.pages?.[0]
    if (firstPage) {
      redirect(`/docs/${spaceslug}/${sectionslug}/${firstPage.slug}`)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center text-gray-400">
        <p className="text-lg font-medium">This section is empty</p>
        <p className="text-sm mt-1">No pages have been added yet.</p>
      </div>
    </div>
  )
}
