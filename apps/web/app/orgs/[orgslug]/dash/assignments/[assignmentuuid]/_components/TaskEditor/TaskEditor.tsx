'use client'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import {
  useAssignmentsTask,
  useAssignmentsTaskDispatch,
} from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { deleteAssignmentTask } from '@services/courses/assignments'
import { GalleryVerticalEnd, Info, TentTree, Trash } from 'lucide-react'
import dynamic from 'next/dynamic'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { AssignmentTaskGeneralEdit } from './Subs/AssignmentTaskGeneralEdit'
const AssignmentTaskContentEdit = dynamic(
  () => import('./Subs/AssignmentTaskContentEdit')
)

function AssignmentTaskEditor({ page }: any) {
  const [selectedSubPage, setSelectedSubPage] = React.useState(page)
  const assignment = useAssignments() as any
  const assignmentTaskState = useAssignmentsTask() as any
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  async function deleteTaskUI() {
    const res = await deleteAssignmentTask(
      assignmentTaskState.assignmentTask.assignment_task_uuid,
      assignment.assignment_object.assignment_uuid,
      access_token
    )
    if (res) {
      assignmentTaskStateHook({
        type: 'SET_MULTIPLE_STATES',
        payload: {
          selectedAssignmentTaskUUID: null,
          assignmentTask: {},
        },
      })
      mutate(
        `${getAPIUrl()}assignments/${assignment.assignment_object.assignment_uuid}/tasks`
      )
      mutate(
        `${getAPIUrl()}assignments/${assignment.assignment_object.assignment_uuid}`
      )
      toast.success('Task deleted successfully')
    } else {
      toast.error('Error deleting task, please retry later.')
    }
  }

  useEffect(() => {
    // Switch back to general page if the selectedAssignmentTaskUUID is changed
    if (
      assignmentTaskState.selectedAssignmentTaskUUID !==
      assignmentTaskState.assignmentTask.assignment_task_uuid
    ) {
      setSelectedSubPage('general')
    }
  }, [
    assignmentTaskState,
    assignmentTaskStateHook,
    selectedSubPage,
    assignment,
  ])

  return (
    <div className="z-20 flex w-full flex-col text-sm font-black">
      {assignmentTaskState.assignmentTask &&
        Object.keys(assignmentTaskState.assignmentTask).length > 0 && (
          <div className="flex flex-col space-y-3">
            <div className="nice-shadow z-10 mb-3 flex flex-col bg-white pt-5 pr-10 pl-10 text-sm tracking-tight shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
              <div className="flex items-center justify-between py-1">
                <div className="text-lg font-semibold">
                  {assignmentTaskState?.assignmentTask.title}
                </div>
                <div>
                  <div
                    onClick={() => deleteTaskUI()}
                    className="flex cursor-pointer items-center space-x-2 rounded-md border border-rose-600/10 bg-rose-100 bg-linear-to-bl px-2 py-1.5 text-red-800 shadow-lg shadow-rose-900/10"
                  >
                    <Trash size={18} />
                    <p className="text-xs font-semibold">Delete Task</p>
                  </div>
                </div>
              </div>
              <div className="flex space-x-2">
                <div
                  onClick={() => setSelectedSubPage('general')}
                  className={`flex w-fit space-x-4 border-black py-2 text-center transition-all ease-linear ${
                    selectedSubPage === 'general' ? 'border-b-4' : 'opacity-50'
                  } cursor-pointer`}
                >
                  <div className="mx-2 flex items-center space-x-2.5">
                    <Info size={16} />
                    <div>General</div>
                  </div>
                </div>
                <div
                  onClick={() => setSelectedSubPage('content')}
                  className={`flex w-fit space-x-4 border-black py-2 text-center transition-all ease-linear ${
                    selectedSubPage === 'content' ? 'border-b-4' : 'opacity-50'
                  } cursor-pointer`}
                >
                  <div className="mx-2 flex items-center space-x-2.5">
                    <GalleryVerticalEnd size={16} />
                    <div>Content</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="nice-shadow mx-auto mt-10 mr-10 ml-10 rounded-xl bg-white px-6 py-5 shadow-xs">
              {selectedSubPage === 'general' && <AssignmentTaskGeneralEdit />}
              {selectedSubPage === 'content' && <AssignmentTaskContentEdit />}
            </div>
          </div>
        )}
      {Object.keys(assignmentTaskState.assignmentTask).length == 0 && (
        <div className="z-10 flex h-full flex-col bg-white pt-5 pr-10 pl-10 text-sm tracking-tight shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
          <div className="flex h-full items-center justify-center text-gray-300 antialiased">
            <div className="flex flex-col items-center space-y-2">
              <TentTree size={60} />
              <div className="py-1 text-2xl font-semibold">
                No Task Selected
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AssignmentTaskEditor
