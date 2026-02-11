import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getCourseMetadata } from '@services/courses/courses'
import ActivityClient from './activity'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getCourseThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { getCanonicalUrl, getOrgSeoConfig, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import { notFound } from 'next/navigation'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseuuid: string; activityid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

type Session = {
  tokens?: {
    access_token?: string
  }
}

// Add this function at the top level to avoid duplicate fetches
async function fetchCourseMetadata(courseuuid: string, access_token: string | null | undefined) {
  return await getCourseMetadata(
    courseuuid,
    { revalidate: 60, tags: ['courses'] },
    access_token || null
  )
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token || null

  // Get Org context information
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const course_meta = await fetchCourseMetadata(params.courseuuid, access_token)
  const activity = await getActivityWithAuthHeader(
    params.activityid,
    { revalidate: 0, tags: ['activities'] },
    access_token || null
  )

  // Check if this is the course end page
  const isCourseEnd = params.activityid === 'end';
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
  const canonical = getCanonicalUrl(params.orgslug, `/course/${params.courseuuid}/activity/${params.activityid}`)

  // SEO
  return {
    title: pageTitle,
    description: course_meta.description || seoConfig.default_meta_description || '',
    keywords: course_meta.learnings,
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
      description: course_meta.description || seoConfig.default_meta_description || '',
      publishedTime: course_meta.creation_date,
      tags: course_meta.learnings,
      images: [
        {
          url: imageUrl,
          width: 800,
          height: 600,
          alt: course_meta.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description: course_meta.description || seoConfig.default_meta_description || '',
      images: [imageUrl],
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

const ActivityPage = async (params: any) => {
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token || null
  const activityid = (await params.params).activityid
  const courseuuid = (await params.params).courseuuid
  const orgslug = (await params.params).orgslug

  let course_meta
  let activity

  try {
    [course_meta, activity] = await Promise.all([
      fetchCourseMetadata(courseuuid, access_token),
      getActivityWithAuthHeader(
        activityid,
        { revalidate: 0, tags: ['activities'] },
        access_token || null
      )
    ])
  } catch (error) {
    // If course or activity not found (404) or any error, show not found
    notFound()
  }

  // If no course data returned, show not found
  if (!course_meta || !activity) {
    notFound()
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(orgslug, '/') },
    { name: 'Courses', url: getCanonicalUrl(orgslug, '/courses') },
    { name: course_meta.name, url: getCanonicalUrl(orgslug, `/course/${courseuuid}`) },
    { name: activity.name, url: getCanonicalUrl(orgslug, `/course/${courseuuid}/activity/${activityid}`) },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <ActivityClient
        activityid={activityid}
        courseuuid={courseuuid}
        orgslug={orgslug}
        activity={activity}
        course={course_meta}
      />
    </>
  )
}

export default ActivityPage
