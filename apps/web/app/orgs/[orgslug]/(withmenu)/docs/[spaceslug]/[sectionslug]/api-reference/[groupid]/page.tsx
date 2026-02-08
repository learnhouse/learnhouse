import React from 'react'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getDocSpaceMetaBySlug } from '@services/docs/docspaces'
import ApiReferenceView from '@components/Objects/Docs/ApiReferenceView'

type PageParams = Promise<{
  orgslug: string
  spaceslug: string
  sectionslug: string
  groupid: string
}>

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
    title: `API Reference — ${org?.name || 'Organization'}`,
    description: 'API Reference documentation',
    openGraph: {
      title: `API Reference — ${org?.name || 'Organization'}`,
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

export default async function GroupApiReferencePage({
  params,
  searchParams,
}: {
  params: PageParams
  searchParams: Promise<{ tag?: string; method?: string; path?: string }>
}) {
  const { orgslug, spaceslug, sectionslug, groupid } = await params
  const { tag: activeTag, method, path } = await searchParams
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
          <p className="text-lg font-medium">API reference not found</p>
        </div>
      </div>
    )
  }

  // Collect ALL API_REFERENCE groups in this section
  const apiGroups: { name: string; uuid: string; apiConfig: any }[] = []
  if (meta) {
    for (const section of meta.sections || []) {
      if (section.slug !== sectionslug) continue
      for (const group of section.groups || []) {
        if (group.group_type === 'API_REFERENCE' && group.api_config?.spec) {
          apiGroups.push({
            name: group.name || 'API Reference',
            uuid: group.docgroup_uuid,
            apiConfig: group.api_config,
          })
        }
      }
      break
    }
  }

  if (apiGroups.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">No API references found</p>
          <p className="text-sm mt-1">This section doesn&apos;t have any API references configured.</p>
        </div>
      </div>
    )
  }

  return (
    <ApiReferenceView
      apiGroups={apiGroups}
      activeGroupId={groupid}
      activeTag={activeTag || null}
      endpointMethod={method || null}
      endpointPath={path || null}
      spaceslug={spaceslug}
      sectionslug={sectionslug}
    />
  )
}
