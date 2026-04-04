import { useCourse } from '@components/Contexts/CourseContext'
import NewActivityModal from '@components/Objects/Modals/Activities/Create/NewActivity'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import {
  createActivity,
  createExternalVideoActivity,
  createFileActivity,
} from '@services/courses/activities'
import { getOrganizationContextInfoWithoutCredentials } from '@services/organizations/orgs'
import { revalidateTags } from '@services/utils/ts/requests'
import { Layers } from 'lucide-react'
import { ArrowLeft } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import { mutate } from 'swr'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type NewActivityButtonProps = {
  chapterId: string
  orgslug: string
}

function NewActivityButton(props: NewActivityButtonProps) {
  const { t } = useTranslation()
  const [newActivityModal, setNewActivityModal] = React.useState(false)
  const [selectedView, setSelectedView] = React.useState('home')
  const router = useRouter()
  const course = useCourse() as any
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

  const openNewActivityModal = async (chapterId: any) => {
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
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    // Refresh sidebar cache
    mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    setNewActivityModal(false)
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  // Submit File Upload
  const submitFileActivity = async (
    file: any,
    type: any,
    activity: any,
    chapterId: string
  ) => {
    toast.loading(t('dashboard.courses.structure.activity.toasts.uploading'))
    await createFileActivity(file, type, activity, chapterId, access_token)
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    // Refresh sidebar cache
    mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
    setNewActivityModal(false)
    toast.dismiss()
    toast.success(t('dashboard.courses.structure.activity.toasts.upload_success'))
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  // Submit YouTube Video Upload
  const submitExternalVideo = async (
    external_video_data: any,
    activity: any,
    chapterId: string
  ) => {
    const toast_loading = toast.loading(t('dashboard.courses.structure.activity.toasts.creating_uploading'))
    await createExternalVideoActivity(
      external_video_data,
      activity,
      props.chapterId, access_token
    )
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    // Refresh sidebar cache
    mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
    setNewActivityModal(false)
    toast.dismiss(toast_loading)
    toast.success(t('dashboard.courses.structure.activity.toasts.create_success'))
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  useEffect(() => { }, [course])

  const dialogTitle = selectedView !== 'home' ? (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setSelectedView('home')}
        className="flex items-center justify-center h-7 w-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <ArrowLeft size={18} />
      </button>
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
        <div className="text-sm font-bold ml-2">
          {t('dashboard.courses.structure.actions.add_activity')}
        </div>
      </div>
    </div>
  )
}

export default NewActivityButton
