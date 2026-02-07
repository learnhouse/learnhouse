import React from 'react'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getDocSpaceMetaBySlug } from '@services/docs/docspaces'
import { getDocPage } from '@services/docs/docpages'
import DocPageView from '@components/Objects/Docs/DocPageRenderer'

type PageParams = Promise<{
  orgslug: string
  spaceslug: string
  sectionslug: string
  pageslug: string
}>

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { orgslug, spaceslug, sectionslug, pageslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  // Try to get the page for metadata
  let pageTitle = 'Documentation'
  let spaceName = 'Docs'
  try {
    const session = await getServerSession()
    const access_token = session?.tokens?.access_token
    const meta = await getDocSpaceMetaBySlug(
      orgslug,
      spaceslug,
      { revalidate: 60, tags: ['docs'] },
      access_token ?? undefined
    )
    if (meta?.name) spaceName = meta.name
    // Find the page by slug
    for (const section of meta?.sections || []) {
      for (const page of section.pages || []) {
        if (page.slug === pageslug) {
          pageTitle = page.name
          break
        }
      }
      for (const group of section.groups || []) {
        for (const page of group.pages || []) {
          if (page.slug === pageslug) {
            pageTitle = page.name
            break
          }
        }
      }
    }
  } catch {
    // Use default title
  }

  return {
    title: `${pageTitle} — ${spaceName} — ${org?.name || 'Organization'}`,
    description: `${pageTitle} documentation`,
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
      title: `${pageTitle} — ${org?.name || 'Organization'}`,
      type: 'article',
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

export default async function DocPageRoute({ params }: { params: PageParams }) {
  const { orgslug, spaceslug, sectionslug, pageslug } = await params
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
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Page not found</p>
        </div>
      </div>
    )
  }

  // Find page UUID and section name from the meta tree
  let pageData = null
  let sectionName: string | undefined
  if (meta) {
    for (const section of meta.sections || []) {
      if (section.slug !== sectionslug) continue
      sectionName = section.name
      for (const page of section.pages || []) {
        if (page.slug === pageslug) {
          pageData = page
          break
        }
      }
      if (!pageData) {
        for (const group of section.groups || []) {
          for (const page of group.pages || []) {
            if (page.slug === pageslug) {
              pageData = page
              break
            }
          }
          if (pageData) break
        }
      }
      break
    }
  }

  if (!pageData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Page not found</p>
          <p className="text-sm mt-1">This page doesn&apos;t exist in this section.</p>
        </div>
      </div>
    )
  }

  // Fetch full page content
  let fullPage = null
  try {
    fullPage = await getDocPage(
      pageData.docpage_uuid,
      { revalidate: 0, tags: ['docs'] },
      access_token ?? undefined
    )
  } catch {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Failed to load page</p>
        </div>
      </div>
    )
  }

  // LINK pages redirect directly to the external URL
  if (fullPage?.page_type === 'LINK' && fullPage?.content?.url) {
    redirect(fullPage.content.url)
  }

  const spaceName = meta?.name || 'Docs'

  const breadcrumbItems = [
    { label: spaceName, href: `/docs/${spaceslug}` },
    ...(sectionName ? [{ label: sectionName, href: `/docs/${spaceslug}/${sectionslug}` }] : []),
    { label: fullPage.name },
  ]

  return <DocPageView page={fullPage} sectionName={sectionName} breadcrumbItems={breadcrumbItems} />
}
