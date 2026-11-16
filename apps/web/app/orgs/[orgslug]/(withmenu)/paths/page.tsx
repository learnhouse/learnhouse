import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import PathsClient from './paths'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await params
  const ctx = await getSeoContext(orgslug)
  return buildListMetadata({ ctx, name: 'Paths', path: '/paths', description: `Learning paths from ${ctx.org?.name}`, keywords: undefined })
}

export default async function PathsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  return (
    <>
      <PathsClient orgslug={orgslug} org_id={org?.id || 0} />
    </>
  )
}
