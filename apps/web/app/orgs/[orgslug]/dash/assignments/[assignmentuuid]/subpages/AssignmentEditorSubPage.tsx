'use client';
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import React from 'react'
import AssignmentTasks from '../_components/Tasks'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import dynamic from 'next/dynamic';
const AssignmentTaskEditor = dynamic(() => import('../_components/TaskEditor/TaskEditor'))

function AssignmentEditorSubPage({ assignmentuuid }: { assignmentuuid: string }) {
    return (
        <AssignmentsTaskProvider>
            {/* Task list: a fixed-width column on desktop, a stacked section
                above the editor below lg. */}
            <aside className='flex flex-col w-full lg:w-[340px] lg:flex-none lg:h-full lg:min-h-0 bg-white border-b lg:border-b-0 lg:border-e border-neutral-200/70'>
                <AssignmentTasks assignment_uuid={'assignment_' + assignmentuuid} />
            </aside>
            <div className='flex flex-1 min-w-0 lg:h-full lg:min-h-0'>
                <AssignmentProvider assignment_uuid={'assignment_' + assignmentuuid}>
                    <AssignmentTaskEditor page='content' />
                </AssignmentProvider>
            </div>
        </AssignmentsTaskProvider>
    )
}

export default AssignmentEditorSubPage
