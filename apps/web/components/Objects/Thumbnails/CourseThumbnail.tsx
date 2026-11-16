'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getUriWithOrg } from '@services/config/config'
import { deleteCourseFromBackend, cloneCourse } from '@services/courses/courses'
import type { ExportStatus } from '@services/courses/transfer'
import { exportToast } from '@components/Objects/StyledElements/Toast/ExportToast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getCourseMetadata } from '@services/courses/courses'
import { ArrowRight, BookOpen, Copy, DownloadSimple, DotsThree, PencilSimpleLine, SlidersHorizontal, CheckSquare, Square, Lock } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import { prefetchRouteFull } from '@/lib/navigation/prefetchRoute'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import React from 'react'
import toast from 'react-hot-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import CourseCard from '@components/Objects/Thumbnails/CourseCard'
import { Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import { coursePath } from '@/lib/seo/paths'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { CourseLanguageBadges } from '@components/Objects/Courses/ContentLanguage/ContentLanguage'

// Admin-only; course cards are mostly seen by learners.
const ManageAccessPopover = dynamic(() => import('@components/Dashboard/Library/ManageAccessPopover'), { ssr: false })

type Course = {
  course_uuid: string
  name: string
  description: string
  thumbnail_image: string
  org_id: string | number
  update_date: string
  public?: boolean
  published?: boolean
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
  isDashboard?: boolean
  isSelected?: boolean
  onToggleSelect?: (_courseUuid: string) => void
  isPriority?: boolean
}

export const removeCoursePrefix = (course_uuid: string) => course_uuid.replace('course_', '')

function CourseThumbnail({ course, orgslug, customLink, isDashboard = false, isSelected = false, onToggleSelect, isPriority = false }: PropsType) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const router = useRouter()
  const { track } = useLHAnalytics('learner')
  const { lang: contentLang } = useContentLanguage()

  const cleanUuid = removeCoursePrefix(course.course_uuid)

  const handleCardOpen = () => {
    track(AnalyticsEvent.CourseCardOpened, {
      course_uuid: cleanUuid,
      source: isDashboard ? 'dashboard' : 'catalog',
    })
  }

  // Prefetch the course page and its meta on hover so opening it is instant.
  // The course route is client-rendered (no data in its payload), so a full
  // prefetch can't go stale. Not for dashboard cards, whose link differs.
  const handleMouseEnter = () => {
    if (!customLink && !isDashboard) prefetchRouteFull(router, getUriWithOrg(orgslug, coursePath(course)))
    // Learner cards warm the course in the content language the course page
    // will ask for; dashboard cards keep the source version.
    const lang = isDashboard ? undefined : contentLang || undefined
    queryClient.prefetchQuery({
      queryKey: queryKeys.courses.meta(cleanUuid, lang),
      queryFn: () => getCourseMetadata(cleanUuid, {}, session?.data?.tokens?.access_token, { slim: true, lang }),
      staleTime: 60_000,
    })
  }

  const handleSelectClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(course.course_uuid)
  }

  const deleteCourse = async () => {
    const toastId = toast.loading(t('courses.deleting_course'))
    try {
      await deleteCourseFromBackend(course.course_uuid, session.data?.tokens?.access_token)
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      toast.success(t('courses.course_deleted_success'))
    } catch (_error) {
      toast.error(t('courses.course_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const handleCloneCourse = async () => {
    const toastId = toast.loading(t('courses.cloning_course'))
    try {
      const result = await cloneCourse(course.course_uuid, session.data?.tokens?.access_token)
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['courses'] })
        toast.success(t('courses.course_cloned_success'))
      } else {
        toast.error(result.HTTPmessage || t('courses.course_cloned_error'))
      }
    } catch (_error) {
      toast.error(t('courses.course_cloned_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const handleExportCourse = async () => {
    const toastId = exportToast.start('single', course.name)

    try {
      const { exportCourse, downloadBlob } = await import('@services/courses/transfer')
      const blob = await exportCourse(
        course.course_uuid,
        session.data?.tokens?.access_token,
        (progress, status) => {
          exportToast.update(toastId, status as ExportStatus, progress, course.name, undefined, 'single')
        }
      )
      const timestamp = new Date().toISOString().split('T')[0]
      downloadBlob(blob, `${course.name.replace(/[^a-z0-9]/gi, '_')}-${timestamp}.zip`)
      exportToast.complete(toastId, course.name, undefined, 'single')
    } catch (error: any) {
      exportToast.error(toastId, error.message || t('courses.course_exported_error'), course.name, undefined, 'single')
    }
  }

  const courseLink = customLink ? customLink : getUriWithOrg(orgslug, coursePath(course))

  return (
    <CourseCard
      course={course}
      orgUuid={org?.org_uuid}
      href={courseLink}
      selected={isSelected}
      priority={isPriority}
      onOpen={handleCardOpen}
      onWarm={handleMouseEnter}
      badges={
        isDashboard ? (
          <Chip tone={course.published ? 'emerald' : 'neutral'}>
            {course.published ? t('courses.published') : t('courses.unpublished')}
          </Chip>
        ) : (
          // "EN · FR" when the course has published translations; nothing otherwise.
          <CourseLanguageBadges course={course} />
        )
      }
      topStart={
        isDashboard && onToggleSelect ? (
          <button
            onClick={handleSelectClick}
            aria-label={isSelected ? t('courses.deselect_course') : t('courses.select_course')}
            className="p-1.5 bg-white/90 backdrop-blur-sm rounded-lg hover:bg-white transition-all shadow-sm"
          >
            {isSelected ? <CheckSquare size={16} weight="fill" className="text-neutral-900" /> : <Square size={16} className="text-neutral-500" />}
          </button>
        ) : undefined
      }
      topEnd={
        <AdminEditOptions
          course={course}
          orgSlug={orgslug}
          deleteCourse={deleteCourse}
          cloneCourse={handleCloneCourse}
          exportCourse={handleExportCourse}
        />
      }
      footerEnd={
        <Link
          prefetch={false}
          href={courseLink}
          onClick={handleCardOpen}
          className="lh-t-link inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
        >
          {t('courses.start_learning')}
          <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
        </Link>
      }
    />
  )
}

const AdminEditOptions = ({ course, orgSlug, deleteCourse, cloneCourse, exportCourse, isDashboard = false }: {
  course: Course
  orgSlug: string
  deleteCourse: () => Promise<void>
  cloneCourse: () => Promise<void>
  exportCourse: () => Promise<void>
  isDashboard?: boolean
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  const [accessOpen, setAccessOpen] = React.useState(false)

  return (
    <AuthenticatedClientElement
      action="update"
      ressourceType="courses"
      checkMethod="roles"
      orgId={course.org_id}
    >
      <div data-dashboard={isDashboard || undefined}>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <button aria-label={t('courses.actions')} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors">
              <DotsThree size={18} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={getUriWithOrg(orgSlug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/content`)} className="flex items-center cursor-pointer">
                <PencilSimpleLine className="me-2 h-4 w-4" /> {t('courses.edit_content')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={getUriWithOrg(orgSlug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`)} className="flex items-center cursor-pointer">
                <SlidersHorizontal className="me-2 h-4 w-4" /> {t('common.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('courses.clone_course')}
                confirmationMessage={t('courses.clone_course_confirm')}
                dialogTitle={t('courses.clone_course_title', { name: course.name })}
                dialogTrigger={
                  <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors">
                    <Copy className="me-2 h-4 w-4" /> {t('courses.clone_course')}
                  </button>
                }
                functionToExecute={cloneCourse}
                status="info"
              />
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <button
                onClick={exportCourse}
                className="w-full text-start flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
              >
                <DownloadSimple className="me-2 h-4 w-4" /> {t('courses.export_course')}
              </button>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <button
                onClick={() => setAccessOpen(true)}
                className="w-full text-start flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
              >
                <Lock className="me-2 h-4 w-4" /> {t('library.manage_access')}
              </button>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('courses.delete_course')}
                confirmationMessage={t('courses.delete_course_confirm')}
                dialogTitle={t('courses.delete_course_title', { name: course.name })}
                dialogTrigger={
                  <button className="w-full text-start flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <BookOpen className="me-2 h-4 w-4" /> {t('courses.delete_course')}
                  </button>
                }
                functionToExecute={deleteCourse}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Modal
          isDialogOpen={accessOpen}
          onOpenChange={setAccessOpen}
          minHeight="no-min"
          minWidth="md"
          dialogTitle={t('library.manage_access')}
          dialogContent={
            <ManageAccessPopover
              resource_uuid={course.course_uuid}
              resourceType="courses"
              orgslug={orgSlug}
            />
          }
        />
      </div>
    </AuthenticatedClientElement>
  )
}

export default CourseThumbnail
