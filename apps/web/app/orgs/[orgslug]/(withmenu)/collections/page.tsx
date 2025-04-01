import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import NewCollectionButton from '@components/Objects/StyledElements/Buttons/NewCollectionButton'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import CollectionThumbnail from '@components/Objects/Thumbnails/CollectionThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { getUriWithOrg } from '@services/config/config'
import { getOrgCollections } from '@services/courses/collections'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { nextAuthOptions } from 'app/auth/options'
import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Link from 'next/link'

type MetadataProps = {
  params: Promise<{ orgslug: string; courseid: string }>
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

const CollectionsPage = async (params: any) => {
  const session = await getServerSession(nextAuthOptions)
  const access_token = session?.tokens?.access_token
  const orgslug = (await params.params).orgslug
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
      <div className="mb-8 flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <TypeOfContentTitle title="Collections" type="col" />
          <AuthenticatedClientElement
            ressourceType="collections"
            action="create"
            checkMethod="roles"
            orgId={org_id}
          >
            <Link href={getUriWithOrg(orgslug, '/collections/new')}>
              <NewCollectionButton />
            </Link>
          </AuthenticatedClientElement>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {collections.map((collection: any) => (
            <div key={collection.collection_uuid} className="p-3">
              <CollectionThumbnail
                collection={collection}
                orgslug={orgslug}
                org_id={org_id}
              />
            </div>
          ))}
          {collections.length === 0 && (
            <div className="col-span-full flex items-center justify-center py-8">
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
                <h1 className="mb-2 text-xl font-bold text-gray-600">
                  No collections yet
                </h1>
                <p className="text-md text-gray-400">
                  <ContentPlaceHolderIfUserIsNotAdmin text="Create a collection to add content" />
                </p>
                <div className="mt-4 flex justify-center">
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
              </div>
            </div>
          )}
        </div>
      </div>
    </GeneralWrapperStyled>
  )
}

export default CollectionsPage
