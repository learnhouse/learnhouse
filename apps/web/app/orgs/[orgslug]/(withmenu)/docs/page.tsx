import React from 'react'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
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

  const seoConfig = getOrgSeoConfig(org)
  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || (org ? getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image) : undefined)
  const title = buildPageTitle('Documentation', org?.name || 'Organization', seoConfig)
  const description = org?.description || seoConfig.default_meta_description || `Browse documentation from ${org?.name || 'this organization'}`
  const canonical = getCanonicalUrl(orgslug, '/docs')

  return {
    title,
    description,
    keywords: `${org?.name}, documentation, docs, help, guides, ${org?.name} docs`,
    robots: {
      index: !seoConfig.noindex_docs,
      follow: true,
      nocache: true,
      googleBot: {
        index: !seoConfig.noindex_docs,
        follow: true,
        'max-image-preview': 'large',
      },
    },
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      ...(imageUrl && {
        images: [
          {
            url: imageUrl,
            width: 800,
            height: 600,
            alt: org?.name || 'Documentation',
          },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
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
