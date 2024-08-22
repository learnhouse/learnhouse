import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import TypeOfContentTitle from '@components/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/StyledElements/Wrappers/GeneralWrapper'
import { getUriWithOrg } from '@services/config/config'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import Link from 'next/link'
import CollectionThumbnail from '@components/Objects/Thumbnails/CollectionThumbnail'
import NewCollectionButton from '@components/StyledElements/Buttons/NewCollectionButton'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/ContentPlaceHolder'
import { nextAuthOptions } from 'app/auth/options'
import { getServerSession } from 'next-auth'
import { getOrgCollections } from '@services/courses/collections'
import { cookies } from 'next/headers'


type MetadataProps = {
  params: { orgslug: string; courseid: string }
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
    title: `Collections — ${org.name}`,
    description: `Collections of courses from ${org.name}`,
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
      title: `Collections — ${org.name}`,
      description: `Collections of courses from ${org.name}`,
      type: 'website',
    },
  }
}

const CollectionsPage = async (params: any) => {
  const cookieStore = cookies()
  const session = await getServerSession(nextAuthOptions())
  const access_token = session?.tokens?.access_token
  const orgslug = params.params.orgslug
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const org_id = org.id
  const collections = await getOrgCollections(
    org_id,
    access_token ? access_token : null,
    { revalidate: 0, tags: ['collections'] }
  )

  return (
    <GeneralWrapperStyled>
      <div className="flex justify-between">
        <TypeOfContentTitle title="Collections" type="col" />
        <AuthenticatedClientElement
          ressourceType="collections"
          action="create"
          checkMethod="roles"
          orgId={org_id}
        >
          <Link
            className="flex justify-center"
            href={getUriWithOrg(orgslug, '/collections/new',cookies)}
          >
            <NewCollectionButton />
          </Link>
        </AuthenticatedClientElement>
      </div>
      <div className="home_collections flex flex-wrap">
        {collections.map((collection: any) => (
          <div
            className="flex flex-col py-1 px-3"
            key={collection.collection_uuid}
          >
            <CollectionThumbnail
              collection={collection}
              orgslug={orgslug}
              org_id={org_id}
            />
          </div>
        ))}
        {collections.length == 0 && (
          <div className="flex mx-auto h-[400px]">
            <div className="flex flex-col justify-center text-center items-center space-y-5">
              <div className="mx-auto">
                <svg
                  width="120"
                  height="120"
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
                <h1 className="text-3xl font-bold text-gray-600">
                  No collections yet
                </h1>
                <p className="text-lg text-gray-400">
                  <ContentPlaceHolderIfUserIsNotAdmin
                    text="Create a collection to add content"
                  />
                </p>
              </div>
              <AuthenticatedClientElement
                checkMethod="roles"
                ressourceType="collections"
                action="create"
                orgId={org_id}
              >
                <Link href={getUriWithOrg(orgslug, '/collections/new',cookies)}>
                  <NewCollectionButton />
                </Link>
              </AuthenticatedClientElement>
            </div>
          </div>
        )}
      </div>
    </GeneralWrapperStyled>
  )
}

export default CollectionsPage
