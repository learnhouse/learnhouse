'use client'
import {
  AssignmentProvider,
  useAssignments,
} from '@components/Contexts/Assignments/AssignmentContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import BreadCrumbs from '@components/Dashboard/Misc/BreadCrumbs'
import EditAssignmentModal from '@components/Objects/Modals/Activities/Assignments/EditAssignmentModal'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getAPIUrl } from '@services/config/config'
import { updateActivity } from '@services/courses/activities'
import { updateAssignment } from '@services/courses/assignments'
import {
  BookOpen,
  BookX,
  EllipsisVertical,
  Eye,
  Layers2,
  Monitor,
  Pencil,
  UserRoundPen,
} from 'lucide-react'
// Lazy Loading
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useMediaQuery } from 'usehooks-ts'
import AssignmentEditorSubPage from './subpages/AssignmentEditorSubPage'
const AssignmentSubmissionsSubPage = dynamic(
  () => import('./subpages/AssignmentSubmissionsSubPage')
)

function AssignmentEdit() {
  const params = useParams<{ assignmentuuid: string }>()
  const searchParams = useSearchParams()
  const [selectedSubPage, setSelectedSubPage] = useState(
    searchParams.get('subpage') || 'editor'
  )
  const isMobile = useMediaQuery('(max-width: 767px)')

  if (isMobile) {
    // TODO: Work on a better mobile experience
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#f8f8f8] p-4">
        <div className="rounded-lg bg-white p-6 text-center shadow-md">
          <h2 className="mb-4 text-xl font-bold">Desktop Only</h2>
          <Monitor className="mx-auto my-5" size={60} />
          <p>This page is only accessible from a desktop device.</p>
          <p>Please switch to a desktop to view and manage the assignment.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col">
      <AssignmentProvider
        assignment_uuid={'assignment_' + params.assignmentuuid}
      >
        <div className="nice-shadow z-50 flex flex-col bg-white shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
          <div className="mr-10 flex h-full justify-between">
            <div className="mr-10 pl-10 tracking-tighter">
              <BrdCmpx />
              <div className="flex w-100 justify-between">
                <div className="flex text-2xl font-bold">
                  <AssignmentTitle />
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center antialiased">
              <PublishingState />
            </div>
          </div>
          <div className="mr-10 flex space-x-2 pt-2 pl-10 text-sm font-semibold tracking-tight">
            <div
              onClick={() => setSelectedSubPage('editor')}
              className={`flex w-fit space-x-4 border-black py-2 text-center transition-all ease-linear ${
                selectedSubPage === 'editor' ? 'border-b-4' : 'opacity-50'
              } cursor-pointer`}
            >
              <div className="mx-2 flex items-center space-x-2.5">
                <Layers2 size={16} />
                <div>Editor</div>
              </div>
            </div>
            <div
              onClick={() => setSelectedSubPage('submissions')}
              className={`flex w-fit space-x-4 border-black py-2 text-center transition-all ease-linear ${
                selectedSubPage === 'submissions' ? 'border-b-4' : 'opacity-50'
              } cursor-pointer`}
            >
              <div className="mx-2 flex items-center space-x-2.5">
                <UserRoundPen size={16} />
                <div>Submissions</div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex h-full w-full">
          {selectedSubPage === 'editor' && (
            <AssignmentEditorSubPage assignmentuuid={params.assignmentuuid} />
          )}
          {selectedSubPage === 'submissions' && (
            <AssignmentSubmissionsSubPage
              assignment_uuid={params.assignmentuuid}
            />
          )}
        </div>
      </AssignmentProvider>
    </div>
  )
}

export default AssignmentEdit

function BrdCmpx() {
  const assignment = useAssignments() as any

  useEffect(() => {}, [assignment])

  return (
    <BreadCrumbs
      type="assignments"
      last_breadcrumb={assignment?.assignment_object?.title}
    />
  )
}

function PublishingState() {
  const assignment = useAssignments() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  async function updateAssignmentPublishState(assignmentUUID: string) {
    const res = await updateAssignment(
      { published: !assignment?.assignment_object?.published },
      assignmentUUID,
      access_token
    )
    const res2 = await updateActivity(
      { published: !assignment?.assignment_object?.published },
      assignment?.activity_object?.activity_uuid,
      access_token
    )
    const toast_loading = toast.loading('Updating assignment...')
    if (res.success && res2) {
      mutate(`${getAPIUrl()}assignments/${assignmentUUID}`)
      toast.success('The assignment has been updated successfully')
      toast.dismiss(toast_loading)
    } else {
      toast.error('Error updating assignment, please retry later.')
    }
  }

  useEffect(() => {}, [assignment])

  return (
    <>
      <div className="mx-auto mt-5 flex items-center space-x-4">
        <div
          className={`mx-auto flex rounded-full px-3.5 py-2 text-xs font-bold outline outline-1 ${!assignment?.assignment_object?.published ? 'bg-gray-200/60 outline-gray-300' : 'bg-green-200/60 outline-green-300'}`}
        >
          {assignment?.assignment_object?.published
            ? 'Published'
            : 'Unpublished'}
        </div>
        <div>
          <EllipsisVertical className="text-gray-500" size={13} />
        </div>

        <ToolTip
          side="left"
          slateBlack
          sideOffset={10}
          content="Edit Assignment Details"
        >
          <div
            onClick={() => setIsEditModalOpen(true)}
            className="flex cursor-pointer items-center space-x-2 rounded-md border border-blue-600/10 bg-linear-to-bl from-blue-400/50 to-blue-200/80 px-3 py-2 font-medium text-blue-800 shadow-lg shadow-blue-900/10"
          >
            <Pencil size={18} />
            <p className="text-sm font-bold">Edit</p>
          </div>
        </ToolTip>

        <ToolTip
          side="left"
          slateBlack
          sideOffset={10}
          content="Preview the Assignment as a student"
        >
          <Link
            target="_blank"
            href={`/course/${assignment?.course_object?.course_uuid.replace('course_', '')}/activity/${assignment?.activity_object?.activity_uuid.replace('activity_', '')}`}
            className="flex cursor-pointer items-center space-x-2 rounded-md border border-cyan-600/10 bg-linear-to-bl from-sky-400/50 to-cyan-200/80 px-3 py-2 font-medium text-cyan-800 shadow-lg shadow-cyan-900/10"
          >
            <Eye size={18} />
            <p className="text-sm font-bold">Preview</p>
          </Link>
        </ToolTip>
        {assignment?.assignment_object?.published && (
          <ToolTip
            side="left"
            slateBlack
            sideOffset={10}
            content="Make your Assignment unavailable for students"
          >
            <div
              onClick={() =>
                updateAssignmentPublishState(
                  assignment?.assignment_object?.assignment_uuid
                )
              }
              className="flex cursor-pointer items-center space-x-2 rounded-md border border-gray-600/10 bg-linear-to-bl from-gray-400/50 to-gray-200/80 px-3 py-2 font-medium text-gray-800 shadow-lg shadow-gray-900/10"
            >
              <BookX size={18} />
              <p className="text-sm font-bold">Unpublish</p>
            </div>
          </ToolTip>
        )}
        {!assignment?.assignment_object?.published && (
          <ToolTip
            side="left"
            slateBlack
            sideOffset={10}
            content="Make your Assignment public and available for students"
          >
            <div
              onClick={() =>
                updateAssignmentPublishState(
                  assignment?.assignment_object?.assignment_uuid
                )
              }
              className="flex cursor-pointer items-center space-x-2 rounded-md border border-green-600/10 bg-linear-to-bl from-green-400/50 to-lime-200/80 px-3 py-2 font-medium text-green-800 shadow-lg shadow-green-900/10"
            >
              <BookOpen size={18} />
              <p className="text-sm font-bold">Publish</p>
            </div>
          </ToolTip>
        )}
      </div>
      {isEditModalOpen && (
        <EditAssignmentModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          assignment={assignment?.assignment_object}
          accessToken={access_token}
        />
      )}
    </>
  )
}

function AssignmentTitle() {
  const assignment = useAssignments() as any

  return <div className="flex items-center gap-2">Assignment Tools</div>
}
