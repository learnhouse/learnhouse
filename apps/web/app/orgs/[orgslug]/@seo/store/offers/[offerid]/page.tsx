import { SeoScripts } from '@components/SEO/SeoScripts'
import { getSeoContext } from '@/lib/seo/context.server'
import { productJsonLd } from '@/lib/seo/jsonld'
import { featureIndexable } from '@/lib/seo/meta'
import { getServerAPIUrl } from '@services/config/config'

/** A public store offer: Product + Offer (price, currency). Unlisted offers get none. */
export default async function OfferSeo({ params }: { params: Promise<{ orgslug: string; offerid: string }> }) {
  const { orgslug, offerid } = await params
  const ctx = await getSeoContext(orgslug)
  if (!ctx.org?.id || !featureIndexable(ctx.seo, 'store')) return null
  let offer: any = null
  try {
    const res = await fetch(`${getServerAPIUrl()}payments/${ctx.org.id}/offers/${encodeURIComponent(offerid)}/public`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    })
    offer = res.ok ? await res.json() : null
  } catch {
    offer = null
  }
  if (!offer?.offer_uuid || offer.is_publicly_listed === false) return null
  return (
    <SeoScripts
      items={[
        productJsonLd({
          name: offer.name,
          url: await ctx.url(`/store/offers/${encodeURIComponent(offerid)}`),
          description: offer.description || offer.benefits,
          price: typeof offer.amount === 'number' ? offer.amount : null,
          currency: offer.currency,
          org: ctx.orgRef,
        }),
      ]}
    />
  )
}
