import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import LiveCatalogPage from '@ee/components/LiveSessions/Pages/LiveCatalogPage'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await params
  const ctx = await getSeoContext(orgslug)
  return buildListMetadata({ ctx, name: 'Live sessions', path: '/live', description: `Upcoming live classes, office hours and events from ${ctx.org?.name || 'this organization'}`, keywords: undefined })
}

export default async function LiveSessionsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  return <LiveCatalogPage orgslug={orgslug} orgId={org?.id || 0} />
}
