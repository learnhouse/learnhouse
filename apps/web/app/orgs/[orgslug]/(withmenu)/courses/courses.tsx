'use client'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import React from 'react'
import { useSearchParams } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useTranslation } from 'react-i18next'
import { BookCopy } from 'lucide-react'

interface CourseProps {
  orgslug: string
  courses: any
  org_id: string | number
}

function Courses(props: CourseProps) {
  const { t } = useTranslation()
  const orgslug = props.orgslug
  const courses = props.courses
  const searchParams = useSearchParams()
  const isCreatingCourse = searchParams.get('new') ? true : false
  const [newCourseModal, setNewCourseModal] = React.useState(isCreatingCourse)
  const isUserAdmin = useAdminStatus() as any

  async function closeNewCourseModal() {
    setNewCourseModal(false)
  }

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        <div className="flex flex-col space-y-2 mb-2">
          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('courses.courses')} type="cou" />
            <AuthenticatedClientElement
              checkMethod="roles"
              action="create"
              ressourceType="courses"
              orgId={props.org_id}
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
                dialogTitle={t('courses.create_course')}
                dialogDescription={t('courses.create_new_course')}
                dialogTrigger={
                  <button>
                    <NewCourseButton />
                  </button>
                }
              />
            </AuthenticatedClientElement>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {courses.map((course: any) => (
              <div key={course.course_uuid} className="">
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
                  {isUserAdmin ? (
                    t('courses.create_courses_placeholder')
                  ) : (
                    t('courses.no_courses_available')
                  )}
                </p>
                {isUserAdmin && (
                  <div className="mt-4">
                    <AuthenticatedClientElement
                      action="create"
                      ressourceType="courses"
                      checkMethod="roles"
                      orgId={props.org_id}
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
                        dialogTitle={t('courses.create_course')}
                        dialogDescription={t('courses.create_new_course')}
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
            )}
          </div>
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

export default Courses
