'use client'

import React from 'react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import CollectionThumbnail from '@components/Objects/Thumbnails/CollectionThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import NewCollectionButton from '@components/Objects/StyledElements/Buttons/NewCollectionButton'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { BookCopy, SquareLibrary } from 'lucide-react'

interface LandingClassicProps {
  courses: any[]
  collections: any[]
  orgslug: string
  org_id: string | number
}

function LandingClassic({ courses, collections, orgslug, org_id }: LandingClassicProps) {
  const { t } = useTranslation()

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        {/* Collections */}
        <div className="flex flex-col space-y-2 mb-6">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('collections.collections')} type="col" />
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
              <div key={collection.collection_id} className="flex flex-col">
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
                <h3 className="text-lg font-bold text-gray-600 mb-1">
                  {t('collections.no_collections')}
                </h3>
                <p className="text-sm text-gray-400 max-w-xs text-center">
                  <ContentPlaceHolderIfUserIsNotAdmin
                    text={t('collections.create_collections_placeholder')}
                  />
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Courses */}
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('courses.courses')} type="cou" />
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
              <div key={course.course_uuid} className="flex">
                <CourseThumbnail course={course} orgslug={orgslug} />
              </div>
            ))}
            {courses.length === 0 && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                  <BookCopy className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
                </div>
                <h1 className="text-xl font-bold text-gray-600 mb-2">
                  {t('courses.no_courses')}
                </h1>
                <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                  <ContentPlaceHolderIfUserIsNotAdmin text={t('courses.create_courses_placeholder')} />
                </p>
              </div>
            )}
          </div>
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

export default LandingClassic
