import { SeoScripts } from '@components/SEO/SeoScripts'
import { getSeoContext } from '@/lib/seo/context.server'
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/jsonld'

/** Home: the organization entity every other page links to, and the site. */
export default async function HomeSeo({ params }: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await params
  const ctx = await getSeoContext(orgslug)
  if (ctx.seo.indexing_disabled) return null
  const socials = ctx.org?.socials && typeof ctx.org.socials === 'object' ? Object.values(ctx.org.socials) : []
  return (
    <SeoScripts
      items={[
        organizationJsonLd({
          name: ctx.org?.name,
          url: ctx.base,
          description: ctx.org?.about || ctx.org?.description,
          logo: ctx.orgRef.logo,
          image: ctx.defaultImage,
          sameAs: socials.filter((v): v is string => typeof v === 'string'),
          type: ctx.seo.organization_type,
        }),
        websiteJsonLd({ name: ctx.org?.name, url: ctx.base, inLanguage: ctx.lang }),
      ]}
    />
  )
}
