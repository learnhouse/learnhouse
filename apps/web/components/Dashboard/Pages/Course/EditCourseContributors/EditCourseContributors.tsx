import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useCourse,
  useCourseDispatch,
} from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl } from '@services/config/config'
import { editContributor } from '@services/courses/courses'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check, ChevronDown, UserPen, Users } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

type EditCourseContributorsProps = {
  orgslug: string
  course_uuid?: string
}

type ContributorRole = 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
type ContributorStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING'

interface Contributor {
  id: string
  user_id: string
  authorship: ContributorRole
  authorship_status: ContributorStatus
  user: {
    username: string
    first_name: string
    last_name: string
    email: string
    avatar_image: string
  }
}

function EditCourseContributors(props: EditCourseContributorsProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const course = useCourse() as any
  const { isLoading, courseStructure } = course as any
  const dispatchCourse = useCourseDispatch() as any

  const { data: contributors } = useSWR<Contributor[]>(
    courseStructure
      ? `${getAPIUrl()}courses/${courseStructure.course_uuid}/contributors`
      : null,
    (url: string) => swrFetcher(url, access_token)
  )

  const [isOpenToContributors, setIsOpenToContributors] = useState<
    boolean | undefined
  >(undefined)

  useEffect(() => {
    if (!isLoading && courseStructure?.open_to_contributors !== undefined) {
      setIsOpenToContributors(courseStructure.open_to_contributors)
    }
  }, [isLoading, courseStructure])

  useEffect(() => {
    if (
      !isLoading &&
      courseStructure?.open_to_contributors !== undefined &&
      isOpenToContributors !== undefined
    ) {
      if (isOpenToContributors !== courseStructure.open_to_contributors) {
        dispatchCourse({ type: 'setIsNotSaved' })
        const updatedCourse = {
          ...courseStructure,
          open_to_contributors: isOpenToContributors,
        }
        dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse })
      }
    }
  }, [isLoading, isOpenToContributors, courseStructure, dispatchCourse])

  const updateContributor = async (
    contributorId: string,
    data: {
      authorship?: ContributorRole
      authorship_status?: ContributorStatus
    }
  ) => {
    try {
      // Find the current contributor to get their current values
      const currentContributor = contributors?.find(
        (c) => c.user_id === contributorId
      )
      if (!currentContributor) return

      // Don't allow editing if the user is a CREATOR
      if (currentContributor.authorship === 'CREATOR') {
        toast.error("Cannot modify a creator's role or status")
        return
      }

      // Always send both values in the request
      const updatedData = {
        authorship: data.authorship || currentContributor.authorship,
        authorship_status:
          data.authorship_status || currentContributor.authorship_status,
      }

      const res = await editContributor(
        courseStructure.course_uuid,
        contributorId,
        updatedData.authorship,
        updatedData.authorship_status,
        access_token
      )
      if (res.status === 200 && res.data?.status === 'success') {
        toast.success(res.data.detail || 'Successfully updated contributor')
        mutate(
          `${getAPIUrl()}courses/${courseStructure.course_uuid}/contributors`
        )
      } else {
        toast.error(
          `Error: ${res.data?.detail || 'Failed to update contributor'}`
        )
      }
    } catch (error) {
      toast.error('An error occurred while updating the contributor.')
    }
  }

  const RoleDropdown = ({ contributor }: { contributor: Contributor }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-[200px] justify-between"
          disabled={contributor.authorship === 'CREATOR'}
        >
          {contributor.authorship}
          <ChevronDown className="text-muted-foreground ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        {['CONTRIBUTOR', 'MAINTAINER', 'REPORTER'].map((role) => (
          <DropdownMenuItem
            key={role}
            onClick={() =>
              updateContributor(contributor.user_id, {
                authorship: role as ContributorRole,
              })
            }
            className="justify-between"
          >
            {role}
            {contributor.authorship === role && (
              <Check className="ml-2 h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const StatusDropdown = ({ contributor }: { contributor: Contributor }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`w-[200px] justify-between ${getStatusStyle(contributor.authorship_status)}`}
          disabled={contributor.authorship === 'CREATOR'}
        >
          {contributor.authorship_status}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        {['ACTIVE', 'INACTIVE', 'PENDING'].map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={() =>
              updateContributor(contributor.user_id, {
                authorship_status: status as ContributorStatus,
              })
            }
            className="justify-between"
          >
            {status}
            {contributor.authorship_status === status && (
              <Check className="ml-2 h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const getStatusStyle = (status: ContributorStatus) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800'
      case 'INACTIVE':
        return 'bg-gray-50 text-gray-700 hover:bg-gray-100 hover:text-gray-800'
      case 'PENDING':
        return 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 hover:text-yellow-800'
      default:
        return 'bg-gray-50 text-gray-700 hover:bg-gray-100 hover:text-gray-800'
    }
  }

  const sortContributors = (contributors: Contributor[] | undefined) => {
    if (!contributors) return []

    // Find the creator and other contributors
    const creator = contributors.find((c) => c.authorship === 'CREATOR')
    const otherContributors = contributors.filter(
      (c) => c.authorship !== 'CREATOR'
    )

    // Return array with creator at the top, followed by other contributors in their original order
    return creator ? [creator, ...otherContributors] : otherContributors
  }

  return (
    <div>
      {courseStructure && (
        <div>
          <div className="h-6"></div>
          <div className="mx-4 rounded-xl bg-white px-4 py-4 shadow-xs sm:mx-10">
            <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-3 py-3 sm:px-5">
              <h1 className="text-lg font-bold text-gray-800 sm:text-xl">
                Course Contributors
              </h1>
              <h2 className="text-xs text-gray-500 sm:text-sm">
                Choose if you want your course to be open for contributors and
                manage existing contributors
              </h2>
            </div>
            <div className="mx-auto mb-3 flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
              <ConfirmationModal
                confirmationButtonText="Open to Contributors"
                confirmationMessage="Are you sure you want to open this course to contributors?"
                dialogTitle="Open to Contributors?"
                dialogTrigger={
                  <div className="h-[200px] w-full cursor-pointer rounded-lg bg-slate-100 transition-all hover:bg-slate-200">
                    {isOpenToContributors && (
                      <div className="absolute mx-3 my-3 w-fit rounded-lg bg-green-200 px-3 py-1 text-sm font-bold text-green-600">
                        Active
                      </div>
                    )}
                    <div className="flex h-full flex-col items-center justify-center space-y-1 p-2 sm:p-4">
                      <UserPen className="text-slate-400" size={32} />
                      <div className="text-xl font-bold text-slate-700 sm:text-2xl">
                        Open to Contributors
                      </div>
                      <div className="sm:text-md w-full text-center text-sm leading-5 tracking-tight text-gray-400 sm:w-[500px]">
                        The course is open for contributors. Users can apply to
                        become contributors and help improve the course content.
                      </div>
                    </div>
                  </div>
                }
                functionToExecute={() => setIsOpenToContributors(true)}
                status="info"
              />
              <ConfirmationModal
                confirmationButtonText="Close to Contributors"
                confirmationMessage="Are you sure you want to close this course to contributors?"
                dialogTitle="Close to Contributors?"
                dialogTrigger={
                  <div className="h-[200px] w-full cursor-pointer rounded-lg bg-slate-100 transition-all hover:bg-slate-200">
                    {!isOpenToContributors && (
                      <div className="absolute mx-3 my-3 w-fit rounded-lg bg-green-200 px-3 py-1 text-sm font-bold text-green-600">
                        Active
                      </div>
                    )}
                    <div className="flex h-full flex-col items-center justify-center space-y-1 p-2 sm:p-4">
                      <Users className="text-slate-400" size={32} />
                      <div className="text-xl font-bold text-slate-700 sm:text-2xl">
                        Closed to Contributors
                      </div>
                      <div className="sm:text-md w-full text-center text-sm leading-5 tracking-tight text-gray-400 sm:w-[500px]">
                        The course is closed for contributors. Only existing
                        contributors can modify the course content.
                      </div>
                    </div>
                  </div>
                }
                functionToExecute={() => setIsOpenToContributors(false)}
                status="info"
              />
            </div>
            <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-3 py-3 sm:px-5">
              <h1 className="text-lg font-bold text-gray-800 sm:text-xl">
                Current Contributors
              </h1>
              <h2 className="text-xs text-gray-500 sm:text-sm">
                Manage the current contributors of this course
              </h2>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortContributors(contributors)?.map((contributor) => (
                    <TableRow key={contributor.id}>
                      <TableCell>
                        <UserAvatar
                          width={30}
                          border="border-2"
                          avatar_url={contributor.user.avatar_image}
                          rounded="rounded"
                          predefined_avatar={
                            contributor.user.avatar_image === ''
                              ? 'empty'
                              : undefined
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {contributor.user.first_name}{' '}
                        {contributor.user.last_name}
                      </TableCell>
                      <TableCell className="text-gray-500">
                        {contributor.user.email}
                      </TableCell>
                      <TableCell>
                        <RoleDropdown contributor={contributor} />
                      </TableCell>
                      <TableCell>
                        <StatusDropdown contributor={contributor} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EditCourseContributors
