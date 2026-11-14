import { SeoScripts } from '@components/SEO/SeoScripts'
import { getCourseMetadata } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getResourcePaywall } from '@ee/services/payments/access'
import { getServerSession } from '@/lib/auth/server'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, courseJsonLd, faqJsonLd, type OfferInput } from '@/lib/seo/jsonld'
import { parseLearnings, seoImageUrl } from '@/lib/seo/meta'
import { courseLanguageSeo } from '@/lib/seo/alternates'
import { parseLangParam } from '@/lib/contentLanguage'

/**
 * Course page structured data: Course (Google course info), breadcrumbs, FAQ.
 * Parallel-route pages get the URL's searchParams like the main page, so a
 * `?lang=fr` page describes the French version (name, description, url,
 * inLanguage) and every version lists `availableLanguage`.
 */
export default async function CourseSeo({
  params,
  searchParams,
}: {
  params: Promise<{ orgslug: string; courseuuid: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { orgslug, courseuuid } = await params
  const requestedLang = parseLangParam((await searchParams)?.lang)
  const [ctx, resolved, session] = await Promise.all([
    getSeoContext(orgslug),
    resolvePublicKey(orgslug, 'course', courseuuid),
    getServerSession(),
  ])
  // Only public, published courses get structured data (others aren't indexed).
  if (!resolved || resolved.restricted || ctx.seo.indexing_disabled) return null
  const course = await getCourseMetadata(resolved.bare_uuid, null, session?.tokens?.access_token, {
    slim: true,
    lang: requestedLang ?? undefined,
  }).catch(() => null)
  if (!course || !course.public || !course.published) return null
  const seo = course.seo || {}
  if (seo.enable_jsonld === false || seo.robots_noindex) return null

  const lang = courseLanguageSeo({
    baseUrl: await ctx.url(`/course/${resolved.canonical_key}`),
    requested: requestedLang,
    servedByApi: course.locale,
    defaultLocale: course.default_locale || ctx.lang,
    available: course.available_locales,
  })
  const url = lang.canonical
  const paywall = await getResourcePaywall(ctx.org?.id, course.course_uuid, null).catch(() => null)
  const offers: OfferInput[] = (paywall?.data?.offers || []).map((o: any) => ({
    price: Number(o.amount) || 0,
    currency: o.currency || 'USD',
    name: o.offer_name,
    recurring: o.offer_type === 'subscription',
  }))
  const isPaid = !!paywall?.data?.is_paid && offers.some((o) => o.price > 0)

  return (
    <SeoScripts
      items={[
        courseJsonLd({
          name: course.name,
          description: seo.description || course.description,
          url,
          image:
            seoImageUrl(ctx.org?.org_uuid, seo.og_image) ||
            (course.thumbnail_image ? getCourseThumbnailMediaDirectory(ctx.org?.org_uuid, course.course_uuid, course.thumbnail_image) : undefined) ||
            (await ctx.url(`/og/course/${resolved.canonical_key}`)),
          org: ctx.orgRef,
          authors: (course.authors || [])
            .filter((a: any) => a.authorship_status === 'ACTIVE' || !a.authorship_status)
            .map((a: any) => ({ name: [a.user?.first_name, a.user?.last_name].filter(Boolean).join(' ') || a.user?.username }))
            .filter((a: any) => a.name),
          datePublished: course.creation_date,
          dateModified: course.update_date,
          inLanguage: lang.translation || (lang.languages ? seo.in_language || lang.locale : seo.in_language || ctx.lang),
          availableLanguage: lang.locales,
          educationalLevel: seo.educational_level,
          teaches: parseLearnings(course.learnings),
          keywords: seo.keywords || course.tags,
          about: course.about,
          syllabus: (course.chapters || []).map((ch: any) => ({ name: ch.name, description: ch.description })),
          workloadMinutes: seo.workload_minutes,
          prerequisites: seo.prerequisites,
          audience: seo.audience,
          offers: isPaid ? offers : undefined,
          isFree: !isPaid,
        }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Courses', url: await ctx.url('/courses') },
          { name: course.name, url },
        ]),
        faqJsonLd(seo.faq || []),
      ]}
    />
  )
}
