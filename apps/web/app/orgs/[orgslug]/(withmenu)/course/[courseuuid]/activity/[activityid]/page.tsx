import { notFound, permanentRedirect } from 'next/navigation'
import { Metadata } from 'next'
import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getCourseMetadata } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import { prosemirrorText } from '@/lib/seo/meta'
import { courseLanguageSeo } from '@/lib/seo/alternates'
import { parseLangParam } from '@/lib/contentLanguage'
import ActivityClient from './activity'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseuuid: string; activityid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * The course uuid for an activity URL. Only an old course slug redirects
 * (to the current one); uuid course keys stay as they are so in-app links
 * built from uuids don't bounce, and the canonical tag points at the slug URL.
 */
async function courseKey(orgslug: string, courseKey: string, activityid: string) {
  const resolved = await resolvePublicKey(orgslug, 'course', courseKey)
  if (resolved?.match === 'redirect') {
    permanentRedirect(`/course/${resolved.canonical_key}/activity/${activityid}`)
  }
  return { uuid: resolved?.bare_uuid ?? decodeURIComponent(courseKey), resolved }
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  // `?lang=fr`: one language version of the lesson (see the course page).
  const requestedLang = parseLangParam((await props.searchParams)?.lang)
  const { uuid, resolved } = await courseKey(params.orgslug, params.courseuuid, params.activityid)
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token || null
  const isCourseEnd = params.activityid === 'end'
  let courseStatus: number | undefined

  const [ctx, course, activity] = await Promise.all([
    getSeoContext(params.orgslug),
    getCourseMetadata(uuid, { revalidate: 120, tags: ['courses'] }, access_token, { slim: true, lang: requestedLang ?? undefined }).catch((e: any) => {
      courseStatus = e?.status
      return null
    }),
    isCourseEnd
      ? Promise.resolve(null)
      : getActivityWithAuthHeader(params.activityid, { revalidate: 120, tags: ['activities'] }, access_token, requestedLang ?? undefined).catch(
          () => null,
        ),
  ])

  // A course/activity this visitor can't read (e.g. signed out on a members-only
  // course) must not throw: the client renders the sign-in prompt. Missing ones 404.
  if (!course) {
    if (!resolved && courseStatus === 404) notFound()
    return noindexMetadata(`Activity | ${ctx.org?.name || 'LearnHouse'}`)
  }
  const key = course.slug || uuid
  if (isCourseEnd) return noindexMetadata(`${course.name} | ${ctx.org?.name || ''}`)
  if (!activity?.activity_uuid) {
    if (/not found/i.test(String(activity?.detail ?? ''))) notFound()
    return noindexMetadata(`${course.name} | ${ctx.org?.name || ''}`)
  }

  const excerpt = prosemirrorText(activity.content, 400)
  const indexable =
    !!course.public && !!course.published && !resolved?.restricted && activity.published !== false && (activity.lock_type ?? 'public') === 'public'
  // An untranslated lesson (shown in the original) is the default version:
  // its canonical is the plain URL.
  const lang = courseLanguageSeo({
    baseUrl: await ctx.url(`/course/${key}/activity/${params.activityid}`),
    requested: requestedLang,
    servedByApi: activity.translation_fallback ? null : activity.locale || course.locale,
    defaultLocale: course.default_locale || ctx.lang,
    available: course.available_locales,
  })
  return buildResourceMetadata({
    ctx,
    name: `${activity.name} · ${course.name}`,
    description: excerpt || course.description,
    canonical: lang.canonical,
    locale: lang.translation || (lang.languages ? lang.locale : undefined),
    alternateLocales: lang.alternateLocales,
    languages: lang.languages,
    // The course's own robots switches apply to its lessons too.
    seo: { robots_noindex: course.seo?.robots_noindex, robots_nofollow: course.seo?.robots_nofollow, image_alt: course.seo?.image_alt },
    thumbnail: course.thumbnail_image
      ? getCourseThumbnailMediaDirectory(ctx.org?.org_uuid, course.course_uuid, course.thumbnail_image)
      : undefined,
    generatedImage: await ctx.url(`/og/course/${key}`),
    ogType: 'article',
    indexable,
    keywords: course.seo?.keywords || course.tags,
    publishedTime: activity.creation_date,
    modifiedTime: activity.update_date,
  })
}

const ActivityPage = async (props: MetadataProps) => {
  const { activityid, courseuuid, orgslug } = await props.params
  const { uuid } = await courseKey(orgslug, courseuuid, activityid)
  return <ActivityClient activityid={activityid} courseuuid={uuid} orgslug={orgslug} activity={null} course={null} />
}

export default ActivityPage
