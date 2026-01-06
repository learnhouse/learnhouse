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
import { SquareLibrary } from 'lucide-react'

interface CollectionsClientProps {
  collections: any[]
  orgslug: string
  org_id: number
}

const CollectionsClient = ({ collections, orgslug, org_id }: CollectionsClientProps) => {
  const { t } = useTranslation()

  return (
    <GeneralWrapperStyled>
      <div className="flex flex-col space-y-2 mb-6">
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
            <div key={collection.collection_uuid} className="">
              <CollectionThumbnail
                collection={collection}
                orgslug={orgslug}
                org_id={org_id}
              />
            </div>
          ))}
          {collections.length === 0 && (
            <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
              <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                <SquareLibrary className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
              </div>
              <h1 className="text-xl font-bold text-gray-600 mb-2">
                {t('collections.no_collections')}
              </h1>
              <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                <ContentPlaceHolderIfUserIsNotAdmin
                  text={t('collections.create_collections_placeholder')}
                />
              </p>
              <div className="flex justify-center">
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
          )}
        </div>
      </div>
    </GeneralWrapperStyled>
  )
}

export default CollectionsClient
