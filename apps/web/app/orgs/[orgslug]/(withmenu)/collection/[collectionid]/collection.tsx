'use client'

import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getCollectionById } from '@services/courses/collections'

const CollectionClient = ({ orgslug, collectionid }: { orgslug: string; collectionid: string }) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const { data: col, error } = useQuery({
    queryKey: queryKeys.collections.detail(collectionid),
    queryFn: () => getCollectionById(collectionid, access_token, null),
    enabled: !!(collectionid && access_token),
    staleTime: 60_000,
  })

  const removeCoursePrefix = (courseid: string) => {
    return courseid.replace('course_', '')
  }

  if (!col) return (
    <GeneralWrapperStyled>
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
        <div className="h-8 bg-gray-200 rounded w-64 mb-6" />
        <div className="flex flex-wrap gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-[249px] h-[131px] bg-gray-200 rounded-lg" />
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
      <div className="home_courses flex flex-wrap">
        {col.courses.map((course: any) => (
          <div className="pr-8" key={course.course_uuid}>
            <Link
              href={getUriWithOrg(
                orgslug,
                '/course/' + removeCoursePrefix(course.course_uuid)
              )}
            >
              <div
                className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[131px] bg-cover"
                style={{
                  backgroundImage: `url(${course.thumbnail_image
                    ? getCourseThumbnailMediaDirectory(
                        org.org_uuid,
                        course.course_uuid,
                        course.thumbnail_image
                      )
                    : '/empty_thumbnail.png'
                  })`,
                }}
              ></div>
            </Link>
            <h2 className="font-bold text-lg w-[250px] py-2">{course.name}</h2>
          </div>
        ))}
      </div>
    </GeneralWrapperStyled>
  )
}

export default CollectionClient
