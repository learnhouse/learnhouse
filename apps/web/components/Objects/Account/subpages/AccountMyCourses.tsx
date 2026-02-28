'use client'

import React from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR from 'swr'
import { getUserEnrollments } from '@services/payments/offers'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AccountMyCoursesProps {
  orgId: number
  orgslug: string
}

function AccountMyCourses({ orgId, orgslug }: AccountMyCoursesProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { t } = useTranslation()

  const { data: ownedCourses, error, isLoading } = useSWR(
    orgId && access_token ? [`/payments/${orgId}/enrollments/mine`, access_token] : null,
    ([, token]) => getUserEnrollments(orgId, token)
  )

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl nice-shadow p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl nice-shadow p-8">
        <div className="text-center text-red-500">
          {t('common.something_went_wrong')}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl nice-shadow">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">{t('account.my_courses')}</h1>
          <h2 className="text-gray-500 text-md">{t('account.purchased_courses_description')}</h2>
        </div>

        <div className="mx-5 mb-5">
          {ownedCourses?.data && ownedCourses.data.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ownedCourses.data.map((course: any) => (
                <div key={course.course_uuid}>
                  <CourseThumbnail course={course} orgslug={orgslug} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="mb-4">
                  <BookOpen className="w-12 h-12 mx-auto text-gray-400" />
                </div>
                <h2 className="text-xl font-bold text-gray-600 mb-2">
                  {t('account.no_purchased_courses')}
                </h2>
                <p className="text-md text-gray-400">
                  {t('account.purchased_courses_description')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AccountMyCourses
