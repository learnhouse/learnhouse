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
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import { mutate } from 'swr'
import toast from 'react-hot-toast'

type NewActivityButtonProps = {
  chapterId: string
  orgslug: string
}

function NewActivityButton(props: NewActivityButtonProps) {
  const [newActivityModal, setNewActivityModal] = React.useState(false)
  const router = useRouter()
  const course = useCourse() as any
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const withUnpublishedActivities = course ? course.withUnpublishedActivities : false

  const openNewActivityModal = async (chapterId: any) => {
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
    const toast_loading = toast.loading('Creating activity...')
    await createActivity(activity, props.chapterId, org.org_id, access_token)
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    toast.dismiss(toast_loading)
    toast.success('Activity created successfully')
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
    toast.loading('Uploading file and creating activity...')
    await createFileActivity(file, type, activity, chapterId, access_token)
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    setNewActivityModal(false)
    toast.dismiss()
    toast.success('File uploaded successfully')
    toast.success('Activity created successfully')
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  // Submit YouTube Video Upload
  const submitExternalVideo = async (
    external_video_data: any,
    activity: any,
    chapterId: string
  ) => {
    const toast_loading = toast.loading('Creating activity and uploading file...')
    await createExternalVideoActivity(
      external_video_data,
      activity,
      props.chapterId, access_token
    )
    mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`)
    setNewActivityModal(false)
    toast.dismiss(toast_loading)
    toast.success('Activity created successfully')
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
  }

  useEffect(() => { }, [course])

  return (
    <div className="flex justify-center">
      <Modal
        isDialogOpen={newActivityModal}
        onOpenChange={setNewActivityModal}
        minHeight="no-min"
        minWidth='md'
        addDefCloseButton={false}
        dialogContent={
          <NewActivityModal
            closeModal={closeNewActivityModal}
            submitFileActivity={submitFileActivity}
            submitExternalVideo={submitExternalVideo}
            submitActivity={submitActivity}
            chapterId={props.chapterId}
            course={course}
          ></NewActivityModal>
        }
        dialogTitle="Create Activity"
        dialogDescription="Choose between types of activities to add to the course"
      />
      <div
        onClick={() => {
          openNewActivityModal(props.chapterId)
        }}
        className="flex w-44 h-10 items-center justify-center py-2 my-3 rounded-xl text-white bg-black hover:cursor-pointer"
      >
        <Layers size={17} />
        <div className="text-sm font-bold ml-2">
          Add Activity
        </div>
      </div>
    </div>
  )
}

export default NewActivityButton
