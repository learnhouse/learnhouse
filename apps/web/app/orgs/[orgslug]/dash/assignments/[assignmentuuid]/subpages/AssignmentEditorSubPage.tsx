'use client';
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { LayoutList } from 'lucide-react'
import React from 'react'
import AssignmentTasks from '../_components/Tasks'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import dynamic from 'next/dynamic';
const AssignmentTaskEditor = dynamic(() => import('../_components/TaskEditor/TaskEditor'))

function AssignmentEditorSubPage({ assignmentuuid }: { assignmentuuid: string }) {
    return (
        <AssignmentsTaskProvider>
            <div className='flex w-[400px] flex-col h-full custom-dots-bg'>
                <div className='flex mx-auto px-3.5 py-1 bg-neutral-600/80 space-x-2 my-5 items-center text-sm font-bold text-white rounded-full'>
                    <LayoutList size={18} />
                    <p>Tasks</p>
                </div>
                <AssignmentTasks assignment_uuid={'assignment_' + assignmentuuid} />
            </div>
            <div className='flex flex-grow bg-[#fefcfe] nice-shadow h-full w-full'>
                <AssignmentProvider assignment_uuid={'assignment_' + assignmentuuid}>
                    <AssignmentTaskEditor page='general' />
                </AssignmentProvider>
            </div>
        </AssignmentsTaskProvider>
    )
}

export default AssignmentEditorSubPage