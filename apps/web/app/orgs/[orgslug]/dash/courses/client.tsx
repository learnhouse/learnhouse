'use client'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import CourseThumbnail, { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useSearchParams } from 'next/navigation'
import React from 'react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { BookOpen } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

type CourseProps = {
  orgslug: string
  courses: any
  org_id: string | number
}

function CoursesHome(params: CourseProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const isCreatingCourse = searchParams.get('new') ? true : false
  const [newCourseModal, setNewCourseModal] = React.useState(isCreatingCourse)
  const orgslug = params.orgslug
  const courses = params.courses
  const isUserAdmin = useAdminStatus() as any
  const org = useOrg() as any

  async function closeNewCourseModal() {
    setNewCourseModal(false)
  }

  return (
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="mb-6">
        <BreadCrumbs type="courses" />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-3xl font-bold mb-4 sm:mb-0">{t('dashboard.courses.title')}</h1>
            <Link
              href={getUriWithOrg(org?.slug, '/dash/documentation/rights')}
              className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 font text-xs font-bold text-white drop-shadow-lg flex space-x-2 items-center"
            >
              < BookOpen className="w-4 h-4" />
              <span>{t('dashboard.courses.rights_guide')}</span>
            </Link>
          </div>
          <AuthenticatedClientElement
            checkMethod="roles"
            action="create"
            ressourceType="courses"
            orgId={params.org_id}
          >
            <Modal
              isDialogOpen={newCourseModal}
              onOpenChange={setNewCourseModal}
              minHeight="md"
              dialogContent={
                <CreateCourseModal
                  closeModal={closeNewCourseModal}
                  orgslug={orgslug}
                />
              }
              dialogTitle={t('dashboard.courses.create_course')}
              dialogDescription={t('dashboard.courses.create_new_course')}
              dialogTrigger={
                <button>
                  <NewCourseButton />
                </button>
              }
            />
          </AuthenticatedClientElement>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {courses.map((course: any) => (
          <div key={course.course_uuid}>
            <CourseThumbnail customLink={`/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`} course={course} orgslug={orgslug} />
          </div>
        ))}
        {courses.length === 0 && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <div className="mb-4">
                <svg
                  width="120"
                  height="120"
                  viewBox="0 0 295 295"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="mx-auto"
                >
                  {/* ... SVG content ... */}
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-600 mb-2">
                {t('dashboard.courses.no_courses')}
              </h2>
              <p className="text-lg text-gray-400">
                {isUserAdmin ? (
                  t('dashboard.courses.create_course_placeholder')
                ) : (
                  t('dashboard.courses.no_courses_available')
                )}
              </p>
              {isUserAdmin && (
                <div className="mt-6">
                  <AuthenticatedClientElement
                    action="create"
                    ressourceType="courses"
                    checkMethod="roles"
                    orgId={params.org_id}
                  >
                    <Modal
                      isDialogOpen={newCourseModal}
                      onOpenChange={setNewCourseModal}
                      minHeight="md"
                      dialogContent={
                        <CreateCourseModal
                          closeModal={closeNewCourseModal}
                          orgslug={orgslug}
                        />
                      }
                      dialogTitle={t('dashboard.courses.create_course')}
                      dialogDescription={t('dashboard.courses.create_new_course')}
                      dialogTrigger={
                        <button>
                          <NewCourseButton />
                        </button>
                      }
                    />
                  </AuthenticatedClientElement>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default CoursesHome
