import React from 'react'
import CourseClient from './course'
import { getCourseMetadata } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getCourseThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'

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
      canonical: seo.canonical_url || (await getServerCanonicalUrl(params.orgslug, `/course/${params.courseuuid}`)),
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
  const { courseuuid, orgslug } = await params.params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  let courseData = null
  let serverError = null
  try {
    courseData = await getCourseMetadata(
      courseuuid,
      { revalidate: 120, tags: ['courses'] },
      access_token ?? undefined,
      { slim: true }
    )
  } catch (err: any) {
    serverError = { status: err?.status || 500, message: err?.message }
  }

  return (
    <CourseClient
      courseuuid={courseuuid}
      orgslug={orgslug}
      course={courseData}
      serverError={serverError}
    />
  )
}

export default CoursePage
