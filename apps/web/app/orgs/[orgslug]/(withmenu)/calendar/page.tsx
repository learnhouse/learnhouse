import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import CalendarClient from './calendar'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const seoConfig = getOrgSeoConfig(org)
  const title = buildPageTitle('Calendar', org?.name || 'Organization', seoConfig)
  const description = `Deadlines and live sessions from ${org?.name || 'this organization'}`
  return {
    title,
    description,
    // Personal to the signed-in user: nothing here is worth indexing.
    robots: { index: false, follow: true, nocache: true },
    alternates: { canonical: await getServerCanonicalUrl(orgslug, '/calendar') },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function CalendarPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  return <CalendarClient orgslug={orgslug} orgId={org?.id || 0} />
}
