import { Metadata } from 'next'
import { getOrgOr404 } from '@/lib/org.server'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import NotificationsPageClient from './notifications'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrgOr404(orgslug)
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
