import { getOrgCourses } from '@services/courses/courses'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { nextAuthOptions } from 'app/auth/options'
import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Courses from './courses'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(
  props: MetadataProps
): Promise<Metadata> {
  const params = await props.params
  // Get Org context information
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
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
      images: [
        {
          url: getOrgThumbnailMediaDirectory(
            org?.org_uuid,
            org?.thumbnail_image
          ),
          width: 800,
          height: 600,
          alt: org.name,
        },
      ],
    },
  }
}

const CoursesPage = async (params: any) => {
  const orgslug = (await params.params).orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const session = await getServerSession(nextAuthOptions)
  const access_token = session?.tokens?.access_token

  const courses = await getOrgCourses(
    orgslug,
    { revalidate: 0, tags: ['courses'] },
    access_token ? access_token : null
  )

  return (
    <div>
      <Courses org_id={org.org_id} orgslug={orgslug} courses={courses} />
    </div>
  )
}

export default CoursesPage
