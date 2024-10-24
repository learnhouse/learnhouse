'use client'
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import CourseThumbnail, { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/StyledElements/Buttons/NewCourseButton'
import Modal from '@components/StyledElements/Modal/Modal'
import { useSearchParams } from 'next/navigation'
import React from 'react'
import useAdminStatus from '@components/Hooks/useAdminStatus'

type CourseProps = {
  orgslug: string
  courses: any
  org_id: string
}

function CoursesHome(params: CourseProps) {
  const searchParams = useSearchParams()
  const isCreatingCourse = searchParams.get('new') ? true : false
  const [newCourseModal, setNewCourseModal] = React.useState(isCreatingCourse)
  const orgslug = params.orgslug
  const courses = params.courses
  const isUserAdmin = useAdminStatus() as any

  async function closeNewCourseModal() {
    setNewCourseModal(false)
  }

  return (
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="mb-6">
        <BreadCrumbs type="courses" />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
          <h1 className="text-3xl font-bold mb-4 sm:mb-0">Courses</h1>
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
              dialogTitle="Create Course"
              dialogDescription="Create a new course"
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
                No courses yet
              </h2>
              <p className="text-lg text-gray-400">
                {isUserAdmin ? (
                  "Create a course to add content"
                ) : (
                  "No courses available yet"
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
                      dialogTitle="Create Course"
                      dialogDescription="Create a new course"
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
