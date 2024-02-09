export const dynamic = 'force-dynamic'
import { Metadata } from 'next'
import { getUriWithOrg } from '@services/config/config'
import { getOrgCoursesWithAuthHeader } from '@services/courses/courses'
import Link from 'next/link'
import { getOrgCollectionsWithAuthHeader } from '@services/courses/collections'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { cookies } from 'next/headers'
import GeneralWrapperStyled from '@components/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/StyledElements/Titles/TypeOfContentTitle'
import { getAccessTokenFromRefreshTokenCookie } from '@services/auth/auth'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import CollectionThumbnail from '@components/Objects/Thumbnails/CollectionThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/StyledElements/Buttons/NewCourseButton'
import NewCollectionButton from '@components/StyledElements/Buttons/NewCollectionButton'

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
    },
  }
}

const OrgHomePage = async (params: any) => {
  const orgslug = params.params.orgslug
  const cookieStore = cookies()

  const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
  const courses = await getOrgCoursesWithAuthHeader(
    orgslug,
    { revalidate: 0, tags: ['courses'] },
    access_token ? access_token : null
  )
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const org_id = org.id
  const collections = await getOrgCollectionsWithAuthHeader(
    org.id,
    access_token ? access_token : null,
    { revalidate: 0, tags: ['courses'] }
  )

  return (
    <div>
      <GeneralWrapperStyled>
        {/* Collections */}
        <div className="flex items-center ">
          <div className="flex grow">
            <TypeOfContentTitle title="Collections" type="col" />
          </div>
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
        <div className="home_collections flex flex-wrap">
          {collections.map((collection: any) => (
            <div
              className="flex flex-col py-3 px-3"
              key={collection.collection_id}
            >
              <CollectionThumbnail
                collection={collection}
                orgslug={orgslug}
                org_id={org.org_id}
              />
            </div>
          ))}
          {collections.length == 0 && (
            <div className="flex mx-auto h-[100px]">
              <div className="flex flex-col justify-center text-center items-center space-y-3">
                <div className="flex flex-col space-y-3">
                  <div className="mx-auto">
                    <svg
                      width="50"
                      height="50"
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
                  <div className="space-y-0">
                    <h1 className="text-xl font-bold text-gray-600">
                      No collections yet
                    </h1>
                    <p className="text-md text-gray-400">
                      Create a collection to group courses together
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Courses */}
        <div className="h-5"></div>
        <div className="flex items-center ">
          <div className="flex grow">
            <TypeOfContentTitle title="Courses" type="cou" />
          </div>
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
        <div className="home_courses flex flex-wrap">
          {courses.map((course: any) => (
            <div className="py-3 px-3" key={course.course_uuid}>
              <CourseThumbnail course={course} orgslug={orgslug} />
            </div>
          ))}
          {courses.length == 0 && (
            <div className="flex mx-auto h-[300px]">
              <div className="flex flex-col justify-center text-center items-center space-y-3">
                <div className="flex flex-col space-y-3">
                  <div className="mx-auto">
                    <svg
                      width="50"
                      height="50"
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
                  <div className="space-y-0">
                    <h1 className="text-xl font-bold text-gray-600">
                      No courses yet
                    </h1>
                    <p className="text-md text-gray-400">
                      Create a course to add content
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

export default OrgHomePage
