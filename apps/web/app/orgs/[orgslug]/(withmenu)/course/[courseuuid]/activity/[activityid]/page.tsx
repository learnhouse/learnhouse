import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getCourseMetadata } from '@services/courses/courses'
import ActivityClient from './activity'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getCourseThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { getOrgSeoConfig } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import { fallbackRobots, ssrMetadataFetch } from '@services/utils/ts/ssrMetadata'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseuuid: string; activityid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token || null

  // Every fetch is guarded, and every rejection is kept rather than discarded.
  // A private or unpublished course answers 403 ("Resource is not public or not
  // published") for an anonymous visitor: a normal authorization outcome, not a
  // server fault — unguarded it failed the whole render and paged Sentry from
  // SSR on every such visit. A 5xx is the opposite: it IS our bug, it still
  // goes to Sentry (ssrMetadataFetch does that), and it must not produce a
  // noindex — 200 + noindex is a removal signal to Googlebot, so a brief API
  // outage would de-index every public activity page.
  const ROUTE = '/orgs/[orgslug]/course/[courseuuid]/activity/[activityid]'
  const [orgFetch, courseFetch, activityFetch] = await Promise.all([
    ssrMetadataFetch(ROUTE, 'getOrganizationContextInfo', getOrganizationContextInfo(params.orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    })),
    ssrMetadataFetch(ROUTE, 'getCourseMetadata', getCourseMetadata(params.courseuuid, { revalidate: 120, tags: ['courses'] }, access_token || null, { slim: true })),
    ssrMetadataFetch(ROUTE, 'getActivityWithAuthHeader', getActivityWithAuthHeader(
      params.activityid,
      { revalidate: 120, tags: ['activities'] },
      access_token || null
    )),
  ])
  const org = orgFetch.data
  const course_meta = courseFetch.data
  const activity = activityFetch.data

  // Check if this is the course end page
  const isCourseEnd = params.activityid === 'end';

  // Nothing to describe.
  if (!course_meta || (!isCourseEnd && !activity?.name)) {
    return {
      title: org?.name ? `Course — ${org.name}` : 'LearnHouse',
      description: '',
      ...fallbackRobots(courseFetch.error, isCourseEnd ? null : activityFetch.error),
    }
  }

  const seoConfig = getOrgSeoConfig(org)
  const rawTitle = isCourseEnd ? `Congratulations — ${course_meta.name} Course` : `${activity.name} — ${course_meta.name} Course`
  const pageTitle = seoConfig.default_meta_title_suffix ? `${rawTitle}${seoConfig.default_meta_title_suffix}` : rawTitle

  const orgOgImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = course_meta?.thumbnail_image
    ? getCourseThumbnailMediaDirectory(
        org?.org_uuid,
        course_meta?.course_uuid,
        course_meta?.thumbnail_image
      )
    : orgOgImageUrl || '/empty_thumbnail.png'
  const canonical = await getServerCanonicalUrl(params.orgslug, `/course/${params.courseuuid}/activity/${params.activityid}`)

  // SEO
  return {
    title: pageTitle,
    description: course_meta?.description || seoConfig.default_meta_description || '',
    keywords: course_meta?.learnings,
    robots: {
      index: true,
      follow: true,
      nocache: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
      },
    },
    alternates: {
      canonical,
    },
    openGraph: {
      title: pageTitle,
      description: course_meta?.description || seoConfig.default_meta_description || '',
      publishedTime: course_meta?.creation_date,
      tags: course_meta?.learnings,
      images: [
        {
          url: imageUrl,
          width: 800,
          height: 600,
          alt: course_meta?.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description: course_meta?.description || seoConfig.default_meta_description || '',
      images: [imageUrl],
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

const ActivityPage = async (params: any) => {
  const activityid = (await params.params).activityid
  const courseuuid = (await params.params).courseuuid
  const orgslug = (await params.params).orgslug

  return (
    <ActivityClient
      activityid={activityid}
      courseuuid={courseuuid}
      orgslug={orgslug}
      activity={null}
      course={null}
    />
  )
}

export default ActivityPage
