import React from 'react'
import { Metadata } from 'next'
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
  subpageslug: string
}>

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { orgslug, spaceslug, pageslug, subpageslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  let pageTitle = 'Documentation'
  let parentTitle = ''
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

    for (const section of meta?.sections || []) {
      for (const page of [...(section.pages || []), ...(section.groups || []).flatMap((g: any) => g.pages || [])]) {
        if (page.slug === pageslug) {
          parentTitle = page.name
          for (const sub of page.subpages || []) {
            if (sub.slug === subpageslug) {
              pageTitle = sub.name
              break
            }
          }
          break
        }
      }
    }
  } catch {
    // Use default title
  }

  const fullTitle = parentTitle
    ? `${pageTitle} — ${parentTitle} — ${spaceName} — ${org?.name || 'Organization'}`
    : `${pageTitle} — ${spaceName} — ${org?.name || 'Organization'}`

  return {
    title: fullTitle,
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

export default async function SubpageRoute({ params }: { params: PageParams }) {
  const { orgslug, spaceslug, sectionslug, pageslug, subpageslug } = await params
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

  // Find parent page and subpage from the meta tree
  let parentPageData = null
  let subpageData = null
  let sectionName: string | undefined
  if (meta) {
    for (const section of meta.sections || []) {
      if (section.slug !== sectionslug) continue
      sectionName = section.name

      const allPages = [
        ...(section.pages || []),
        ...(section.groups || []).flatMap((g: any) => g.pages || []),
      ]

      for (const page of allPages) {
        if (page.slug === pageslug) {
          parentPageData = page
          for (const sub of page.subpages || []) {
            if (sub.slug === subpageslug) {
              subpageData = sub
              break
            }
          }
          break
        }
      }
      break
    }
  }

  if (!subpageData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Subpage not found</p>
          <p className="text-sm mt-1">This subpage doesn&apos;t exist.</p>
        </div>
      </div>
    )
  }

  // Fetch full subpage content
  let fullSubpage = null
  try {
    fullSubpage = await getDocPage(
      subpageData.docpage_uuid,
      { revalidate: 0, tags: ['docs'] },
      access_token ?? undefined
    )
  } catch {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Failed to load subpage</p>
        </div>
      </div>
    )
  }

  const spaceName = meta?.name || 'Docs'

  const breadcrumbItems = [
    { label: spaceName, href: `/docs/${spaceslug}` },
    ...(sectionName ? [{ label: sectionName, href: `/docs/${spaceslug}/${sectionslug}` }] : []),
    ...(parentPageData ? [{ label: parentPageData.name, href: `/docs/${spaceslug}/${sectionslug}/${pageslug}` }] : []),
    { label: fullSubpage.name },
  ]

  return (
    <DocPageView
      page={fullSubpage}
      sectionName={parentPageData ? `${sectionName} > ${parentPageData.name}` : sectionName}
      breadcrumbItems={breadcrumbItems}
    />
  )
}
