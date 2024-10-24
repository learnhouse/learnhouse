'use client'
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse'
import Modal from '@components/StyledElements/Modal/Modal'
import React from 'react'
import { useSearchParams } from 'next/navigation'
import GeneralWrapperStyled from '@components/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/StyledElements/Titles/TypeOfContentTitle'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import NewCourseButton from '@components/StyledElements/Buttons/NewCourseButton'
import useAdminStatus from '@components/Hooks/useAdminStatus'

interface CourseProps {
  orgslug: string
  courses: any
  org_id: string
}

function Courses(props: CourseProps) {
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
            <TypeOfContentTitle title="Courses" type="cou" />
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

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {courses.map((course: any) => (
              <div key={course.course_uuid} className="p-3">
                <CourseThumbnail course={course} orgslug={orgslug} />
              </div>
            ))}
            {courses.length === 0 && (
              <div className="col-span-full flex justify-center items-center py-8">
                <div className="text-center">
                  <div className="mb-4">
                    <svg
                      width="50"
                      height="50"
                      viewBox="0 0 295 295"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="mx-auto"
                    >
                      {/* ... SVG content ... */}
                    </svg>
                  </div>
                  <h1 className="text-xl font-bold text-gray-600 mb-2">
                    No courses yet
                  </h1>
                  <p className="text-md text-gray-400">
                    {isUserAdmin ? (
                      "Create a course to add content"
                    ) : (
                      "No courses available yet"
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
      </GeneralWrapperStyled>
    </div>
  )
}

export default Courses
