import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import LiveCatalogPage from '@ee/components/LiveSessions/Pages/LiveCatalogPage'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const seoConfig = getOrgSeoConfig(org)
  const title = buildPageTitle('Live sessions', org?.name || 'Organization', seoConfig)
  const description = `Upcoming live classes, office hours and events from ${org?.name || 'this organization'}`
  return {
    title,
    description,
    robots: { index: true, follow: true, nocache: true },
    alternates: { canonical: await getServerCanonicalUrl(orgslug, '/live') },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function LiveSessionsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  return <LiveCatalogPage orgslug={orgslug} orgId={org?.id || 0} />
}
