import React from 'react'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getOrgDocSpaces, getDefaultDocSpace } from '@services/docs/docspaces'
import { redirect } from 'next/navigation'
import DocsLandingClient from './docs-landing'

type PageParams = Promise<{ orgslug: string }>

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
    title: `Documentation — ${org?.name || 'Organization'}`,
    description: org?.description || `Browse documentation from ${org?.name || 'this organization'}`,
    keywords: `${org?.name}, documentation, docs, help, guides, ${org?.name} docs`,
    robots: {
      index: true,
      follow: true,
      nocache: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
      },
    },
    openGraph: {
      title: `Documentation — ${org?.name || 'Organization'}`,
      description: org?.description || `Browse documentation from ${org?.name || 'this organization'}`,
      type: 'website',
      images: org
        ? [
            {
              url: getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image),
              width: 800,
              height: 600,
              alt: org.name,
            },
          ]
        : [],
    },
  }
}

export default async function DocsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  // Check for default docspace and redirect
  let defaultSpace: any = null
  try {
    defaultSpace = await getDefaultDocSpace(
      orgslug,
      { revalidate: 0, tags: ['docs'] },
      access_token ?? undefined
    )
  } catch {
    // No default space, show listing
  }
  if (defaultSpace?.slug) {
    redirect(`/docs/${defaultSpace.slug}`)
  }

  // Fetch all docspaces
  let docspaces: any[] = []
  try {
    docspaces = await getOrgDocSpaces(
      orgslug,
      { revalidate: 0, tags: ['docs'] },
      access_token ?? undefined
    )
  } catch (error: any) {
    if (error?.status === 403) {
      docspaces = []
    } else {
      // Suppress other errors, show empty
      docspaces = []
    }
  }

  return (
    <DocsLandingClient
      orgslug={orgslug}
      docspaces={docspaces}
    />
  )
}
