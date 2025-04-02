import {
  useCourse,
  useCourseDispatch,
} from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import LinkToUserGroup from '@components/Objects/Modals/Dash/EditCourseAccess/LinkToUserGroup'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Globe, SquareUserRound, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

type EditCourseAccessProps = {
  orgslug: string
  course_uuid?: string
}

function EditCourseAccess(props: EditCourseAccessProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const course = useCourse() as any
  const { isLoading, courseStructure } = course as any
  const dispatchCourse = useCourseDispatch() as any

  const { data: usergroups } = useSWR(
    courseStructure
      ? `${getAPIUrl()}usergroups/resource/${courseStructure.course_uuid}`
      : null,
    (url) => swrFetcher(url, access_token)
  )
  const [isClientPublic, setIsClientPublic] = useState<boolean | undefined>(
    undefined
  )

  useEffect(() => {
    if (!isLoading && courseStructure?.public !== undefined) {
      setIsClientPublic(courseStructure.public)
    }
  }, [isLoading, courseStructure])

  useEffect(() => {
    if (
      !isLoading &&
      courseStructure?.public !== undefined &&
      isClientPublic !== undefined
    ) {
      if (isClientPublic !== courseStructure.public) {
        dispatchCourse({ type: 'setIsNotSaved' })
        const updatedCourse = {
          ...courseStructure,
          public: isClientPublic,
        }
        dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse })
      }
    }
  }, [isLoading, isClientPublic, courseStructure, dispatchCourse])

  return (
    <div>
      {courseStructure && (
        <div>
          <div className="h-6"></div>
          <div className="mx-4 rounded-xl bg-white px-4 py-4 shadow-xs sm:mx-10">
            <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-3 py-3 sm:px-5">
              <h1 className="text-lg font-bold text-gray-800 sm:text-xl">
                Access to the course
              </h1>
              <h2 className="text-xs text-gray-500 sm:text-sm">
                Choose if you want your course to be publicly available on the
                internet or only accessible to signed in users
              </h2>
            </div>
            <div className="mx-auto mb-3 flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
              <ConfirmationModal
                confirmationButtonText="Change to Public"
                confirmationMessage="Are you sure you want this course to be publicly available on the internet?"
                dialogTitle="Change to Public?"
                dialogTrigger={
                  <div className="h-[200px] w-full cursor-pointer rounded-lg bg-slate-100 transition-all hover:bg-slate-200">
                    {isClientPublic && (
                      <div className="absolute mx-3 my-3 w-fit rounded-lg bg-green-200 px-3 py-1 text-sm font-bold text-green-600">
                        Active
                      </div>
                    )}
                    <div className="flex h-full flex-col items-center justify-center space-y-1 p-2 sm:p-4">
                      <Globe className="text-slate-400" size={32} />
                      <div className="text-xl font-bold text-slate-700 sm:text-2xl">
                        Public
                      </div>
                      <div className="sm:text-md w-full text-center text-sm leading-5 tracking-tight text-gray-400 sm:w-[500px]">
                        The Course is publicly available on the internet, it is
                        indexed by search engines and can be accessed by anyone
                      </div>
                    </div>
                  </div>
                }
                functionToExecute={() => setIsClientPublic(true)}
                status="info"
              />
              <ConfirmationModal
                confirmationButtonText="Change to Users Only"
                confirmationMessage="Are you sure you want this course to be only accessible to signed in users?"
                dialogTitle="Change to Users Only?"
                dialogTrigger={
                  <div className="h-[200px] w-full cursor-pointer rounded-lg bg-slate-100 transition-all hover:bg-slate-200">
                    {!isClientPublic && (
                      <div className="absolute mx-3 my-3 w-fit rounded-lg bg-green-200 px-3 py-1 text-sm font-bold text-green-600">
                        Active
                      </div>
                    )}
                    <div className="flex h-full flex-col items-center justify-center space-y-1 p-2 sm:p-4">
                      <Users className="text-slate-400" size={32} />
                      <div className="text-xl font-bold text-slate-700 sm:text-2xl">
                        Users Only
                      </div>
                      <div className="sm:text-md w-full text-center text-sm leading-5 tracking-tight text-gray-400 sm:w-[500px]">
                        The Course is only accessible to signed in users,
                        additionally you can choose which UserGroups can access
                        this course
                      </div>
                    </div>
                  </div>
                }
                functionToExecute={() => setIsClientPublic(false)}
                status="info"
              />
            </div>
            {!isClientPublic && <UserGroupsSection usergroups={usergroups} />}
          </div>
        </div>
      )}
    </div>
  )
}

function UserGroupsSection({ usergroups }: { usergroups: any[] }) {
  const course = useCourse() as any
  const [userGroupModal, setUserGroupModal] = useState(false)
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const removeUserGroupLink = async (usergroup_id: number) => {
    try {
      const res = await unLinkResourcesToUserGroup(
        usergroup_id,
        course.courseStructure.course_uuid,
        access_token
      )
      if (res.status === 200) {
        toast.success('Successfully unlinked from usergroup')
        mutate(
          `${getAPIUrl()}usergroups/resource/${course.courseStructure.course_uuid}`
        )
      } else {
        toast.error(`Error ${res.status}: ${res.data.detail}`)
      }
    } catch (error) {
      toast.error('An error occurred while unlinking the user group.')
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-3 py-3 sm:px-5">
        <h1 className="text-lg font-bold text-gray-800 sm:text-xl">
          UserGroups
        </h1>
        <h2 className="text-xs text-gray-500 sm:text-sm">
          You can choose to give access to this course to specific groups of
          users only by linking it to a UserGroup
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-auto overflow-hidden rounded-md text-left whitespace-nowrap">
          <thead className="rounded-xl bg-gray-100 text-gray-500 uppercase">
            <tr className="font-bolder text-sm">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="mt-5 rounded-md bg-white">
            {usergroups?.map((usergroup: any) => (
              <tr
                key={usergroup.invite_code_uuid}
                className="border-b border-gray-100 text-sm"
              >
                <td className="px-4 py-3">{usergroup.name}</td>
                <td className="px-4 py-3">
                  <ConfirmationModal
                    confirmationButtonText="Delete Link"
                    confirmationMessage="Users from this UserGroup will no longer have access to this course"
                    dialogTitle="Unlink UserGroup?"
                    dialogTrigger={
                      <button className="mr-2 flex items-center space-x-2 rounded-md bg-rose-700 p-1 px-3 text-sm font-bold text-rose-100 hover:cursor-pointer">
                        <X className="h-4 w-4" />
                        <span>Delete link</span>
                      </button>
                    }
                    functionToExecute={() => removeUserGroupLink(usergroup.id)}
                    status="warning"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 mr-2 flex flex-row-reverse">
        <Modal
          isDialogOpen={userGroupModal}
          onOpenChange={() => setUserGroupModal(!userGroupModal)}
          minHeight="no-min"
          minWidth="md"
          dialogContent={
            <LinkToUserGroup setUserGroupModal={setUserGroupModal} />
          }
          dialogTitle="Link Course to a UserGroup"
          dialogDescription="Choose a UserGroup to link this course to. Users from this UserGroup will have access to this course."
          dialogTrigger={
            <button className="flex items-center space-x-2 rounded-md bg-green-700 p-1 px-3 text-xs font-bold text-green-100 hover:cursor-pointer sm:text-sm">
              <SquareUserRound className="h-3 w-3 sm:h-4 sm:w-4" />
              <span>Link to a UserGroup</span>
            </button>
          }
        />
      </div>
    </>
  )
}

export default EditCourseAccess
