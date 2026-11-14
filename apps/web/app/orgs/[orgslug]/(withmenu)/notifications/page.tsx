import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import NotificationsPageClient from './notifications'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const title = buildPageTitle('Notifications', org?.name || 'Organization', getOrgSeoConfig(org))
  return {
    title,
    // Personal to the signed-in user.
    robots: { index: false, follow: false, nocache: true },
  }
}

export default function NotificationsPage() {
  return <NotificationsPageClient />
}
