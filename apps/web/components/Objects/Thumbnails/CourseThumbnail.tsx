'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deleteCourseFromBackend } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { BookMinus, FilePenLine, Settings2, MoreVertical } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import toast from 'react-hot-toast'
import UserAvatar from '@components/Objects/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { useTranslation } from 'react-i18next'

type Course = {
  course_uuid: string
  name: string
  description: string
  thumbnail_image: string
  org_id: string | number
  update_date: string
  authors?: Array<{
    user: {
      id: string
      user_uuid: string
      avatar_image: string
      first_name: string
      last_name: string
      username: string
    }
    authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
    authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
  }>
}

type PropsType = {
  course: Course
  orgslug: string
  customLink?: string
}

export const removeCoursePrefix = (course_uuid: string) => course_uuid.replace('course_', '')

function CourseThumbnail({ course, orgslug, customLink }: PropsType) {
  const { t, i18n } = useTranslation()
  const router = useRouter() 
  const org = useOrg() as any
  const session = useLHSession() as any

  const activeAuthors = course.authors?.filter(author => author.authorship_status === 'ACTIVE') || []
  const displayedAuthors = activeAuthors.slice(0, 3)
  const hasMoreAuthors = activeAuthors.length > 3
  const remainingAuthorsCount = activeAuthors.length - 3

  const deleteCourse = async () => {
    const toastId = toast.loading(t('courses.deleting_course'))
    try {
      await deleteCourseFromBackend(course.course_uuid, session.data?.tokens?.access_token)
      await revalidateTags(['courses'], orgslug)
      toast.success(t('courses.course_deleted_success'))
      router.refresh()
    } catch (error) {
      toast.error(t('courses.course_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const thumbnailImage = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)
    : '../empty_thumbnail.png'

  const courseLink = customLink ? customLink : getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)

  return (
    <div className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]">
      <AdminEditOptions
        course={course}
        orgSlug={orgslug}
        deleteCourse={deleteCourse}
      />
      
      <Link prefetch href={courseLink} className="block relative aspect-video overflow-hidden bg-gray-50">
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
      </Link>

      <div className="p-3 flex flex-col space-y-1.5">
        <div className="flex items-start justify-between">
          <Link
            href={courseLink}
            className="text-base font-bold text-gray-900 leading-tight hover:text-black transition-colors line-clamp-1"
          >
            {course.name}
          </Link>
        </div>
        
        {course.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
            {course.description}
          </p>
        )}

        <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
          <div className="flex items-center gap-2">
            {displayedAuthors.length > 0 && (
              <div className="flex -space-x-2 items-center">
                {displayedAuthors.map((author, index) => (
                  <div 
                    key={author.user.user_uuid} 
                    className="relative"
                    style={{ zIndex: displayedAuthors.length - index }}
                  >
                    <UserAvatar
                      border="border-2"
                      rounded="rounded-full"
                      avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
                      predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                      width={20}
                      showProfilePopup={true}
                      userId={author.user.id}
                    />
                  </div>
                ))}
                {hasMoreAuthors && (
                  <div className="relative z-0">
                    <div className="flex items-center justify-center w-[20px] h-[20px] text-[8px] font-bold text-gray-600 bg-gray-100 border-2 border-white rounded-full">
                      +{remainingAuthorsCount}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {course.update_date && (
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                {new Date(course.update_date).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          
          <Link
            href={courseLink}
            className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
          >
            {t('courses.start_learning')}
          </Link>
        </div>
      </div>
    </div>
  )
}

const AdminEditOptions = ({ course, orgSlug, deleteCourse }: {
  course: Course
  orgSlug: string
  deleteCourse: () => Promise<void>
}) => {
  const { t } = useTranslation()
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
            <button className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
              <MoreVertical size={18} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgSlug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/content`)} className="flex items-center cursor-pointer">
                <FilePenLine className="mr-2 h-4 w-4" /> {t('courses.edit_content')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch href={getUriWithOrg(orgSlug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`)} className="flex items-center cursor-pointer">
                <Settings2 className="mr-2 h-4 w-4" /> {t('common.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('courses.delete_course')}
                confirmationMessage={t('courses.delete_course_confirm')}
                dialogTitle={t('courses.delete_course_title', { name: course.name })}
                dialogTrigger={
                  <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <BookMinus className="mr-2 h-4 w-4" /> {t('courses.delete_course')}
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
