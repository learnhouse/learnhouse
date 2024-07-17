import AssignmentBoxUI from '@components/Objects/Assignments/AssignmentBoxUI'
import { Info } from 'lucide-react'
import React from 'react'

export default function TaskFileObject({ view }: any) {
    return (
        <AssignmentBoxUI view={view} type="file">
            <div className='flex py-5 text-sm justify-center mx-auto space-x-2 text-slate-500'>
                <Info size={20} />
                <p>User will be able to submit a file for this task, you'll be able to review it in the Submissions Tab</p>
            </div>
        </AssignmentBoxUI>
    )
}
