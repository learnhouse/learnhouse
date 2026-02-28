import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import { getPublicOffer } from '@services/payments/offers'
import { getServerSession } from '@/lib/auth/server'
import OfferDetailClient from './offer-detail'

type PageParams = Promise<{ orgslug: string; offerid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug, offerid } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] })
  const seoConfig = getOrgSeoConfig(org)
  let offerName = 'Offer'
  try {
    const result = await getPublicOffer(org.id, offerid)
    offerName = result?.data?.name || 'Offer'
  } catch {}
  const title = buildPageTitle(offerName, org?.name || 'Organization', seoConfig)
  return {
    title,
    robots: { index: true, follow: true },
    alternates: { canonical: getCanonicalUrl(orgslug, `/store/offers/${offerid}`) },
  }
}

export default async function OfferPage({ params }: { params: PageParams }) {
  const { orgslug, offerid } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800, tags: ['organizations'] })
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token ?? null

  let offer: any = null
  try {
    const result = await getPublicOffer(org.id, offerid)
    offer = result?.data ?? result
  } catch {}

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(orgslug, '/') },
    { name: 'Store', url: getCanonicalUrl(orgslug, '/store') },
    { name: offer?.name || 'Offer', url: getCanonicalUrl(orgslug, `/store/offers/${offerid}`) },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <OfferDetailClient
        orgslug={orgslug}
        orgId={org.id}
        offer={offer}
        offerUuid={offerid}
        access_token={access_token}
      />
    </>
  )
}
