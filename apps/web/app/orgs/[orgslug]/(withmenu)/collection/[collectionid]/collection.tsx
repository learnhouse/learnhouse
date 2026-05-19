'use client'

import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getCollectionById } from '@services/courses/collections'

const CollectionClient = ({ orgslug, collectionid }: { orgslug: string; collectionid: string }) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: col } = useQuery({
    queryKey: queryKeys.collections.detail(collectionid),
    queryFn: () => getCollectionById(collectionid, access_token, null),
    enabled: !!(collectionid && access_token),
    staleTime: 60_000,
  })

  if (!col) return (
    <GeneralWrapperStyled>
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
        <div className="h-8 bg-gray-200 rounded w-64 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-video bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    </GeneralWrapperStyled>
  )

  return (
    <GeneralWrapperStyled>
      <h2 className="text-sm font-bold text-gray-400">{t('collections.collection')}</h2>
      <h1 className="text-3xl font-bold">{col.name}</h1>
      <br />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {col.courses.map((course: any, index: number) => (
          <CourseThumbnail
            key={course.course_uuid}
            course={course}
            orgslug={orgslug}
            isPriority={index < 4}
          />
        ))}
      </div>
    </GeneralWrapperStyled>
  )
}

export default CollectionClient
