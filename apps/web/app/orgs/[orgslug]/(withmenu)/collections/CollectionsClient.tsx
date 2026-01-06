'use client'

import React from 'react'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getUriWithOrg } from '@services/config/config'
import Link from 'next/link'
import CollectionThumbnail from '@components/Objects/Thumbnails/CollectionThumbnail'
import NewCollectionButton from '@components/Objects/StyledElements/Buttons/NewCollectionButton'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import { useTranslation } from 'react-i18next'

interface CollectionsClientProps {
  collections: any[]
  orgslug: string
  org_id: number
}

const CollectionsClient = ({ collections, orgslug, org_id }: CollectionsClientProps) => {
  const { t } = useTranslation()

  return (
    <GeneralWrapperStyled>
      <div className="flex flex-col space-y-4 mb-8">
        <div className="flex items-center justify-between">
          <TypeOfContentTitle title={t('collections.collections')} type="col" />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
                  {t('collections.no_collections')}
                </h1>
                <p className="text-md text-gray-400">
                  <ContentPlaceHolderIfUserIsNotAdmin
                    text={t('collections.create_collections_placeholder')}
                  />
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

export default CollectionsClient

