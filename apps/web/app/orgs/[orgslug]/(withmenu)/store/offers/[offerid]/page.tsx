import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import { JsonLd } from '@components/SEO/JsonLd'
import { getPublicOffer } from '@services/payments/offers'
import { getServerSession } from '@/lib/auth/server'
import OfferDetailClient from './offer-detail'

type PageParams = Promise<{ orgslug: string; offerid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug, offerid } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const seoConfig = getOrgSeoConfig(org)
  let offerName = 'Offer'
  try {
    const result = await getPublicOffer(org.id, offerid)
    offerName = (result?.success && result.data?.name) || 'Offer'
  } catch {
    // The title falls back to "Offer"; the page itself reports a missing offer.
  }
  const title = buildPageTitle(offerName, org?.name || 'Organization', seoConfig)
  return {
    title,
    robots: { index: true, follow: true },
    alternates: { canonical: await getServerCanonicalUrl(orgslug, `/store/offers/${offerid}`) },
  }
}

export default async function OfferPage({ params }: { params: PageParams }) {
  const { orgslug, offerid } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token ?? null

  let offer: any = null
  try {
    const result = await getPublicOffer(org.id, offerid)
    // A failed lookup (archived, unlisted, unknown id) still carries a JSON
    // body like {"detail": "Not Found"}. Treating that as the offer crashed the
    // page on its missing currency; only a successful response is an offer.
    offer = result?.success && result.data?.offer_uuid ? result.data : null
  } catch {
    // Network failure: leave `offer` null so the "Offer not found" view renders.
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: await getServerCanonicalUrl(orgslug, '/') },
    { name: 'Store', url: await getServerCanonicalUrl(orgslug, '/store') },
    { name: offer?.name || 'Offer', url: await getServerCanonicalUrl(orgslug, `/store/offers/${offerid}`) },
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
