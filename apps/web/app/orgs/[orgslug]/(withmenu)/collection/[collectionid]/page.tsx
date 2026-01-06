'use client'

import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { getUriWithOrg, getAPIUrl } from '@services/config/config'
import { getCollectionById } from '@services/courses/collections'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { nextAuthOptions } from 'app/auth/options'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import useSWR from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'

const CollectionPage = (props: any) => {
  const { t } = useTranslation()
  const params = React.use(props.params) as any
  const orgslug = params.orgslug
  const collectionid = params.collectionid
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const { data: col, error } = useSWR(
    collectionid && access_token ? [`collections/collection_${collectionid}`, access_token] : null,
    ([, token]) => swrFetcher(`${getAPIUrl()}collections/collection_${collectionid}`, token)
  )

  const removeCoursePrefix = (courseid: string) => {
    return courseid.replace('course_', '')
  }

  if (!col) return <PageLoading />

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
                  backgroundImage: `url(${getCourseThumbnailMediaDirectory(
                    org.org_uuid,
                    course.course_uuid,
                    course.thumbnail_image
                  )})`,
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

export default CollectionPage
