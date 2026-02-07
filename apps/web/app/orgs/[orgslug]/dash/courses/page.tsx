import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import React from 'react'
import CoursesHome from './client'
import { getServerSession } from '@/lib/auth/server'
import { getOrgCourses } from '@services/courses/courses'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
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
  const orgslug = (await params.params).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  let courses: any[] = []
  try {
    courses = await getOrgCourses(
      orgslug,
      { revalidate: 0, tags: ['courses'] },
      access_token ?? undefined,
      true // include_unpublished for dashboard
    )
  } catch (error: any) {
    // If feature is disabled (403), pass empty courses array
    // The client component will show the feature disabled view
    if (error?.status === 403) {
      courses = []
    } else {
      throw error
    }
  }

  return <CoursesHome org_id={org.id} orgslug={orgslug} courses={courses} />
}

export default CoursesPage
