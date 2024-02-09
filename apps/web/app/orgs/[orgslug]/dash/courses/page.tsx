import { getAccessTokenFromRefreshTokenCookie } from '@services/auth/auth'
import { getOrgCoursesWithAuthHeader } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { cookies } from 'next/headers'
import React from 'react'
import CoursesHome from './client'

type MetadataProps = {
  params: { orgslug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  // Get Org context information
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  // SEO
  return {
    title: 'Courses — ' + org.name,
    description: org.description,
    keywords: `${org.name}, ${org.description}, courses, learning, education, online learning, edu, online courses, ${org.name} courses`,
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
      title: 'Courses — ' + org.name,
      description: org.description,
      type: 'website',
    },
  }
}

async function CoursesPage(params: any) {
  const orgslug = params.params.orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const cookieStore = cookies()
  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
  const courses = await getOrgCoursesWithAuthHeader(
    orgslug,
    { revalidate: 0, tags: ['courses'] },
    access_token ? access_token : null
  )

  return <CoursesHome org_id={org.org_id} orgslug={orgslug} courses={courses} />
}

export default CoursesPage
