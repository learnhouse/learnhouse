'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deleteCourseFromBackend } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { BookMinus, FilePenLine, Settings2, MoreVertical } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import toast from 'react-hot-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"

type Course = {
  course_uuid: string
  name: string
  description: string
  thumbnail_image: string
  org_id: string
  update_date: string
}

type PropsType = {
  course: Course
  orgslug: string
  customLink?: string
}

interface AdminEditOptionsProps {
  course: Course
  orgslug: string
  deleteCourse: () => Promise<void>
}

export const removeCoursePrefix = (course_uuid: string) => course_uuid.replace('course_', '')

const AdminEditOptions: React.FC<AdminEditOptionsProps> = ({ course, orgslug, deleteCourse }) => {
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
            <button className="p-1 bg-white rounded-full hover:bg-gray-100 transition-colors shadow-md">
              <MoreVertical size={20} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgslug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/content`)}>
                <FilePenLine className="mr-2 h-4 w-4" /> Edit Content
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgslug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`)}>
                <Settings2 className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText="Delete Course"
                confirmationMessage="Are you sure you want to delete this course?"
                dialogTitle={`Delete ${course.name}?`}
                dialogTrigger={
                  <button className="w-full text-left flex items-center px-2 py-1 rounded-md text-sm bg-rose-500/10 hover:bg-rose-500/20 transition-colors text-red-600">
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

const CourseThumbnailLanding: React.FC<PropsType> = ({ course, orgslug, customLink }) => {
  const router = useRouter() 
  const org = useOrg() as any
  const session = useLHSession() as any

  const deleteCourse = async () => {
    const toastId = toast.loading('Deleting course...')
    try {
      await deleteCourseFromBackend(course.course_uuid, session.data?.tokens?.access_token)
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
    ? getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)
    : '../empty_thumbnail.png'

  return (
    <div className="relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden min-w-[280px] w-full max-w-sm shrink-0 m-2">
      <AdminEditOptions
        course={course}
        orgslug={orgslug}
        deleteCourse={deleteCourse}
      />
      <Link prefetch href={customLink ? customLink : getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)}>
        <div
          className="inset-0 ring-1 ring-inset ring-black/10 rounded-t-xl w-full aspect-video bg-cover bg-center"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
      </Link>
      <div className='flex flex-col w-full p-4 space-y-3'>
        <div className="space-y-2">
          <h2 className="font-bold text-gray-800 leading-tight text-base min-h-[2.75rem] line-clamp-2">{course.name}</h2>
          <p className='text-xs text-gray-700 leading-normal min-h-[3.75rem] line-clamp-3'>{course.description}</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {course.update_date && (
            <div className="inline-flex h-5 min-w-[140px] items-center justify-center px-2 rounded-md bg-gray-100/80 border border-gray-200">
              <span className="text-[10px] font-medium text-gray-600 truncate">
                Updated {new Date(course.update_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          )}
        </div>

        <Link 
          prefetch 
          href={customLink ? customLink : getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)}
          className="inline-flex items-center justify-center w-full px-3 py-1.5 bg-black text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          Start Learning
        </Link>
      </div>
    </div>
  )
}

export default CourseThumbnailLanding
