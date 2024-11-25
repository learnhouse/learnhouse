'use client'

import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR from 'swr'
import { getOwnedCourses } from '@services/payments/payments'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { BookOpen, Package2 } from 'lucide-react'

function OwnedCoursesPage() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: ownedCourses, error, isLoading } = useSWR(
    org ? [`/payments/${org.id}/courses/owned`, access_token] : null,
    ([url, token]) => getOwnedCourses(org.id, token)
  )

  if (isLoading) return <PageLoading />
  if (error) return <div>Error loading owned courses</div>

  return (
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10 pt-5 ">
      <div className="flex flex-col bg-white nice-shadow px-5 py-3 rounded-md mb-6">
        <div className="flex items-center gap-4">
          <Package2 className="w-8 h-8 text-gray-800" />
          <div className="flex flex-col -space-y-1">
            <h1 className="font-bold text-xl text-gray-800">My Courses</h1>
            <h2 className="text-gray-500 text-md">Courses you have purchased or subscribed to</h2>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 w-full">
        {ownedCourses?.map((course: any) => (
          <div key={course.course_uuid} className="p-3">
            <CourseThumbnail course={course} orgslug={org.slug} />
          </div>
        ))}

        {(!ownedCourses || ownedCourses.length === 0) && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <div className="mb-4">
                <BookOpen className="w-12 h-12 mx-auto text-gray-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-600 mb-2">
                No purchased courses
              </h2>
              <p className="text-md text-gray-400">
                You haven't purchased any courses yet
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default OwnedCoursesPage
