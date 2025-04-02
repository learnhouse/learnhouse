'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { getUriWithOrg } from '@services/config/config'
import { deleteCourseFromBackend } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { BookMinus, FilePenLine, MoreVertical, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import toast from 'react-hot-toast'

type Course = {
  course_uuid: string
  name: string
  description: string
  thumbnail_image: string
  org_id: string
}

type PropsType = {
  course: Course
  orgslug: string
  customLink?: string
}

export const removeCoursePrefix = (course_uuid: string) =>
  course_uuid.replace('course_', '')

function CourseThumbnail({ course, orgslug, customLink }: PropsType) {
  const router = useRouter()
  const org = useOrg() as any
  const session = useLHSession() as any

  const deleteCourse = async () => {
    const toastId = toast.loading('Deleting course...')
    try {
      await deleteCourseFromBackend(
        course.course_uuid,
        session.data?.tokens?.access_token
      )
      await revalidateTags(['courses'], orgslug)
      toast.success('Course deleted successfully')
      router.refresh()
    } catch (error) {
      toast.error('Failed to delete course')
    } finally {
      toast.dismiss(toastId)
    }
  }

  const thumbnailImage = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(
        org?.org_uuid,
        course.course_uuid,
        course.thumbnail_image
      )
    : '/empty_thumbnail.png'

  return (
    <div className="relative">
      <AdminEditOptions
        course={course}
        orgSlug={orgslug}
        deleteCourse={deleteCourse}
      />
      <Link
        prefetch
        href={
          customLink
            ? customLink
            : getUriWithOrg(
                orgslug,
                `/course/${removeCoursePrefix(course.course_uuid)}`
              )
        }
      >
        <div
          className="inset-0 aspect-video w-full rounded-xl bg-cover bg-center shadow-xl ring-1 ring-black/10 ring-inset"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
      </Link>
      <div className="flex w-full flex-col space-y-2 pt-3">
        <h2 className="line-clamp-2 text-lg leading-tight font-bold text-gray-800 capitalize">
          {course.name}
        </h2>
        <p className="line-clamp-3 text-sm leading-normal text-gray-700">
          {course.description}
        </p>
      </div>
    </div>
  )
}

const AdminEditOptions = ({
  course,
  orgSlug,
  deleteCourse,
}: {
  course: Course
  orgSlug: string
  deleteCourse: () => Promise<void>
}) => {
  return (
    <AuthenticatedClientElement
      action="update"
      ressourceType="courses"
      checkMethod="roles"
      orgId={course.org_id}
    >
      <div className="absolute top-2 right-2 z-20">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full bg-white p-1 shadow-md transition-colors hover:bg-gray-100">
              <MoreVertical size={20} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link
                prefetch
                href={getUriWithOrg(
                  orgSlug,
                  `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/content`
                )}
              >
                <FilePenLine className="mr-2 h-4 w-4" /> Edit Content
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                prefetch
                href={getUriWithOrg(
                  orgSlug,
                  `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`
                )}
              >
                <Settings2 className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText="Delete Course"
                confirmationMessage="Are you sure you want to delete this course?"
                dialogTitle={`Delete ${course.name}?`}
                dialogTrigger={
                  <button className="flex w-full items-center rounded-md bg-rose-500/10 px-2 py-1 text-left text-sm text-red-600 transition-colors hover:bg-rose-500/20">
                    <BookMinus className="mr-4 h-4 w-4" /> Delete Course
                  </button>
                }
                functionToExecute={deleteCourse}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </AuthenticatedClientElement>
  )
}

export default CourseThumbnail
