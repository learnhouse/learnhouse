import React from 'react'
import CourseClient from './course'
import { getCourseMetadata, getCourseRights } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getCourseThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import { notFound } from 'next/navigation'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseuuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  // Parallelize org + course metadata fetches
  // Use revalidate: 120 to match the page component and enable Next.js fetch dedup
  const [org, courseResult] = await Promise.all([
    getOrganizationContextInfo(params.orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    }),
    getCourseMetadata(
      params.courseuuid,
      { revalidate: 120, tags: ['courses'] },
      access_token ?? undefined,
      { slim: true }
    ).catch(() => null),
  ])

  if (!courseResult) {
    return {
      title: `Course — ${org?.name || 'LearnHouse'}`,
      description: 'View this course on LearnHouse',
    }
  }
  const course_meta = courseResult

  // SEO - use custom SEO fields with fallbacks to existing fields
  const seoConfig = getOrgSeoConfig(org)
  const seo = course_meta.seo || {}
  const defaultTitle = buildPageTitle(course_meta.name, org.name, seoConfig)
  const defaultDescription = course_meta.description || seoConfig.default_meta_description || ''
  const orgOgImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const defaultImage = course_meta?.thumbnail_image
    ? getCourseThumbnailMediaDirectory(
        org?.org_uuid,
        course_meta?.course_uuid,
        course_meta?.thumbnail_image
      )
    : orgOgImageUrl || '/empty_thumbnail.png'

  // Determine robots settings
  const shouldIndex = !seo.robots_noindex
  const shouldFollow = !seo.robots_nofollow

  return {
    title: seo.title || defaultTitle,
    description: seo.description || defaultDescription,
    keywords: seo.keywords || course_meta.learnings,
    robots: {
      index: shouldIndex,
      follow: shouldFollow,
      nocache: true,
      googleBot: {
        index: shouldIndex,
        follow: shouldFollow,
        'max-image-preview': 'large',
      },
    },
    alternates: {
      canonical: seo.canonical_url || getCanonicalUrl(params.orgslug, `/course/${params.courseuuid}`),
    },
    openGraph: {
      title: seo.og_title || seo.title || defaultTitle,
      description: seo.og_description || seo.description || defaultDescription,
      images: [
        {
          url: seo.og_image || defaultImage,
          width: 800,
          height: 600,
          alt: course_meta.name,
        },
      ],
      type: 'article',
      publishedTime: course_meta.creation_date ? course_meta.creation_date : '',
      tags: course_meta.learnings ? course_meta.learnings : [],
    },
    twitter: {
      card: (seo.twitter_card as 'summary' | 'summary_large_image') || 'summary_large_image',
      title: seo.twitter_title || seo.og_title || seo.title || defaultTitle,
      description: seo.twitter_description || seo.og_description || seo.description || defaultDescription,
      images: [seo.og_image || defaultImage],
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

const CoursePage = async (params: any) => {
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  // Await params before using them
  const { courseuuid, orgslug } = await params.params

  // Fetch course metadata + org info in parallel
  let course_meta = null
  let fetchError: { status?: number } | null = null

  const [courseResult, org] = await Promise.all([
    getCourseMetadata(
      courseuuid,
      { revalidate: 120, tags: ['courses'] },
      access_token ?? undefined,
      { slim: true }
    ).catch((error: any) => {
      fetchError = { status: error?.status }
      return null
    }),
    getOrganizationContextInfo(orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    }),
  ])
  course_meta = courseResult

  // If truly not found (no auth token and no course), show 404
  if (!course_meta && !fetchError) {
    notFound()
  }

  // For anonymous visitors denied access to a non-public course, pretend it
  // doesn't exist (404) rather than showing an access-denied screen — that
  // would otherwise confirm the course's existence and leak its URL.
  if (!course_meta && fetchError && !access_token) {
    notFound()
  }

  // Build Course JSON-LD for structured data
  const courseJsonLd = course_meta ? {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course_meta.name,
    description: course_meta.description || '',
    url: getCanonicalUrl(orgslug, `/course/${courseuuid}`),
    provider: {
      '@type': 'Organization',
      name: org?.name || '',
    },
    ...(course_meta.thumbnail_image && org && {
      image: getCourseThumbnailMediaDirectory(org.org_uuid, course_meta.course_uuid, course_meta.thumbnail_image),
    }),
    ...(course_meta.learnings && {
      keywords: Array.isArray(course_meta.learnings) ? course_meta.learnings.join(', ') : course_meta.learnings,
    }),
  } : null

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(orgslug, '/') },
    { name: 'Courses', url: getCanonicalUrl(orgslug, '/courses') },
    { name: course_meta?.name || 'Course', url: getCanonicalUrl(orgslug, `/course/${courseuuid}`) },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      {courseJsonLd && <JsonLd data={courseJsonLd} />}
      <CourseClient
        courseuuid={courseuuid}
        orgslug={orgslug}
        course={course_meta}
        access_token={access_token}
        serverError={fetchError}
      />
    </>
  )
}

export default CoursePage
