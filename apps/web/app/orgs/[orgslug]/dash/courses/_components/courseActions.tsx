'use client'
import React from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Book, Copy, DownloadSimple, Eye, EyeSlash, ArrowSquareOut, PencilSimpleLine, LinkSimple, Lock, DotsThree, SlidersHorizontal } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { ConfirmDialog } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { cloneCourse, deleteCourseFromBackend, updateCourse } from '@services/courses/courses'
import type { ExportStatus } from '@services/courses/transfer'
import { exportToast } from '@components/Objects/StyledElements/Toast/ExportToast'
import { queryKeys } from '@/lib/query/keys'

// Admin-only, and only opened from a menu.
const ManageAccessPopover = dynamic(() => import('@components/Dashboard/Library/ManageAccessPopover'), { ssr: false })

export type DashCourse = {
  id?: number
  course_uuid: string
  name: string
  description?: string
  tags?: string
  thumbnail_image?: string
  org_id: number
  public?: boolean
  published?: boolean
  creation_date?: string
  update_date?: string
  authors?: Array<{
    user: {
      id: number | string
      user_uuid: string
      avatar_image: string
      first_name: string
      last_name: string
      username: string
    }
    authorship: string
    authorship_status: string
  }>
}

export const cleanCourseUuid = (uuid: string) => uuid.replace('course_', '')

export const courseEditorHref = (orgslug: string, course: DashCourse, tab = 'general') =>
  getUriWithOrg(orgslug, `/dash/courses/course/${cleanCourseUuid(course.course_uuid)}/${tab}`)

export const coursePublicHref = (orgslug: string, course: DashCourse) =>
  getUriWithOrg(orgslug, `/course/${cleanCourseUuid(course.course_uuid)}`)

// Writes through to every cached copy of the dashboard list so a toggle shows
// before the server answers.
export function usePatchCourseInCache(orgslug: string) {
  const queryClient = useQueryClient()
  return React.useCallback(
    (uuids: string[], patch: Partial<DashCourse>) => {
      const set = new Set(uuids)
      const previous = queryClient.getQueryData<DashCourse[]>(queryKeys.courses.dashAll(orgslug))
      queryClient.setQueryData<DashCourse[]>(queryKeys.courses.dashAll(orgslug), (old) =>
        old?.map((c) => (set.has(c.course_uuid) ? { ...c, ...patch } : c))
      )
      return () => queryClient.setQueryData(queryKeys.courses.dashAll(orgslug), previous)
    },
    [queryClient, orgslug]
  )
}

// Runs `task` over the items a few at a time: far faster than one by one for
// bulk actions, without flooding the API.
export async function runPool<T>(items: T[], task: (item: T) => Promise<boolean>, concurrency = 4) {
  let ok = 0
  let failed = 0
  let index = 0
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++]
      try {
        if (await task(item)) ok++
        else failed++
      } catch {
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return { ok, failed }
}

const ITEM = 'flex items-center gap-2 cursor-pointer'

export function CourseActionsMenu({
  course,
  orgslug,
  onChanged,
  triggerClassName = '',
}: {
  course: DashCourse
  orgslug: string
  onChanged: () => void
  triggerClassName?: string
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const patchCourse = usePatchCourseInCache(orgslug)
  const [confirm, setConfirm] = React.useState<'delete' | 'clone' | null>(null)
  const [accessOpen, setAccessOpen] = React.useState(false)

  const togglePublished = async () => {
    const next = !course.published
    const rollback = patchCourse([course.course_uuid], { published: next })
    try {
      await updateCourse(course.course_uuid, { published: next }, accessToken)
      toast.success(next ? t('dashboard.courses.published_success') : t('dashboard.courses.unpublished_success'))
      queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(course.course_uuid)) })
      onChanged()
    } catch {
      rollback()
      toast.error(t('dashboard.courses.publish_error'))
    }
  }

  const remove = async () => {
    const toastId = toast.loading(t('courses.deleting_course'))
    try {
      await deleteCourseFromBackend(course.course_uuid, accessToken)
      toast.success(t('courses.course_deleted_success'), { id: toastId })
      onChanged()
    } catch {
      toast.error(t('courses.course_deleted_error'), { id: toastId })
    }
  }

  const clone = async () => {
    const toastId = toast.loading(t('courses.cloning_course'))
    try {
      const result = await cloneCourse(course.course_uuid, accessToken)
      if (result.success) {
        toast.success(t('courses.course_cloned_success'), { id: toastId })
        onChanged()
      } else {
        toast.error(result.HTTPmessage || t('courses.course_cloned_error'), { id: toastId })
      }
    } catch {
      toast.error(t('courses.course_cloned_error'), { id: toastId })
    }
  }

  const exportOne = async () => {
    const toastId = exportToast.start('single', course.name)
    try {
      const { exportCourse, downloadBlob } = await import('@services/courses/transfer')
      const blob = await exportCourse(course.course_uuid, accessToken, (progress, status) => {
        exportToast.update(toastId, status as ExportStatus, progress, course.name, undefined, 'single')
      })
      const timestamp = new Date().toISOString().split('T')[0]
      downloadBlob(blob, `${course.name.replace(/[^a-z0-9]/gi, '_')}-${timestamp}.zip`)
      exportToast.complete(toastId, course.name, undefined, 'single')
    } catch (error: any) {
      exportToast.error(toastId, error.message || t('courses.course_exported_error'), course.name, undefined, 'single')
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(coursePublicHref(orgslug, course), window.location.origin).toString())
      toast.success(t('courses.copied'))
    } catch {
      toast.error(t('dashboard.courses.home.copy_failed'))
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('courses.actions')}
            className={`h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-900 transition-colors ${triggerClassName}`}
          >
            <DotsThree size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={courseEditorHref(orgslug, course, 'content')} className={ITEM}>
              <PencilSimpleLine size={15} /> {t('courses.edit_content')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link prefetch={false} href={courseEditorHref(orgslug, course, 'general')} className={ITEM}>
              <SlidersHorizontal size={15} /> {t('common.settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={coursePublicHref(orgslug, course)} target="_blank" rel="noreferrer" className={ITEM}>
              <ArrowSquareOut size={15} /> {t('dashboard.courses.home.view_course')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={copyLink} className={ITEM}>
            <LinkSimple size={15} /> {t('courses.copy_link')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={togglePublished} className={ITEM}>
            {course.published ? <EyeSlash size={15} /> : <Eye size={15} />}
            {course.published ? t('dashboard.courses.home.unpublish') : t('dashboard.courses.home.publish')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAccessOpen(true)} className={ITEM}>
            <Lock size={15} /> {t('library.manage_access')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm('clone')} className={ITEM}>
            <Copy size={15} /> {t('courses.clone_course')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportOne} className={ITEM}>
            <DownloadSimple size={15} /> {t('courses.export_course')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setConfirm('delete')}
            className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}
          >
            <Book size={15} /> {t('courses.delete_course')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('courses.delete_course_title', { name: course.name })}
        message={t('courses.delete_course_confirm')}
        confirmLabel={t('courses.delete_course')}
        onConfirm={remove}
      />
      <ConfirmDialog
        open={confirm === 'clone'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('courses.clone_course_title', { name: course.name })}
        message={t('courses.clone_course_confirm')}
        confirmLabel={t('courses.clone_course')}
        tone="info"
        onConfirm={clone}
      />
      <Modal
        isDialogOpen={accessOpen}
        onOpenChange={setAccessOpen}
        minHeight="no-min"
        minWidth="md"
        dialogTitle={t('library.manage_access')}
        dialogContent={
          accessOpen ? (
            <ManageAccessPopover resource_uuid={course.course_uuid} resourceType="courses" orgslug={orgslug} />
          ) : null
        }
      />
    </>
  )
}
