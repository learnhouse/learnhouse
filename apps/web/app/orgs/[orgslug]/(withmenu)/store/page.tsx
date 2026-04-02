import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import { getPublicOffers } from '@services/payments/offers'
import Store from './store'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  const seoConfig = getOrgSeoConfig(org)
  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || (org ? getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image) : undefined)
  const title = buildPageTitle('Store', org?.name || 'Organization', seoConfig)
  const description = `Browse offers and subscriptions from ${org?.name || 'this organization'}`
  const canonical = getCanonicalUrl(orgslug, '/store')

  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: 'website',
      ...(imageUrl && { images: [{ url: imageUrl, width: 800, height: 600, alt: org?.name || 'Store' }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
  }
}

export default async function StorePage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })

  const paymentsEnabled = org?.config?.config?.resolved_features?.payments?.enabled ?? org?.config?.config?.features?.payments?.enabled !== false

  if (!paymentsEnabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-4 nice-shadow">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        </div>
        <h2 className="text-xl font-bold text-gray-600 mb-2">Store not available</h2>
        <p className="text-gray-400 text-sm max-w-sm">
          This organization has not enabled their store yet.
        </p>
      </div>
    )
  }

  let offers: any[] = []
  try {
    const result = await getPublicOffers(org.id)
    offers = Array.isArray(result) ? result : (result?.data ?? [])
  } catch {
    offers = []
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(orgslug, '/') },
    { name: 'Store', url: getCanonicalUrl(orgslug, '/store') },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <Store orgslug={orgslug} offers={offers} />
    </>
  )
}
