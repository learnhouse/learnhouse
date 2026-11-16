import { useCourse } from '@components/Contexts/CourseContext'
import NewActivityModal, { getActivityType } from '@components/Objects/Modals/Activities/Create/NewActivity'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useModalFormHost } from '@components/Objects/Modals/Activities/activityFormKit'
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
import { Stack } from '@phosphor-icons/react'
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
    try {
      await createActivity(activity, props.chapterId, org.id, access_token)
    } catch (error: any) {
      toast.dismiss(toast_loading)
      toast.error(error?.message || t('dashboard.courses.structure.activity.toasts.create_error', 'Could not create the activity'))
      return
    }
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

  // The play form creates its activity itself (to surface the API's checks).
  const onPlayActivityCreated = async () => {
    track(AnalyticsEvent.ActivityCreated, { activity_type: 'TYPE_PLAY' })
    setNewActivityModal(false)
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    await refreshStructure()
  }

  // Live sessions create their own activity server side; just refresh.
  const onLiveSessionCreated = async () => {
    track(AnalyticsEvent.ActivityCreated, { activity_type: 'TYPE_LIVE_SESSION' })
    setNewActivityModal(false)
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    await refreshStructure()
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
        title: activity?.name || t('dashboard.courses.structure.activity.upload_task.video_title'),
        subtitle: t('dashboard.courses.structure.activity.upload_task.uploading'),
      })
      try {
        const created = await createVideoActivityWithProgress(
          file,
          activity,
          chapterId,
          access_token,
          (pct) => updateTask(taskId, { progress: pct })
        )
        updateTask(taskId, { status: 'processing', subtitle: t('dashboard.courses.structure.activity.upload_task.finishing'), progress: 100 })
        if (captions && created?.activity_uuid) {
          try {
            await updateVideoCaptions(created.activity_uuid, captions, access_token)
          } catch {
            /* captions are best-effort; upload already succeeded */
          }
        }
        track(AnalyticsEvent.ActivityFileUploaded, { file_type: type, upload_succeeded: true })
        await refreshStructure()
        updateTask(taskId, { status: 'done', subtitle: t('dashboard.courses.structure.activity.upload_task.uploaded') })
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
    try {
      await createExternalVideoActivity(
        external_video_data,
        activity,
        props.chapterId, access_token
      )
    } catch (error: any) {
      toast.dismiss(toast_loading)
      toast.error(error?.message || t('dashboard.courses.structure.activity.toasts.create_error', 'Could not create the activity'))
      return
    }
    track(AnalyticsEvent.ActivityFileUploaded, { file_type: 'video', upload_succeeded: true })
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(course.courseStructure.course_uuid)) })
    setNewActivityModal(false)
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  // Auto-open the modal once when requested (e.g. straight after course creation).
  const autoOpenedRef = React.useRef(false)
  useEffect(() => {
    if (props.autoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      setSelectedView('home')
      setNewActivityModal(true)
    }
  }, [props.autoOpen])

  // Step 1 picks a type, step 2 is that type's form, with its submit button
  // pinned in the modal footer.
  const host = useModalFormHost()
  const selectedType = selectedView !== 'home' ? getActivityType(selectedView) : undefined
  const SelectedIcon = selectedType?.icon ?? Stack

  return (
    <div>
      <Modal
        isDialogOpen={newActivityModal}
        onOpenChange={setNewActivityModal}
        size={selectedType ? (selectedView === 'assignments' || selectedView === 'video' || selectedView === 'livesession' || selectedView === 'scorm' || selectedView === 'play' ? 'lg' : 'md') : undefined}
        // The type picker keeps its original wide grid of pattern cards.
        minWidth={selectedType ? undefined : 'md'}
        preventClose={host.submitting}
        icon={selectedType ? <SelectedIcon size={16} /> : undefined}
        onBack={selectedType && !host.submitting ? () => setSelectedView('home') : undefined}
        dialogTitle={selectedType ? (selectedType.labelDefault ? t(selectedType.labelKey, selectedType.labelDefault) : t(selectedType.labelKey)) : t('dashboard.courses.structure.modals.new_activity.title')}
        dialogDescription={
          selectedType
            ? selectedType.descriptionDefault ? t(selectedType.descriptionKey, selectedType.descriptionDefault) : t(selectedType.descriptionKey)
            : t('dashboard.courses.structure.modals.new_activity.description')
        }
        footer={selectedType ? host.footer(() => setNewActivityModal(false), t('common.cancel')) : undefined}
        dialogContent={host.wrap(
          <NewActivityModal
            closeModal={closeNewActivityModal}
            submitFileActivity={submitFileActivity}
            submitExternalVideo={submitExternalVideo}
            submitActivity={submitActivity}
            onLiveSessionCreated={onLiveSessionCreated}
            onPlayActivityCreated={onPlayActivityCreated}
            chapterId={props.chapterId}
            course={course}
            orgslug={props.orgslug}
            selectedView={selectedView}
            setSelectedView={setSelectedView}
          />
        )}
      />
      <button
        type="button"
        onClick={() => {
          openNewActivityModal(props.chapterId)
        }}
        className="w-full h-10 flex items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
      >
        <Stack size={15} />
        {t('dashboard.courses.structure.actions.add_activity')}
      </button>
    </div>
  )
}

export default NewActivityButton
