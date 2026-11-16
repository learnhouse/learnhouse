import { SeoScripts } from '@components/SEO/SeoScripts'
import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getCourseMetadata } from '@services/courses/courses'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, learningResourceJsonLd } from '@/lib/seo/jsonld'
import { prosemirrorText } from '@/lib/seo/meta'
import { courseLanguageSeo } from '@/lib/seo/alternates'
import { parseLangParam } from '@/lib/contentLanguage'

const RESOURCE_TYPE: Record<string, string> = {
  TYPE_VIDEO: 'Video',
  TYPE_DOCUMENT: 'Document',
  TYPE_DYNAMIC: 'Lesson',
  TYPE_ASSIGNMENT: 'Assignment',
  TYPE_SCORM: 'Interactive',
  TYPE_PLAY: 'Interactive',
}

/** Lesson structured data: LearningResource part of the course, breadcrumbs. */
export default async function ActivitySeo({
  params,
  searchParams,
}: {
  params: Promise<{ orgslug: string; courseuuid: string; activityid: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { orgslug, courseuuid, activityid } = await params
  // `?lang=fr`: the French version of the lesson when it is published.
  const requestedLang = parseLangParam((await searchParams)?.lang)
  if (activityid === 'end') return null
  const [ctx, resolved] = await Promise.all([getSeoContext(orgslug), resolvePublicKey(orgslug, 'course', courseuuid)])
  if (!resolved || resolved.restricted || ctx.seo.indexing_disabled) return null
  // Anonymous view only: lessons a signed-out visitor can't open aren't indexed.
  const [course, activity] = await Promise.all([
    getCourseMetadata(resolved.bare_uuid, null, null, { slim: true, lang: requestedLang ?? undefined }).catch(() => null),
    getActivityWithAuthHeader(activityid, null, null, requestedLang ?? undefined).catch(() => null),
  ])
  if (!course?.public || !course?.published || !activity?.activity_uuid) return null
  if (course.seo?.enable_jsonld === false || course.seo?.robots_noindex) return null

  const langInput = {
    requested: requestedLang,
    defaultLocale: course.default_locale || ctx.lang,
    available: course.available_locales,
  }
  const courseLang = courseLanguageSeo({ ...langInput, baseUrl: await ctx.url(`/course/${resolved.canonical_key}`), servedByApi: course.locale })
  const lessonLang = courseLanguageSeo({
    ...langInput,
    baseUrl: await ctx.url(`/course/${resolved.canonical_key}/activity/${activityid}`),
    servedByApi: activity.translation_fallback ? null : activity.locale || course.locale,
  })
  const courseUrl = courseLang.canonical
  const url = lessonLang.canonical
  return (
    <SeoScripts
      items={[
        learningResourceJsonLd({
          name: activity.name,
          url,
          description: prosemirrorText(activity.content, 300),
          courseName: course.name,
          courseUrl,
          type: RESOURCE_TYPE[activity.activity_type],
          dateModified: activity.update_date,
          inLanguage: lessonLang.translation || (lessonLang.languages ? lessonLang.locale : course.seo?.in_language || ctx.lang),
        }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Courses', url: await ctx.url('/courses') },
          { name: course.name, url: courseUrl },
          { name: activity.name, url },
        ]),
      ]}
    />
  )
}
