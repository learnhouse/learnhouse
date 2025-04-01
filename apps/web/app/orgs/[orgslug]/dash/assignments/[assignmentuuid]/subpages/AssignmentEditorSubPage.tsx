'use client'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { LayoutList } from 'lucide-react'
import dynamic from 'next/dynamic'
import React from 'react'
import AssignmentTasks from '../_components/Tasks'
const AssignmentTaskEditor = dynamic(
  () => import('../_components/TaskEditor/TaskEditor')
)

function AssignmentEditorSubPage({
  assignmentuuid,
}: {
  assignmentuuid: string
}) {
  return (
    <AssignmentsTaskProvider>
      <div className="custom-dots-bg flex h-full w-[400px] flex-col">
        <div className="mx-auto my-5 flex items-center space-x-2 rounded-full bg-neutral-600/80 px-3.5 py-1 text-sm font-bold text-white">
          <LayoutList size={18} />
          <p>Tasks</p>
        </div>
        <AssignmentTasks assignment_uuid={'assignment_' + assignmentuuid} />
      </div>
      <div className="nice-shadow flex h-full w-full grow bg-[#fefcfe]">
        <AssignmentProvider assignment_uuid={'assignment_' + assignmentuuid}>
          <AssignmentTaskEditor page="general" />
        </AssignmentProvider>
      </div>
    </AssignmentsTaskProvider>
  )
}

export default AssignmentEditorSubPage
