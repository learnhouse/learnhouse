'use client'

import React from 'react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { BookCopy, LogIn } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'

interface LandingClassicProps {
  courses: any[]
  orgslug: string
  org_id: string | number
}

function LandingClassic({ courses, orgslug, org_id }: LandingClassicProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const isAuthenticated = session?.status === 'authenticated'

  // Limit to 12 courses (4x3 grid) for the home page
  const displayedCourses = courses.slice(0, 12)
  const hasMoreCourses = courses.length > 12

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
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
            {displayedCourses.map((course: any) => (
              <div key={course.course_uuid} className="flex">
                <CourseThumbnail course={course} orgslug={orgslug} />
              </div>
            ))}
            {courses.length === 0 && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                  {isAuthenticated ? (
                    <BookCopy className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
                  ) : (
                    <LogIn className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
                  )}
                </div>
                <h1 className="text-xl font-bold text-gray-600 mb-2">
                  {isAuthenticated
                    ? t('courses.no_courses')
                    : t('courses.sign_in_to_see_courses', 'Log in to see your courses')}
                </h1>
                {/* Anonymous visitors only ever receive PUBLIC courses from the API,
                    so an empty list here usually means "sign in", not "empty academy". */}
                <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                  {isAuthenticated ? (
                    <ContentPlaceHolderIfUserIsNotAdmin text={t('courses.create_courses_placeholder')} />
                  ) : (
                    t(
                      'courses.sign_in_to_see_courses_description',
                      'Courses in this academy may only be visible once you are signed in.',
                    )
                  )}
                </p>
                {!isAuthenticated && (
                  <Link
                    href={getUriWithOrg(orgslug, '/login')}
                    className="inline-flex items-center gap-2 justify-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors"
                  >
                    <LogIn size={16} />
                    {t('auth.sign_in', 'Sign in')}
                  </Link>
                )}
              </div>
            )}
          </div>
          {hasMoreCourses && (
            <div className="mt-4 text-center">
              <Link
                href={getUriWithOrg(orgslug, '/courses')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                {t('courses.view_all_courses')} ({courses.length})
              </Link>
            </div>
          )}
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

export default LandingClassic
