import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'

export { default } from '@ee/app/payments/affiliate/AffiliatePage'

// The page is a client component; without this the tab had no title at all.
export async function generateMetadata({ params }: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  return {
    title: buildPageTitle('Affiliate program', org?.name || 'Organization', getOrgSeoConfig(org)),
    // A member's own affiliate dashboard: nothing for search engines here.
    robots: { index: false, follow: false },
  }
}
