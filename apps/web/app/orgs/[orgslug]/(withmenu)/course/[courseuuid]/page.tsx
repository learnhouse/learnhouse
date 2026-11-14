import React from 'react'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CourseClient from './course'
import { getCourseMetadata } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolveForPage } from '@/lib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import { parseLearnings } from '@/lib/seo/meta'
import { courseLanguageSeo } from '@/lib/seo/alternates'
import { parseLangParam } from '@/lib/contentLanguage'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseuuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  // `?lang=fr` names one language version (hreflang targets). Only the URL
  // decides it here, never cookies or headers, so crawlers see stable pages.
  const requestedLang = parseLangParam((await props.searchParams)?.lang)
  // /course/{old-slug} → 308 to the current slug (uuid URLs are redirected by the proxy).
  const { uuid, resolved } = await resolveForPage(params.orgslug, 'course', params.courseuuid, (k) => `/course/${k}`)
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  let fetchStatus: number | undefined

  const [ctx, course] = await Promise.all([
    getSeoContext(params.orgslug),
    getCourseMetadata(uuid, { revalidate: 120, tags: ['courses'] }, access_token ?? undefined, {
      slim: true,
      lang: requestedLang ?? undefined,
    }).catch(
      (error: any) => {
        fetchStatus = error?.status
        return null
      },
    ),
  ])

  if (!course) {
    // Truly missing → a real 404 (not an indexable empty page). A members-only
    // course for a signed-out visitor keeps rendering its sign-in prompt.
    if (!resolved && fetchStatus === 404) notFound()
    return noindexMetadata(`${ctx.org?.name || 'Course'}`)
  }

  const key = course.slug || uuid
  const learnings = parseLearnings(course.learnings)
  // Language versions: canonical `?lang=xx` for a served published
  // translation, hreflang for every version + x-default. Nothing extra for
  // single-language courses.
  const lang = courseLanguageSeo({
    baseUrl: await ctx.url(`/course/${key}`),
    requested: requestedLang,
    servedByApi: course.locale,
    defaultLocale: course.default_locale || ctx.lang,
    available: course.available_locales,
  })
  const multilingual = !!lang.languages
  return buildResourceMetadata({
    ctx,
    name: course.name,
    description: course.description,
    canonical: lang.canonical,
    locale: lang.translation || (multilingual ? course.seo?.in_language || lang.locale : undefined),
    alternateLocales: lang.alternateLocales,
    languages: lang.languages,
    seo: course.seo,
    thumbnail: course.thumbnail_image
      ? getCourseThumbnailMediaDirectory(ctx.org?.org_uuid, course.course_uuid, course.thumbnail_image)
      : undefined,
    generatedImage: await ctx.url(`/og/course/${key}`),
    ogType: 'article',
    indexable: !!course.public && !!course.published && !resolved?.restricted,
    keywords: course.tags || learnings.slice(0, 8),
    publishedTime: course.creation_date,
    modifiedTime: course.update_date,
    tags: learnings.slice(0, 6),
  })
}

const CoursePage = async (props: MetadataProps) => {
  const { courseuuid, orgslug } = await props.params
  const { uuid } = await resolveForPage(orgslug, 'course', courseuuid, (k) => `/course/${k}`)
  return <CourseClient courseuuid={uuid} orgslug={orgslug} course={null} serverError={null} />
}

export default CoursePage
