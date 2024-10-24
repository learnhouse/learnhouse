export const dynamic = 'force-dynamic'
import { Metadata } from 'next'
import { getUriWithOrg } from '@services/config/config'
import { getOrgCourses } from '@services/courses/courses'
import Link from 'next/link'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import GeneralWrapperStyled from '@components/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/StyledElements/Titles/TypeOfContentTitle'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import CollectionThumbnail from '@components/Objects/Thumbnails/CollectionThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/StyledElements/Buttons/NewCourseButton'
import NewCollectionButton from '@components/StyledElements/Buttons/NewCollectionButton'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/ContentPlaceHolder'
import { getOrgCollections } from '@services/courses/collections'
import { getServerSession } from 'next-auth'
import { nextAuthOptions } from 'app/auth/options'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'

type MetadataProps = {
  params: { orgslug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  // Get Org context information
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  // SEO
  return {
    title: `Home — ${org.name}`,
    description: org.description,
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
      title: `Home — ${org.name}`,
      description: org.description,
      type: 'website',
      images: [
        {
          url: getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image),
          width: 800,
          height: 600,
          alt: org.name,
        },
      ],
    },
  }
}

const OrgHomePage = async (params: any) => {
  const orgslug = params.params.orgslug
  const session = await getServerSession(nextAuthOptions)
  const access_token = session?.tokens?.access_token
  const courses = await getOrgCourses(
    orgslug,
    { revalidate: 0, tags: ['courses'] },
    access_token ? access_token : null
  )
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const org_id = org.id
  const collections = await getOrgCollections(
    org.id,
    access_token ? access_token : null,
    { revalidate: 0, tags: ['courses'] }
  )

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        {/* Collections */}
        <div className="flex flex-col space-y-4 mb-8">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title="Collections" type="col" />
            <AuthenticatedClientElement
              checkMethod="roles"
              ressourceType="collections"
              action="create"
              orgId={org_id}
            >
              <Link href={getUriWithOrg(orgslug, '/collections/new')}>
                <NewCollectionButton />
              </Link>
            </AuthenticatedClientElement>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {collections.map((collection: any) => (
              <div key={collection.collection_id} className="flex flex-col p-3">
                <CollectionThumbnail
                  collection={collection}
                  orgslug={orgslug}
                  org_id={org.org_id}
                />
              </div>
            ))}
            {collections.length === 0 && (
              <div className="col-span-full flex justify-center items-center py-8">
                <div className="text-center">
                  <div className="mb-4">
                    <svg
                      width="50"
                      height="50"
                      viewBox="0 0 295 295"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="mx-auto"
                    >
                      <rect
                        opacity="0.51"
                        x="10"
                        y="10"
                        width="275"
                        height="275"
                        rx="75"
                        stroke="#4B5564"
                        strokeOpacity="0.15"
                        strokeWidth="20"
                      />
                      <path
                        d="M135.8 200.8V130L122.2 114.6L135.8 110.4V102.8L122.2 87.4L159.8 76V200.8L174.6 218H121L135.8 200.8Z"
                        fill="#4B5564"
                        fillOpacity="0.08"
                      />
                    </svg>
                  </div>
                  <h1 className="text-xl font-bold text-gray-600 mb-2">
                    No collections yet
                  </h1>
                  <p className="text-md text-gray-400">
                    <ContentPlaceHolderIfUserIsNotAdmin
                      text="Create collections to group courses together"
                    />
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Courses */}
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title="Courses" type="cou" />
            <AuthenticatedClientElement
              ressourceType="courses"
              action="create"
              checkMethod="roles"
              orgId={org_id}
            >
              <Link href={getUriWithOrg(orgslug, '/courses?new=true')}>
                <NewCourseButton />
              </Link>
            </AuthenticatedClientElement>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {courses.map((course: any) => (
              <div key={course.course_uuid} className="p-3">
                <CourseThumbnail course={course} orgslug={orgslug} />
              </div>
            ))}
            {courses.length === 0 && (
              <div className="col-span-full flex justify-center items-center py-8">
                <div className="text-center">
                  <div className="mb-4 ">
                    <svg
                      width="50"
                      height="50"
                      className="mx-auto"
                      viewBox="0 0 295 295"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect
                        opacity="0.51"
                        x="10"
                        y="10"
                        width="275"
                        height="275"
                        rx="75"
                        stroke="#4B5564"
                        strokeOpacity="0.15"
                        strokeWidth="20"
                      />
                      <path
                        d="M135.8 200.8V130L122.2 114.6L135.8 110.4V102.8L122.2 87.4L159.8 76V200.8L174.6 218H121L135.8 200.8Z"
                        fill="#4B5564"
                        fillOpacity="0.08"
                      />
                    </svg>
                  </div>
                  <h1 className="text-xl font-bold text-gray-600 mb-2">
                    No courses yet
                  </h1>
                  <p className="text-md text-gray-400">
                    <ContentPlaceHolderIfUserIsNotAdmin text='Create courses to add content' />
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

export default OrgHomePage
