import { SeoScripts } from '@components/SEO/SeoScripts'
import { getSeoContext } from '@/lib/seo/context.server'
import { breadcrumbJsonLd, faqJsonLd } from '@/lib/seo/jsonld'
import { landingFaq } from '@/lib/seo/landing'
import { fetchPublishedLanding } from '@/lib/seo/landingData.server'

/** A builder page: breadcrumbs, and FAQPage when it has FAQ blocks. */
export default async function LandingPageSeo({ params }: { params: Promise<{ orgslug: string; pageslug: string }> }) {
  const { orgslug, pageslug } = await params
  const [ctx, landing] = await Promise.all([getSeoContext(orgslug), fetchPublishedLanding(orgslug, pageslug)])
  if (!landing || ctx.degraded || ctx.seo.indexing_disabled || landing.doc?.page?.noindex) return null
  const url = await ctx.url(`/p/${encodeURIComponent(pageslug)}`)
  return (
    <SeoScripts
      items={[
        faqJsonLd(landingFaq(landing.doc)),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: landing.doc?.page?.title || landing.title || pageslug, url },
        ]),
      ]}
    />
  )
}
