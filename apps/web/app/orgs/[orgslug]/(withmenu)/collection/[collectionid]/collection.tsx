'use client'

import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getAPIUrl } from '@services/config/config'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import useSWR from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'

const CollectionClient = ({ orgslug, collectionid }: { orgslug: string; collectionid: string }) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: col, error } = useSWR(
    collectionid && access_token ? [`collections/collection_${collectionid}`, access_token] : null,
    ([, token]) => swrFetcher(`${getAPIUrl()}collections/collection_${collectionid}`, token)
  )

  if (!col) return <PageLoading />

  return (
    <GeneralWrapperStyled>
      <h2 className="text-sm font-bold text-gray-400">{t('collections.collection')}</h2>
      <h1 className="text-3xl font-bold">{col.name}</h1>
      <br />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {col.courses.map((course: any) => (
          <CourseThumbnail
            key={course.course_uuid}
            course={course}
            orgslug={orgslug}
          />
        ))}
      </div>
    </GeneralWrapperStyled>
  )
}

export default CollectionClient
