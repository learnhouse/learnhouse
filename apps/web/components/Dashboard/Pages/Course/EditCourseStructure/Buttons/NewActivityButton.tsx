import { useCourse } from '@components/Contexts/CourseContext'
import NewActivityModal from '@components/Objects/Modals/Activities/Create/NewActivity'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import {
  createActivity,
  createExternalVideoActivity,
  createFileActivity,
  createVideoActivityWithProgress,
  updateVideoCaptions,
} from '@services/courses/activities'
import { useBackgroundTasks } from '@components/Contexts/BackgroundTasksContext'
import { getOrganizationContextInfoWithoutCredentials } from '@services/organizations/orgs'
import { revalidateTags } from '@services/utils/ts/requests'
import { Layers } from 'lucide-react'
import { ArrowLeft } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@lib/query/keys'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

type NewActivityButtonProps = {
  chapterId: string
  orgslug: string
  // When true, the add-activity modal opens automatically on mount. Used right
  // after a course is created to drop the teacher straight into adding content.
  autoOpen?: boolean
}

function NewActivityButton(props: NewActivityButtonProps) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const [newActivityModal, setNewActivityModal] = React.useState(false)
  const [selectedView, setSelectedView] = React.useState('home')
  const router = useRouter()
  const course = useCourse() as any
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient()
  const { addTask, updateTask } = useBackgroundTasks()
  const cleanCourseUuid = (id: string) => id?.replace(/^course_/, '') ?? id

  const openNewActivityModal = async (_chapterId: any) => {
    setSelectedView('home')
    setNewActivityModal(true)
  }

  const closeNewActivityModal = async () => {
    setNewActivityModal(false)
  }

  // Submit new activity
  const submitActivity = async (activity: any) => {
    let org = await getOrganizationContextInfoWithoutCredentials(
      props.orgslug,
      { revalidate: 1800 }
    )
    const toast_loading = toast.loading(t('dashboard.courses.structure.activity.toasts.creating'))
    await createActivity(activity, props.chapterId, org.id, access_token)
    track(AnalyticsEvent.ActivityCreated, { activity_type: activity?.type ?? activity?.activity_type })
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(course.courseStructure.course_uuid)) })
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    setNewActivityModal(false)
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  const refreshStructure = async () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.courses.meta(cleanCourseUuid(course.courseStructure.course_uuid)),
    })
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  // Submit File Upload
  const submitFileActivity = async (
    file: any,
    type: any,
    activity: any,
    chapterId: string,
    captions?: { enabled: boolean; source_language: string; languages: { code: string; label?: string }[] }
  ) => {
    // Video uploads run in the BACKGROUND with a progress notification, so the
    // modal closes immediately and the teacher can keep working.
    if (type === 'video') {
      setNewActivityModal(false)
      const taskId = addTask({
        kind: 'video-upload',
        title: activity?.name || 'Video',
        subtitle: 'Uploading…',
      })
      try {
        const created = await createVideoActivityWithProgress(
          file,
          activity,
          chapterId,
          access_token,
          (pct) => updateTask(taskId, { progress: pct })
        )
        updateTask(taskId, { status: 'processing', subtitle: 'Finishing up…', progress: 100 })
        if (captions && created?.activity_uuid) {
          try {
            await updateVideoCaptions(created.activity_uuid, captions, access_token)
          } catch {
            /* captions are best-effort; upload already succeeded */
          }
        }
        track(AnalyticsEvent.ActivityFileUploaded, { file_type: type, upload_succeeded: true })
        await refreshStructure()
        updateTask(taskId, { status: 'done', subtitle: 'Uploaded' })
      } catch (error: any) {
        track(AnalyticsEvent.ActivityFileUploaded, { file_type: type, upload_succeeded: false })
        updateTask(taskId, {
          status: 'error',
          error: error?.message || t('dashboard.courses.structure.activity.toasts.upload_error'),
        })
      }
      return
    }

    // Non-video files keep the original inline flow.
    const toast_loading = toast.loading(t('dashboard.courses.structure.activity.toasts.uploading'))
    try {
      await createFileActivity(file, type, activity, chapterId, access_token)
    } catch (error: any) {
      track(AnalyticsEvent.ActivityFileUploaded, { file_type: type, upload_succeeded: false })
      toast.dismiss(toast_loading)
      toast.error(error?.message || t('dashboard.courses.structure.activity.toasts.upload_error'))
      return
    }
    track(AnalyticsEvent.ActivityFileUploaded, { file_type: type, upload_succeeded: true })
    setNewActivityModal(false)
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.upload_success'))
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    await refreshStructure()
  }

  // Submit YouTube Video Upload
  const submitExternalVideo = async (
    external_video_data: any,
    activity: any,
    _chapterId: string
  ) => {
    const toast_loading = toast.loading(t('dashboard.courses.structure.activity.toasts.creating_uploading'))
    await createExternalVideoActivity(
      external_video_data,
      activity,
      props.chapterId, access_token
    )
    track(AnalyticsEvent.ActivityFileUploaded, { file_type: 'video', upload_succeeded: true })
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(course.courseStructure.course_uuid)) })
    setNewActivityModal(false)
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  useEffect(() => { }, [course])

  // Auto-open the modal once when requested (e.g. straight after course creation).
  const autoOpenedRef = React.useRef(false)
  useEffect(() => {
    if (props.autoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      setSelectedView('home')
      setNewActivityModal(true)
    }
  }, [props.autoOpen])

  const dialogTitle = selectedView !== 'home' ? (
    <div className="flex items-center gap-3">
      <ToolTip content={t('dashboard.courses.structure.actions.back', { defaultValue: 'Go back' })} side="bottom">
        <button
          onClick={() => setSelectedView('home')}
          className="flex items-center justify-center h-7 w-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={18} data-dir-flip />
        </button>
      </ToolTip>
      <span>{t('dashboard.courses.structure.modals.new_activity.title')}</span>
    </div>
  ) : (
    t('dashboard.courses.structure.modals.new_activity.title')
  )

  return (
    <div className="flex justify-center">
      <Modal
        isDialogOpen={newActivityModal}
        onOpenChange={setNewActivityModal}
        minHeight="no-min"
        minWidth='md'
        addDefCloseButton={false}
        noPadding
        dialogContent={
          <NewActivityModal
            closeModal={closeNewActivityModal}
            submitFileActivity={submitFileActivity}
            submitExternalVideo={submitExternalVideo}
            submitActivity={submitActivity}
            chapterId={props.chapterId}
            course={course}
            orgslug={props.orgslug}
            selectedView={selectedView}
            setSelectedView={setSelectedView}
          ></NewActivityModal>
        }
        dialogTitle={dialogTitle}
        dialogDescription={selectedView === 'home' ? t('dashboard.courses.structure.modals.new_activity.description') : undefined}
      />
      <div
        onClick={() => {
          openNewActivityModal(props.chapterId)
        }}
        className="flex w-44 h-10 items-center justify-center py-2 my-3 rounded-xl text-white bg-black hover:cursor-pointer"
      >
        <Layers size={17} />
        <div className="text-sm font-bold ms-2">
          {t('dashboard.courses.structure.actions.add_activity')}
        </div>
      </div>
    </div>
  )
}

export default NewActivityButton
