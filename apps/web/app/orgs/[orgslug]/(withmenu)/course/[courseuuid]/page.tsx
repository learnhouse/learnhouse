import React from 'react'
import CourseClient from './course'
import { getCourseMetadata } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { nextAuthOptions } from 'app/auth/options'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'

type MetadataProps = {
  params: { orgslug: string; courseuuid: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  const cookiesStore = cookies()
  const session = await getServerSession(nextAuthOptions())
  const access_token = session?.tokens?.access_token

  // Get Org context information
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const course_meta = await getCourseMetadata(
    params.courseuuid,
    { revalidate: 0, tags: ['courses'] },
    access_token ? access_token : null
  )

  // SEO
  return {
    title: course_meta.name + ` — ${org.name}`,
    description: course_meta.description,
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
    openGraph: {
      title: course_meta.name + ` — ${org.name}`,
      description: course_meta.description ? course_meta.description : '',
      images: [
        {
          url: getCourseThumbnailMediaDirectory(
            org?.org_uuid,
            course_meta?.course_uuid,
            course_meta?.thumbnail_image
          ),
          width: 800,
          height: 600,
          alt: course_meta.name,
        },
      ],
      type: 'article',
      publishedTime: course_meta.creation_date ? course_meta.creation_date : '',
      tags: course_meta.learnings ? course_meta.learnings : [],
    },
  }
}

const CoursePage = async (params: any) => {
  const cookiestore = cookies()
  const courseuuid = params.params.courseuuid
  const orgslug = params.params.orgslug
  const session = await getServerSession(nextAuthOptions(cookiestore))
  const access_token = session?.tokens?.access_token
  const course_meta = await getCourseMetadata(
    courseuuid,
    { revalidate: 0, tags: ['courses'] },
    access_token ? access_token : null
  )

  return (
    <div>
      <CourseClient
        courseuuid={courseuuid}
        orgslug={orgslug}
        course={course_meta}
      />
    </div>
  )
}

export default CoursePage
