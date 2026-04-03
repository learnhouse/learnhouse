'use client'
import React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { SafeImage } from '@components/Objects/SafeImage'
import { BookOpen, PlusCircle, Clock } from '@phosphor-icons/react'

export default function RecentCourses() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgslug = org?.slug

  const { data: coursesData, isLoading } = useSWR(
    token && orgslug
      ? `${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/8?include_unpublished=true`
      : null,
    (url) => swrFetcher(url, token),
    { revalidateOnFocus: false }
  )

  const courses: any[] = coursesData ?? []
  const publishedCount = courses.filter((c: any) => c.published).length
  const draftCount = courses.filter((c: any) => !c.published).length

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Recent Courses
          </h3>
          {courses.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                {publishedCount} published
              </span>
              {draftCount > 0 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {draftCount} draft
                </span>
              )}
            </div>
          )}
        </div>
        <Link
          href="/dash/courses"
          className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          View All &rarr;
        </Link>
      </div>

      {isLoading ? (
        <div className="px-5 pb-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-10 h-10 bg-gray-100 rounded-lg shrink-0" />
              <div className="flex-1">
                <div className="h-3 bg-gray-100 rounded w-40 mb-1.5" />
                <div className="h-2 bg-gray-50 rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="px-5 pb-5">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="p-3 rounded-full bg-gray-100 mb-3">
              <BookOpen
                size={20}
                weight="duotone"
                className="text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-400 mb-3">No courses yet</p>
            <Link
              href="/dash/courses?new=true"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <PlusCircle size={14} weight="bold" />
              Create your first course
            </Link>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {courses.slice(0, 8).map((course: any) => {
            const courseId = course.course_uuid?.replace('course_', '')
            const thumbnail = course.thumbnail_image
              ? getCourseThumbnailMediaDirectory(
                  org.org_uuid,
                  course.course_uuid,
                  course.thumbnail_image
                )
              : null
            const updatedAt = course.update_date
              ? new Date(course.update_date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              : null

            return (
              <Link
                key={course.course_uuid}
                prefetch={false}
                href={`/dash/courses/course/${courseId}/general`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                  {thumbnail ? (
                    <SafeImage
                      src={thumbnail}
                      alt={course.name}
                      width={40}
                      height={40}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <BookOpen
                      size={16}
                      weight="duotone"
                      className="text-gray-300"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate group-hover:text-gray-900">
                    {course.name}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {updatedAt && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-400">
                        <Clock size={10} />
                        {updatedAt}
                      </span>
                    )}
                    {course.chapters_count !== undefined && (
                      <span className="text-[10px] text-gray-400">
                        {course.chapters_count} chapter
                        {course.chapters_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                    course.published
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {course.published ? 'Published' : 'Draft'}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
