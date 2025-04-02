'use client'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import CourseThumbnail, {
  removeCoursePrefix,
} from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

type CourseProps = {
  orgslug: string
  courses: any
  org_id: string
}

function CoursesHome(params: CourseProps) {
  const searchParams = useSearchParams()
  const isCreatingCourse = searchParams.get('new') ? true : false
  const [newCourseModal, setNewCourseModal] = useState(isCreatingCourse)
  const orgslug = params.orgslug
  const courses = params.courses
  const isUserAdmin = useAdminStatus() as any

  async function closeNewCourseModal() {
    setNewCourseModal(false)
  }

  return (
    <div className="h-full w-full bg-[#f8f8f8] pr-10 pl-10">
      <div className="mb-6">
        <BreadCrumbs type="courses" />
        <div className="mt-4 flex flex-col items-start justify-between sm:flex-row sm:items-center">
          <h1 className="mb-4 text-3xl font-bold sm:mb-0">Courses</h1>
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
                <NewCourseButton onClick={() => setNewCourseModal(true)} />
              }
            />
          </AuthenticatedClientElement>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {courses.map((course: any) => (
          <div key={course.course_uuid}>
            <CourseThumbnail
              customLink={`/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`}
              course={course}
              orgslug={orgslug}
            />
          </div>
        ))}
        {courses.length === 0 && (
          <div className="col-span-full flex items-center justify-center py-8">
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
              <h2 className="mb-2 text-2xl font-bold text-gray-600">
                No courses yet
              </h2>
              <p className="text-lg text-gray-400">
                {isUserAdmin
                  ? 'Create a course to add content'
                  : 'No courses available yet'}
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
                        <NewCourseButton
                          onClick={() => setNewCourseModal(true)}
                        />
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
