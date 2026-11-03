import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import LiveSessionPage from '@ee/components/LiveSessions/Pages/LiveSessionPage'

type PageParams = Promise<{ orgslug: string; sessionuuid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const title = buildPageTitle('Live session', org?.name || 'Organization', getOrgSeoConfig(org))
  return { title, robots: { index: false, follow: true }, openGraph: { title } }
}

export default async function Page({ params }: { params: PageParams }) {
  const { orgslug, sessionuuid } = await params
  return <LiveSessionPage orgslug={orgslug} sessionuuid={sessionuuid} />
}
